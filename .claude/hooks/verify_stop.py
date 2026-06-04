#!/usr/bin/env python3
# =============================================================================
# verify_stop.py  --  Claude Code "Stop" hook for the chess_analyzer project
# =============================================================================
#
# WHAT THIS DOES
# --------------
# Runs automatically when Claude finishes a turn (the "Stop" event). It looks
# at the files changed in the working tree (staged + unstaged + untracked) and
# runs three project-specific verification checks:
#
#   CHECK 1  JS syntax        - `node --check` every changed *.js file
#                               (skips js/chess.js and js/stockfish.js, which
#                                are large vendored/minified libraries).
#   CHECK 2  .hidden CSS x-ref - every changed *.html file: for each element
#                               carrying the `hidden` class, confirm a CSS rule
#                               actually hides it (a scoped `.cls.hidden` /
#                               `#id.hidden` rule, OR a generic `.hidden` rule
#                               with display:none reachable from that page).
#                               A `hidden` element with no hiding rule is the
#                               bug class that froze the board twice.
#   CHECK 3  scope-lock       - flags js/memory.js or js/storage.js appearing
#                               in the change set ("protected file changed").
#   CHECK 4  HANDOFF doc      - on a "substantive" turn (see below), warns if
#                               HANDOFF.md was NOT updated this turn. Convention
#                               1/3 from CLAUDE.md: substantive turns must append
#                               a dated HANDOFF.md entry.
#   CHECK 5  COMMAND_LOG doc  - on a substantive turn, warns if COMMAND_LOG.md
#                               was NOT updated this turn (the prompt log).
#
# SUBSTANTIVE TURN: a turn in which any changed file (staged, unstaged, or
# untracked) is under js/, or under css/, or under server/, or matches *.html.
# CHECK 4 and CHECK 5 do not fire at all on non-substantive turns (e.g. a
# docs-only or no-op turn).
#
# MODE: WARN-ONLY  (this is the important part)
# ---------------------------------------------
# Findings are printed to stderr prefixed with "[stop-hook WARN]", but the
# script ALWAYS exits 0, so it NEVER blocks Claude from stopping. The hook is
# also fail-safe: if git or node is missing, or anything raises, it prints a
# note and exits 0. The hook's own problems must never wedge the session.
#
# HOW TO SWITCH TO BLOCKING LATER  (one-line change)
# --------------------------------------------------
# Find the line marked  ###<<< FLIP-TO-BLOCK >>>###  near the bottom and change
#       sys.exit(0)
# to
#       sys.exit(2)
# Per Claude Code v2.1.x, a Stop hook exiting 2 prevents Claude from stopping
# and feeds stderr back into the conversation as the reason. (No other change
# is needed; the findings are already written to stderr above that line.)
# =============================================================================

import json
import os
import re
import shutil
import subprocess
import sys

# Vendored / minified JS that we never syntax-check.
JS_SKIP = {"js/chess.js", "js/stockfish.js"}

# Files that are not supposed to change without a deliberate decision.
PROTECTED = {"js/memory.js", "js/storage.js"}

# Pages that the task notes already carry their own inline generic `.hidden`
# rule, so any hidden element on them is considered covered up-front.
SELF_COVERED_HTML = {"practice.html", "openings.html"}

# Doc files that CLAUDE.md conventions require updating on a substantive turn.
# Matched against the change set as repo-root-relative paths (exact case).
HANDOFF_DOC = "HANDOFF.md"
COMMAND_LOG_DOC = "COMMAND_LOG.md"


def log(msg):
    """Plain informational note (stdout)."""
    print(msg)


def run_git(args, cwd):
    """Run a git command, return stdout text or None on any failure."""
    try:
        out = subprocess.run(
            ["git"] + args,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if out.returncode != 0:
            return None
        return out.stdout
    except Exception:
        return None


def repo_root():
    """Locate the repo root. Prefer CLAUDE_PROJECT_DIR, fall back to git."""
    proj = os.environ.get("CLAUDE_PROJECT_DIR")
    start = proj if proj and os.path.isdir(proj) else os.getcwd()
    top = run_git(["rev-parse", "--show-toplevel"], cwd=start)
    if top:
        return os.path.normpath(top.strip())
    return os.path.normpath(start)


def changed_files(root):
    """
    Collect changed paths (relative, forward-slash) from:
      - git diff --name-only            (unstaged)
      - git diff --name-only --cached    (staged)
      - git status --porcelain           (catches untracked + everything else)
    Deduped. Renames in porcelain resolve to the new path.
    """
    files = set()

    for args in (["diff", "--name-only"], ["diff", "--name-only", "--cached"]):
        out = run_git(args, cwd=root)
        if out:
            for line in out.splitlines():
                p = line.strip()
                if p:
                    files.add(p.replace("\\", "/"))

    porcelain = run_git(["status", "--porcelain"], cwd=root)
    if porcelain:
        for line in porcelain.splitlines():
            if not line.strip():
                continue
            # Format: XY <space> path   (path begins at column 3)
            path = line[3:] if len(line) > 3 else line.strip()
            # Renamed/copied entries look like "old -> new"; keep the new name.
            if " -> " in path:
                path = path.split(" -> ", 1)[1]
            path = path.strip().strip('"').replace("\\", "/")
            if path:
                files.add(path)

    return sorted(files)


# --------------------------------------------------------------------------- #
# CHECK 1 - JS syntax via `node --check`
# --------------------------------------------------------------------------- #
def check_js_syntax(root, rel_files, findings):
    if not shutil.which("node"):
        log("[stop-hook] node not found - skipping JS syntax check.")
        return
    for rel in rel_files:
        if not rel.endswith(".js"):
            continue
        if rel in JS_SKIP:
            continue
        abspath = os.path.join(root, rel)
        if not os.path.isfile(abspath):
            continue  # deleted file - nothing to check
        try:
            res = subprocess.run(
                ["node", "--check", abspath],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if res.returncode != 0:
                detail = (res.stderr or res.stdout or "").strip().splitlines()
                first = detail[0] if detail else "syntax error"
                findings.append(f"CHECK 1 (JS syntax): {rel} -> {first}")
        except Exception as exc:
            log(f"[stop-hook] could not node --check {rel}: {exc}")


# --------------------------------------------------------------------------- #
# CHECK 2 - .hidden CSS cross-reference
# --------------------------------------------------------------------------- #
# Pull (selector, declaration-block) pairs out of CSS text.
CSS_RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}", re.DOTALL)
# An HTML tag that carries a class attribute mentioning the word "hidden".
TAG_RE = re.compile(r"<([a-zA-Z][\w-]*)\b([^>]*)>", re.DOTALL)
CLASS_ATTR_RE = re.compile(r"""class\s*=\s*["']([^"']*)["']""", re.IGNORECASE)
ID_ATTR_RE = re.compile(r"""id\s*=\s*["']([^"']*)["']""", re.IGNORECASE)
STYLE_BLOCK_RE = re.compile(r"<style[^>]*>(.*?)</style>", re.DOTALL | re.IGNORECASE)


def _has_hide_decl(block):
    norm = re.sub(r"\s+", "", block).lower()
    return "display:none" in norm or "visibility:hidden" in norm


def _parse_css_rules(css_text):
    """Return list of (selector_parts[list], block_text)."""
    rules = []
    for sel, block in CSS_RULE_RE.findall(css_text):
        # Drop @media/@keyframes wrappers' selector noise by splitting on commas.
        parts = [s.strip() for s in sel.split(",") if s.strip()]
        rules.append((parts, block))
    return rules


def _generic_hidden_present(rules):
    """True if a bare `.hidden { ...display:none... }` rule exists."""
    for parts, block in rules:
        for sel in parts:
            if re.fullmatch(r"\.hidden", sel.strip()) and _has_hide_decl(block):
                return True
    return False


def _element_covered(classes, elem_id, rules):
    """
    Covered if some hiding rule's selector targets `.hidden` together with one
    of this element's other classes (.cls) or its id (#id), in either order.
    """
    others = [c for c in classes if c != "hidden"]
    for parts, block in rules:
        if not _has_hide_decl(block):
            continue
        for sel in parts:
            if ".hidden" not in sel:
                continue
            for c in others:
                if f".{c}" in sel:
                    return True
            if elem_id and f"#{elem_id}" in sel:
                return True
    return False


def check_hidden_css(root, rel_files, findings):
    html_files = [f for f in rel_files if f.endswith(".html")]
    if not html_files:
        return

    # Shared stylesheet (best-effort).
    styles_css = ""
    styles_path = os.path.join(root, "css", "styles.css")
    if os.path.isfile(styles_path):
        try:
            with open(styles_path, "r", encoding="utf-8", errors="replace") as fh:
                styles_css = fh.read()
        except Exception as exc:
            log(f"[stop-hook] could not read css/styles.css: {exc}")

    for rel in html_files:
        abspath = os.path.join(root, rel)
        if not os.path.isfile(abspath):
            continue
        base = os.path.basename(rel)
        try:
            with open(abspath, "r", encoding="utf-8", errors="replace") as fh:
                html = fh.read()
        except Exception as exc:
            log(f"[stop-hook] could not read {rel}: {exc}")
            continue

        # CSS reachable from this page: shared stylesheet + inline <style> blocks.
        page_css = styles_css + "\n" + "\n".join(STYLE_BLOCK_RE.findall(html))
        rules = _parse_css_rules(page_css)

        # Pages with their own inline generic .hidden rule are fully covered.
        if base in SELF_COVERED_HTML or _generic_hidden_present(rules):
            continue

        for tag_name, attrs in TAG_RE.findall(html):
            cm = CLASS_ATTR_RE.search(attrs)
            if not cm:
                continue
            classes = cm.group(1).split()
            if "hidden" not in classes:
                continue
            im = ID_ATTR_RE.search(attrs)
            elem_id = im.group(1).strip() if im else ""
            if not _element_covered(classes, elem_id, rules):
                ident = f"#{elem_id}" if elem_id else ""
                cls_txt = ".".join(c for c in classes if c != "hidden")
                where = f"<{tag_name} class=\"...hidden\" {ident}>".strip()
                findings.append(
                    f"CHECK 2 (.hidden CSS): {rel}: element "
                    f"[{cls_txt or '(no other class)'}{(' ' + ident) if ident else ''}] "
                    f"has the 'hidden' class but no matching CSS rule hides it "
                    f"-> {where}"
                )


# --------------------------------------------------------------------------- #
# CHECK 3 - scope-lock on protected files
# --------------------------------------------------------------------------- #
def check_protected(rel_files, findings):
    for rel in rel_files:
        if rel in PROTECTED:
            findings.append(
                f"CHECK 3 (scope-lock): protected file changed -> {rel} "
                f"(confirm this was intended)"
            )


# --------------------------------------------------------------------------- #
# Substantive-turn detection (gates CHECK 4 and CHECK 5)
# --------------------------------------------------------------------------- #
def is_substantive_turn(rel_files):
    """
    A turn is substantive if any changed file is under js/, under css/, under
    server/, or is an *.html file. Uses the same change set the other checks do.
    """
    for rel in rel_files:
        if rel.startswith("js/") or rel.startswith("css/") or rel.startswith("server/"):
            return True
        if rel.endswith(".html"):
            return True
    return False


# --------------------------------------------------------------------------- #
# CHECK 4 - HANDOFF.md updated on substantive turns
# --------------------------------------------------------------------------- #
def check_handoff(rel_files, substantive, findings):
    if not substantive:
        return
    if HANDOFF_DOC not in rel_files:
        findings.append(
            "CHECK 4 (HANDOFF): code changed but HANDOFF.md was not "
            "updated this turn."
        )


# --------------------------------------------------------------------------- #
# CHECK 5 - COMMAND_LOG.md updated on substantive turns
# --------------------------------------------------------------------------- #
def check_command_log(rel_files, substantive, findings):
    if not substantive:
        return
    if COMMAND_LOG_DOC not in rel_files:
        findings.append(
            "CHECK 5 (COMMAND_LOG): code changed but COMMAND_LOG.md was not "
            "updated this turn."
        )


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def main():
    # (a) Read hook JSON from stdin; loop-guard on stop_hook_active.
    # Read as binary and decode with utf-8-sig so a leading UTF-8 BOM (which
    # some shells, e.g. PowerShell, prepend when piping) is stripped at the
    # byte level. Claude Code itself sends raw JSON without a BOM.
    raw = ""
    try:
        raw = sys.stdin.buffer.read().decode("utf-8-sig", errors="replace")
    except Exception:
        try:
            raw = sys.stdin.read()
        except Exception:
            raw = ""
    data = {}
    if raw.strip():
        try:
            data = json.loads(raw)
        except Exception:
            data = {}
    if data.get("stop_hook_active") is True:
        # Already in a forced continuation - never pile on. Allow immediately.
        sys.exit(0)

    if not shutil.which("git"):
        log("[stop-hook] git not found - skipping all checks (allow).")
        sys.exit(0)

    root = repo_root()
    rel_files = changed_files(root)

    findings = []
    try:
        check_js_syntax(root, rel_files, findings)
        check_hidden_css(root, rel_files, findings)
        check_protected(rel_files, findings)
        substantive = is_substantive_turn(rel_files)
        check_handoff(rel_files, substantive, findings)
        check_command_log(rel_files, substantive, findings)
    except Exception as exc:
        # Never let a check crash the session.
        log(f"[stop-hook] internal error during checks (allow): {exc}")
        sys.exit(0)

    if findings:
        header = f"Stop-hook checks found {len(findings)} issue(s) - WARN ONLY, not blocking:"
        print(f"[stop-hook WARN] {header}", file=sys.stderr)
        for i, f in enumerate(findings, 1):
            print(f"[stop-hook WARN]   {i}. {f}", file=sys.stderr)
        # --------------------------------------------------------------- #
        # WARN-ONLY: we have findings but we still allow the stop.
        # To make this hook BLOCK on findings later, change the exit code
        # on the next line from 0 to 2 (stderr above becomes the reason).
        # --------------------------------------------------------------- #
        sys.exit(0)  ###<<< FLIP-TO-BLOCK >>>### change 0 -> 2 to enable blocking

    log("[stop-hook] all checks passed")
    sys.exit(0)


if __name__ == "__main__":
    # Absolute outer guard: the hook must never block on its own failure.
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        print(f"[stop-hook] unexpected failure (allow): {exc}")
        sys.exit(0)

# Harden the protected-paths lock (repo-root resolution)

Branch: claude/slack-session-vgynce
Requested by Russell on 2026-10-21

> BRANCH NOTE: lead.md's PLAN lane specifies `agent/<short-name>`, but this session is pinned to `claude/slack-session-vgynce` ("never push to a different branch without explicit permission"). Pushed here per that mandate. See Questions #1.

## Context / why
During PR #5 (coach move numbers), the builder edited the protected file `js/analysis.js` and the in-session PreToolUse hook (`.claude/hooks/protect_paths.js`) did NOT block it; only GitHub's server-side PR rule caught it. Triage found the cause: the hook computes the repo root as `CLAUDE_PROJECT_DIR || input.cwd || process.cwd()` (protect_paths.js:55). In cloud sessions `CLAUDE_PROJECT_DIR` is UNSET and the working directory is the repo's PARENT (`/home/user`, repo at `/home/user/chess-lab`). The edit target then normalizes to `chess-lab/js/analysis.js`, which fails the exact-string match against the protected entry `js/analysis.js`, so the hook exits 0 (allow). A wrong root also silently degrades to a weaker hardcoded fallback list (protect_paths.js:70-73), and the settings.json command `node "$CLAUDE_PROJECT_DIR/.claude/hooks/protect_paths.js"` can't even locate the script when the var is unset.

## What you'll be able to see and click
(Safety-infra change — no browser UI. Verified by the tester via the self-check + test suite.)
1. In a cloud session (CLAUDE_CODE_REMOTE=true), a builder attempting to Edit `js/analysis.js` is blocked with `[protect-paths] BLOCKED` — regardless of the session's working directory (parent folder or a subfolder) and whether CLAUDE_PROJECT_DIR is set.
2. The same block holds when the target lives in a second checkout/clone/worktree of the repo.
3. At the start of every BUILD, the builder runs a canary self-check: a no-op Edit on a file under `.claude/hooks/` returns `[protect-paths] BLOCKED`. Anything else => the Lead stops and reports [NEEDS YOU] before any code is written.
4. The tester can still save screenshots under `/tmp` (not blocked).
5. `node tests/run-all.js` passes, including the new cases.

## Impact map
Touches:
- `.claude/hooks/protect_paths.js` (PROTECTED) — root resolution (line 55), protected-list load (line 68), fallback list (70-73); add `__dirname` anchor + per-target checkout walk-up.
- `.claude/settings.json` (PROTECTED) — command string. BOTH the PreToolUse and the Stop command strings change.
- `.claude/hooks/protect_canary.txt` (PROTECTED folder) — NEW canary file.
- `.claude/agents/builder.md` (PROTECTED) — startup self-check exception (under `# Before you write any code`, ~line 14).
- `.claude/team/lead.md` (PROTECTED) — BUILD-lane self-check trigger (top of `## BUILD`, ~line 41).
- `tests/protect_paths.test.js` (PROTECTED) — new cases + a cwd/env-controlling runner variant.
- `.claude/hooks/run_stop_hook.js` (PROTECTED) — Stop-hook script/root resolution (requirement 6).
- `tests/pr_rules.js` (PROTECTED) — approval-line check must reject the `<date>` placeholder and require a real YYYY-MM-DD (requirement 7).
- `tests/pr_rules.test.js` (PROTECTED) — new cases for placeholder-fails / real-date-passes (requirement 7).

Used by:
- `protect_paths.js` runs as the PreToolUse hook (via settings.json) on EVERY Edit/Write/MultiEdit/NotebookEdit/Bash/PowerShell from any restricted agent, and is spawned by `tests/protect_paths.test.js`. The root-resolution change affects all agent edits repo-wide.
- `settings.json` is read by the Claude Code harness at session start.
- `builder.md` / `lead.md` are read by those agents on every run.

Could break:
- The 30+ existing `protect_paths.test.js` cases (they set `CLAUDE_PROJECT_DIR=ROOT`, `cwd=ROOT`). With `HOOK_ROOT` derived from `__dirname` (= ROOT in that harness), root is unchanged for them, so they should still pass. Protected by: run-all.js stays green (existing + new).
- Russell's local UNrestricted main session (gate exits 0 at line 52). Must stay unaffected. Protected by: existing test 18 + the gate is untouched.
- settings.json wrapper portability on local Windows. Protected by: the restricted gate only matters in the Linux cloud; local is unrestricted and exits early. See Question #3.
- The builder's hard "never edit protected paths" rule vs. the new canary exception — the exception must be so narrow it can't become a loophole. Protected by: it names the exact canary file, the exact old_string, and the expected BLOCK, and routes every other result to a stop.

Protected by (summary): the new requirement-5 tests + the existing suite + the startup canary self-check itself.

## Design (maps to the 5 requirements)
1. Repo root from the hook's own file location. In protect_paths.js derive `const HOOK_ROOT = path.resolve(__dirname, '..', '..');` (CommonJS — `__dirname` is available) and use it to load `protected-paths.txt` and as the baseline root, replacing `CLAUDE_PROJECT_DIR || input.cwd || process.cwd()` (line 55) and the `path.join(root, ...)` at line 68. If HOOK_ROOT's protected-paths.txt is missing, keep a fallback but make it the FULL current list (not the weaker 5-entry one), and emit a warning when remote.
2. Per-target checkout match. For each edited target, resolve to absolute and walk UP its directory chain to the nearest dir containing `.claude/protected-paths.txt` (its owning checkout); compute the target's path relative to THAT root and match against THAT checkout's list. Block if EITHER the HOOK_ROOT list OR the target's-checkout list matches. A target owned by no checkout (e.g. `/tmp`) stays allowed.
3. settings.json command robust to unset CLAUDE_PROJECT_DIR + parent-folder cwd, using a CROSS-PLATFORM NODE RESOLVER (NOT an `sh -c` wrapper, so Russell's local Windows sessions are unaffected). The PreToolUse command runs `node` with a small resolver (e.g. an inline `node -e` program, or a tiny resolver the command points at) that: searches `process.env.CLAUDE_PROJECT_DIR`, `process.cwd()`, and the immediate subdirectories of `process.cwd()` for `.claude/hooks/protect_paths.js`; on the first match, spawns node on it forwarding this process's stdin and exiting with the child's exit code (so a block=2 propagates faithfully); if none is found AND `CLAUDE_CODE_REMOTE` is 'true', prints a `[protect-paths] BLOCKED: hook script not found` note and exits 2 (fail CLOSED in the cloud); otherwise exits 0. Pure Node so behavior is identical on Windows and Linux. Matcher unchanged (`Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell`).
4. Startup self-check (canary). Add `.claude/hooks/protect_canary.txt` (inside the protected `.claude/hooks/` folder). In builder.md, under `# Before you write any code`, add an explicit NARROW exception: as the first step of every build, attempt exactly one no-op Edit on `.claude/hooks/protect_canary.txt` with old_string `HOOK_SELFCHECK_DOES_NOT_EXIST` (the ONLY permitted Edit at a protected path); expected result is `[protect-paths] BLOCKED`; a "string not found" error, a module/hook error, or a success all mean STOP and tell the Lead — write no code. In lead.md, at the top of the `## BUILD` lane (before step 3a), add: first have the builder run this self-check; if it does not return `[protect-paths] BLOCKED`, STOP and report [NEEDS YOU] — the lock is not working; do not start the build.
5. Tests (added to the PROTECTED tests/protect_paths.test.js so they stay locked). Add a runner variant in that file that controls `cwd` and `CLAUDE_PROJECT_DIR` (the existing `run()` hardcodes both to ROOT). New cases — all absolute-path builder Edits of `js/analysis.js`, expect BLOCK:
   - cwd = repo PARENT, CLAUDE_PROJECT_DIR unset
   - cwd = a repo SUBFOLDER, CLAUDE_PROJECT_DIR unset
   - cwd = repo root, CLAUDE_PROJECT_DIR pointing at the PARENT
   - second checkout: build a temp dir (under the scratchpad) containing `.claude/protected-paths.txt` + `js/analysis.js`, target it, expect BLOCK, then clean up
   - tester Edit/Write of `/tmp/shot.png` => ALLOW (and keep the existing Bash screenshot case)
   All existing cases must stay green.
6. Fix the Stop hook's identical bug. `.claude/hooks/run_stop_hook.js` (and its settings.json Stop command) resolve the script/root the same broken way. Apply the same fixes: the Stop command uses the same cross-platform node resolver pattern to locate `run_stop_hook.js` when CLAUDE_PROJECT_DIR is unset and the session starts in the parent folder, and run_stop_hook.js resolves what it needs from its own `__dirname` rather than CLAUDE_PROJECT_DIR/cwd. (The Stop hook is warn-only, so on not-found it should still not block — exit 0 — but it must actually run.)
7. Tighten `tests/pr_rules.js` so the template placeholder does NOT count as approval. The approval check must reject the literal placeholder `APPROVED by Russell on <date>` and require a real date in `YYYY-MM-DD` form immediately after `on` (e.g. `APPROVED by Russell on 2026-10-22: ...`). Add tests in `tests/pr_rules.test.js` proving (a) a task file whose only approval line is the literal `<date>` placeholder FAILS the rule, and (b) a task file with a real `YYYY-MM-DD` approval line PASSES.

## Not changing
- No app code (js/*, server/, HTML, CSS). Safety-system only.
- chess.js / stockfish.js vendored files.
- The content of protected-paths.txt (only HOW the list is located changes, not the list).
- The CONTENT of the protected-paths list and pr_rules' other checks (only the approval-date strictness changes in pr_rules).

## Questions for you (answered 2026-10-22)
Answers (Russell, 2026-10-22):
1. Branch: keep `claude/slack-session-vgynce`.
2. Stop hook: YES — fix its identical bug in this same PR (requirement 6).
3. settings.json: use a CROSS-PLATFORM NODE RESOLVER, not an `sh` wrapper (requirement 3), so local Windows sessions are unaffected.
4. Canary file `.claude/hooks/protect_canary.txt`: approved.
5. NEW: tighten `tests/pr_rules.js` so the `<date>` placeholder is not accepted as approval — require a real YYYY-MM-DD, with tests (requirement 7).

## Approval
(The Lead adds "APPROVED by Russell on <date>: <quote>" here only when Russell approves in the Slack thread.)
APPROVED by Russell on 2026-10-22: "approved, build claude/slack-session-vgynce" — answers: keep claude/slack-session-vgynce; fix the Stop hook's identical bug in this same PR; use a cross-platform node resolver (not sh); protect_canary.txt approved; and tighten tests/pr_rules.js so the "<date>" placeholder does not count as approval (require a real YYYY-MM-DD), with tests.

## Verdicts
- code-reviewer: <PASS/FAIL/ESCALATE> (commit <id>)
- chess-reviewer: <PASS/FAIL/ESCALATE, or N/A with the reason> (commit <id>)
- tester: <PASS/PARTIAL/FAIL> (commit <id>)

## Log
- 2026-10-21: Plan created from the protected-paths triage. Pushed to claude/slack-session-vgynce. Awaiting Russell's approval + the protected-change label.
- 2026-10-22: Russell approved and answered the 4 questions; added requirement 7 (pr_rules.js approval-date strictness) and requirement 6 (Stop-hook fix). Build starting.

## Retrospective
(filled at end of build)

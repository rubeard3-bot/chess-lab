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
- `.claude/settings.json` (PROTECTED) — PreToolUse command string.
- `.claude/hooks/protect_canary.txt` (PROTECTED folder) — NEW canary file.
- `.claude/agents/builder.md` (PROTECTED) — startup self-check exception (under `# Before you write any code`, ~line 14).
- `.claude/team/lead.md` (PROTECTED) — BUILD-lane self-check trigger (top of `## BUILD`, ~line 41).
- `tests/protect_paths.test.js` (PROTECTED) — new cases + a cwd/env-controlling runner variant.

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
3. settings.json command robust to unset CLAUDE_PROJECT_DIR + parent-folder cwd. Replace the command with a wrapper that locates the script (try `$CLAUDE_PROJECT_DIR/.claude/hooks/protect_paths.js`, then `$PWD/.claude/hooks/protect_paths.js`, then immediate subdirs `$PWD/*/.claude/hooks/protect_paths.js`), `exec`s node on the first found (stdin passes through; exit code preserved), and if none is found AND `CLAUDE_CODE_REMOTE=true` prints a `[protect-paths] BLOCKED` note and exits 2 (fail CLOSED in the cloud); if not remote, exits 0. Matcher unchanged (`Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell`).
4. Startup self-check (canary). Add `.claude/hooks/protect_canary.txt` (inside the protected `.claude/hooks/` folder). In builder.md, under `# Before you write any code`, add an explicit NARROW exception: as the first step of every build, attempt exactly one no-op Edit on `.claude/hooks/protect_canary.txt` with old_string `HOOK_SELFCHECK_DOES_NOT_EXIST` (the ONLY permitted Edit at a protected path); expected result is `[protect-paths] BLOCKED`; a "string not found" error, a module/hook error, or a success all mean STOP and tell the Lead — write no code. In lead.md, at the top of the `## BUILD` lane (before step 3a), add: first have the builder run this self-check; if it does not return `[protect-paths] BLOCKED`, STOP and report [NEEDS YOU] — the lock is not working; do not start the build.
5. Tests (added to the PROTECTED tests/protect_paths.test.js so they stay locked). Add a runner variant in that file that controls `cwd` and `CLAUDE_PROJECT_DIR` (the existing `run()` hardcodes both to ROOT). New cases — all absolute-path builder Edits of `js/analysis.js`, expect BLOCK:
   - cwd = repo PARENT, CLAUDE_PROJECT_DIR unset
   - cwd = a repo SUBFOLDER, CLAUDE_PROJECT_DIR unset
   - cwd = repo root, CLAUDE_PROJECT_DIR pointing at the PARENT
   - second checkout: build a temp dir (under the scratchpad) containing `.claude/protected-paths.txt` + `js/analysis.js`, target it, expect BLOCK, then clean up
   - tester Edit/Write of `/tmp/shot.png` => ALLOW (and keep the existing Bash screenshot case)
   All existing cases must stay green.

## Not changing
- No app code (js/*, server/, HTML, CSS). Safety-system only.
- chess.js / stockfish.js vendored files.
- The Stop hook (`run_stop_hook.js`) command — it has the SAME CLAUDE_PROJECT_DIR bug (this warn-only hook likely no-ops in the cloud today). Flagged as Question #2; not fixed here unless Russell says so.
- The content of protected-paths.txt (only HOW the list is located changes, not the list).

## Questions for you
1. Branch: keep the session-pinned `claude/slack-session-vgynce` (where this is pushed), or recreate as `agent/protect-paths-root` per lead.md's convention?
2. The Stop hook (`run_stop_hook.js`) has the identical root-resolution bug. Fix it in THIS same PR (same __dirname + wrapper approach) or leave it to a separate task?
3. OK to use a POSIX `sh -c` search wrapper in settings.json (works in the Linux cloud where the restricted gate matters; harmless on your local Windows main session, which is unrestricted and exits early)? Or do you want a cross-platform node-based resolver?
4. Canary file name OK as `.claude/hooks/protect_canary.txt`?

## Approval
(The Lead adds "APPROVED by Russell on <date>: <quote>" here only when Russell approves in the Slack thread.)

## Verdicts
- code-reviewer: <PASS/FAIL/ESCALATE> (commit <id>)
- chess-reviewer: <PASS/FAIL/ESCALATE, or N/A with the reason> (commit <id>)
- tester: <PASS/PARTIAL/FAIL> (commit <id>)

## Log
- 2026-10-21: Plan created from the protected-paths triage. Pushed to claude/slack-session-vgynce. Awaiting Russell's approval + the protected-change label.

## Retrospective
(filled at end of build)

# Command Log

> Append-only log of prompts given to Claude Code, newest at the bottom.
> One entry per prompt, with a timestamp. Created per the Conventions in CLAUDE.md.

---

### 2026-06-04 09:29:31 -0500
Restructure the freshly-generated baseline CLAUDE.md into the primary project doc:
fold in memory.md's durable context and put standing Conventions at the very top so
they fire every turn. Requested structure (top→bottom): (1) Conventions (MANDATORY) —
log every prompt to COMMAND_LOG.md with a timestamp each turn; ask clarifying
questions as they arise during a task, not batched to the end, plus a final
"any questions?" check; append a dated entry to HANDOFF.md every turn; keep the
"Current State" section under ~40,000 chars and prune when it grows. (2) Project
Overview. (3) Tech Stack & Architecture. (4) Design System. (5) Memory System Rules
(non-negotiable). (6) Current State. (7) Backlog / Next Steps. Then: reduce memory.md
to a deprecated pointer (or delete) without losing any durable context — capture it
all in CLAUDE.md first and show the plan before deleting; leave HANDOFF.md as the
running dated log; create COMMAND_LOG.md if missing. Hard constraints: docs only, no
app code changes; lose no durable context; verify architecture details against the
actual code and flag any inaccuracies. When done: show the full CLAUDE.md, report
what was done with memory.md and confirm no durable context lost, confirm no app code
changed, append the dated HANDOFF.md entry, and ask any clarifying questions.

## 2026-06-04
Add two new checks to the existing Stop hook (.claude/hooks/verify_stop.py). Keep the
hook in WARN-ONLY mode — all checks (existing and new) print findings but always exit 0;
do not flip to blocking. Add CHECK 4 (HANDOFF.md updated on substantive turns) and CHECK 5
(COMMAND_LOG.md updated on substantive turns). Define a "substantive turn" as any changed
file (staged/unstaged/untracked) under js/, css/, server/, or matching *.html — using the
hook's existing changed-files gathering; non-substantive turns must not fire CHECK 4/5.
Respect the stop_hook_active loop-guard, stay fail-safe (exit 0 on any error), update the
top-of-file comment block, and keep the single flip-to-block line. Only modify the hook
script (not app code or settings.json). Test the three cases (docs updated / not updated /
non-substantive) and confirm exit 0 everywhere. Per conventions, this substantive turn also
appends a dated HANDOFF.md entry and logs this prompt.

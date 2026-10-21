# Task: Correct move numbers in coach text (+ "You played" label fix)

Branch: agent/coach-move-numbers
Requested by Russell on 2026-10-20: "plan: coach writes wrong move numbers (e.g. 11.Bc4 for the Opera Game when Bc4 is actually move 6), and the analyzer labels every move 'You played' even opponent moves — fix both"

- Date: 2026-10-20
- Requested by: Russell (Slack #chesslab-agents)
- Slack thread: https://chesslab-team.slack.com/archives/C0CAKDHCKB6/p1792525066732959

## Context / Problem
The analyzer coach prompt (`js/analysis.js`) hands Claude only a 1-based `ply` half-move index plus SAN — never a real chess move number. Claude performs the ply-to-move arithmetic itself in prose and nothing verifies it, so it wrote "11.Bc4" for the Opera Game when Bc4 was actually move 6. Those wrong numbers persist into saved games and flow to My Report, Recommendations, the study plan, and the dashboard card. Separately, the analyzer move-detail card labels every move "You played", even the opponent's moves.

## Decisions (from Russell, 2026-10-20)
- Opening "left theory / you played / theory says" fields are OUT of this PR — deferred to a follow-up that fixes the Opening Explorer and adds a `masters` mode to the Railway proxy. Do NOT build on the direct unauthenticated Lichess route.
- Repair in place: only replace a move number when the SAN written next to it identifies exactly ONE move in the game; otherwise remove the number. Log every repair — nothing changes silently.
- Run the same check at DISPLAY time so already-saved games, recommendations, the study plan, and the dashboard card show correct numbers WITHOUT rewriting saved games.
- Split: this PR = move labels + validation/repair + "You played" fix. Branch `agent/coach-move-numbers`.
- Confirmed by Russell 2026-10-20: handle recommendations / study plan / dashboard / memory narrative at DISPLAY time only in this PR. The recommendations prompt source fix (which already changes `server/` for the `masters` mode) is deferred to the follow-up PR.

## Scope
IN:
1. Feed real move labels ("6. Bc4" / "6... Nf6") to the analyzer coach prompt.
2. New non-protected validation/repair module.
3. Save-time repair before `Storage.saveGame`.
4. Display-time repair everywhere coach text is shown (covers already-saved games without rewriting them).
5. Fix the "You played" label so opponent moves are labelled correctly.

OUT (follow-up PR): opening fields, server `masters` mode, Opening Explorer fix, and the recommendations prompt source fix.

## What you'll be able to see and click
- [ ] Load a game with a known wrong coach move number (e.g. the Opera Game "11.Bc4") — the analyzer move-detail card shows the corrected number ("6.Bc4").
- [ ] The analyzer Report tab (full report / coach summary) shows corrected move numbers.
- [ ] My Recommendations (overall assessment, top weaknesses, opening report, study plan, coach message, examples) shows corrected move numbers.
- [ ] The dashboard weakness card on the home page shows corrected move numbers.
- [ ] Opponent moves in the analyzer move-detail card read "Opponent played:" instead of "You played".

## Impact map
<Found by searching the WHOLE repository, not just the files being edited.>

GENERATED (where coach text is produced):
- `js/analysis.js:208-275` `callClaude()` /api/analyze prompt — per-move explanations keyed by `ply`; opening fields. PROTECTED. **EDIT this PR** (add `moveLabel` + prompt rule; opening fields left untouched). Needs the `protected-change` label.
- `server/index.js:160-174` `buildGamesSummary` + prompt `:259` — recommendations prompt forwards ply-based moves + opening deviations and asks Claude for `examples[].move` free text. PROTECTED (`server/`). **NOT edited this PR** — recommendations handled at display time. Source fix deferred to the follow-up PR; flagged to Russell.
- `js/memory.js` — Claude narrative fields (`title`/`narrativeDescription`/`commonMistake`/`verdict`) may embed move numbers. PROTECTED. **NOT edited** — memory-derived text is shown via the `csa_recommendations` overlay and is covered by display-time repair on recs/dashboard. Flagged to Russell.

SHOWN (where coach text is displayed):
- `js/ui.js:429,481-484` `renderMoveDetail` per-move explanation. EDIT: display-time repair.
- `js/ui.js:473,478` "You played" labels (the bug). EDIT: gate on `moveData.color === playerColor`.
- `js/ui.js:999,1006` `renderNextSteps` (opening — deferred; still repair any coach move numbers passing through).
- `js/ui.js:1036-1041` `renderFullReport`/`renderCoachSummary` (Report tab). EDIT: display-time repair.
- `js/ui.js:1154,1167` coach-chat context builder — already rebuilds numbers correctly from `ply`; no change.
- `recommendations.html:463,478,481-482,489-490,495,512` overallAssessment / topWeaknesses / opening report / study plan / coachMessage / examples `e.move`. EDIT: display-time repair (examples carry `gameId` → validate against that game's saved analysis).
- `index.html:451-454,536-537` dashboard weakness card. EDIT: display-time repair.

STORED (bad numbers land here today — NOT rewritten by this PR):
- `csa_game_<id>.analysis.moves[].explanation`, `.analysis.summary.*`
- `csa_recommendations` (+ backups), `csa_recommendations_meta`
- memory keys (narrative fields)

- Touches: `js/analysis.js` `callClaude()` prompt (add `moveLabel`); new `js/move-validation.js`; `js/app.js` save path; `js/ui.js` `renderMoveDetail`/`renderFullReport`/`renderCoachSummary` + "You played"/"Opponent played" labels; `recommendations.js`/`recommendations.html`; `index.html` dashboard card; script-tag order on `analyzer.html`, `recommendations.html`, `index.html`.
- Used by: analyzer (analyzer.html → app.js/ui.js), My Recommendations (recommendations.html/js), dashboard (index.html), save path (storage.js via app.js). Coach-chat context builder reads `ply` directly and is unchanged.
- Could break: analyzer coach text rendering, Report tab, Recommendations rendering, dashboard weakness card, game save, script load order on three pages.
- Protected by: new `tests/move_validation.test.js` (pure-function parity + repair + Opera case + the number-preservation cases below), a new test for the "You played"/"Opponent played" color gate, `python3 tests/ci_checks.py` and `node tests/run-all.js` green, and the tester's regression pass over the entry pages.

PROTECTED FILES NEEDED THIS PR: `js/analysis.js` ONLY (needs the `protected-change` label). `server/index.js` and `js/memory.js` are listed as generation sites but are NOT edited this PR (handled at display time).

## Design
New `js/move-validation.js` (non-protected, Node-testable like `js/phase-accuracy.js`):
- `plyToMoveLabel(ply, san)` → "6. Bc4" / "6... Nf6" (`Math.ceil(ply/2)`, odd ply = White). Mirrors the existing ad-hoc logic at `js/ui.js:1154` and `js/explore.js:340`.
- `movePlayerLabel(moverColor, playerColor)` → returns the label text ("You played:" when `moverColor === playerColor`, else "Opponent played:"). PURE function, exported from `js/move-validation.js` so Node tests can call it directly (ui.js cannot be loaded in Node because its IIFE touches `document`). `ui.js` calls `movePlayerLabel(...)` at the "You played" sites instead of inlining the decision.
- `buildMoveIndex(verboseHistory)` → SAN → [plies] map for a game.
- `repairCoachText(text, moveIndex)` → scan move-number tokens (number followed by `.`/`...` then a SAN, and "move N (SAN)" forms); for each, if the adjacent SAN maps to exactly one ply, replace the number with the correct move number; if ambiguous or the SAN is absent, remove the number; return `{ text, repairs: [...] }`.
- Number-preservation guarantee: the repair MUST NOT alter numbers that are not move references — accuracy percentages (e.g. "53%"), evaluations (e.g. "+1.5", "-0.45"), centipawn values, and plain counts (e.g. "3 blunders") must be left untouched. Only numbers bound to a move-number token form (a number directly adjacent to `.`/`...` + SAN, or an explicit "move N (SAN)" form) are candidates for repair.
- Every repair is logged (console + a capped repair log) so nothing changes silently.

Wiring:
- `js/analysis.js`: add `moveLabel: plyToMoveLabel(m.ply, m.san)` (computed inline — the protected file must not depend on the new module) to `movesForPrompt`; add a RULE: "Refer to each move only by the provided label (e.g. '6. Bc4'); never compute your own move numbers."
- Save-time: `app.js` runs repair over `fullAnalysis.moves[].explanation` and `summary.*` before `Storage.saveGame`, logging repairs.
- Display-time: `ui.js` routes explanation/report text through repair using the current game's `verboseHistory`; `recommendations.js`/`.html` repair recs text (examples validated against their `gameId`'s saved game); `index.html` repairs the dashboard card.
- "You played": gate labels at `js/ui.js:473,478` via `movePlayerLabel(moveData.color, playerColor)`; else "Opponent played:" (reuse `youName`/`oppName` from `js/ui.js:96-97,250-254` if clean).
- Load order: add `js/move-validation.js` before `ui.js`/`app.js` on `analyzer.html`, and load it on `recommendations.html` and `index.html` (follow the `js/phase-accuracy.js` script-tag precedent).

## Tests
- `tests/move_validation.test.js`: `plyToMoveLabel` parity; repair replaces unique-SAN numbers, strips ambiguous ones, logs every repair; the Opera "11.Bc4" → "6.Bc4" case.
- Number-preservation tests: assert `repairCoachText` leaves accuracy percentages ("53%"), evaluations ("+1.5", "-0.45"), centipawn values, and plain counts ("3 blunders") untouched — only move-number tokens are changed.
- A test calling `movePlayerLabel(moverColor, playerColor)` directly (pure function) to lock the "You played:" / "Opponent played:" color gate.
- `python3 tests/ci_checks.py` and `node tests/run-all.js` must be green.

## Verification
- Run `python3 tests/ci_checks.py` + `node tests/run-all.js`.
- Serve locally (`python -m http.server 8000`), load a game with a known wrong number; confirm the analyzer card, Report tab, Recommendations, study plan, and dashboard card all show corrected numbers, and opponent moves read "Opponent played".
- Record code-reviewer, chess-reviewer, and tester verdicts below.

## Not changing
- Opening "left theory / you played / theory says" fields (deferred follow-up PR).
- `server/index.js` recommendations prompt (handled at display time; source fix deferred to the follow-up PR that adds the `masters` mode).
- `js/memory.js` narrative fields (covered via display-time repair on the `csa_recommendations` overlay).
- The coach-chat context builder (`js/ui.js:1154,1167`) — already rebuilds numbers correctly from `ply`.
- Saved games are NOT rewritten; display-time repair covers already-saved data.

## Questions for you
- Resolved 2026-10-20: Russell confirmed display-time-only handling for recommendations / study plan / dashboard / memory narrative is acceptable for this PR; the recommendations prompt source fix (which changes `server/` for the `masters` mode and needs a Railway redeploy) is deferred to the follow-up PR.

## Approval
APPROVED by Russell on 2026-10-20: "approved, build agent/coach-move-numbers"

## Verdicts
<The Lead pastes each agent's FINAL verdict here, with the commit it reviewed. GitHub blocks the pull request until all three lines are filled in.>
- code-reviewer: PENDING
- chess-reviewer: PENDING
- tester: PENDING

## Log
- 2026-10-20 Lead: plan written.
- 2026-10-20 Lead: approved by Russell; task file conformed to TEMPLATE.md.
- 2026-10-21 Builder: built the change.
  - NEW `js/move-validation.js` (non-protected, dual-export IIFE like `js/phase-accuracy.js`): `plyToMoveLabel`, `buildMoveIndex`, `repairCoachText`, `movePlayerLabel`, `logRepairs`. `repairCoachText` touches ONLY move-reference tokens (two shapes: `N.`/`N...`+SAN and `move N`+SAN); corrects a unique-SAN number to `ceil(ply/2)`, strips ambiguous/absent ones (SAN kept), and strip-only when the index is null/empty. Case-sensitive SAN matcher so percentages/evals/counts are never touched. Idempotent (already-correct numbers unchanged, not logged).
  - Save-time repair in `js/app.js` (in the Claude `.then`, before the game is persisted): builds the moveIndex from `parsed.verboseHistory`, repairs `fullAnalysis.moves[].explanation` + `summary.*` string fields, logs `save:<gameId>`. Only the game being saved — no rewrite of existing games.
  - Display-time repair in `js/ui.js`: builds `_moveIndex` once per game in `renderMoveList`; `renderMoveDetail` repairs the per-move explanation (`display:moveDetail`) and now labels via `MoveValidation.movePlayerLabel(moveData.color, playerColor)` at BOTH sites (the "You played" bug); `renderCoachSummary` repairs strength/weakness/pattern (`display:report`). No-op when no game loaded (never strips valid analyzer numbers).
  - Display-time repair in `recommendations.html`: per-example cards repaired against their own game's index (`recGameMoveIndex` built from the saved game's classified moves, cached); cross-game prose (overallAssessment, weakness descriptions, repertoireAssessment, opening commonMistake, study-plan focus/activities, string examples, coachMessage) repaired strip-only. Logged `display:recs`.
  - Display-time repair in `index.html` dashboard: weakness chip name + today's-focus description/studyPlan repaired strip-only (`display:dashboard`).
  - `js/analysis.js` (PROTECTED): edit SUCCEEDED — the protect hook did NOT block the Edit in this environment. Added `moveLabel` (computed INLINE, no MoveValidation import) to `movesForPrompt` and a prompt RULE: "Refer to each move only by its provided `moveLabel` ...; never compute or invent your own move numbers." Opening block (bookedUntil/youPlayed/theorySays) left unchanged. NOTE: this change needs Russell's `protected-change` label on the PR.
  - Load order: `<script src="js/move-validation.js">` added before `ui.js` on `analyzer.html`, and loaded on `recommendations.html` and `index.html` before the scripts that use it.
  - NEW `tests/move_validation.test.js` (auto-discovered by `tests/run-all.js`, which enumerates `*.test.js` — no registration edit needed). Covers plyToMoveLabel parity, the Opera `11.Bc4`->`6.Bc4` case (+1 repair logged), ambiguous->strip, absent->strip, strip-only mode, the six NUMBER-PRESERVATION cases (unchanged, zero repairs), and the movePlayerLabel color gate in both vocabularies.
  - Tests: `python3 tests/ci_checks.py` -> "Checked 36 files / PASS". `node tests/run-all.js` -> "5/5 test files passed" (new test's 48 checks all PASS; accuracy-golden, phase-accuracy, pr_rules, protect_paths unaffected). `node --check` clean on every changed JS file.
  - Not touched: `js/storage.js`, `js/memory.js`, `server/`, `tests/fixtures/`, `tests/run-all.js`, `.claude/`. CLAUDE.md not edited.

## Retrospective
- What went wrong or was slow:
- What to do differently:
- Who should remember it:

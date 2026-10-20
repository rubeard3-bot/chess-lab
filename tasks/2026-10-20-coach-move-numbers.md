# Task: Correct move numbers in coach text (+ "You played" label fix)

- Branch: `agent/coach-move-numbers`
- Date: 2026-10-20
- Requested by: Russell (Slack #chesslab-agents)
- Slack thread: https://chesslab-team.slack.com/archives/C0CAKDHCKB6/p1792525066732959
- Status: PLAN — awaiting approval. Do NOT build until Russell replies: `approved, build agent/coach-move-numbers`.

## Context / Problem
The analyzer coach prompt (`js/analysis.js`) hands Claude only a 1-based `ply` half-move index plus SAN — never a real chess move number. Claude performs the ply-to-move arithmetic itself in prose and nothing verifies it, so it wrote "11.Bc4" for the Opera Game when Bc4 was actually move 6. Those wrong numbers persist into saved games and flow to My Report, Recommendations, the study plan, and the dashboard card. Separately, the analyzer move-detail card labels every move "You played", even the opponent's moves.

## Decisions (from Russell, 2026-10-20)
- Opening "left theory / you played / theory says" fields are OUT of this PR — deferred to a follow-up that fixes the Opening Explorer and adds a `masters` mode to the Railway proxy. Do NOT build on the direct unauthenticated Lichess route.
- Repair in place: only replace a move number when the SAN written next to it identifies exactly ONE move in the game; otherwise remove the number. Log every repair — nothing changes silently.
- Run the same check at DISPLAY time so already-saved games, recommendations, the study plan, and the dashboard card show correct numbers WITHOUT rewriting saved games.
- Split: this PR = move labels + validation/repair + "You played" fix. Branch `agent/coach-move-numbers`.

## Scope
IN:
1. Feed real move labels ("6. Bc4" / "6... Nf6") to the analyzer coach prompt.
2. New non-protected validation/repair module.
3. Save-time repair before `Storage.saveGame`.
4. Display-time repair everywhere coach text is shown (covers already-saved games without rewriting them).
5. Fix the "You played" label so opponent moves are labelled correctly.

OUT (follow-up PR): opening fields, server `masters` mode, Opening Explorer fix.

## Impact map — every place coach text is GENERATED or SHOWN
GENERATED:
- `js/analysis.js:208-275` `callClaude()` /api/analyze prompt — per-move explanations keyed by `ply`; opening fields. PROTECTED. **EDIT this PR** (add `moveLabel` + prompt rule; opening fields left untouched). Needs the `protected-change` label.
- `server/index.js:160-174` `buildGamesSummary` + prompt `:259` — recommendations prompt forwards ply-based moves + opening deviations and asks Claude for `examples[].move` free text. PROTECTED (`server/`). **NOT edited this PR** — recommendations handled at display time. Source fix deferred; flagged to Russell.
- `js/memory.js` — Claude narrative fields (`title`/`narrativeDescription`/`commonMistake`/`verdict`) may embed move numbers. PROTECTED. **NOT edited** — memory-derived text is shown via the `csa_recommendations` overlay and is covered by display-time repair on recs/dashboard. Flagged to Russell.

SHOWN:
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

PROTECTED FILES NEEDED THIS PR: `js/analysis.js` ONLY (needs the `protected-change` label). `server/index.js` and `js/memory.js` are listed as generation sites but are NOT edited this PR (handled at display time).
>>> OPEN QUESTION FOR RUSSELL: confirm display-time-only handling for recommendations / study plan / dashboard / memory narrative is acceptable, OR say if you want the recommendations prompt fixed at source (adds `server/index.js` — protected + a Railway redeploy). <<<

## Design
New `js/move-validation.js` (non-protected, Node-testable like `js/phase-accuracy.js`):
- `plyToMoveLabel(ply, san)` → "6. Bc4" / "6... Nf6" (`Math.ceil(ply/2)`, odd ply = White). Mirrors the existing ad-hoc logic at `js/ui.js:1154` and `js/explore.js:340`.
- `buildMoveIndex(verboseHistory)` → SAN → [plies] map for a game.
- `repairCoachText(text, moveIndex)` → scan move-number tokens (number followed by `.`/`...` then a SAN, and "move N (SAN)" forms); for each, if the adjacent SAN maps to exactly one ply, replace the number with the correct move number; if ambiguous or the SAN is absent, remove the number; return `{ text, repairs: [...] }`.
- Every repair is logged (console + a capped repair log) so nothing changes silently.

Wiring:
- `js/analysis.js`: add `moveLabel: plyToMoveLabel(m.ply, m.san)` (computed inline — the protected file must not depend on the new module) to `movesForPrompt`; add a RULE: "Refer to each move only by the provided label (e.g. '6. Bc4'); never compute your own move numbers."
- Save-time: `app.js` runs repair over `fullAnalysis.moves[].explanation` and `summary.*` before `Storage.saveGame`, logging repairs.
- Display-time: `ui.js` routes explanation/report text through repair using the current game's `verboseHistory`; `recommendations.js`/`.html` repair recs text (examples validated against their `gameId`'s saved game); `index.html` repairs the dashboard card.
- "You played": gate labels at `js/ui.js:473,478` on `moveData.color === playerColor`; else "Opponent played:" (reuse `youName`/`oppName` from `js/ui.js:96-97,250-254` if clean).
- Load order: add `js/move-validation.js` before `ui.js`/`app.js` on `analyzer.html`, and load it on `recommendations.html` and `index.html` (follow the `js/phase-accuracy.js` script-tag precedent).

## Tests
- `tests/move_validation.test.js`: `plyToMoveLabel` parity; repair replaces unique-SAN numbers, strips ambiguous ones, logs every repair; the Opera "11.Bc4" → "6.Bc4" case.
- A test covering the "You played" / "Opponent played" color gate.
- `python3 tests/ci_checks.py` and `node tests/run-all.js` must be green.

## Verification
- Run `python3 tests/ci_checks.py` + `node tests/run-all.js`.
- Serve locally (`python -m http.server 8000`), load a game with a known wrong number; confirm the analyzer card, Report tab, Recommendations, study plan, and dashboard card all show corrected numbers, and opponent moves read "Opponent played".
- Record code-reviewer, chess-reviewer, and tester verdicts below.

## Reviews (filled in after build)
- code-reviewer: _pending_
- chess-reviewer: _pending_
- tester: _pending_

## Approval
- [ ] APPROVED by Russell — pending

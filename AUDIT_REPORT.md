# Chess Lab — Codebase Audit
2026-05-27

## Executive summary

The codebase is in **good overall health** for a one-person, no-build, vanilla-JS project of its size (~27k lines across ~25 files). The Memory System is the standout: it's defensively built, with 30+ sanity checks, repair functions, and an audit log that catches Claude fabrications convincingly. The Stockfish serial queue in Play the Coach is also genuinely well-designed.

The biggest real concerns are **silent navigation bugs** (the `csa_review_game_id` sessionStorage flow is broken end-to-end — every "Review last game" / "Recent games row click" on the dashboard lands the user on an empty analyzer), **documentation drift** (handoff.md/memory.md disagree with the code on several keys and on Weakness Drill's status), and **substantial code duplication** between the four practice-board modes (≈1,800 lines of near-identical board rendering boilerplate).

There are zero **CRITICAL** findings — no secret leaks, no data corruption paths, no broken security boundaries. Most issues are cleanup/maintainability rather than correctness. A handful of `localStorage` keys are written but never read; a handful of helper functions exist but are never called. These are easy wins, not emergencies.

Code quality is uneven by section: storage.js, analysis.js, engine.js, board.js, nav.js are small and clean; ui.js, app.js, memory.js are large but follow consistent patterns inside themselves; practice-board.js (4324 lines, four IIFEs) is where most of the duplication lives.

---

## Severity legend
- **CRITICAL**: broken, data-loss risk, or security exposure — fix ASAP
- **HIGH**: real bug or significant fragility — fix soon
- **MEDIUM**: redundancy, poor pattern, maintainability — fix when convenient
- **LOW**: cosmetic, style, nice-to-have

---

## Findings by severity

### CRITICAL
*None.*

---

### HIGH

#### H1. "Review last game" / Recent-games review buttons silently broken
- **Files:** `index.html:564-571`, `index.html:736-742`, `index.html:744-751`; `js/app.js:29-31, 58-77`
- **Issue:** All three click handlers do `sessionStorage.setItem('csa_review_game_id', 'csa_game_'+id); window.location.href = 'analyzer.html'`. But `app.js:init()` only reads the game id from `?gameId=` URL params (`getGameIdFromUrl`) — it never reads the `csa_review_game_id` sessionStorage key. So clicking lands on a blank analyzer with the game picker showing instead of the chosen game.
- **Why it matters:** This is the primary "jump back into a game" affordance on the dashboard. Users click it expecting their game and silently get the wrong page.
- **Suggested fix:** In `app.js:init()`, after the `gameId` URL-param check, also fall back to reading `sessionStorage.getItem('csa_review_game_id')`, strip the `csa_game_` prefix, then `removeItem` it and load. *Alternatively* change the three index.html handlers to navigate to `analyzer.html?gameId=<id>`.

#### H2. Free Play "Done" button discards real game state
- **File:** `js/practice-board.js:531-565`
- **Issue:** The Set-Position "Done" button rebuilds a FEN by serializing piece placement and **always** appends `' w - - 0 1'`, regardless of whose turn it actually was, what castling rights remain, en-passant square, halfmove clock, or move number. If the user opens Set Position mid-game, even just to peek, then clicks Done, the game is silently restarted from move 1 as White with no castling rights.
- **Why it matters:** Silent destruction of game state with no warning. The "moveHist = []" reset on line 561 confirms it's losing the move history too.
- **Suggested fix:** Preserve the existing turn/castling/en-passant/halfmove/fullmove from `chess.fen()` and only replace the board portion. Or only run this code path when the user actually placed/removed pieces in Set Position mode.

#### H3. Dead `_partialFailure` check on raw Response object
- **File:** `js/recommendations.js:70-79`
- **Issue:** After a non-OK fetch, the code checks `if (response._partialFailure)` — but `response` is a `Response` object that never has that property. The intended `_partialFailure` field is on the JSON body (handled correctly at line 83 on the success path). The check at line 73 can never fire, so the `rec-parse-error` event for partial server errors is never dispatched on the failure branch.
- **Why it matters:** Server-side partial failures with `!response.ok` produce no toast; user just sees the rec disappear silently.
- **Suggested fix:** Either remove the dead check entirely, or first `await response.json().catch(()=>null)` and read `_partialFailure` from the parsed body.

#### H4. `Recommendations.generateRecommendations()` sort is a no-op on ISO strings
- **File:** `js/recommendations.js:58`
- **Issue:** `games.sort((a,b) => (b.savedAt || 0) - (a.savedAt || 0))` subtracts ISO date strings, which coerces to `NaN`. The compare returns `NaN` for every pair so the sort is unstable and effectively does nothing.
- **Why it matters:** Currently harmless because `Storage.loadAllGames()` (`js/storage.js:41`) already sorts descending by `savedAt.localeCompare`. But this is silent fragility — if Storage stops sorting, the `.slice(0, 10)` here would pick the wrong 10 games and `recommendations` would lose recent-game signal without anyone noticing.
- **Suggested fix:** Either trust Storage's sort and remove the re-sort, or change to `(b.savedAt || '').localeCompare(a.savedAt || '')`.

#### H5. Memory never updates when the recommendations server call fails
- **File:** `js/recommendations.js:62-115`
- **Issue:** `ChessLabMemory.update('manual_regenerate')` is fired *inside* the success branch of the `/api/recommendations` POST, **after** `csa_recommendations` is written. If the server call fails (rate limit, 500, network), `Recommendations.generateRecommendations()` throws and the memory update never runs — yet the new games are sitting in `csa_game_*` and the memory subsystem is the right place to record them.
- **Why it matters:** A long-running rate-limit episode can leave memory's `activeGames` arbitrarily out of sync with the actual saved games. The "no silent degradation" memory principle is violated here: nothing surfaces to the user.
- **Suggested fix:** Call `ChessLabMemory.update()` independently of (or in `finally` after) the rec generation. Memory's own logic already detects new games via `enumerateGames()` and handles the no-op case.

---

### MEDIUM

#### M1. Documentation says Weakness Drill is "coming soon"; it's actually fully implemented
- **Files:** `memory.md:189` (`Step 1 done, Phase 4 Weakness Drill - shipped` is in handoff but contradicts the memory.md "queued" line in another spot); `handoff.md:34, 250-251, 779-781`; `js/practice-board.js:3179-4324`
- **Issue:** Both docs describe the Weakness Drill as a `pb-view-weakness` shell with a "coming soon" message. The code, however, contains ~1100 lines implementing a full drill with real-moments sourcing, AI-generated positions, Stockfish eval-based "close vs significant" classification, session history, streak tracking, and a per-weakness breakdown screen. handoff.md:35 even lists "Phase 4 Weakness Drill — shipped" but elsewhere on lines 250 and 779 describes it as a coming-soon shell.
- **Why it matters:** Future-Claude and any new contributor will be operating from a wrong mental model of what's built and what's not. The handoff is the canonical handoff doc; it shouldn't contradict itself.
- **Suggested fix:** Update handoff.md sections 4 (Practice Board views) and 10 (Pending) to describe the actual Weakness Drill that exists. Update memory.md if it has similar references.

#### M2. Several documented localStorage keys are written but never read
- **Files:** `profile.html` (writes), search results across `js/` and `*.html` (no reads found)
- **Keys affected:**
  - `pf_show_engine_lines` — written `profile.html:866`, read only in `profile.html:609` to restore the toggle UI. No code anywhere actually checks it to decide whether to show engine lines.
  - `pf_explanation_depth` — written `profile.html:842`, read only in `profile.html:590` for UI restore. Not consumed.
  - `pf_practice_side` — written `profile.html:843`, read only `profile.html:591` for UI restore. Not consumed.
  - `pf_experience` — written `profile.html:830`, read `profile.html:585, 1104`. Used in profile only, not surfaced to Claude prompts.
  - `pf_show_hints` — appears in `handoff.md:592` and `handoff.md:313` but **never read or written anywhere in code**. Documented key doesn't exist.
- **Why it matters:** Settings UI gives the impression of taking effect; none of them do. Either wire them up or remove the toggles.
- **Suggested fix:** Decide per key — drop the UI control, or actually consume the value where appropriate (e.g., `pf_show_engine_lines` should gate the engine-line display in the analyzer/move-detail panel).

#### M3. Documentation/code mismatch on coach settings keys
- **Files:** `handoff.md:587, 593`, `profile.html:196-200, 841`, `js/practice-board.js:1599, 1699, 2434, 2524, 2728, 2912, 3663, 3882`
- **Issue:** handoff.md lists `pf_coach_name` and `pf_coach_style` in the localStorage schema. The actual code uses `pf_coach_tone`. There is no `pf_coach_name` field anywhere in the profile UI; there is no `pf_coach_style` write anywhere. Additionally profile.html stores tone as kebab-case (`encouraging`, `direct`, `tough-love`) while practice-board's prompts assume Title-Case labels (`Encouraging`, `Direct`, `Tough love`). Claude will tolerate both, but consistency is lost.
- **Why it matters:** The schema docs are a primary onboarding reference. Wrong keys here cause grep failures and design confusion.
- **Suggested fix:** Update handoff.md `pf_coach_name` → drop; `pf_coach_style` → `pf_coach_tone`. Normalise the stored value to Title-Case at write time (or at read time).

#### M4. `csa_api_key` + `Storage.getApiKey/setApiKey` are vestigial
- **File:** `js/storage.js:3-12, 64`
- **Issue:** `API_KEY_KEY = 'csa_api_key'` plus `getApiKey()` / `setApiKey()` are defined and exported. Grep finds no callers. `app.js:setupApiKeyModal()` is explicitly a `/* no-op */` stub (lines 235-237). This is leftover from the old client-side-key era — the key now lives only on Railway.
- **Why it matters:** Suggests the wrong threat model to a reader. A future contributor might add a UI that reads/writes this key client-side, undoing the Railway-key-isolation invariant.
- **Suggested fix:** Remove `API_KEY_KEY`, `getApiKey`, `setApiKey` from storage.js, remove `setupApiKeyModal()` and its call from app.js, and remove the "Settings / API Key" footer button from the nav drawer.

#### M5. `pf_accent_color` saved but never applied (known)
- **Files:** `profile.html:594, 855`; no application site.
- **Issue:** Documented in handoff.md:43 as a known low-severity bug. The chosen colour is persisted and used to highlight the active swatch on the profile page, but never written to the `--accent` CSS custom property or any equivalent.
- **Why it matters:** Setting visibly does nothing. Either ship it or remove it.
- **Suggested fix:** On every page load (e.g., in `nav.js` or a shared bootstrap script), read `pf_accent_color` and `document.documentElement.style.setProperty('--accent', value)`. Or hide the control until accent is wired through styles.css.

#### M6. `practice_fen` sessionStorage set but never read
- **File:** `js/ui.js:1023-1027`
- **Issue:** `_goToPractice()` reads `az_critical_fen` and writes it as `practice_fen`, then navigates to practice.html. But practice.html / practice-board.js never read `practice_fen` — they read `csa_opening_line` (set by openings.js). The "Set up critical position" link on the analyzer's Next Steps card therefore navigates to practice but doesn't carry the position.
- **Why it matters:** Broken "send to practice" affordance. UI suggests it works.
- **Suggested fix:** Either wire practice-board.js Free Play to read `practice_fen` (parse → seed `chess`), or change `_goToPractice()` to write `csa_opening_line` in the shape openings → practice already supports.

#### M7. `csa_recommendations_meta` partial / inconsistent vs `csa_recommendations`
- **Files:** `js/recommendations.js:92-96`, `js/memory.js:1247-1257`
- **Issue:** `Recommendations.generateRecommendations` writes both `csa_recommendations` and `csa_recommendations_meta` together. But `ChessLabMemory.writeLegacyRecs()` writes only `csa_recommendations` (overlay-merging `topWeaknesses` and `openingReport.openings`), never touches `csa_recommendations_meta`. So after a memory-only update (no rec call), the rec page's "shouldRegenerate" check, which uses `meta.gameCount`, won't reflect that recs effectively changed.
- **Why it matters:** Stale-banner can mis-fire or fail to fire in the memory-only path. Low-impact today because both currently fire together, but Step 4 of the memory plan ("Switch source from 3-call flow to memory") will rely on this.
- **Suggested fix:** Either have `writeLegacyRecs` update the meta too (gameCount = active games or total), or document the boundary explicitly.

#### M8. Sum-of-classification check (Check18) breaks if two weaknesses share a classification
- **Files:** `js/memory.js:497-502, 502-504, 773-791`
- **Issue:** `repairOccurrenceCounts` rewrites every weakness's `activeOccurrences` and `historicalOccurrences` to **the full classification total** for its `stockfishClassification`. The comment on line 499-502 acknowledges that "if multiple weaknesses share the same stockfishClassification, each receives the full classification total, which will cause Check18 to fire (sum × N > ceiling)."
- **Why it matters:** Schema brittleness: the system silently breaks if Claude ever returns two weaknesses with the same classification (e.g., two distinct blunder patterns). Validation throws "Sum of historicalOccurrences for blunder exceeds actual count" and the entire update is rejected.
- **Suggested fix:** Add a sanity check at the start of `repairOccurrenceCounts` that detects duplicate classifications, picks one (most-occurring / largest active count) to receive the full total, and zeros the rest — *or* split the total proportionally based on Claude-returned ratios. Document the choice.

#### M9. `repairOccurrenceCounts` doesn't update `firstSeen`/`lastSeen` to match recalculated counts
- **File:** `js/memory.js:535-557`
- **Issue:** After `repairOccurrenceCounts` rewrites counts, the `firstSeen` and `lastSeen` are only fixed by `repairFirstSeenDates` (which runs before, not after). If a count was healed from "low" to "high" because new games matched the classification, those new dates aren't reflected in `lastSeen`.
- **Why it matters:** Narrative drift over time — `lastSeen` lies about how recently the pattern actually appeared.
- **Suggested fix:** Run `repairFirstSeenDates` and a symmetric `repairLastSeenDates` *after* `repairOccurrenceCounts`, since occurrence counts are the ground truth and dates should follow.

#### M10. `reset()` clears `autoBackupMem` but not `autoBackupRecs`
- **File:** `js/memory.js:1687-1706`
- **Issue:** `reset()` removes memory, history, audit, autoBackupMem, and resets health — but leaves `csa_recommendations_autobackup` (`KEY.autoBackupRecs`) in localStorage. The audit message says "csa_recommendations and csa_game_* preserved", which is true, but doesn't acknowledge `autoBackupRecs` is also preserved.
- **Why it matters:** Inconsistent reset semantics. After a reset, restoring from auto-backup will silently rehydrate `csa_recommendations` from a stale snapshot that no longer matches the (now-empty) memory.
- **Suggested fix:** Remove `autoBackupRecs` in `reset()` to match `autoBackupMem`. Or explicitly document the asymmetry if it's intentional.

#### M11. `lastFullRegenerate` never advances during normal updates
- **File:** `js/memory.js:1424-1430`
- **Issue:** `metadata.lastFullRegenerate` is only updated when `trigger === 'force_full_regenerate'`. No code path ever uses that trigger string — recommendations.js fires `update('manual_regenerate')`, init fires nothing, page loads fire nothing. So `lastFullRegenerate` stays frozen at `createdAt` forever, and `updatesSinceFullRegenerate` increments without bound.
- **Why it matters:** Dead instrumentation — never observable in audit log, never tells you when a full regenerate happened (because none ever has).
- **Suggested fix:** Either delete the `lastFullRegenerate` / `updatesSinceFullRegenerate` pair, or actually wire up a force-regenerate trigger (Profile button, periodic auto-trigger after N updates).

#### M12. `wdGeneratePosition` asks Claude to fabricate Stockfish numbers
- **File:** `js/practice-board.js:3880-3936`
- **Issue:** The Weakness Drill asks Claude to generate a FEN + bestMove + `evalBeforeMove` value. The legality of `bestMove` is validated; `evalBeforeMove` is **not** — it's just `pos.evalBeforeMove` trusted blindly and later compared against a real Stockfish eval to decide "wrong_close vs wrong_significant" (line 3546-3549). This violates the memory-system principle "Stockfish is the source of truth for chess facts; Claude writes narrative only."
- **Why it matters:** A fabricated `evalBeforeMove` skews the close/significant classification, which the user sees as coach feedback. Per the same principle that drives the memory checks, this should be re-eval'd by Stockfish.
- **Suggested fix:** Drop `evalBeforeMove` from the Claude prompt; run `wdEvalPosition(pos.fen)` immediately after legality check and store the result as `evalBeforeMove`.

#### M13. Openings.html bypasses the Railway Lichess proxy
- **File:** `js/openings.js:6-7, 435-447`
- **Issue:** `MASTERS_EP` and `PLAYERS_EP` point directly at `explorer.lichess.ovh`. handoff.md:97 and the "Lichess API 401 fix" build note explicitly say *all* Lichess explorer calls go through the Railway proxy. Practice-board.js Opening Drill does proxy via Railway (line 1849-1851); openings.js does not.
- **Why it matters:** Two inconsistent paths to the same upstream. Direct calls have no Bearer token (rate-limited harder), no rate limit on the proxy side, and no central observability. If Lichess starts rejecting unauthenticated explorer traffic, openings.html breaks while Opening Drill keeps working.
- **Suggested fix:** Route openings.js through the Railway proxy too. Add a `MASTERS` query mode to `/api/lichess-explorer` (currently it only forwards to `/lichess`, not `/masters`).

#### M14. `openings.js` has no localhost SERVER_URL fallback
- **File:** `js/openings.js:5`
- **Issue:** `const RAILWAY = 'https://chess-lab-production.up.railway.app';` — hardcoded. Every other file (analysis.js, recommendations.js, ui.js, practice-board.js IIFEs) has the `location.hostname === 'localhost' ? 'http://localhost:4000' : production` pattern. Local dev with a localhost backend still hits the production `/api/theory` from this page.
- **Why it matters:** Diverges from the documented "Claude Code Prompt Patterns Learned" in handoff.md:744-751. Inconsistent dev experience.
- **Suggested fix:** Use the shared SERVER_URL pattern.

#### M15. Repeated full localStorage scans for game count
- **File:** `js/ui.js:856`, also `js/ui.js:920-929` (`_loadRecentGames`)
- **Issue:** `renderCoachSummary` does `Object.keys(localStorage).filter(k => k.startsWith('csa_game_')).length` to compute the "game number" label. Below, `_loadRecentGames` re-implements `Storage.loadAllGames()` logic (lines 920-929) instead of calling it.
- **Why it matters:** Multiple redundant O(N) scans of localStorage per game-load. With 50-game cap it's cheap, but it's also pointless duplication.
- **Suggested fix:** Use `Storage.loadAllGames().length` for the count and `Storage.loadAllGames().slice(0,10)` in `_loadRecentGames`. Storage's sort is cached-friendly.

#### M16. Up/down arrows in renderVsAverage compare against possibly-null
- **File:** `js/ui.js:902-905`
- **Issue:** `c.up = thisBlund < avgBlund` etc., where `avgBlund` may be `null` if no historic data passes the filter. `0 < null` is `false`, so the down arrow gets shown even when the user has the better metric.
- **Why it matters:** Minor visual lie when there's insufficient history. Misleading at the moment users most need accurate feedback (early-stage).
- **Suggested fix:** Guard each `c.up` with `avg != null && ...`; otherwise render a neutral indicator or omit the arrow.

#### M17. Substantial board-rendering duplication in practice-board.js
- **File:** `js/practice-board.js` (Free Play, Coach, Opening Drill, Weakness Drill — four IIFEs)
- **Issue:** Each of the four practice modes has its own near-identical copy of: piece URLs, piece-Image cache, `loadXImg()`, coord helpers (`SqToRC`, `RcToSq`, `canvasToSq`, `sqCenter`), `drawSquares`, `drawHighlights`, `drawSelected`, `drawDots`, `drawPieces`, `drawCoords`, promotion modal logic. board.js and openings.js have yet two more variants. Conservatively ~1,800 lines duplicated.
- **Why it matters:** Any bug fix or feature change to board rendering must be made in 4-6 places. The duplication is the single biggest maintainability liability in the codebase.
- **Suggested fix:** Extract a shared `BoardRender({px, flipped, onClick})` helper that returns `{render, setHighlights, setHintArrow, ...}`. Keep state local to each mode but share the draw logic. This is a medium-effort refactor.

#### M18. `pf_coach_tone` casing mismatch between writer and reader
- **Files:** `profile.html:196-200` (writes `'encouraging'`, `'direct'`, `'tough-love'`); `js/practice-board.js:1599 etc.` (defaults to `'Direct'`, prompts say `'Encouraging'`/`'Tough love'`).
- **Issue:** profile.html stores kebab-case lowercase values; practice-board.js prompts mix Title-Case labels with raw kebab interpolation.
- **Why it matters:** Claude is robust to this so user-visible impact is small, but the prompt template doesn't say what you'd think it does on actual data.
- **Suggested fix:** Canonicalise at the read site: `const tone = ({encouraging:'Encouraging', direct:'Direct', 'tough-love':'Tough love'})[lsGet('pf_coach_tone')] || 'Direct';`

---

### LOW

#### L1. Empty / placeholder functions that look meaningful
- `js/app.js:237` — `setupApiKeyModal() { /* no-op */ }`
- `js/app.js:243-247` — `setupNewGameBtn()` is empty with a comment
- `js/ui.js:798-801` — `_renderPhaseAccuracy()` is a no-op stub with a comment that points to `renderReport()` (no function by that name in the file)
- `js/ui.js:1336` — `renderGameNotes() { /* superseded */ }`
- `js/chess.js` has 0 newlines (one giant minified line — fine, but `wc -l` shows 0 which is misleading)
- Suggested fix: delete or fold into the call sites.

#### L2. Verbose console.log statements left in production code
- `js/openings.js:626, 657, 701, 712, 721, 725` — `console.log('[Openings] Canvas clicked at square:'...)` and many similar
- `js/recommendations.js:48, 55, 68, 72, 84, 90`
- `js/memory.js:` (a few warn/log lines, mostly intentional for the audit narrative)
- Suggested fix: gate verbose logs behind a `if (window.CHESS_LAB_DEBUG)` flag or remove.

#### L3. Many CSS class prefixes coexist; not always clean
- `pb-coach-*` (Play the Coach) vs `pb-od-coach-*` (Opening Drill coach panel) vs `pb-wd-coach-*` (Weakness Drill coach card) all in the same page. A typo `pb-coach-result` instead of `pb-wd-coach-result` is silently ignored.
- Suggested fix: when refactoring board rendering, also pull the coach-card styles to a single prefix.

#### L4. TODO comment left in memory.js
- `js/memory.js:428-431` — "TODO (fabrication audit): openings.gamesPlayed/wins/draws/losses/avgAccuracy are also numeric facts Claude generates..."
- Suggested fix: track it as a real follow-up; the comment is accurate and worth doing.

#### L5. Study-streak label is misleading (known)
- `index.html:649-661` — counts **unique calendar days in last 30 days** but labels as "Study streak" / "days active". A user who plays 7 random days in a month sees streak = 7, but they're not consecutive.
- Suggested fix: rename to "Days active (30d)" or compute actual consecutive-day streak.

#### L6. `_isGameAnalyzed` PGN-trim comparison is brittle
- `js/app.js:362-375` — falls back to `s.pgn.trim() === ccGame.pgn.trim()`. Different newline styles or trailing annotations from chess.com produce false negatives → duplicate analyses.
- Suggested fix: normalise more aggressively (collapse whitespace runs) or rely on the (W, B, Date) tuple match only.

#### L7. PGN header regex doesn't handle escaped quotes
- `js/app.js:380` — `^\[(\w+)\s+"([^"]*)"\]` rejects values containing `"`. Chess.com PGNs sometimes have escaped quotes (`\"`). Edge case — rare.
- Suggested fix: switch to a tolerant header parser, or note the limitation.

#### L8. innerHTML usage — most call sites escape, a few rely on trusted input
- 123 `innerHTML =` occurrences across the codebase. Sampled audit: `archive.html`, `recommendations.html`, `ui.js` use `escapeHtml`/`esc` consistently. The risky cases are where Claude responses or other server-controlled text are concatenated into `.innerHTML`:
  - `ui.js:866-871` (renderCoachSummary) — `escapeHtml` is applied to `strength`/`weakness`/`pattern`. ✓
  - `ui.js:914-916` (renderVsAverage cell) — `escapeHtml` applied. ✓
  - `index.html:675` — hardcoded literal string with an `<a>` tag. ✓
  - Most other innerHTML calls insert template literals with `escape`/`esc` applied to data inputs.
- Not a finding for now, but **innerHTML count is high enough that adding one unsafe site is likely**. A grep before each new feature is wise.

#### L9. chess.js v0.10.3 dependency drift
- `handoff.md` correctly warns against upgrading. The local minified copy is in `js/chess.js`; some pages use the CDN `chess.min.js@0.10.3`. If unpkg ever serves a different version, behaviour silently changes on those pages.
- Suggested fix: vendor `chess.min.js` locally too; remove CDN dependency.

#### L10. `tone` default values differ across drills
- `js/practice-board.js:1599` defaults to `'Direct'`; `js/practice-board.js:3663, 3882` default to `'Encouraging'`. Same setting, different defaults for the same user.
- Suggested fix: one default.

#### L11. `cBestMoveSan` reconstructs the position by replaying history
- `js/practice-board.js:1425-1434` — Replays the entire `chess.history()` minus one move on every call to convert the last engine bestmove to SAN. With ~40 plies this is fine but it grows linearly per move; for long games this is wasteful.
- Suggested fix: cache the "pre-user-move" FEN on `cDoMove` and use that directly.

#### L12. `pb_opening_drill_scores` schema split across two writers
- Older format (`js/openings.js:1028-1035`): `{correct, wrong, lastDrilled, eco}` keyed by line key
- Newer format (`js/practice-board.js:3014-3029`): `{<openingName>: {<side>: {bestStreak, totalAttempts, lastDate}}}` — completely different shape, same key.
- Both writers happily clobber the other. Whichever pages user visits last wins.
- Suggested fix: pick one schema, migrate the other, or split into two keys (`csa_opening_trainer_scores` vs `pb_opening_drill_scores`).

#### L13. `chesscom.js` has no caching
- All `fetchPlayerProfile`/`fetchRecentGames` calls bypass the browser HTTP cache by not setting any cache-related headers; Chess.com is generally cacheable.
- Suggested fix: rely on default cache-control; harmless to leave.

#### L14. SETUP.md is out of date
- `SETUP.md` instructs the user to download Stockfish manually from a third-party fork URL. `js/stockfish.js` and `js/stockfish.wasm` are already committed (~7MB wasm). The setup step is redundant.
- Suggested fix: rewrite SETUP.md to describe the current "push to main, GH Pages deploys" flow.

#### L15. analyzer.py at repo root is from the v1 Flask era
- `analyzer.py`, `analyzer.html` (the old one), `report.html`, `report.md`, `templates/`, `static/`, `__pycache__/`, `requirements.txt`, plus a `Russell horrible game.pdf` and a `Kulio54_vs_russelll1234578_2026.04.28.pgn` are all leftovers from v1.
- Suggested fix: archive them outside the repo or move to a `legacy/` subdirectory; right now they sit alongside live code and create grep noise.

---

## Findings by category

### 1. Broken or dead code
H1, H3, M2 (`pf_show_engine_lines`, `pf_explanation_depth`, `pf_practice_side`, `pf_show_hints`), M4, M5, M6, M11, L1, L15

### 2. Redundancies and duplication
M15, M17 (the big one), L12 (`pb_opening_drill_scores` schema collision)

### 3. Poorly written or fragile code
H2 (Free Play Done loses state), H4, M8, M9, L6 (PGN fingerprint), L7 (PGN header regex)

### 4. Consistency issues
M3 (handoff vs code), M13 + M14 (Lichess proxy / SERVER_URL), M18 (tone casing), L10 (default tone differs), L12

### 5. Data integrity risks
H5 (memory drift), M7 (`csa_recommendations_meta`), M10 (reset asymmetry), L12

### 6. Memory system specifically
The 6 principles are mostly enforced. Key gaps:
- Principle 6 ("no silent degradation") is violated by H5 (rec fail → memory skipped).
- Principle 1 ("Stockfish is source of truth") is violated by M12 (Weakness Drill, technically outside memory but the same antipattern).
- M8 (`repairOccurrenceCounts` schema brittleness, acknowledged in code).
- M9 (`lastSeen` not healed after counts are rewritten).
- M10 (reset doesn't clear `autoBackupRecs`).
- M11 (`lastFullRegenerate` dead).
- No place memory writes to `csa_game_*` — verified by grep (only `app.js:714` writes to that prefix, which is the legitimate analyzer save path).

### 7. Security / exposure
No `sk-ant-*` keys, no Bearer tokens, no API secrets in any client-served file (HTML/JS/CSS). Only references are in `analyzer.py` (v1 Flask, server-side, env-var reads) and `server/index.js` (Railway, env-var reads). ✓

### 8. Performance
M15 (repeated localStorage scans). L11 (history replay in cBestMoveSan). Otherwise fine for the 50-game cap.

### 9. Documentation / maintainability
M1 (Weakness Drill stale docs), M3 (key names wrong), L4 (TODO), L14 (SETUP.md outdated)

---

## What's actually good

These are deliberately well-built — don't touch them without a reason:

- **Stockfish serial command queue in Play the Coach** (`js/practice-board.js:683-1115`). The Promise-chain task queue + per-task FEN guard + auto-recovery on crash is a genuinely good pattern. The bug it fixed (stale bestmove from aborted search mistaken for current) is exactly the kind of thing this defends against.
- **Memory system safeguard layers** (`js/memory.js:295-855`). 30+ named sanity checks, granular failure reasons, repair functions that explicitly distinguish "narrative fields safe to default" from "Stockfish facts NOT safe to default". The architecture and discipline are above the bar for a project this size.
- **`Storage` module** (`js/storage.js`). Small, focused, consistently used. Single source of truth for the `csa_game_*` lifecycle.
- **`Analysis.classifyMoves`** (`js/analysis.js:51-118`). The classification thresholds and the miss-detection logic are in one place, documented, and reused symmetrically between `calculateAccuracy` and `buildAnalysis`.
- **Server CORS + rate limiting** (`server/index.js:13-37, 32-37, 430-435`). Allowlisted origins, global 10/min cap, separate Lichess proxy limiter, no `*` wildcards.
- **`parseResponse` JSON salvage** (`server/index.js:51-83`). Three-tier fallback (strip fences → first/last brace → bracket-patch) for truncated Claude responses is pragmatic.
- **`escapeHtml`/`esc` discipline** in all the dynamic renderers (ui.js, archive.html, recommendations.html, openings.js trouble-spot). Most innerHTML sites are safe.
- **No build step, no framework, no bundler.** Genuinely makes the project legible. The cost is the duplication (M17), but the deploy story is bulletproof.
- **Coaching memory's audit log + health indicator.** Even when something goes wrong, the user (and Claude in future sessions) can see what was rejected and why. This is rare for a personal project.

---

## Recommended action order

Effort scale: **quick** ≈ ≤ 30 min, **medium** ≈ 1–3 h, **large** ≈ half-day+.

1. **H1** — Wire `csa_review_game_id` (or change index.html nav). *quick*.
2. **H2** — Preserve game state in Free Play "Done". *quick*.
3. **H3** — Remove dead `response._partialFailure` branch. *quick*.
4. **H4** — Drop the no-op sort in `Recommendations.generateRecommendations`. *quick*.
5. **M1** — Update handoff.md + memory.md to describe Weakness Drill as shipped, not coming soon. *quick* but high value for future-you.
6. **M2** — Decide per dead key: wire up or remove from the profile UI. *medium*.
7. **M3** — Fix `pf_coach_*` documentation; normalise tone casing. *quick*.
8. **M4** — Delete `getApiKey`/`setApiKey`/`csa_api_key` and the Settings/API Key footer link. *quick*.
9. **M5** — Apply `pf_accent_color` to `--accent` on page load. *quick*.
10. **M6** — Make `_goToPractice` actually deliver the position to practice.html. *quick*.
11. **H5** — Decouple memory update from rec success. *quick to medium*, depending on how much you want to refactor recommendations.js.
12. **M11** — Either wire up force-full-regenerate or delete the dead instrumentation. *quick*.
13. **M10** — Symmetric reset (clear `autoBackupRecs`). *quick*.
14. **M8 + M9** — Tighten the repair functions: dedupe classifications, heal `lastSeen` symmetrically. *medium*.
15. **M12** — Stockfish-eval the generated drill position instead of trusting Claude's number. *quick*.
16. **M13 + M14** — Route openings.js through Railway + adopt the shared SERVER_URL pattern. *medium* (server needs a `masters` query mode added).
17. **M7** — Decide who owns `csa_recommendations_meta`; consider both writers. *quick* once you've decided.
18. **M15** — Cache `Storage.loadAllGames()` once per page load. *quick*.
19. **M16** — Null-guard the up/down arrows in renderVsAverage. *quick*.
20. **L-series cleanup** (verbose logs, empty stubs, SETUP.md, archive v1 files). *quick each*, batch.
21. **M17** — Extract a shared `BoardRender` helper. *large*. Save for a focused refactor session; don't do it as part of any other change. Highest long-term ROI but unrelated to current functionality, so do it last.

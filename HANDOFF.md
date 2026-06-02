# Chess Lab — Handoff

> Master living document. Single source of truth for all future Claude sessions.
> **Updated at the end of every session.** See memory.md for architecture decisions and "why" context.

---

## Last updated
2026-05-27

## Current state
- **Memory System Step 1** — COMPLETE and live, health status "healthy" in production
- **Phase 4 Weakness Drill** — shipped
- **Frontend:** GitHub Pages at chesslab.live (auto-deploys on push to main)
- **Backend:** Railway at chess-lab-production.up.railway.app (auto-deploys on push to main)
- **Memory system:** js/memory.js (~1100+ lines, 8 sections, fully documented)
- No build step — vanilla HTML/CSS/JS pushed directly to Pages

## What was done last session
- Batch 1 audit fixes applied — H1, H2, H3, H4, M6 (memory.js untouched)
  - H1 (app.js init): added `csa_review_game_id` sessionStorage fallback after the `?gameId=` URL-param check; strips the `csa_game_` prefix and removes the key after use
  - H2 (practice-board.js Free Play "Done"): added `setPosDirty` flag — FEN rebuild + move-history wipe now only run when the user actually placed/removed pieces in Set Position mode (Option A from audit)
  - H3 (recommendations.js): removed the unreachable `response._partialFailure` branch on the raw Response object; the success-path body check already covers the real case
  - H4 (recommendations.js): swapped numeric subtraction sort for `localeCompare` on ISO `savedAt` strings
  - M6 (practice-board.js Free Play): now reads `practice_fen` from sessionStorage at init via `chess.load()` (Option B). Existing `csa_opening_line` flow is move-array-based and not a good shape for the analyzer's FEN handoff, so adding a small reader in Free Play was the cleaner fit. `_goToPractice()` in ui.js needed no change.
- Pending from audit: H5 (memory update on rec failure), M1–M5, M7–M18, all L-series. Documentation drift (M1 Weakness Drill "coming soon" wording, M3 `pf_coach_*` key names) still unfixed.

### Previous session
- Performed a full read-only codebase audit — see `AUDIT_REPORT.md`
- 5 HIGH findings, 18 MEDIUM, 15 LOW; zero CRITICAL

### Previous session (Memory System Step 1)
- Built Memory System Step 1 with all 6 design principles and 5 safeguard layers
- Memory segmented into bullet/blitz/rapid buckets, 25-game active cap, 30/60/90-day decay
- Iterated through ~6 rounds of fixes catching Claude fabrications:
  - Empty titles, invalid firstSeen dates, invalid trend/severity enums, trend value fabrication, occurrence count undercounting
  - API timeout (bumped to 60s)
  - reset() not clearing audit/history/health/autobackup
- Built self-heal functions: repairFirstSeenDates, repairNarrativeFields, repairTrendValues, repairOccurrenceCounts
- Verified end to end: memory processes real games, self-heals fabrications, health shows "healthy"

## Next steps (priority order)
1. **Review AUDIT_REPORT.md** and decide which findings to act on (start with the 5 HIGH)
2. **Step 2 (no-code):** Live with memory 1–2 weeks, monitor audit log — let real games accumulate, no code changes
3. **Step 3:** Surface trends in UI — total games analyzed per bucket, accuracy trend chart, time control selector
4. **Step 4:** Switch recommendations source from 3-call flow to memory (memory becomes the authoritative source)
5. **Step 5:** Deprecate old 3-call generation logic in recommendations.js
6. **Practice Board:** Phase 5 Danger Zone settings, Opening Explorer "Send to Practice" button
7. **Auth/Monetization backlog:** Supabase auth + Stripe (deferred until Memory Step 5 or first paying user)

## Known issues / bugs
| Bug | Severity | Notes |
|-----|----------|-------|
| favicon.ico 404 | Low | Cosmetic |
| "Review last game" broken | Medium | sessionStorage key set in analyzer but never read |
| Study streak label misleading | Low | Says "days in a row" but counts unique days, not consecutive |
| pf_accent_color not applied | Low | Saved to localStorage but never wired to CSS variables |

## How to test current functionality
1. Open chesslab.live → analyze a game
2. Navigate to Profile → scroll to Coaching Memory section
3. Check health indicator in footer (should say "healthy")
4. Profile danger zone → "View Audit Log" → confirm memory update history is present
5. Browser console: `CoachingMemory.getHealth()` → inspect status/checks array for self-heal evidence
6. Profile → Reset Memory → confirm audit/history/health all clear afterward

---

## Technical Reference (sections below are stable — update only when architecture changes)

---

## 1. Live Production

| Item | Value |
|------|-------|
| Frontend URL | https://chesslab.live (canonical) |
| Frontend alt | https://www.chesslab.live |
| GitHub Pages | https://rubeard3-bot.github.io/chess_analyzer/ (legacy, still live) |
| Backend (Railway) | https://chess-lab-production.up.railway.app |
| Git repo | rubeard3-bot/chess_analyzer (GitHub) |
| Git user | rubeard3-bot |
| Deployment | Frontend: GitHub Pages (auto-deploy on push to main). Backend: Railway (auto-deploy on push to main, server/ subdirectory). |
| Backend env vars | `ANTHROPIC_API_KEY`, `LICHESS_API_TOKEN` (set in Railway dashboard) |

The frontend is pure static files — no build step, no bundler. Push to main = live.

---

## 2. Tech Stack

### Frontend
- Vanilla JS, HTML5, CSS3 — no framework, no build system, no npm on the frontend
- Chess logic: chess.js 0.10.3 (CDN `unpkg.com/chess.js@0.10.3/chess.min.js` on most pages; local `js/chess.js` on analyzer.html)
- Board rendering: HTML5 Canvas (no DOM pieces; custom draw functions in each IIFE)
- Stockfish chess engine: Web Worker (`js/stockfish.js`) — UCI protocol over `postMessage`
- All JS files are IIFEs or inline scripts; no ES modules, no imports

### Backend
- Node.js / Express 4.18.2
- `server/index.js` — single file, ~470 lines
- Dependencies: `express`, `cors`, `express-rate-limit`, `node-fetch ^2.7.0` (CommonJS)
- No database — all persistence is client-side localStorage

### AI
- Claude claude-sonnet-4-6 via `https://api.anthropic.com/v1/messages`
- All Claude calls proxied through Railway backend (key never exposed to client)
- anthropic-version header: `2023-06-01`

### External APIs
- Lichess Opening Explorer (`explorer.lichess.ovh/lichess`) — proxied through Railway with Bearer token
- Chess.com public API (`api.chess.com/pub/player/{username}/games/{year}/{month}`) — called direct from client (no auth required)

---

## 3. Design System

### CSS Architecture
- Single stylesheet: `css/styles.css` (shared across all pages)
- Page-specific and component styles are **inline `<style>` blocks** inside each HTML file
- practice.html and openings.html have all their component CSS inline — nothing for those pages is in styles.css beyond the sidebar/nav base
- CSS class naming: page-prefixed (e.g., `az-` for analyzer, `pb-` for practice board, `pf-` for profile, `rec-` for recommendations, `open-` for openings, `db-` for dashboard)

### CSS Custom Properties (defined in `:root`)
```css
--bg:       #1a1a2e   /* page background */
--panel:    #16213e   /* sidebar, panels */
--card:     #0f3460   /* cards, elevated surfaces */
--accent:   #7fa650   /* green — active states, highlights, progress */
--accent2:  #4da8da   /* blue — links, secondary accent, badges */
--danger:   #e05252   /* red — errors, danger zone */
--warn:     #e09952   /* amber — warnings, stale data */
--text:     #e0e0e0   /* primary body text */
--text2:    #c0c0d0   /* secondary/muted text */
--border:   rgba(255,255,255,0.08)
--topbar-h: 110px
--col-left: 520px
--col-mid:  220px
--eval-bar-w: 44px
--radius:   8px
--trans:    0.2s ease
```

Additional muted text colors used inline: `#94a3b8`, `#6b7280`, `#4b5568`

### Background Colors
- `#0d1321` — deepest background, used in `html, body` for index.html, recommendations.html, profile.html
- `#1a1a2e` (--bg) — main background for most layout sections
- `#16213e` (--panel) — sidebar background
- `#0f3460` (--card) — card/panel elevated surfaces

### Typography
- Font stack: `'Segoe UI', system-ui, -apple-system, sans-serif`
- Base font size: 15px
- No icon library — text symbols and Unicode chess pieces where needed

### Board Colors (user-customizable, stored in localStorage)
| Swatch | Light square | Dark square |
|--------|-------------|------------|
| Default | `#dce8f0` | `#7a9ab0` |
| Classic | `#f0d9b5` | `#b58863` |
| Green | `#ffffff` | `#769656` |
| Purple | `#e8e0cc` | `#8877aa` |
| Navy | `#d4e8d4` | `#557799` |

Board colors loaded from localStorage (`pf_board_light`, `pf_board_dark`) into `window.BOARD_LIGHT` / `window.BOARD_DARK` before board scripts run on analyzer.html.

### Accent Colors (user-customizable)
`#3b82f6` (blue, default), `#8b5cf6` (purple), `#10b981` (teal), `#f59e0b` (amber), `#ef4444` (red), `#ec4899` (pink), `#06b6d4` (cyan)

### Sidebar
- Width: 220px (`.db-sidebar` class — used on index, practice, recommendations, profile)
- Contains nav links and user info chip at bottom
- Active nav item highlighted via `.nav-link.active`
- Shared `nav.js` handles active state by matching `location.pathname`

---

## 4. Pages and Features

### index.html — Dashboard
- Body class: `hub-page`
- Layout: `db-layout` with 220px sidebar + flex main; `html, body { height:100%; overflow:hidden }`
- Scripts loaded: `chesscom.js`, `storage.js`, `nav.js` (all inline at bottom)

**Components:**
- Greeting chip: shows `pf_display_name` or "Chess Player"
- Rating trend SVG chart: reads `csa_elo_history` array; draws polyline with SVG
- Today's Focus card: derived from top weakness in `csa_recommendations`
- Stats grid: accuracy (avg from all games), total games, total blunders, study streak (days with ≥1 game analyzed)
- Recent 5 games list: shows players, opening ECO, result, accuracy
- Top 2 weaknesses: from `csa_recommendations.topWeaknesses`
- Openings "Drill" badge: shown on nav when any opening in `csa_opening_scores` has more wrong attempts than correct

### analyzer.html — Game Analyzer
- Body class: `analyzer-page`
- Layout: `az-topbar` (fixed 44px) + `az-tabbar` + `az-body` (left 340px col + right col)
- Scripts (in order): `chess.js` (local), `storage.js`, `board.js`, `engine.js`, `analysis.js`, `recommendations.js`, `nav.js`, `chesscom.js`, `ui.js`, `app.js`
- Board colors pre-loaded before board.js: `window.BOARD_LIGHT`, `window.BOARD_DARK` from localStorage

**Two tabs:**
1. **Game Review** (default): game picker or PGN dropzone, eval graph, board with highlights, move list, move detail pin panel, opening panel (ECO + theory), coach chat multi-turn
2. **My Report**: report card with letter grade circle + phase bars (opening/middlegame/endgame %), coach summary text, vs-average section, error patterns, next steps

**Analysis pipeline (handleAnalyze in app.js):**
1. Phase 1: Stockfish evaluates every position (depth 18) via engine.js
2. Phase 2: classifyMoves() assigns best/excellent/good/miss/inaccuracy/mistake/blunder per move
3. Phase 3: render board, eval graph, move list, opening panel
4. Phase 4 (non-blocking): Claude call for coach summary, patterns, next steps
5. Auto-triggers recommendations regeneration if `pf_auto_recommendations !== 'false'`

**Classification thresholds (analysis.js):**
- ≤1% win-probability loss = excellent
- ≤3% = good
- miss = special case (had a winning tactic, didn't take it)
- ≤7% = inaccuracy
- ≤15% = mistake
- >15% = blunder

**Mass import flow:**
- Reads `csa_import_queue` + `csa_import_index` from sessionStorage
- After each analysis completes, shows 3s countdown then auto-advances to next game
- Clears queue when index reaches end

**Single game review from archive:**
- Reads `csa_review_game_id` from sessionStorage on load
- Loads that specific game directly

### openings.html — Opening Explorer
- Body class: `openings-page`
- Layout: `open-container` → `open-main` (left 420px + right flex)
- Scripts: `chess.min.js` (CDN), `storage.js`, `nav.js`, `openings.js`
- All component CSS is inline `<style>` in the page

**Two modes (pill toggle):**
1. **Explore**: shows top moves from Lichess explorer for current position. Source toggle: Masters / Players 1500–1700. Click move to advance. Flip board button.
2. **Train**: spaced-repetition trainer for 10 built-in openings

**Explore features:**
- Board: 420×420px canvas, `SQ = 52.5`
- Fetches from Railway proxy `/api/lichess-explorer` → `explorer.lichess.ovh/lichess`
- Move list shows: move SAN, games count, white/draw/black win percentages as colored bar
- Navigation: breadcrumb of played moves, back button, flip board

**Trainer (Train mode) — 3 sub-panels:**
- `setup panel`: pick opening from 10 built-ins, pick side (White/Black)
- `drill panel`: play the opening from memory; correct/wrong feedback per move; "Show hint" reveals best move
- `summary panel`: shows final score for session, updates `csa_opening_scores`

**Built-in openings (OPENINGS array in openings.js):**
Caro-Kann, Queen's Gambit, Sicilian, French, KID, Ruy Lopez, Italian, English, London, Nimzo-Indian

### practice.html — Practice Board
- No body class; layout: `pb-layout` (220px sidebar via `db-sidebar` classes + `pb-main`)
- All CSS is inline `<style>` in the page
- Scripts: `chess.min.js` (CDN), `practice-board.js`, inline routing script
- See Section 5 for full deep-dive on all 4 modes

**5 views (show/hide by toggling `display` CSS):**
- `pb-view-landing` — mode selection cards
- `pb-view-free` — Free Play board
- `pb-view-weakness` — Weakness Drill (coming soon shell)
- `pb-view-coach` — Play the Coach board
- `pb-view-opening` — Opening Drill (3 sub-views inside)

**URL routing** (inline script):
- `?mode=free` → shows pb-view-free, initializes Free Play IIFE
- `?mode=coach` → shows pb-view-coach, initializes Play the Coach IIFE
- `?mode=opening` → shows pb-view-opening, initializes Opening Drill IIFE
- `?mode=weakness` → shows pb-view-weakness (coming-soon)
- no param → landing

**Opening line preload** (inline script):
- Reads `csa_opening_line` from sessionStorage
- If present, wraps Chess constructor to start at that FEN, injects banner into free play view
- Allows "practice this line" shortcut from openings.html

**localStorage init** (inline script, runs on every page load):
- `pb_coach_record` → `{wins:0,losses:0,draws:0}` if missing
- `pb_warning_efficacy` → `{shown:0,heeded:0}` if missing
- `pb_opening_drill_scores` → `{}` if missing

### recommendations.html — Recommendations
- Body class: `rec-page`
- Layout: `rec-layout` (220px sidebar + `rec-main`)
- `html, body { height:100%; overflow:hidden }`
- Scripts: `storage.js`, `recommendations.js`, `nav.js`
- All rendering is inline in the HTML file (no separate render JS file)

**7 content sections:**
1. Overall Assessment — free-text paragraph
2. Top Weaknesses — cards with severity badge, frequency, description, study plan, drill list
3. Openings + Phase Analysis — opening repertoire cards + opening/middlegame/endgame score bars
4. Tactical Patterns — pattern cards with occurrences
5. Improvements — positive reinforcement cards
6. Weekly Study Plan — day-by-day schedule table
7. Goals + Coach Message — measurable goals list + personal coach message

**Stale data banner:**
- On page load, calls `Recommendations.shouldRegenerate()`
- If true (game count differs from stored meta), shows yellow banner with "Regenerate" button
- Button calls `Recommendations.generateRecommendations()` then re-renders

**renderRecommendations(data)**: master render function, reads from `csa_recommendations` in localStorage, populates all 7 sections via innerHTML

### archive.html — Game Archive  *(overhauled — adopts analyzer design system)*
- Body class: `archive-page` (now uses the `--az-*` token palette: base `#0d1321`, surface `#111827`)
- **Nav:** replaced the old `.archive-header` + `.hamburger-btn` (☰ glyph) with the analyzer's `.az-topbar` + `.az-hamburger` (3-span icon). The shared `#nav-drawer` markup and `initNav('archive')` are unchanged; "Game Archive" shows active.
- **Summary header:** two minimal stat tiles (`.ga-stat-tile`) — Total Games + Win Rate (wins ÷ total games, draws counted in denominator).
- **View toggle:** Table ⇆ Cards segmented control (`.ga-view-toggle`). Default Table. Persisted in `localStorage['pf_archive_view']` (`'table'` | `'cards'`).
  - Table view: columns Players, Opening, ECO, Result, Accuracy, Blunders, Mistakes, Date, Actions.
  - Card view: responsive grid (`.ga-card-grid`) — opponent + your color dot, opening, result badge, accuracy/blunders/mistakes tiles, date, Review + Delete.
- **Sorting:** clickable table headers (Date, Accuracy, Result, Blunders, Mistakes) — 1st click asc, 2nd toggles desc, active column shows ▲/▼. Default Date desc. Card view has an equivalent `#ga-sort` dropdown (kept in sync with header state).
- **Filters (AND logic, client-side on loaded data):** text search (player/opening), Result (win/loss/draw via `outcome()` from `metadata.result` + `playerColor`), Time control (bullet `<180s` / blitz `180–599s` / rapid `600s+`, parsed from PGN `[TimeControl]` — same logic as memory.js; unparseable → "All" only), Color (`playerColor`), Date range (on `savedAt`), Opening/ECO text, Min Accuracy. Shows "Showing X of Y games" + "Clear filters" button.
- "Review" button: navigates to `analyzer.html?gameId=<id>` (app.js reads `?gameId=` — unchanged, still works).
- "Delete" button: calls `Storage.deleteGame(id)`, removes from in-memory list, re-renders summary + list.
- All CSS lives in a `ga-`-prefixed block appended to styles.css. `js/storage.js` and `js/memory.js` were NOT modified.
- Scripts: `storage.js`, `memory.js`, `nav.js`

### profile.html — Profile & Preferences
- Body class: `pf-page`
- Layout: `pf-layout` (220px sidebar + `pf-main`)
- `html, body { height:100%; overflow:hidden; background:#0d1321 }`
- Left column: settings form with 7 sections
- Right column: coach chat (multi-turn, calls `/api/analyze` with system prompt including user profile)

**Settings sections:**
1. **Identity** — display name (`pf_display_name`)
2. **Chess Profile** — username (`csa_chesscom_username`), current ELO (`csa_elo_current`), goal ELO (`csa_elo_goal`)
3. **Coach Preferences** — coach name (`pf_coach_name`), coaching style (`pf_coach_style`: supportive/analytical/tough)
4. **Board Customization** — light square color (`pf_board_light`), dark square color (`pf_board_dark`) via swatch pickers
5. **App Accent Color** — (`pf_accent_color`) — updates CSS variable `--accent` on selection
6. **Behavior** — `pf_auto_recommendations` toggle (true/false string), `pf_show_hints` toggle
7. **Danger Zone** — "Delete All Games" and "Reset All Settings" — two-click confirmation pattern (button changes text to "Are you sure?" on first click)

**Avatar colors** (6 swatches):
`#1e3a5f`, `#1a3a2a`, `#3a1a2a`, `#2a1a3a`, `#3a2a1a`, `#1a2a3a`

### import.html — Import from Chess.com
- Body class: `import-page`
- Scripts: `storage.js`, `chesscom.js`, `nav.js`
- Fetches all game archives from `api.chess.com/pub/player/{username}/games/archives`
- Filters by time control (Blitz/Rapid/Classical) and result (all/wins/losses)
- PGN hash (djb2 algorithm) detects already-analyzed games; shows "(analyzed)" badge

**Two import modes:**
- **Mass import**: collects selected games into `csa_import_queue` + `csa_import_index = 0` in sessionStorage, navigates to analyzer.html (auto-advance loop handles the rest)
- **Single import**: sets `pending_pgn` + `pending_color` in sessionStorage, navigates to analyzer.html

---

## 5. Practice Board Modes (Deep Detail)

### 5a. Free Play (js/practice-board.js lines 1–641)

Standalone IIFE, runs when `?mode=free`.

**Board constants:**
- `PX = 560`, `SQ = 70` (560×560 canvas)
- Piece images from `https://lichess1.org/assets/piece/cburnett/{color}{piece}.svg`

**State variables:**
- `chess` — chess.js instance
- `selSq` — currently selected square (algebraic) or null
- `legDests` — array of legal destination squares for selected piece
- `lastFrom`, `lastTo` — last move squares (for yellow highlight)
- `bestFrom`, `bestTo` — Stockfish best move squares (for arrow)
- `showBM` — bool: show best move arrow
- `showEB` — bool: show eval bar
- `setPosMode` — bool: set position palette active
- `palSel` — selected piece in set-position palette
- `moveHist` — array of SAN strings (move history panel)
- `pendingPromo` — `{from, to}` when promotion modal is open

**Stockfish state:**
- `sf` — Worker instance
- `sfReady` — bool: 'readyok' received
- `sfBusy` — bool: 'go' command in flight
- `sfSkip` — bool: discard next bestmove (after 'stop')
- `sfTurn` — whose turn engine is evaluating ('w'/'b')
- `sfCp` — centipawn eval (white's perspective)
- `sfMate` — mate-in-N (null if not forced mate)
- `sfMateIn` — ply count for mate

**Stockfish initialization:**
1. `new Worker('js/stockfish.js')`
2. Send `'uci'` → wait for message containing `'uciok'`
3. Send `'setoption name Hash value 32'` + `'isready'`
4. Wait for `'readyok'` → set `sfReady = true`

**`analyze()` function:**
- Sends `'position fen ' + chess.fen()` then `'go depth 18'`
- If `sfBusy`, sends `'stop'` first, sets `sfSkip = true`
- Parses `info` lines for `cp` and `mate` values
- On `bestmove`, extracts `bestFrom`/`bestTo` for arrow, sets `sfBusy = false`

**`render()` call order:**
1. `clearRect`
2. `drawSquares` (board squares with board colors)
3. `drawHighlights` (lastFrom/lastTo yellow, bestFrom/bestTo green if showBM)
4. `drawSelected` (selected square blue tint)
5. `drawDots` (legal move dots/rings)
6. `drawPieces` (SVG images)
7. `drawArrow` (best move arrow if showBM)
8. `drawCoords` (a-h, 1-8 labels)

**Set Position mode:**
- Palette shows K/Q/R/B/N/P for both colors + eraser icon
- Click palette piece → set `palSel`; click board square → place piece
- "Done" button rebuilds FEN string from current piece positions and calls `chess.load(fen)`

**UI controls:**
- Flip board toggle
- Show best move checkbox → `showBM`
- Show eval bar checkbox → `showEB`
- Undo last move button
- New game button
- Set position button → toggle `setPosMode`

### 5b. Play the Coach (js/practice-board.js lines 643–1750+)

IIFE, runs when `?mode=coach`.

**Board constants:**
- `COACH_PX = 480`, `COACH_SQ = 60`
- Board flipped when `cUserColor === 'b'`

**Serial Stockfish command system (prevents race conditions):**
- `cSFTaskQueue`: Promise chain — each task appended via `.then()`
- `cSFPendingReady` / `cSFPendingBest`: resolve references for outstanding responses
- `cSFWaitReady(timeout)` — returns Promise that resolves on 'readyok'
- `cSFRunGo(depth, skill, timeout)` — sets skill level, sends 'go depth N', returns Promise resolving to bestmove string
- `cSFSetPosition(fen)` — sends 'position fen' command
- `cSFAbortInFlight()` — sends 'stop', resolves any pending promise with null
- `cEnqueueSF(task, name)` — appends task to queue; task is an async function

**Difficulty levels (`cDiffConfig(level)`):**
| Level | Depth | Skill |
|-------|-------|-------|
| 20 (Master) | 18 | 20 |
| 15 (Advanced) | 12 | 15 |
| 10 (Intermediate) | 8 | 10 |
| 5 (Beginner) | 4 | 5 |
| 1 (Novice) | 2 | 1 |

**Move flow (`cDoMove(from, to, promotion)`):**
1. Snapshot `cEvalBeforeCP` from current eval
2. `cSFAbortInFlight()` — cancel any pending engine analysis
3. `chess.move({from, to, promotion})` — update chess.js state
4. Re-render board
5. Call `cRunPostMoveEval()` — get eval after user's move
6. Call `cClassifyAndFireCoach(evalAfterCP)` — decide if coach popup fires
7. Call `cEnginePlayMove()` — engine selects and plays its move

**Coach trigger classification (`cClassifyAndFireCoach`):**
- Computes `delta = evalAfterCP - cEvalBeforeCP` (from user's perspective)
- BLUNDER: delta < -2.0
- MISTAKE: delta < -1.0
- INACCURACY: delta < -0.5
- BRILLIANT: delta > 0.8 AND user played engine's top move
- EXCELLENT: delta > 0.3
- DANGER_ZONE: king safety heuristic triggered
- RECOVERY: bounced back from a bad position
- PHASE_TRANSITION: opening→middlegame or middlegame→endgame detected

**`cShouldFire(trigger)` — popup frequency gating:**
| Trigger | Rule |
|---------|------|
| BLUNDER | Always fire |
| BRILLIANT | Always fire |
| DANGER_ZONE | Always fire |
| RECOVERY | Always fire |
| PHASE_ | Always fire |
| MISTAKE | Only if ≥3 moves since last popup |
| INACCURACY | Only if ≥5 moves since last popup |
| EXCELLENT | Only if ≥5 moves since last popup |

**Coach popup (`cShowPopup`):**
- Shows in overlay panel on right side
- Contains: trigger label, eval delta display, coach message text, hint button
- `cFetchMsg()`: POST to `/api/analyze` (Railway) with system prompt including player profile (`pf_display_name`, `pf_coach_style`, current position FEN, move history, trigger type); max_tokens=150, 8s timeout
- `cFetchHintReason(bestSan)`: POST to `/api/analyze`; asks why bestSan is best; max_tokens=80; cached in `cHintCache` Map (FEN→reason)

**Auto-recovery (`cHandleEngineCrash`):**
1. Terminate crashed Worker
2. Spawn new `Worker('js/stockfish.js')`
3. Re-initialize UCI + isready
4. Resume game from current position

**Stats tracking:**
- `cRecordResult(result)`: updates `pb_coach_record` (wins/losses/draws) and `pb_coach_games` (array of game summaries)
- `cTrackWarnShown(trigger)`: increments `pb_warning_efficacy.shown`
- `cTrackWarnHeeded()`: increments `pb_warning_efficacy.heeded` (called when user takes back a blunder)

**localStorage keys for Play the Coach:**
| Key | Contents |
|-----|----------|
| `pb_coach_enabled` | `'true'`/`'false'` — coach popup toggle |
| `pb_coach_difficulty` | `'20'`/`'15'`/`'10'`/`'5'`/`'1'` |
| `pb_coach_color` | `'w'`/`'b'`/`'random'` |
| `pb_coach_record` | `{wins, losses, draws}` |
| `pb_coach_games` | array of game result summaries |
| `pb_warning_efficacy` | `{shown, heeded}` |

**UI elements in coach view:**
- Left: board canvas (480×480)
- Right panel: game info, coach popup overlay, hint button, stats display
- Bottom: material count, eval bar, move history

### 5c. Opening Drill (js/practice-board.js lines 1750+)

IIFE, runs when `?mode=opening`.

**3 sub-views (toggled by show/hide):**
1. `pb-od-selection` — pick opening and side
2. `pb-od-coaching` — theory explanation panel (calls `/api/theory` for Claude explanation)
3. `pb-od-drilling` — interactive drilling with move feedback

**Drill flow:**
1. User selects opening from dropdown (same 10 as openings.html trainer)
2. Selection view shows opening description; "Start Drill" advances to coaching view
3. Coaching view shows theory text fetched from `/api/theory`; "Begin Drilling" advances to drill view
4. Drill view: user plays expected moves; correct → green flash; wrong → red flash + shows correct move; streak counter displayed

**Streak tracking:**
- `pb_opening_drill_scores` localStorage key: object keyed by opening name
- Each entry: `{correct, wrong, streak, bestStreak}`
- Streak increments on consecutive correct moves; resets on wrong move

**Drill completion:**
- After all moves in the line are played correctly: summary screen with score
- Updates `pb_opening_drill_scores` in localStorage
- "Drill Again" button restarts from position 1
- "Back to Selection" returns to selection sub-view

---

## 6. Backend (server/index.js)

Railway-hosted Express server. Single file, ~470 lines.

### Configuration
- `PORT = process.env.PORT || 4000`
- `app.set('trust proxy', 1)` — required for Railway's reverse proxy
- Model: `'claude-sonnet-4-6'`

### CORS
Allowed origins: `chesslab.live`, `www.chesslab.live`, `rubeard3-bot.github.io`, `localhost:3000`, `localhost:4000`
Methods: GET, POST, OPTIONS. Credentials: true.

### Rate Limiting
- Global: 10 requests per 60 seconds per IP (`express-rate-limit`)
- Lichess proxy: 10 requests per 10 seconds (separate limiter on that route)

### Helper Functions

**`claudeHeaders()`** — returns `{Content-Type, x-api-key, anthropic-version}` with key from env

**`parseResponse(text, label)`** — strips markdown fences, extracts first `{` to last `}`, falls back to bracket-patching (`+ '}]}]}]}'`) if initial parse fails; returns null on total failure

**`callClaude(prompt, label, maxTokens=1500)`** — up to 2 retries; 5s delay on 429; logs first 300 chars of response

**`buildGamesSummary(games)`** — maps game array to compact summary objects:
- Keeps: gameId (prefixed `csa_game_`), date, playerColor, openingName, eco, accuracy, blunders, mistakes, inaccuracies, result, white, black, strength, weakness, recurringPattern, openingDeviations
- Moves: filters to blunder/mistake/miss/inaccuracy only, sorts by evalLoss desc, takes top 15, keeps only ply/san/classification/evalLoss

### Endpoints

**POST `/api/analyze`** — pass-through proxy to Anthropic API
- Accepts: `messages`, `model`, `max_tokens`, `system`
- Returns raw Anthropic API response JSON
- Used by: analyzer.html coach chat, profile.html coach chat, practice board coach popups, hint reasons

**POST `/api/recommendations`** — fires 3 parallel Claude calls, merges results
- Accepts: `{games: [...]}` array of full game objects from localStorage
- Call 1 (Core): overallAssessment, accuracyTrend, phaseAnalysis, topWeaknesses — 8000 tokens
- Call 2 (Opening+Tactics): openingReport, tacticalPatterns, improvements — 8000 tokens
- Call 3 (Study Plan): weeklyStudyPlan, nextGoals, coachMessage — 8000 tokens
- Merges with `Object.assign({}, result1, result2, result3)`
- Returns `_partialFailure` string if any call failed
- All 3 calls fired in parallel with `Promise.all()`

**POST `/api/theory`** — Claude explanation for an opening position
- Accepts: `{fen, moves, openingName}`
- In-memory cache: `theoryCache` Map (FEN → explanation text); max 200 entries, LRU eviction
- Returns: `{explanation: "..."}` plain text, 3-4 sentences
- Used by: Opening Drill coaching sub-view

**GET `/api/lichess-explorer`** — proxy to Lichess Opening Explorer
- Allowed query params: `fen`, `speeds`, `ratings`, `moves`, `variant`
- Forwards to `explorer.lichess.ovh/lichess` with Bearer token
- Returns 429 if Lichess rate limits
- Used by: openings.html (both explore and trainer modes)

---

## 7. localStorage Schema

All keys are strings; all values are JSON-stringified unless noted.

### User Profile
| Key | Type | Contents |
|-----|------|----------|
| `pf_display_name` | string | Player's display name |
| `pf_avatar_color` | string | Hex color for avatar chip |
| `pf_coach_name` | string | Coach persona name |
| `pf_coach_style` | string | `'supportive'`/`'analytical'`/`'tough'` |
| `pf_board_light` | string | Hex color for light squares |
| `pf_board_dark` | string | Hex color for dark squares |
| `pf_accent_color` | string | Hex color for UI accent |
| `pf_auto_recommendations` | string | `'true'`/`'false'` |
| `pf_show_hints` | string | `'true'`/`'false'` |

### Chess Profile / ELO
| Key | Type | Contents |
|-----|------|----------|
| `csa_chesscom_username` | string | Chess.com username |
| `csa_elo_current` | string | Current ELO (number as string) |
| `csa_elo_goal` | string | Goal ELO (number as string) |
| `csa_elo_start` | string | Starting ELO when they began tracking |
| `csa_elo_history` | JSON | Array of `{date: "YYYY-MM-DD", elo: number}` |

### Game Storage
| Key | Type | Contents |
|-----|------|----------|
| `csa_game_{id}` | JSON | Full game object (see below) |

Game object structure:
```json
{
  "id": "{timestamp}",
  "pgn": "...",
  "playerColor": "white|black",
  "savedAt": "ISO timestamp",
  "metadata": {
    "white": "...", "black": "...", "date": "...", "result": "1-0|0-1|1/2-1/2|*",
    "event": "...", "site": "..."
  },
  "analysis": {
    "opening": {
      "name": "...", "eco": "...",
      "youPlayed": "...", "theorySays": "...", "bookedUntil": null
    },
    "summary": {
      "accuracy": 85.2, "blunders": 1, "mistakes": 2, "inaccuracies": 3,
      "strength": "...", "weakness": "...", "recurringPattern": "..."
    },
    "moves": [
      {
        "ply": 1, "san": "e4", "classification": "best|excellent|good|miss|inaccuracy|mistake|blunder",
        "evalLoss": 0.05, "bestMove": "e4", "evalBefore": 0.2, "evalAfter": 0.25
      }
    ]
  },
  "fens": ["fen0", "fen1", "..."]
}
```

Storage constants (`js/storage.js`):
- `GAME_PREFIX = 'csa_game_'`
- `MAX_GAMES = 50` (oldest pruned when exceeded)
- IDs are `Date.now().toString()`

### Recommendations
| Key | Type | Contents |
|-----|------|----------|
| `csa_recommendations` | JSON | Full merged object from 3 Claude calls |
| `csa_recommendations_meta` | JSON | `{gameCount: N, generatedAt: "ISO timestamp"}` |

### Opening Trainer
| Key | Type | Contents |
|-----|------|----------|
| `csa_opening_scores` | JSON | Object keyed by opening name: `{correct, wrong, lastDrilled}` |

### Practice Board
| Key | Type | Contents |
|-----|------|----------|
| `pb_coach_enabled` | string | `'true'`/`'false'` |
| `pb_coach_difficulty` | string | `'20'`/`'15'`/`'10'`/`'5'`/`'1'` |
| `pb_coach_color` | string | `'w'`/`'b'`/`'random'` |
| `pb_coach_record` | JSON | `{wins: 0, losses: 0, draws: 0}` |
| `pb_coach_games` | JSON | Array of game result summaries |
| `pb_warning_efficacy` | JSON | `{shown: 0, heeded: 0}` |
| `pb_opening_drill_scores` | JSON | Object keyed by opening name: `{correct, wrong, streak, bestStreak}` |

### sessionStorage (cross-page state, not persisted)
| Key | Contents |
|-----|----------|
| `pending_pgn` | PGN string for single-game import |
| `pending_color` | `'white'`/`'black'` for single-game import |
| `csa_import_queue` | JSON array of `{pgn, color}` objects for mass import |
| `csa_import_index` | Current position in import queue (number as string) |
| `csa_review_game_id` | Game ID to load in analyzer (from archive / dashboard "Review last game" / recent-games rows). Stored as the full `csa_game_<id>` key; app.js strips the prefix and removes the key on read. |
| `csa_opening_line` | JSON `{openingName, moves: [...SAN]}` for "practice this line" from openings.html. Replayed against `new Chess()` in practice.html's preload script. |
| `practice_fen` | FEN string handed off from analyzer's "Set up critical position" → Practice Board Free Play. Loaded via `chess.load()` in practice-board.js Free Play IIFE init; removed on read. |

---

## 8. External API Integration

### Anthropic Claude API
- Endpoint: `https://api.anthropic.com/v1/messages`
- Model: `claude-sonnet-4-6`
- Auth: `x-api-key` header (server env var only — never in client code)
- Version header: `anthropic-version: 2023-06-01`
- All calls go through Railway backend `/api/analyze` or via `callClaude()` helper

**Call sites:**
| Feature | Route | max_tokens | Notes |
|---------|-------|------------|-------|
| Game analysis summary | /api/analyze | 8000 | Inline in app.js |
| Recommendations (×3 parallel) | /api/recommendations | 8000 each | Via recommendations.js |
| Opening theory | /api/theory | 350 | Cached in-memory |
| Coach chat (analyzer) | /api/analyze | varies | Multi-turn via messages array |
| Coach chat (profile) | /api/analyze | varies | System prompt includes user profile |
| Coach popup (play mode) | /api/analyze | 150 | 8s timeout; position + trigger |
| Hint reason (play mode) | /api/analyze | 80 | Cached in cHintCache |

### Lichess Opening Explorer
- Endpoint: `https://explorer.lichess.ovh/lichess`
- Auth: Bearer token via Railway env var `LICHESS_API_TOKEN`
- Proxied through Railway `/api/lichess-explorer`
- Rate limit: 10 req/10s on Railway proxy
- Query params forwarded: `fen`, `speeds`, `ratings`, `moves`, `variant`

**Call sites:**
- openings.html Explore mode: fetches top moves for current board position
- openings.html Train mode: validates moves against theory
- practice.html Opening Drill: fetches theory lines for selected opening

### Chess.com Public API
- Base: `https://api.chess.com/pub/player/{username}/`
- No auth required
- Called directly from client (import.html, chesscom.js)
- Endpoints used:
  - `/games/archives` — list of monthly archive URLs
  - `/games/{year}/{month}` — all games for that month
  - `/stats` — player stats (for rating display)

---

## 9. Claude Code Prompt Patterns Learned

These are patterns that work well in this codebase. Apply them on new work.

### JS Structure
- All JS files use IIFE pattern: `const ModuleName = (() => { ... return { publicMethod }; })();`
- practice-board.js has multiple IIFEs in one file (one per mode), NOT exported — they run as side effects
- No ES modules, no imports — all globals loaded by script tags in order
- Script load order matters: chess.js/chess.min.js first, then storage.js, then page-specific modules, then app.js last

### Canvas Boards
- Each mode has its own canvas, its own PX/SQ constants, its own render() function
- Free Play: 560px (SQ=70), openings: 420px (SQ=52.5), coach: 480px (SQ=60)
- Piece images loaded from lichess CDN as Image objects; render waits for onload
- render() is idempotent — called after every state change

### Stockfish Integration
- Free Play uses simple flag-based approach (sfBusy, sfSkip)
- Play the Coach uses serial Promise queue to prevent race conditions — this is the correct pattern for multi-step engine interaction
- Always send 'stop' before a new 'go' command if engine might be busy
- Auto-recovery pattern for crashes: terminate worker, spawn new, re-init UCI, resume

### Claude Calls from Client
- Never call Anthropic directly from client — always through Railway proxy
- Always use `SERVER_URL` constant that switches between localhost:4000 and Railway URL
- Pattern for SERVER_URL:
  ```js
  const SERVER_URL = location.hostname === 'localhost'
    ? 'http://localhost:4000'
    : 'https://chess-lab-production.up.railway.app';
  ```

### CSS Conventions
- New page-level layouts use a new prefix: `az-`, `pb-`, `pf-`, `rec-`, `open-`, `db-`
- Shared components (sidebar, nav) use `db-sidebar`, `db-nav` etc. on all pages
- Page-specific CSS goes inline in the HTML `<style>` block — do not add to styles.css unless it's a truly shared component
- practice.html and openings.html are entirely self-contained for CSS

### Modal / Overlay Pattern
- Overlays use `position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100`
- Inner modals: `position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%)`
- Two-click confirmation for destructive actions (button text changes to "Are you sure?" on first click)

### Error Handling
- `parseResponse()` in server handles truncated JSON and tries bracket-patching as last resort
- `callClaude()` retries up to 2 times; 5s wait on 429
- Recommendations merges partial results rather than failing completely
- Always handle `_partialFailure` on the client when reading recommendations

---

## 10. Known Bugs and Pending Work

### Known Bugs
- **Opening Drill 401 errors**: Fixed by routing Lichess calls through Railway proxy with Bearer token. If 401 reappears, check that `LICHESS_API_TOKEN` is set in Railway environment.
- **Stockfish crash in Play the Coach**: Fixed by serial Promise queue (`cSFTaskQueue`). If engine stops responding, `cHandleEngineCrash()` auto-recovers. Still possible in edge cases if crash happens mid-queue.
- **chess.js CDN vs local**: Some pages use CDN `chess.min.js`, analyzer.html uses local `js/chess.js`. If chess.js behavior diverges between pages, this is why. The API is identical but version mismatches are possible.

### Pending / Coming Soon
- **Weakness Drill mode** (`pb-view-weakness`): Shell exists at `?mode=weakness`. Not yet implemented — shows "coming soon" message.
- **Opening Drill improvements**: Current implementation is functional but streak display and session summary could be more polished.
- **ELO History chart**: Index page draws a simple SVG polyline. Proper charting library not used.
- **Offline Stockfish depth**: Free Play uses depth 18 which can be slow on low-end devices. No configurable depth option yet.
- **Mobile layout**: Not designed for mobile — `overflow: hidden` on html/body will clip content on small screens.

### Technical Debt
- Mass import queue stored in sessionStorage — if the tab is closed mid-import, the queue is lost and re-importing from import.html is required
- `theoryCache` in server/index.js is in-memory — resets on every Railway deploy/restart
- No server-side game storage — everything in localStorage; 50-game limit enforced by `MAX_GAMES`
- Rate limit (10 req/min global) shared across all endpoints — heavy recommendations usage can briefly throttle coach chat

---

## 11. Build History (Chronological)

| Phase | Description |
|-------|-------------|
| v1 | Flask/Python backend + analyzer.py; Stockfish via subprocess; localStorage for games |
| v2 | Migrated to pure static frontend + Railway Node/Express backend |
| v3 | Added index.html dashboard, archive.html, import.html, profile.html |
| v3.1 | Added openings.html with Explore mode and 10-opening trainer |
| v4 | practice.html Phase 1: landing + 4 mode cards + URL routing + Free Play with Stockfish |
| v4.1 | practice.html Phase 2: Play the Coach mode — AI popup coaching, Stockfish game, stats tracking |
| v4.2 | practice.html Phase 3: Opening Drill mode — Lichess theory lines, coaching room, drill streaks |
| v4.3 | Lichess API 401 fix — added Railway proxy for all Lichess explorer calls with Bearer token |

---

## 12. Architecture Decisions

### Why no framework / no build system
Simplicity of deployment — push to GitHub Pages = live. No webpack, no npm run build, no CI needed for the frontend. The app is small enough that vanilla JS IIFEs are maintainable.

### Why Railway for backend
Chess.com API is public; Anthropic and Lichess require API keys. A thin proxy keeps keys off the client. Railway was chosen for zero-config Node.js hosting with env var support and auto-deploy from GitHub.

### Why localStorage only (no server DB)
User data (games, settings) stays on the user's device. No user accounts, no auth, no GDPR concerns. 50-game limit enforced by `MAX_GAMES = 50` in storage.js to keep localStorage under browser quotas.

### Why canvas board (no DOM pieces)
Performance and control. Canvas render() is a single function call that redraws the entire board state. No CSS transforms, no z-index issues, no event delegation complexity for piece movement. Arrow drawing, highlight overlays, and eval bar are trivial with canvas.

### Why 3 parallel Claude calls for recommendations
The full recommendations response would exceed ~8000 tokens if generated in one call. Splitting into Core / Opening+Tactics / Study Plan lets each call be thorough. Parallel firing keeps latency near the slowest single call (~5-10s) rather than sequential (~15-30s). `Object.assign` merge is safe because the 3 schemas have no overlapping keys.

### Why serial Promise queue for Play the Coach Stockfish
The coach mode sends multiple rapid commands to Stockfish (position, go, stop, position, go again). Race conditions where 'bestmove' from an aborted search was mistaken for the real best move caused incorrect coach feedback and engine freezes. The serial queue ensures commands execute in strict order with proper awaiting.

### Why chess.js 0.10.3 (not v1.x)
v1.x broke API compatibility (`.moves()` returns strings instead of objects, `.history({verbose: true})` changed). The entire codebase depends on 0.10.3 behavior. Do not upgrade without auditing every `.move()`, `.history()`, `.moves()` call across all JS files.

### Why inline CSS in practice.html and openings.html
These pages were built feature-by-feature with self-contained CSS. Keeping styles inline avoids naming collisions with shared styles.css and makes each page independently portable. The tradeoff is no CSS reuse between these pages, but they share little with each other.

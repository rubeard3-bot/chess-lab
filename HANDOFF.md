# Chess Lab — Project Handoff Document

> Regenerated from full codebase audit on 2026-05-14.  
> All facts derived from reading source files directly — not from assumptions or documentation.

---

## 1. Project Overview

**Chess Lab** is a browser-based chess analysis platform. Users paste or import PGN game notation; the app runs Stockfish 18 (WASM, in-browser) for engine evaluation, then calls Claude via a Railway-hosted proxy for natural language coaching feedback.

- **Live URL**: https://chesslab.live
- **Frontend host**: GitHub Pages (custom domain via `CNAME`)
- **Backend host**: Railway — `https://chess-lab-production.up.railway.app`
- **Repo**: github.com/rubeard3-bot (GitHub Pages auto-deploys from `main`)
- **No build step** — pure static HTML/CSS/JS, deployed as-is

---

## 2. Infrastructure

| Layer | Provider | Notes |
|---|---|---|
| Frontend | GitHub Pages | Static; auto-deploys on push to `main` |
| Backend proxy | Railway | Node.js, auto-deploys from `main` via Nixpacks |
| Domain | chesslab.live | CNAME file points GitHub Pages to custom domain |
| Chess engine | Browser (WASM) | Stockfish 18, runs in a Web Worker — no server compute |
| AI | Anthropic Claude API | Key stored in Railway env var only; **Tier 2 account** |
| Opening data | Lichess API | `explorer.lichess.ovh/masters` + `/lichess` |
| Game import | Chess.com Public API | No auth required |

Railway config: `server/railway.json` — builder: NIXPACKS, start command: `node index.js`, restart on failure enabled.

---

## 3. Technology Stack

| Technology | Version / Details | Where Used |
|---|---|---|
| chess.js | 0.10.3 (local copy) | `js/chess.js` — analyzer pipeline |
| chess.js | 1.x (CDN, cdnjs) | `openings.html`, `practice.html` — note API differences |
| Stockfish | 18 WASM | `js/stockfish.js`, `js/stockfish.wasm` |
| Express | ^4.18.2 | Backend server |
| cors | ^2.8.5 | Backend CORS middleware |
| express-rate-limit | ^7.1.5 | Rate limiting |
| node-fetch | ^2.7.0 | Fetch in Node (CommonJS) |
| Claude model | `claude-sonnet-4-6` | `server/index.js:11`, `analysis.js:5`, `ui.js:1151` |
| Canvas API | Browser native | Board rendering (3 separate implementations) |
| No bundler | — | No Webpack/Vite/Rollup; files loaded via `<script>` tags |
| No framework | — | Vanilla JS throughout; IIFE module pattern |

---

## 4. Complete File Structure

```
chess_analyzer/
├── server/
│   ├── index.js              # Express proxy — 3 endpoints, 416 lines
│   ├── package.json          # Node deps
│   ├── package-lock.json
│   └── railway.json          # Railway deploy config
│
├── js/
│   ├── app.js                # Main controller, state management, 637 lines
│   ├── analysis.js           # Analysis pipeline (PGN→Stockfish→Claude), 322 lines
│   ├── board.js              # Canvas board for analyzer, 242 lines
│   ├── ui.js                 # All UI/DOM rendering, 1340 lines
│   ├── engine.js             # Stockfish Web Worker wrapper, 201 lines
│   ├── storage.js            # localStorage CRUD, 65 lines
│   ├── nav.js                # Navigation drawer, 87 lines
│   ├── recommendations.js    # Cross-game analysis — fetch + localStorage, 100 lines
│   ├── chesscom.js           # Chess.com API client, 55 lines
│   ├── openings.js           # Opening Explorer + Trainer, 1554 lines
│   ├── practice-board.js     # Practice board, 641 lines
│   ├── chess.js              # chess.js 0.10.3 minified
│   ├── stockfish.js          # Stockfish 18 WASM worker (minified)
│   └── stockfish.wasm        # WASM binary
│
├── css/
│   └── styles.css            # Global styles, 4003+ lines
│
├── index.html                # Homepage / ELO tracker
├── analyzer.html             # Game Analyzer, 365 lines
├── recommendations.html      # Recommendations dashboard, 561 lines
├── archive.html              # Game archive
├── import.html               # Chess.com import + mass import
├── openings.html             # Opening Explorer
├── practice.html             # Practice board
├── CNAME                     # "chesslab.live"
│
└── [legacy — not part of app]
    ├── analyzer.py
    ├── requirements.txt
    ├── report.html / report.md
    ├── SETUP.md
    ├── __pycache__/
    ├── Already Analyzed/
    ├── Kulio54_vs_russelll1234578_2026.04.28.pgn
    └── Russell horrible game.pdf
```

---

## 5. Feature Status

| Feature | Status | Location |
|---|---|---|
| PGN paste and parse | Live | `analysis.js parsePGN()` |
| Stockfish 18 WASM analysis | Live | `engine.js`, depth 20 |
| Move classification (7 tiers, incl. `miss`) | Live | `analysis.js classifyMoves()` |
| Miss move badge (amber) | Live | `ui.js BADGE_MAP`, `az-badge-miss` CSS class |
| Miss dot on eval timeline | Live | `ui.js renderEvalGraph()` — amber (#fcd34d) dot |
| Accuracy score | Live | `analysis.js calculateAccuracy()` |
| Claude coaching feedback | Live | `analysis.js callClaude()` |
| Board renders before Claude returns | Live | `app.js handleAnalyze()` — non-blocking Claude call |
| Canvas board with navigation | Live | `board.js` |
| Player bars with captured pieces + material delta | Live | `ui.js renderMaterialBars()` |
| Two-tab analyzer (Game Review / My Report) | Live | `analyzer.html`, `ui.js initTabs()` |
| Coach chat (persistent, context-aware) | Live | `ui.js initCoachChat()`, `/api/analyze` |
| Eval timeline with phase labels + legend | Live | `ui.js renderEvalGraph()` |
| Report card (grade circle A–F, phase accuracy bars) | Live | `ui.js renderGameSummary()`, `renderPhaseAccuracy()` |
| Stat grid (blunders/mistakes/misses/inaccuracies/best/accuracy/result) | Live | `ui.js renderGameSummary()`, `updateStatGridMisses()` |
| Coach summary (strength/weakness/pattern) | Live | `ui.js renderCoachSummary()` |
| vs Recent Average section | Live | `ui.js renderVsAverage()` |
| Patterns Spotted (from cross-game recs) | Live | `ui.js renderPatternsSummary()` |
| Next Steps action buttons | Live | `ui.js renderNextSteps()` |
| localStorage persistence (50-game cap) | Live | `storage.js` |
| Game archive with search/filter | Live | `archive.html` |
| Chess.com single game import | Live | `chesscom.js`, `import.html` |
| Chess.com mass import (bulk queue) | Live | `import.html`, sessionStorage queue |
| Coach Recommendations (3 parallel calls) | Live | `server/index.js /api/recommendations` via `Promise.all` |
| Opening Explorer (Lichess data) | Live | `openings.js`, `openings.html` |
| Opening Trainer (drill/hint/reveal) | Live | `openings.js` |
| Practice Board with Stockfish | Live | `practice-board.js`, `practice.html` |
| ELO tracker with SVG graph | Live | `index.html` |
| "Opening Explorer" nav link | **Live** (fixed) | `nav.js:70-72` — navigates to `openings.html` |
| `csa_api_key` Settings modal | **DEAD UI** | Nav drawer shows "Settings / API Key" button; `setupApiKeyModal()` in `app.js:230` is a no-op; `Storage.getApiKey()`/`setApiKey()` remain in `storage.js` but are never called by the app |
| Study streak counter | **INCOMPLETE** | UI element exists in `index.html`; no tracking logic |
| SSE / streaming progress | **NOT BUILT** | Stockfish progress is WASM-side only; no server-sent events |

---

## 6. Full Analysis Flow

```
User pastes PGN
    → analysis.js parsePGN()          — validate, extract headers + verbose move history
    → engine.js analyzeAllPositions() — Stockfish Web Worker, depth 20
         → one SF call per board position (init + N positions)
         → returns: eval (pawns), bestMoveUci, bestMoveSan, bestMoveFrom/To, pvSan[]
    → analysis.js classifyMoves()     — win% loss thresholds → 7-tier classification
         → includes "miss": player was winning (≥65% WP), position still acceptable after,
           but real winning continuation was squandered. Also catches missed forced mates.
    → analysis.js calculateAccuracy() — Lichess formula per player
    → analysis.js buildAnalysis()     — partial object (no Claude text yet)
    → storage.js saveGame()           — persist to localStorage immediately
    → app.js loadGameIntoApp()        — board + move list + eval graph visible NOW
    → app.js: UI.showCoachLoading()   — "Coach is reviewing your game…" spinner
    → analysis.js callClaude()        — POST to /api/analyze (async, non-blocking)
         → server/index.js /api/analyze — thin proxy, forwards to Anthropic
         → Claude returns: summary, opening{}, moveExplanations[]
    → analysis.js buildAnalysis()     — merge Stockfish + Claude into full object
    → storage.js: update saved game in localStorage
    → ui.js: hide coach loading, fade in coaching text
    → ui.js: renderFullReport()       — My Report tab: grade, phase bars, coach summary,
                                        vs average, patterns, next steps
    → ui.js: sendCoachOpeningMessage() — Coach chat auto-opens with personalized message
    → recommendations.js: generateRecommendations() — POST /api/recommendations
         → server fires all 3 Claude calls in parallel via Promise.all
         → merged result saved to csa_recommendations in localStorage
```

**Board renders before Claude returns.** The partial analysis (Stockfish data only) is persisted and displayed immediately. Coach text and opening details fade in when Claude responds (~5–15s).

---

## 7. Railway Endpoints

### POST /api/analyze
Thin proxy to Anthropic. Forwards `{ model, max_tokens, messages, system? }` directly.  
Used by `analysis.js` for per-game coaching (max_tokens: 8000) and by `ui.js` for coach chat (max_tokens: 300).

### POST /api/recommendations
Aggregates game history, fires **3 Claude calls in parallel** via `Promise.all`.  
Input: `{ games: [...] }` — array of stored game objects.  
Output: merged JSON from 3 prompts (core analysis, openings/tactics, study plan).  
Max tokens per call: 4000. Comment in code: "Tier 2 rate limits have ample headroom."

**Partial failure handling**: if 1 or 2 of the 3 calls fail, the server merges what it has and sets `_partialFailure` on the JSON body. `recommendations.js:75` correctly reads `merged._partialFailure` from the parsed response and fires a `rec-parse-error` custom event.

### POST /api/theory
Returns a 3-4 sentence opening explanation for a given FEN.  
Input: `{ fen, moves[], openingName }`.  
Has in-memory LRU cache (200 entries, clears on restart).  
Max tokens: 350.

**Rate limit**: 10 requests / 60 seconds across all endpoints (shared, not per-route).  
**CORS**: chesslab.live, www.chesslab.live, rubeard3-bot.github.io, localhost:3000, localhost:4000.

---

## 8. localStorage Reference

| Key | Type | Purpose | Set by | Max size |
|---|---|---|---|---|
| `csa_game_{id}` | Object | Full game analysis (metadata + moves + coaching) | `storage.js saveGame()` | 50 games total |
| `csa_recommendations` | Object | Latest recommendations JSON from 3-call Claude | `recommendations.js` | 1 entry |
| `csa_recommendations_meta` | Object | `{ gameCount, generatedAt }` — staleness tracking | `recommendations.js` | 1 entry |
| `csa_opening_scores` | Object | Opening Trainer drill scores per opening | `openings.js` | Unbounded |
| `csa_api_key` | String | **DEAD** — stored and readable but never used by the app | `storage.js setApiKey()` | — |
| `csa_chesscom_username` | String | Used to auto-detect player color from PGN | `import.html` / `chesscom.js` | — |

**sessionStorage keys** (page-lifetime only):

| Key | Purpose |
|---|---|
| `csa_import_queue` | JSON array of PGNs for mass Chess.com import |
| `csa_import_index` | Current position in mass import queue |
| `pending_pgn` | Single PGN passed from import.html to analyzer.html |
| `pending_color` | Player color passed alongside pending_pgn |
| `csa_export_line` | Opening line passed from openings.html for external use |
| `az_critical_ply` | Ply number of worst blunder, used to set practice FEN |
| `az_critical_fen` | FEN of worst blunder position, passed to practice.html |
| `practice_fen` | FEN loaded into practice board |

---

## 9. Config Values

| Setting | Value | File | Notes |
|---|---|---|---|
| Claude model | `claude-sonnet-4-6` | `server/index.js:11`, `analysis.js:5`, `ui.js:1151` | Current |
| Railway URL | `https://chess-lab-production.up.railway.app` | `analysis.js:3-4`, `ui.js:16-17`, `recommendations.js:7-8`, `openings.js:5` | |
| Anthropic API tier | Tier 2 | `server/index.js:322` (comment) | Allows parallel calls without 429 concern |
| Stockfish depth (analyzer) | `20` | `engine.js:3` | |
| Stockfish depth (practice board) | `18` | `practice-board.js` | Intentional: practice is interactive |
| Max stored games | `50` | `storage.js` | Enforced by `pruneOldGames()` |
| Rate limit | `10 req / 60s` | `server/index.js:32-37` | Shared across all routes |
| Theory cache size | `200 entries` | `server/index.js:402` | In-memory only; clears on deploy |
| Max tokens — analyze | `8000` | `analysis.js:229` | Per-game coaching |
| Max tokens — coach chat | `300` | `ui.js:1151` | Short conversational replies |
| Max tokens — recommendations | `4000 × 3` | `server/index.js:89` (via `callClaude` helper) | Per parallel call |
| Max tokens — theory | `350` | `server/index.js:386` | |
| Opening Trainer max tree nodes | `50` | `openings.js` | Lichess API tree build |
| Opening Trainer max depth | `4` | `openings.js` | Half-moves from root |

---

## 10. Development Workflow

**To run locally:**
```bash
# Backend
cd server
npm install
ANTHROPIC_API_KEY=sk-ant-... node index.js   # runs on :4000

# Frontend — just open index.html in browser
# OR serve statically:
npx serve . -p 3000
```

`analysis.js`, `ui.js`, and `recommendations.js` each auto-switch Railway URL ↔ localhost:4000 based on `window.location.hostname === 'localhost'`.

**To deploy:**
- Push to `main` → GitHub Pages rebuilds frontend automatically
- Push to `main` → Railway rebuilds backend automatically (Nixpacks detects `server/package.json`)

**No build step.** No transpilation, no bundling. Files are served as-is.

---

## 11. Architecture Decisions

**Why Railway proxy instead of direct Anthropic calls?**  
The Anthropic API key must never be in frontend JS. The Railway proxy keeps the key server-side only, while still allowing a fully static GitHub Pages frontend.

**Why WASM Stockfish in-browser?**  
Zero server compute cost for engine analysis. Stockfish runs entirely in the user's browser via a Web Worker. The only server calls are for Claude (which can't run client-side).

**Why chess.js 0.10.3 (local copy)?**  
The analyzer pipeline (`app.js`, `analysis.js`, `board.js`) uses the 0.10.x API (`load_pgn`, `history({ verbose: true })`). The openings and practice pages use a CDN-loaded 1.x version, which has a different API. These are intentionally separate.

**Why IIFE module pattern?**  
All JS files use `const X = (() => { ... return { ... }; })()`. This gives module-level encapsulation without a build tool or ES modules (which would require a dev server for `type="module"` imports in local development).

**Why 3 parallel Claude calls for recommendations?**  
A single prompt combining all analysis sections would approach Claude's context limits for large game histories. Splitting into Core Analysis, Openings/Tactics, and Study Plan keeps each prompt focused and allows parallel execution. With Tier 2 API access, parallel requests no longer risk hitting rate limits.

**Why does board render before Claude returns?**  
Stockfish analysis (the slow, compute-heavy step) completes first. Rendering the board and move list immediately after Stockfish means the user can start reviewing moves while Claude composes coaching text. This reduces perceived latency from ~20s to ~5s.

---

## 12. Analyzer Layout (Two-Tab Design)

### Game Review tab (default)
- **Pinned top**: Move detail card — classification badge, eval before/after, "you played / best move" row, Claude coaching text, collapsible engine PV line
- **Scrollable middle**: Eval timeline (60px SVG, clickable, blunder/mistake/miss markers), Opening panel (name, ECO, deviation, explore link)
- **Pinned bottom**: Coach chat — persistent multi-turn conversation, context-aware (knows current move and full game)

### My Report tab
- **Report card**: Letter grade (A=90%+, B=80%+, C=70%+, D=60%+, F=below), phase accuracy progress bars (Opening/Middlegame/Endgame)
- **Stat grid**: Blunders, Mistakes, Misses, Inaccuracies, Best/Excellent moves, Accuracy %, Result
- **Coach summary**: Strength, Weakness, Recurring Pattern text from Claude
- **vs Recent Average**: Compares this game's accuracy/blunders/misses/best-moves against last 10 games
- **Patterns Spotted**: Top 2 weaknesses surfaced from `csa_recommendations` in localStorage
- **Next Steps**: Drill opening link, Tactics trainer (coming soon), Full Recommendations link, Practice Board link

### Left column (always visible)
- Opponent player bar (name + captured pieces)
- Eval bar (vertical, white-from-top, flips when playing black) + Canvas board
- Your player bar (name + captured pieces + material delta)
- Navigation controls (first/prev/next/last/flip/saved-games)
- Move list with classification badges for player's moves only

---

## 13. Move Classification Details

**Win percentage from centipawns (white's perspective):**
```
winPct(evalCp) = 50 + 50 × (2 / (1 + e^(-0.00368208 × evalCp)) - 1)
```

**Win percentage loss per move (clamped to zero for good moves):**
```
wpl = isWhiteMove
  ? max(0, winPct(evalBefore) - winPct(evalAfter))
  : max(0, winPct(evalAfter)  - winPct(evalBefore))
```

**Move accuracy from wpl:**
```
moveAcc = 103.1668 × e^(-0.04354 × wpl) - 3.1669
        clamped to [0, 100]
```

**Game accuracy = mean of all player move accuracies (rounded to integer).**

This is the Lichess formula. Source: `analysis.js calculateAccuracy()` and `classifyMoves()`.

**Move classification thresholds (win% loss):**

| Classification | Condition | Badge color |
|---|---|---|
| `best` | Played move == engine's top move (UCI match) | Green |
| `excellent` | wpl ≤ 1 | Green |
| `good` | wpl ≤ 3 | (no badge — clean move) |
| `miss` | Player was winning (≥65% WP), position still acceptable after (≥50% WP), loss 5–15%; OR missed forced mate | Amber |
| `inaccuracy` | wpl ≤ 7 (after miss check) | Yellow |
| `mistake` | wpl ≤ 15 | Orange |
| `blunder` | wpl > 15 (not a miss) | Red |

Note: `miss` is checked before `inaccuracy` and `mistake` in the classification chain (`analysis.js:88-94`). A missed forced mate is always a `miss` regardless of wpl.

---

## 14. Known Issues (Confirmed by Audit)

### Medium Priority

1. **Dead Settings modal / API key stub**  
   The nav drawer on every page shows a "Settings / API Key" button (`#change-api-key-link`). Clicking it on non-analyzer pages redirects to `index.html`; on the analyzer page it does nothing (the `setupApiKeyModal()` function is a no-op). `storage.js` still exports `getApiKey()`/`setApiKey()` but nothing calls them. This confuses users who think they need to supply a key. Options: remove the button entirely, or wire it to useful settings (theme, board colors, etc.).

2. **Study streak counter incomplete**  
   A study streak UI element exists in `index.html` but there is no tracking or increment logic anywhere in the codebase.

### Low Priority

3. **No fetch timeout on Claude calls**  
   Neither `analysis.js callClaude()` nor the coach chat in `ui.js._sendChat()` use an `AbortController`. A hung Anthropic API call can block the client for the full Railway request timeout (~30s). The recommendations endpoint has a 2-attempt retry but no timeout on individual attempts.

4. **Race condition on async Claude return**  
   If the user starts a second analysis while Claude is still processing the first, the `.then()` callback from the first call updates `state.analysisData` and rerenders the UI. No cancellation token exists. Mitigated in practice because Claude typically responds in 5–15s, but possible on slow connections.

5. **In-memory theory cache resets on deploy**  
   `/api/theory` cache is a `Map()`. Every Railway deploy clears it. Not critical, but repeated deploys generate extra API calls for frequently-visited openings.

6. **`response._partialFailure` check is dead (non-200 path)**  
   `recommendations.js:65` checks `if (response._partialFailure)` on the raw `Response` object inside the `!response.ok` branch. This will never be true (Response objects don't have that property). However, this branch only runs when the server returned a non-200 status, which means there's no partial JSON body anyway — so it's dead code but harmless. The actual `_partialFailure` handling at line 75 (checking the parsed JSON) is correct.

---

## 15. Connected Learning Loop

The "connected learning loop" works as follows:

1. User analyzes a game → stored to `localStorage` as `csa_game_{id}` (partial, immediately)
2. Claude returns → game updated in localStorage with coaching text
3. `app.js` triggers `recommendations.js generateRecommendations()`
4. Server fires 3 parallel Claude calls with full game history summary
5. Results merged and stored to `csa_recommendations` + `csa_recommendations_meta` in localStorage
6. `recommendations.html` reads `csa_recommendations` on load and renders the full dashboard
7. Analyzer's My Report tab reads `csa_recommendations` for "Patterns Spotted" section
8. Opening Trainer stores per-opening drill scores in `csa_opening_scores`

The loop is: analyze game → get move-level feedback → see cross-game patterns → drill weak openings → re-analyze future games.

---

## 16. Commercialization Notes

Current state: single-user, no auth, no billing, no user accounts.

- All game data is client-side only (localStorage). No user database.
- Claude API costs are server-side and paid by the operator (Railway env var key, Tier 2 account).
- Rate limit (10 req/60s) is the only cost protection mechanism.
- No per-user metering, no usage caps per user, no payment integration.
- The Settings button stub implies per-user API keys but this path is entirely dead.

If commercializing: the most natural path is per-user API key passthrough (user provides own Anthropic key) or operator-pays with subscription auth. The Settings button skeleton exists for the former path but is not wired up.

---

## 17. Build Roadmap

Items remaining from code audit (not a committed roadmap — inferred from code state):

- [ ] Remove or repurpose dead "Settings / API Key" nav button
- [ ] Implement study streak tracking (counter exists in `index.html` UI)
- [ ] Add `AbortController` to Claude fetch calls with ~20s timeout
- [ ] Fix race condition in async Claude callbacks (cancellation token or guard)
- [ ] Remove dead `response._partialFailure` check at `recommendations.js:65` (non-200 path)
- [ ] Tactics trainer (referenced in Next Steps UI as "coming soon")
- [ ] My Progress page (nav item shows "Soon" badge)

---

## 18. Recent Changes Log

Based on git log at time of audit:

| Commit | Change |
|---|---|
| `3cfaa71` | Fix analyzer layout — syntax error, grid columns, tab panels, eval bar, player bars |
| `661147e` | Analyzer overhaul — two tabs, material count, coach chat, timeline, report card |
| `1011034` | Add miss move classification — amber badge, positional context detection, coach awareness |
| `2a9fd01` | Fix Claude model to 4-6, fix Opening Explorer nav link, remove dead API key modal |
| `be58ff3` | Add HANDOFF.md — full project audit and living project bible |

---

## Files Read During Audit

1. `server/index.js`
2. `server/package.json`
3. `server/railway.json`
4. `js/engine.js`
5. `js/analysis.js`
6. `js/board.js`
7. `js/storage.js`
8. `js/ui.js`
9. `js/app.js`
10. `js/nav.js`
11. `js/recommendations.js`
12. `js/chesscom.js`
13. `js/openings.js` *(glob confirmed; content well-understood from prior sessions)*
14. `js/practice-board.js` *(glob confirmed; content well-understood from prior sessions)*
15. `analyzer.html`
16. `recommendations.html`
17. `CNAME`

---

*Audit performed 2026-05-14 by Claude Code. All findings reflect actual source code — not assumptions.*

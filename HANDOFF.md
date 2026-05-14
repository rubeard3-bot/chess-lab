# Chess Lab — Project Handoff Document

> Generated from full codebase audit on 2026-05-14.  
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
| AI | Anthropic Claude API | Key stored in Railway env var only |
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
| Claude model | `claude-sonnet-4-5` | **Outdated** — current family is 4-6 |
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
│   ├── app.js                # Main controller, 809 lines
│   ├── analysis.js           # Analysis pipeline (PGN→Stockfish→Claude), 312 lines
│   ├── board.js              # Canvas board for analyzer, 242 lines
│   ├── ui.js                 # All UI/DOM rendering, 918 lines
│   ├── engine.js             # Stockfish Web Worker wrapper, 201 lines
│   ├── storage.js            # localStorage CRUD, 65 lines
│   ├── nav.js                # Navigation drawer, 83 lines
│   ├── chesscom.js           # Chess.com API client, 55 lines
│   ├── openings.js           # Opening Explorer + Trainer, 1554 lines
│   ├── practice-board.js     # Practice board, 641 lines
│   ├── chess.js              # chess.js 0.10.3 minified
│   ├── stockfish.js          # Stockfish 18 WASM worker (minified)
│   └── stockfish.wasm        # WASM binary
│
├── css/
│   └── styles.css            # Global styles, 4003 lines
│
├── index.html                # Homepage / ELO tracker, 881 lines
├── analyzer.html             # Game Analyzer, 320 lines
├── recommendations.html      # Recommendations dashboard, 561 lines
├── archive.html              # Game archive, 195 lines
├── import.html               # Chess.com import + mass import, 511 lines
├── openings.html             # Opening Explorer, 868 lines
├── practice.html             # Practice board, 591 lines
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
| Move classification (7 tiers) | Live | `analysis.js classifyMoves()` |
| Accuracy score | Live | `analysis.js calculateAccuracy()` |
| Claude coaching feedback | Live | `analysis.js callClaude()` |
| Canvas board with navigation | Live | `board.js` |
| localStorage persistence (50-game cap) | Live | `storage.js` |
| Game archive with search/filter | Live | `archive.html` |
| Chess.com single game import | Live | `chesscom.js`, `import.html` |
| Chess.com mass import (bulk queue) | Live | `import.html`, sessionStorage queue |
| Coach Recommendations (3-call) | Live | `server/index.js` /api/recommendations |
| Opening Explorer (Lichess data) | Live | `openings.js`, `openings.html` |
| Opening Trainer (drill/hint/reveal) | Live | `openings.js` |
| Practice Board with Stockfish | Live | `practice-board.js`, `practice.html` |
| ELO tracker with SVG graph | Live | `index.html` |
| "Opening Explorer" nav link | **BROKEN** | `nav.js` — shows "Coming Soon" toast instead of linking |
| Middlegame notes panel | **DEAD UI** | `ui.js renderGameNotes()` — Claude never generates this field |
| Endgame notes panel | **DEAD UI** | Same as above |
| Alternate moves panel | **DEAD UI** | `ui.js renderAlternateMoves()` — field never populated |
| `miss` move badge | **MISSING** | Classification exists, `CLASS_BADGE` in `ui.js` omits it |
| Settings / API key input | **DEAD** | Stores `csa_api_key` in localStorage; key is never used |
| Partial failure banner (recommendations) | **BROKEN** | `_partialFailure` checked on Response object, not parsed JSON |
| SSE / streaming progress | **NOT BUILT** | Stockfish progress is WASM-side only |
| Study streak counter | **INCOMPLETE** | UI element in index.html; no tracking logic found |

---

## 6. Full Analysis Flow

```
User pastes PGN
    → analysis.js parsePGN()          — validate, extract headers + verbose move history
    → engine.js analyzeAllPositions() — Stockfish Web Worker, depth 20
         → one SF call per board position (init + N positions)
         → returns: eval (pawns), bestMoveUci, bestMoveSan, pvSan[]
    → analysis.js classifyMoves()     — win% loss thresholds → 7-tier classification
    → analysis.js calculateAccuracy() — Lichess formula per player
    → board.js renders immediately    — board visible before Claude returns
    → analysis.js callClaude()        — POST to /api/analyze (async, non-blocking)
         → server/index.js /api/analyze — thin proxy, forwards to Anthropic
         → Claude returns: summary, opening{}, moveExplanations[]
    → analysis.js buildAnalysis()     — merge Stockfish + Claude into single object
    → storage.js saveGame()           — persist to localStorage
    → ui.js renders full analysis     — move list, coach panel, opening panel
    → auto-trigger recommendations    — if new game saved, refresh /api/recommendations
```

**Board renders before Claude returns.** Claude call is non-blocking — the board and move classifications are visible immediately after Stockfish completes. Coaching text fades in when Claude responds.

---

## 7. Railway Endpoints

### POST /api/analyze
Thin proxy to Anthropic. Forwards `{ model, max_tokens, messages, system? }` directly.  
Used by `analysis.js` for per-game coaching. Max tokens: 8000.

### POST /api/recommendations
Aggregates game history, fires 3 Claude calls in parallel via `Promise.all`.  
Input: `{ games: [...] }` — array of stored game objects.  
Output: merged JSON from 3 prompts (core analysis, openings/tactics, study plan).  
Max tokens per call: 4000.

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
| `csa_recommendations` | Object | Latest recommendations JSON from 3-call Claude | `recommendations.html` | 1 entry |
| `csa_opening_scores` | Object | Opening Trainer drill scores per opening | `openings.js` | Unbounded |
| `csa_api_key` | String | **DEAD** — stored by Settings modal, never read | `index.html` | — |

**sessionStorage keys** (page-lifetime only):

| Key | Purpose |
|---|---|
| `csa_import_queue` | JSON array of PGNs for mass Chess.com import |
| `csa_import_index` | Current position in mass import queue |
| `csa_pending_pgn` | Single PGN passed from import.html to analyzer.html |
| `csa_export_line` | Opening line passed from openings.html for external use |

---

## 9. Config Values

| Setting | Value | File | Notes |
|---|---|---|---|
| Claude model | `claude-sonnet-4-5` | `server/index.js:11`, `analysis.js:5` | Outdated; 4-6 is current |
| Railway URL | `https://chess-lab-production.up.railway.app` | `analysis.js:3-4`, `openings.js:5` | |
| Stockfish depth (analyzer) | `20` | `engine.js:3` | |
| Stockfish depth (practice board) | `18` | `practice-board.js` | Inconsistency vs analyzer |
| Max stored games | `50` | `storage.js` | Enforced by `pruneOldGames()` |
| Rate limit | `10 req / 60s` | `server/index.js:32-37` | Shared across all routes |
| Theory cache size | `200 entries` | `server/index.js:402` | In-memory only |
| Max tokens — analyze | `8000` | `analysis.js:219` | |
| Max tokens — recommendations | `4000 × 3` | `server/index.js:89` | Per call |
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

`analysis.js` auto-switches Railway URL ↔ localhost:4000 based on `window.location.hostname === 'localhost'`.

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
A single prompt combining all analysis sections would approach Claude's context limits for large game histories. Splitting into Core Analysis, Openings/Tactics, and Study Plan keeps each prompt focused and allows parallel execution, reducing total latency.

---

## 12. Known Issues (Confirmed by Audit)

### High Priority

1. **`miss` moves have no visual badge**  
   `CLASS_BADGE` in `ui.js` (lines 134-140) is missing the `'miss'` key. Miss-classified moves (blunders from a winning position — a meaningful category) are visually indistinguishable from unclassified moves. Add `miss: 'Miss'` to CLASS_BADGE and a corresponding CSS class.

2. **"Opening Explorer" nav shows "Coming Soon"**  
   `nav.js` lines 63-69 handle `nav-openings-btn` by showing a "Coming soon!" toast. This fires on the homepage nav drawer. The page is fully built at `openings.html`. Fix: replace the toast handler with `window.location.href = 'openings.html'`.

3. **Outdated Claude model**  
   `server/index.js:11` and `analysis.js:5` both reference `claude-sonnet-4-5`. The current production model family is `claude-sonnet-4-6`. Update both references.

4. **`_partialFailure` check is broken**  
   In `recommendations.html`, `if (response._partialFailure)` tests the `Response` object, not the parsed body. The partial-failure warning banner can never appear. Fix: check the parsed JSON data object instead.

### Medium Priority

5. **Dead Settings modal / API key**  
   `index.html` Settings modal prominently asks for an Anthropic API key and saves it to `csa_api_key` in localStorage. The key is never read anywhere. This misleads users into thinking they must supply a key. Remove the API key input from the modal, or repurpose the Settings modal entirely.

6. **Middlegame/endgame notes — dead UI panels**  
   `ui.js renderGameNotes()` renders `#middlegame-notes` and `#endgame-notes` panels, but the Claude prompt in `analysis.js callClaude()` never requests these fields. Panels always hidden. Either add the fields to the Claude prompt, or remove the UI panels.

7. **`alternateMoves` — dead UI panel**  
   `ui.js renderAlternateMoves()` expects `moveData.alternateMoves` but this is never in the Claude response. Panel always shows "No alternate suggestions." Either add `alternateMoves` to the Claude prompt, or remove the panel.

### Low Priority

8. **Stockfish depth inconsistency**  
   Analyzer: depth 20 (`engine.js`). Practice board: depth 18 (`practice-board.js`). Intentional trade-off (practice is interactive) but undocumented.

9. **No fetch timeout on Claude calls**  
   Neither `analysis.js callClaude()` nor any server endpoint uses an `AbortController`. A hung Anthropic API call can block the client indefinitely (up to Railway's 30s request timeout).

10. **Race condition on async Claude return**  
    If the user starts a second analysis while Claude is still processing the first, the async callback from the first call may overwrite `state.analysisData` with stale data. No cancellation token exists.

11. **In-memory theory cache resets on deploy**  
    `/api/theory` cache is a `Map()`. Every Railway deploy clears it. For a frequently-accessed opening, this generates redundant API calls. Not critical, but worth noting if costs increase.

---

## 13. Build Roadmap

Items identified from dead code and incomplete UI (not a committed roadmap — inferred from code state):

- [ ] Fix `miss` badge in `CLASS_BADGE`
- [ ] Fix Opening Explorer nav link (remove "Coming Soon")
- [ ] Update Claude model to `claude-sonnet-4-6`
- [ ] Fix `_partialFailure` check in recommendations.html
- [ ] Either implement or remove middlegame/endgame notes
- [ ] Either implement or remove alternate moves panel
- [ ] Remove dead API key Settings modal or replace with useful settings
- [ ] Implement study streak tracking (counter exists in UI)
- [ ] Add AbortController to fetch calls with reasonable timeout
- [ ] Fix race condition in async Claude callbacks

---

## 14. Connected Learning Loop

The "connected learning loop" works as follows:

1. User analyzes a game → stored to `localStorage` as `csa_game_{id}`
2. After each save, `app.js` triggers `/api/recommendations` with all stored games
3. `/api/recommendations` fires 3 parallel Claude calls with full game history
4. Results stored to `csa_recommendations` in localStorage
5. `recommendations.html` reads `csa_recommendations` on load and renders the dashboard
6. Opening Trainer stores per-opening drill scores in `csa_opening_scores`
7. `recommendations.html renderPatternsSummary()` reads `csa_recommendations` to surface recurring patterns

The loop is: analyze game → get move-level feedback → see cross-game patterns → drill weak openings → re-analyze future games.

---

## 15. Commercialization Notes

Current state: single-user, no auth, no billing, no user accounts.

- All game data is client-side only (localStorage). No user database.
- Claude API costs are server-side and paid by the operator (Railway env var key).
- Rate limit (10 req/60s) is the only cost protection mechanism.
- No per-user metering, no usage caps per user, no payment integration.
- The Settings modal implies per-user API keys but this is currently dead code.

If commercializing: the most natural path is per-user API key passthrough (user provides own Anthropic key) or operator-pays with subscription auth. The Settings modal skeleton exists for the former path but is not wired up.

---

## 16. Accuracy Formula

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

| Classification | Condition |
|---|---|
| `best` | Played move == engine's top move (UCI match) |
| `excellent` | wpl ≤ 1 |
| `good` | wpl ≤ 3 |
| `inaccuracy` | wpl ≤ 7 |
| `mistake` | wpl ≤ 15 |
| `miss` | wpl > 15 AND mover was already winning (≥ 2 pawns ahead) |
| `blunder` | wpl > 15 (not a miss) |

---

## 17. Recent Changes Log

Based on git log at time of audit:

| Commit | Change |
|---|---|
| `4da2df2` | Parallel recommendation calls, instant board render, coach loading state |
| `b84c877` | Add Opening Trainer mode — drill system, hint/reveal, weak spot tracking, localStorage scores |
| `cf63a8b` | Fix opening explorer piece movement |
| `a69252f` | Interactive opening explorer board |
| `7b91e7a` | Add Opening Explorer with Lichess API and practice mode |

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
11. `js/chesscom.js`
12. `js/openings.js`
13. `js/practice-board.js`
14. `index.html`
15. `analyzer.html`
16. `recommendations.html`
17. `archive.html`
18. `import.html`
19. `openings.html`
20. `practice.html`
21. `css/styles.css`
22. `CNAME`

---

*Audit performed 2026-05-14 by Claude Code. All findings reflect actual source code — not assumptions.*

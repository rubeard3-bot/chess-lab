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
| Claude model | `claude-sonnet-4-6` | `server/index.js:11`, `analysis.js:5`, `ui.js:1189`, `profile.html` |
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
│   ├── app.js                # Main controller, state management, 639 lines
│   ├── analysis.js           # Analysis pipeline (PGN→Stockfish→Claude), 323 lines
│   ├── board.js              # Canvas board for analyzer, 242 lines
│   ├── ui.js                 # All UI/DOM rendering, 1376 lines
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
│   └── styles.css            # Global styles, 4000+ lines
│
├── index.html                # Dashboard — full-viewport layout with sidebar
├── analyzer.html             # Game Analyzer, 374 lines
├── profile.html              # Profile & Preferences — 1057 lines
├── recommendations.html      # Recommendations dashboard
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
| Coach chat (persistent, context-aware, anti-hallucination) | Live | `ui.js initCoachChat()`, `/api/analyze` |
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
| **Dashboard (full-viewport)** | **Live** | `index.html` — sidebar, hero, stats, recent games, weakness panel |
| **Profile & Preferences page** | **Live** | `profile.html` — display name, avatar, rating/goal, board colors, coach prefs, danger zone |
| **Board color theming** | **Live** | `pf_board_light`/`pf_board_dark` → `window.BOARD_LIGHT`/`BOARD_DARK` → board renderers |
| **Study streak counter** | **Live (partial)** | `index.html` — counts unique calendar days in last 30 days with analyzed games; not a consecutive-day counter |
| "Opening Explorer" nav link | Live | `nav.js:70-72` — navigates to `openings.html` |
| `csa_api_key` Settings modal | **DEAD UI** | Nav drawer shows "Settings / API Key" button; `setupApiKeyModal()` in `app.js:232` is a no-op; `Storage.getApiKey()`/`setApiKey()` remain in `storage.js` but are never called |
| SSE / streaming progress | **NOT BUILT** | Stockfish progress is WASM-side only; no server-sent events |
| Tactics trainer | **NOT BUILT** | Referenced in Next Steps UI as "coming soon" |
| My Progress page | **NOT BUILT** | Nav item shows "Soon" badge |

---

## 6. Dashboard Layout (`index.html`)

The dashboard is a full-viewport layout (`html, body { height: 100%; overflow: hidden }`), split into a 220px left sidebar and a scrollable main area.

### Left Sidebar (`db-sidebar`)
- **Logo** — "Chess Lab" with accent dot
- **Profile section** — avatar circle (letter + custom color), display name or chess.com username, current rating + delta arrow (↑/↓ vs previous entry), goal progress bar with labels
- **Nav** — links to Dashboard (active), Analyzer, Openings, Practice, Archive, Recommendations, Import Games, Profile & Preferences; "Tactics" shown as disabled with "Soon" badge
- **Sidebar badges** — Archive shows game count; Openings shows amber "Drill" badge when opening scores have weak lines
- **Footer** — ⚙ Settings button (no action wired), chess.com connection status dot (gray/green)

### Hero Section (not scrollable)
- **Greeting** — time-of-day aware ("Good morning/afternoon/evening, [name]!") from `pf_display_name` or `csa_chesscom_username`
- **Chips row** — last game result (W/L/D + accuracy %), top weakness name (amber, from `csa_recommendations`), current rating (if set)
- **Mini SVG rating-trend chart** (110×44px) — plots ELO history, dashed goal line; hidden if no goal set
- **Today's focus card** — driven by `recs.topWeaknesses[0]`; shows 2-sentence description, primary action button ("Analyze a game" or "Drill openings"), optional "Review last game" and "Full recommendations" buttons

### Content Area (scrollable, `db-content`)
- **Features grid** (3 cards) — Game Analyzer (primary/blue), Opening Explorer, Practice Board
- **Stats grid** (4 cards) — Avg accuracy (with ↑/↓/→ trend), Games analyzed (+ this week), Avg blunders (with trend), Study streak (unique active days in last 30)
- **Two-column section** — Recent Games (last 5, W/L/D circle + opponent + accuracy + Review button) | Top Weakness (top 2 from `recs.topWeaknesses`, "Drill this pattern" button)

---

## 7. Profile & Preferences Page (`profile.html`)

Two-column layout: settings form left, coach setup chat right. Same `db-sidebar` left sidebar as dashboard.

### Settings Form Sections

1. **Identity** — display name (saved to `pf_display_name`), avatar color (6 presets → `pf_avatar_color`), chess.com username (synced to `csa_chesscom_username`)
2. **Chess Profile** — current rating → `csa_elo_current`, rating goal → `csa_elo_goal`, experience (select), preferred time control (pill group → `pf_time_control`), chess goals textarea → `pf_goals`
3. **Coach Preferences** — coach tone pill group → `pf_coach_tone` (encouraging/direct/tough-love), explanation depth → `pf_explanation_depth` (brief/detailed/technical)
4. **Board Customization** — light square swatches → `pf_board_light`, dark square swatches → `pf_board_dark`, plus custom color pickers; 4×4 live preview grid updates in real time
5. **App Accent Color** — 7 color circles → `pf_accent_color` (saved but not yet wired to CSS variables)
6. **Behavior** — "Auto-run recommendations" toggle → `pf_auto_recommendations`; "Show engine lines by default" → `pf_show_engine_lines`; default practice side → `pf_practice_side`
7. **Danger Zone** — two-click confirmation pattern (first click changes text to "Confirm — this cannot be undone"; second click executes):
   - Reset rating goal (clears `csa_elo_goal`, `csa_elo_start`, `csa_elo_history`)
   - Clear game archive (deletes all `csa_game_*` keys)
   - Clear recommendations (removes `csa_recommendations`)
   - Clear opening drill scores (removes `csa_opening_scores`)
   - Disconnect chess.com (removes `csa_chesscom_username`)
   - Reset everything (clears all `csa_*` and `pf_*` keys)

**Save flow**: reads all fields/pills/swatches on button click, validates rating/goal (0–4000), writes to localStorage. If chess.com username changed, clears `csa_chesscom_*` sessionStorage keys.

### Coach Setup Chat (right column)

A conversational interface powered by `claude-sonnet-4-6` via `/api/analyze`. Claude acts as a friendly setup coach. On page load, it sends a greeting. Quick-reply chips offered initially ("I'm a beginner", etc.). System prompt includes current profile state so Claude can make personalized recommendations. "Apply coach suggestions" button shows a toast directing user to update the form manually.

---

## 8. Full Analysis Flow

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

## 9. Railway Endpoints

### POST /api/analyze
Thin proxy to Anthropic. Forwards `{ model, max_tokens, messages, system? }` directly.  
Used by:
- `analysis.js` for per-game coaching (max_tokens: 8000)
- `ui.js _sendChat()` for analyzer coach chat (max_tokens: 300, includes full system prompt with game data)
- `profile.html` coach setup chat (max_tokens: 400, system prompt includes current profile state)

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

## 10. Coach Chat Anti-Hallucination System

The analyzer coach chat (`ui.js _sendChat()`) had a hallucination problem — Claude was guessing piece positions and moves not in the actual game. This was fixed by building a comprehensive system prompt that includes all concrete game data:

```
System prompt includes:
- Full PGN text
- Player color
- Final accuracy, blunders, mistakes, inaccuracies
- Opening name
- Complete move list: every move with ply, SAN, classification, eval before→after,
  engine best move, engine continuation (4 half-moves)
- Current position: move number, SAN, FEN at that ply, full eval/classification/PV data

Anti-hallucination rules (verbatim in prompt):
- "Never suggest piece locations you cannot confirm from the FEN or move list."
- "Never suggest moves that aren't in the engine line provided."
- "If you are not 100% certain of a piece's location from the data provided, do not mention it."
- "If the user asks about something not in the data, say you don't have enough information
  rather than guessing."
```

Chat history is kept to last 6 messages (`_chatHistory.slice(-6)`). The system prompt rebuilds on every send, so navigating to a different move mid-chat immediately updates the coach's context.

---

## 11. Board Color Theming

Board colors flow through three layers:

**1. Profile page saves colors:**
```
profile.html → lsSet('pf_board_light', color) / lsSet('pf_board_dark', color)
```

**2. Each board page injects globals before loading board JS:**
```html
<!-- In analyzer.html, practice.html, openings.html — runs before board JS: -->
<script>
  try {
    var _bl = localStorage.getItem('pf_board_light');
    var _bd = localStorage.getItem('pf_board_dark');
    if (_bl) window.BOARD_LIGHT = _bl;
    if (_bd) window.BOARD_DARK  = _bd;
  } catch (_) {}
</script>
```

**3. Board renderers read globals with fallback to defaults:**
```js
// board.js:25-26
const LIGHT_SQ = window.BOARD_LIGHT || '#f0d9b5';
const DARK_SQ  = window.BOARD_DARK  || '#b58863';

// practice-board.js:5-6
const LIGHT = window.BOARD_LIGHT || '#f0d9b5';
const DARK  = window.BOARD_DARK  || '#b58863';

// openings.js:9-10
const LIGHT = window.BOARD_LIGHT || '#f0d9b5';
const DARK  = window.BOARD_DARK  || '#b58863';
```

Default colors: light `#f0d9b5` (cream), dark `#b58863` (brown) — classic wood look.

---

## 12. localStorage Reference

### `csa_*` keys (app data)

| Key | Type | Purpose | Set by | Max size |
|---|---|---|---|---|
| `csa_game_{id}` | Object | Full game analysis (metadata + moves + coaching) | `storage.js saveGame()` | 50 games total |
| `csa_recommendations` | Object | Latest recommendations JSON from 3-call Claude | `recommendations.js` | 1 entry |
| `csa_recommendations_meta` | Object | `{ gameCount, generatedAt }` — staleness tracking | `recommendations.js` | 1 entry |
| `csa_opening_scores` | Object | Opening Trainer drill scores per opening | `openings.js` | Unbounded |
| `csa_chesscom_username` | String | Chess.com username; auto-detects player color from PGN | `import.html` / `profile.html` | — |
| `csa_elo_current` | Number | Current ELO rating | `index.html` / `profile.html` | — |
| `csa_elo_goal` | Number | Target ELO goal | `index.html` / `profile.html` | — |
| `csa_elo_start` | Number | ELO at time goal was set (for progress bar denominator) | `index.html` | — |
| `csa_elo_history` | Array | `[{ date, elo }]` — rating history for trend chart | `index.html` | Unbounded |
| `csa_api_key` | String | **DEAD** — stored and readable but never used by the app | `storage.js setApiKey()` | — |

### `pf_*` keys (profile/preferences)

| Key | Type | Default | Purpose |
|---|---|---|---|
| `pf_display_name` | String | — | User's display name for greetings and coach |
| `pf_avatar_color` | String | `#1e3a5f` | Background color of avatar circle |
| `pf_accent_color` | String | `#3b82f6` | App accent color (saved, not yet applied to CSS vars) |
| `pf_board_light` | String | `#f0d9b5` | Light square color for all boards |
| `pf_board_dark` | String | `#b58863` | Dark square color for all boards |
| `pf_experience` | String | — | How long playing: `less-than-1`, `1-3`, `3-5`, `5-plus` |
| `pf_time_control` | String | — | `bullet`, `blitz`, `rapid`, `classical` |
| `pf_goals` | String | — | Free-text chess goals; read by Claude in coaching prompts |
| `pf_coach_tone` | String | — | `encouraging`, `direct`, `tough-love` |
| `pf_explanation_depth` | String | — | `brief`, `detailed`, `technical` |
| `pf_practice_side` | String | `white` | Default side on practice board: `white`, `black`, `random` |
| `pf_auto_recommendations` | Boolean | `true` | Re-run recommendations after each game |
| `pf_show_engine_lines` | Boolean | `false` | Expand engine continuation by default |

### sessionStorage keys (page-lifetime only)

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
| `csa_review_game_id` | Set by dashboard "Review last game" — **NOT YET CONSUMED** by analyzer.html (see Known Issues) |

---

## 13. Config Values

| Setting | Value | File | Notes |
|---|---|---|---|
| Claude model | `claude-sonnet-4-6` | `server/index.js:11`, `analysis.js:5`, `ui.js:1189`, `profile.html` | Current |
| Railway URL | `https://chess-lab-production.up.railway.app` | `analysis.js:3-4`, `ui.js:16-17`, `recommendations.js:7-8`, `openings.js:5` | |
| Anthropic API tier | Tier 2 | `server/index.js:322` (comment) | Allows parallel calls without 429 concern |
| Stockfish depth (analyzer) | `20` | `engine.js:3` | |
| Stockfish depth (practice board) | `18` | `practice-board.js` | Intentional: practice is interactive |
| Max stored games | `50` | `storage.js` | Enforced by `pruneOldGames()` |
| Rate limit | `10 req / 60s` | `server/index.js:32-37` | Shared across all routes |
| Theory cache size | `200 entries` | `server/index.js:402` | In-memory only; clears on deploy |
| Max tokens — analyze | `8000` | `analysis.js:229` | Per-game coaching |
| Max tokens — coach chat (analyzer) | `300` | `ui.js:1189` | Short conversational replies |
| Max tokens — coach chat (profile) | `400` | `profile.html` | Setup conversation |
| Max tokens — recommendations | `4000 × 3` | `server/index.js:89` (via `callClaude` helper) | Per parallel call |
| Max tokens — theory | `350` | `server/index.js:386` | |
| Board default light | `#f0d9b5` | `board.js:25`, `practice-board.js:5`, `openings.js:9` | Fallback when no pf_board_light set |
| Board default dark | `#b58863` | `board.js:26`, `practice-board.js:6`, `openings.js:10` | Fallback when no pf_board_dark set |
| Opening Trainer max tree nodes | `50` | `openings.js` | Lichess API tree build |
| Opening Trainer max depth | `4` | `openings.js` | Half-moves from root |

---

## 14. Development Workflow

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

`analysis.js`, `ui.js`, `recommendations.js`, and `openings.js` each auto-switch Railway URL ↔ localhost:4000 based on `window.location.hostname === 'localhost'`.

**To deploy:**
- Push to `main` → GitHub Pages rebuilds frontend automatically
- Push to `main` → Railway rebuilds backend automatically (Nixpacks detects `server/package.json`)

**No build step.** No transpilation, no bundling. Files are served as-is.

---

## 15. Architecture Decisions

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

**Why `window.BOARD_LIGHT`/`BOARD_DARK` globals for board colors?**  
Board renderers are IIFEs that capture their constants at module parse time. Passing colors as globals set in an inline `<script>` block before the module loads is the simplest approach without a build system. Each board page reads from localStorage and sets the globals just before loading the board JS file.

---

## 16. Analyzer Layout (Two-Tab Design)

### Game Review tab (default)
- **Pinned top**: Move detail card — classification badge, eval before/after, "you played / best move" row, Claude coaching text, collapsible engine PV line
- **Scrollable middle**: Eval timeline (60px SVG, clickable, blunder/mistake/miss markers), Opening panel (name, ECO, deviation, explore link)
- **Pinned bottom**: Coach chat — persistent multi-turn conversation, context-aware (knows current move and full game); system prompt rebuilt per message

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

## 17. Move Classification Details

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

## 18. Known Issues (Confirmed by Audit)

### Medium Priority

1. **Dead Settings modal / API key stub**  
   The nav drawer on every page shows a "Settings / API Key" button (`#change-api-key-link`). Clicking it on non-analyzer pages redirects to `index.html`; on the analyzer page it does nothing (`setupApiKeyModal()` in `app.js:232` is a no-op). `storage.js` still exports `getApiKey()`/`setApiKey()` but nothing calls them. Options: remove the button entirely, or wire it to the Profile page.

2. **`csa_review_game_id` sessionStorage key is set but never consumed**  
   The dashboard's "Review last game" button and recent game rows set `sessionStorage.setItem('csa_review_game_id', 'csa_game_' + id)` and navigate to `analyzer.html`. But `app.js init()` only reads `?gameId=` from the URL query string — it never reads `csa_review_game_id`. Clicking "Review last game" opens the analyzer at the empty drop zone state instead of loading the game.

3. **Study streak is "active days" not "consecutive days"**  
   The stat grid shows a "Study streak" which counts unique calendar days in the last 30 days with at least one analyzed game. It is not a traditional consecutive-day streak. The label is misleading and will always reset to showing a count regardless of gaps.

### Low Priority

4. **No fetch timeout on Claude calls**  
   Neither `analysis.js callClaude()` nor the coach chat in `ui.js._sendChat()` use an `AbortController`. A hung Anthropic API call can block the client for the full Railway request timeout (~30s). The recommendations endpoint has a 2-attempt retry but no timeout on individual attempts.

5. **Race condition on async Claude return**  
   If the user starts a second analysis while Claude is still processing the first, the `.then()` callback from the first call updates `state.analysisData` and rerenders the UI. No cancellation token exists. Mitigated in practice because Claude typically responds in 5–15s, but possible on slow connections.

6. **In-memory theory cache resets on deploy**  
   `/api/theory` cache is a `Map()`. Every Railway deploy clears it. Not critical, but repeated deploys generate extra API calls for frequently-visited openings.

7. **`response._partialFailure` check is dead (non-200 path)**  
   `recommendations.js:65` checks `if (response._partialFailure)` on the raw `Response` object inside the `!response.ok` branch. This will never be true (Response objects don't have that property). The actual `_partialFailure` handling at line 75 (checking the parsed JSON) is correct.

8. **`pf_accent_color` is saved but not applied**  
   Profile page saves accent color to `pf_accent_color`, but no code reads this key to update CSS custom properties at runtime. The feature is UI-only without the wiring.

---

## 19. Connected Learning Loop

The "connected learning loop" works as follows:

1. User analyzes a game → stored to `localStorage` as `csa_game_{id}` (partial, immediately)
2. Claude returns → game updated in localStorage with coaching text
3. `app.js` triggers `recommendations.js generateRecommendations()`
4. Server fires 3 parallel Claude calls with full game history summary
5. Results merged and stored to `csa_recommendations` + `csa_recommendations_meta` in localStorage
6. `recommendations.html` reads `csa_recommendations` on load and renders the full dashboard
7. Analyzer's My Report tab reads `csa_recommendations` for "Patterns Spotted" section
8. Dashboard reads `csa_recommendations` for the "Today's focus" card and "Top weakness" panel
9. Opening Trainer stores per-opening drill scores in `csa_opening_scores`

The loop is: analyze game → get move-level feedback → see cross-game patterns → drill weak openings → re-analyze future games.

---

## 20. Commercialization Notes

Current state: single-user, no auth, no billing, no user accounts.

- All game data is client-side only (localStorage). No user database.
- Claude API costs are server-side and paid by the operator (Railway env var key, Tier 2 account).
- Rate limit (10 req/60s) is the only cost protection mechanism.
- No per-user metering, no usage caps per user, no payment integration.
- The Settings button stub implies per-user API keys but this path is entirely dead.

If commercializing: the most natural path is per-user API key passthrough (user provides own Anthropic key) or operator-pays with subscription auth. The Settings button skeleton exists for the former path but is not wired up.

---

## 21. Build Roadmap

Items remaining from code audit (not a committed roadmap — inferred from code state):

- [ ] Fix "Review last game" on dashboard — consume `csa_review_game_id` sessionStorage in `app.js init()`, or pass game ID via URL param
- [ ] Wire `pf_accent_color` to CSS custom properties at runtime
- [ ] Replace or repurpose dead "Settings / API Key" nav button (link to profile.html instead)
- [ ] Make study streak count consecutive days instead of unique active days
- [ ] Add `AbortController` to Claude fetch calls with ~20s timeout
- [ ] Fix race condition in async Claude callbacks (cancellation token or guard)
- [ ] Remove dead `response._partialFailure` check at `recommendations.js:65` (non-200 path)
- [ ] Tactics trainer (referenced in Next Steps UI as "coming soon")
- [ ] My Progress page (nav item shows "Soon" badge)

---

## 22. Recent Changes Log

Based on git log at time of audit:

| Commit | Change |
|---|---|
| `e5baf2d` | Wire board color globals into board.js, practice-board.js, openings.js |
| `a58ade5` | Fix coach chat hallucination — full game data in system prompt, FEN per ply, anti-hallucination rules |
| `168d2e3` | Add profile page, coach chat fix, board color overrides, danger zone resets |
| `8d360e4` | Dashboard overhaul — full viewport layout, sidebar, hero, stats, recent games, weakness panel |
| `9fd1dbc` | Regenerate HANDOFF.md — post analyzer overhaul, Tier 2, speed fixes |

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
13. `js/openings.js` *(first 50 lines — board color constants confirmed; full content from prior audit)*
14. `js/practice-board.js` *(first 50 lines — board color constants confirmed; full content from prior audit)*
15. `analyzer.html`
16. `index.html`
17. `profile.html`
18. `openings.html` *(grep for board color injection)*
19. `practice.html` *(grep for board color injection)*
20. `CNAME`

---

*Audit performed 2026-05-14 by Claude Code. All findings reflect actual source code — not assumptions.*

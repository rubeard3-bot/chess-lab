# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This is the **primary project document**. It holds the durable context (what Chess Lab is, how it's built, and the hard-won rules). `HANDOFF.md` is the running dated log of sessions; `COMMAND_LOG.md` is the append-only log of prompts. `memory.md` is **deprecated** — its content has been folded in here.

---

## Conventions (MANDATORY — these fire every turn)

These are standing instructions. Conventions 1 and 3 apply to **substantive turns** — any turn that changes code or docs, or makes a real decision. Skip them for trivial/no-op turns (e.g. answering a quick question with no code or doc change). Conventions 2, 4, and 5 always apply.

1. **Log the prompt to `COMMAND_LOG.md`.** On a substantive turn, append the user's prompt text to `COMMAND_LOG.md` with a timestamp (newest at the bottom).
2. **Ask clarifying questions as they come up — do not batch them to the end.** The moment a real decision arises mid-task (an ambiguous requirement, a fork in approach, a destructive or irreversible step), stop and ask *then*. Also keep a final "any questions?" check at the end of each task. Don't sit on a blocking question until the end.
3. **Append a dated entry to `HANDOFF.md`.** On a substantive turn, document what was done, the current state, and clear next steps. `HANDOFF.md` is the running session log — add to it, don't rewrite it.
4. **Keep the "Current State" section of this file concise — under ~40,000 characters.** When it grows past that, summarize and prune older detail (move durable "why" decisions into the architecture sections, drop stale specifics) rather than letting it bloat. Older session detail lives in `HANDOFF.md`, not here.
5. **Docs are not code.** Never change application code when the task is documentation-only.

### Engineering guardrails (carried over, still binding)
- **`js/memory.js` and `js/storage.js` are protected files.** Don't casually edit them. The Stop hook flags them whenever they appear in a changeset (see Stop hook below). Editing them is a deliberate, called-out act.
- **`chess.js` stays at 0.10.3 — do not upgrade.** v1.x broke API compatibility (`.moves()` returns strings not objects; `.history({verbose:true})` changed). Upgrading requires auditing every `.move()`, `.history()`, `.moves()` call across all JS.
- **A `hidden` class must have a CSS rule that actually hides it.** An element with `class="… hidden"` and no matching hiding rule (a scoped `.cls.hidden`/`#id.hidden`, or a generic `.hidden{display:none}` reachable from that page) renders *visible* — this bug froze the board twice. The Stop hook checks for it.
- **No build step. Ever.** Vanilla HTML/CSS/JS pushed straight to Pages. Don't introduce a bundler, transpiler, or framework.

---

## Project Overview

**Chess Lab** (live at **chesslab.live**) is a chess game analyzer and coaching web app. A player imports their games (PGN paste or Chess.com username), and the app reviews each game move-by-move with Stockfish, classifies every move, draws an evaluation graph and best-move arrows, and layers Claude-generated coaching narrative on top. It also has a practice board (Free Play, Play the Coach, Opening Drill, Weakness Drill), an opening explorer backed by the Lichess database, and a persistent **Coaching Memory System** that accumulates patterns across games over time.

**Live infrastructure:**
- **Frontend:** static files on **GitHub Pages** at chesslab.live. The `CNAME` file pins the custom domain. **Push to `main` = live** (no build, no bundler).
- **Backend:** a thin **Node/Express proxy on Railway** (`chess-lab-production.up.railway.app`), auto-deploys on push to `main` from the `server/` subdir. Its only job is to hold the API keys: it proxies the **Anthropic API** (Claude coaching) and the **Lichess** opening explorer. The Anthropic key never reaches the client. Keys (`ANTHROPIC_API_KEY`, `LICHESS_API_TOKEN`) live in the Railway dashboard, never committed.
- **Engine:** **Stockfish 18 lite (WASM)** runs entirely **in-browser** in a Web Worker — no server-side analysis.
- **Persistence:** **localStorage only.** No database, no accounts, no auth. 50-game cap. User data stays on-device (no GDPR/account complexity). Supabase auth + Stripe are deferred backlog.
- **External APIs:** Lichess (proxied through Railway, needs a Bearer token), Chess.com public API (called **directly** from the client, no auth needed).

There is **no test suite**.

### Running locally

```bash
# Frontend — any static server. file:// will NOT work (WASM + IIFE scripts need HTTP).
python -m http.server 8000      # then open http://localhost:8000/index.html

# Backend — only needed to exercise Claude coaching / Lichess explorer locally
cd server && npm install
# set ANTHROPIC_API_KEY and LICHESS_API_TOKEN in the environment
npm start                       # listens on :4000
```

The frontend auto-targets `http://localhost:4000` when served from `localhost`, else the Railway prod URL. So Chess.com fetches and Stockfish work without the backend; only Claude coaching and the Lichess explorer need it. `SETUP.md` is the authoritative run/deploy reference.

---

## Tech Stack & Architecture

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | Vanilla HTML/CSS/JS | No framework, no build step |
| Chess logic | chess.js 0.10.3 | **Do not upgrade** (v1.x broke API compat) |
| Board rendering | HTML5 Canvas | Custom per-mode draw functions, no DOM pieces |
| Chess engine | Stockfish 18 lite WASM | Web Worker, UCI over `postMessage` |
| Backend | Node.js / Express 4.18.2 | `server/index.js`, single file (~470 lines) |
| Hosting (frontend) | GitHub Pages | Auto-deploy on push to `main` |
| Hosting (backend) | Railway | Auto-deploy on push to `main` (`server/` subdir) |
| AI | Claude `claude-sonnet-4-6` | Via Railway proxy — key never on client |
| Persistence | localStorage only | No DB, no auth, 50-game cap |
| External APIs | Lichess (proxied), Chess.com (direct) | Lichess needs Bearer token via Railway env |

### No-build module model
Every `js/*.js` file is a single **IIFE** assigning one global (`App`, `UI`, `Board`, `Engine`, `Analysis`, `Storage`, `Memory`/`ChessLabMemory`, `Recommendations`, `Explore`, `ChessCom`). Pages wire them together by **`<script>` tag order**, not imports. The exact, order-dependent script list lives at the bottom of each `.html` file. There is no transpilation — the files are served as-is.

```
chesslab.live (GitHub Pages)
  ├── HTML pages: index, profile (rail-nav) · analyzer, archive, import, recommendations, openings, practice (task pages)
  ├── js/ (vanilla IIFE modules, loaded in dependency order)
  │    ├── chess.js          — vendored chess.js 0.10.3 (minified). Do NOT reformat/lint.
  │    ├── stockfish.js/.wasm— vendored Stockfish 18 lite. Do NOT reformat/lint.
  │    ├── storage.js        — localStorage CRUD + game enumeration (PROTECTED)
  │    ├── memory.js         — Coaching Memory System (PROTECTED, ~1700 lines, 8 sections)
  │    ├── engine.js         — Stockfish worker driver: analyzeAllPositions (batch, depth 20) + evaluateLive (depth 18)
  │    ├── analysis.js       — PGN parse, per-ply classification, /api/analyze narrative
  │    ├── board.js          — analyzer's canvas renderer (also used by explore.js)
  │    ├── explore.js        — analyzer-only "what if" sideline state machine
  │    ├── app.js            — analyzer entry point + single source of game state
  │    ├── ui.js             — analyzer DOM rendering, coach chat, eval bar
  │    ├── recommendations.js— cross-game report (3-call Claude flow; will redirect to memory in Step 4)
  │    ├── practice-board.js — ALL 4 practice modes in one file (~4400 lines, four IIFEs)
  │    ├── openings.js       — opening explorer (Lichess masters/players DBs)
  │    ├── nav.js            — shared hamburger drawer (PAGE_HREFS map)
  │    └── chesscom.js       — Chess.com public API helpers (direct, no auth)
  └── css/styles.css         — shared only; page-specific CSS is inline <style> per HTML file

chess-lab-production.up.railway.app (Railway)
  └── server/index.js — Express proxy (model: claude-sonnet-4-6; rate-limited; CORS-locked)
       ├── POST /api/analyze          — generic Anthropic pass-through (key-protected)
       ├── POST /api/recommendations  — 3 parallel Claude calls, Object.assign-merged
       ├── POST /api/theory           — opening explanation, in-memory LRU-ish cache (cap 200)
       └── GET  /api/lichess-explorer — Lichess opening-DB proxy with Bearer token
```

### The analyzer pipeline (analyzer.html)
`App` (js/app.js) holds the **single source of game state**: `fens[]`, `verboseHistory[]`, `analysisData`, `currentPly`. Flow: PGN → `Analysis.parsePGN` → per-ply Stockfish eval via `Engine.analyzeAllPositions` (depth 20 batch worker) → move classifications → `Analysis` also calls backend `/api/analyze` for Claude narrative → `UI` renders, `Board` draws the canvas. Navigation is `App.navigateToPly()`, which **rebuilds the displayed position from the immutable real-game data** (never mutates it).

### Two separate board renderers (intentional)
`js/board.js` is the analyzer's canvas renderer. `js/practice-board.js` is an **entirely independent** board for practice mode (its own renderer, four IIFEs). They share no code. `js/explore.js` (analyzer "what-if" sidelines) **reuses board.js** and branches from a **copy** of the real position; exploration is temporary and never persisted. AUDIT M17 notes the board-rendering duplication between board.js and practice-board.js — a future shared `BoardRender` extraction, deferred to its own focused refactor.

**Canvas (not DOM pieces) is deliberate:** arrow drawing, highlight overlays, and the eval bar are trivial on canvas and avoid CSS-transform / z-index / event-delegation complexity for dragging.

### Key data structures
**Game storage** (`js/storage.js`):
- One localStorage key per game: `csa_game_<timestamp>`. Enumerated by prefix scan via `Storage.loadAllGames()`. Game IDs are the full key string (e.g. `"csa_game_1714298400123"`).
- `game.savedAt` (ISO) is the canonical date field — **not** `metadata.date` (which is PGN format).
- TimeControl is in the **PGN body**, parsed via regex `/\[TimeControl\s+"([^"]+)"\]/` — **not** in metadata. Examples: `[TimeControl "180"]`, `"180+2"`, `"900+10"`.
- Cap: `MAX_GAMES = 50` in storage.js (browser-quota safety).

**localStorage key families:** `csa_game_*` (games), `csa_coaching_memory*` (memory + audit/health/backup), `csa_recommendations*`, `csa_opening_*`, `csa_elo_current`, `csa_review_game_id`, `csa_chesscom_username`, `csa_theory_*`, `csa_import_queue`/`csa_import_index`; UI prefs under `pf_*` (`pf_coach_tone`, `pf_display_name`, `pf_goals`, `pf_show_best_move_arrow`, `pf_auto_recommendations`).

### Backend design decisions (why it's shaped this way)
- **Why memory uses the existing `/api/analyze` (no new endpoint):** Memory Step 1's goal was zero server changes — independently shippable/rollback-able without a Railway redeploy. All memory logic is client-side; the server is a dumb proxy for it.
- **Why 3 parallel Claude calls for recommendations:** a full report exceeds ~8000 tokens in one call. Three calls (Core / Opening+Tactics / Study Plan) each stay thorough; firing them in parallel keeps latency near the slowest single call (~5–10s) instead of sequential (~15–30s). `Object.assign` merge is safe — the three schemas have no overlapping keys. Partial-failure handling: if 1–2 calls fail the result is merged with a `_partialFailure` note; only all-3-failing returns a 500.

### Analyzer best-move arrow timing (analyzer-only)
In Game Review the arrow **lags one ply** so it isn't a spoiler: at ply N, `navigateToPly` looks up the best move from `moveData(ply = N−1).bestMoveFrom/To`, so the arrow appears only *after* the user advances past the move (and it agrees with the `bestMoveSan` coaching text, which is also prior-position). The **eval bar/number are deliberately NOT shifted** — they stay on the current ply. No arrow on ply 1. Toggle `#btn-arrow-toggle` persists in `localStorage['pf_show_best_move_arrow']` (default ON; only the string `'false'` = off). **This is analyzer-only** — the practice board loads its own `js/practice-board.js` (not `board.js`/`app.js`) and keeps its own best-move/arrow logic. Never apply the lag there.

### Other "why" notes worth keeping
- **Why single `memory.js` (not split):** the 8 sections (constants, storage, sanity checks, self-heal, Claude integration, health, audit, public API) are tightly coupled; splitting adds import-order/global-scope complexity with no gain under the no-build constraint.
- **Why serial Promise queue for Play the Coach Stockfish:** race conditions where a `bestmove` from an aborted search was mistaken for the real result caused wrong coach feedback and engine freezes. The queue enforces strict command ordering.
- **Why inline CSS in practice.html / openings.html:** built feature-by-feature with self-contained CSS, avoiding collisions with shared styles.css; each page stays independently portable.

---

## Design System

### Token palette (`--az-*`, defined in `css/styles.css`)
The current standard is the **`--az-*` token palette**, NOT the older `--accent`/`--panel`/`--card` tokens. Pages are being migrated to it one at a time (analyzer → archive → import → …).
- Base bg `--az-base` #0d1321 · surface/cards `--az-surface` #111827 · border `--az-border` #1e2d40
- Text `--az-text1` #e2e8f0 / `--az-text2` #94a3b8 / `--az-text3` muted
- Accent `--az-blue` #3b82f6 (hover #2563eb) · success `--az-green` #4ade80 · loss/danger #f87171

### Button color hierarchy (global rule — "Option B")
- **Blue (`--az-blue`) = PRIMARY actions** (Analyze, Import & Analyze, Import All, dashboard "Analyze a game").
- **Dark (`--az-base` bg + `--az-border`) = SECONDARY actions** (Import Last 5/10, Load More).
- **Green (`--az-green`) = success/positive states ONLY** — WIN badges, "Already Analyzed" tags, accuracy %, connected-username chip, success confirmations. **Never use green for an action button.**
- LOSS/danger = red #f87171 · DRAW/neutral = `--az-text2`.
- Disabled primary buttons get an explicit muted style (dark bg + `--az-text3`), not just reduced opacity.

### CSS class prefix convention
Page-specific CSS is **always inline `<style>`** in the HTML file; only truly shared components go in `css/styles.css`.

| Prefix | Page/Component |
|--------|---------------|
| `az-`  | analyzer.html |
| `pb-`  | practice.html |
| `pf-`  | profile.html |
| `rec-` | recommendations.html |
| `open-`| openings.html |
| `ga-`  | archive.html (v2 overhaul) |
| `import-` / `mass-` | import.html (these rules live in styles.css but stay prefix-scoped) |
| `db-`  | shared: sidebar, nav, dashboard |

### Nav model (two-tier)
- **Rail pages — `index.html` and `profile.html`** keep the persistent 220px `db-sidebar` rail as their nav.
- **Task pages — everything else** (analyzer, archive, import, recommendations, openings) use the shared **hamburger drawer**: the `az-topbar` pattern (3-span `az-hamburger` + `az-logo` + breadcrumb) + `#nav-drawer` markup + `initNav('<page>')` from `js/nav.js` (which wires open/close and active-highlight via the `PAGE_HREFS` map).
- The drawer entry list (Home, Game Analyzer, Game Archive, Practice Board, My Recommendations, Import Games, + coming-soon) must be kept **identical across pages**.
- **practice.html is the holdout** — it still uses the `db-sidebar` family and has no drawer/nav.js (migration pending; see Backlog).

---

## Memory System Rules (non-negotiable)

The Coaching Memory System (`js/memory.js`) is an auditable store that accumulates coaching patterns across games. These rules are hard-won — keep them intact.

### 6 Critical Design Principles (NON-NEGOTIABLE)
1. **Stockfish is the source of truth for all chess facts.** Claude writes narrative only — it never invents numbers, IDs, dates, or counts, and never "reads the board."
2. **Stockfish classifications are immutable.** Claude can *describe* a blunder but cannot reclassify it.
3. **Memory starts fresh on first activation** — it does NOT read existing `csa_recommendations`.
4. **Backwards compatibility is output-only.** Memory writes `csa_recommendations` in its existing shape via an **overlay merge** (`Object.assign` of only the fields it derives), so existing pages keep working. Memory **never reads** `csa_recommendations`; memory **never writes** `csa_game_*` (read-only forever).
5. **Cross-reference validation on every update.**
6. **No silent degradation.** Every failure is logged AND visible (toast + health indicator). (This is why the H5 fix moved the memory update into a `finally` block — see HANDOFF.)

### Stockfish move classifications
`best | excellent | good | inaccuracy | miss | mistake | blunder`. Memory tracks blunder/mistake/inaccuracy/miss as **weaknesses**, and best/excellent/good as **strengths**. These are immutable.

### Time-control buckets
Three buckets, routed from the parsed PGN TimeControl (`js/memory.js`): **bullet** (< 180s), **blitz** (180–600s), **rapid** (≥ 600s). Each bucket keeps a **25-game active window** (`ACTIVE_GAMES_CAP = 25`, oldest rotated out) with **30/60/90-day decay weights** (1.0 / 0.5 / 0.25; older than 90 days drops from the active set).

### Claude's role vs. code's role
- **Claude writes (narrative only):** `title`, `narrativeDescription`, `commonMistake`, `verdict`.
- **Claude never writes:** occurrence counts, dates, trend values, accuracy numbers.
- On fabrication: a sanity check fails → logged to audit → health may degrade → a self-heal function runs.

### Self-heal functions (facts recomputed in code, never trusted from Claude)
| Function | What it heals |
|----------|---------------|
| `repairFirstSeenDates` | Dates derived from real `game.savedAt` |
| `repairNarrativeFields` | Invalid trend → `"stable"`, invalid severity → `"major"` |
| `repairTrendValues` | accuracy/blunders/games-per-month recalculated from real games |
| `repairOccurrenceCounts` | active/historical counts from real Stockfish classifications, filtered by playerColor |

`stockfishClassification` is **NOT** healed — an invalid value there is a real fabrication, surfaced as a check failure.

### 5 Safeguard Layers
1. 30+ inline sanity checks with granular check numbers (logged to audit).
2. Rolling history of 10 memory versions (rollback via the Undo button).
3. Five Profile "danger zone" buttons: Backup, Restore-auto, Undo, View history/audit, Reset.
4. Audit log (cap 100) capturing every update attempt with pass/fail/check results.
5. Health indicator: `healthy` / `degraded` / `broken` — shown in footer + banner. 3+ consecutive rejections shows a broken-memory banner with a "Force full regenerate" button (`#mem-broken-force-btn` → `update('force_full_regenerate')`).

### Memory localStorage keys
| Key | Purpose |
|-----|---------|
| `csa_coaching_memory` | Live memory object |
| `csa_coaching_memory_history` | Rolling history of last 10 versions |
| `csa_coaching_memory_audit` | Audit log (cap 100) of every update attempt |
| `csa_coaching_memory_health` | `{status, consecutiveRejections, lastUpdateAccepted, …}` |
| `csa_coaching_memory_autobackup` | Auto-backup on every 5th new game |
| `csa_coaching_memory_manual_backup` | User-triggered backup |
| `csa_recommendations` | Written by both the old 3-call flow AND memory (overlay pattern) |
| `csa_recommendations_meta` | `{gameCount, generatedAt}` |
| `csa_recommendations_autobackup` / `csa_recommendations_manual_backup` | Recs backups (cleared on reset alongside memory) |

### Weakness Drill grounding (same principle, applied to the drill)
The "Stockfish is source of truth" rule also governs the Weakness Drill (`js/practice-board.js`, WD IIFE; fixed 2026-06-03, AUDIT M12 + a coach-hallucination bug):
- **Stockfish owns the best move and the eval.** `wdGroundPosition(pos)` runs the WD eval worker on every drill FEN (generated AND real) and overwrites `pos.bestMove` + `pos.evalBeforeMove` with engine values. Claude-supplied best move/eval are never trusted (the generation prompt no longer even asks for an eval).
- **Judging is 100% Stockfish-graded.** Grades on `gap = evalAfterBest − evalAfterUser` (mover's perspective, both from Stockfish): `≤ 0.3` correct, `0.3–1.0` wrong_close, `≥ 1.0` wrong_significant. Near-best leniency *is* the 0.3-pawn band (an engine fact) — the judge does not read `pos.alternativeAcceptable`.
- **Never judge against Claude (no fallback).** If grounding fails (`!pos._grounded`) or an eval can't be computed, the position is **skipped** via `wdShowUngradable()` — never graded against a Claude number.
- **Claude narrates only handed facts.** The coach prompt receives a fixed fact list (best-move SAN + from/to, capture, check, eval before/after-best/after-user) and is forbidden from stating other pieces' squares or claiming attacks/targets/pins/forks not in that list.
- **Rule for future work:** in the drill, never let Claude determine the best move, the eval, piece locations, or tactical claims. Hand Claude the Stockfish facts; never let it read the board.

---

## Current State

> Keep this section under ~40,000 chars. Prune older detail into HANDOFF.md when it grows.

- **Memory System Step 1** — COMPLETE and live; health status "healthy" in production.
- **Phase 4 Weakness Drill** — shipped, and Stockfish-grounded (M12 + coach-hallucination fix, 2026-06-03).
- **Analyzer best-move arrow** — one-ply lag + on/off toggle shipped (2026-06-03).
- **Analyzer exploration board** — interactive "what if" sidelines shipped (`js/explore.js`, extended `board.js`, `Engine.evaluateLive`; 2026-06-03). Temporary/never-persisted; analyzer-only.
- **Stop hook** — WARN-ONLY verification hook shipped (`.claude/hooks/verify_stop.py` + `.claude/settings.json`; 2026-06-03). See below.
- **Memory hardening** — H5 (memory updates on every exit path via `finally`) and M10 (reset clears `csa_recommendations_autobackup`) shipped; M11 (`lastFullRegenerate`/`updatesSinceFullRegenerate`) decided **(c) leave as reserved scaffolding** for the planned drift safeguard — the force-regenerate trigger is already live; do **not** re-flag as dead code (2026-06-03).
- **Audit fixes** — Batch 1 (H1, H2, H3, H4, M6) and Batch 2 cleanup (M1, M2, M3+M18, M4, L1, L2, L14, L15) applied. v1 Flask app moved to `legacy/`.
- **Nav migration** — recommendations + openings converted to the shared drawer; profile confirmed on its rail. `PAGE_HREFS` now includes openings/recommendations.
- **Frontend** GitHub Pages @ chesslab.live; **backend** Railway @ chess-lab-production.up.railway.app. No build step.

### Stop hook (warn-only)
`.claude/hooks/verify_stop.py` runs on every turn end and prints `[stop-hook WARN]` notes (always exits 0, never blocks) for: (1) changed-JS syntax errors (`node --check`, skips vendored `chess.js`/`stockfish.js`); (2) `hidden` elements missing a hiding rule reachable from that page; (3) protected-file (`memory.js`/`storage.js`) edits. Fail-safe (git/node missing → prints a note, exits 0). **To make it blocking:** change the single `sys.exit(0)` at the `###<<< FLIP-TO-BLOCK >>>###` marker to `sys.exit(2)`.

### Layout notes
- `js/chess.js` and `js/stockfish.js` + `js/stockfish.wasm` are committed vendored libraries — do not reformat or lint them.
- `legacy/` holds the retired v1 Flask app (`analyzer.py`); ignore it for current work.
- `HANDOFF.md` (running dated log), `COMMAND_LOG.md` (prompt log), `AUDIT_REPORT.md`, `NAV_AUDIT.md` are working docs; `SETUP.md` is the run/deploy reference. `memory.md` is deprecated (folded into this file).

---

## Backlog / Next Steps

**Memory build pace** — each step is independently shippable and rollback-able:

| Step | Status | Description |
|------|--------|-------------|
| 1 | ✅ Done | Foundation: accumulation, safeguards, self-heal, health indicator |
| 2 | 🔄 In progress | Live soak: 1–2 weeks real use, monitor audit log, no code changes |
| 3 | Queued | Surface trends in UI (bucket selector, accuracy chart, games-analyzed count) |
| 4 | Queued | Switch recommendations source from the 3-call flow to memory (memory becomes authoritative) |
| 5 | Queued | Deprecate the old 3-call generation logic in `recommendations.js` |

**Nav work:**
- **practice.html nav migration** (the big one) — large file, four IIFEs, no drawer/nav.js, dynamic sidebar badges + connection-status footer to reconcile.
- **index.html** — hybrid (rail + vestigial hidden drawer); cleaning it up frees the legacy `.hamburger-btn` CSS (styles.css ~2623/2632), kept only because index.html still references it on a hidden button.
- **nav.js centralization** — drawer markup is currently hand-included per page; centralizing it is future work.

**Open audit findings (from AUDIT_REPORT.md):**
- **M5** — apply `pf_accent_color` to `--accent` on page load (*quick*).
- **M7** — decide who owns `csa_recommendations_meta` (both the old flow and memory write recs) (*quick once decided*).
- **M8 + M9** — tighten repair functions: dedupe classifications (Check18 breaks if two weaknesses share a classification), heal `lastSeen` symmetrically after counts are rewritten (*medium*). Touches `memory.js` — protected.
- **M13 + M14** — route `openings.js` through the Railway Lichess proxy + adopt the shared `SERVER_URL` localhost fallback (server needs a `masters` query mode) (*medium*).
- **M15** — cache `Storage.loadAllGames()` once per page load (repeated full localStorage scans) (*quick*).
- **M16** — null-guard the up/down arrows in `renderVsAverage` (*quick*).
- **M17** — extract a shared `BoardRender` helper (board.js ↔ practice-board.js duplication). *Large; save for a focused refactor session, do it last, don't bundle into another change.*
- Remaining L-series: L3–L13 (lower priority).

**Rebrand (deferred):**
- Current name **Chess Lab** → future name **Passed Pawn Labs** (passedpawnlabs.com purchased/locked, privacy + auto-renew on).
- Deferred until a milestone: Memory Step 5 done, first paying user, OR auth shipped. Will be a single focused PR (domain, copy, all HTML titles, nav branding at once).

**Bigger-ticket deferred:** Supabase auth + Stripe (the reason localStorage-only is acceptable today).

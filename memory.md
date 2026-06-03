# Chess Lab — Project Memory

> The "why things are the way they are" doc. Durable architecture decisions and context.
> See handoff.md for current state, next steps, and session history.

---

## Workflow rules (mandatory)

At the **end of every task/session**, Claude must:
1. Update `handoff.md` — what was done, current state, and clear next steps
2. Update `memory.md` — any new architecture decisions or context worth preserving
3. Ask any clarifying questions before finishing

This is non-negotiable. Both files live at the project root.

---

## Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | Vanilla HTML/CSS/JS | No framework, no build step |
| Chess logic | chess.js 0.10.3 | **Do not upgrade** — v1.x broke API compat |
| Board rendering | HTML5 Canvas | Custom draw functions per mode, no DOM pieces |
| Chess engine | Stockfish 18 lite WASM | Web Worker, UCI protocol over postMessage |
| Backend | Node.js / Express 4.18.2 | `server/index.js`, single file ~470 lines |
| Hosting (frontend) | GitHub Pages | Auto-deploy on push to main |
| Hosting (backend) | Railway | Auto-deploy on push to main (server/ subdir) |
| AI | Claude claude-sonnet-4-6 | Via Railway proxy — key never on client |
| Persistence | localStorage only | No DB, no auth, 50-game cap |
| External APIs | Lichess (proxied), Chess.com (direct) | Lichess needs Bearer token via Railway env |

---

## Architecture overview

```
chesslab.live (GitHub Pages)
  ├── HTML pages (analyzer, practice, openings, recommendations, profile, archive, import, index)
  ├── js/ (vanilla IIFE modules, loaded via script tags in dependency order)
  │    ├── storage.js       — localStorage CRUD, game enumeration
  │    ├── memory.js        — Coaching Memory System (Step 1)
  │    ├── recommendations.js — 3-call Claude flow (Step 4 will redirect to memory)
  │    ├── practice-board.js — all 3 practice modes in one file
  │    └── ... (board.js, engine.js, analysis.js, app.js, etc.)
  └── css/styles.css        — shared; page-specific CSS is inline <style> in each HTML file

chess-lab-production.up.railway.app (Railway)
  └── server/index.js — Express proxy
       ├── POST /api/analyze        — pass-through to Anthropic (key-protected)
       ├── POST /api/recommendations — 3 parallel Claude calls, merged
       ├── POST /api/theory          — opening explanation, in-memory cache
       └── GET  /api/lichess-explorer — Lichess proxy with Bearer token
```

All Claude calls go through Railway. Client never touches the Anthropic key.

---

## Key data structures

### Game storage
- One localStorage key per game: `csa_game_<timestamp>`
- Enumerated via prefix scan: `Storage.loadAllGames()`
- Game IDs are the full key string (e.g. `"csa_game_1714298400123"`)
- `game.savedAt` (ISO) is the canonical date field — NOT `metadata.date` (PGN format)
- TimeControl is in the PGN body, parsed via regex `/\[TimeControl\s+"([^"]+)"\]/` — NOT in metadata

### Coaching memory keys
| Key | Purpose |
|-----|---------|
| `csa_coaching_memory` | Live memory object |
| `csa_coaching_memory_history` | Rolling history of last 10 versions |
| `csa_coaching_memory_audit` | Audit log (cap 100) of every update attempt |
| `csa_coaching_memory_health` | `{status, consecutiveRejections, lastUpdateAccepted, ...}` |
| `csa_coaching_memory_autobackup` | Auto-backup on every 5th new game |
| `csa_coaching_memory_manual_backup` | User-triggered backup |
| `csa_recommendations` | Written by both old 3-call flow and memory (overlay pattern) |
| `csa_recommendations_meta` | `{gameCount, generatedAt}` |

### Stockfish move classifications
`best | excellent | good | inaccuracy | miss | mistake | blunder`
- Memory tracks blunder/mistake/inaccuracy/miss as **weaknesses**
- Memory tracks best/excellent/good as **strengths**
- These classifications are **immutable** — Claude cannot reclassify them

---

## Memory system design

### 6 Critical Design Principles (NON-NEGOTIABLE)
1. **Stockfish is source of truth** for all chess facts. Claude writes narrative only — never invents numbers, IDs, dates, or counts.
2. **Stockfish classifications are immutable.** Claude can describe a blunder but cannot reclassify it.
3. **Memory starts fresh** on first activation — does NOT read existing `csa_recommendations`.
4. **Backwards compatibility is output-only.** Memory writes `csa_recommendations` in existing shape (overlay merge). Memory never reads `csa_recommendations`; never writes `csa_game_*`.
5. **Cross-reference validation** on every update.
6. **No silent degradation.** Every failure is logged AND visible (toast + health indicator).

### Weakness Drill grounding (same principle, applied to the drill)
The same "Stockfish is source of truth" rule governs the Weakness Drill (`js/practice-board.js`, WD IIFE), fixed 2026-06-03 (AUDIT_REPORT.md M12 + a coach hallucination bug):
- **Stockfish owns the best move and the eval.** `wdGroundPosition(pos)` runs the WD eval worker on every drill FEN (generated AND real) and overwrites `pos.bestMove` + `pos.evalBeforeMove` with engine values. Claude-supplied best move / eval are never trusted (the generation prompt no longer even asks for an eval).
- **Judging is 100% Stockfish-graded.** `wdProcessMove` grades on `gap = evalAfterBest − evalAfterUser` (mover's perspective, both from Stockfish via `wdEvalAfterMove`): `≤ 0.3` correct, `0.3–1.0` wrong_close, `≥ 1.0` wrong_significant (significant = a full pawn or more). Near-best leniency (the old "acceptable" idea) is the **0.3-pawn band**, an engine fact — the judge does **not** read `pos.alternativeAcceptable`. The old `wdEvaluateWrongMove` helper was removed.
- **Never judge against Claude (no fallback).** If grounding fails (`!pos._grounded`) or an eval can't be computed, the position is **skipped** via `wdShowUngradable()` — never graded against a Claude number. `pos._grounded` becomes true only after Stockfish's `bestUci`→SAN overwrites `pos.bestMove`, so a Claude move can never reach the judge.
- **Claude narrates only handed facts.** The coach prompt receives a fixed fact list (best move SAN + from/to, capture, check, eval before / after-best / after-user) and is forbidden from stating other pieces' squares or claiming attacks/targets/pins/forks not in that list. With no tactical fact it must explain via the eval swing and the named move only. This prevents board-geometry hallucinations.
- **Rule for future work:** never let Claude determine the best move, the eval, piece locations, or tactical claims in the drill. These are one-move puzzles — hand Claude the Stockfish facts; never let it read the board.

### 5 Safeguard Layers
1. 30+ inline sanity checks with granular check numbers (logged to audit)
2. Rolling history of 10 memory versions (rollback via Undo button)
3. 5 Profile danger zone buttons: Backup, Restore-auto, Undo, View history/audit, Reset
4. Audit log (cap 100) capturing every update attempt with pass/fail/check results
5. Health indicator: `healthy` / `degraded` / `broken` — shown in footer + banner

### Bucket design
- Three time-control buckets: **bullet** (<180s), **blitz** (180–600s), **rapid** (600s+)
- 25-game active window per bucket (oldest rotated out)
- 30/60/90-day decay weights on active games

### Self-heal patterns (facts calculated in code, never trusted from Claude)
| Function | What it heals |
|----------|---------------|
| `repairFirstSeenDates` | Dates derived from real `game.savedAt` |
| `repairNarrativeFields` | Invalid trend → `"stable"`, invalid severity → `"major"` |
| `repairTrendValues` | accuracy/blunders/games-per-month recalculated from real games |
| `repairOccurrenceCounts` | active/historical counts from real Stockfish classifications, filtered by playerColor |

`stockfishClassification` is NOT healed — an invalid value there is a real fabrication (surfaced as check failure).

### Claude's role in memory
- Claude writes: `title`, `narrativeDescription`, `commonMistake`, `verdict` — narrative fields only
- Claude never writes: occurrence counts, dates, trend values, accuracy numbers
- On fabrication: sanity check fails → logged to audit → health may degrade → self-heal runs

---

## Important decisions log

### Why single memory.js file (not multi-file split)
Cohesion — the 8 sections are tightly coupled (constants, storage, sanity checks, self-heal, Claude integration, health, audit, public API). Splitting would have introduced import order and global-scope management complexity with no gain, given the no-build-step constraint.

### Why use the existing /api/analyze endpoint (no new server endpoint)
Memory Step 1 goal was zero server changes — independently shippable and rollback-able without Railway redeploy. All memory logic is client-side. The server is a dumb proxy for this feature.

### Why overlay pattern for csa_recommendations
Memory writes `csa_recommendations` using `Object.assign` to merge only the fields it derives. This means existing pages (recommendations.html) keep working with zero changes during the memory transition. Step 4 will flip the source of truth; Step 5 will remove the old 3-call flow.

### Why 3 parallel Claude calls for recommendations
Full recommendations would exceed ~8000 tokens in one call. Three calls (Core / Opening+Tactics / Study Plan) let each be thorough. Parallel firing keeps latency near the slowest single call (~5-10s) rather than sequential (~15-30s). `Object.assign` merge is safe — the 3 schemas have no overlapping keys.

### Why serial Promise queue for Play the Coach Stockfish
Race conditions where `bestmove` from an aborted search was mistaken for the real result caused incorrect coach feedback and engine freezes. The queue ensures strict command ordering.

### Why chess.js 0.10.3 (not v1.x)
v1.x broke API compatibility (`.moves()` returns strings instead of objects, `.history({verbose: true})` changed). Do not upgrade without auditing every `.move()`, `.history()`, `.moves()` call across all JS files.

### Why localStorage only (no server DB)
User data stays on-device. No accounts, no auth, no GDPR complexity. 50-game limit enforced by `MAX_GAMES = 50` in storage.js to stay under browser quotas. Supabase auth + Stripe are deferred backlog.

### Why canvas board (no DOM pieces)
Performance and control. Arrow drawing, highlight overlays, eval bar — trivial with canvas. No CSS transforms, z-index issues, or event delegation complexity for piece dragging.

### Why inline CSS in practice.html and openings.html
Built feature-by-feature with self-contained CSS. Avoids naming collisions with shared styles.css. Each page is independently portable. Tradeoff: no CSS reuse, but they share little with each other.

---

## Naming / branding

- **Current name:** Chess Lab
- **Future name:** Passed Pawn Labs (passedpawnlabs.com purchased, locked, privacy on, auto-renew on)
- **Rebrand deferred** until a milestone: Memory Step 5 done, first paying user, OR auth shipped
- Rebrand will be a single focused effort (domain, copy, all HTML titles, nav branding in one PR)

---

## CSS class prefix convention

| Prefix | Page/Component |
|--------|---------------|
| `az-`  | analyzer.html |
| `pb-`  | practice.html |
| `pf-`  | profile.html |
| `rec-` | recommendations.html |
| `open-`| openings.html |
| `ga-`  | archive.html (v2 overhaul) |
| `import-` / `mass-` | import.html |
| `db-`  | shared: sidebar, nav, dashboard |

Page-specific CSS is **always inline `<style>`** in the HTML file. Only truly shared components go in `css/styles.css`. (Note: import.html's `.import-*`/`.mass-*` rules live in `css/styles.css` rather than inline, but stay strictly scoped by prefix.)

---

## Design system — token palette & button color hierarchy

The current design standard is the **`--az-*` token palette** (defined in `css/styles.css`), NOT the older `--accent`/`--panel`/`--card` tokens. Pages are being migrated to it one at a time (analyzer → archive → import, …):

- Base bg `--az-base` #0d1321 · surface/cards `--az-surface` #111827 · border `--az-border` #1e2d40
- Text `--az-text1` #e2e8f0 / `--az-text2` #94a3b8 / `--az-text3` muted
- Accent `--az-blue` #3b82f6 · success `--az-green` #4ade80 · loss/danger #f87171

**Button color hierarchy (global rule — "Option B"):**
- **Blue (`--az-blue`) = PRIMARY actions** (Analyze, Import & Analyze, Import All, dashboard's "Analyze a game", etc.). Hover #2563eb.
- **Dark (`--az-base` bg + `--az-border`) = SECONDARY actions** (Import Last 5/10, Load More, etc.).
- **Green (`--az-green`) is RESERVED for success/positive states ONLY** — WIN badges, "Already Analyzed" tags, accuracy %, connected-username chip, success confirmations. **Never use green for an action button.**
- LOSS/danger = red #f87171 · DRAW/neutral = `--az-text2`.
- Disabled primary buttons get an explicit muted style (dark bg + `--az-text3`), not just reduced opacity.

**Shared nav drawer:** every page hand-includes the same `#nav-drawer` markup + calls `initNav('<page>')` (js/nav.js wires open/close + active highlighting via `PAGE_HREFS`). The drawer list (Home, Game Analyzer, Game Archive, Practice Board, My Recommendations, Import Games, + coming-soon) must be kept identical across pages. The topbar uses the `az-topbar` pattern (3-span `az-hamburger` + `az-logo` + `az-breadcrumb`).

---

## 5-step memory build pace

Each step is independently shippable and independently rollback-able:

| Step | Status | Description |
|------|--------|-------------|
| 1 | ✅ Done | Foundation: memory accumulation, safeguards, self-heal, health indicator |
| 2 | 🔄 In progress | Live soak: 1–2 weeks real use, monitor audit log, no code changes |
| 3 | Queued | Surface trends in UI (bucket selector, accuracy chart, games-analyzed count) |
| 4 | Queued | Switch recommendations source from 3-call flow to memory |
| 5 | Queued | Deprecate old 3-call generation logic |

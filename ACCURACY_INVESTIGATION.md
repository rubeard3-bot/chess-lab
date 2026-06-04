# Accuracy & Move-Classification Investigation

> **Read-only diagnosis.** Documents exactly how Chess Lab computes per-move
> accuracy, whole-game accuracy, and move classifications today, so the numbers
> can be compared against Lichess / chess.com for the same game. **No fixes
> proposed here** — diagnosis only.
>
> Date: 2026-06-04 · Scope: `js/analysis.js`, `js/engine.js`, `js/ui.js`, `js/app.js`

---

## TL;DR

- **Per-move accuracy formula = the Lichess standard, reproduced exactly.** Both
  the win-% sigmoid and the accuracy curve use Lichess's published constants
  verbatim (`-0.00368208`, `103.1668`, `-0.04354`, `-3.1669`).
- **Whole-game aggregation is NOT Lichess's.** The app takes a **simple
  arithmetic mean** of per-move accuracies. Lichess takes the **average of two
  means** — a volatility-weighted mean *and* a harmonic mean. **This is the
  single biggest reason the app's game-accuracy number will diverge from
  Lichess even on an identical game.**
- **Accuracy is computed for one side only** (the user's `playerColor`), not
  both sides, and not combined.
- **Classification buckets are a custom scheme** keyed off win-percentage-loss
  (not centipawn loss). The naming resembles chess.com, but the thresholds are
  the app's own — they match *neither* Lichess nor chess.com.
- **chess.com uses entirely different math** — comparing to it is apples-to-
  oranges *by design*. Use **Lichess** as the comparison baseline.

---

## 1. The accuracy formula

### 1a. Per-move accuracy — `calculateAccuracy` ([js/analysis.js:124](js/analysis.js#L124))

```js
124  function calculateAccuracy(classifiedMoves, playerColor) {
125    const playerMoves = classifiedMoves.filter(m => m.color === playerColor);
126    if (!playerMoves.length) return 0;
127
128    let total = 0;
129    playerMoves.forEach(m => {
130      // Recompute win-percent loss from the raw eval snapshots stored on each move.
131      // This avoids relying on the pre-computed winPercentageLoss which may be stale or zero.
132      const wpBefore = winPct((m.evalBefore ?? 0) * 100);
133      const wpAfter  = winPct((m.eval        ?? 0) * 100);
134      const wpl = m.color === 'white'
135        ? Math.max(0, wpBefore - wpAfter)
136        : Math.max(0, wpAfter  - wpBefore);
137
138      const acc     = 103.1668 * Math.exp(-0.04354 * wpl) - 3.1669;
139      const clamped = Math.max(0, Math.min(100, acc));
140
141      total += clamped;
142    });
143
144    const avg = Math.round(total / playerMoves.length);
145    return avg;
146  }
```

**The accuracy curve** (line 138):

```
accuracy% = 103.1668 · e^(−0.04354 · wpl) − 3.1669      (clamped to [0,100])
```

where `wpl` = win-percentage lost by the mover on that move. This is the
**Lichess "Accuracy%" formula exactly** — the constants `103.1668`, `0.04354`,
`3.1669` are Lichess's published values, unchanged.

### 1b. How per-move accuracy is aggregated into a game number

- **Aggregation = simple arithmetic mean**, then `Math.round` (line 144:
  `total / playerMoves.length`).
- **No harmonic mean, no weighting, no volatility window.**
- **Per-side, not combined** (line 125: `filter(m => m.color === playerColor)`).
  Only the user's moves count. The opponent's accuracy is never computed.
- `playerColor` is set by the UI (white default, color buttons, or auto-detect
  on import) — see [js/app.js:7](js/app.js#L7), [js/app.js:595](js/app.js#L595),
  [js/app.js:648](js/app.js#L648), and persisted per game
  ([js/app.js:86](js/app.js#L86), [js/app.js:933](js/app.js#L933)).

> ⚠️ **Deviation from the Lichess standard — aggregation.** Lichess does **not**
> take a simple mean. Lichess computes game accuracy as the **average of two
> separate aggregations**:
> 1. a **win%-volatility-weighted mean** of the per-move accuracies (weights come
>    from the standard deviation of win% over a sliding window of plies), and
> 2. the **harmonic mean** of the per-move accuracies.
>
> The app does neither — it uses a flat arithmetic mean. Because the **harmonic
> mean is dominated by its smallest terms**, Lichess penalizes a handful of
> bad moves more heavily than an arithmetic mean does. **Net expected effect:
> the app will tend to report a *higher* game accuracy than Lichess**, with the
> gap widening on games that contain a few low-accuracy moves among many good
> ones. This is by far the most likely cause of a systematic offset versus
> Lichess.

### 1c. Where else the same math lives (display-only duplicates)

The identical per-move formula is re-implemented inline (not reusing
`calculateAccuracy`) in two display paths — worth knowing because they will move
together with any future change:

- **Phase accuracy bars** (opening/middlegame/endgame) —
  [js/ui.js:803-835](js/ui.js#L803-L835). Same `winPct`, same accuracy curve,
  same simple mean, just bucketed by ply range (opening 1–10, mid 11–30, end 31+).
- The `winPct` helper itself is duplicated at
  [js/ui.js:803-805](js/ui.js#L803-L805), byte-identical to the one in
  `analysis.js`.

These are **display** values only; the canonical game number comes from
`calculateAccuracy` and is stored in `analysis.summary.accuracy`
([js/app.js:704](js/app.js#L704), [js/app.js:707](js/app.js#L707)).

---

## 2. The win-percentage / eval pipeline

### 2a. The win-% function — `winPct` ([js/analysis.js:43](js/analysis.js#L43))

```js
43  function winPct(evalCp) {
44    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * evalCp)) - 1);
45  }
```

```
Win% = 50 + 50 · ( 2 / (1 + e^(−0.00368208 · centipawns)) − 1 )
```

- This is the **Lichess win-% model exactly** (the `-0.00368208` multiplier is
  Lichess's published constant). Input is **centipawns, from White's
  perspective**.
- Note the unit handling: evals are **stored in pawns** on each move (`eval`,
  `evalBefore`), so every caller multiplies by 100 before calling `winPct`
  (e.g. [js/analysis.js:61-62](js/analysis.js#L61-L62),
  [js/analysis.js:132-133](js/analysis.js#L132-L133)).

### 2b. Stockfish eval → pawns → win% (the upstream half)

In [js/engine.js](js/engine.js):

- **Search depth = 20** for game analysis: `const DEPTH = 20;`
  ([js/engine.js:3](js/engine.js#L3)), issued as `go depth 20`
  ([js/engine.js:72](js/engine.js#L72)). (A separate **live/exploration**
  evaluator uses depth 18 — `LIVE_DEPTH = 18`,
  [js/engine.js:211](js/engine.js#L211) — but that path does **not** feed
  accuracy; it's only for the "what if" board.)
- **Centipawn scores** are read from Stockfish `score cp`
  ([js/engine.js:51-52](js/engine.js#L51-L52)).
- **Mate scores** are mapped to a fixed `±9900` cp
  ([js/engine.js:46-49](js/engine.js#L46-L49)):
  ```js
  46  if (mateMatch) {
  47    isMate     = true;
  48    mateIn     = parseInt(mateMatch[1], 10);
  49    bestEvalCp = mateIn > 0 ? 9900 : -9900;
  ```
  Through `winPct`, `±9900` cp saturates to ≈ **100% / 0%**, so a forced mate is
  treated as ~certain win/loss. (Mate distance is ignored for the win-% — mate-in-1
  and mate-in-7 both map to 9900.)
- Stockfish reports from the **side-to-move's** perspective; the engine driver
  converts to **White's perspective** and divides by 100 to store **pawns**
  ([js/engine.js:146-149](js/engine.js#L146-L149)):
  ```js
  147  const evalCpFromSide = sfResult.bestEvalCp;
  148  const evalFromWhite  = sideToMove === 'b' ? -evalCpFromSide : evalCpFromSide;
  149  const evalPawns      = evalFromWhite / 100;
  ```
- **Resilience note (can affect evals):** if a position times out twice
  (15 s each), the code falls back to the *previous* position's eval rather
  than failing ([js/engine.js:128-144](js/engine.js#L128-L144)). On a slow
  device this can inject a stale eval into the accuracy math. Unlikely to be the
  cause of a systematic offset, but it is a real source of per-move noise.

### 2c. Per-move win-% loss (the quantity fed to the accuracy curve)

Computed two ways, both consistent:

- During classification ([js/analysis.js:60-68](js/analysis.js#L60-L68)):
  ```js
  61  const wpBefore = winPct(before.eval * 100);
  62  const wpAfter  = winPct(after.eval  * 100);
  ...
  66  const winPercentageLoss = isWhiteMove
  67    ? Math.max(0, wpBefore - wpAfter)
  68    : Math.max(0, wpAfter  - wpBefore);
  ```
- Recomputed independently inside `calculateAccuracy`
  ([js/analysis.js:132-136](js/analysis.js#L132-L136)) so accuracy never depends
  on a possibly-stale stored value.

`Math.max(0, …)` means **good moves are never rewarded above the curve's max** —
only losses count; a move that *improves* the eval contributes `wpl = 0` →
accuracy ≈ 100%.

### 2d. Per-side vs combined — **per-side**

Accuracy, blunder/mistake/inaccuracy counts, and the phase bars all filter to a
single `playerColor`
([js/analysis.js:125](js/analysis.js#L125),
[js/analysis.js:285](js/analysis.js#L285),
[js/ui.js:816](js/ui.js#L816)). The app produces **one accuracy number for the
user's side**. Lichess shows both White and Black — make sure to compare against
the correct side.

---

## 3. The classification buckets — `classifyMoves` ([js/analysis.js:51](js/analysis.js#L51))

**Buckets are keyed off win-percentage-loss (`wpl`), not raw centipawn loss.**
`evalLoss` (centipawns) is computed and stored
([js/analysis.js:97-99](js/analysis.js#L97-L99)) but is used **only for UI
display**, not for the bucket decision.

The threshold ladder ([js/analysis.js:87-94](js/analysis.js#L87-L94)):

```js
87  let classification;
88  if (isBest)                          classification = 'best';
89  else if (winPercentageLoss <=  1)    classification = 'excellent';
90  else if (winPercentageLoss <=  3)    classification = 'good';
91  else if (isMiss)                     classification = 'miss';
92  else if (winPercentageLoss <=  7)    classification = 'inaccuracy';
93  else if (winPercentageLoss <= 15)    classification = 'mistake';
94  else                                 classification = 'blunder';
```

Supporting definitions:

- **`isBest`** — the played move equals the engine's top move
  ([js/analysis.js:71-72](js/analysis.js#L71-L72)):
  ```js
  71  const playedUci = move.from + move.to + (move.promotion || '');
  72  const isBest    = !!before.bestMoveUci && (playedUci === before.bestMoveUci);
  ```
- **`isMiss`** — a squandered winning chance, *or* a missed forced mate
  ([js/analysis.js:79-85](js/analysis.js#L79-L85)):
  ```js
  79  const missedForcedMate = before.isMate && before.mateIn > 0 && !isBest;
  ...
  83  const isMiss = missedForcedMate ||
  84    (winPercentBefore >= 65 && winPercentAfter >= 50 &&
  85     winPercentageLoss >= 5 && winPercentageLoss <= 15);
  ```
  where `winPercentBefore/After` are from the **mover's** perspective
  ([js/analysis.js:75-76](js/analysis.js#L75-L76)).

**Threshold summary (win-% lost by the mover):**

| Bucket | Condition |
|---|---|
| `best` | played move == engine top move |
| `excellent` | `wpl ≤ 1` |
| `good` | `wpl ≤ 3` |
| `miss` | missed forced mate, OR (winning before [≥65%] **and** still ≥50% after **and** `5 ≤ wpl ≤ 15`) — checked *before* inaccuracy/mistake |
| `inaccuracy` | `wpl ≤ 7` |
| `mistake` | `wpl ≤ 15` |
| `blunder` | `wpl > 15` |

> These bands are the app's **own** scheme. They are not Lichess's
> inaccuracy/mistake/blunder cut-offs, and not chess.com's label model
> (Brilliant/Great/Best/Excellent/Good/Book/Inaccuracy/Mistake/Miss/Blunder).
> The names overlap with chess.com; the math does not. Expect classification
> counts to differ from both sites. **Note:** `miss` and `blunder` are merged
> into the "blunders" count downstream
> ([js/analysis.js:288-289](js/analysis.js#L288-L289):
> `if (m.classification === 'blunder' || m.classification === 'miss') blunders++`).

---

## 4. Known differences vs chess.com / Lichess

### vs chess.com — **different math entirely (by design, not a bug)**
chess.com's accuracy is its own proprietary model: a different win-probability
("expected points") curve, a different per-move accuracy mapping, and a
game-level aggregation that weights moves by position sharpness/volatility. There
is **no expectation** that this app matches chess.com. A gap versus chess.com is
**expected and uninformative** for debugging. Don't use chess.com as the
baseline.

### vs Lichess — **same per-move formula, but three real divergence sources**

1. **Game aggregation (most significant; §1b).** App = simple arithmetic mean.
   Lichess = average of (volatility-weighted mean, harmonic mean). **Expected
   direction:** app reads *higher*, especially when a few bad moves sit among
   many good ones. → *By-design deviation as written, but mislabeled "Lichess
   formula." This is the first thing to suspect for a systematic offset.*

2. **Engine eval differences (depth/build/nodes).** App = Stockfish 18-**lite**
   WASM, in-browser, **fixed depth 20**, 64 MB hash
   ([js/engine.js:108](js/engine.js#L108)). Lichess server analysis uses a
   different Stockfish build and search budget (and cloud-cached evals). Different
   evals → different win% → different per-move accuracy even with identical
   formulas. → *Expected; engine-dependent, not a bug.* Magnitude is usually
   small but non-zero, and larger in sharp/tactical positions.

3. **Mate handling & timeouts (minor).** Mate flattened to `±9900`cp with mate
   distance ignored (§2b); double-timeout fallback reuses the prior eval
   (§2b). → *Edge-case noise, not a systematic offset.*

**What would be a genuine bug (vs expected difference):**

| Observation | Verdict |
|---|---|
| Differs from **chess.com** | **Expected** — different math. Not a bug. |
| Differs from **Lichess** by a modest, *consistent* amount, app usually higher | **Expected** — driven by the arithmetic-vs-(weighted+harmonic) aggregation (§1b) plus engine/depth. Not a code bug, but a **fidelity gap vs the "Lichess" label**. |
| Per-move **accuracy %** for a *single* move differs wildly from Lichess given the *same* eval before/after | Would be a **real bug** (constants/units), but the constants match exactly and unit handling (`×100`) is correct — so this is unlikely. Worth spot-checking one move to rule out. |
| Accuracy is computed for the **wrong side** | Would be a **real bug** — verify `playerColor` matches the side you're comparing on Lichess. |
| Wildly different even after accounting for §1b/§2 (e.g. 70% vs 95%) | Points to **eval pipeline** (wrong-side eval, stale-fallback evals, or PGN/ply misalignment) — would warrant a deeper look. |

---

## 5. What to compare — data to bring back

Use **Lichess, not chess.com**, as the baseline (chess.com's formula guarantees
a mismatch).

**From the app**, for one specific game:
1. The PGN you analyzed (exact text), and which **side** you selected
   (`playerColor`).
2. The reported **game accuracy %** (`analysis.summary.accuracy`).
3. The **per-move list**: for each of *your* moves — ply, SAN, classification,
   `evalBefore`, `eval` (both in pawns). (These are stored on each move object;
   the My Report / move-detail views show classification + eval.)
4. The three **phase accuracies** (opening / middlegame / endgame bars).

**From Lichess** (same game):
1. Import the **same PGN** into a Lichess study / "Request a computer analysis."
2. Record Lichess's **accuracy %** for the **same side** you used in the app.
3. Record Lichess's **inaccuracy / mistake / blunder counts** for that side.
4. If possible, note Lichess's **eval (in pawns) before and after a few of your
   moves** — ideally 3–4 moves spanning a quiet position and a sharp one.

**The diagnostic comparison:**
- **Step A — isolate the formula from the engine.** Take 3–4 individual moves and
  plug *Lichess's own* before/after evals into the app's per-move curve by hand:
  `winPct(cp)` then `103.1668·e^(−0.04354·wpl)−3.1669`. If the per-move numbers
  now line up with Lichess's per-move accuracy, the **per-move formula is fine**
  and the divergence is aggregation (§1b) + engine evals (§2). If a *single move*
  with *identical evals* still disagrees, that points to a real per-move bug.
- **Step B — isolate aggregation.** Compute the **simple mean** of the app's
  per-move accuracies and confirm it equals the app's reported game number
  (sanity check on §1b). Then note how far Lichess's game number sits from that
  simple mean — that residual is the weighted+harmonic effect.
- **Step C — quantify the engine gap.** Compare app eval vs Lichess eval (pawns)
  on the same plies. Persistent differences here explain the rest.

Bring back: the app's game accuracy + per-move table, Lichess's game accuracy
(same side) + its blunder/mistake/inaccuracy counts, and Lichess evals for a
handful of plies. That's enough to attribute the gap across §1b (aggregation),
§2 (engine/depth), and rule in/out a genuine per-move bug.

---

## Appendix — files & line references

| What | Location |
|---|---|
| Win-% sigmoid (`winPct`) | [js/analysis.js:43-45](js/analysis.js#L43-L45) (dup at [js/ui.js:803-805](js/ui.js#L803-L805)) |
| Per-move + game accuracy (`calculateAccuracy`) | [js/analysis.js:124-146](js/analysis.js#L124-L146) |
| Accuracy curve constants | [js/analysis.js:138](js/analysis.js#L138) |
| Win-% loss in classification | [js/analysis.js:60-68](js/analysis.js#L60-L68) |
| Classification thresholds | [js/analysis.js:87-94](js/analysis.js#L87-L94) |
| `isBest` / `isMiss` / missed-mate | [js/analysis.js:71-85](js/analysis.js#L71-L85) |
| blunders bucket merges `miss` | [js/analysis.js:288-289](js/analysis.js#L288-L289) |
| Search depth (20) | [js/engine.js:3](js/engine.js#L3), [js/engine.js:72](js/engine.js#L72) |
| Mate → ±9900 cp | [js/engine.js:46-49](js/engine.js#L46-L49) |
| Eval → White-perspective pawns | [js/engine.js:146-149](js/engine.js#L146-L149) |
| Timeout fallback to prior eval | [js/engine.js:128-144](js/engine.js#L128-L144) |
| Accuracy computed/stored | [js/app.js:704-707](js/app.js#L704-L707) |
| `playerColor` source | [js/app.js:7](js/app.js#L7), [js/app.js:595-602](js/app.js#L595-L602), [js/app.js:648](js/app.js#L648), [js/app.js:86](js/app.js#L86), [js/app.js:933](js/app.js#L933) |
| Phase-accuracy bars (dup formula) | [js/ui.js:796-841](js/ui.js#L796-L841) |

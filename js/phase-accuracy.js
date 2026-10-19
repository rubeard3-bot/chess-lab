/* ====================================================================== */
/*  phase-accuracy.js — PURE functions shared by the analyzer renderer     */
/*  (js/ui.js renderPhaseAccuracy) AND tests/phase_accuracy.test.js.        */
/*                                                                          */
/*  No DOM, no globals mutated. Two concerns:                               */
/*    1. ACCURACY — a verbatim port of js/analysis.js calculateAccuracy     */
/*       (Lichess's win% sigmoid + accuracy curve WITH the +1 bonus, the    */
/*       volatility-weighted mean blended with the harmonic mean). The      */
/*       whole-game volatility weights are computed ONCE over the whole     */
/*       game; the blend is taken over a chosen subset of the player's      */
/*       moves. overallAccuracy() over ALL a player's moves reproduces      */
/*       calculateAccuracy EXACTLY; phaseAccuracy() filters to a ply range. */
/*    2. DIVISION — a faithful JS port of lichess-org/scalachess            */
/*       core/src/main/scala/Divider.scala @ 11ac4c5a2b8a852e0e3c4a7c0c5ae0904aa40025 */
/*       detecting opening/middlegame/endgame boundaries BY POSITION.       */
/* ====================================================================== */

const PhaseAccuracy = (() => {

  /* --------------------------------------------------------------- */
  /*  ACCURACY (verbatim from js/analysis.js)                         */
  /* --------------------------------------------------------------- */

  // Win percentage from centipawns, White's perspective.
  function winPct(evalCp) {
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * evalCp)) - 1);
  }

  // Shared blend. Computes the whole-game win% sequence and the per-move
  // volatility weights ONCE (over the whole game), then blends the
  // volatility-weighted mean with the harmonic mean over exactly the moves
  // for which includeFn(move, index) is true. Returns null when no move is
  // included (so callers can choose their own empty-case behaviour).
  function blend(movesData, playerColor, includeFn) {
    if (!movesData || !movesData.length) return null;

    // Win% (White's perspective) for EVERY position: index 0 = before move 1,
    // index k = after move k. Reconstructed from the per-move eval snapshots.
    const winPercents = [ winPct((movesData[0].evalBefore ?? 0) * 100) ];
    for (let i = 0; i < movesData.length; i++) {
      winPercents.push(winPct((movesData[i].eval ?? 0) * 100));
    }
    const nPlies = movesData.length;

    // Window size = clamp(floor(nPlies / 10), 2, 8).
    const windowSize = Math.max(2, Math.min(8, Math.floor(nPlies / 10)));

    // One volatility weight per move = clamped POPULATION std-dev of win% over
    // a sliding window, with the start padded by (windowSize - 2) copies of the
    // first window so that weights.length === nPlies (aligned to each move).
    const padCount = Math.max(0, Math.min(windowSize, winPercents.length) - 2);
    const windows  = [];
    const firstWin = winPercents.slice(0, windowSize);
    for (let p = 0; p < padCount; p++) windows.push(firstWin);
    for (let s = 0; s + windowSize <= winPercents.length; s++) {
      windows.push(winPercents.slice(s, s + windowSize));
    }
    const weights = windows.map(w => {
      const mean = w.reduce((a, b) => a + b, 0) / w.length;
      const sd   = Math.sqrt(w.reduce((a, b) => a + (b - mean) * (b - mean), 0) / w.length);
      return Math.max(0.5, Math.min(12, sd));   // squeeze(0.5, 12)
    });

    // Chosen moves' per-move accuracies (Lichess curve, +1 bonus) + aligned
    // whole-game weights (indexed by the move's position in the full game).
    const accs  = [];
    const pairs = [];   // [accuracy, weight]
    for (let i = 0; i < nPlies; i++) {
      const m = movesData[i];
      if (m.color !== playerColor) continue;
      if (!includeFn(m, i)) continue;
      const wpBefore = winPct((m.evalBefore ?? 0) * 100);
      const wpAfter  = winPct((m.eval        ?? 0) * 100);
      const wpl = m.color === 'white'
        ? Math.max(0, wpBefore - wpAfter)
        : Math.max(0, wpAfter  - wpBefore);
      const acc = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * wpl) - 3.1669 + 1));
      accs.push(acc);
      pairs.push([acc, (weights[i] != null ? weights[i] : 1)]);
    }
    if (!accs.length) return null;

    // Volatility-weighted mean: Σ(acc·w) / Σw  (weights clamped ≥ 0.5, Σw > 0).
    let vw = 0, ws = 0;
    pairs.forEach(p => { vw += p[0] * p[1]; ws += p[1]; });
    const weightedMean = ws > 0 ? (vw / ws) : (accs.reduce((a, b) => a + b, 0) / accs.length);

    // Harmonic mean with Lichess's max(1, acc) floor (divide-by-zero safe).
    let recip = 0;
    accs.forEach(v => { recip += 1 / Math.max(1, v); });
    const harmonicMean = accs.length / recip;

    return Math.round((weightedMean + harmonicMean) / 2);
  }

  // Whole-game accuracy for one side — reproduces calculateAccuracy EXACTLY
  // (empty game / side with no moves → 0, matching the original).
  function overallAccuracy(movesData, playerColor) {
    const r = blend(movesData, playerColor, () => true);
    return r == null ? 0 : r;
  }

  // Accuracy for one side over plies in the half-open range [plyLo, plyHi).
  // Empty slice → null sentinel (renderer shows "—").
  function phaseAccuracy(movesData, playerColor, plyLo, plyHi) {
    return blend(movesData, playerColor, (m) => m.ply >= plyLo && m.ply < plyHi);
  }

  /* --------------------------------------------------------------- */
  /*  DIVISION (faithful scalachess Divider port)                     */
  /* --------------------------------------------------------------- */
  //
  // `boards` is an array of chess.js .board() 8x8 grids: row 0 = rank 8,
  // row 7 = rank 1, each cell {type,color}|null with color 'w'/'b'.
  // boards[0] MUST be the initial position, so the index equals the number
  // of plies already played (board index = true 0-based ply count).

  function majorsAndMinors(b) {
    let c = 0;
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const cell = b[r][f];
        if (cell && cell.type !== 'p' && cell.type !== 'k') c++;
      }
    }
    return c;
  }

  function backrankSparse(b) {
    // White pieces on rank 1 (chess.js row 7); black pieces on rank 8 (row 0).
    let white = 0, black = 0;
    for (let f = 0; f < 8; f++) {
      if (b[7][f] && b[7][f].color === 'w') white++;
      if (b[0][f] && b[0][f].color === 'b') black++;
    }
    return white < 4 || black < 4;
  }

  // Mixedness score table — VERBATIM from scalachess (y in 1..7; any
  // (white, black) pair not listed → 0).
  function score(y, white, black) {
    switch (white) {
      case 0:
        if (black === 1) return 1 + y;
        if (black === 2) return y < 6 ? 2 + (6 - y) : 0;
        if (black === 3) return y < 7 ? 3 + (7 - y) : 0;
        if (black === 4) return y < 7 ? 3 + (7 - y) : 0;
        return 0;
      case 1:
        if (black === 0) return 1 + (8 - y);
        if (black === 1) return 5 + Math.abs(4 - y);
        if (black === 2) return 4 + (7 - y);
        if (black === 3) return 5 + (7 - y);
        return 0;
      case 2:
        if (black === 0) return y > 2 ? 2 + (y - 2) : 0;
        if (black === 1) return 4 + (y - 1);
        if (black === 2) return 7;
        return 0;
      case 3:
        if (black === 0) return y > 1 ? 3 + (y - 1) : 0;
        if (black === 1) return 5 + (y - 1);
        return 0;
      case 4:
        if (black === 0) return y > 1 ? 3 + (y - 1) : 0;
        return 0;
      default:
        return 0;
    }
  }

  function mixedness(b) {
    let acc = 0;
    // 49 overlapping 2x2 regions: files {x, x+1} x ranks {y_idx, y_idx+1}.
    // Those ranks map to chess.js rows (7 - y_idx) and (6 - y_idx).
    for (let y = 0; y <= 6; y++) {
      for (let x = 0; x <= 6; x++) {
        let white = 0, black = 0;
        const rows = [7 - y, 6 - y];
        const files = [x, x + 1];
        rows.forEach(rr => files.forEach(ff => {
          const cell = b[rr][ff];
          if (cell) { if (cell.color === 'w') white++; else black++; }
        }));
        acc += score(y + 1, white, black);
      }
    }
    return acc;
  }

  // Returns { middle, end, plies }. middle/end are 0-based board indices
  // (number of plies played) or null. A move at 1-based ply j is played from
  // board j-1, so it is: opening if (j-1) < middle, middlegame if
  // middle <= (j-1) < end, endgame if (j-1) >= end.
  function divideGame(boards) {
    let middle = null, end = null;
    for (let i = 0; i < boards.length; i++) {
      const b = boards[i];
      if (middle === null &&
          (majorsAndMinors(b) <= 10 || backrankSparse(b) || mixedness(b) > 150)) {
        middle = i;
      }
      if (middle !== null && end === null && majorsAndMinors(b) <= 6) {
        end = i;
      }
    }
    // scalachess: keep midGame iff endGame.fold(true)(mid < _) — i.e. keep when
    // there is no endgame, or the middle strictly precedes the endgame.
    const keepMiddle = middle !== null && (end === null ? true : middle < end);
    if (!keepMiddle) middle = null;
    return { middle, end, plies: boards.length };
  }

  return {
    winPct,
    overallAccuracy,
    phaseAccuracy,
    divideGame,
    // exposed for targeted unit tests of the divider helpers
    _helpers: { majorsAndMinors, backrankSparse, mixedness, score }
  };
})();

// Node/CommonJS export so tests can require it directly if needed; harmless in
// the browser (no module global there) and guarded so it never throws.
if (typeof module !== 'undefined' && module.exports) { module.exports = PhaseAccuracy; }

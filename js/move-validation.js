/* ====================================================================== */
/*  move-validation.js — PURE helpers for coach move-number labelling and  */
/*  validation. Non-protected, Node-testable (mirrors js/phase-accuracy.js).*/
/*                                                                          */
/*  No DOM, no globals mutated (logRepairs touches localStorage only when   */
/*  it exists, guarded for Node). Concerns:                                 */
/*    1. plyToMoveLabel  — 1-based ply + SAN -> "6. Bc4" / "6... Nf6".       */
/*    2. buildMoveIndex  — verboseHistory -> { SAN: [ply, ...] }.            */
/*    3. repairCoachText — rewrite/strip WRONG move numbers the coach wrote, */
/*       touching ONLY move-reference tokens (never %, evals, counts).       */
/*    4. movePlayerLabel — single source of truth for "You played" vs        */
/*       "Opponent played" (the analyzer label bug).                         */
/*    5. logRepairs      — console + capped localStorage repair log.         */
/*                                                                          */
/*  CHESS FACTS: this module NEVER invents a move, number, or eval. It only  */
/*  relabels/validates text against the real game's SAN->ply index (which is */
/*  derived from Stockfish-classified moves / chess.js history).            */
/* ====================================================================== */

const MoveValidation = (() => {

  // SAN matcher (no capturing groups inside — all (?:...) — so the combined
  // token regex's capture indices stay stable). Case-sensitive on purpose:
  // piece letters are KQRBN, files are a-h, ranks 1-8. Do NOT add the /i flag.
  const SAN_SRC = '(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)';

  // A MOVE-REFERENCE token, in two shapes:
  //   Form B: "move 11 Bc4" / "Move 11, Bc4"  -> g1=prefix g2=num g3=sep g4=san
  //   Form A: "11.Bc4" / "11. Bc4" / "11...Nf6" -> g5=num g6=sep g7=spaces g8=san
  // Nothing else is a candidate: a number with no adjacent SAN (e.g. "move 20",
  // "53%", "+1.5", "3 games") never matches, so such numbers are never touched.
  const TOKEN_SRC =
    '(\\b[Mm]ove\\s+)(\\d+)(,?\\s+)(' + SAN_SRC + ')' +
    '|' +
    '(\\d+)(\\.\\.\\.|\\.)(\\s*)(' + SAN_SRC + ')';

  function newTokenRe() { return new RegExp(TOKEN_SRC, 'g'); }

  /* --------------------------------------------------------------- */
  /*  1. plyToMoveLabel                                               */
  /* --------------------------------------------------------------- */

  // 1-based half-move ply + SAN -> coach-facing move label.
  // moveNumber = ceil(ply/2); White moves are odd plies.
  function plyToMoveLabel(ply, san) {
    const n = Math.ceil(ply / 2);
    const s = (san === undefined || san === null || san === '') ? '...' : String(san);
    return (ply % 2 === 1) ? (n + '. ' + s) : (n + '... ' + s);
  }

  /* --------------------------------------------------------------- */
  /*  2. buildMoveIndex                                               */
  /* --------------------------------------------------------------- */

  // verboseHistory entries are chess.js verbose moves (.san); ply = index + 1.
  // Returns a plain object mapping each SAN -> array of plies it was played at
  // (so a SAN played more than once is detectably ambiguous). Also accepts the
  // saved-game classified-moves array (each has .san, ordered ply 1..n).
  function buildMoveIndex(verboseHistory) {
    const index = {};
    if (!Array.isArray(verboseHistory)) return index;
    for (let i = 0; i < verboseHistory.length; i++) {
      const entry = verboseHistory[i];
      if (!entry || entry.san == null) continue;
      const san = String(entry.san);
      const ply = i + 1;
      if (!index[san]) index[san] = [];
      index[san].push(ply);
    }
    return index;
  }

  function _isEmptyIndex(moveIndex) {
    if (!moveIndex) return true;
    if (moveIndex instanceof Map) return moveIndex.size === 0;
    return Object.keys(moveIndex).length === 0;
  }

  function _lookupPlies(moveIndex, san) {
    if (!moveIndex) return undefined;
    if (moveIndex instanceof Map) return moveIndex.get(san);
    return Object.prototype.hasOwnProperty.call(moveIndex, san) ? moveIndex[san] : undefined;
  }

  /* --------------------------------------------------------------- */
  /*  3. repairCoachText                                              */
  /* --------------------------------------------------------------- */

  // Scan coach text for move-reference tokens only. For each:
  //   - unique SAN in the index -> replace the written number with the real
  //     move number (ceil(ply/2)), keeping the "." / "..." / "move " form.
  //   - SAN absent or ambiguous (>1 plies) -> remove the number (and its
  //     separator / the word "move "), keep the SAN.
  //   - null/empty index (cross-game prose, no single game) -> strip-only mode:
  //     every move-reference number is removed, reason 'no-game-context'.
  // Non-move-reference numbers (percentages, evals, counts) are never matched,
  // so they pass through untouched. Already-correct numbers are left unchanged
  // and NOT logged, so the pass is idempotent (safe at both save and display).
  // Returns { text, repairs: [{ original, replacement, reason }] }.
  function repairCoachText(text, moveIndex) {
    const repairs = [];
    if (typeof text !== 'string' || text.length === 0) {
      return { text: (typeof text === 'string' ? text : ''), repairs };
    }
    const stripOnly = _isEmptyIndex(moveIndex);

    const out = text.replace(newTokenRe(),
      function (m, bMove, bNum, bSep, bSan, aNum, aSep, aSpace, aSan) {
        const isFormB = (bSan !== undefined);
        // The SAN is the last captured group of whichever form matched.
        const san = isFormB ? bSan : aSan;

        if (stripOnly) {
          repairs.push({ original: m, replacement: san, reason: 'no-game-context' });
          return san;
        }

        const plies = _lookupPlies(moveIndex, san);
        if (plies && plies.length === 1) {
          const correct    = Math.ceil(plies[0] / 2);
          const writtenNum = parseInt(isFormB ? bNum : aNum, 10);
          if (correct === writtenNum) return m; // already correct — no repair
          const replacement = isFormB
            ? (bMove + correct + bSep + san)
            : (correct + aSep + aSpace + san);
          repairs.push({ original: m, replacement, reason: 'corrected' });
          return replacement;
        }

        // zero matches (absent) or more than one (ambiguous) -> drop the number.
        const reason = (plies && plies.length > 1) ? 'ambiguous' : 'absent';
        repairs.push({ original: m, replacement: san, reason });
        return san;
      });

    return { text: out, repairs };
  }

  /* --------------------------------------------------------------- */
  /*  4. movePlayerLabel                                              */
  /* --------------------------------------------------------------- */

  function _normColor(c) {
    if (typeof c !== 'string') return null;
    const s = c.trim().toLowerCase();
    if (s === 'w' || s === 'white') return 'white';
    if (s === 'b' || s === 'black') return 'black';
    return null;
  }

  // Single source of truth for the analyzer move-detail label. Returns
  // 'You played' when the mover IS the human player, else 'Opponent played'.
  // Accepts either vocabulary ('w'/'white', 'b'/'black').
  function movePlayerLabel(moverColor, playerColor) {
    const m = _normColor(moverColor);
    const p = _normColor(playerColor);
    return (m && p && m === p) ? 'You played' : 'Opponent played';
  }

  /* --------------------------------------------------------------- */
  /*  5. logRepairs                                                   */
  /* --------------------------------------------------------------- */

  const REPAIR_LOG_KEY = 'csa_coach_repair_log';
  const REPAIR_LOG_CAP = 100;

  function logRepairs(repairs, context) {
    if (!repairs || !repairs.length) return;
    try {
      console.warn('[MoveValidation] ' + context + ': ' + repairs.length + ' coach move-number repair(s)', repairs);
    } catch (_) {}
    if (typeof localStorage === 'undefined') return;
    try {
      let log = [];
      try { log = JSON.parse(localStorage.getItem(REPAIR_LOG_KEY) || '[]'); } catch (_) { log = []; }
      if (!Array.isArray(log)) log = [];
      log.push({ at: new Date().toISOString(), context: context, repairs: repairs });
      if (log.length > REPAIR_LOG_CAP) log = log.slice(log.length - REPAIR_LOG_CAP);
      localStorage.setItem(REPAIR_LOG_KEY, JSON.stringify(log));
    } catch (_) {}
  }

  return {
    plyToMoveLabel,
    buildMoveIndex,
    repairCoachText,
    movePlayerLabel,
    logRepairs
  };
})();

// Node/CommonJS export so tests can require it directly; harmless in the
// browser (no module global) and guarded so it never throws.
if (typeof module !== 'undefined' && module.exports) { module.exports = MoveValidation; }

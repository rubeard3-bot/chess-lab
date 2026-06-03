const Engine = (() => {
  // Requires js/stockfish.js to be present locally — see SETUP.md
  const DEPTH = 20;

  function createWorker() {
    return new Worker('js/stockfish.js');
  }

  function waitFor(worker, predicate) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.removeEventListener('message', handler);
        reject(new Error('Stockfish init timeout'));
      }, 30000);

      function handler(e) {
        const line = typeof e === 'string' ? e : (e.data || '');
        if (predicate(line)) {
          clearTimeout(timer);
          worker.removeEventListener('message', handler);
          resolve();
        }
      }
      worker.addEventListener('message', handler);
    });
  }

  function analyzePosition(worker, fen) {
    return new Promise((resolve, reject) => {
      let bestEvalCp = 0;
      let isMate     = false;
      let mateIn     = 0;
      let pvUci      = [];

      const timer = setTimeout(() => {
        worker.removeEventListener('message', handler);
        reject(new Error('Position analysis timeout'));
      }, 15000);

      function handler(e) {
        const line = typeof e === 'string' ? e : (e.data || '');

        if (line.startsWith('info') && line.includes('score')) {
          const mateMatch = line.match(/\bscore mate (-?\d+)/);
          const cpMatch   = line.match(/\bscore cp (-?\d+)/);
          if (mateMatch) {
            isMate     = true;
            mateIn     = parseInt(mateMatch[1], 10);
            bestEvalCp = mateIn > 0 ? 9900 : -9900;
          } else if (cpMatch) {
            isMate     = false;
            bestEvalCp = parseInt(cpMatch[1], 10);
          }
          // Keep the last (deepest) PV seen
          if (line.includes(' pv ')) {
            const pvIdx = line.indexOf(' pv ');
            pvUci = line.slice(pvIdx + 4).trim().split(/\s+/).filter(Boolean);
          }
        }

        if (line.startsWith('bestmove')) {
          clearTimeout(timer);
          worker.removeEventListener('message', handler);
          const parts    = line.split(' ');
          const bestMove = (parts[1] && parts[1] !== '(none)') ? parts[1] : null;
          resolve({ bestEvalCp, isMate, mateIn, bestMove, pvUci });
        }
      }

      worker.addEventListener('message', handler);
      worker.postMessage('position fen ' + fen);
      worker.postMessage('go depth ' + DEPTH);
    });
  }

  function stopAndDrain(worker) {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        worker.removeEventListener('message', handler);
        resolve();
      }, 2000);
      function handler(e) {
        const line = typeof e === 'string' ? e : (e.data || '');
        if (line.startsWith('bestmove')) {
          clearTimeout(timer);
          worker.removeEventListener('message', handler);
          resolve();
        }
      }
      worker.addEventListener('message', handler);
      worker.postMessage('stop');
    });
  }

  async function analyzeAllPositions(fens, onProgress) {
    let worker;
    try {
      worker = createWorker();
    } catch (e) {
      const err = new Error('Failed to start Stockfish: ' + e.message);
      err.code = 'ENGINE_ERROR';
      throw err;
    }

    try {
      worker.postMessage('uci');
      await waitFor(worker, line => line === 'uciok');
      worker.postMessage('setoption name Hash value 64');
      worker.postMessage('isready');
      await waitFor(worker, line => line === 'readyok');
    } catch (e) {
      worker.terminate();
      const err = new Error('Stockfish failed to initialize: ' + e.message);
      err.code = 'ENGINE_ERROR';
      throw err;
    }

    const results = [];
    const total   = fens.length;
    let lastEvalFromWhiteCp = 0;

    for (let i = 0; i < total; i++) {
      if (onProgress) onProgress(i, total);

      const chess      = new Chess(fens[i]);
      const sideToMove = chess.turn();

      let sfResult;
      let attempts = 0;
      while (true) {
        try {
          sfResult = await analyzePosition(worker, fens[i]);
          lastEvalFromWhiteCp = sideToMove === 'b' ? -sfResult.bestEvalCp : sfResult.bestEvalCp;
          break;
        } catch (e) {
          attempts++;
          await stopAndDrain(worker);
          if (attempts >= 2) {
            const fallbackCp = sideToMove === 'b' ? -lastEvalFromWhiteCp : lastEvalFromWhiteCp;
            sfResult = { bestEvalCp: fallbackCp, isMate: false, mateIn: 0, bestMove: null, pvUci: [] };
            break;
          }
        }
      }

      // Stockfish returns eval from the side-to-move's perspective; convert to white's
      const evalCpFromSide = sfResult.bestEvalCp;
      const evalFromWhite  = sideToMove === 'b' ? -evalCpFromSide : evalCpFromSide;
      const evalPawns      = evalFromWhite / 100;

      let bestMoveSan  = null;
      let bestMoveFrom = null;
      let bestMoveTo   = null;

      if (sfResult.bestMove) {
        bestMoveFrom   = sfResult.bestMove.slice(0, 2);
        bestMoveTo     = sfResult.bestMove.slice(2, 4);
        const promo    = sfResult.bestMove.length > 4 ? sfResult.bestMove[4] : undefined;
        try {
          const tmp    = new Chess(fens[i]);
          const moved  = tmp.move({ from: bestMoveFrom, to: bestMoveTo, promotion: promo });
          bestMoveSan  = moved ? moved.san : sfResult.bestMove;
        } catch (_) {
          bestMoveSan  = sfResult.bestMove;
        }
      }

      // Convert PV UCI moves to SAN notation (up to 10 half-moves)
      const pvSan = [];
      try {
        const pvChess = new Chess(fens[i]);
        for (const uciMove of (sfResult.pvUci || []).slice(0, 10)) {
          const from  = uciMove.slice(0, 2);
          const to    = uciMove.slice(2, 4);
          const promo = uciMove.length > 4 ? uciMove[4] : undefined;
          const moved = pvChess.move({ from, to, promotion: promo });
          if (!moved) break;
          pvSan.push(moved.san);
        }
      } catch (_) {}

      results.push({
        ply:         i,
        fen:         fens[i],
        eval:        evalPawns,
        isMate:      sfResult.isMate,
        mateIn:      sfResult.mateIn,
        bestMoveUci: sfResult.bestMove,
        bestMoveSan,
        bestMoveFrom,
        bestMoveTo,
        pvSan
      });
    }

    worker.terminate();
    return results;
  }

  /* ================================================================
     LIVE SINGLE-POSITION EVALUATOR  (exploration / on-demand)
     ----------------------------------------------------------------
     Lazily spins up ONE persistent worker that reuses the same
     js/stockfish.js engine as analyzeAllPositions(). The batch
     analyzer terminates its own worker before game review begins,
     so at most one Stockfish worker is ever live — this is the
     analyzer's existing engine in an on-demand mode, NOT a second
     engine. Used by js/explore.js for explored sideline positions.
     ================================================================ */

  const LIVE_DEPTH = 18;
  let liveWorker  = null;
  let liveReady   = null;   // Promise: resolves once uciok + readyok
  let liveSeq     = 0;      // bumped per request; stale output is ignored
  let liveHandler = null;

  function ensureLiveWorker() {
    if (liveWorker) return liveReady;
    liveWorker = createWorker();
    liveReady = (async () => {
      liveWorker.postMessage('uci');
      await waitFor(liveWorker, line => line === 'uciok');
      liveWorker.postMessage('setoption name Hash value 64');
      liveWorker.postMessage('isready');
      await waitFor(liveWorker, line => line === 'readyok');
    })();
    return liveReady;
  }

  // Evaluate `fen` live, streaming results to onUpdate. Each call supersedes
  // the previous one (stop + new search), so rapid position changes are safe.
  async function evaluateLive(fen, onUpdate) {
    const seq = ++liveSeq;
    try {
      await ensureLiveWorker();
    } catch (_) { return; }
    if (seq !== liveSeq) return;  // superseded while booting

    if (liveHandler) { liveWorker.removeEventListener('message', liveHandler); liveHandler = null; }
    liveWorker.postMessage('stop');

    const sideToMove = (fen.split(' ')[1] === 'b') ? 'b' : 'w';
    let evalCpWhite = 0, isMate = false, mateInWhite = 0, bestUci = null;

    function emit(final) {
      if (onUpdate) onUpdate({
        evalPawns:   evalCpWhite / 100,
        isMate,
        mateIn:      mateInWhite,
        bestMoveUci: bestUci,
        final
      });
    }

    liveHandler = function (e) {
      if (seq !== liveSeq) return;  // a newer request started
      const line = typeof e === 'string' ? e : (e.data || '');

      if (line.startsWith('info') && line.includes('score')) {
        const mateMatch = line.match(/\bscore mate (-?\d+)/);
        const cpMatch   = line.match(/\bscore cp (-?\d+)/);
        if (mateMatch) {
          isMate      = true;
          const mFromSide = parseInt(mateMatch[1], 10);
          mateInWhite = sideToMove === 'b' ? -mFromSide : mFromSide;
          evalCpWhite = mateInWhite > 0 ? 9900 : -9900;
        } else if (cpMatch) {
          isMate      = false;
          const cp    = parseInt(cpMatch[1], 10);
          evalCpWhite = sideToMove === 'b' ? -cp : cp;
        }
        const pvIdx = line.indexOf(' pv ');
        if (pvIdx !== -1) {
          const first = line.slice(pvIdx + 4).trim().split(/\s+/)[0];
          if (first) bestUci = first;
        }
        emit(false);
      } else if (line.startsWith('bestmove')) {
        const bm = line.split(' ')[1];
        if (bm && bm !== '(none)') bestUci = bm;
        emit(true);
      }
    };

    liveWorker.addEventListener('message', liveHandler);
    liveWorker.postMessage('position fen ' + fen);
    liveWorker.postMessage('go depth ' + LIVE_DEPTH);
  }

  // Stop any in-flight live search and ignore its pending output.
  function stopLiveEval() {
    liveSeq++;
    if (liveWorker) {
      if (liveHandler) { liveWorker.removeEventListener('message', liveHandler); liveHandler = null; }
      liveWorker.postMessage('stop');
    }
  }

  return { analyzeAllPositions, evaluateLive, stopLiveEval };
})();

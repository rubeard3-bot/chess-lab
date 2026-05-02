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

  return { analyzeAllPositions };
})();

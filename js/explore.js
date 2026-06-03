/* ============================================================
   explore.js — interactive "what if" exploration board (ANALYZER ONLY)
   ------------------------------------------------------------
   Lets the user grab pieces on the analyzer board to play out a
   temporary sideline branching from the real reviewed position.
   Stockfish (the analyzer's own engine, via Engine.evaluateLive)
   evaluates explored positions; the eval bar + best-move arrow
   update live. Exiting (Back-to-game button OR any nav arrow/key)
   discards the sideline entirely — nothing is persisted.

   State safety: the real game (App's fens / verboseHistory /
   analysisData) is read-only here. Exploration always branches
   from a COPY (new Chess(branchFen)). Returning to the real game
   is a normal App.navigateToPly(), which rebuilds from real data.

   Reuses board.js (the analyzer's single renderer) for all drawing.
   Does NOT touch practice-board.js.
   ============================================================ */

const Explore = (() => {

  let app = null;             // hooks from app.js

  /* sideline state */
  let active     = false;
  let chess      = null;      // the sideline position (a COPY of real)
  let probe      = null;      // throwaway copy of the real position (pre-branch)
  let branchPly  = 0;         // real ply we branched from
  let branchFen  = '';        // exact real FEN at the branch point
  let lineSan    = [];        // SAN moves played in the sideline
  let lastFrom   = null;      // last sideline move (for board highlight)
  let lastTo     = null;
  let lastArrowUci = null;    // current best-move arrow (avoid redundant redraws)

  /* interaction state */
  let selSq      = null;      // selected source square
  let legalDests = [];        // legal targets from selSq
  let pendingPromo = null;    // { from, to }
  let mouseDownSq = null, dragArmed = false, didDrag = false, downX = 0, downY = 0;

  /* ------------------------------------------------------------------ */
  /*  INIT                                                               */
  /* ------------------------------------------------------------------ */

  function init(hooks) {
    app = hooks;
    const canvas = document.getElementById('chess-board');
    if (!canvas) return;

    canvas.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);

    const back = document.getElementById('btn-explore-back');
    if (back) back.addEventListener('click', backToGame);

    const undo = document.getElementById('btn-explore-undo');
    if (undo) undo.addEventListener('click', undoMove);

    const promoOverlay = document.getElementById('explore-promo-overlay');
    if (promoOverlay) {
      promoOverlay.addEventListener('click', e => {
        if (e.target === promoOverlay) cancelPromo();  // click backdrop = cancel
      });
    }
  }

  function isActive() { return active; }

  /* ------------------------------------------------------------------ */
  /*  POSITION HELPERS                                                   */
  /* ------------------------------------------------------------------ */

  function gameLoaded() { return app && app.getState().totalPlies > 0; }

  // The position the user is currently interacting with.
  function workingPos() {
    if (active) return chess;
    if (!probe) probe = new Chess(app.getCurrentFen());  // COPY of real position
    return probe;
  }

  /* ------------------------------------------------------------------ */
  /*  POINTER INPUT (mouse)                                              */
  /* ------------------------------------------------------------------ */

  function onMouseDown(e) {
    if (e.button !== 0) return;
    if (!gameLoaded() || pendingPromo) return;
    const sq = Board.pixelToSquare(e.clientX, e.clientY);
    if (!sq) return;
    beginInteraction(sq, e.clientX, e.clientY);
  }

  function onMouseMove(e) {
    if (!dragArmed) return;
    updateDrag(e.clientX, e.clientY);
  }

  function onMouseUp(e) {
    if (!dragArmed) return;
    endInteraction(e.clientX, e.clientY);
  }

  /* ------------------------------------------------------------------ */
  /*  POINTER INPUT (touch)                                              */
  /* ------------------------------------------------------------------ */

  function onTouchStart(e) {
    if (!gameLoaded() || pendingPromo) return;
    const t = e.touches[0];
    if (!t) return;
    const sq = Board.pixelToSquare(t.clientX, t.clientY);
    if (!sq) return;
    e.preventDefault();
    beginInteraction(sq, t.clientX, t.clientY);
  }

  function onTouchMove(e) {
    if (!dragArmed) return;
    const t = e.touches[0];
    if (!t) return;
    e.preventDefault();
    updateDrag(t.clientX, t.clientY);
  }

  function onTouchEnd(e) {
    if (!dragArmed) return;
    const t = e.changedTouches[0];
    if (!t) { dragArmed = false; return; }
    endInteraction(t.clientX, t.clientY);
  }

  /* ------------------------------------------------------------------ */
  /*  INTERACTION CORE (shared by mouse + touch; drag AND click-click)   */
  /* ------------------------------------------------------------------ */

  function beginInteraction(sq, clientX, clientY) {
    const pos = workingPos();

    // Click-to-move completion: a source is selected and this is a legal target
    if (selSq && legalDests.includes(sq)) {
      attemptMove(selSq, sq);
      return;
    }

    const piece = pos.get(sq);
    if (piece && piece.color === pos.turn()) {
      // Select this piece (and arm a potential drag)
      selSq = sq;
      legalDests = pos.moves({ square: sq, verbose: true }).map(m => m.to);
      Board.setSelection(selSq, legalDests);
      dragArmed = true; didDrag = false;
      mouseDownSq = sq; downX = clientX; downY = clientY;
    } else {
      clearSelection();
    }
  }

  function updateDrag(clientX, clientY) {
    if (!didDrag && (Math.abs(clientX - downX) > 4 || Math.abs(clientY - downY) > 4)) {
      didDrag = true;
    }
    if (!didDrag) return;
    const pos = workingPos();
    const piece = pos.get(mouseDownSq);
    if (!piece) return;
    Board.setDrag({
      key: piece.color + piece.type.toUpperCase(),
      fromSq: mouseDownSq,
      clientX, clientY
    });
  }

  function endInteraction(clientX, clientY) {
    const wasDrag = didDrag;
    dragArmed = false; didDrag = false;
    if (!wasDrag) { mouseDownSq = null; return; }  // plain click: selection stays

    Board.setDrag(null);
    const sq = Board.pixelToSquare(clientX, clientY);
    if (sq && sq !== mouseDownSq && legalDests.includes(sq)) {
      attemptMove(mouseDownSq, sq);
    } else {
      Board.setSelection(selSq, legalDests);  // restore dots; keep click-click alive
    }
    mouseDownSq = null;
  }

  /* ------------------------------------------------------------------ */
  /*  MOVE ATTEMPT / COMMIT                                              */
  /* ------------------------------------------------------------------ */

  function attemptMove(from, to) {
    const pos = workingPos();
    const piece = pos.get(from);
    if (!piece) { clearSelection(); return; }

    const legal = pos.moves({ square: from, verbose: true }).some(m => m.to === to);
    if (!legal) { clearSelection(); return; }

    const isPromo = piece.type === 'p' &&
      ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));

    if (isPromo) {
      pendingPromo = { from, to };
      selSq = null; legalDests = [];
      Board.setSelection(null, []);
      showPromoModal(piece.color);
      return;
    }
    commitMove(from, to, undefined);
  }

  function commitMove(from, to, promotion) {
    // Before branching: if this is exactly the real game's next move, just
    // advance the real review instead of starting a sideline.
    if (!active) {
      const realNext = app.getRealMoveAt(app.getState().currentPly);
      if (realNext && realNext.from === from && realNext.to === to &&
          (realNext.promotion || undefined) === (promotion || undefined)) {
        clearSelection();
        app.navigateToPly(app.getState().currentPly + 1);
        return;
      }
      // Branch from a COPY of the exact real position.
      branchPly = app.getState().currentPly;
      branchFen = app.getCurrentFen();
      chess     = new Chess(branchFen);
      lineSan   = [];
      active    = true;
    }

    const m = chess.move({ from, to, promotion });
    if (!m) { clearSelection(); return; }

    lineSan.push(m.san);
    lastFrom = from; lastTo = to;
    selSq = null; legalDests = []; lastArrowUci = null;

    Board.clearInteractive();
    Board.setPosition(chess, lastFrom, lastTo, null, null);
    app.renderMaterial(chess);
    showBanner();
    evaluate();
  }

  /* ------------------------------------------------------------------ */
  /*  PROMOTION PICKER (analyzer-scoped; mirrors Free Play UX)           */
  /* ------------------------------------------------------------------ */

  function showPromoModal(color) {
    const opts = document.getElementById('explore-promo-options');
    const overlay = document.getElementById('explore-promo-overlay');
    if (!opts || !overlay) { commitMove(pendingPromo.from, pendingPromo.to, 'q'); return; }
    opts.innerHTML = '';
    ['q', 'r', 'b', 'n'].forEach(type => {
      const key = color + type.toUpperCase();
      const div = document.createElement('div');
      div.className = 'explore-promo-piece';
      const img = document.createElement('img');
      img.src = Board.pieceUrl(key);
      img.alt = key;
      div.appendChild(img);
      div.addEventListener('click', () => completePromo(type));
      opts.appendChild(div);
    });
    overlay.classList.remove('hidden');
  }

  function completePromo(type) {
    const overlay = document.getElementById('explore-promo-overlay');
    if (overlay) overlay.classList.add('hidden');
    if (!pendingPromo) return;
    const { from, to } = pendingPromo;
    pendingPromo = null;
    commitMove(from, to, type);
  }

  function cancelPromo() {
    const overlay = document.getElementById('explore-promo-overlay');
    if (overlay) overlay.classList.add('hidden');
    pendingPromo = null;
    clearSelection();
  }

  /* ------------------------------------------------------------------ */
  /*  LIVE EVALUATION (eval bar + best-move arrow)                       */
  /* ------------------------------------------------------------------ */

  function evaluate() {
    const fen = chess.fen();
    Engine.evaluateLive(fen, res => {
      if (!active || chess.fen() !== fen) return;  // sideline moved on — stale

      if (res.isMate) UI.setEvalMate(res.mateIn, app.getPlayerColor());
      else            UI.updateEvalBar(res.evalPawns, app.getPlayerColor());

      // Best-move arrow for the CURRENT explored position (respect the toggle).
      if (app.getShowArrow() && res.bestMoveUci) {
        if (res.bestMoveUci !== lastArrowUci) {
          lastArrowUci = res.bestMoveUci;
          const bf = res.bestMoveUci.slice(0, 2);
          const bt = res.bestMoveUci.slice(2, 4);
          Board.setPosition(chess, lastFrom, lastTo, bf, bt);
        }
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  BANNER + LINE READOUT                                              */
  /* ------------------------------------------------------------------ */

  function showBanner() {
    document.getElementById('explore-badge')?.classList.remove('hidden');
    document.getElementById('btn-explore-undo')?.classList.remove('hidden');
    document.getElementById('btn-explore-back')?.classList.remove('hidden');
    updateLineReadout();
  }

  function hideBanner() {
    document.getElementById('explore-badge')?.classList.add('hidden');
    document.getElementById('btn-explore-undo')?.classList.add('hidden');
    document.getElementById('btn-explore-back')?.classList.add('hidden');
    const overlay = document.getElementById('explore-promo-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function updateLineReadout() {
    const el = document.getElementById('explore-line');
    if (!el) return;
    el.textContent = formatLine();
  }

  function formatLine() {
    const parts = (branchFen || '').split(' ');
    let moveNum = parseInt(parts[5] || '1', 10) || 1;
    let white   = parts[1] !== 'b';
    const out = [];
    lineSan.forEach((san, i) => {
      if (white)        out.push(moveNum + '. ' + san);
      else if (i === 0) out.push(moveNum + '... ' + san);
      else              out.push(san);
      if (!white) moveNum++;
      white = !white;
    });
    return out.join(' ');
  }

  /* ------------------------------------------------------------------ */
  /*  EXIT / RESTORE                                                     */
  /* ------------------------------------------------------------------ */

  // "Back to game" button → snap to the exact real position we branched from.
  function backToGame() {
    if (!active) return;
    const bp = branchPly;
    app.navigateToPly(bp);   // navigateToPly → handleRealNav() tears the sideline down
  }

  // Called at the top of App.navigateToPly() for EVERY real-game navigation
  // (nav arrows, keyboard, eval-graph clicks, move-list clicks). Discards any
  // sideline / in-progress selection so normal review resumes cleanly.
  // While exploring, returns the branch ply so the first nav SNAPS BACK to the
  // exact branch position; the caller's requested target applies on the next
  // (now non-exploring) press. Returns undefined otherwise.
  function handleRealNav(requestedPly) {
    if (!active && !selSq && !probe) return undefined;
    const wasActive = active;
    const bp = branchPly;
    teardown();
    return wasActive ? bp : undefined;
  }

  // Undo (takeback) one ply within the sideline. Undoing the only move leaves
  // exploration entirely (back to the real branch position).
  function undoMove() {
    if (!active) return;
    if (lineSan.length <= 1) { backToGame(); return; }
    chess.undo();
    lineSan.pop();
    const hist = chess.history({ verbose: true });
    const last = hist[hist.length - 1] || null;
    lastFrom = last ? last.from : null;
    lastTo   = last ? last.to   : null;
    lastArrowUci = null;
    selSq = null; legalDests = [];
    Board.clearInteractive();
    Board.setPosition(chess, lastFrom, lastTo, null, null);
    app.renderMaterial(chess);
    updateLineReadout();
    evaluate();
  }

  function teardown() {
    active = false;
    chess = null; probe = null;
    branchPly = 0; branchFen = '';
    lineSan = [];
    lastFrom = null; lastTo = null; lastArrowUci = null;
    selSq = null; legalDests = [];
    dragArmed = false; didDrag = false; mouseDownSq = null;
    pendingPromo = null;
    Engine.stopLiveEval();
    Board.clearInteractive();
    hideBanner();
  }

  function clearSelection() {
    selSq = null; legalDests = [];
    if (!active) probe = null;   // re-sync from real position on next selection
    Board.setSelection(null, []);
  }

  return { init, isActive, handleRealNav };
})();

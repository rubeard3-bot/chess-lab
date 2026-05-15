(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────
  const LIGHT = window.BOARD_LIGHT || '#f0d9b5';
  const DARK  = window.BOARD_DARK  || '#b58863';

  // Unicode fallback symbols (used only when an SVG fails to load)
  const SYM = {
    wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
    bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
  };

  const PIECE_URLS = {
    wK: 'https://lichess1.org/assets/piece/cburnett/wK.svg',
    wQ: 'https://lichess1.org/assets/piece/cburnett/wQ.svg',
    wR: 'https://lichess1.org/assets/piece/cburnett/wR.svg',
    wB: 'https://lichess1.org/assets/piece/cburnett/wB.svg',
    wN: 'https://lichess1.org/assets/piece/cburnett/wN.svg',
    wP: 'https://lichess1.org/assets/piece/cburnett/wP.svg',
    bK: 'https://lichess1.org/assets/piece/cburnett/bK.svg',
    bQ: 'https://lichess1.org/assets/piece/cburnett/bQ.svg',
    bR: 'https://lichess1.org/assets/piece/cburnett/bR.svg',
    bB: 'https://lichess1.org/assets/piece/cburnett/bB.svg',
    bN: 'https://lichess1.org/assets/piece/cburnett/bN.svg',
    bP: 'https://lichess1.org/assets/piece/cburnett/bP.svg',
  };

  const pieceImages = {};

  const PX = 560;
  const SQ = PX / 8; // 70

  // ── State ──────────────────────────────────────────────────────────────
  let chess      = new Chess();
  let selSq      = null;
  let legDests   = [];
  let lastFrom   = null;
  let lastTo     = null;
  let bestFrom   = null;
  let bestTo     = null;
  let showBM     = true;
  let showEB     = true;
  let setPosMode = false;
  let palSel     = null;   // null | 'erase' | {color, type}
  let moveHist   = [];     // [{san}]
  let pendingPromo = null; // {from, to} while promotion modal is open

  // Stockfish state
  let sf       = null;
  let sfReady  = false;
  let sfBusy   = false;
  let sfSkip   = false;   // ignore the next bestmove (after stop)
  let sfTurn   = 'w';
  let sfCp     = 0;
  let sfMate   = false;
  let sfMateIn = 0;

  // ── Canvas setup ───────────────────────────────────────────────────────
  const canvas = document.getElementById('practice-canvas');
  const ctx    = canvas.getContext('2d');
  canvas.width  = PX;
  canvas.height = PX;

  // ── Image loading ──────────────────────────────────────────────────────
  function loadPieceImages() {
    const promises = Object.entries(PIECE_URLS).map(([key, url]) =>
      new Promise(resolve => {
        const img = new Image();
        img.onload  = () => { pieceImages[key] = img; resolve(); };
        img.onerror = () => resolve(); // fallback to Unicode on failure
        img.src     = url;
      })
    );
    return Promise.all(promises);
  }

  // ── Coordinate helpers ─────────────────────────────────────────────────
  function sqToRC(sq) {
    return { c: sq.charCodeAt(0) - 97, r: 8 - parseInt(sq[1]) };
  }
  function rcToSq(c, r) {
    return (c >= 0 && c <= 7 && r >= 0 && r <= 7)
      ? String.fromCharCode(97 + c) + (8 - r)
      : null;
  }
  function canvasToSq(x, y) {
    return rcToSq(Math.floor(x / SQ), Math.floor(y / SQ));
  }
  function sqCenter(sq) {
    const { c, r } = sqToRC(sq);
    return { x: c * SQ + SQ / 2, y: r * SQ + SQ / 2 };
  }

  // ── Rendering ──────────────────────────────────────────────────────────
  function render() {
    ctx.clearRect(0, 0, PX, PX);
    drawSquares();
    drawHighlights();
    if (selSq && !setPosMode) drawSelected();
    if (!setPosMode) drawDots();
    drawPieces();
    if (showBM && bestFrom && bestTo && !setPosMode) drawArrow();
    drawCoords();
  }

  function drawSquares() {
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? LIGHT : DARK;
        ctx.fillRect(c * SQ, r * SQ, SQ, SQ);
      }
  }

  function drawHighlights() {
    [lastFrom, lastTo].forEach(sq => {
      if (!sq) return;
      const { c, r } = sqToRC(sq);
      ctx.fillStyle = 'rgba(255,200,0,0.40)';
      ctx.fillRect(c * SQ, r * SQ, SQ, SQ);
    });
  }

  function drawSelected() {
    const { c, r } = sqToRC(selSq);
    ctx.fillStyle = 'rgba(80,160,255,0.42)';
    ctx.fillRect(c * SQ, r * SQ, SQ, SQ);
  }

  function drawDots() {
    legDests.forEach(sq => {
      const { c, r } = sqToRC(sq);
      const cx = c * SQ + SQ / 2;
      const cy = r * SQ + SQ / 2;
      ctx.save();
      if (chess.get(sq)) {
        // Ring for captures
        ctx.strokeStyle = 'rgba(0,0,0,0.30)';
        ctx.lineWidth   = SQ * 0.09;
        ctx.beginPath();
        ctx.arc(cx, cy, SQ * 0.46, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Dot for empty squares
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        ctx.arc(cx, cy, SQ * 0.155, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  function drawPieces() {
    chess.board().forEach((row, ri) => {
      row.forEach((p, ci) => {
        if (!p) return;
        const key = p.color + p.type.toUpperCase();
        const x   = ci * SQ;
        const y   = ri * SQ;

        if (pieceImages[key]) {
          ctx.drawImage(pieceImages[key], x, y, SQ, SQ);
        } else {
          // Unicode fallback
          const sym = SYM[key];
          if (!sym) return;
          const cx = x + SQ / 2;
          const cy = y + SQ / 2;
          const fs = Math.floor(SQ * 0.70);
          ctx.font         = `${fs}px "Segoe UI Emoji","Apple Color Emoji",serif`;
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle    = 'rgba(0,0,0,0.28)';
          ctx.fillText(sym, cx + 1.2, cy + 1.2);
          ctx.fillStyle    = p.color === 'w' ? '#ffffff' : '#1a1a1a';
          ctx.fillText(sym, cx, cy);
        }
      });
    });
  }

  function drawArrow() {
    const f  = sqCenter(bestFrom);
    const t  = sqCenter(bestTo);
    const a  = Math.atan2(t.y - f.y, t.x - f.x);
    const hl = SQ * 0.38;
    const lw = SQ * 0.14;
    const bx = t.x - hl * 0.65 * Math.cos(a);
    const by = t.y - hl * 0.65 * Math.sin(a);
    ctx.save();
    ctx.strokeStyle = 'rgba(0,210,90,0.82)';
    ctx.fillStyle   = 'rgba(0,210,90,0.82)';
    ctx.lineWidth   = lw;
    ctx.lineCap     = 'round';
    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(bx, by); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(t.x - hl * Math.cos(a - Math.PI / 6), t.y - hl * Math.sin(a - Math.PI / 6));
    ctx.lineTo(t.x - hl * Math.cos(a + Math.PI / 6), t.y - hl * Math.sin(a + Math.PI / 6));
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawCoords() {
    const fs = Math.max(9, Math.floor(SQ * 0.18));
    ctx.font = `600 ${fs}px "Segoe UI",sans-serif`;
    for (let r = 0; r < 8; r++) {
      ctx.fillStyle    = r % 2 === 0 ? DARK : LIGHT;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(8 - r), 2, r * SQ + 2);
    }
    for (let c = 0; c < 8; c++) {
      ctx.fillStyle    = c % 2 !== 0 ? DARK : LIGHT;
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String.fromCharCode(97 + c), (c + 1) * SQ - 2, PX - 2);
    }
  }

  // ── Eval bar ───────────────────────────────────────────────────────────
  function setEval(pawns, mateW) {
    const fill = document.getElementById('eval-bar-fill');
    const txt  = document.getElementById('eval-bar-text');
    let pct, label;
    if (mateW !== null) {
      pct   = mateW > 0 ? 2 : 98;
      label = mateW > 0 ? `+M${mateW}` : `-M${Math.abs(mateW)}`;
    } else {
      pct   = 50 - Math.tanh(pawns / 5) * 50;
      pct   = Math.max(2, Math.min(98, pct));
      label = (pawns >= 0 ? '+' : '') + pawns.toFixed(1);
    }
    fill.style.height = pct + '%';
    txt.textContent   = label;
  }

  // ── Status helper ──────────────────────────────────────────────────────
  function setStatus(msg, cls) {
    const el = document.getElementById('practice-status');
    el.textContent = msg;
    el.className   = 'practice-status' + (cls ? ' ' + cls : '');
  }

  // ── Stockfish ──────────────────────────────────────────────────────────
  function initSF() {
    try { sf = new Worker('js/stockfish.js'); }
    catch (e) { setStatus('Stockfish unavailable', 'err'); return; }
    sf.onmessage = onSFMsg;
    sf.onerror   = () => setStatus('Engine error', 'err');
    sf.postMessage('uci');
    setStatus('Loading Stockfish…', '');
  }

  function onSFMsg(e) {
    const line = typeof e === 'string' ? e : (e.data || '');

    if (!sfReady) {
      if (line === 'uciok') {
        sf.postMessage('setoption name Hash value 32');
        sf.postMessage('isready');
      } else if (line === 'readyok') {
        sfReady = true;
        setStatus('Stockfish ready', 'ok');
        setTimeout(() => {
          if (document.getElementById('practice-status').textContent === 'Stockfish ready')
            setStatus('', '');
        }, 1800);
        analyze();
      }
      return;
    }

    if (line.startsWith('info') && line.includes('score')) {
      const mm = line.match(/\bscore mate (-?\d+)/);
      const cm = line.match(/\bscore cp (-?\d+)/);
      if (mm)      { sfMate = true;  sfMateIn = parseInt(mm[1], 10); sfCp = sfMateIn > 0 ? 9900 : -9900; }
      else if (cm) { sfMate = false; sfCp     = parseInt(cm[1], 10); }
    }

    if (line.startsWith('bestmove')) {
      sfBusy = false;
      if (sfSkip) { sfSkip = false; return; }

      const parts = line.split(' ');
      const bmUci = (parts[1] && parts[1] !== '(none)') ? parts[1] : null;

      const epW   = (sfTurn === 'b' ? -sfCp : sfCp) / 100;
      const mateW = sfMate ? (sfTurn === 'b' ? -sfMateIn : sfMateIn) : null;

      bestFrom = bmUci ? bmUci.slice(0, 2) : null;
      bestTo   = bmUci ? bmUci.slice(2, 4) : null;

      if (showEB) setEval(epW, mateW);
      updateHistEval(epW, mateW, bmUci);

      if (!checkGameOver()) setStatus('', '');

      render();
    }
  }

  function analyze() {
    if (!sfReady || !sf || chess.game_over()) return;
    try {
      if (sfBusy) { sfSkip = true; sf.postMessage('stop'); }
      sfTurn = chess.turn();
      sfCp = 0; sfMate = false; sfMateIn = 0;
      sfBusy = true;
      sf.postMessage('position fen ' + chess.fen());
      sf.postMessage('go depth 18');
      setStatus('Analyzing…', '');
    } catch (_) {}
  }

  // ── Move history ───────────────────────────────────────────────────────
  function renderHistory() {
    const el = document.getElementById('history-scroll');
    if (!moveHist.length) {
      el.innerHTML = '<div class="history-empty">No moves yet</div>';
      return;
    }
    let html = '';
    for (let i = 0; i < moveHist.length; i += 2) {
      const n = Math.floor(i / 2) + 1;
      const w = moveHist[i].san;
      const b = moveHist[i + 1] ? moveHist[i + 1].san : '';
      html += `<div class="history-pair">
        <span class="history-num">${n}.</span>
        <span class="history-san">${w}</span>
        ${b ? `<span class="history-san">${b}</span>` : ''}
      </div>`;
    }
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }

  function updateHistEval(pawns, mateW, bmUci) {
    const el = document.getElementById('history-eval-box');
    let evalStr;
    if (mateW !== null) {
      evalStr = mateW > 0 ? `Mate in ${mateW}` : `Mated in ${Math.abs(mateW)}`;
    } else {
      evalStr = (pawns >= 0 ? '+' : '') + pawns.toFixed(2);
    }

    let bmSan = '';
    if (bmUci) {
      try {
        const tmp = new Chess(chess.fen());
        const m   = tmp.move({ from: bmUci.slice(0, 2), to: bmUci.slice(2, 4), promotion: bmUci[4] || undefined });
        bmSan = m ? m.san : bmUci.slice(0, 4);
      } catch (_) { bmSan = bmUci.slice(0, 4); }
    }

    el.innerHTML = `<span class="heval-val">${evalStr}</span>${bmSan ? `<span class="heval-bm">Best: ${bmSan}</span>` : ''}`;
  }

  // ── Click handler ──────────────────────────────────────────────────────
  canvas.addEventListener('click', function (e) {
    const rect = canvas.getBoundingClientRect();
    const sq   = canvasToSq(
      (e.clientX - rect.left) * (canvas.width  / rect.width),
      (e.clientY - rect.top)  * (canvas.height / rect.height)
    );
    if (!sq) return;
    setPosMode ? handleSetPosClick(sq) : handlePlayClick(sq);
  });

  function handlePlayClick(sq) {
    if (chess.game_over() || pendingPromo) return;

    if (selSq) {
      if (legDests.includes(sq)) {
        const piece = chess.get(selSq);
        const isPromo = piece && piece.type === 'p' &&
          ((piece.color === 'w' && sq[1] === '8') || (piece.color === 'b' && sq[1] === '1'));
        if (isPromo) {
          pendingPromo = { from: selSq, to: sq };
          selSq = null; legDests = [];
          render();
          showPromoModal(piece.color);
          return;
        }
        const m = chess.move({ from: selSq, to: sq });
        if (m) {
          lastFrom = selSq; lastTo = sq;
          selSq = null; legDests = [];
          bestFrom = bestTo = null;
          moveHist.push({ san: m.san });
          renderHistory();
          render();
          if (!checkGameOver()) analyze();
          return;
        }
      }
      const p = chess.get(sq);
      if (p && p.color === chess.turn()) doSelect(sq);
      else { selSq = null; legDests = []; render(); }
    } else {
      const p = chess.get(sq);
      if (p && p.color === chess.turn()) doSelect(sq);
    }
  }

  function showPromoModal(color) {
    const opts = document.getElementById('promo-options');
    opts.innerHTML = '';
    ['q', 'r', 'b', 'n'].forEach(type => {
      const key = color + type.toUpperCase();
      const div = document.createElement('div');
      div.className = 'promo-piece';
      const img = document.createElement('img');
      img.src = PIECE_URLS[key];
      img.alt = key;
      div.appendChild(img);
      div.addEventListener('click', () => completePromo(type));
      opts.appendChild(div);
    });
    document.getElementById('promo-overlay').classList.remove('hidden');
  }

  function completePromo(type) {
    document.getElementById('promo-overlay').classList.add('hidden');
    if (!pendingPromo) return;
    const { from, to } = pendingPromo;
    pendingPromo = null;
    const m = chess.move({ from, to, promotion: type });
    if (m) {
      lastFrom = from; lastTo = to;
      bestFrom = bestTo = null;
      moveHist.push({ san: m.san });
      renderHistory();
      render();
      if (!checkGameOver()) analyze();
    }
  }

  function doSelect(sq) {
    selSq    = sq;
    legDests = chess.moves({ square: sq, verbose: true }).map(m => m.to);
    render();
  }

  function checkGameOver() {
    if (!chess.game_over()) return false;
    bestFrom = bestTo = null;
    render();
    let msg, cls;
    if (chess.in_checkmate()) {
      msg = chess.turn() === 'w' ? 'Checkmate — Black wins' : 'Checkmate — White wins';
      cls = 'win';
    } else if (chess.in_stalemate()) {
      msg = 'Stalemate — Draw';
      cls = 'draw';
    } else if (chess.in_threefold_repetition()) {
      msg = 'Threefold Repetition — Draw';
      cls = 'draw';
    } else if (chess.insufficient_material()) {
      msg = 'Insufficient Material — Draw';
      cls = 'draw';
    } else {
      msg = 'Draw';
      cls = 'draw';
    }
    const result = document.getElementById('gameover-result');
    result.textContent = msg;
    result.className   = 'gameover-result ' + cls;
    document.getElementById('gameover-banner').classList.remove('hidden');
    return true;
  }

  function handleSetPosClick(sq) {
    if (!palSel) return;
    if (palSel === 'erase') {
      chess.remove(sq);
    } else {
      const { color, type } = palSel;
      if (type === 'k') {
        chess.board().forEach((row, ri) => {
          row.forEach((p, ci) => {
            if (p && p.type === 'k' && p.color === color) {
              const s = String.fromCharCode(97 + ci) + (8 - ri);
              if (s !== sq) chess.remove(s);
            }
          });
        });
      }
      chess.put({ type, color }, sq);
    }
    render();
  }

  // ── Buttons ────────────────────────────────────────────────────────────
  document.getElementById('btn-undo').addEventListener('click', () => {
    const m = chess.undo();
    if (!m) return;
    moveHist.pop();
    lastFrom = m.from; lastTo = null;
    selSq = null; legDests = [];
    bestFrom = bestTo = null;
    renderHistory();
    render();
    analyze();
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    if (!confirm('Reset board to starting position?')) return;
    chess    = new Chess();
    moveHist = [];
    selSq    = null; legDests = [];
    lastFrom = lastTo  = null;
    bestFrom = bestTo  = null;
    renderHistory();
    setEval(0, null);
    document.getElementById('history-eval-box').innerHTML = '';
    render();
    analyze();
  });

  document.getElementById('btn-setpos').addEventListener('click', () => {
    setPosMode = !setPosMode;
    document.getElementById('btn-setpos').classList.toggle('setpos-on', setPosMode);
    document.getElementById('palette-wrap').classList.toggle('hidden', !setPosMode);
    selSq = null; legDests = [];
    if (!setPosMode) { palSel = null; clearPal(); analyze(); }
    render();
  });

  document.getElementById('pal-done').addEventListener('click', () => {
    setPosMode = false;
    document.getElementById('btn-setpos').classList.remove('setpos-on');
    document.getElementById('palette-wrap').classList.add('hidden');
    palSel = null; clearPal();
    // Rebuild FEN from current board state, resetting castling/en-passant
    try {
      const b = chess.board();
      let newFen = '';
      for (let ri = 0; ri < 8; ri++) {
        let empty = 0;
        for (let ci = 0; ci < 8; ci++) {
          const p = b[ri][ci];
          if (!p) { empty++; }
          else {
            if (empty) { newFen += empty; empty = 0; }
            const ch = p.type === 'p' ? (p.color === 'w' ? 'P' : 'p')
                     : p.type === 'n' ? (p.color === 'w' ? 'N' : 'n')
                     : p.type === 'b' ? (p.color === 'w' ? 'B' : 'b')
                     : p.type === 'r' ? (p.color === 'w' ? 'R' : 'r')
                     : p.type === 'q' ? (p.color === 'w' ? 'Q' : 'q')
                     : p.color === 'w' ? 'K' : 'k';
            newFen += ch;
          }
        }
        if (empty) newFen += empty;
        if (ri < 7) newFen += '/';
      }
      newFen += ' w - - 0 1';
      const test = new Chess(newFen);
      if (test) { chess = test; moveHist = []; renderHistory(); }
    } catch (_) {}
    render();
    analyze();
  });

  // ── Toggles ────────────────────────────────────────────────────────────
  document.getElementById('tog-bestmove').addEventListener('click', function () {
    showBM = !showBM;
    this.classList.toggle('active', showBM);
    render();
  });

  document.getElementById('tog-evalbar').addEventListener('click', function () {
    showEB = !showEB;
    this.classList.toggle('active', showEB);
    document.getElementById('eval-bar-col').classList.toggle('hidden', !showEB);
  });

  // ── Palette ────────────────────────────────────────────────────────────
  function buildPalette() {
    const TYPES = ['k', 'q', 'r', 'b', 'n', 'p'];
    ['w', 'b'].forEach(color => {
      const cont = document.getElementById(color === 'w' ? 'pal-white' : 'pal-black');
      TYPES.forEach(type => {
        const btn = document.createElement('div');
        btn.className   = 'pal-piece pal-' + (color === 'w' ? 'white' : 'black');
        btn.textContent = SYM[color + type.toUpperCase()];
        btn.title       = (color === 'w' ? 'White ' : 'Black ') + type.toUpperCase();
        btn.addEventListener('click', () => {
          clearPal();
          palSel = { color, type };
          btn.classList.add('selected');
        });
        cont.appendChild(btn);
      });
    });

    document.getElementById('pal-eraser').addEventListener('click', function () {
      clearPal();
      palSel = 'erase';
      this.classList.add('selected');
    });
  }

  function clearPal() {
    document.querySelectorAll('.pal-piece').forEach(b => b.classList.remove('selected'));
    document.getElementById('pal-eraser').classList.remove('selected');
  }

  document.getElementById('btn-play-again').addEventListener('click', () => {
    document.getElementById('gameover-banner').classList.add('hidden');
    chess    = new Chess();
    moveHist = [];
    selSq    = null; legDests = [];
    lastFrom = lastTo  = null;
    bestFrom = bestTo  = null;
    renderHistory();
    setEval(0, null);
    document.getElementById('history-eval-box').innerHTML = '';
    render();
    analyze();
  });

  document.getElementById('btn-new-pos').addEventListener('click', () => {
    document.getElementById('gameover-banner').classList.add('hidden');
    setPosMode = true;
    document.getElementById('btn-setpos').classList.add('setpos-on');
    document.getElementById('palette-wrap').classList.remove('hidden');
    selSq = null; legDests = [];
    render();
  });

  // ── Init ───────────────────────────────────────────────────────────────
  buildPalette();
  loadPieceImages().then(() => {
    render();
    initSF();
  });

})();

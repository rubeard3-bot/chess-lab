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

/* ═══════════════════════════════════════════════════════════════════════
   PLAY THE COACH MODE — separate IIFE, never touches Free Play state
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const COACH_API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:4000/api/analyze'
    : 'https://chess-lab-production.up.railway.app/api/analyze';

  const COACH_PX = 480;
  const COACH_SQ = COACH_PX / 8; // 60

  const COACH_LIGHT = window.BOARD_LIGHT || '#f0d9b5';
  const COACH_DARK  = window.BOARD_DARK  || '#b58863';

  const COACH_PIECE_URLS = {
    wK:'https://lichess1.org/assets/piece/cburnett/wK.svg',
    wQ:'https://lichess1.org/assets/piece/cburnett/wQ.svg',
    wR:'https://lichess1.org/assets/piece/cburnett/wR.svg',
    wB:'https://lichess1.org/assets/piece/cburnett/wB.svg',
    wN:'https://lichess1.org/assets/piece/cburnett/wN.svg',
    wP:'https://lichess1.org/assets/piece/cburnett/wP.svg',
    bK:'https://lichess1.org/assets/piece/cburnett/bK.svg',
    bQ:'https://lichess1.org/assets/piece/cburnett/bQ.svg',
    bR:'https://lichess1.org/assets/piece/cburnett/bR.svg',
    bB:'https://lichess1.org/assets/piece/cburnett/bB.svg',
    bN:'https://lichess1.org/assets/piece/cburnett/bN.svg',
    bP:'https://lichess1.org/assets/piece/cburnett/bP.svg',
  };
  const COACH_SYM = {
    wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙',
    bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟'
  };

  const cImg = {};
  let cImgLoaded = false;

  // ── State ───────────────────────────────────────────────────────────────
  let cChess        = null;
  let cSF           = null;
  let cSFReady      = false;
  let cSFBusy       = false;
  let cSFSkip       = false;   // true → ignore next bestmove (from stopped search)
  let cSFPhase      = 'idle';  // 'analysis' | 'eval' | 'engineMove'
  let cSFCp         = 0;
  let cSFMate       = false;
  let cSFMateIn     = 0;
  let cSFTurn       = 'w';

  let cGameActive   = false;
  let cUserColor    = 'w';     // 'w' | 'b'
  let cSelSq        = null;
  let cLegDests     = [];
  let cLastFrom     = null;
  let cLastTo       = null;
  let cMoveHist     = [];      // {san, fromSq, toSq, byEngine}
  let cPendingPromo = null;

  let cEvalWhiteCP  = 0;       // running eval from White's perspective (cp)
  let cEvalBeforeCP = 0;       // eval before user's last move
  let cLastBestUci  = null;    // engine top move from last analysis position

  let cCoachOn          = true;
  let cPopupTimer       = null;
  let cMovesSincePopup  = 0;
  let cPhaseFired       = { opening: false, middlegame: false, endgame: false };
  let cInDangerZone     = false;
  let cRecoveryFired    = false;
  let cGameBlunders     = 0;
  let cGameBrilliants   = 0;
  let cGameTotalMoves   = 0;
  let cHintCache        = null;  // cached hint reason text
  let cCurBestSan       = null;  // best move SAN for current popup

  let cCanvas = null;
  let cCtx    = null;

  const LS_ON   = 'pb_coach_enabled';
  const LS_DIFF = 'pb_coach_difficulty';
  const LS_COL  = 'pb_coach_color';
  const LS_REC  = 'pb_coach_record';
  const LS_GAM  = 'pb_coach_games';
  const LS_EFF  = 'pb_warning_efficacy';

  // ── localStorage helpers ────────────────────────────────────────────────
  function lsGet(k)       { try { return localStorage.getItem(k); } catch(_) { return null; } }
  function lsSet(k, v)    { try { localStorage.setItem(k, v); } catch(_) {} }
  function lsJSON(k)      { try { return JSON.parse(localStorage.getItem(k)); } catch(_) { return null; } }
  function lsSetJSON(k,v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(_) {} }

  // ── Image loading ───────────────────────────────────────────────────────
  function loadCImg() {
    if (cImgLoaded) return Promise.resolve();
    return Promise.all(Object.entries(COACH_PIECE_URLS).map(([k, url]) =>
      new Promise(resolve => {
        const img = new Image();
        img.onload  = () => { cImg[k] = img; resolve(); };
        img.onerror = () => resolve();
        img.src = url;
      })
    )).then(() => { cImgLoaded = true; });
  }

  // ── Coordinate helpers ──────────────────────────────────────────────────
  // Board is flipped when user plays Black: rank 1 at top, file h at left.
  function cSqToRC(sq) {
    const file = sq.charCodeAt(0) - 97;
    const rank = 8 - parseInt(sq[1]); // 0-based row from top (standard)
    return cUserColor === 'b'
      ? { c: 7 - file, r: 7 - rank }
      : { c: file, r: rank };
  }

  function cRcToSq(c, r) {
    if (c < 0 || c > 7 || r < 0 || r > 7) return null;
    return cUserColor === 'b'
      ? String.fromCharCode(97 + (7 - c)) + (r + 1)
      : String.fromCharCode(97 + c) + (8 - r);
  }

  function cCanvasToSq(x, y) {
    return cRcToSq(Math.floor(x / COACH_SQ), Math.floor(y / COACH_SQ));
  }

  function cSqCenter(sq) {
    const { c, r } = cSqToRC(sq);
    return { x: c * COACH_SQ + COACH_SQ / 2, y: r * COACH_SQ + COACH_SQ / 2 };
  }

  // ── Rendering ───────────────────────────────────────────────────────────
  function cRender() {
    if (!cCtx || !cChess) return;
    cCtx.clearRect(0, 0, COACH_PX, COACH_PX);
    cDrawSquares();
    cDrawHighlights();
    if (cSelSq) cDrawSelected();
    cDrawDots();
    cDrawPieces();
    cDrawCoords();
  }

  function cDrawSquares() {
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        cCtx.fillStyle = (r + c) % 2 === 0 ? COACH_LIGHT : COACH_DARK;
        cCtx.fillRect(c * COACH_SQ, r * COACH_SQ, COACH_SQ, COACH_SQ);
      }
  }

  function cDrawHighlights() {
    [cLastFrom, cLastTo].forEach(sq => {
      if (!sq) return;
      const { c, r } = cSqToRC(sq);
      cCtx.fillStyle = 'rgba(255,200,0,0.40)';
      cCtx.fillRect(c * COACH_SQ, r * COACH_SQ, COACH_SQ, COACH_SQ);
    });
  }

  function cDrawSelected() {
    const { c, r } = cSqToRC(cSelSq);
    cCtx.fillStyle = 'rgba(80,160,255,0.42)';
    cCtx.fillRect(c * COACH_SQ, r * COACH_SQ, COACH_SQ, COACH_SQ);
  }

  function cDrawDots() {
    cLegDests.forEach(sq => {
      const { c, r } = cSqToRC(sq);
      const cx = c * COACH_SQ + COACH_SQ / 2;
      const cy = r * COACH_SQ + COACH_SQ / 2;
      cCtx.save();
      if (cChess.get(sq)) {
        cCtx.strokeStyle = 'rgba(0,0,0,0.30)';
        cCtx.lineWidth   = COACH_SQ * 0.09;
        cCtx.beginPath();
        cCtx.arc(cx, cy, COACH_SQ * 0.46, 0, Math.PI * 2);
        cCtx.stroke();
      } else {
        cCtx.fillStyle = 'rgba(0,0,0,0.22)';
        cCtx.beginPath();
        cCtx.arc(cx, cy, COACH_SQ * 0.155, 0, Math.PI * 2);
        cCtx.fill();
      }
      cCtx.restore();
    });
  }

  function cDrawPieces() {
    cChess.board().forEach((row, ri) => {
      row.forEach((p, ci) => {
        if (!p) return;
        const key = p.color + p.type.toUpperCase();
        const dc  = cUserColor === 'b' ? 7 - ci : ci;
        const dr  = cUserColor === 'b' ? 7 - ri : ri;
        const x   = dc * COACH_SQ;
        const y   = dr * COACH_SQ;
        if (cImg[key]) {
          cCtx.drawImage(cImg[key], x, y, COACH_SQ, COACH_SQ);
        } else {
          const sym = COACH_SYM[key];
          if (!sym) return;
          const cx2 = x + COACH_SQ / 2;
          const cy2 = y + COACH_SQ / 2;
          const fs = Math.floor(COACH_SQ * 0.70);
          cCtx.font = `${fs}px "Segoe UI Emoji","Apple Color Emoji",serif`;
          cCtx.textAlign = 'center'; cCtx.textBaseline = 'middle';
          cCtx.fillStyle = 'rgba(0,0,0,0.28)';
          cCtx.fillText(sym, cx2 + 1.2, cy2 + 1.2);
          cCtx.fillStyle = p.color === 'w' ? '#ffffff' : '#1a1a1a';
          cCtx.fillText(sym, cx2, cy2);
        }
      });
    });
  }

  function cDrawCoords() {
    const fs = Math.max(8, Math.floor(COACH_SQ * 0.17));
    cCtx.font = `600 ${fs}px "Segoe UI",sans-serif`;
    for (let r = 0; r < 8; r++) {
      const num = cUserColor === 'b' ? (r + 1) : (8 - r);
      cCtx.fillStyle = r % 2 === 0 ? COACH_DARK : COACH_LIGHT;
      cCtx.textAlign = 'left'; cCtx.textBaseline = 'top';
      cCtx.fillText(String(num), 2, r * COACH_SQ + 2);
    }
    for (let c = 0; c < 8; c++) {
      const ch = cUserColor === 'b'
        ? String.fromCharCode(97 + (7 - c))
        : String.fromCharCode(97 + c);
      cCtx.fillStyle = c % 2 !== 0 ? COACH_DARK : COACH_LIGHT;
      cCtx.textAlign = 'right'; cCtx.textBaseline = 'bottom';
      cCtx.fillText(ch, (c + 1) * COACH_SQ - 2, COACH_PX - 2);
    }
  }

  // ── Eval bar ────────────────────────────────────────────────────────────
  function cSetEval(whiteCP, mateW) {
    const fill = document.getElementById('pb-coach-eval-fill');
    const txt  = document.getElementById('pb-coach-eval-text');
    if (!fill || !txt) return;
    const pawns = whiteCP / 100;
    let pct, label;
    if (mateW !== null && mateW !== undefined) {
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

  // ── Status ──────────────────────────────────────────────────────────────
  function cSetStatus(msg, cls) {
    const el = document.getElementById('pb-coach-status');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'pb-coach-status' + (cls ? ' ' + cls : '');
  }

  // ── Move history ─────────────────────────────────────────────────────────
  function cRenderHistory() {
    const el = document.getElementById('coach-history-scroll');
    if (!el) return;
    if (!cMoveHist.length) {
      el.innerHTML = '<div class="history-empty">No moves yet</div>';
      return;
    }
    let html = '';
    for (let i = 0; i < cMoveHist.length; i += 2) {
      const n = Math.floor(i / 2) + 1;
      const w = cMoveHist[i].san;
      const b = cMoveHist[i + 1] ? cMoveHist[i + 1].san : '';
      html += `<div class="history-pair">
        <span class="history-num">${n}.</span>
        <span class="history-san">${w}</span>
        ${b ? `<span class="history-san">${b}</span>` : ''}
      </div>`;
    }
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }

  function cUpdateHistEval(whiteCP, mateW, bmUci) {
    const el = document.getElementById('coach-history-eval-box');
    if (!el || !cChess) return;
    const pawns = whiteCP / 100;
    let evalStr;
    if (mateW !== null && mateW !== undefined) {
      evalStr = mateW > 0 ? `Mate in ${mateW}` : `Mated in ${Math.abs(mateW)}`;
    } else {
      evalStr = (pawns >= 0 ? '+' : '') + pawns.toFixed(2);
    }
    let bmSan = '';
    if (bmUci) {
      try {
        const tmp = new Chess(cChess.fen());
        const m = tmp.move({ from: bmUci.slice(0,2), to: bmUci.slice(2,4), promotion: bmUci[4] || undefined });
        bmSan = m ? m.san : bmUci.slice(0,4);
      } catch(_) { bmSan = bmUci.slice(0,4); }
    }
    el.innerHTML = `<span class="heval-val">${evalStr}</span>${bmSan ? `<span class="heval-bm">Best: ${bmSan}</span>` : ''}`;
  }

  // ── Stockfish ────────────────────────────────────────────────────────────
  function cInitSF() {
    try { cSF = new Worker('js/stockfish.js'); }
    catch(e) { cSetStatus('Engine unavailable', 'err'); return; }
    cSF.onmessage = onCSFMsg;
    cSF.onerror   = () => cSetStatus('Engine error', 'err');
    cSF.postMessage('uci');
  }

  function onCSFMsg(e) {
    const line = typeof e === 'string' ? e : (e.data || '');

    if (!cSFReady) {
      if (line === 'uciok') {
        cSF.postMessage('setoption name Hash value 32');
        cSF.postMessage('isready');
      } else if (line === 'readyok') {
        cSFReady = true;
        cSetStatus('Click New Game to start', '');
      }
      return;
    }

    if (line.startsWith('info') && line.includes('score')) {
      const mm = line.match(/\bscore mate (-?\d+)/);
      const cm = line.match(/\bscore cp (-?\d+)/);
      if (mm)      { cSFMate = true;  cSFMateIn = parseInt(mm[1],10); cSFCp = cSFMateIn > 0 ? 9900 : -9900; }
      else if (cm) { cSFMate = false; cSFCp = parseInt(cm[1],10); }
    }

    if (!line.startsWith('bestmove')) return;

    cSFBusy = false;
    if (cSFSkip) { cSFSkip = false; return; }

    const parts = line.split(' ');
    const bmUci = (parts[1] && parts[1] !== '(none)') ? parts[1] : null;

    // Convert engine cp to White's perspective
    const whiteCP = cSFTurn === 'w' ? cSFCp : -cSFCp;
    const mateW   = cSFMate ? (cSFTurn === 'w' ? cSFMateIn : -cSFMateIn) : null;

    if (cSFPhase === 'analysis') {
      cEvalWhiteCP = cSFMate ? (mateW > 0 ? 9900 : -9900) : whiteCP;
      cSetEval(whiteCP, mateW);
      cUpdateHistEval(whiteCP, mateW, bmUci);
      cLastBestUci = bmUci;

    } else if (cSFPhase === 'eval') {
      // Post-user-move eval — classify then hand off to engine
      const afterCP = cSFMate ? (mateW > 0 ? 9900 : -9900) : whiteCP;
      cSetEval(whiteCP, mateW);
      cClassifyAndFireCoach(afterCP);
      cEnginePlayMove();

    } else if (cSFPhase === 'engineMove') {
      if (bmUci && cChess) {
        const m = cChess.move({ from: bmUci.slice(0,2), to: bmUci.slice(2,4), promotion: bmUci[4] || undefined });
        if (m) {
          cLastFrom = bmUci.slice(0,2);
          cLastTo   = bmUci.slice(2,4);
          cMoveHist.push({ san: m.san, byEngine: true });
          cRenderHistory();
          cRender();
          if (cCheckGameOver()) return;
          cSetStatus("Your turn", '');
          cRunAnalysis();
        } else {
          cSetStatus('Engine move error', 'err');
        }
      }
    }
  }

  function cRunAnalysis() {
    if (!cSFReady || !cSF || !cChess || cChess.game_over()) return;
    if (cSFBusy) { cSFSkip = true; cSF.postMessage('stop'); cSFBusy = false; }
    cSFPhase = 'analysis';
    cSFTurn  = cChess.turn();
    cSFCp = 0; cSFMate = false; cSFMateIn = 0;
    cSFBusy = true;
    cSF.postMessage('position fen ' + cChess.fen());
    cSF.postMessage('go depth 18');
  }

  function cRunPostMoveEval() {
    if (!cSFReady || !cSF || !cChess) return;
    if (cSFBusy) { cSFSkip = true; cSF.postMessage('stop'); cSFBusy = false; }
    cSFPhase = 'eval';
    cSFTurn  = cChess.turn();
    cSFCp = 0; cSFMate = false; cSFMateIn = 0;
    cSFBusy = true;
    cSF.postMessage('position fen ' + cChess.fen());
    cSF.postMessage('go depth 14');
  }

  function cEnginePlayMove() {
    if (!cSFReady || !cSF || !cChess || cChess.game_over()) return;
    const diff   = parseInt(lsGet(LS_DIFF) || '20', 10);
    const config = cDiffConfig(diff);
    if (cSFBusy) { cSFSkip = true; cSF.postMessage('stop'); cSFBusy = false; }
    cSFPhase = 'engineMove';
    cSFTurn  = cChess.turn();
    cSFCp = 0; cSFMate = false; cSFMateIn = 0;
    cSFBusy = true;
    cSetStatus('Stockfish is thinking…', '');
    cSF.postMessage('setoption name Skill Level value ' + config.skill);
    cSF.postMessage('position fen ' + cChess.fen());
    cSF.postMessage('go depth ' + config.depth);
  }

  function cDiffConfig(level) {
    if (level >= 20) return { depth: 18, skill: 20 };
    if (level >= 15) return { depth: 12, skill: 15 };
    if (level >= 10) return { depth: 8,  skill: 10 };
    if (level >= 5)  return { depth: 4,  skill: 5  };
    return               { depth: 2,  skill: 1  };
  }

  // ── Game flow ─────────────────────────────────────────────────────────────
  function cNewGame() {
    const saved = lsGet(LS_COL) || 'white';
    if (saved === 'random')      cUserColor = Math.random() < 0.5 ? 'w' : 'b';
    else if (saved === 'black')  cUserColor = 'b';
    else                         cUserColor = 'w';

    cChess = new Chess();
    cMoveHist = []; cSelSq = null; cLegDests = [];
    cLastFrom = cLastTo = null;
    cGameActive = true;
    cGameBlunders = cGameBrilliants = cGameTotalMoves = 0;
    cMovesSincePopup = 0;
    cPhaseFired = { opening: false, middlegame: false, endgame: false };
    cInDangerZone = cRecoveryFired = false;
    cEvalWhiteCP = cEvalBeforeCP = 0;
    cLastBestUci = null; cHintCache = null;

    cDismissPopup();
    const banner = document.getElementById('coach-gameover-banner');
    if (banner) banner.classList.add('hidden');
    const evalBox = document.getElementById('coach-history-eval-box');
    if (evalBox) evalBox.innerHTML = '';

    cRenderHistory();
    cSetEval(0, null);
    loadCImg().then(() => {
      cRender();
      cStartPlay();
    });
  }

  function cStartPlay() {
    if (!cSFReady) {
      cSetStatus('Loading engine…', '');
      const iv = setInterval(() => {
        if (cSFReady) { clearInterval(iv); cStartPlay(); }
      }, 200);
      return;
    }
    if (cUserColor === 'b') {
      cEnginePlayMove();
    } else {
      cSetStatus('Your turn', '');
      cRunAnalysis();
    }
  }

  // ── Canvas click ──────────────────────────────────────────────────────────
  function onCCanvasClick(e) {
    if (!cGameActive || !cChess || cChess.game_over()) return;
    if (cChess.turn() !== cUserColor) return;
    if (cSFPhase === 'engineMove' || cSFPhase === 'eval') return;
    if (cPendingPromo) return;

    const rect = cCanvas.getBoundingClientRect();
    const sq = cCanvasToSq(
      (e.clientX - rect.left) * (cCanvas.width  / rect.width),
      (e.clientY - rect.top)  * (cCanvas.height / rect.height)
    );
    if (!sq) return;

    if (cSelSq) {
      if (cLegDests.includes(sq)) {
        const piece = cChess.get(cSelSq);
        const isPromo = piece && piece.type === 'p' &&
          ((piece.color === 'w' && sq[1] === '8') || (piece.color === 'b' && sq[1] === '1'));
        if (isPromo) {
          cPendingPromo = { from: cSelSq, to: sq };
          cSelSq = null; cLegDests = [];
          cRender();
          cShowPromoModal(piece.color);
          return;
        }
        cDoMove(cSelSq, sq);
        return;
      }
      const p = cChess.get(sq);
      if (p && p.color === cUserColor) {
        cSelSq = sq;
        cLegDests = cChess.moves({ square: sq, verbose: true }).map(m => m.to);
        cRender();
      } else { cSelSq = null; cLegDests = []; cRender(); }
    } else {
      const p = cChess.get(sq);
      if (p && p.color === cUserColor) {
        cSelSq = sq;
        cLegDests = cChess.moves({ square: sq, verbose: true }).map(m => m.to);
        cRender();
      }
    }
  }

  function cDoMove(from, to, promotion) {
    // Snapshot pre-move state for classification
    cEvalBeforeCP = cEvalWhiteCP;
    const savedBestUci = cLastBestUci;

    if (cSFBusy) { cSFSkip = true; cSF.postMessage('stop'); cSFBusy = false; }

    const m = cChess.move({ from, to, promotion });
    if (!m) return;

    cLastFrom = from; cLastTo = to;
    cSelSq = null; cLegDests = [];
    cMoveHist.push({ san: m.san, fromSq: from, toSq: to });
    cGameTotalMoves++;
    cMovesSincePopup++;

    cRenderHistory();
    cRender();

    if (cCheckGameOver()) return;

    cRunPostMoveEval();
    cSetStatus('Evaluating…', '');
  }

  function cShowPromoModal(color) {
    const opts = document.getElementById('coach-promo-options');
    if (!opts) return;
    opts.innerHTML = '';
    ['q','r','b','n'].forEach(type => {
      const key = color + type.toUpperCase();
      const div = document.createElement('div');
      div.className = 'promo-piece';
      const img = document.createElement('img');
      img.src = COACH_PIECE_URLS[key]; img.alt = key;
      div.appendChild(img);
      div.addEventListener('click', () => {
        document.getElementById('coach-promo-overlay').classList.add('hidden');
        const { from, to } = cPendingPromo;
        cPendingPromo = null;
        cDoMove(from, to, type);
      });
      opts.appendChild(div);
    });
    document.getElementById('coach-promo-overlay').classList.remove('hidden');
  }

  // ── Game over ─────────────────────────────────────────────────────────────
  function cCheckGameOver(resigned) {
    if (!resigned && !cChess.game_over()) return false;
    if (cSF && cSFBusy) { cSFSkip = true; cSF.postMessage('stop'); cSFBusy = false; }
    cSFPhase = 'idle';

    let result, text, cls;
    if (resigned) {
      result = 'loss'; text = 'You resigned — Stockfish wins'; cls = '';
    } else if (cChess.in_checkmate()) {
      if (cChess.turn() !== cUserColor) { result = 'win'; text = 'Checkmate — You win!'; cls = 'win'; }
      else                              { result = 'loss'; text = 'Checkmate — Stockfish wins'; cls = ''; }
    } else if (cChess.in_stalemate()) {
      result = 'draw'; text = 'Stalemate — Draw'; cls = 'draw';
    } else if (cChess.in_threefold_repetition()) {
      result = 'draw'; text = 'Threefold Repetition — Draw'; cls = 'draw';
    } else if (cChess.insufficient_material()) {
      result = 'draw'; text = 'Insufficient Material — Draw'; cls = 'draw';
    } else {
      result = 'draw'; text = 'Draw'; cls = 'draw';
    }

    const bannerRes = document.getElementById('coach-gameover-result');
    if (bannerRes) { bannerRes.textContent = text; bannerRes.className = 'gameover-result ' + cls; }
    const banner = document.getElementById('coach-gameover-banner');
    if (banner) banner.classList.remove('hidden');

    cGameActive = false;
    cRecordResult(result);
    if (cCoachOn) cFireEndGamePopup(result);
    return true;
  }

  // ── Stats tracking ─────────────────────────────────────────────────────────
  function cRecordResult(result) {
    const rec = lsJSON(LS_REC) || { wins: 0, losses: 0, draws: 0 };
    if (result === 'win') rec.wins++;
    else if (result === 'loss') rec.losses++;
    else rec.draws++;
    rec.lastUpdated = Date.now();
    lsSetJSON(LS_REC, rec);

    const games = lsJSON(LS_GAM) || [];
    games.push({
      result,
      userColor:  cUserColor === 'w' ? 'white' : 'black',
      moves:      cGameTotalMoves,
      difficulty: parseInt(lsGet(LS_DIFF) || '20', 10),
      blunders:   cGameBlunders,
      brilliants: cGameBrilliants,
      timestamp:  new Date().toISOString()
    });
    while (games.length > 50) games.shift();
    lsSetJSON(LS_GAM, games);
  }

  function cTrackWarnShown() {
    const eff = lsJSON(LS_EFF) || { shown: 0, heeded: 0 };
    eff.shown++;
    lsSetJSON(LS_EFF, eff);
  }

  function cTrackWarnHeeded() {
    const eff = lsJSON(LS_EFF) || { shown: 0, heeded: 0 };
    eff.heeded++;
    lsSetJSON(LS_EFF, eff);
  }

  // ── Phase / material ───────────────────────────────────────────────────────
  function cMaterialCount() {
    const vals = { q:9, r:5, b:3, n:3, p:1 };
    let total = 0;
    cChess.board().forEach(row => row.forEach(p => {
      if (p && p.type !== 'k') total += vals[p.type] || 0;
    }));
    return total;
  }

  function cGamePhase() {
    const moveCount = Math.floor(cMoveHist.length / 2);
    const mat = cMaterialCount();
    if (mat < 14 || moveCount > 40) return 'endgame';
    if (moveCount < 12) return 'opening';
    return 'middlegame';
  }

  // ── Best move SAN conversion ───────────────────────────────────────────────
  // Convert UCI for position BEFORE user's last move to SAN.
  function cBestMoveSan(uci) {
    if (!uci || !cChess) return uci || '';
    try {
      const tmp  = new Chess();
      const hist = cChess.history(); // all moves including user's just-played one
      for (let i = 0; i < hist.length - 1; i++) tmp.move(hist[i]);
      const m = tmp.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] || undefined });
      return m ? m.san : uci.slice(0,4);
    } catch(_) { return uci ? uci.slice(0,4) : ''; }
  }

  // ── Classification & coach trigger ────────────────────────────────────────
  function cClassifyAndFireCoach(evalAfterCP) {
    if (!cCoachOn) return;

    const deltaCP = cUserColor === 'w'
      ? (evalAfterCP - cEvalBeforeCP)
      : -(evalAfterCP - cEvalBeforeCP);
    const delta = deltaCP / 100;

    const lastMove    = cMoveHist[cMoveHist.length - 1];
    const userMoveSan = lastMove ? lastMove.san : '';
    const bestSan     = cBestMoveSan(cLastBestUci);

    // Base classification
    let trigger = null;
    if (delta < -2.0) {
      trigger = 'BLUNDER'; cGameBlunders++;
    } else if (delta < -1.0) {
      trigger = 'MISTAKE';
    } else if (delta < -0.5) {
      trigger = 'INACCURACY';
    } else if (delta > 0.8 && cLastBestUci && lastMove) {
      const userUci = (lastMove.fromSq || '') + (lastMove.toSq || '');
      trigger = cLastBestUci.slice(0,4) === userUci ? 'BRILLIANT' : 'EXCELLENT';
      if (trigger === 'BRILLIANT') cGameBrilliants++;
    } else if (delta > 0.3) {
      trigger = 'EXCELLENT';
    } else {
      trigger = 'GOOD';
    }

    // Phase transition (low priority — only override GOOD)
    const phase = cGamePhase();
    if (!cPhaseFired[phase] && cMoveHist.length > 4) {
      cPhaseFired[phase] = true;
      if (trigger === 'GOOD' || trigger === 'INACCURACY') trigger = 'PHASE_' + phase.toUpperCase();
    }

    // Recovery (overrides if strong recovery)
    if (!cRecoveryFired && cEvalBeforeCP < -150 && evalAfterCP > -30) {
      cRecoveryFired = true;
      trigger = 'RECOVERY';
    }

    // Danger zone (user is now losing badly — fire once)
    if (!cInDangerZone) {
      const userViewCP = cUserColor === 'w' ? evalAfterCP : -evalAfterCP;
      if (userViewCP < -150 && (trigger === 'GOOD' || trigger === 'INACCURACY')) {
        cInDangerZone = true;
        trigger = 'DANGER_ZONE';
      }
    }

    if (!cShouldFire(trigger)) return;

    cMovesSincePopup = 0;
    cHintCache = null;
    cCurBestSan = bestSan;
    cShowPopup(trigger, delta, userMoveSan, evalAfterCP);
  }

  function cShouldFire(trigger) {
    if (!trigger || trigger === 'GOOD') return false;
    if (trigger === 'BLUNDER' || trigger === 'BRILLIANT') return true;
    if (trigger === 'DANGER_ZONE' || trigger === 'RECOVERY') return true;
    if (trigger === 'MISTAKE') return cMovesSincePopup >= 3;
    if (trigger.startsWith('PHASE_')) return true;
    if (trigger === 'EXCELLENT') return cMovesSincePopup >= 5;
    return false;
  }

  // ── Coach popup ────────────────────────────────────────────────────────────
  function cShowPopup(trigger, delta, userMoveSan, evalAfterCP) {
    const popup  = document.getElementById('pb-coach-popup');
    const badge  = document.getElementById('pb-coach-popup-badge');
    const msgEl  = document.getElementById('pb-coach-popup-msg');
    const hint   = document.getElementById('pb-coach-hint');
    const missed = document.getElementById('pb-coach-missed');
    if (!popup) return;

    if (cPopupTimer) { clearTimeout(cPopupTimer); cPopupTimer = null; }

    // Reset sections
    hint.classList.add('hidden');
    document.getElementById('pb-coach-hint-reason').innerHTML = '<div class="pb-coach-loading"><span></span><span></span><span></span></div>';

    // Badge
    const bi = cBadgeInfo(trigger, delta);
    badge.textContent = bi.text;
    badge.className   = 'pb-coach-popup-badge pb-coach-badge-' + bi.color;

    // Show "missed" only for actionable triggers
    const actionable = ['BLUNDER','MISTAKE','DANGER_ZONE'].includes(trigger);
    missed.classList.toggle('hidden', !actionable);
    if (actionable) cTrackWarnShown();

    // Loading indicator for message
    msgEl.innerHTML = '<div class="pb-coach-loading"><span></span><span></span><span></span></div>';

    // Animate in
    popup.classList.remove('hidden', 'pb-coach-popup-exit');
    void popup.offsetWidth; // force reflow
    popup.classList.add('pb-coach-popup-enter');
    setTimeout(() => popup.classList.remove('pb-coach-popup-enter'), 350);

    // Auto-dismiss after 12s
    cPopupTimer = setTimeout(cDismissPopup, 12000);

    // Fetch message
    cFetchMsg(trigger, delta, userMoveSan, evalAfterCP).then(txt => {
      msgEl.textContent = txt;
    }).catch(() => {
      msgEl.textContent = cFallbackMsg(trigger, delta);
    });
  }

  function cDismissPopup() {
    const popup = document.getElementById('pb-coach-popup');
    if (!popup || popup.classList.contains('hidden')) return;
    if (cPopupTimer) { clearTimeout(cPopupTimer); cPopupTimer = null; }
    popup.classList.remove('pb-coach-popup-enter');
    popup.classList.add('pb-coach-popup-exit');
    setTimeout(() => {
      popup.classList.add('hidden');
      popup.classList.remove('pb-coach-popup-exit');
    }, 300);
  }

  function cBadgeInfo(trigger, delta) {
    switch (trigger) {
      case 'BLUNDER':          return { text: `Blunder · ${delta.toFixed(1)}`,  color: 'red'    };
      case 'MISTAKE':          return { text: `Mistake · ${delta.toFixed(1)}`,   color: 'orange' };
      case 'INACCURACY':       return { text: 'Inaccuracy',                      color: 'yellow' };
      case 'BRILLIANT':        return { text: 'Brilliant!',                      color: 'green'  };
      case 'EXCELLENT':        return { text: 'Excellent',                       color: 'teal'   };
      case 'RECOVERY':         return { text: 'Recovery',                        color: 'teal'   };
      case 'DANGER_ZONE':      return { text: 'Danger zone',                     color: 'amber'  };
      case 'PHASE_MIDDLEGAME': return { text: 'Middlegame',                      color: 'blue'   };
      case 'PHASE_ENDGAME':    return { text: 'Endgame',                         color: 'blue'   };
      default:                 return { text: trigger,                            color: 'blue'   };
    }
  }

  function cFallbackMsg(trigger, delta) {
    const n = (lsGet('pf_display_name') || 'there').split(' ')[0];
    switch (trigger) {
      case 'BLUNDER':    return `${n}, that move cost ${Math.abs(delta).toFixed(1)} pawns — look for tactics before committing.`;
      case 'MISTAKE':    return `${n}, that wasn't optimal. Take a moment to check for forcing moves.`;
      case 'BRILLIANT':  return `${n}, that was the engine's top choice. Excellent calculation!`;
      case 'EXCELLENT':  return `${n}, solid move that improved your position.`;
      case 'RECOVERY':   return `${n}, great resilience — you fought back from a difficult spot.`;
      case 'DANGER_ZONE': return `${n}, you're in a tough position. Find the best defensive resource.`;
      case 'PHASE_MIDDLEGAME': return `${n}, you've entered the middlegame — king safety and piece activity matter most.`;
      case 'PHASE_ENDGAME':   return `${n}, endgame now — activate your king and push passed pawns.`;
      default: return `${n}, keep thinking carefully.`;
    }
  }

  // ── Claude API calls ────────────────────────────────────────────────────────
  async function cFetchMsg(trigger, delta, userMoveSan, evalAfterCP) {
    const firstName  = (lsGet('pf_display_name') || 'there').split(' ')[0];
    const elo        = lsGet('csa_elo_current') || 'unknown';
    const goals      = lsGet('pf_goals') || 'improve at chess';
    const tone       = lsGet('pf_coach_tone') || 'Direct';
    const recs       = lsJSON('csa_recommendations');
    const weaknesses = recs && recs.topWeaknesses
      ? recs.topWeaknesses.slice(0,5).map(w => '- ' + (w.type || w)).join('\n')
      : 'None identified yet';

    const evalBefore = (cEvalBeforeCP / 100).toFixed(2);
    const evalAfter  = (evalAfterCP / 100).toFixed(2);
    const phase      = cGamePhase();

    const system = `You are a chess coach speaking directly to your student during a live game. Give short, specific, actionable feedback.

STUDENT PROFILE:
- Name: ${firstName}
- Current rating: ${elo}
- Goal: ${goals}
- Coaching tone: ${tone}

KNOWN WEAKNESSES:
${weaknesses}

CURRENT GAME:
- FEN: ${cChess ? cChess.fen() : 'unknown'}
- Move just played: ${userMoveSan}
- Eval before: ${evalBefore}
- Eval after: ${evalAfter}
- Delta (user perspective): ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}
- Classification: ${trigger}
- Engine top move: [hidden — shown via button]
- Phase: ${phase}

RULES:
1. Use student's first name exactly once at the start
2. Max 2 sentences
3. Tone — Encouraging: warm/supportive. Direct: honest/no fluff. Tough love: demanding.
4. Be specific — cite eval numbers or piece names
5. Reference known weaknesses when relevant
6. Do NOT reveal the engine's best move (it's behind the button)
7. No exclamation marks unless genuinely warranted

Respond with ONLY the coach message text.`;

    const user = `Trigger: ${trigger}. Student played ${userMoveSan}, eval went ${evalBefore} → ${evalAfter} (${delta >= 0 ? '+' : ''}${delta.toFixed(2)} from their perspective). Generate response.`;

    return cClaudeCall(system, user, 150);
  }

  async function cFetchHintReason(bestSan) {
    if (cHintCache) return cHintCache;
    const system = "You are a chess coach. Explain in exactly one concise sentence why the given move is the engine's best choice. Reference the specific tactical or strategic reason. No preamble.";
    const user   = `Position FEN: ${cChess ? cChess.fen() : ''}\nEngine's best move: ${bestSan}\nWhy is this the best move?`;
    const reason = await cClaudeCall(system, user, 80);
    cHintCache = reason;
    return reason;
  }

  async function cClaudeCall(system, userMsg, maxTokens) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(COACH_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model:      'claude-sonnet-4-6',
          max_tokens: maxTokens,
          system,
          messages:   [{ role: 'user', content: userMsg }]
        })
      });
      clearTimeout(tid);
      if (!res.ok) throw new Error('api');
      const data = await res.json();
      return data?.content?.[0]?.text || '';
    } catch(_) {
      clearTimeout(tid);
      return '';
    }
  }

  // ── End-game popup ──────────────────────────────────────────────────────────
  function cFireEndGamePopup(result) {
    const popup  = document.getElementById('pb-coach-popup');
    const badge  = document.getElementById('pb-coach-popup-badge');
    const msgEl  = document.getElementById('pb-coach-popup-msg');
    const hint   = document.getElementById('pb-coach-hint');
    const missed = document.getElementById('pb-coach-missed');
    if (!popup) return;

    hint.classList.add('hidden');
    missed.classList.add('hidden');

    badge.textContent = result === 'win' ? 'Game over — You won!' : result === 'draw' ? 'Game over — Draw' : 'Game over';
    badge.className   = 'pb-coach-popup-badge pb-coach-badge-' + (result === 'win' ? 'green' : result === 'draw' ? 'blue' : 'orange');
    msgEl.innerHTML   = '<div class="pb-coach-loading"><span></span><span></span><span></span></div>';

    popup.classList.remove('hidden', 'pb-coach-popup-exit', 'pb-coach-popup-enter');

    const firstName = (lsGet('pf_display_name') || 'there').split(' ')[0];
    const tone      = lsGet('pf_coach_tone') || 'Direct';
    const recs      = lsJSON('csa_recommendations');
    const weak      = recs && recs.topWeaknesses
      ? recs.topWeaknesses.slice(0,3).map(w => '- ' + (w.type || w)).join('\n')
      : 'none identified';

    const system = `You are a chess coach giving a post-game summary. Max 2 sentences. Tone: ${tone}.`;
    const user   = `${firstName} finished a game vs Stockfish. Result: ${result}. Blunders: ${cGameBlunders}, Brilliants: ${cGameBrilliants}, Total moves: ${cGameTotalMoves}.\nWeaknesses:\n${weak}\n\nGive a brief summary with one actionable takeaway. Use their first name once.`;

    cClaudeCall(system, user, 120).then(txt => {
      if (txt) msgEl.textContent = txt;
      else {
        const fb = result === 'win'
          ? `${firstName}, well played — review any blunders to sharpen your calculation.`
          : result === 'draw'
          ? `${firstName}, hard-fought draw — look for conversion opportunities next time.`
          : `${firstName}, tough game. Focus on reducing blunders to gain the most rating points.`;
        msgEl.textContent = fb;
      }
    });
  }

  // ── Controls setup ───────────────────────────────────────────────────────────
  function cSetupControls() {
    const saved_on   = lsGet(LS_ON);
    const saved_diff = lsGet(LS_DIFF) || '20';
    const saved_col  = lsGet(LS_COL) || 'white';
    cCoachOn = saved_on !== 'false';

    const switchEl  = document.getElementById('pb-coach-switch');
    const diffEl    = document.getElementById('pb-coach-difficulty');
    const colorEl   = document.getElementById('pb-coach-color');
    const newBtn    = document.getElementById('pb-coach-new');
    const resignBtn = document.getElementById('pb-coach-resign');
    const gotitBtn  = document.getElementById('pb-coach-gotit');
    const missedBtn = document.getElementById('pb-coach-missed');
    const xBtn      = document.getElementById('pb-coach-popup-x');
    const playAgain = document.getElementById('coach-btn-play-again');

    if (switchEl) {
      switchEl.classList.toggle('pb-coach-switch-on', cCoachOn);
      switchEl.addEventListener('click', () => {
        cCoachOn = !cCoachOn;
        switchEl.classList.toggle('pb-coach-switch-on', cCoachOn);
        lsSet(LS_ON, cCoachOn ? 'true' : 'false');
        if (!cCoachOn) cDismissPopup();
      });
    }

    if (diffEl) {
      diffEl.value = saved_diff;
      diffEl.addEventListener('change', () => lsSet(LS_DIFF, diffEl.value));
    }

    if (colorEl) {
      colorEl.value = saved_col;
      colorEl.addEventListener('change', () => lsSet(LS_COL, colorEl.value));
    }

    if (newBtn) {
      newBtn.addEventListener('click', () => {
        if (cGameActive && !confirm('Start a new game? Current game will be abandoned.')) return;
        cNewGame();
      });
    }

    if (resignBtn) {
      resignBtn.addEventListener('click', () => {
        if (!cGameActive) return;
        if (!confirm('Resign this game?')) return;
        cCheckGameOver(true);
      });
    }

    if (gotitBtn)  gotitBtn.addEventListener('click', cDismissPopup);
    if (xBtn)      xBtn.addEventListener('click', cDismissPopup);

    if (missedBtn) {
      missedBtn.addEventListener('click', async () => {
        const hint       = document.getElementById('pb-coach-hint');
        const hintMove   = document.getElementById('pb-coach-hint-move');
        const hintReason = document.getElementById('pb-coach-hint-reason');
        if (!hint) return;

        missedBtn.classList.add('hidden');
        hint.classList.remove('hidden');
        hintMove.textContent = cCurBestSan || '—';

        // Reset auto-dismiss — user is engaged
        if (cPopupTimer) { clearTimeout(cPopupTimer); cPopupTimer = null; }
        cTrackWarnHeeded();

        hintReason.innerHTML = '<div class="pb-coach-loading"><span></span><span></span><span></span></div>';
        const reason = await cFetchHintReason(cCurBestSan || '');
        hintReason.textContent = reason || 'This is the engine\'s strongest continuation.';
      });
    }

    if (playAgain) playAgain.addEventListener('click', () => cNewGame());
  }

  // ── Init (deferred until coach view is first shown) ──────────────────────────
  let cModeInited = false;

  function cInitMode() {
    cCanvas = document.getElementById('coach-canvas');
    if (!cCanvas) return;
    cCtx = cCanvas.getContext('2d');
    cCanvas.width  = COACH_PX;
    cCanvas.height = COACH_PX;
    cCanvas.addEventListener('click', onCCanvasClick);

    cSetupControls();
    cChess = new Chess();
    loadCImg().then(() => cRender());
    cInitSF();
  }

  // Watch for coach view becoming visible
  document.addEventListener('DOMContentLoaded', () => {
    const viewEl = document.getElementById('pb-view-coach');
    if (!viewEl) return;
    const obs = new MutationObserver(() => {
      if (!viewEl.classList.contains('hidden') && !cModeInited) {
        cModeInited = true;
        cInitMode();
      }
    });
    obs.observe(viewEl, { attributes: true, attributeFilter: ['class'] });

    // Also handle direct URL load (?mode=coach) — view may already be visible
    if (!viewEl.classList.contains('hidden') && !cModeInited) {
      cModeInited = true;
      cInitMode();
    }
  });

})();

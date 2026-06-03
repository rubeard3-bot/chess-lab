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
  // Seed from a critical-position FEN handed off from the analyzer, if present.
  try {
    const _seedFen = sessionStorage.getItem('practice_fen');
    if (_seedFen) {
      sessionStorage.removeItem('practice_fen');
      const _seeded = new Chess();
      if (_seeded.load(_seedFen)) chess = _seeded;
    }
  } catch (_) {}
  let selSq      = null;
  let legDests   = [];
  let lastFrom   = null;
  let lastTo     = null;
  let bestFrom   = null;
  let bestTo     = null;
  let showBM     = true;
  let showEB     = true;
  let setPosMode = false;
  let setPosDirty = false; // true once user has placed/removed a piece in setpos mode
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
    setPosDirty = true;
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
    if (setPosMode) { setPosDirty = false; }
    else            { palSel = null; clearPal(); analyze(); }
    render();
  });

  document.getElementById('pal-done').addEventListener('click', () => {
    setPosMode = false;
    document.getElementById('btn-setpos').classList.remove('setpos-on');
    document.getElementById('palette-wrap').classList.add('hidden');
    palSel = null; clearPal();
    // Only rebuild FEN + wipe history if the user actually changed pieces.
    // Opening setpos mid-game just to look should leave the game untouched.
    if (setPosDirty) {
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
    }
    setPosDirty = false;
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
    setPosDirty = false;
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

  // Stockfish worker + strict serial command system.
  // Every UCI command goes through cSFTaskQueue. Only one `go` is ever in
  // flight; pending awaiters are resolved by onCSFMsg as readyok/bestmove
  // lines arrive. Per-task FEN guards make stale results no-ops.
  let cSF              = null;
  let cSFReady         = false;
  let cSFInitialized   = false;
  let cSFTaskQueue     = Promise.resolve();
  let cSFPendingReady  = null;   // resolver fn waiting on next readyok
  let cSFPendingBest   = null;   // resolver fn waiting on next bestmove
  let cSFAccumCp       = 0;
  let cSFAccumMate     = null;   // null or signed mate-in (engine perspective)
  let cSFRecovering    = false;

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
    cSFReady = false;
    cSFInitialized = false;
    try { cSF = new Worker('js/stockfish.js'); }
    catch(e) { cSetStatus('Engine unavailable', 'err'); return; }
    cSF.onmessage = onCSFMsg;
    cSF.onerror   = (err) => cHandleEngineCrash(err && err.message);
    try { cSF.postMessage('uci'); } catch(e) { cHandleEngineCrash(e.message); }
  }

  function onCSFMsg(e) {
    const line = typeof e === 'string' ? e : (e && e.data) || '';
    if (!line) return;

    // Initial UCI handshake (uci → setoption + ucinewgame → isready → readyok)
    if (!cSFInitialized) {
      if (line === 'uciok') {
        try {
          cSF.postMessage('setoption name Hash value 32');
          cSF.postMessage('ucinewgame');
          cSF.postMessage('isready');
        } catch(e) { cHandleEngineCrash(e.message); }
      } else if (line === 'readyok') {
        cSFInitialized = true;
        cSFReady = true;
        if (!cSFRecovering) cSetStatus('Click New Game to start', '');
      }
      return;
    }

    if (line.startsWith('info') && line.includes('score')) {
      const mm = line.match(/\bscore mate (-?\d+)/);
      const cm = line.match(/\bscore cp (-?\d+)/);
      if (mm)      { cSFAccumMate = parseInt(mm[1], 10); cSFAccumCp = cSFAccumMate > 0 ? 9900 : -9900; }
      else if (cm) { cSFAccumMate = null; cSFAccumCp = parseInt(cm[1], 10); }
      return;
    }

    if (line === 'readyok') {
      const r = cSFPendingReady;
      if (r) { cSFPendingReady = null; r(); }
      return;
    }

    if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      const uci = (parts[1] && parts[1] !== '(none)') ? parts[1] : null;
      const result = { uci: uci, cp: cSFAccumCp, mate: cSFAccumMate };
      cSFAccumCp = 0; cSFAccumMate = null;
      const r = cSFPendingBest;
      if (r) { cSFPendingBest = null; r(result); }
      // No pending awaiter → stale bestmove, drop silently
    }
  }

  // Promise-wrapped UCI helpers — each waits for the worker's reply.

  function cSFWaitReady(timeoutMs) {
    timeoutMs = timeoutMs || 5000;
    return new Promise((resolve, reject) => {
      if (!cSF) return reject(new Error('no worker'));
      cSFPendingReady = null;
      const t = setTimeout(() => {
        if (cSFPendingReady) { cSFPendingReady = null; reject(new Error('readyok timeout')); }
      }, timeoutMs);
      cSFPendingReady = () => { clearTimeout(t); resolve(); };
      try { cSF.postMessage('isready'); }
      catch(e) { clearTimeout(t); cSFPendingReady = null; reject(e); }
    });
  }

  function cSFRunGo(depth, skill, timeoutMs) {
    timeoutMs = timeoutMs || 30000;
    return new Promise((resolve, reject) => {
      if (!cSF) return reject(new Error('no worker'));
      cSFPendingBest = null;
      cSFAccumCp = 0; cSFAccumMate = null;
      const t = setTimeout(() => {
        if (cSFPendingBest) { cSFPendingBest = null; reject(new Error('bestmove timeout')); }
      }, timeoutMs);
      cSFPendingBest = (result) => { clearTimeout(t); resolve(result); };
      try {
        if (typeof skill === 'number') cSF.postMessage('setoption name Skill Level value ' + skill);
        cSF.postMessage('go depth ' + depth);
      } catch(e) { clearTimeout(t); cSFPendingBest = null; reject(e); }
    });
  }

  async function cSFSetPosition(fen) {
    if (!cSF) throw new Error('no worker');
    cSF.postMessage('ucinewgame');
    await cSFWaitReady();
    cSF.postMessage('position fen ' + fen);
    await cSFWaitReady();
  }

  // Pre-empts an in-flight `go` — caller still awaits the bestmove (which
  // arrives quickly after `stop`), then bails via the FEN guard.
  function cSFAbortInFlight() {
    if (cSFPendingBest && cSF) {
      try { cSF.postMessage('stop'); } catch(_) {}
    }
  }

  function cEnqueueSF(task, taskName) {
    cSFTaskQueue = cSFTaskQueue
      .then(() => {
        if (!cSF || !cSFReady || cSFRecovering) return null;
        return task();
      })
      .catch(err => {
        console.error('Stockfish task ' + (taskName || '?') + ' failed:', err);
        return cHandleEngineCrash(err && err.message || String(err));
      });
    return cSFTaskQueue;
  }

  // Tear down a wedged worker, spawn a new one, resume from current position.
  async function cHandleEngineCrash(detail) {
    if (cSFRecovering) return;
    cSFRecovering = true;
    cSFReady = false;
    cSFInitialized = false;
    cSetStatus('Engine hiccup — restarting…', 'err');

    // Release any waiters so the queue can drain
    if (cSFPendingReady) { try { cSFPendingReady(); } catch(_){} cSFPendingReady = null; }
    if (cSFPendingBest)  { try { cSFPendingBest({ uci: null, cp: 0, mate: null }); } catch(_){} cSFPendingBest = null; }

    try { if (cSF) cSF.terminate(); } catch(_) {}
    cSF = null;
    cSFTaskQueue = Promise.resolve();
    cSFAccumCp = 0; cSFAccumMate = null;

    await new Promise(res => setTimeout(res, 250));

    let spawned;
    try { spawned = new Worker('js/stockfish.js'); }
    catch(e) { cSetStatus('Engine unavailable', 'err'); cSFRecovering = false; return; }
    cSF = spawned;
    cSF.onmessage = onCSFMsg;
    cSF.onerror   = (err) => { cSFRecovering = false; cHandleEngineCrash(err && err.message); };

    // Drive a fresh UCI handshake and wait for readyok
    const ready = new Promise((resolve) => {
      const iv = setInterval(() => {
        if (cSFReady) { clearInterval(iv); resolve(); }
      }, 100);
      setTimeout(() => { clearInterval(iv); resolve(); }, 10000);
    });
    try { cSF.postMessage('uci'); } catch(_) {}
    await ready;

    cSFRecovering = false;
    if (!cSFReady) { cSetStatus('Engine restart failed', 'err'); return; }

    cSetStatus('Engine restarted — resuming', 'ok');
    if (cGameActive && cChess && !cChess.game_over()) {
      if (cChess.turn() === cUserColor) cRunAnalysis();
      else                              cEnginePlayMove();
    }
  }

  // Background analysis on the user's position (sets eval bar + cLastBestUci).
  function cRunAnalysis() {
    return cEnqueueSF(async () => {
      if (!cChess || cChess.game_over()) return;
      const turn     = cChess.turn();
      const startFen = cChess.fen();
      await cSFSetPosition(startFen);
      if (!cChess || cChess.fen() !== startFen) return;   // pre-empted
      const result = await cSFRunGo(18);
      if (!cChess || cChess.fen() !== startFen) return;   // pre-empted
      const whiteCP = turn === 'w' ? result.cp : -result.cp;
      const mateW   = result.mate !== null ? (turn === 'w' ? result.mate : -result.mate) : null;
      cEvalWhiteCP  = result.mate !== null ? (mateW > 0 ? 9900 : -9900) : whiteCP;
      cSetEval(whiteCP, mateW);
      cUpdateHistEval(whiteCP, mateW, result.uci);
      cLastBestUci  = result.uci;
    }, 'analysis');
  }

  // Eval the post-user-move position, then classify for the coach popup.
  function cRunPostMoveEval() {
    return cEnqueueSF(async () => {
      if (!cChess) return;
      const turn     = cChess.turn();
      const startFen = cChess.fen();
      await cSFSetPosition(startFen);
      if (!cChess || cChess.fen() !== startFen) return;
      const result = await cSFRunGo(14);
      if (!cChess || cChess.fen() !== startFen) return;
      const whiteCP = turn === 'w' ? result.cp : -result.cp;
      const mateW   = result.mate !== null ? (turn === 'w' ? result.mate : -result.mate) : null;
      const afterCP = result.mate !== null ? (mateW > 0 ? 9900 : -9900) : whiteCP;
      cSetEval(whiteCP, mateW);
      cClassifyAndFireCoach(afterCP);
    }, 'eval');
  }

  // Engine plays a move; chains analysis for the user's reply.
  function cEnginePlayMove() {
    return cEnqueueSF(async () => {
      if (!cChess || cChess.game_over()) return;
      const diff     = parseInt(lsGet(LS_DIFF) || '20', 10);
      const config   = cDiffConfig(diff);
      cSetStatus('Stockfish is thinking…', '');
      const startFen = cChess.fen();
      await cSFSetPosition(startFen);
      if (!cChess || cChess.fen() !== startFen) return;
      const result = await cSFRunGo(config.depth, config.skill);
      if (!cChess || cChess.fen() !== startFen) return;
      if (!result.uci) { cSetStatus('Engine move error', 'err'); return; }
      const m = cChess.move({ from: result.uci.slice(0,2), to: result.uci.slice(2,4), promotion: result.uci[4] || undefined });
      if (!m) { cSetStatus('Engine move error', 'err'); return; }
      cLastFrom = result.uci.slice(0,2);
      cLastTo   = result.uci.slice(2,4);
      cMoveHist.push({ san: m.san, byEngine: true });
      cRenderHistory();
      cRender();
      if (cCheckGameOver()) return;
      cSetStatus("Your turn", '');
    }, 'engineMove').then(() => {
      if (cGameActive && cChess && !cChess.game_over() && cChess.turn() === cUserColor) {
        cRunAnalysis();
      }
    });
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
    // Abort any search left over from a previous game; queued tasks will
    // see the new starting FEN and bail via the FEN guard.
    cSFAbortInFlight();

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

    // Pre-empt any analysis search running in the background.
    // The stale bestmove will still arrive; the analysis task's FEN guard
    // makes it a no-op.
    cSFAbortInFlight();

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

    cSetStatus('Evaluating…', '');
    cRunPostMoveEval().then(() => {
      if (cGameActive && cChess && !cChess.game_over()) cEnginePlayMove();
    });
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
    cSFAbortInFlight();

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

/* ═══════════════════════════════════════════════════════════════════════
   OPENING DRILL MODE — separate IIFE
   Three sub-views: selection → coaching → drilling
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const OD_API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:4000/api/analyze'
    : 'https://chess-lab-production.up.railway.app/api/analyze';

  const LICHESS_EP = window.location.hostname === 'localhost'
    ? 'http://localhost:4000/api/lichess-explorer'
    : 'https://chess-lab-production.up.railway.app/api/lichess-explorer';
  let _odLastFetchErr = null; // 'auth' | 'network' | null

  const OD_PX = 480;
  const OD_SQ = OD_PX / 8; // 60

  const OD_LIGHT = window.BOARD_LIGHT || '#f0d9b5';
  const OD_DARK  = window.BOARD_DARK  || '#b58863';

  const OD_PIECE_URLS = {
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
  const OD_SYM = {
    wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙',
    bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟'
  };

  const odImg = {};
  let odImgLoaded = false;

  // ── Curated opening library ────────────────────────────────────────────
  const OD_LIBRARY = [
    { group: "Queen's Pawn", openings: [
      { name: "Queen's Gambit Accepted", moves: ['d4','d5','c4','dxc4'] },
      { name: "Queen's Gambit Declined", moves: ['d4','d5','c4','e6'] },
      { name: 'Slav Defense',            moves: ['d4','d5','c4','c6'] },
      { name: "King's Indian Defense",   moves: ['d4','Nf6','c4','g6'] },
      { name: 'Nimzo-Indian Defense',    moves: ['d4','Nf6','c4','e6','Nc3','Bb4'] },
      { name: 'Catalan Opening',         moves: ['d4','Nf6','c4','e6','g3'] }
    ]},
    { group: "King's Pawn", openings: [
      { name: 'Italian Game',         moves: ['e4','e5','Nf3','Nc6','Bc4'] },
      { name: 'Ruy Lopez',            moves: ['e4','e5','Nf3','Nc6','Bb5'] },
      { name: 'Sicilian Defense',     moves: ['e4','c5'] },
      { name: 'French Defense',       moves: ['e4','e6'] },
      { name: 'Caro-Kann Defense',    moves: ['e4','c6'] },
      { name: 'Pirc Defense',         moves: ['e4','d6'] },
      { name: 'Scandinavian Defense', moves: ['e4','d5'] }
    ]},
    { group: 'Other', openings: [
      { name: 'English Opening', moves: ['c4'] },
      { name: 'Reti Opening',    moves: ['Nf3'] },
      { name: 'London System',   moves: ['d4','d5','Nf3','Nf6','Bf4'] }
    ]}
  ];

  // ── localStorage helpers ────────────────────────────────────────────────
  function odLsGet(k)       { try { return localStorage.getItem(k); } catch(_) { return null; } }
  function odLsSet(k, v)    { try { localStorage.setItem(k, v); } catch(_) {} }
  function odLsJSON(k)      { try { return JSON.parse(localStorage.getItem(k)); } catch(_) { return null; } }
  function odLsSetJSON(k,v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(_) {} }

  // ── State ──────────────────────────────────────────────────────────────
  let odMode             = 'selection';   // selection | coaching | drilling
  let odCurrentOpening   = null;          // {name, moves}
  let odUserSide         = 'white';       // 'white' | 'black'

  // Coaching room
  let odCoachingChess    = null;
  let odCanvasCoach      = null;
  let odCtxCoach         = null;
  let odIdeasCache       = {};            // by `${name}|${side}`
  let odLinesCache       = {};
  let odChatHistory      = [];            // [{role, content}] for current session
  let odWatchActive      = false;
  let odWatchPaused      = false;
  let odWatchTimer       = null;
  let odWatchMoves       = [];            // full UCI sequence to play
  let odWatchIdx         = 0;
  let odCoachingActiveBtn = null;         // 'ideas' | 'lines' | 'chat'

  // Drilling
  let odDrillChess       = null;
  let odCanvasDrill      = null;
  let odCtxDrill         = null;
  let odDrillStreak      = 0;
  let odDrillFailed      = false;
  let odDrillSelSq       = null;
  let odDrillLegDests    = [];
  let odDrillLastFrom    = null;
  let odDrillLastTo      = null;
  let odDrillBusy        = false;
  let odDrillFinishedThisAttempt = false;
  let odDrillHintFromTo  = null;           // {from, to} for green arrow

  // Lichess cache (session-only, in-memory)
  const odFenCache = new Map();

  // ── Image loading ───────────────────────────────────────────────────────
  function odLoadImg() {
    if (odImgLoaded) return Promise.resolve();
    return Promise.all(Object.entries(OD_PIECE_URLS).map(([k, url]) =>
      new Promise(resolve => {
        const img = new Image();
        img.onload  = () => { odImg[k] = img; resolve(); };
        img.onerror = () => resolve();
        img.src = url;
      })
    )).then(() => { odImgLoaded = true; });
  }

  // ── Coordinate helpers (flip when playing black) ────────────────────────
  function odSqToRC(sq) {
    const file = sq.charCodeAt(0) - 97;
    const rank = 8 - parseInt(sq[1]);
    return odUserSide === 'black'
      ? { c: 7 - file, r: 7 - rank }
      : { c: file, r: rank };
  }
  function odRcToSq(c, r) {
    if (c < 0 || c > 7 || r < 0 || r > 7) return null;
    return odUserSide === 'black'
      ? String.fromCharCode(97 + (7 - c)) + (r + 1)
      : String.fromCharCode(97 + c) + (8 - r);
  }
  function odSqCenter(sq) {
    const { c, r } = odSqToRC(sq);
    return { x: c * OD_SQ + OD_SQ / 2, y: r * OD_SQ + OD_SQ / 2 };
  }

  // ── Rendering (shared between coaching + drill canvases) ────────────────
  function odRenderBoard(ctx, chess, opts) {
    if (!ctx || !chess) return;
    opts = opts || {};
    ctx.clearRect(0, 0, OD_PX, OD_PX);

    // squares
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? OD_LIGHT : OD_DARK;
        ctx.fillRect(c * OD_SQ, r * OD_SQ, OD_SQ, OD_SQ);
      }

    // last move highlights
    [opts.lastFrom, opts.lastTo].forEach(sq => {
      if (!sq) return;
      const { c, r } = odSqToRC(sq);
      ctx.fillStyle = 'rgba(255,200,0,0.40)';
      ctx.fillRect(c * OD_SQ, r * OD_SQ, OD_SQ, OD_SQ);
    });

    // selected
    if (opts.selSq) {
      const { c, r } = odSqToRC(opts.selSq);
      ctx.fillStyle = 'rgba(80,160,255,0.42)';
      ctx.fillRect(c * OD_SQ, r * OD_SQ, OD_SQ, OD_SQ);
    }

    // dots / rings
    if (opts.legDests && opts.legDests.length) {
      opts.legDests.forEach(sq => {
        const { c, r } = odSqToRC(sq);
        const cx = c * OD_SQ + OD_SQ / 2;
        const cy = r * OD_SQ + OD_SQ / 2;
        ctx.save();
        if (chess.get(sq)) {
          ctx.strokeStyle = 'rgba(0,0,0,0.30)';
          ctx.lineWidth   = OD_SQ * 0.09;
          ctx.beginPath();
          ctx.arc(cx, cy, OD_SQ * 0.46, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.beginPath();
          ctx.arc(cx, cy, OD_SQ * 0.155, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });
    }

    // pieces
    chess.board().forEach((row, ri) => {
      row.forEach((p, ci) => {
        if (!p) return;
        const key = p.color + p.type.toUpperCase();
        const dc  = odUserSide === 'black' ? 7 - ci : ci;
        const dr  = odUserSide === 'black' ? 7 - ri : ri;
        const x   = dc * OD_SQ;
        const y   = dr * OD_SQ;
        if (odImg[key]) {
          ctx.drawImage(odImg[key], x, y, OD_SQ, OD_SQ);
        } else {
          const sym = OD_SYM[key];
          if (!sym) return;
          const cx2 = x + OD_SQ / 2;
          const cy2 = y + OD_SQ / 2;
          const fs = Math.floor(OD_SQ * 0.70);
          ctx.font = `${fs}px "Segoe UI Emoji","Apple Color Emoji",serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(0,0,0,0.28)';
          ctx.fillText(sym, cx2 + 1.2, cy2 + 1.2);
          ctx.fillStyle = p.color === 'w' ? '#ffffff' : '#1a1a1a';
          ctx.fillText(sym, cx2, cy2);
        }
      });
    });

    // hint arrow
    if (opts.hintFrom && opts.hintTo) {
      const f = odSqCenter(opts.hintFrom);
      const t = odSqCenter(opts.hintTo);
      const a = Math.atan2(t.y - f.y, t.x - f.x);
      const hl = OD_SQ * 0.38;
      const lw = OD_SQ * 0.14;
      const bx = t.x - hl * 0.65 * Math.cos(a);
      const by = t.y - hl * 0.65 * Math.sin(a);
      ctx.save();
      ctx.strokeStyle = 'rgba(0,210,90,0.85)';
      ctx.fillStyle   = 'rgba(0,210,90,0.85)';
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

    // coords
    const fs = Math.max(8, Math.floor(OD_SQ * 0.17));
    ctx.font = `600 ${fs}px "Segoe UI",sans-serif`;
    for (let r = 0; r < 8; r++) {
      const num = odUserSide === 'black' ? (r + 1) : (8 - r);
      ctx.fillStyle = r % 2 === 0 ? OD_DARK : OD_LIGHT;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(String(num), 2, r * OD_SQ + 2);
    }
    for (let c = 0; c < 8; c++) {
      const ch = odUserSide === 'black'
        ? String.fromCharCode(97 + (7 - c))
        : String.fromCharCode(97 + c);
      ctx.fillStyle = c % 2 !== 0 ? OD_DARK : OD_LIGHT;
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText(ch, (c + 1) * OD_SQ - 2, OD_PX - 2);
    }
  }

  // ── Toast (reuse #az-toast) ─────────────────────────────────────────────
  let _odToastTimer;
  function odToast(msg) {
    const el = document.getElementById('az-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(_odToastTimer);
    _odToastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // ── Lichess opening explorer ─────────────────────────────────────────────
  async function odFetchMasters(fen) {
    if (odFenCache.has(fen)) return odFenCache.get(fen);
    _odLastFetchErr = null;
    let r;
    try {
      r = await fetch(`${LICHESS_EP}?fen=${encodeURIComponent(fen)}&speeds=blitz,rapid,classical&ratings=2000,2200,2500&moves=10`);
    } catch (_) {
      _odLastFetchErr = 'network';
      return null;
    }
    if (r.status === 401) { _odLastFetchErr = 'auth';      return null; }
    if (r.status === 429) { _odLastFetchErr = 'ratelimit'; return null; }
    if (!r.ok)            { _odLastFetchErr = 'server';    return null; }
    const data = await r.json();
    odFenCache.set(fen, data);
    return data;
  }

  // Total master games seen at this position
  function odTotalGames(data) {
    if (!data || !data.moves) return 0;
    return data.moves.reduce((sum, m) => sum + (m.white || 0) + (m.draws || 0) + (m.black || 0), 0);
  }

  // Sort moves descending by total game count
  function odSortedMoves(data) {
    if (!data || !data.moves) return [];
    return data.moves.slice().sort((a, b) => {
      const at = (a.white || 0) + (a.draws || 0) + (a.black || 0);
      const bt = (b.white || 0) + (b.draws || 0) + (b.black || 0);
      return bt - at;
    });
  }

  // Acceptable moves: top + any others within 50% of top game count
  function odAcceptableMoves(data) {
    const sorted = odSortedMoves(data);
    if (!sorted.length) return [];
    const topCount = (sorted[0].white || 0) + (sorted[0].draws || 0) + (sorted[0].black || 0);
    if (!topCount) return [];
    const out = [];
    for (let i = 0; i < sorted.length && i < 3; i++) {
      const m = sorted[i];
      const ct = (m.white || 0) + (m.draws || 0) + (m.black || 0);
      if (i === 0 || ct >= topCount * 0.5) out.push(m);
    }
    return out;
  }

  // ── Claude API helper ───────────────────────────────────────────────────
  async function odClaudeCall(system, userMsg, maxTokens) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(OD_API_URL, {
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
      if (!res.ok) return '';
      const data = await res.json();
      return (data?.content?.[0]?.text || '').trim();
    } catch (_) {
      clearTimeout(tid);
      return '';
    }
  }

  // ── Build starting position chess instance from SAN moves ───────────────
  function odStartingChess(opening) {
    const c = new Chess();
    if (opening && opening.moves) {
      opening.moves.forEach(san => { try { c.move(san); } catch(_) {} });
    }
    return c;
  }

  // ── Main view switcher ──────────────────────────────────────────────────
  function odShowSub(name) {
    odMode = name;
    ['selection', 'coaching', 'drilling'].forEach(s => {
      const el = document.getElementById('pb-od-' + s);
      if (el) el.classList.toggle('hidden', s !== name);
    });
    if (name === 'selection') {
      odTeardownWatch();
    } else if (name === 'coaching') {
      odTeardownWatch();
      odEnterCoaching();
    } else if (name === 'drilling') {
      odTeardownWatch();
      odEnterDrill();
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // SELECTION SCREEN
  // ════════════════════════════════════════════════════════════════════════
  function odRenderSelection() {
    odRenderRecommended();
    odRenderBrowse('');
    const searchEl = document.getElementById('pb-od-search');
    if (searchEl) {
      searchEl.value = '';
      searchEl.oninput = function () { odRenderBrowse(searchEl.value.trim().toLowerCase()); };
    }
  }

  function odRenderRecommended() {
    const section = document.getElementById('pb-od-recommended-section');
    const list    = document.getElementById('pb-od-rec-list');
    if (!section || !list) return;

    const recs = odLsJSON('csa_recommendations');
    const arr  = recs && (recs.openingRepertoire || (recs.openingReport && recs.openingReport.openings) || recs.openingRecommendations);
    if (!Array.isArray(arr) || !arr.length) { section.classList.add('hidden'); return; }

    const weak = arr.filter(o => {
      const v = String(o.verdict || o.recommendation || '').toLowerCase();
      return v === 'modify' || v === 'replace';
    });
    if (!weak.length) { section.classList.add('hidden'); return; }

    section.classList.remove('hidden');
    list.innerHTML = '';

    weak.forEach(o => {
      const verdict = String(o.verdict || o.recommendation || '').toLowerCase();
      const name    = o.name || 'Unknown opening';
      const desc    = o.commonMistake || o.description || '';
      const acc     = (o.averageAccuracy != null ? o.averageAccuracy : o.avgAccuracy);
      const accStr  = (acc != null) ? `Your accuracy: ${Math.round(acc)}%` : '';
      const card = document.createElement('div');
      card.className = 'pb-od-rec-card';
      card.innerHTML =
        `<div class="pb-od-rec-top">
           <span class="pb-od-rec-name">${odEscape(name)}</span>
           <span class="pb-od-rec-verdict ${verdict === 'replace' ? 'replace' : ''}">${verdict || 'review'}</span>
         </div>
         ${desc ? `<div class="pb-od-rec-desc">${odEscape(desc)}</div>` : ''}
         <div class="pb-od-rec-meta">
           <span>${accStr}</span>
           <span class="pb-od-rec-cta">Start drilling →</span>
         </div>`;
      card.addEventListener('click', () => {
        // Find a matching library entry, else build one with no moves
        const lib = odFindLibraryOpening(name);
        const opening = lib || { name: name, moves: [] };
        odPickOpening(opening);
      });
      list.appendChild(card);
    });
  }

  function odFindLibraryOpening(name) {
    const lc = String(name || '').toLowerCase();
    for (const grp of OD_LIBRARY) {
      for (const o of grp.openings) {
        if (o.name.toLowerCase() === lc) return o;
        // partial / prefix match
        if (lc.startsWith(o.name.toLowerCase()) || o.name.toLowerCase().includes(lc)) return o;
      }
    }
    return null;
  }

  function odRenderBrowse(query) {
    const cont = document.getElementById('pb-od-browse');
    if (!cont) return;
    cont.innerHTML = '';
    let totalShown = 0;
    OD_LIBRARY.forEach(grp => {
      const filtered = grp.openings.filter(o =>
        !query || o.name.toLowerCase().includes(query) ||
        o.moves.join(' ').toLowerCase().includes(query)
      );
      if (!filtered.length) return;
      const groupEl = document.createElement('div');
      groupEl.className = 'pb-od-group';
      groupEl.innerHTML = `<div class="pb-od-group-label">${odEscape(grp.group)}</div>`;
      filtered.forEach(o => {
        const movesStr = odMovesToSanString(o.moves);
        const card = document.createElement('div');
        card.className = 'pb-od-card';
        card.innerHTML =
          `<div class="pb-od-card-left">
             <div class="pb-od-card-name">${odEscape(o.name)}</div>
             <div class="pb-od-card-moves">${movesStr}</div>
           </div>
           <span class="pb-od-card-cta">Study →</span>`;
        card.addEventListener('click', () => odPickOpening(o));
        groupEl.appendChild(card);
        totalShown++;
      });
      cont.appendChild(groupEl);
    });
    if (!totalShown) {
      const empty = document.createElement('div');
      empty.className = 'pb-od-empty';
      empty.textContent = 'No openings match "' + query + '".';
      cont.appendChild(empty);
    }
  }

  function odMovesToSanString(moves) {
    let s = '';
    for (let i = 0; i < moves.length; i++) {
      if (i % 2 === 0) s += (Math.floor(i / 2) + 1) + '.';
      s += moves[i];
      if (i < moves.length - 1) s += ' ';
    }
    return s;
  }

  function odEscape(s) {
    return String(s || '').replace(/[&<>"']/g, ch =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function odPickOpening(opening) {
    odCurrentOpening = opening;
    // Restore saved side preference per opening
    const sides = odLsJSON('pb_opening_side') || {};
    odUserSide = sides[opening.name] === 'black' ? 'black' : 'white';
    odShowSub('coaching');
  }

  // ════════════════════════════════════════════════════════════════════════
  // COACHING ROOM
  // ════════════════════════════════════════════════════════════════════════
  function odEnterCoaching() {
    if (!odCurrentOpening) { odShowSub('selection'); return; }

    document.getElementById('pb-od-coaching-title').textContent = odCurrentOpening.name;
    document.getElementById('pb-od-coaching-moves').textContent =
      odCurrentOpening.moves.length
        ? odMovesToSanString(odCurrentOpening.moves)
        : 'Starting position';

    odUpdateSideButtons();
    odCoachingChess = odStartingChess(odCurrentOpening);
    odLoadImg().then(() => {
      odRenderBoard(odCtxCoach, odCoachingChess, {});
    });

    // Reset coach panel
    odCoachingActiveBtn = null;
    odRefreshActionBtnState();
    const content = document.getElementById('pb-od-coach-content');
    if (content) content.innerHTML =
      '<div class="pb-od-coach-placeholder">Pick a button above to start learning, or jump straight into the drill below.</div>';
    odHideChat();
    odChatHistory = [];

    odTeardownWatch();
  }

  function odUpdateSideButtons() {
    const w = document.getElementById('pb-od-side-white');
    const b = document.getElementById('pb-od-side-black');
    if (w) w.classList.toggle('active', odUserSide === 'white');
    if (b) b.classList.toggle('active', odUserSide === 'black');
  }

  function odSetSide(side) {
    if (side !== 'white' && side !== 'black') return;
    odUserSide = side;
    if (odCurrentOpening) {
      const sides = odLsJSON('pb_opening_side') || {};
      sides[odCurrentOpening.name] = side;
      odLsSetJSON('pb_opening_side', sides);
    }
    odUpdateSideButtons();
    // Re-render board with flipped orientation
    if (odMode === 'coaching') {
      odRenderBoard(odCtxCoach, odCoachingChess, {});
    }
    // Invalidate caches that depend on side
    odCoachingActiveBtn = null;
    odRefreshActionBtnState();
  }

  function odRefreshActionBtnState() {
    ['ideas','lines','chat'].forEach(name => {
      const id = 'pb-od-btn-' + name;
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', odCoachingActiveBtn === name);
    });
  }

  function odCacheKey() {
    return `${odCurrentOpening ? odCurrentOpening.name : '?'}|${odUserSide}`;
  }

  // ── Action 1: Walk me through the ideas ─────────────────────────────────
  async function odActionIdeas() {
    odTeardownWatch();
    if (odCurrentOpening) {
      odCoachingChess = odStartingChess(odCurrentOpening);
      odRenderBoard(odCtxCoach, odCoachingChess, {});
    }
    odCoachingActiveBtn = 'ideas';
    odRefreshActionBtnState();
    odHideChat();

    const content = document.getElementById('pb-od-coach-content');
    if (!content) return;
    const key = odCacheKey();
    if (odIdeasCache[key]) { content.innerHTML = odIdeasCache[key]; return; }

    content.innerHTML = '<div class="pb-coach-loading"><span></span><span></span><span></span></div>';

    const elo  = odLsGet('csa_elo_current') || 'unknown';
    const tone = odLsGet('pf_coach_tone') || 'Direct';
    const system =
`You are a chess coach teaching the ${odCurrentOpening.name} from ${odUserSide}'s perspective. The student is rated ${elo} and uses ${tone} coaching style. Explain the strategic ideas of this opening in clear, structured language. Cover: pawn structure, piece development priorities, attacking plans, key squares, common mistakes at this rating level. Be concrete and specific — give actual square names and move sequences. Keep response under 300 words.

Format your response with these EXACT section headers, each on its own line:
PAWN STRUCTURE:
PIECE DEVELOPMENT:
ATTACKING PLANS:
KEY SQUARES:
COMMON MISTAKES:

Each section should be 1-2 sentences. No other markdown.`;
    const user = `Teach me the ideas of the ${odCurrentOpening.name} from ${odUserSide}'s side. Starting moves: ${odMovesToSanString(odCurrentOpening.moves || [])}.`;

    const text = await odClaudeCall(system, user, 600);
    if (!text) {
      content.innerHTML = '<div class="pb-od-coach-placeholder">Coach unavailable right now. Try again in a moment.</div>';
      return;
    }
    const html = odFormatIdeas(text);
    odIdeasCache[key] = html;
    content.innerHTML = html;
  }

  function odFormatIdeas(text) {
    const sections = [
      { key: 'PAWN STRUCTURE',    label: 'Pawn structure'    },
      { key: 'PIECE DEVELOPMENT', label: 'Piece development' },
      { key: 'ATTACKING PLANS',   label: 'Attacking plans'   },
      { key: 'KEY SQUARES',       label: 'Key squares'       },
      { key: 'COMMON MISTAKES',   label: 'Common mistakes'   }
    ];
    let html = '';
    let found = false;
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      const re = new RegExp(s.key + '\\s*:\\s*([\\s\\S]*?)(?=' +
        sections.map(x => x.key + '\\s*:').join('|') + '|$)', 'i');
      const m = text.match(re);
      if (m && m[1] && m[1].trim()) {
        found = true;
        html += `<div class="pb-od-ideas-block">
          <div class="pb-od-ideas-heading">${s.label}</div>
          <div class="pb-od-ideas-body">${odEscape(m[1].trim())}</div>
        </div>`;
      }
    }
    if (!found) {
      html = `<div class="pb-od-ideas-body">${odEscape(text)}</div>`;
    }
    return html;
  }

  // ── Action 2: Show me the main lines ────────────────────────────────────
  async function odActionLines() {
    odTeardownWatch();
    if (odCurrentOpening) {
      odCoachingChess = odStartingChess(odCurrentOpening);
      odRenderBoard(odCtxCoach, odCoachingChess, {});
    }
    odCoachingActiveBtn = 'lines';
    odRefreshActionBtnState();
    odHideChat();

    const content = document.getElementById('pb-od-coach-content');
    if (!content) return;

    const key = odCacheKey();
    if (odLinesCache[key]) { content.innerHTML = odLinesCache[key]; odBindWatchButtons(); return; }

    content.innerHTML = '<div class="pb-coach-loading"><span></span><span></span><span></span></div>';

    // Build the FEN at the starting position
    const startChess = odStartingChess(odCurrentOpening);
    const data = await odFetchMasters(startChess.fen());

    if (!data || !data.moves || !data.moves.length) {
      let msg;
      if (!data && _odLastFetchErr === 'auth')      msg = 'Lichess auth failed — admin needs to refresh the token';
      else if (!data && _odLastFetchErr === 'ratelimit') msg = 'Too many requests — please wait a moment and try again';
      else if (!data && _odLastFetchErr === 'server')    msg = "Server error — couldn't reach Lichess";
      else if (!data && _odLastFetchErr === 'network')   msg = 'Network error — check your connection';
      else msg = 'Theory has thinned out here — good drilling!';
      content.innerHTML = `<div class="pb-od-coach-placeholder">${msg}</div>`;
      return;
    }

    const sorted = odSortedMoves(data).slice(0, 4);
    // For each top move, get the SAN + 1-line description from Claude
    const movesList = sorted.map(m => m.san).join(', ');
    const tone = odLsGet('pf_coach_tone') || 'Direct';
    const system = `You are a chess coach. For each main variation of the ${odCurrentOpening.name}, give a 1-sentence description of its character. Be specific and use chess terminology. Plain text only, no markdown.

Output format — one variation per line, exactly:
<SAN move>: <one-sentence description>

No other text, no header, no numbering.`;
    const user = `From the position after ${odMovesToSanString(odCurrentOpening.moves || [])}, the main move replies are: ${movesList}. Describe each.`;

    const text = await odClaudeCall(system, user, 400);
    const descMap = {};
    if (text) {
      text.split('\n').forEach(line => {
        const m = line.match(/^([A-Za-z0-9+#=\-]+):\s*(.+)$/);
        if (m) descMap[m[1]] = m[2].trim();
      });
    }

    let html = '';
    sorted.forEach(mv => {
      const desc = descMap[mv.san] || 'A common continuation in master games.';
      html += `<div class="pb-od-line-item">
        <div class="pb-od-line-name">${odEscape(mv.san)}</div>
        <div class="pb-od-line-desc">${odEscape(desc)}</div>
        <button class="pb-od-line-watch-btn" data-uci="${odEscape(mv.uci)}" data-san="${odEscape(mv.san)}">Watch this line →</button>
      </div>`;
    });
    odLinesCache[key] = html;
    content.innerHTML = html;
    odBindWatchButtons();
  }

  function odBindWatchButtons() {
    document.querySelectorAll('.pb-od-line-watch-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uci = btn.getAttribute('data-uci');
        const san = btn.getAttribute('data-san');
        await odStartWatch(uci, san);
      });
    });
  }

  // ── Watch mode ─────────────────────────────────────────────────────────
  async function odStartWatch(firstUci, firstSan) {
    odTeardownWatch();
    odWatchActive = true;
    odWatchPaused = false;
    odWatchMoves = [];
    odWatchIdx = 0;

    // Reset board to opening starting position
    odCoachingChess = odStartingChess(odCurrentOpening);
    odRenderBoard(odCtxCoach, odCoachingChess, {});

    // Push the chosen first move
    odWatchMoves.push({ uci: firstUci, san: firstSan });

    // Walk the most-popular line for ~8 more plies
    let walker = odStartingChess(odCurrentOpening);
    walker.move({ from: firstUci.slice(0,2), to: firstUci.slice(2,4), promotion: firstUci[4] || undefined });

    for (let i = 0; i < 8; i++) {
      const data = await odFetchMasters(walker.fen());
      if (!data || !data.moves || !data.moves.length) break;
      const sorted = odSortedMoves(data);
      const top = sorted[0];
      walker.move({ from: top.uci.slice(0,2), to: top.uci.slice(2,4), promotion: top.uci[4] || undefined });
      odWatchMoves.push({ uci: top.uci, san: top.san });
    }

    // Show controls
    const controls = document.getElementById('pb-od-watch-controls');
    if (controls) controls.classList.remove('hidden');
    odSetWatchPauseLabel();

    odPlayNextWatchMove();
  }

  function odSetWatchPauseLabel() {
    const btn = document.getElementById('pb-od-watch-pause');
    if (btn) btn.textContent = odWatchPaused ? '▶ Resume' : '⏸ Pause';
  }

  async function odPlayNextWatchMove() {
    if (!odWatchActive || odWatchPaused) return;
    if (odWatchIdx >= odWatchMoves.length) {
      odShowWatchTooltip('End of line. The book continues but with rarer moves.');
      return;
    }
    const move = odWatchMoves[odWatchIdx];
    const m = odCoachingChess.move({ from: move.uci.slice(0,2), to: move.uci.slice(2,4), promotion: move.uci[4] || undefined });
    if (!m) { odTeardownWatch(); return; }
    odRenderBoard(odCtxCoach, odCoachingChess, { lastFrom: m.from, lastTo: m.to });

    // Tooltip — short idea
    const idea = await odFetchWatchTooltip(move.san, odCoachingChess.fen());
    odShowWatchTooltip(`${m.san}: ${idea}`);

    odWatchIdx++;

    const speedEl = document.getElementById('pb-od-watch-speed');
    const speed = speedEl ? parseInt(speedEl.value, 10) : 1500;
    odWatchTimer = setTimeout(odPlayNextWatchMove, speed);
  }

  // Cache watch tooltips per opening + ply index
  const odWatchTooltipCache = {};
  async function odFetchWatchTooltip(san, fenAfter) {
    const key = `${odCacheKey()}|${odWatchIdx}|${san}`;
    if (odWatchTooltipCache[key]) return odWatchTooltipCache[key];
    const system = "You are a chess coach. Give a single 6-12 word fragment describing the idea behind the move (e.g., 'Develops the knight and prepares castling'). No period, no preamble, no quotes.";
    const user = `Opening: ${odCurrentOpening.name}. After move ${san}. FEN: ${fenAfter}.`;
    const txt = await odClaudeCall(system, user, 50);
    const out = txt || 'A typical move in this line';
    odWatchTooltipCache[key] = out;
    return out;
  }

  function odShowWatchTooltip(msg) {
    const el = document.getElementById('pb-od-watch-tooltip');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function odTeardownWatch() {
    odWatchActive = false;
    odWatchPaused = false;
    if (odWatchTimer) { clearTimeout(odWatchTimer); odWatchTimer = null; }
    odWatchMoves = [];
    odWatchIdx = 0;
    const controls = document.getElementById('pb-od-watch-controls');
    if (controls) controls.classList.add('hidden');
    const tip = document.getElementById('pb-od-watch-tooltip');
    if (tip) tip.classList.add('hidden');
  }

  // ── Action 3: Chat ──────────────────────────────────────────────────────
  function odActionChat() {
    odTeardownWatch();
    if (odCurrentOpening) {
      odCoachingChess = odStartingChess(odCurrentOpening);
      odRenderBoard(odCtxCoach, odCoachingChess, {});
    }
    odCoachingActiveBtn = 'chat';
    odRefreshActionBtnState();
    const content = document.getElementById('pb-od-coach-content');
    if (content) content.innerHTML = '';
    const chat = document.getElementById('pb-od-coach-chat');
    if (chat) chat.classList.remove('hidden');
    odRenderChat();
    const input = document.getElementById('pb-od-chat-input');
    if (input) setTimeout(() => input.focus(), 50);
  }

  function odHideChat() {
    const chat = document.getElementById('pb-od-coach-chat');
    if (chat) chat.classList.add('hidden');
  }

  function odRenderChat() {
    const list = document.getElementById('pb-od-chat-msgs');
    if (!list) return;
    list.innerHTML = '';
    if (!odChatHistory.length) {
      const hint = document.createElement('div');
      hint.className = 'pb-od-chat-msg pb-od-chat-bot';
      hint.textContent = `Ask me anything about the ${odCurrentOpening ? odCurrentOpening.name : 'opening'} — pawn breaks, move orders, traps, anything.`;
      list.appendChild(hint);
      return;
    }
    odChatHistory.forEach(m => {
      const div = document.createElement('div');
      div.className = 'pb-od-chat-msg ' + (m.role === 'user' ? 'pb-od-chat-user' : 'pb-od-chat-bot');
      div.textContent = m.content;
      list.appendChild(div);
    });
    list.scrollTop = list.scrollHeight;
  }

  async function odSendChat() {
    const input = document.getElementById('pb-od-chat-input');
    const sendBtn = document.getElementById('pb-od-chat-send');
    if (!input || !sendBtn) return;
    const text = input.value.trim();
    if (!text) return;
    if (odChatHistory.length >= 40) {
      odToast('Chat limit reached (20 exchanges per opening session). Start a new opening.');
      return;
    }
    odChatHistory.push({ role: 'user', content: text });
    input.value = '';
    sendBtn.disabled = true;
    odRenderChat();

    // Add a loading bot bubble
    const list = document.getElementById('pb-od-chat-msgs');
    const loading = document.createElement('div');
    loading.className = 'pb-od-chat-msg pb-od-chat-bot';
    loading.innerHTML = '<div class="pb-coach-loading"><span></span><span></span><span></span></div>';
    list.appendChild(loading);
    list.scrollTop = list.scrollHeight;

    const elo  = odLsGet('csa_elo_current') || 'unknown';
    const tone = odLsGet('pf_coach_tone') || 'Direct';
    const system = `You are a chess coach having a conversation with a student about the ${odCurrentOpening.name}. The student is rated ${elo} and uses ${tone} style. Answer specifically about THIS opening, not generic chess advice. Keep responses concise — 2-4 sentences typically. Use concrete moves and squares.`;

    const history = odChatHistory.slice(-10).map(m =>
      (m.role === 'user' ? 'Student: ' : 'You: ') + m.content
    ).join('\n');
    const user = `Conversation so far:\n${history}\n\nReply as the coach.`;

    const reply = await odClaudeCall(system, user, 300);
    loading.remove();

    const replyText = reply || "I couldn't reach the coach service — try again in a moment.";
    odChatHistory.push({ role: 'assistant', content: replyText });
    sendBtn.disabled = false;
    odRenderChat();
  }

  // ════════════════════════════════════════════════════════════════════════
  // DRILL MODE
  // ════════════════════════════════════════════════════════════════════════
  function odEnterDrill() {
    if (!odCurrentOpening) { odShowSub('selection'); return; }

    document.getElementById('pb-od-drill-title').textContent = 'Drilling: ' + odCurrentOpening.name;
    document.getElementById('pb-od-drill-side').textContent = odUserSide === 'white' ? 'White' : 'Black';

    odLoadDrillStats();
    odResetDrill();
    odLoadImg().then(() => odDrawDrill());
  }

  function odLoadDrillStats() {
    const scores = odLsJSON('pb_opening_drill_scores') || {};
    const o      = scores[odCurrentOpening.name];
    const side   = o ? o[odUserSide] : null;
    document.getElementById('pb-od-drill-best').textContent     = (side && side.bestStreak) || 0;
    document.getElementById('pb-od-drill-attempts').textContent = (side && side.totalAttempts) || 0;
  }

  function odResetDrill() {
    odDrillChess  = odStartingChess(odCurrentOpening);
    odDrillStreak = 0;
    odDrillFailed = false;
    odDrillFinishedThisAttempt = false;
    odDrillSelSq = null;
    odDrillLegDests = [];
    odDrillLastFrom = null;
    odDrillLastTo = null;
    odDrillHintFromTo = null;
    odDrillBusy = false;

    document.getElementById('pb-od-drill-streak').textContent = '0';
    odHideDrillPopup();

    odSetDrillStatus(odIsUserTurn() ? 'Your turn' : 'Coach to move…');

    // If the opening's last book move was the user's color, coach plays first
    if (!odIsUserTurn()) {
      setTimeout(odCoachPlay, 600);
    }
  }

  function odDrawDrill() {
    odRenderBoard(odCtxDrill, odDrillChess, {
      lastFrom: odDrillLastFrom,
      lastTo:   odDrillLastTo,
      selSq:    odDrillSelSq,
      legDests: odDrillLegDests,
      hintFrom: odDrillHintFromTo ? odDrillHintFromTo.from : null,
      hintTo:   odDrillHintFromTo ? odDrillHintFromTo.to   : null
    });
  }

  function odSetDrillStatus(msg, cls) {
    const el = document.getElementById('pb-od-drill-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'pb-od-drill-status' + (cls ? ' ' + cls : '');
  }

  function odIsUserTurn() {
    return odDrillChess && odDrillChess.turn() === (odUserSide === 'white' ? 'w' : 'b');
  }

  function odOnDrillCanvasClick(e) {
    if (odDrillBusy || odDrillFailed || odDrillFinishedThisAttempt) return;
    if (!odIsUserTurn()) return;

    const rect = odCanvasDrill.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (odCanvasDrill.width  / rect.width);
    const y = (e.clientY - rect.top)  * (odCanvasDrill.height / rect.height);
    const sq = odRcToSq(Math.floor(x / OD_SQ), Math.floor(y / OD_SQ));
    if (!sq) return;

    if (odDrillSelSq) {
      if (odDrillLegDests.includes(sq)) {
        // Auto-promote to queen for simplicity (drills rarely reach promotion in book)
        odUserPlayMove(odDrillSelSq, sq);
        return;
      }
      const p = odDrillChess.get(sq);
      if (p && p.color === odDrillChess.turn()) {
        odDrillSelSq = sq;
        odDrillLegDests = odDrillChess.moves({ square: sq, verbose: true }).map(m => m.to);
        odDrawDrill();
      } else {
        odDrillSelSq = null; odDrillLegDests = [];
        odDrawDrill();
      }
    } else {
      const p = odDrillChess.get(sq);
      if (p && p.color === odDrillChess.turn()) {
        odDrillSelSq = sq;
        odDrillLegDests = odDrillChess.moves({ square: sq, verbose: true }).map(m => m.to);
        odDrawDrill();
      }
    }
  }

  async function odUserPlayMove(from, to) {
    odDrillBusy = true;
    odDrillHintFromTo = null;

    // Look up theory BEFORE making the move
    const fenBefore = odDrillChess.fen();
    const data = await odFetchMasters(fenBefore);

    if (!data) {
      odSetDrillStatus('Lichess unreachable. Check your connection.', 'err');
      odToast("Couldn't reach Lichess. Check your connection and try again.");
      odDrillBusy = false;
      return;
    }

    const totalGames = odTotalGames(data);
    if (totalGames < 5) {
      // Out of book before user's move — should not generally happen but guard anyway
      odDrillFinishedThisAttempt = true;
      odRecordAttempt(odDrillStreak);
      odShowDrillPopup('outofbook', 'Out of book',
        'Theory has thinned out here. Good drill!', null);
      odDrillBusy = false;
      return;
    }

    const acceptable = odAcceptableMoves(data);
    const topMove    = acceptable[0];

    // Convert user move to UCI string (with potential promotion = q)
    const userPiece = odDrillChess.get(from);
    let promo;
    if (userPiece && userPiece.type === 'p' && (to[1] === '8' || to[1] === '1')) promo = 'q';

    const m = odDrillChess.move({ from, to, promotion: promo });
    if (!m) { odDrillBusy = false; return; }

    odDrillSelSq = null; odDrillLegDests = [];
    odDrillLastFrom = from; odDrillLastTo = to;
    odDrawDrill();

    // Check acceptance — compare SAN (handles promotion + ambiguity reliably)
    const accepted = acceptable.some(a => a.san === m.san);

    if (!accepted) {
      // Wrong move — undo it on the visible board and surface failure
      const userSan = m.san;
      odDrillChess.undo();
      odDrillLastFrom = null; odDrillLastTo = null;
      odDrawDrill();

      odDrillFailed = true;
      odDrillFinishedThisAttempt = true;
      odRecordAttempt(odDrillStreak);

      const finalStreak = odDrillStreak;
      const topSan = topMove ? topMove.san : '?';

      // Build the popup immediately with loading state for the explanation
      odShowDrillPopup('failure',
        `Theory says ${topSan}`,
        `You played ${userSan}. Streak ended at ${finalStreak} move${finalStreak === 1 ? '' : 's'}.`,
        true);

      // Fetch explanation asynchronously
      const tone = odLsGet('pf_coach_tone') || 'Direct';
      const system = `You are a chess coach. The student is drilling the ${odCurrentOpening.name} as ${odUserSide}. In exactly one sentence, explain why ${topSan} is better than ${userSan} at this position. Be specific and educational, not just "because it's more popular". Use ${tone} tone.`;
      const user = `FEN before move: ${fenBefore}. Student played ${userSan}. Theoretical move: ${topSan}.`;
      const explain = await odClaudeCall(system, user, 120);
      odUpdateDrillPopupExplain(explain || `${topSan} keeps better book coverage and tactical resources.`);

      odDrillBusy = false;
      return;
    }

    // Accepted: now coach replies
    odSetDrillStatus('Coach to move…');
    setTimeout(odCoachPlay, 350);
  }

  async function odCoachPlay() {
    if (odDrillFailed || odDrillFinishedThisAttempt) { odDrillBusy = false; return; }

    const fen = odDrillChess.fen();
    const data = await odFetchMasters(fen);

    if (!data) {
      odSetDrillStatus('Lichess unreachable. Pausing.', 'err');
      odToast("Couldn't reach Lichess. Check your connection and try again.");
      odDrillBusy = false;
      return;
    }

    const totalGames = odTotalGames(data);
    if (totalGames < 5) {
      odDrillFinishedThisAttempt = true;
      odRecordAttempt(odDrillStreak);
      odShowDrillPopup('outofbook', 'Out of book',
        `Theory has thinned out here. Good drill — you reached a ${odDrillStreak}-move streak.`,
        null);
      odDrillBusy = false;
      return;
    }

    const sorted = odSortedMoves(data);
    if (!sorted.length) {
      odDrillFinishedThisAttempt = true;
      odRecordAttempt(odDrillStreak);
      odShowDrillPopup('outofbook', 'Out of book',
        'No master moves available here. Good drill!', null);
      odDrillBusy = false;
      return;
    }

    const top = sorted[0];
    const m = odDrillChess.move({ from: top.uci.slice(0,2), to: top.uci.slice(2,4), promotion: top.uci[4] || undefined });
    if (!m) { odDrillBusy = false; return; }

    odDrillLastFrom = m.from; odDrillLastTo = m.to;

    // A streak move = user move + coach reply both correctly handled
    odDrillStreak++;
    document.getElementById('pb-od-drill-streak').textContent = String(odDrillStreak);

    odDrawDrill();
    odSetDrillStatus('Your turn');
    odDrillBusy = false;
  }

  // ── Drill popup ─────────────────────────────────────────────────────────
  function odShowDrillPopup(kind, badge, msg, withLoadingExplain) {
    const popup = document.getElementById('pb-od-drill-popup');
    const badgeEl = document.getElementById('pb-od-drill-popup-badge');
    const msgEl   = document.getElementById('pb-od-drill-popup-msg');
    if (!popup) return;

    badgeEl.textContent = badge;
    badgeEl.className   = 'pb-od-drill-popup-badge' + (kind === 'outofbook' ? ' outofbook' : '');

    if (withLoadingExplain) {
      msgEl.innerHTML = odEscape(msg) +
        '<div style="margin-top:6px"><div class="pb-coach-loading"><span></span><span></span><span></span></div></div>';
    } else {
      msgEl.textContent = msg;
    }

    // Only show retry-here when it's a failure (user can keep the streak partial replay)
    const retryBtn = document.getElementById('pb-od-drill-btn-retry');
    if (retryBtn) retryBtn.classList.toggle('hidden', kind !== 'failure');

    popup.classList.remove('hidden');
  }

  function odUpdateDrillPopupExplain(text) {
    const msgEl = document.getElementById('pb-od-drill-popup-msg');
    if (!msgEl) return;
    // Strip the loading-state HTML and append the explanation
    const existing = msgEl.firstChild && msgEl.firstChild.nodeType === 3 ? msgEl.firstChild.textContent : msgEl.textContent;
    msgEl.innerHTML = odEscape(existing) + ' ' + odEscape(text);
  }

  function odHideDrillPopup() {
    const popup = document.getElementById('pb-od-drill-popup');
    if (popup) popup.classList.add('hidden');
  }

  // ── Drill stats ─────────────────────────────────────────────────────────
  function odRecordAttempt(streakLen) {
    const scores = odLsJSON('pb_opening_drill_scores') || {};
    const name = odCurrentOpening.name;
    if (!scores[name]) scores[name] = {};
    if (!scores[name][odUserSide]) {
      scores[name][odUserSide] = { bestStreak: 0, totalAttempts: 0, lastDate: null };
    }
    const entry = scores[name][odUserSide];
    entry.totalAttempts++;
    if (streakLen > entry.bestStreak) entry.bestStreak = streakLen;
    entry.lastDate = new Date().toISOString().slice(0, 10);
    odLsSetJSON('pb_opening_drill_scores', scores);

    document.getElementById('pb-od-drill-best').textContent     = entry.bestStreak;
    document.getElementById('pb-od-drill-attempts').textContent = entry.totalAttempts;
  }

  // ── Hint ────────────────────────────────────────────────────────────────
  async function odShowHint() {
    if (odDrillBusy || !odIsUserTurn() || odDrillFailed || odDrillFinishedThisAttempt) return;

    const fen = odDrillChess.fen();
    const data = await odFetchMasters(fen);
    if (!data || !data.moves || !data.moves.length) {
      odToast('No theory available at this position.');
      return;
    }
    const top = odSortedMoves(data)[0];
    odDrillHintFromTo = { from: top.uci.slice(0,2), to: top.uci.slice(2,4) };
    odDrawDrill();
    setTimeout(() => {
      odDrillHintFromTo = null;
      odDrawDrill();
    }, 3000);
  }

  // ════════════════════════════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════════════════════════════
  let odInited = false;
  function odInit() {
    if (odInited) return;
    odInited = true;

    // Canvases
    odCanvasCoach = document.getElementById('pb-od-coaching-canvas');
    odCanvasDrill = document.getElementById('pb-od-drill-canvas');
    if (odCanvasCoach) {
      odCanvasCoach.width = OD_PX; odCanvasCoach.height = OD_PX;
      odCtxCoach = odCanvasCoach.getContext('2d');
    }
    if (odCanvasDrill) {
      odCanvasDrill.width = OD_PX; odCanvasDrill.height = OD_PX;
      odCtxDrill = odCanvasDrill.getContext('2d');
      odCanvasDrill.addEventListener('click', odOnDrillCanvasClick);
    }

    // Side buttons
    const sw = document.getElementById('pb-od-side-white');
    const sb = document.getElementById('pb-od-side-black');
    if (sw) sw.addEventListener('click', () => odSetSide('white'));
    if (sb) sb.addEventListener('click', () => odSetSide('black'));

    // Coach action buttons
    const ideasBtn = document.getElementById('pb-od-btn-ideas');
    const linesBtn = document.getElementById('pb-od-btn-lines');
    const chatBtn  = document.getElementById('pb-od-btn-chat');
    if (ideasBtn) ideasBtn.addEventListener('click', odActionIdeas);
    if (linesBtn) linesBtn.addEventListener('click', odActionLines);
    if (chatBtn)  chatBtn.addEventListener('click',  odActionChat);

    // Chat input
    const chatSend  = document.getElementById('pb-od-chat-send');
    const chatInput = document.getElementById('pb-od-chat-input');
    if (chatSend)  chatSend.addEventListener('click', odSendChat);
    if (chatInput) chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); odSendChat(); }
    });

    // Watch controls
    const pauseBtn = document.getElementById('pb-od-watch-pause');
    const stopBtn  = document.getElementById('pb-od-watch-stop');
    if (pauseBtn) pauseBtn.addEventListener('click', () => {
      odWatchPaused = !odWatchPaused;
      odSetWatchPauseLabel();
      if (!odWatchPaused) odPlayNextWatchMove();
      else if (odWatchTimer) { clearTimeout(odWatchTimer); odWatchTimer = null; }
    });
    if (stopBtn) stopBtn.addEventListener('click', () => {
      odTeardownWatch();
      // Reset board to opening start
      if (odCurrentOpening) {
        odCoachingChess = odStartingChess(odCurrentOpening);
        odRenderBoard(odCtxCoach, odCoachingChess, {});
      }
    });

    // Drill controls
    const drillStartBtn = document.getElementById('pb-od-start-drill');
    if (drillStartBtn) drillStartBtn.addEventListener('click', () => odShowSub('drilling'));

    const drillHintBtn  = document.getElementById('pb-od-drill-btn-hint');
    if (drillHintBtn)  drillHintBtn.addEventListener('click', odShowHint);
    const drillResetBtn = document.getElementById('pb-od-drill-btn-reset');
    if (drillResetBtn) drillResetBtn.addEventListener('click', odResetDrill);
    const popupX = document.getElementById('pb-od-drill-popup-x');
    if (popupX) popupX.addEventListener('click', odHideDrillPopup);
    const retryBtn = document.getElementById('pb-od-drill-btn-retry');
    if (retryBtn) retryBtn.addEventListener('click', () => {
      // Retry from current FEN — undo the visual nothing, just clear the failure flag
      // and let user pick again at the same position. Streak does NOT carry over.
      odDrillFailed = false;
      odDrillFinishedThisAttempt = false;
      odDrillStreak = 0;
      document.getElementById('pb-od-drill-streak').textContent = '0';
      odHideDrillPopup();
      odSetDrillStatus('Your turn');
    });
    const restartBtn = document.getElementById('pb-od-drill-btn-restart');
    if (restartBtn) restartBtn.addEventListener('click', odResetDrill);

    // Sub-view back links
    const backToSel = document.getElementById('pb-od-back-to-selection');
    if (backToSel) backToSel.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      odShowSub('selection');
    });
    const backToCoach = document.getElementById('pb-od-back-to-coaching');
    if (backToCoach) backToCoach.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      odShowSub('coaching');
    });

    odRenderSelection();
    odShowSub('selection');
  }

  // Watch for the Opening Drill view becoming visible (deferred init)
  document.addEventListener('DOMContentLoaded', () => {
    const viewEl = document.getElementById('pb-view-opening');
    if (!viewEl) return;

    const trigger = () => {
      if (!viewEl.classList.contains('hidden') && !odInited) {
        odInit();
      } else if (!viewEl.classList.contains('hidden') && odInited) {
        // Re-entering — refresh recommended list (in case localStorage changed)
        odRenderRecommended();
        // If we're somehow in coaching/drilling but the opening is gone, reset
        if (!odCurrentOpening) odShowSub('selection');
      }
    };

    const obs = new MutationObserver(trigger);
    obs.observe(viewEl, { attributes: true, attributeFilter: ['class'] });
    trigger();
  });

})();

/* ═══════════════════════════════════════════════════════════════════════
   WEAKNESS DRILL MODE — separate IIFE, never touches other modes' state
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const WD_API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:4000/api/analyze'
    : 'https://chess-lab-production.up.railway.app/api/analyze';

  const WD_PX = 480;
  const WD_SQ = WD_PX / 8; // 60

  const WD_LIGHT = window.BOARD_LIGHT || '#f0d9b5';
  const WD_DARK  = window.BOARD_DARK  || '#b58863';

  const WD_PIECE_URLS = {
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
    bP:'https://lichess1.org/assets/piece/cburnett/bP.svg'
  };
  const WD_SYM = {
    wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙',
    bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟'
  };

  const wdImg = {};
  let wdImgLoaded = false;

  // ── Sub-state ──────────────────────────────────────────────────────────
  let wdSubState   = 'selection';
  let wdDrillMode  = null;     // 'mixed' | 'past_only'
  let wdSessionId  = 0;        // incremented each start; guards stale async

  // ── Session ────────────────────────────────────────────────────────────
  let wdPositions     = [];
  let wdCurrentIdx    = 0;
  let wdSessionResults = [];   // per-position: 'correct'|'wrong_close'|'wrong_significant'
  let wdSessionFirstTry = [];  // boolean per position (first-try result)
  let wdAttempted     = false; // has current position been attempted?
  let wdCurrentStreak = 0;
  let wdBestStreak    = 0;

  // ── Board state ────────────────────────────────────────────────────────
  let wdChess        = null;
  let wdFlipped      = false;
  let wdSelSq        = null;
  let wdLegDests     = [];
  let wdLastFrom     = null;
  let wdLastTo       = null;
  let wdBoardFrozen  = false;
  let wdPendingPromo = null;

  // ── Canvas ─────────────────────────────────────────────────────────────
  let wdCanvas = null;
  let wdCtx    = null;
  let wdCanvasInited = false;

  // ── Stockfish eval worker ──────────────────────────────────────────────
  let wdEvalSF       = null;
  let wdEvalSFReady  = false;
  let wdEvalPending  = null;  // { resolve, fen }
  let wdEvalAccumCp  = null;

  // ── localStorage helpers ───────────────────────────────────────────────
  function lsGet(k)       { try { return localStorage.getItem(k); }         catch(_) { return null; } }
  function lsJSON(k)      { try { return JSON.parse(localStorage.getItem(k)); } catch(_) { return null; } }
  function lsSetJSON(k,v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(_) {} }

  // ── Toast ──────────────────────────────────────────────────────────────
  let _wdToastTimer;
  function wdToast(msg) {
    const el = document.getElementById('az-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(_wdToastTimer);
    _wdToastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // ── Image loading ──────────────────────────────────────────────────────
  function loadWDImg() {
    if (wdImgLoaded) return Promise.resolve();
    return Promise.all(Object.entries(WD_PIECE_URLS).map(([k, url]) =>
      new Promise(resolve => {
        const img = new Image();
        img.onload  = () => { wdImg[k] = img; resolve(); };
        img.onerror = () => resolve();
        img.src = url;
      })
    )).then(() => { wdImgLoaded = true; });
  }

  // ── Coord helpers ──────────────────────────────────────────────────────
  function wdSqToRC(sq) {
    const file = sq.charCodeAt(0) - 97;
    const rank = 8 - parseInt(sq[1]);
    return wdFlipped
      ? { c: 7 - file, r: 7 - rank }
      : { c: file, r: rank };
  }
  function wdRcToSq(c, r) {
    if (c < 0 || c > 7 || r < 0 || r > 7) return null;
    return wdFlipped
      ? String.fromCharCode(97 + (7 - c)) + (r + 1)
      : String.fromCharCode(97 + c) + (8 - r);
  }
  function wdCanvasToSq(x, y) {
    return wdRcToSq(Math.floor(x / WD_SQ), Math.floor(y / WD_SQ));
  }

  // ── Rendering ──────────────────────────────────────────────────────────
  function wdRender() {
    if (!wdCtx || !wdChess) return;
    wdCtx.clearRect(0, 0, WD_PX, WD_PX);
    wdDrawSquares();
    wdDrawHighlights();
    if (wdSelSq && !wdBoardFrozen) wdDrawSelected();
    if (!wdBoardFrozen) wdDrawDots();
    wdDrawPieces();
    wdDrawCoords();
  }

  function wdDrawSquares() {
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        wdCtx.fillStyle = (r + c) % 2 === 0 ? WD_LIGHT : WD_DARK;
        wdCtx.fillRect(c * WD_SQ, r * WD_SQ, WD_SQ, WD_SQ);
      }
  }

  function wdDrawHighlights() {
    [wdLastFrom, wdLastTo].forEach(sq => {
      if (!sq) return;
      const { c, r } = wdSqToRC(sq);
      wdCtx.fillStyle = 'rgba(255,200,0,0.40)';
      wdCtx.fillRect(c * WD_SQ, r * WD_SQ, WD_SQ, WD_SQ);
    });
  }

  function wdDrawSelected() {
    if (!wdSelSq) return;
    const { c, r } = wdSqToRC(wdSelSq);
    wdCtx.fillStyle = 'rgba(80,160,255,0.42)';
    wdCtx.fillRect(c * WD_SQ, r * WD_SQ, WD_SQ, WD_SQ);
  }

  function wdDrawDots() {
    wdLegDests.forEach(sq => {
      const { c, r } = wdSqToRC(sq);
      const cx = c * WD_SQ + WD_SQ / 2;
      const cy = r * WD_SQ + WD_SQ / 2;
      wdCtx.save();
      if (wdChess.get(sq)) {
        wdCtx.strokeStyle = 'rgba(0,0,0,0.30)';
        wdCtx.lineWidth   = WD_SQ * 0.09;
        wdCtx.beginPath();
        wdCtx.arc(cx, cy, WD_SQ * 0.46, 0, Math.PI * 2);
        wdCtx.stroke();
      } else {
        wdCtx.fillStyle = 'rgba(0,0,0,0.22)';
        wdCtx.beginPath();
        wdCtx.arc(cx, cy, WD_SQ * 0.155, 0, Math.PI * 2);
        wdCtx.fill();
      }
      wdCtx.restore();
    });
  }

  function wdDrawPieces() {
    wdChess.board().forEach((row, ri) => {
      row.forEach((p, ci) => {
        if (!p) return;
        const key = p.color + p.type.toUpperCase();
        const dc  = wdFlipped ? 7 - ci : ci;
        const dr  = wdFlipped ? 7 - ri : ri;
        const x   = dc * WD_SQ;
        const y   = dr * WD_SQ;
        if (wdImg[key]) {
          wdCtx.drawImage(wdImg[key], x, y, WD_SQ, WD_SQ);
        } else {
          const sym = WD_SYM[key];
          if (!sym) return;
          const cx2 = x + WD_SQ / 2;
          const cy2 = y + WD_SQ / 2;
          const fs = Math.floor(WD_SQ * 0.70);
          wdCtx.font         = `${fs}px "Segoe UI Emoji","Apple Color Emoji",serif`;
          wdCtx.textAlign    = 'center';
          wdCtx.textBaseline = 'middle';
          wdCtx.fillStyle    = 'rgba(0,0,0,0.28)';
          wdCtx.fillText(sym, cx2 + 1.2, cy2 + 1.2);
          wdCtx.fillStyle    = p.color === 'w' ? '#ffffff' : '#1a1a1a';
          wdCtx.fillText(sym, cx2, cy2);
        }
      });
    });
  }

  function wdDrawCoords() {
    const fs = Math.max(8, Math.floor(WD_SQ * 0.17));
    wdCtx.font = `600 ${fs}px "Segoe UI",sans-serif`;
    for (let r = 0; r < 8; r++) {
      const num = wdFlipped ? (r + 1) : (8 - r);
      wdCtx.fillStyle    = r % 2 === 0 ? WD_DARK : WD_LIGHT;
      wdCtx.textAlign    = 'left';
      wdCtx.textBaseline = 'top';
      wdCtx.fillText(String(num), 2, r * WD_SQ + 2);
    }
    for (let c = 0; c < 8; c++) {
      const ch = wdFlipped
        ? String.fromCharCode(97 + (7 - c))
        : String.fromCharCode(97 + c);
      wdCtx.fillStyle    = c % 2 !== 0 ? WD_DARK : WD_LIGHT;
      wdCtx.textAlign    = 'right';
      wdCtx.textBaseline = 'bottom';
      wdCtx.fillText(ch, (c + 1) * WD_SQ - 2, WD_PX - 2);
    }
  }

  // ── Canvas click handler ───────────────────────────────────────────────
  function wdHandleClick(sq) {
    if (!wdChess || wdBoardFrozen || wdPendingPromo) return;

    if (wdSelSq) {
      if (wdLegDests.includes(sq)) {
        const piece  = wdChess.get(wdSelSq);
        const isPromo = piece && piece.type === 'p' &&
          ((piece.color === 'w' && sq[1] === '8') || (piece.color === 'b' && sq[1] === '1'));
        if (isPromo) {
          wdPendingPromo = { from: wdSelSq, to: sq };
          wdSelSq = null; wdLegDests = [];
          wdRender();
          wdShowPromo(piece.color);
          return;
        }
        const m = wdChess.move({ from: wdSelSq, to: sq });
        if (m) {
          wdLastFrom = wdSelSq; wdLastTo = sq;
          wdSelSq = null; wdLegDests = [];
          wdBoardFrozen = true;
          wdRender();
          wdProcessMove(m.san);
          return;
        }
      }
      const p = wdChess.get(sq);
      if (p && p.color === wdChess.turn()) wdDoSelect(sq);
      else { wdSelSq = null; wdLegDests = []; wdRender(); }
    } else {
      const p = wdChess.get(sq);
      if (p && p.color === wdChess.turn()) wdDoSelect(sq);
    }
  }

  function wdDoSelect(sq) {
    wdSelSq    = sq;
    wdLegDests = wdChess.moves({ square: sq, verbose: true }).map(m => m.to);
    wdRender();
  }

  // ── Promotion ──────────────────────────────────────────────────────────
  function wdShowPromo(color) {
    const opts = document.getElementById('pb-wd-promo-options');
    if (!opts) return;
    opts.innerHTML = '';
    ['q','r','b','n'].forEach(type => {
      const key = color + type.toUpperCase();
      const div = document.createElement('div');
      div.className = 'promo-piece';
      const img = document.createElement('img');
      img.src = WD_PIECE_URLS[key];
      img.alt = key;
      div.appendChild(img);
      div.addEventListener('click', () => wdCompletePromo(type));
      opts.appendChild(div);
    });
    const overlay = document.getElementById('pb-wd-promo-overlay');
    if (overlay) overlay.classList.remove('hidden');
  }

  function wdCompletePromo(type) {
    const overlay = document.getElementById('pb-wd-promo-overlay');
    if (overlay) overlay.classList.add('hidden');
    if (!wdPendingPromo) return;
    const { from, to } = wdPendingPromo;
    wdPendingPromo = null;
    const m = wdChess.move({ from, to, promotion: type });
    if (m) {
      wdLastFrom = from; wdLastTo = to;
      wdBoardFrozen = true;
      wdRender();
      wdProcessMove(m.san);
    }
  }

  // ── Move processing ────────────────────────────────────────────────────
  async function wdProcessMove(userSan) {
    const pos = wdPositions[wdCurrentIdx];
    if (!pos) return;

    // Ensure Stockfish ground truth (best move + eval) is ready before judging.
    try { await (pos._groundPromise || wdGroundPosition(pos)); } catch (_) {}

    // Stockfish is the ONLY thing the judge may compare against. If grounding
    // failed (engine error/timeout), NEVER fall back to a Claude-supplied
    // move/eval — that would reintroduce the hallucination bug. Skip instead.
    if (!pos._grounded || !pos.bestMove) {
      wdShowUngradable();
      return;
    }

    function normSan(s) { return (s || '').replace(/[+#!?]/g, ''); }
    const isExactBest = normSan(userSan) === normSan(pos.bestMove);

    // Grade purely on Stockfish evals (mover's perspective). evalAfterBest is
    // the eval after the engine's move; evalAfterUser after what was played.
    const evalAfterBest = await wdEvalAfterMove(pos.fen, pos.bestMove);
    const evalAfterUser = isExactBest ? evalAfterBest : await wdEvalAfterMove(pos.fen, userSan);

    // If Stockfish could not evaluate either move, do not guess — skip.
    if (evalAfterBest === null || evalAfterUser === null) {
      wdShowUngradable();
      return;
    }

    // gap = pawns lost versus the engine's best move. A move within 0.3 pawns
    // of best counts as correct (Stockfish-grounded leniency — no Claude list).
    const gap = evalAfterBest - evalAfterUser;
    let result;
    if (gap <= 0.3)      result = 'correct';           // within 0.3 of best
    else if (gap < 1.0)  result = 'wrong_close';       // 0.3–1.0 pawns off
    else                 result = 'wrong_significant'; // ≥ 1.0 pawn (full pawn+)

    const isFirstTry = !wdAttempted;
    wdAttempted = true;

    if (isFirstTry) {
      wdSessionResults.push(result);
      wdSessionFirstTry.push(result === 'correct');

      if (result === 'correct') {
        wdCurrentStreak++;
        if (wdCurrentStreak > wdBestStreak) wdBestStreak = wdCurrentStreak;
      } else {
        wdCurrentStreak = 0;
      }

      wdSaveLog({
        timestamp:      new Date().toISOString(),
        mode:           wdDrillMode,
        weaknessType:   pos.weaknessType || 'Unknown',
        positionSource: pos.source,
        realGameId:     pos.realGameId || null,
        fen:            pos.fen,
        bestMove:       pos.bestMove || '',
        userMove:       userSan,
        result,
        firstTry:       true
      });
      wdUpdateStreaks(result === 'correct');
    }

    wdUpdateDots();
    wdUpdateSessionStats();
    await wdShowCoachFeedback(pos, userSan, result, evalAfterBest, evalAfterUser);
    wdShowResultButtons(result);
  }

  // ── Position can't be Stockfish-graded → skip, never judge vs Claude ────
  function wdShowUngradable() {
    const resultEl = document.getElementById('pb-wd-coach-result');
    const msgEl    = document.getElementById('pb-wd-coach-msg');
    const waitEl   = document.getElementById('pb-wd-coach-waiting');
    const btnsEl   = document.getElementById('pb-wd-coach-btns');
    const retryEl  = document.getElementById('pb-wd-btn-retry');
    const nextEl   = document.getElementById('pb-wd-btn-next');
    if (waitEl)   waitEl.classList.add('hidden');
    if (resultEl) {
      resultEl.textContent = '— Skipped';
      resultEl.className    = 'pb-wd-coach-result pb-wd-result-wrong';
      resultEl.classList.remove('hidden');
    }
    if (msgEl) {
      msgEl.textContent = "Couldn't analyze this position with the engine, so it can't be graded. Moving on.";
      msgEl.classList.remove('hidden');
    }
    if (btnsEl)  btnsEl.classList.remove('hidden');
    if (retryEl) retryEl.classList.add('hidden'); // can't grade a retry either
    if (nextEl)  nextEl.textContent = (wdCurrentIdx >= wdPositions.length - 1) ? 'Finish →' : 'Next →';
  }

  // ── Stockfish eval worker ──────────────────────────────────────────────
  function wdInitEvalSF() {
    try { wdEvalSF = new Worker('js/stockfish.js'); }
    catch(_) { return; }

    wdEvalSF.onmessage = function(e) {
      const line = typeof e === 'string' ? e : (e.data || '');
      if (line === 'uciok') {
        wdEvalSF.postMessage('setoption name Hash value 16');
        wdEvalSF.postMessage('isready');
      } else if (line === 'readyok') {
        wdEvalSFReady = true;
        if (wdEvalPending) wdDoEvalNow(wdEvalPending.fen);
      } else {
        const cm = line.match(/\bscore cp (-?\d+)/);
        const mm = line.match(/\bscore mate (-?\d+)/);
        if (cm) wdEvalAccumCp = parseInt(cm[1], 10);
        if (mm) wdEvalAccumCp = parseInt(mm[1], 10) > 0 ? 9900 : -9900;

        if (line.startsWith('bestmove') && wdEvalPending) {
          const { resolve } = wdEvalPending;
          wdEvalPending  = null;
          const cp       = wdEvalAccumCp;
          wdEvalAccumCp  = null;
          const bm       = line.match(/^bestmove\s+(\S+)/);
          const bestUci  = (bm && bm[1] && bm[1] !== '(none)') ? bm[1] : null;
          resolve({ cp, bestUci });
        }
      }
    };
    wdEvalSF.onerror = () => {
      if (wdEvalPending) { wdEvalPending.resolve(null); wdEvalPending = null; }
    };
    wdEvalSF.postMessage('uci');
  }

  function wdDoEvalNow(fen) {
    wdEvalAccumCp = null;
    wdEvalSF.postMessage('position fen ' + fen);
    wdEvalSF.postMessage('go depth 14');
  }

  function wdEvalPosition(fen) {
    return new Promise(resolve => {
      const timeoutId = setTimeout(() => {
        if (wdEvalPending) {
          const old = wdEvalPending;
          wdEvalPending = null;
          if (wdEvalSF) wdEvalSF.postMessage('stop');
          old.resolve(null);
        }
        resolve(null);
      }, 5000);

      const wrapped = (val) => { clearTimeout(timeoutId); resolve(val); };
      wdEvalPending = { resolve: wrapped, fen };
      if (wdEvalSFReady && wdEvalSF) wdDoEvalNow(fen);
    });
  }

  // ── Stockfish ground truth ─────────────────────────────────────────────
  // Stockfish is the source of truth for ALL chess facts. For every drill
  // position we compute the REAL best move + eval from the FEN and overwrite
  // whatever bestMove/evalBeforeMove the position arrived with (Claude-claimed
  // or analyzer-derived). The judge and coach then narrate only these facts.
  async function wdGroundPosition(pos) {
    if (!pos || pos._grounded) return pos;
    try {
      const res = await wdEvalPosition(pos.fen);
      if (res && res.bestUci) {
        const chk = new Chess(pos.fen);
        const mv  = chk.move({
          from: res.bestUci.slice(0, 2),
          to:   res.bestUci.slice(2, 4),
          promotion: res.bestUci.slice(4, 5) || undefined
        });
        if (mv) {
          pos.bestMove = mv.san;            // Stockfish's best move (SAN)
          pos.bestFrom = mv.from;
          pos.bestTo   = mv.to;
          pos.bestCapture = mv.captured || null; // piece type captured, if any
          pos.bestGivesCheck = /[+#]/.test(mv.san);
          // cp is from the side-to-move (= mover) perspective, in centipawns.
          if (typeof res.cp === 'number') pos.evalBeforeMove = res.cp / 100;
          pos._grounded = true;
        }
      }
    } catch (_) { /* fall back to whatever bestMove/eval the position had */ }
    return pos;
  }

  // Eval after a given SAN move, returned from the MOVER's perspective.
  async function wdEvalAfterMove(fen, san) {
    try {
      const tmp = new Chess(fen);
      if (!tmp.move(san)) return null;
      const res = await wdEvalPosition(tmp.fen());
      if (!res || res.cp === null) return null;
      return -(res.cp / 100); // opponent to move after the played move → negate
    } catch (_) { return null; }
  }

  // ── Claude call helper ─────────────────────────────────────────────────
  async function wdClaudeCall(system, userMsg, maxTokens) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(WD_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model:      'claude-sonnet-4-6',
          max_tokens: maxTokens || 200,
          system,
          messages:   [{ role: 'user', content: userMsg }]
        })
      });
      clearTimeout(tid);
      if (!res.ok) return null;
      const data = await res.json();
      return data?.content?.[0]?.text?.trim() || null;
    } catch(_) {
      clearTimeout(tid);
      return null;
    }
  }

  // ── Coach feedback ─────────────────────────────────────────────────────
  // evalAfterBest / evalAfterUser are the Stockfish evals already computed by
  // the judge (mover's perspective) — passed in so we don't re-query the engine.
  async function wdShowCoachFeedback(pos, userSan, result, evalAfterBest, evalAfterUser) {
    const resultEl = document.getElementById('pb-wd-coach-result');
    const msgEl    = document.getElementById('pb-wd-coach-msg');
    const waitEl   = document.getElementById('pb-wd-coach-waiting');
    if (!resultEl || !msgEl || !waitEl) return;

    waitEl.classList.add('hidden');
    resultEl.classList.remove('hidden');
    msgEl.classList.remove('hidden');

    if (result === 'correct') {
      resultEl.textContent = '✓ Correct';
      resultEl.className   = 'pb-wd-coach-result pb-wd-result-correct';
    } else {
      resultEl.textContent = '✗ Not quite';
      resultEl.className   = 'pb-wd-coach-result pb-wd-result-wrong';
    }

    msgEl.textContent = 'Getting feedback…';

    const rawName    = lsGet('pf_display_name') || lsGet('csa_chesscom_username') || 'there';
    const firstName  = rawName.split(' ')[0];
    const elo        = lsGet('csa_elo_current') || '1000';
    const tone       = lsGet('pf_coach_tone') || 'Encouraging';
    const resultLabel = result === 'correct' ? 'CORRECT'
      : result === 'wrong_close' ? 'WRONG_CLOSE' : 'WRONG_SIGNIFICANT';

    // ── Verified facts from Stockfish ground truth ──
    // pos.bestMove / bestFrom / bestTo / bestCapture / evalBeforeMove were all
    // set by wdGroundPosition (Stockfish). evalAfterBest / evalAfterUser come
    // from the judge — so the coach can speak about the swing without reading
    // the board itself.
    const fmt = (n) => (typeof n === 'number'
      ? (n >= 0 ? '+' : '') + n.toFixed(1)
      : '?');
    const evalBefore = typeof pos.evalBeforeMove === 'number' ? pos.evalBeforeMove : null;

    // Verified geometry of the best move only (from Stockfish's chosen move).
    const captureFact = pos.bestCapture
      ? `It captures a ${({p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen'})[pos.bestCapture] || 'piece'} on ${pos.bestTo}.`
      : '';
    const checkFact = pos.bestGivesCheck ? 'It gives check.' : '';
    const moveGeometry = (pos.bestFrom && pos.bestTo)
      ? `Best move ${pos.bestMove} moves from ${pos.bestFrom} to ${pos.bestTo}. ${captureFact} ${checkFact}`.trim()
      : `Best move: ${pos.bestMove || 'unknown'}.`;

    const system = `You are a chess coach giving feedback on a one-move drill. The student is named ${firstName}, rated ${elo}, and uses ${tone} tone (Encouraging / Direct / Tough love).

This drill targets their weakness: ${pos.weaknessType || 'General pattern'}

VERIFIED FACTS (computed by the Stockfish chess engine — the ONLY facts you may use):
- ${moveGeometry}
- The student played: ${userSan}
- Result: ${resultLabel}
- Eval before the move: ${fmt(evalBefore)} pawns (from the mover's perspective)
- Eval after the best move: ${fmt(evalAfterBest)} pawns (mover's perspective)
- Eval after the student's move: ${fmt(evalAfterUser)} pawns (mover's perspective)
(A higher number is better for the mover. The eval swing = best minus student's move.)

STRICT RULES — you are NOT allowed to read the board:
- Use ONLY the verified facts above. Do not state where any OTHER piece sits, and do not name squares beyond the from/to squares given for the best move.
- Do NOT claim the best move "attacks", "targets", "pins", "forks", "defends", or threatens any specific piece or square unless that fact is explicitly listed above (you may only cite the capture/check facts if present).
- Do NOT invent tactical reasons. If no tactical fact is given, explain the difference using the eval numbers and the named best move only (e.g. "it keeps more of your advantage", "it avoids losing material", "the engine rates it about X pawns better").
- Never assert anything about the position you cannot derive from the facts above.

Write a 1-2 sentence feedback message that:
- Uses the student's first name and matches the tone setting
- If CORRECT: affirm they found the engine's top move
- If WRONG_CLOSE: name the best move and note theirs was only slightly worse (small eval gap)
- If WRONG_SIGNIFICANT: name the best move and convey it was clearly stronger using the eval swing
- May reference the weakness pattern in general terms

Respond with ONLY the feedback text. No JSON, no markdown.`;

    try {
      const text = await wdClaudeCall(system, 'Give feedback now.', 150);
      msgEl.textContent = text || (result === 'correct'
        ? `Good move, ${firstName}!`
        : `Best was ${pos.bestMove || 'a different move'}. Keep practising this pattern.`);
    } catch(_) {
      msgEl.textContent = result === 'correct' ? 'Correct!' : `Best was ${pos.bestMove || 'a different move'}.`;
    }
  }

  // ── Result buttons ─────────────────────────────────────────────────────
  function wdShowResultButtons(result) {
    const btnsEl  = document.getElementById('pb-wd-coach-btns');
    const retryEl = document.getElementById('pb-wd-btn-retry');
    const nextEl  = document.getElementById('pb-wd-btn-next');
    if (!btnsEl || !retryEl || !nextEl) return;
    btnsEl.classList.remove('hidden');
    retryEl.classList.toggle('hidden', result === 'correct');
    const isLast = (wdCurrentIdx >= wdPositions.length - 1);
    nextEl.textContent = isLast ? 'Finish →' : 'Next →';
  }

  // ── Dots and stats ─────────────────────────────────────────────────────
  function wdUpdateDots() {
    const container = document.getElementById('pb-wd-dots');
    if (!container) return;
    const total = wdPositions.length;
    let html = '';
    for (let i = 0; i < total; i++) {
      if (i === wdCurrentIdx) {
        html += '<span class="pb-wd-dot pb-wd-dot-current"></span>';
      } else if (i < wdSessionResults.length) {
        const cls = wdSessionFirstTry[i] ? 'pb-wd-dot-correct' : 'pb-wd-dot-wrong';
        html += `<span class="pb-wd-dot ${cls}"></span>`;
      } else {
        html += '<span class="pb-wd-dot pb-wd-dot-upcoming"></span>';
      }
    }
    container.innerHTML = html;
  }

  function wdUpdateSessionStats() {
    const correct = wdSessionFirstTry.filter(Boolean).length;
    const total   = wdSessionResults.length;
    const el = id => document.getElementById(id);
    if (el('pb-wd-sess-correct')) el('pb-wd-sess-correct').textContent = correct + ' / ' + total;
    if (el('pb-wd-sess-streak'))  el('pb-wd-sess-streak').textContent  = wdCurrentStreak;
    if (el('pb-wd-sess-best'))    el('pb-wd-sess-best').textContent    = wdBestStreak;
  }

  // ── Position loading ───────────────────────────────────────────────────
  function wdLoadPosition(idx) {
    const pos = wdPositions[idx];
    if (!pos) return;

    wdCurrentIdx    = idx;
    wdAttempted     = false;
    wdBoardFrozen   = false;
    wdSelSq         = null;
    wdLegDests      = [];
    wdLastFrom      = null;
    wdLastTo        = null;
    wdPendingPromo  = null;

    try { wdChess = new Chess(pos.fen); }
    catch(_) {
      wdToast('Invalid position — skipping…');
      if (idx + 1 < wdPositions.length) wdLoadPosition(idx + 1);
      return;
    }

    wdFlipped = (pos.sideToMove === 'black');

    // Compute Stockfish ground truth (best move + eval) for this position now,
    // so it's ready by the time the user submits. Stored on the pos itself.
    pos._groundPromise = wdGroundPosition(pos).then(() => {
      // Refresh the displayed engine eval with the Stockfish value, if the
      // user hasn't moved on to another position in the meantime.
      if (wdCurrentIdx !== idx) return pos;
      const el = document.getElementById('pb-wd-eval-line');
      if (el && typeof pos.evalBeforeMove === 'number') {
        const side = pos.sideToMove === 'white' ? 'White' : 'Black';
        el.textContent = `${side} to move · Engine eval: ${pos.evalBeforeMove >= 0 ? '+' : ''}${pos.evalBeforeMove.toFixed(1)}`;
      }
      return pos;
    });

    // Real moment banner
    const banner     = document.getElementById('pb-wd-real-banner');
    const bannerText = document.getElementById('pb-wd-real-banner-text');
    if (banner && bannerText) {
      if (pos.source === 'real' && pos.gameMetadata) {
        bannerText.textContent =
          `This is a moment from your real game vs ${pos.gameMetadata.opponent} on ${pos.gameMetadata.date} — find the move you missed`;
        banner.classList.remove('hidden');
      } else {
        banner.classList.add('hidden');
      }
    }

    // Drill card
    const labelEl = document.getElementById('pb-wd-weakness-label');
    if (labelEl) labelEl.textContent = pos.weaknessType || 'Pattern';

    const taskEl = document.getElementById('pb-wd-task-desc');
    if (taskEl) taskEl.textContent = pos.taskDescription || 'Find the best move.';

    const hintEl = document.getElementById('pb-wd-hint-line');
    if (hintEl) hintEl.textContent = pos.hint || '';

    // Eval line
    const evalEl = document.getElementById('pb-wd-eval-line');
    if (evalEl) {
      const side    = pos.sideToMove === 'white' ? 'White' : 'Black';
      const evalStr = typeof pos.evalBeforeMove === 'number'
        ? ` · Engine eval: ${pos.evalBeforeMove >= 0 ? '+' : ''}${pos.evalBeforeMove.toFixed(1)}`
        : '';
      evalEl.textContent = side + ' to move' + evalStr;
    }

    // Progress bar
    const total   = wdPositions.length;
    const progEl  = document.getElementById('pb-wd-progress-text');
    const barEl   = document.getElementById('pb-wd-progress-bar');
    if (progEl) progEl.textContent = `Position ${idx + 1} of ${total}`;
    if (barEl)  barEl.style.width  = (idx / total * 100) + '%';

    // Drilling info panel
    const patEl = document.getElementById('pb-wd-info-pattern');
    if (patEl) patEl.textContent = pos.weaknessType || '—';

    const log       = lsJSON('pb_weakness_drill_log') || [];
    const typeLog   = log.filter(e => e.firstTry && e.weaknessType === pos.weaknessType);
    const alltime   = typeLog.length > 0
      ? Math.round(typeLog.filter(e => e.result === 'correct').length / typeLog.length * 100) + '%'
      : '—';
    const altEl = document.getElementById('pb-wd-info-alltime');
    if (altEl) altEl.textContent = alltime;

    // Reset coach card
    const waitEl   = document.getElementById('pb-wd-coach-waiting');
    const resultEl = document.getElementById('pb-wd-coach-result');
    const msgEl    = document.getElementById('pb-wd-coach-msg');
    const btnsEl   = document.getElementById('pb-wd-coach-btns');
    if (waitEl)   { waitEl.textContent = 'Play your move to get feedback.'; waitEl.classList.remove('hidden'); }
    if (resultEl) resultEl.classList.add('hidden');
    if (msgEl)    msgEl.classList.add('hidden');
    if (btnsEl)   btnsEl.classList.add('hidden');

    wdUpdateDots();
    wdUpdateSessionStats();
    wdRender();
  }

  // ── Real moments sourcing ──────────────────────────────────────────────
  function wdGetRealMoments() {
    const moments = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('csa_game_')) continue;
      try {
        const game = JSON.parse(localStorage.getItem(key));
        if (!game || !game.analysis || !Array.isArray(game.fens)) continue;
        const playerColor = game.playerColor || 'white';
        const moves = game.analysis.moves || [];
        moves.forEach(m => {
          if (m.color !== playerColor)                            return;
          if (!['blunder','miss'].includes(m.classification))    return;
          if (!m.bestMoveSan)                                     return;
          const fenBefore = game.fens[m.ply - 1];
          if (!fenBefore)                                         return;
          try { new Chess(fenBefore); } catch(_) { return; }

          const sideToMove = fenBefore.split(' ')[1] === 'w' ? 'white' : 'black';
          const opponent   = playerColor === 'white'
            ? (game.metadata && game.metadata.black  || 'Unknown')
            : (game.metadata && game.metadata.white  || 'Unknown');
          const date = (game.savedAt || '').slice(0, 10) || (game.metadata && game.metadata.date || '');

          const evalWhite = typeof m.evalBefore === 'number' ? m.evalBefore : 0;
          const evalBeforeMove = sideToMove === 'white' ? evalWhite : -evalWhite;

          moments.push({
            source:       'real',
            realGameId:   game.id || '',
            fen:          fenBefore,
            sideToMove,
            bestMove:     m.bestMoveSan,
            userActualMove: m.san,
            evalBeforeMove,
            gameMetadata: {
              opponent: (opponent || 'Unknown').slice(0, 24),
              date:     date || 'unknown date'
            },
            taskDescription: `You're ${sideToMove === 'white' ? 'White' : 'Black'}. Find the move you should have played.`,
            hint:            `Think about ${m.bestMoveSan} — why is it the strongest?`,
            alternativeAcceptable: [],
            weaknessType: m.classification === 'blunder' ? 'Blunder pattern' : 'Missed opportunity'
          });
        });
      } catch(_) {}
    }
    return moments;
  }

  // ── AI position generation ─────────────────────────────────────────────
  async function wdGeneratePosition(weakness, simple) {
    const elo  = lsGet('csa_elo_current') || '1000';
    const tone = lsGet('pf_coach_tone')   || 'Encouraging';

    // Note: bestMove/eval supplied here are only used to seed the position;
    // they are overwritten by Stockfish ground truth (wdGroundPosition) before
    // the move is judged, so do not ask Claude for an eval number.
    const system = simple
      ? `Generate a chess position for a "${weakness.title}" drill. Return ONLY valid JSON (no markdown fences):
{"fen":"...","sideToMove":"white","bestMove":"...","alternativeAcceptable":[],"taskDescription":"Find the best move.","hint":"Look for the key idea."}`
      : `Generate a chess position that drills the following weakness pattern: ${weakness.title}. Description: ${weakness.description}.

The user is rated ${elo}. Their preferred tone is ${tone}.

Return ONLY valid JSON (no markdown, no code fences) with this exact shape:
{
  "fen": "...",
  "sideToMove": "white" or "black",
  "bestMove": "..." (SAN notation),
  "alternativeAcceptable": ["..."],
  "taskDescription": "You're White/Black and..." (1-sentence),
  "hint": "Look at..." (1-sentence)
}

Requirements: legal FEN, bestMove is legal in that position.`;

    const raw = await wdClaudeCall(system, 'Generate the position now.', 350);
    if (!raw) return null;

    try {
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const pos = JSON.parse(cleaned);
      if (!pos.fen || !pos.bestMove || !pos.sideToMove) return null;

      let chessTest;
      try { chessTest = new Chess(pos.fen); } catch(_) { return null; }
      if (!chessTest) return null;

      // Validate bestMove is legal
      const legalSans = chessTest.moves();
      function normSan(s) { return (s || '').replace(/[+#!?]/g, ''); }
      const bestNorm = normSan(pos.bestMove);
      const isLegal  = legalSans.some(s => normSan(s) === bestNorm);
      if (!isLegal) return null;

      return {
        source:                'generated',
        fen:                   pos.fen,
        sideToMove:            pos.sideToMove,
        bestMove:              pos.bestMove,
        alternativeAcceptable: Array.isArray(pos.alternativeAcceptable) ? pos.alternativeAcceptable : [],
        taskDescription:       pos.taskDescription || `You're ${pos.sideToMove}. Find the best move.`,
        hint:                  pos.hint || '',
        evalBeforeMove:        typeof pos.evalBeforeMove === 'number' ? pos.evalBeforeMove : 0,
        weaknessType:          weakness.title,
        weaknessDescription:   weakness.description || ''
      };
    } catch(_) { return null; }
  }

  // ── Session position builder ───────────────────────────────────────────
  async function wdBuildSessionPositions(mode, sessionId) {
    const recs       = lsJSON('csa_recommendations');
    const weaknesses = (recs && recs.topWeaknesses) ? recs.topWeaknesses : [];
    const realAll    = wdGetRealMoments();

    if (mode === 'past_only') {
      const shuffled = realAll.slice().sort(() => Math.random() - 0.5);
      return shuffled.slice(0, Math.min(10, shuffled.length));
    }

    // mixed: generate up to 7 from weaknesses, add 1-2 real
    const generated = [];
    const realCopy  = realAll.slice();

    for (const weakness of weaknesses.slice(0, 5)) {
      if (sessionId !== wdSessionId) return [];
      if (generated.length >= 7) break;

      let pos = await wdGeneratePosition(weakness, false);
      if (!pos) pos = await wdGeneratePosition(weakness, true);

      if (pos) {
        generated.push(pos);
      } else if (realCopy.length > 0) {
        // Fallback to a real moment
        const ri = Math.floor(Math.random() * realCopy.length);
        generated.push(realCopy.splice(ri, 1)[0]);
      }
    }

    // Add 1-2 real moments
    const toAdd = Math.min(2, realCopy.length);
    for (let i = 0; i < toAdd; i++) {
      const ri = Math.floor(Math.random() * realCopy.length);
      generated.push(realCopy.splice(ri, 1)[0]);
    }

    return generated.slice().sort(() => Math.random() - 0.5).slice(0, 10);
  }

  // ── localStorage ops ───────────────────────────────────────────────────
  function wdSaveLog(entry) {
    let log = lsJSON('pb_weakness_drill_log') || [];
    log.push(entry);
    if (log.length > 500) log = log.slice(log.length - 500);
    lsSetJSON('pb_weakness_drill_log', log);
  }

  function wdUpdateStreaks(correct) {
    const streaks = lsJSON('pb_weakness_streaks') || { current: 0, best: 0, lastUpdated: '' };
    if (correct) {
      streaks.current++;
      if (streaks.current > streaks.best) streaks.best = streaks.current;
    } else {
      streaks.current = 0;
    }
    streaks.lastUpdated = new Date().toISOString();
    lsSetJSON('pb_weakness_streaks', streaks);
    wdBestStreak = streaks.best;
  }

  function wdSaveSessionHistory(entry) {
    let hist = lsJSON('pb_weakness_session_history') || [];
    hist.unshift(entry);
    if (hist.length > 50) hist = hist.slice(0, 50);
    lsSetJSON('pb_weakness_session_history', hist);
  }

  // ── Sub-view management ────────────────────────────────────────────────
  function wdShowSub(name) {
    ['pb-wd-selection','pb-wd-drilling','pb-wd-summary'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', id !== 'pb-wd-' + name);
    });
    wdSubState = name;
  }

  // ── Selection screen ───────────────────────────────────────────────────
  function wdInitSelection() {
    const recs         = lsJSON('csa_recommendations');
    const hasWeaknesses = recs && recs.topWeaknesses && recs.topWeaknesses.length > 0;

    const emptyEl = document.getElementById('pb-wd-empty');
    const cardsEl = document.getElementById('pb-wd-cards');
    if (!emptyEl || !cardsEl) return;

    if (!hasWeaknesses) {
      emptyEl.classList.remove('hidden');
      cardsEl.classList.add('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    cardsEl.classList.remove('hidden');

    // Weakness count pill
    const weakCount = recs.topWeaknesses.length;
    const wcEl = document.getElementById('pb-wd-pill-weakness-count');
    if (wcEl) wcEl.textContent = weakCount + ' weakness' + (weakCount !== 1 ? 'es' : '') + ' identified';

    // Blunder count
    const realMoments = wdGetRealMoments();
    const bcEl = document.getElementById('pb-wd-pill-blunder-count');
    if (bcEl) bcEl.textContent = realMoments.length + ' critical moment' + (realMoments.length !== 1 ? 's' : '') + ' saved';

    const pastCard = document.getElementById('pb-wd-card-past');
    if (pastCard) pastCard.classList.toggle('pb-wd-card-disabled', realMoments.length === 0);

    // Stats
    const log     = lsJSON('pb_weakness_drill_log')      || [];
    const history = lsJSON('pb_weakness_session_history') || [];
    const streaks = lsJSON('pb_weakness_streaks')         || { best: 0 };

    const sessEl = document.getElementById('pb-wd-stat-sessions');
    if (sessEl) sessEl.textContent = history.length;

    const firstTryLog = log.filter(e => e.firstTry);
    const accEl = document.getElementById('pb-wd-stat-accuracy');
    if (accEl) {
      accEl.textContent = firstTryLog.length > 0
        ? Math.round(firstTryLog.filter(e => e.result === 'correct').length / firstTryLog.length * 100) + '%'
        : '—';
    }

    const bestEl = document.getElementById('pb-wd-stat-streak');
    if (bestEl) bestEl.textContent = streaks.best;
  }

  // ── Summary screen ─────────────────────────────────────────────────────
  function wdShowSummaryScreen() {
    wdShowSub('summary');

    const total   = wdPositions.length;
    const correct = wdSessionFirstTry.filter(Boolean).length;

    const scoreEl = document.getElementById('pb-wd-sum-score');
    if (scoreEl) scoreEl.textContent = correct + ' / ' + total;

    // Trend vs last session
    const history   = lsJSON('pb_weakness_session_history') || [];
    const lastSess  = history[0];
    const trendEl   = document.getElementById('pb-wd-sum-trend');
    if (trendEl && lastSess) {
      const diff = correct - lastSess.score.correct;
      if (diff > 0) {
        trendEl.textContent = `↑ Up from last session's ${lastSess.score.correct} / ${lastSess.score.total}`;
        trendEl.style.color = '#4ade80';
      } else if (diff < 0) {
        trendEl.textContent = `↓ Down from last session's ${lastSess.score.correct} / ${lastSess.score.total}`;
        trendEl.style.color = '#f87171';
      } else {
        trendEl.textContent = `Same as last session (${lastSess.score.correct} / ${lastSess.score.total})`;
        trendEl.style.color = '#9ca3af';
      }
    } else if (trendEl) {
      trendEl.textContent = 'First session!';
      trendEl.style.color = '#4ade80';
    }

    // Per-weakness breakdown
    const byType = {};
    wdPositions.forEach((pos, i) => {
      const t = pos.weaknessType || 'Unknown';
      if (!byType[t]) byType[t] = { correct: 0, total: 0 };
      byType[t].total++;
      if (wdSessionFirstTry[i]) byType[t].correct++;
    });

    const bdEl = document.getElementById('pb-wd-sum-breakdown');
    if (bdEl) {
      bdEl.innerHTML = '<div class="pb-wd-breakdown-grid">' +
        Object.entries(byType).map(([type, data]) => {
          const pct = data.total > 0 ? data.correct / data.total : 0;
          const cls = pct === 1 ? 'pb-wd-bd-green' : pct >= 0.5 ? 'pb-wd-bd-amber' : 'pb-wd-bd-red';
          return `<div class="pb-wd-breakdown-row ${cls}">
            <span>${type}</span>
            <span>${data.correct}/${data.total}${pct === 1 ? ' ✓' : ''}</span>
          </div>`;
        }).join('') +
      '</div>';
    }

    // Save session history first (so counts below are up-to-date)
    wdSaveSessionHistory({
      timestamp:         new Date().toISOString(),
      mode:              wdDrillMode,
      score:             { correct, total },
      weaknessBreakdown: byType,
      streak:            wdBestStreak
    });

    // Stats updated card
    const streaks    = lsJSON('pb_weakness_streaks')         || { best: 0 };
    const log        = lsJSON('pb_weakness_drill_log')       || [];
    const savedHist  = lsJSON('pb_weakness_session_history') || [];
    const ftLog      = log.filter(e => e.firstTry);
    const allTimeAcc = ftLog.length > 0
      ? Math.round(ftLog.filter(e => e.result === 'correct').length / ftLog.length * 100)
      : 0;
    const isNewBest = streaks.best === wdBestStreak && wdBestStreak > (lastSess ? lastSess.streak : 0);
    const statsEl = document.getElementById('pb-wd-sum-stats');
    if (statsEl) {
      statsEl.innerHTML = [
        `<div class="pb-wd-sum-stat-item${isNewBest ? ' pb-wd-sum-stat-highlight' : ''}">
          <span>Best session streak</span><span>${streaks.best}${isNewBest ? ' 🏆' : ''}</span>
        </div>`,
        `<div class="pb-wd-sum-stat-item">
          <span>All-time accuracy</span><span>${allTimeAcc}%</span>
        </div>`,
        `<div class="pb-wd-sum-stat-item">
          <span>Sessions completed</span><span>${savedHist.length}</span>
        </div>`
      ].join('');
    }

    // Real moments note
    const realCount  = wdPositions.filter(p => p.source === 'real').length;
    const realNoteEl = document.getElementById('pb-wd-sum-real-note');
    if (realNoteEl) {
      realNoteEl.classList.toggle('hidden', realCount === 0);
      if (realCount > 0) {
        realNoteEl.textContent =
          `${realCount} of these ${realCount === 1 ? 'was a real moment' : 'were real moments'} from your past games.`;
      }
    }
  }

  // ── Session start ──────────────────────────────────────────────────────
  async function wdStartSession(mode) {
    const myId = ++wdSessionId;
    wdDrillMode         = mode;
    wdPositions         = [];
    wdCurrentIdx        = 0;
    wdSessionResults    = [];
    wdSessionFirstTry   = [];
    wdCurrentStreak     = 0;
    wdBestStreak        = (lsJSON('pb_weakness_streaks') || { best: 0 }).best;

    wdShowSub('drilling');

    const titleEl = document.getElementById('pb-wd-mode-title');
    if (titleEl) titleEl.textContent = mode === 'past_only' ? 'Drill past blunders' : 'Train your weaknesses';

    // Lazy canvas init
    if (!wdCanvasInited) {
      wdCanvas = document.getElementById('pb-wd-canvas');
      if (wdCanvas) {
        wdCtx = wdCanvas.getContext('2d');
        wdCanvas.addEventListener('click', function(e) {
          const rect = wdCanvas.getBoundingClientRect();
          const sq   = wdCanvasToSq(
            (e.clientX - rect.left) * (wdCanvas.width  / rect.width),
            (e.clientY - rect.top)  * (wdCanvas.height / rect.height)
          );
          if (sq) wdHandleClick(sq);
        });
        wdCanvasInited = true;
      }
    }

    if (!wdImgLoaded) await loadWDImg();

    // Show loading state in coach card
    const waitEl = document.getElementById('pb-wd-coach-waiting');
    if (waitEl) waitEl.textContent = 'Generating your session…';

    const positions = await wdBuildSessionPositions(mode, myId);
    if (myId !== wdSessionId) return; // navigated away

    if (!positions || positions.length === 0) {
      wdToast('No positions available. Analyze more games or try again.');
      wdShowSub('selection');
      return;
    }

    wdPositions = positions;
    wdUpdateDots();
    wdLoadPosition(0);
  }

  // ── DOMContentLoaded ───────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    wdInitEvalSF();

    // Observe when pb-view-weakness becomes visible
    const viewEl = document.getElementById('pb-view-weakness');
    if (viewEl) {
      const trigger = () => {
        if (!viewEl.classList.contains('hidden')) {
          wdShowSub('selection');
          wdInitSelection();
        }
      };
      new MutationObserver(trigger).observe(viewEl, { attributes: true, attributeFilter: ['class'] });
      trigger(); // handle direct URL load ?mode=weakness
    }

    // Exit drill → selection
    const exitLink = document.getElementById('pb-wd-back-to-select');
    if (exitLink) {
      exitLink.addEventListener('click', function(e) {
        e.preventDefault();
        wdSessionId++; // cancel any in-flight session
        wdShowSub('selection');
        wdInitSelection();
      });
    }

    // Sub-mode card: Train weaknesses
    const mixedCard = document.getElementById('pb-wd-card-mixed');
    if (mixedCard) {
      mixedCard.addEventListener('click', function() {
        wdStartSession('mixed');
      });
    }

    // Sub-mode card: Drill past blunders
    const pastCard = document.getElementById('pb-wd-card-past');
    if (pastCard) {
      pastCard.addEventListener('click', function() {
        if (pastCard.classList.contains('pb-wd-card-disabled')) return;
        wdStartSession('past_only');
      });
    }

    // Retry button
    const retryBtn = document.getElementById('pb-wd-btn-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', function() {
        const pos = wdPositions[wdCurrentIdx];
        if (!pos) return;
        try { wdChess = new Chess(pos.fen); } catch(_) { return; }
        wdBoardFrozen = false;
        wdSelSq       = null;
        wdLegDests    = [];
        wdLastFrom    = null;
        wdLastTo      = null;
        wdRender();
        const waitEl   = document.getElementById('pb-wd-coach-waiting');
        const resultEl = document.getElementById('pb-wd-coach-result');
        const msgEl    = document.getElementById('pb-wd-coach-msg');
        const btnsEl   = document.getElementById('pb-wd-coach-btns');
        if (waitEl)   { waitEl.textContent = 'Play your move to get feedback.'; waitEl.classList.remove('hidden'); }
        if (resultEl) resultEl.classList.add('hidden');
        if (msgEl)    msgEl.classList.add('hidden');
        if (btnsEl)   btnsEl.classList.add('hidden');
      });
    }

    // Next button
    const nextBtn = document.getElementById('pb-wd-btn-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', function() {
        const next = wdCurrentIdx + 1;
        if (next >= wdPositions.length) {
          wdShowSummaryScreen();
        } else {
          wdLoadPosition(next);
        }
      });
    }

    // Summary: Drill again
    const sumAgainBtn = document.getElementById('pb-wd-sum-again');
    if (sumAgainBtn) {
      sumAgainBtn.addEventListener('click', function() {
        wdStartSession(wdDrillMode || 'mixed');
      });
    }

    // Summary: Back to modes (goes to landing via routing)
    const sumBackBtn = document.getElementById('pb-wd-sum-back');
    if (sumBackBtn) {
      sumBackBtn.addEventListener('click', function() {
        wdSessionId++;
        wdShowSub('selection');
        wdInitSelection();
        // Trigger landing navigation via the existing routing mechanism
        const backLink = document.getElementById('pb-back-weakness');
        if (backLink) backLink.click();
      });
    }

  }); // end DOMContentLoaded

})();

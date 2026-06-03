(function () {
  'use strict';

  /* ── Constants ──────────────────────────────────────────────────────── */
  const RAILWAY    = 'https://chess-lab-production.up.railway.app';
  const MASTERS_EP = 'https://explorer.lichess.ovh/masters';
  const PLAYERS_EP = 'https://explorer.lichess.ovh/lichess';

  const LIGHT = window.BOARD_LIGHT || '#f0d9b5';
  const DARK  = window.BOARD_DARK  || '#b58863';
  const PX    = 420;
  const SQ    = PX / 8;

  const PIECE_URLS = {
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

  const SYM = {
    wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙',
    bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟'
  };

  const OPENINGS = [
    { name:'Caro-Kann Defense',     eco:'B10', ecoRange:'B10–B19', moves:['e4','c6'] },
    { name:"Queen's Gambit",        eco:'D06', ecoRange:'D06–D69', moves:['d4','d5','c4'] },
    { name:'Sicilian Defense',      eco:'B20', ecoRange:'B20–B99', moves:['e4','c5'] },
    { name:'French Defense',        eco:'C00', ecoRange:'C00–C19', moves:['e4','e6'] },
    { name:"King's Indian Defense", eco:'E60', ecoRange:'E60–E99', moves:['d4','Nf6','c4','g6'] },
    { name:'Ruy Lopez',             eco:'C60', ecoRange:'C60–C99', moves:['e4','e5','Nf3','Nc6','Bb5'] },
    { name:'Italian Game',          eco:'C50', ecoRange:'C50–C59', moves:['e4','e5','Nf3','Nc6','Bc4'] },
    { name:'English Opening',       eco:'A10', ecoRange:'A10–A39', moves:['c4'] },
    { name:'London System',         eco:'D02', ecoRange:'D02',     moves:['d4','d5','Nf3','Nf6','Bf4'] },
    { name:'Nimzo-Indian Defense',  eco:'E20', ecoRange:'E20–E59', moves:['d4','Nf6','c4','e6','Nc3','Bb4'] },
  ];

  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  /* ── State ──────────────────────────────────────────────────────────── */
  const pieceImages     = {};
  let historyFens       = [START_FEN];
  let historySans       = [];
  let historyFromTo     = [];
  let moveIdx           = 0;
  let flipped           = false;
  let sourceToggle      = 'masters';
  let practiceMode      = false;
  let practiceColor     = 'w';
  let selSq             = null;
  let legDests          = [];
  let currentOpening    = null;
  let lichessData       = null;
  let practiceMoveCount = 0;
  let practiceMainCount = 0;
  let practiceWaiting   = false;
  let _loadToken        = 0;

  /* ── Trainer state ──────────────────────────────────────────────────── */
  let trainerMode      = false;
  let trainerSetup     = { color: 'w', drillMode: 'pick' };
  let trainerLineTree  = null;
  let trainerLineList  = [];
  let trainerSession   = null;
  let trainerDrill     = null;
  let trainerWaiting   = false;
  let trainerHighlights = []; // [{ sq, style: 'amber'|'red-from'|'red-to' }]

  const TRAINER_LS_SCORES = 'csa_opening_scores';

  /* ── Canvas ─────────────────────────────────────────────────────────── */
  const canvas = document.getElementById('opening-canvas');
  const ctx    = canvas.getContext('2d');

  /* ── Piece images ───────────────────────────────────────────────────── */
  function loadPieceImages() {
    return Promise.all(
      Object.entries(PIECE_URLS).map(([k, url]) =>
        new Promise(resolve => {
          const img = new Image();
          img.onload  = () => { pieceImages[k] = img; resolve(); };
          img.onerror = () => resolve();
          img.src     = url;
        })
      )
    );
  }

  /* ── Position helpers ───────────────────────────────────────────────── */
  function currentFen()   { return historyFens[moveIdx]; }
  function currentChess() { return new Chess(historyFens[moveIdx]); }

  /* ── Coordinate helpers ─────────────────────────────────────────────── */
  function sqToCanvas(sq) {
    const file = sq.charCodeAt(0) - 97;
    const rank = parseInt(sq[1]) - 1;
    const col  = flipped ? 7 - file : file;
    const row  = flipped ? rank : 7 - rank;
    return { x: col * SQ, y: row * SQ };
  }

  function canvasToSq(cx, cy) {
    const col = Math.floor(cx / SQ);
    const row = Math.floor(cy / SQ);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    const file = flipped ? 7 - col : col;
    const rank = flipped ? row : 7 - row;
    return String.fromCharCode(97 + file) + (rank + 1);
  }

  /* Append promotion suffix when a pawn reaches the back rank */
  function buildUCI(fromSq, toSq) {
    const chess = currentChess();
    const piece = chess.get(fromSq);
    if (piece && piece.type === 'p' && (toSq[1] === '8' || toSq[1] === '1')) {
      return fromSq + toSq + 'q';
    }
    return fromSq + toSq;
  }

  /* ── Board rendering ────────────────────────────────────────────────── */
  function render() {
    const chess = currentChess();
    ctx.clearRect(0, 0, PX, PX);

    /* squares */
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? LIGHT : DARK;
        ctx.fillRect(col * SQ, row * SQ, SQ, SQ);
      }
    }

    /* last-move highlight */
    if (moveIdx > 0 && historyFromTo[moveIdx - 1]) {
      const { from, to } = historyFromTo[moveIdx - 1];
      [from, to].forEach(sq => {
        const { x, y } = sqToCanvas(sq);
        ctx.fillStyle = 'rgba(255,200,0,0.40)';
        ctx.fillRect(x, y, SQ, SQ);
      });
    }

    /* trainer highlights (hint / reveal) */
    trainerHighlights.forEach(({ sq, style }) => {
      const { x, y } = sqToCanvas(sq);
      if (style === 'amber')    ctx.fillStyle = 'rgba(224,153,82,0.55)';
      else if (style === 'red-from') ctx.fillStyle = 'rgba(224,82,82,0.45)';
      else if (style === 'red-to')   ctx.fillStyle = 'rgba(224,82,82,0.62)';
      ctx.fillRect(x, y, SQ, SQ);
    });

    /* selected square — shown in both free and practice mode */
    if (selSq) {
      const { x, y } = sqToCanvas(selSq);
      ctx.fillStyle = 'rgba(80,160,255,0.42)';
      ctx.fillRect(x, y, SQ, SQ);
    }

    /* legal-move dots — shown in both modes */
    legDests.forEach(sq => {
      const { x, y } = sqToCanvas(sq);
      const cx = x + SQ / 2, cy = y + SQ / 2;
      ctx.save();
      if (chess.get(sq)) {
        ctx.strokeStyle = 'rgba(0,0,0,0.30)';
        ctx.lineWidth   = SQ * 0.09;
        ctx.beginPath(); ctx.arc(cx, cy, SQ * 0.46, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath(); ctx.arc(cx, cy, SQ * 0.155, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    });

    /* pieces */
    chess.board().forEach((row, ri) => {
      row.forEach((p, ci) => {
        if (!p) return;
        const key  = p.color + p.type.toUpperCase();
        const col  = flipped ? 7 - ci : ci;
        const drow = flipped ? 7 - ri : ri;
        const x    = col * SQ;
        const y    = drow * SQ;
        if (pieceImages[key]) {
          ctx.drawImage(pieceImages[key], x, y, SQ, SQ);
        } else {
          const sym = SYM[key];
          if (!sym) return;
          const pcx = x + SQ / 2, pcy = y + SQ / 2;
          const fs  = Math.floor(SQ * 0.70);
          ctx.font = `${fs}px "Segoe UI Emoji","Apple Color Emoji",serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(0,0,0,0.28)';
          ctx.fillText(sym, pcx + 1.5, pcy + 1.5);
          ctx.fillStyle = p.color === 'w' ? '#fff' : '#1a1a1a';
          ctx.fillText(sym, pcx, pcy);
        }
      });
    });

    /* rank / file labels */
    const fs = Math.max(8, Math.floor(SQ * 0.17));
    ctx.font = `600 ${fs}px "Segoe UI",sans-serif`;
    for (let row = 0; row < 8; row++) {
      const rank = flipped ? row + 1 : 8 - row;
      ctx.fillStyle    = row % 2 === 0 ? DARK : LIGHT;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(rank), 2, row * SQ + 2);
    }
    for (let col = 0; col < 8; col++) {
      const file = String.fromCharCode(97 + (flipped ? 7 - col : col));
      ctx.fillStyle    = col % 2 !== 0 ? DARK : LIGHT;
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(file, (col + 1) * SQ - 2, PX - 2);
    }
  }

  /* ── UCI → SAN ──────────────────────────────────────────────────────── */
  function uciToSan(uci, chess) {
    try {
      const obj = { from: uci.slice(0, 2), to: uci.slice(2, 4) };
      if (uci[4]) obj.promotion = uci[4];
      const m = chess.move(obj);
      if (!m) return uci.slice(0, 4);
      chess.undo();
      return m.san;
    } catch (_) { return uci.slice(0, 4); }
  }

  /* ── Move history display ───────────────────────────────────────────── */
  function renderMoveHistory() {
    const el = document.getElementById('opening-move-history');
    if (!historySans.length) {
      el.innerHTML = '<span class="oh-empty">Starting position</span>';
      return;
    }
    let html = '';
    for (let i = 0; i < historySans.length; i++) {
      const active = (i + 1 === moveIdx) ? ' oh-active' : '';
      if (i % 2 === 0) html += `<span class="oh-num">${Math.floor(i / 2) + 1}.</span>`;
      html += `<span class="oh-san${active}" data-idx="${i + 1}">${historySans[i]}</span> `;
    }
    el.innerHTML = html;
    el.querySelector('.oh-active')?.scrollIntoView({ block: 'nearest' });
  }

  /* ── Win stats panel ────────────────────────────────────────────────── */
  function renderWinStats(data) {
    const el = document.getElementById('win-stats-panel');
    if (!data) { el.innerHTML = '<p class="ws-empty">No data available.</p>'; return; }
    const total = (data.white || 0) + (data.draws || 0) + (data.black || 0);
    if (!total) { el.innerHTML = '<p class="ws-empty">No games in database for this position.</p>'; return; }
    const wPct = (data.white / total * 100).toFixed(1);
    const dPct = (data.draws  / total * 100).toFixed(1);
    const bPct = (data.black  / total * 100).toFixed(1);
    const gStr = total > 999999 ? (total / 1e6).toFixed(1) + 'M'
               : total > 999    ? Math.round(total / 1000) + 'k'
               : String(total);
    const chess  = currentChess();
    const topSan = data.moves?.length ? uciToSan(data.moves[0].uci, chess) : '';
    el.innerHTML = `
      <div class="ws-bar">
        <div class="ws-w" style="width:${wPct}%">${parseFloat(wPct) >= 9 ? wPct + '%' : ''}</div>
        <div class="ws-d" style="width:${dPct}%">${parseFloat(dPct) >= 9 ? dPct + '%' : ''}</div>
        <div class="ws-b" style="width:${bPct}%">${parseFloat(bPct) >= 9 ? bPct + '%' : ''}</div>
      </div>
      <div class="ws-labels">
        <span class="ws-lw">White ${wPct}%</span>
        <span class="ws-ld">Draw ${dPct}%</span>
        <span class="ws-lb">Black ${bPct}%</span>
      </div>
      <div class="ws-meta">
        <span>${gStr} games</span>
        ${topSan ? `<span>Top: <strong>${topSan}</strong></span>` : ''}
      </div>`;
  }

  /* ── Opening status panel ───────────────────────────────────────────── */
  function renderOpeningStatus(data) {
    const el = document.getElementById('opening-status-body');
    if (!el) return;

    const moves = historySans.slice(0, moveIdx);

    /* Build move sequence string */
    let movesHtml = '';
    if (moves.length) {
      let seq = '';
      moves.forEach((san, i) => {
        if (i % 2 === 0) seq += `${Math.floor(i / 2) + 1}. `;
        seq += san + ' ';
      });
      movesHtml = `<div class="os-moves">${seq.trim()}</div>`;
    }

    /* In-book / out-of-book status */
    let statusHtml;
    if (!moves.length) {
      statusHtml = '<span class="os-neutral">Starting position</span>';
    } else if (data?.opening?.name || data?.moves?.length) {
      const name = data?.opening?.name || currentOpening?.name || '';
      if (name) {
        document.getElementById('opening-name-display').textContent = name;
        if (!currentOpening?.name) currentOpening = { ...(currentOpening || {}), name };
      }
      statusHtml = `<span class="os-inbook">In book${name ? ` — ${name}` : ''}</span>`;
    } else {
      statusHtml = '<span class="os-outbook">Out of book — you\'ve left the main lines</span>';
    }

    el.innerHTML = `<div class="os-status">${statusHtml}</div>${movesHtml}`;
  }

  /* ── Best moves panel ───────────────────────────────────────────────── */
  function renderBestMoves(data) {
    const el = document.getElementById('best-moves-panel');
    if (!el) return;

    const chess  = currentChess();
    const turnEl = document.getElementById('best-moves-turn');
    if (turnEl) turnEl.textContent = `for ${chess.turn() === 'w' ? 'White' : 'Black'}`;

    if (!data?.moves?.length) {
      el.innerHTML = '<div class="mt-empty">No moves in database for this position.</div>';
      return;
    }

    el.innerHTML = data.moves.slice(0, 3).map((m, i) => {
      const san   = uciToSan(m.uci, chess);
      const total = (m.white || 0) + (m.draws || 0) + (m.black || 0);
      if (!total) return '';
      const wPct = Math.round(m.white / total * 100);
      const dPct = Math.round(m.draws  / total * 100);
      const bPct = Math.round(m.black  / total * 100);
      const gStr = total > 999 ? Math.round(total / 1000) + 'k' : total;
      return `<div class="bm-row${i === 0 ? ' bm-top' : ''}">
        <span class="bm-rank${i === 0 ? ' bm-rank-top' : ''}">${i + 1}</span>
        <span class="bm-san">${san}</span>
        <div class="mt-bars" style="flex:1;min-width:0">
          <div class="mt-bar-inner">
            <div class="mt-bw" style="width:${wPct}%"></div>
            <div class="mt-bd" style="width:${dPct}%"></div>
            <div class="mt-bb" style="width:${bPct}%"></div>
          </div>
          <span class="mt-pcts">${wPct} / ${dPct} / ${bPct}</span>
        </div>
        <span class="mt-games">${gStr}</span>
      </div>`;
    }).join('');
  }

  /* ── Move tree ──────────────────────────────────────────────────────── */
  function renderMoveTree(data) {
    const el = document.getElementById('move-tree');
    if (!data?.moves?.length) {
      el.innerHTML = '<div class="mt-empty">No moves found for this position.</div>';
      return;
    }
    const chess = currentChess();
    el.innerHTML = data.moves.map(m => {
      const mTotal = (m.white || 0) + (m.draws || 0) + (m.black || 0);
      if (!mTotal) return '';
      const san  = uciToSan(m.uci, chess);
      const wPct = Math.round(m.white / mTotal * 100);
      const dPct = Math.round(m.draws  / mTotal * 100);
      const bPct = Math.round(m.black  / mTotal * 100);
      const gStr = mTotal > 999 ? Math.round(mTotal / 1000) + 'k' : mTotal;
      return `<div class="mt-row" data-uci="${m.uci}" data-san="${san}">
        <span class="mt-san">${san}</span>
        <div class="mt-bars">
          <div class="mt-bar-inner">
            <div class="mt-bw" style="width:${wPct}%"></div>
            <div class="mt-bd" style="width:${dPct}%"></div>
            <div class="mt-bb" style="width:${bPct}%"></div>
          </div>
          <span class="mt-pcts">${wPct} / ${dPct} / ${bPct}</span>
        </div>
        <span class="mt-games">${gStr}</span>
      </div>`;
    }).join('');

    el.querySelectorAll('.mt-row').forEach(row => {
      row.addEventListener('click', () => {
        if (practiceMode) return;
        playMove(row.dataset.uci, row.dataset.san);
      });
    });
  }

  /* ── Turn indicator ─────────────────────────────────────────────────── */
  function updateTurnIndicator() {
    const dot  = document.getElementById('turn-dot');
    const text = document.getElementById('turn-text');
    if (!dot || !text) return;
    const chess = currentChess();
    if (chess.game_over()) {
      dot.className    = 'turn-dot';
      text.textContent = chess.in_checkmate() ? 'Checkmate!' : 'Game over';
      return;
    }
    const turn = chess.turn();
    dot.className = `turn-dot ${turn === 'w' ? 'white' : 'black'}`;
    if (trainerMode) {
      if (trainerWaiting) {
        text.textContent = 'Computer playing…';
      } else if (!trainerDrill || trainerDrill.done) {
        text.textContent = `${turn === 'w' ? 'White' : 'Black'} to move`;
      } else {
        text.textContent = `Your turn — ${turn === 'w' ? 'White' : 'Black'} to move`;
      }
      return;
    }
    if (practiceMode) {
      text.textContent = turn === practiceColor
        ? `Your turn — ${turn === 'w' ? 'White' : 'Black'} to move`
        : 'Computer thinking…';
    } else {
      text.textContent = `${turn === 'w' ? 'White' : 'Black'} to move`;
    }
  }

  /* ── Lichess API ────────────────────────────────────────────────────── */
  async function fetchMasterMoves(fen) {
    try {
      const r = await fetch(`${MASTERS_EP}?fen=${encodeURIComponent(fen)}&moves=10`);
      return r.ok ? r.json() : null;
    } catch (_) { return null; }
  }

  async function fetchPlayerMoves(fen) {
    try {
      const r = await fetch(`${PLAYERS_EP}?fen=${encodeURIComponent(fen)}&speeds=rapid,classical&ratings=1500,1600,1700&moves=10`);
      return r.ok ? r.json() : null;
    } catch (_) { return null; }
  }

  /* ── Theory API ─────────────────────────────────────────────────────── */
  async function getTheoryExplanation(fen, moves, openingName) {
    const key = 'csa_theory_' + fen.replace(/\s+/g, '_').slice(0, 60);
    const cached = sessionStorage.getItem(key);
    if (cached) return cached;
    try {
      const r = await fetch(RAILWAY + '/api/theory', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fen, moves, openingName })
      });
      if (!r.ok) return null;
      const d = await r.json();
      if (d.explanation) { sessionStorage.setItem(key, d.explanation); return d.explanation; }
      return null;
    } catch (_) { return null; }
  }

  /* ── Load position data (Lichess + theory) ──────────────────────────── */
  async function loadPositionData() {
    const fen   = currentFen();
    const token = ++_loadToken;

    document.getElementById('move-tree').innerHTML        = '<div class="mt-loading"><span class="spinner"></span> Loading…</div>';
    document.getElementById('theory-text').innerHTML      = '<div class="theory-loading"><span class="spinner"></span> Loading explanation…</div>';
    document.getElementById('best-moves-panel').innerHTML = '<div class="mt-loading"><span class="spinner"></span> Loading…</div>';

    const data = sourceToggle === 'masters'
      ? await fetchMasterMoves(fen)
      : await fetchPlayerMoves(fen);
    if (token !== _loadToken) return;

    lichessData = data;
    renderMoveTree(data);
    renderWinStats(data);
    renderOpeningStatus(data);
    renderBestMoves(data);
    updateTurnIndicator();

    const openingName  = currentOpening?.name || 'Chess Opening';
    const explanation  = await getTheoryExplanation(fen, historySans.slice(0, moveIdx), openingName);
    if (token !== _loadToken) return;

    document.getElementById('theory-text').textContent =
      explanation || 'No theory explanation available for this position.';
  }

  /* ── Play a move ────────────────────────────────────────────────────── */
  function playMove(uci, san) {
    const from  = uci.slice(0, 2);
    const to    = uci.slice(2, 4);
    const promo = uci[4];
    const chess = currentChess();
    const obj   = { from, to };
    if (promo) obj.promotion = promo;
    const m = chess.move(obj);
    if (!m) return false;

    historyFens   = historyFens.slice(0, moveIdx + 1);
    historySans   = historySans.slice(0, moveIdx);
    historyFromTo = historyFromTo.slice(0, moveIdx);

    historyFens.push(chess.fen());
    historySans.push(san || m.san);
    historyFromTo.push({ from, to });
    moveIdx++;

    selSq = null; legDests = [];
    render();
    renderMoveHistory();
    loadPositionData();
    return true;
  }

  /* ── Play a move (trainer — no Lichess reload) ──────────────────────── */
  function playTrainerMove(uci, san) {
    const from  = uci.slice(0, 2);
    const to    = uci.slice(2, 4);
    const promo = uci[4];
    const chess = currentChess();
    const obj   = { from, to };
    if (promo) obj.promotion = promo;
    const m = chess.move(obj);
    if (!m) return false;
    historyFens   = historyFens.slice(0, moveIdx + 1);
    historySans   = historySans.slice(0, moveIdx);
    historyFromTo = historyFromTo.slice(0, moveIdx);
    historyFens.push(chess.fen());
    historySans.push(san || m.san);
    historyFromTo.push({ from, to });
    moveIdx++;
    selSq = null; legDests = [];
    render();
    renderMoveHistory();
    return true;
  }

  /* ── Navigation ─────────────────────────────────────────────────────── */
  function isDrillActive() { return trainerMode && trainerDrill && !trainerDrill.done; }

  function goBack() {
    if (isDrillActive()) return;
    if (moveIdx <= 0) return;
    moveIdx--;
    selSq = null; legDests = [];
    render(); renderMoveHistory(); updateTurnIndicator(); loadPositionData();
  }

  function goForward() {
    if (isDrillActive()) return;
    if (moveIdx >= historySans.length) return;
    moveIdx++;
    selSq = null; legDests = [];
    render(); renderMoveHistory(); updateTurnIndicator(); loadPositionData();
  }

  function goToMove(idx) {
    if (isDrillActive()) return;
    if (idx < 0 || idx > historySans.length) return;
    moveIdx = idx;
    selSq = null; legDests = [];
    render(); renderMoveHistory(); updateTurnIndicator(); loadPositionData();
  }

  /* ── Load opening ───────────────────────────────────────────────────── */
  function loadOpening(opening) {
    currentOpening = opening;
    const chess    = new Chess();
    const fens     = [chess.fen()];
    const sans     = [];
    const fromtos  = [];

    for (const san of opening.moves) {
      const m = chess.move(san);
      if (!m) break;
      fens.push(chess.fen());
      sans.push(m.san);
      fromtos.push({ from: m.from, to: m.to });
    }

    historyFens   = fens;
    historySans   = sans;
    historyFromTo = fromtos;
    moveIdx       = sans.length;
    selSq = null; legDests = [];

    exitPracticeMode();
    render();
    renderMoveHistory();
    updateTurnIndicator();
    loadPositionData();

    document.getElementById('opening-name-display').textContent = opening.name;
    document.getElementById('search-input').value               = opening.name;
    document.getElementById('search-dropdown').classList.add('hidden');

    /* If trainer mode is active, reload the line tree for the new opening */
    if (trainerMode) {
      trainerDrill   = null;
      trainerSession = null;
      clearTrainerHighlights();
      showTrainPanel('setup');
      trainerLoadLineTree(opening);
      document.getElementById('tr-current-line-display').innerHTML =
        '<span class="os-neutral">Waiting to start…</span>';
      document.getElementById('tr-theory-text').textContent =
        'Make a move to see the theory explanation.';
    }
  }

  /* ── Unified board interaction (free exploration + practice) ────────── */
  canvas.addEventListener('mousedown', e => {
    if (practiceMode && practiceWaiting) return;
    const rect = canvas.getBoundingClientRect();
    const x    = (e.clientX - rect.left) * (PX / rect.width);
    const y    = (e.clientY - rect.top)  * (PX / rect.height);
    const sq   = canvasToSq(x, y);
    if (window.CHESS_LAB_DEBUG) console.log('[Openings] Canvas clicked at square:', sq, '(canvas px:', Math.round(x), Math.round(y), ')');
    if (sq) handleBoardClick(sq);
  });

  function handleBoardClick(sq) {
    /* Route to trainer when trainer mode is active */
    if (trainerMode) { handleTrainerClick(sq); return; }

    const chess = currentChess();
    if (chess.game_over()) { if (window.CHESS_LAB_DEBUG) console.log('[Openings] Ignoring click — game over'); return; }
    const turn = chess.turn();

    /* In practice mode, block interaction when it's the computer's turn */
    if (practiceMode && turn !== practiceColor) {
      if (window.CHESS_LAB_DEBUG) console.log('[Openings] Ignoring click — not your turn (practice mode)');
      return;
    }

    if (selSq) {
      /* ── Destination clicked ── */
      if (legDests.includes(sq)) {
        const fromSq = selSq;
        selSq = null; legDests = [];

        if (practiceMode) {
          /* Snapshot Lichess data for this position (before the move) for feedback */
          const posData   = lichessData;
          const tempChess = currentChess();
          const m         = tempChess.move({ from: fromSq, to: sq, promotion: 'q' });
          if (!m) { if (window.CHESS_LAB_DEBUG) console.log('[Openings] Move rejected by chess.js:', fromSq, '->', sq); render(); return; }

          if (window.CHESS_LAB_DEBUG) console.log('[Openings] Move executed:', m.san, '(', fromSq + sq + (m.promotion || ''), ')');

          practiceMoveCount++;
          if (posData?.moves?.length) {
            const movedUci = fromSq + sq;
            const isTop = posData.moves[0].uci.slice(0, 4) === movedUci;
            const inDb  = posData.moves.some(mv => mv.uci.slice(0, 4) === movedUci);
            if (isTop) {
              practiceMainCount++;
              showPracticeToast('✓ Main line!', 'success');
            } else if (inDb) {
              const topSan = uciToSan(posData.moves[0].uci, currentChess());
              showPracticeToast(`Good move — main line is ${topSan}`, 'warning');
            } else {
              const topSan = posData.moves.length ? uciToSan(posData.moves[0].uci, currentChess()) : '?';
              showPracticeToast(`Out of book — main line was ${topSan}`, 'error');
            }
          } else {
            practiceMainCount++;
          }

          updatePracticeScore();
          playMove(fromSq + sq + (m.promotion || ''), m.san);
          practiceWaiting = true;
          updatePracticeStatus();
          updateTurnIndicator();

          const c = currentChess();
          if (!c.game_over() && c.turn() !== practiceColor) {
            setTimeout(async () => {
              await playComputerMove();
              practiceWaiting = false;
              updatePracticeStatus();
              updateTurnIndicator();
            }, 800);
          } else {
            practiceWaiting = false;
            updatePracticeStatus();
            updateTurnIndicator();
          }
        } else {
          /* Free exploration — just play */
          const uci    = buildUCI(fromSq, sq);
          const result = playMove(uci, null);
          if (window.CHESS_LAB_DEBUG) console.log('[Openings] Move executed:', uci, '| success:', result);
        }
        return;
      }

      /* Clicked a different piece of the moveable color — re-select */
      const p      = chess.get(sq);
      const canSel = practiceMode ? p?.color === practiceColor : p?.color === turn;
      if (p && canSel) {
        selSq    = sq;
        legDests = chess.moves({ square: sq, verbose: true }).map(mv => mv.to);
        if (window.CHESS_LAB_DEBUG) console.log('[Openings] Selected piece:', sq, p, '| Legal moves:', legDests);
        render();
        return;
      }
      selSq = null; legDests = []; render();
    } else {
      /* ── First click — select a piece ── */
      const p      = chess.get(sq);
      const canSel = practiceMode ? p?.color === practiceColor : p?.color === turn;
      if (window.CHESS_LAB_DEBUG) console.log('[Openings] Selected piece:', sq, p, '| turn:', turn, '| canSel:', canSel);
      if (p && canSel) {
        selSq    = sq;
        legDests = chess.moves({ square: sq, verbose: true }).map(mv => mv.to);
        if (window.CHESS_LAB_DEBUG) console.log('[Openings] Legal moves:', legDests);
        render();
      }
    }
  }

  /* ── Computer move (practice) ───────────────────────────────────────── */
  async function playComputerMove() {
    const chess = currentChess();
    if (chess.game_over() || chess.turn() === practiceColor) return;

    const data = sourceToggle === 'masters'
      ? await fetchMasterMoves(currentFen())
      : await fetchPlayerMoves(currentFen());

    let uci;
    if (data?.moves?.length) {
      uci = data.moves[0].uci;
    } else {
      const moves = chess.moves({ verbose: true });
      if (!moves.length) return;
      uci = moves[0].from + moves[0].to;
    }

    const san = uciToSan(uci, currentChess());
    playMove(uci, san);
  }

  /* ── Practice mode ──────────────────────────────────────────────────── */
  function enterPracticeMode(color) {
    practiceMode      = true;
    practiceColor     = color;
    practiceMoveCount = 0;
    practiceMainCount = 0;
    practiceWaiting   = false;
    selSq = null; legDests = [];

    document.getElementById('practice-btn').textContent = 'Exit Practice';
    document.getElementById('practice-btn').classList.add('prac-active');
    document.getElementById('board-wrap').classList.add('practice-glow');
    document.getElementById('practice-status').classList.remove('hidden');
    document.getElementById('practice-color-toggle').classList.remove('hidden');
    document.getElementById('practice-score').classList.remove('hidden');

    updatePracticeStatus();
    updatePracticeScore();
    updateTurnIndicator();

    const chess = currentChess();
    if (chess.turn() !== practiceColor) {
      practiceWaiting = true;
      setTimeout(() => { practiceWaiting = false; playComputerMove(); }, 800);
    }
    render();
  }

  function exitPracticeMode() {
    practiceMode = false;
    selSq = null; legDests = [];
    const btn = document.getElementById('practice-btn');
    if (btn) { btn.textContent = 'Practice This Line'; btn.classList.remove('prac-active'); }
    document.getElementById('board-wrap')?.classList.remove('practice-glow');
    document.getElementById('practice-status')?.classList.add('hidden');
    document.getElementById('practice-color-toggle')?.classList.add('hidden');
    document.getElementById('practice-score')?.classList.add('hidden');
    updateTurnIndicator();
  }

  function updatePracticeStatus() {
    const el = document.getElementById('practice-status-text');
    if (!el) return;
    const chess = currentChess();
    if (chess.game_over()) {
      el.textContent = 'Game over!'; el.className = 'ob-ps-text ps-done';
    } else if (chess.turn() === practiceColor) {
      el.textContent = `Your turn — play as ${practiceColor === 'w' ? 'White' : 'Black'}`;
      el.className   = 'ob-ps-text ps-yours';
    } else {
      el.textContent = 'Computer is thinking…'; el.className = 'ob-ps-text ps-thinking';
    }
  }

  function updatePracticeScore() {
    const el = document.getElementById('practice-score-text');
    if (el) el.textContent = `Main line: ${practiceMainCount} / ${practiceMoveCount} moves`;
  }

  /* ── Practice toast ─────────────────────────────────────────────────── */
  function showPracticeToast(msg, type) {
    const el = document.getElementById('practice-toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = `ob-toast pt-${type} show`;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3500);
  }

  /* ── Trouble spots ──────────────────────────────────────────────────── */
  function renderTroubleSpots() {
    const el = document.getElementById('trouble-spots');
    let games = [];
    try { if (typeof Storage !== 'undefined') games = Storage.loadAllGames(); } catch (_) {}

    if (!games.length) {
      el.innerHTML = '<p class="ts-empty">Analyze some games to see your trouble spots.</p>';
      return;
    }

    const stats = {};
    games.forEach(g => {
      const name = g.analysis?.opening?.name;
      if (!name) return;
      if (!stats[name]) stats[name] = { name, w: 0, d: 0, l: 0, accs: [] };
      const s       = stats[name];
      const result  = g.metadata?.result || '*';
      const isWhite = (g.playerColor || 'white') === 'white';
      if      (result === '1-0')     isWhite ? s.w++ : s.l++;
      else if (result === '0-1')     isWhite ? s.l++ : s.w++;
      else if (result === '1/2-1/2') s.d++;
      const acc = g.analysis?.summary?.accuracy;
      if (typeof acc === 'number') s.accs.push(acc);
    });

    const trouble = Object.values(stats).filter(s => {
      const tot = s.w + s.d + s.l;
      if (!tot) return false;
      const wr  = s.w / tot;
      const avg = s.accs.length ? s.accs.reduce((a, b) => a + b, 0) / s.accs.length : null;
      return wr < 0.40 || (avg !== null && avg < 70);
    }).slice(0, 5);

    if (!trouble.length) {
      el.innerHTML = '<p class="ts-empty">No trouble spots detected — keep it up!</p>';
      return;
    }

    el.innerHTML = trouble.map(s => {
      const tot = s.w + s.d + s.l;
      const wr  = Math.round(s.w / tot * 100);
      const avg = s.accs.length
        ? Math.round(s.accs.reduce((a, b) => a + b, 0) / s.accs.length)
        : null;
      return `<div class="ts-card" data-name="${s.name}">
        <div class="ts-name">${s.name}</div>
        <div class="ts-record">${s.w}W / ${s.d}D / ${s.l}L &nbsp;·&nbsp; ${wr}% wins</div>
        ${avg !== null ? `<div class="ts-acc">Avg accuracy: ${avg}%</div>` : ''}
      </div>`;
    }).join('');

    el.querySelectorAll('.ts-card').forEach(card => {
      card.addEventListener('click', () => {
        const name  = card.dataset.name;
        const match = OPENINGS.find(o =>
          name.toLowerCase().includes(o.name.toLowerCase().split(' ')[0].toLowerCase()) ||
          o.name.toLowerCase().includes(name.toLowerCase().split(' ')[0].toLowerCase())
        );
        if (match) loadOpening(match);
      });
    });
  }

  /* ── Search ─────────────────────────────────────────────────────────── */
  function setupSearch() {
    const input = document.getElementById('search-input');
    const drop  = document.getElementById('search-dropdown');

    input.addEventListener('input', () => {
      const q = input.value.toLowerCase().trim();
      if (!q) { drop.classList.add('hidden'); return; }
      const hits = OPENINGS.filter(o =>
        o.name.toLowerCase().includes(q) ||
        o.eco.toLowerCase().includes(q) ||
        o.ecoRange.toLowerCase().includes(q)
      );
      if (!hits.length) { drop.classList.add('hidden'); return; }
      drop.innerHTML = hits.map(o => {
        const i = OPENINGS.indexOf(o);
        return `<div class="sd-item" data-i="${i}">
          <span class="sd-name">${o.name}</span>
          <span class="sd-eco">${o.ecoRange}</span>
        </div>`;
      }).join('');
      drop.classList.remove('hidden');
      drop.querySelectorAll('.sd-item').forEach(item => {
        item.addEventListener('click', () => loadOpening(OPENINGS[parseInt(item.dataset.i, 10)]));
      });
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') drop.classList.add('hidden');
      if (e.key === 'Enter') { const f = drop.querySelector('.sd-item'); if (f) f.click(); }
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('#search-wrap')) drop.classList.add('hidden');
    });
  }

  /* ── Navigation buttons ─────────────────────────────────────────────── */
  function setupNavButtons() {
    document.getElementById('nav-back').addEventListener('click', goBack);
    document.getElementById('nav-forward').addEventListener('click', goForward);
    document.getElementById('nav-undo').addEventListener('click', goBack);
    document.getElementById('nav-reset').addEventListener('click', () => {
      if (currentOpening) {
        loadOpening(currentOpening);
      } else {
        historyFens = [START_FEN]; historySans = []; historyFromTo = []; moveIdx = 0;
        selSq = null; legDests = [];
        exitPracticeMode();
        render(); renderMoveHistory(); updateTurnIndicator(); loadPositionData();
        document.getElementById('opening-name-display').textContent = '';
      }
    });
    document.getElementById('nav-flip').addEventListener('click', () => { flipped = !flipped; render(); });

    document.getElementById('opening-move-history').addEventListener('click', e => {
      const span = e.target.closest('.oh-san');
      if (span) goToMove(parseInt(span.dataset.idx, 10));
    });
  }

  /* ── Source toggle ──────────────────────────────────────────────────── */
  function setupSourceToggle() {
    const mBtn = document.getElementById('tog-masters');
    const pBtn = document.getElementById('tog-players');
    mBtn.addEventListener('click', () => {
      if (sourceToggle === 'masters') return;
      sourceToggle = 'masters';
      mBtn.classList.add('active'); pBtn.classList.remove('active');
      loadPositionData();
    });
    pBtn.addEventListener('click', () => {
      if (sourceToggle === 'players') return;
      sourceToggle = 'players';
      pBtn.classList.add('active'); mBtn.classList.remove('active');
      loadPositionData();
    });
  }

  /* ── Export to practice board ───────────────────────────────────────── */
  function exportToPracticeBoard() {
    sessionStorage.setItem('csa_opening_line', JSON.stringify({
      moves:       historySans.slice(0, moveIdx),
      fen:         currentFen(),
      openingName: currentOpening?.name || 'Custom Line'
    }));
    window.location.href = 'practice.html';
  }

  /* ── Practice panel buttons ─────────────────────────────────────────── */
  function setupPracticeButtons() {
    document.getElementById('practice-btn').addEventListener('click', () => {
      if (practiceMode) { exitPracticeMode(); render(); }
      else {
        const color = document.getElementById('pct-black').classList.contains('active') ? 'b' : 'w';
        enterPracticeMode(color);
      }
    });

    document.getElementById('export-btn').addEventListener('click', exportToPracticeBoard);

    document.getElementById('pct-white').addEventListener('click', function () {
      practiceColor = 'w';
      this.classList.add('active');
      document.getElementById('pct-black').classList.remove('active');
      if (practiceMode) {
        const chess = currentChess();
        if (chess.turn() !== practiceColor && !chess.game_over()) {
          practiceWaiting = true;
          setTimeout(() => { practiceWaiting = false; playComputerMove(); }, 600);
        }
        updatePracticeStatus();
        updateTurnIndicator();
      }
    });

    document.getElementById('pct-black').addEventListener('click', function () {
      practiceColor = 'b';
      this.classList.add('active');
      document.getElementById('pct-white').classList.remove('active');
      if (practiceMode) {
        const chess = currentChess();
        if (chess.turn() !== practiceColor && !chess.game_over()) {
          practiceWaiting = true;
          setTimeout(() => { practiceWaiting = false; playComputerMove(); }, 600);
        }
        updatePracticeStatus();
        updateTurnIndicator();
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     TRAINER
     ═══════════════════════════════════════════════════════════════════════ */

  /* ── localStorage helpers ───────────────────────────────────────────── */
  function trainerLoadScores() {
    try { return JSON.parse(localStorage.getItem(TRAINER_LS_SCORES) || '{}'); }
    catch (_) { return {}; }
  }

  function trainerSaveScore(key, correct, eco) {
    const scores = trainerLoadScores();
    if (!scores[key]) scores[key] = { correct: 0, wrong: 0 };
    if (correct) scores[key].correct++; else scores[key].wrong++;
    if (eco)     scores[key].eco = eco;
    scores[key].lastDrilled = Date.now();
    localStorage.setItem(TRAINER_LS_SCORES, JSON.stringify(scores));
  }

  /* ── Panel visibility ───────────────────────────────────────────────── */
  function showTrainPanel(which) {
    document.getElementById('train-setup-panel').classList.toggle('hidden',   which !== 'setup');
    document.getElementById('train-drill-panel').classList.toggle('hidden',   which !== 'drill');
    document.getElementById('train-summary-panel').classList.toggle('hidden', which !== 'summary');
  }

  /* ── Feedback helper ────────────────────────────────────────────────── */
  function setTrainerFeedback(type, msg) {
    const fb  = document.getElementById('tr-feedback');
    const txt = document.getElementById('tr-feedback-text');
    if (!fb || !txt) return;
    fb.className     = `tr-feedback tr-fb-${type}`;
    txt.textContent  = msg;
  }

  /* ── Trainer highlight helpers ──────────────────────────────────────── */
  function clearTrainerHighlights() { trainerHighlights = []; }

  /* ── Mode enter / exit ──────────────────────────────────────────────── */
  function enterTrainerMode() {
    trainerMode = true;
    practiceMode = false;
    selSq = null; legDests = [];
    document.getElementById('explore-left-content').classList.add('hidden');
    document.getElementById('train-left-content').classList.remove('hidden');
    document.getElementById('train-right-panel').classList.remove('hidden');
    document.getElementById('mode-explore').classList.remove('active');
    document.getElementById('mode-train').classList.add('active');
    showTrainPanel('setup');
    if (currentOpening) trainerLoadLineTree(currentOpening);
    render();
    updateTurnIndicator();
  }

  function exitTrainerMode() {
    trainerMode    = false;
    trainerDrill   = null;
    trainerSession = null;
    trainerWaiting = false;
    clearTrainerHighlights();
    selSq = null; legDests = [];
    document.getElementById('explore-left-content').classList.remove('hidden');
    document.getElementById('train-left-content').classList.add('hidden');
    document.getElementById('train-right-panel').classList.add('hidden');
    document.getElementById('mode-explore').classList.add('active');
    document.getElementById('mode-train').classList.remove('active');
    if (currentOpening) loadOpening(currentOpening);
    else {
      historyFens = [START_FEN]; historySans = []; historyFromTo = []; moveIdx = 0;
      render(); renderMoveHistory(); updateTurnIndicator(); loadPositionData();
    }
  }

  /* ── Build line tree from Lichess ───────────────────────────────────── */
  async function trainerLoadLineTree(opening) {
    const chess = new Chess();
    for (const san of opening.moves) { if (!chess.move(san)) break; }
    const startFen = chess.fen();
    const eco      = opening.eco || '';

    document.getElementById('tr-line-select').innerHTML = '<option>Loading lines…</option>';
    document.getElementById('tr-opening-name').textContent = opening.name;

    trainerLineTree = await trainerBuildNode(startFen, 0, new Set());
    trainerLineList = trainerFlattenTree(trainerLineTree, opening.name, eco);

    const sel = document.getElementById('tr-line-select');
    if (trainerLineList.length) {
      sel.innerHTML = trainerLineList.map((l, i) =>
        `<option value="${i}">${l.displayName}</option>`
      ).join('');
    } else {
      sel.innerHTML = '<option value="">No lines found — try a different opening</option>';
    }

    trainerRenderLinesTree();
  }

  async function trainerBuildNode(fen, depth, seen) {
    const MAX_DEPTH  = 4;
    const MAX_NODES  = 50;
    if (depth >= MAX_DEPTH || seen.size >= MAX_NODES) return { fen, moves: [] };
    if (seen.has(fen)) return { fen, moves: [] };
    seen.add(fen);

    const data = sourceToggle === 'masters'
      ? await fetchMasterMoves(fen)
      : await fetchPlayerMoves(fen);

    if (!data?.moves?.length) return { fen, moves: [] };

    const top = data.moves
      .filter(m => (m.white || 0) + (m.draws || 0) + (m.black || 0) > 0)
      .slice(0, 3);

    const results = [];
    for (const m of top) {
      const c   = new Chess(fen);
      const obj = { from: m.uci.slice(0, 2), to: m.uci.slice(2, 4) };
      if (m.uci[4]) obj.promotion = m.uci[4];
      const moved = c.move(obj);
      if (!moved) continue;
      await new Promise(r => setTimeout(r, 60)); // light rate-limit
      const child = await trainerBuildNode(c.fen(), depth + 1, seen);
      results.push({ uci: m.uci, san: moved.san, node: child });
    }
    return { fen, moves: results };
  }

  function trainerFlattenTree(root, openingName, eco) {
    const lines = [];
    function walk(node, path) {
      if (!node.moves.length) {
        if (path.length > 0) {
          const sanStr  = path.map(m => m.san).join(' ');
          const rawKey  = (openingName + '_' + sanStr).toLowerCase()
                            .replace(/[^a-z0-9]+/g, '-');
          lines.push({
            key:         rawKey,
            moves:       path.slice(),
            displayName: `${openingName}: ${sanStr}`,
            eco
          });
        }
        return;
      }
      for (const mv of node.moves) {
        walk(mv.node, path.concat({ uci: mv.uci, san: mv.san }));
      }
    }
    walk(root, []);
    return lines;
  }

  /* ── Lines tree in right panel ──────────────────────────────────────── */
  function trainerRenderLinesTree() {
    const el = document.getElementById('tr-lines-tree');
    if (!trainerLineList.length) { el.textContent = 'No lines loaded.'; return; }
    el.innerHTML = trainerLineList.map((l, i) =>
      `<div data-tr-line="${i}" style="cursor:pointer;padding:2px 0;border-bottom:1px solid var(--border)">${l.displayName}</div>`
    ).join('');
  }

  /* ── Session start ──────────────────────────────────────────────────── */
  function trainerStartSession() {
    if (!currentOpening) {
      showPracticeToast('Select an opening first!', 'warning'); return;
    }
    let lines = trainerLineList.slice();
    if (!lines.length) {
      showPracticeToast('No lines found — try a different opening.', 'warning'); return;
    }

    const mode = trainerSetup.drillMode;
    if (mode === 'shuffle') {
      for (let i = lines.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lines[i], lines[j]] = [lines[j], lines[i]];
      }
    } else if (mode === 'pick') {
      const idx = parseInt(document.getElementById('tr-line-select').value, 10);
      if (!isNaN(idx) && lines[idx]) lines = [lines[idx]];
    } else if (mode === 'weak') {
      const scores = trainerLoadScores();
      lines.sort((a, b) => {
        const sa = scores[a.key] || { correct: 0, wrong: 0 };
        const sb = scores[b.key] || { correct: 0, wrong: 0 };
        return (sb.wrong - sb.correct) - (sa.wrong - sa.correct);
      });
    }

    trainerSession = { lines, idx: 0, correct: 0, total: 0 };
    showTrainPanel('drill');
    trainerDrillLine();
  }

  /* ── Drill a single line ────────────────────────────────────────────── */
  function trainerDrillLine() {
    if (!trainerSession || trainerSession.idx >= trainerSession.lines.length) {
      trainerShowSummary(); return;
    }

    const line  = trainerSession.lines[trainerSession.idx];
    const total = trainerSession.lines.length;
    const cur   = trainerSession.idx + 1;

    document.getElementById('tr-line-name').textContent = line.displayName;
    document.getElementById('tr-progress').textContent  = `Line ${cur} of ${total}`;
    setTrainerFeedback('idle', 'Make your move');
    document.getElementById('tr-next-btn').classList.add('hidden');
    document.getElementById('tr-hint-btn').disabled   = false;
    document.getElementById('tr-reveal-btn').disabled = false;

    document.getElementById('tr-current-line-display').innerHTML =
      `<div class="os-status"><span class="os-inbook">${line.displayName}</span></div>`;
    document.getElementById('tr-theory-text').textContent = 'Make your move to see the theory.';

    trainerDrill = {
      line,
      moveIdx:    0,
      attempts:   0,
      done:       false,
      hintShown:  false,
      openingEco: line.eco || currentOpening?.eco || ''
    };
    clearTrainerHighlights();

    /* Reset board to opening start position */
    const oc = new Chess();
    for (const san of currentOpening.moves) { if (!oc.move(san)) break; }
    historyFens   = [oc.fen()];
    historySans   = [];
    historyFromTo = [];
    moveIdx       = 0;
    selSq = null; legDests = [];
    render();
    renderMoveHistory();
    updateTurnIndicator();

    trainerWaiting = false;
    trainerAdvanceComputer();
  }

  /* ── Computer auto-plays its moves in the line ──────────────────────── */
  async function trainerAdvanceComputer() {
    if (!trainerDrill || trainerDrill.done) return;
    if (trainerSetup.color === 'both') {
      setTrainerFeedback('idle', 'Your turn — find the next move!');
      updateTurnIndicator();
      return;
    }

    const line      = trainerDrill.line;
    const userColor = trainerSetup.color;

    while (trainerDrill.moveIdx < line.moves.length) {
      const turn = currentChess().turn();
      if (turn === userColor) break;

      trainerWaiting = true;
      updateTurnIndicator();
      render();
      await new Promise(r => setTimeout(r, 600));

      if (!trainerDrill || trainerDrill.done) return; // guard against session end
      const mv = line.moves[trainerDrill.moveIdx];
      playTrainerMove(mv.uci, mv.san);
      trainerDrill.moveIdx++;
    }

    trainerWaiting = false;

    if (trainerDrill.moveIdx >= line.moves.length) {
      trainerLineDone(); return;
    }

    setTrainerFeedback('idle', 'Your turn — find the best move!');
    updateTurnIndicator();
    render();
  }

  /* ── Handle a click on the board in trainer mode ────────────────────── */
  function handleTrainerClick(sq) {
    if (!trainerDrill || trainerDrill.done || trainerWaiting) return;
    if (trainerDrill.moveIdx >= trainerDrill.line.moves.length) return;

    const chess     = currentChess();
    const turn      = chess.turn();
    const userColor = trainerSetup.color;
    const canPlay   = userColor === 'both' ? true : turn === userColor;
    if (!canPlay) return;

    if (selSq) {
      if (legDests.includes(sq)) {
        const fromSq       = selSq;
        selSq = null; legDests = [];

        const correctMove = trainerDrill.line.moves[trainerDrill.moveIdx];
        const userUci4    = fromSq + sq;
        const correctUci4 = correctMove.uci.slice(0, 4);

        if (userUci4 === correctUci4) {
          /* ── CORRECT ── */
          clearTrainerHighlights();
          playTrainerMove(correctMove.uci, correctMove.san);
          trainerDrill.moveIdx++;
          trainerDrill.attempts  = 0;
          trainerDrill.hintShown = false;

          trainerSaveScore(trainerDrill.line.key, true, trainerDrill.openingEco);
          if (trainerSession) { trainerSession.correct++; trainerSession.total++; }

          setTrainerFeedback('correct', 'Correct!');
          trainerFetchTheory(currentFen(), historySans.slice(0, moveIdx), currentOpening?.name);

          if (trainerDrill.moveIdx >= trainerDrill.line.moves.length) {
            setTimeout(() => trainerLineDone(), 800);
          } else {
            setTimeout(() => trainerAdvanceComputer(), 800);
          }
        } else {
          /* ── WRONG ── */
          trainerDrill.attempts++;

          if (trainerDrill.attempts === 1) {
            /* First attempt: highlight correct destination in amber */
            clearTrainerHighlights();
            trainerHighlights.push({ sq: correctUci4.slice(2, 4), style: 'amber' });
            setTrainerFeedback('warn', 'Not quite — try again. Think about what that square controls.');
          } else {
            /* Second attempt: reveal piece + square, show answer */
            trainerSaveScore(trainerDrill.line.key, false, trainerDrill.openingEco);
            if (trainerSession) trainerSession.total++;
            clearTrainerHighlights();
            trainerHighlights.push({ sq: correctUci4.slice(0, 2), style: 'red-from' });
            trainerHighlights.push({ sq: correctUci4.slice(2, 4), style: 'red-to'   });
            setTrainerFeedback('error', `The correct move was ${correctMove.san}`);
            document.getElementById('tr-next-btn').classList.remove('hidden');
            document.getElementById('tr-hint-btn').disabled   = true;
            document.getElementById('tr-reveal-btn').disabled = true;
            trainerFetchTheory(currentFen(), historySans.slice(0, moveIdx), currentOpening?.name);
          }
          render();
        }
        return;
      }

      /* Clicked a different own piece — re-select */
      const p = chess.get(sq);
      const canSel = userColor === 'both' ? p?.color === turn : p?.color === userColor;
      if (p && canSel) {
        selSq    = sq;
        legDests = chess.moves({ square: sq, verbose: true }).map(mv => mv.to);
        render(); return;
      }
      selSq = null; legDests = []; render();
    } else {
      const p = chess.get(sq);
      const canSel = userColor === 'both' ? p?.color === turn : p?.color === userColor;
      if (p && canSel) {
        selSq    = sq;
        legDests = chess.moves({ square: sq, verbose: true }).map(mv => mv.to);
        render();
      }
    }
  }

  /* ── Line done (all moves played) ──────────────────────────────────── */
  function trainerLineDone() {
    if (!trainerDrill) return;
    trainerDrill.done = true;
    selSq = null; legDests = [];
    clearTrainerHighlights();
    setTrainerFeedback('correct', 'Line complete! Well done!');
    document.getElementById('tr-next-btn').classList.remove('hidden');
    render();
    updateTurnIndicator();
  }

  /* ── Hint button ────────────────────────────────────────────────────── */
  function trainerShowHint() {
    if (!trainerDrill || trainerDrill.done) return;
    const mv = trainerDrill.line.moves[trainerDrill.moveIdx];
    clearTrainerHighlights();
    trainerHighlights.push({ sq: mv.uci.slice(2, 4), style: 'amber' });
    trainerDrill.hintShown = true;
    setTrainerFeedback('warn', 'Hint: try moving a piece to the highlighted square.');
    render();
  }

  /* ── Reveal answer button ───────────────────────────────────────────── */
  function trainerRevealAnswer() {
    if (!trainerDrill || trainerDrill.done) return;
    const mv = trainerDrill.line.moves[trainerDrill.moveIdx];
    trainerSaveScore(trainerDrill.line.key, false, trainerDrill.openingEco);
    if (trainerSession) trainerSession.total++;
    clearTrainerHighlights();
    trainerHighlights.push({ sq: mv.uci.slice(0, 2), style: 'red-from' });
    trainerHighlights.push({ sq: mv.uci.slice(2, 4), style: 'red-to'   });
    setTrainerFeedback('error', `The correct move is ${mv.san}`);
    document.getElementById('tr-next-btn').classList.remove('hidden');
    document.getElementById('tr-hint-btn').disabled   = true;
    document.getElementById('tr-reveal-btn').disabled = true;
    trainerFetchTheory(currentFen(), historySans.slice(0, moveIdx), currentOpening?.name);
    render();
  }

  /* ── Theory fetch for trainer ───────────────────────────────────────── */
  async function trainerFetchTheory(fen, moves, openingName) {
    const el = document.getElementById('tr-theory-text');
    if (!el) return;
    el.innerHTML = '<div class="theory-loading"><span class="spinner"></span> Loading explanation…</div>';
    const text = await getTheoryExplanation(fen, moves, openingName || 'Chess Opening');
    el.textContent = text || 'No theory explanation available for this position.';
  }

  /* ── Session summary ────────────────────────────────────────────────── */
  function trainerShowSummary() {
    showTrainPanel('summary');
    if (!trainerSession) return;

    const { correct, total, lines } = trainerSession;
    const pct    = total > 0 ? Math.round(correct / total * 100) : 0;
    const scores = trainerLoadScores();
    let mastered = 0, needsWork = 0;
    lines.forEach(l => {
      const s = scores[l.key];
      if (!s) return;
      if (s.correct > 0 && s.wrong === 0) mastered++;
      else if (s.wrong > 0) needsWork++;
    });

    document.getElementById('tr-summary-pct').textContent = `${pct}%`;
    document.getElementById('tr-summary-detail').innerHTML =
      `${correct} of ${total} moves correct<br>${mastered} lines mastered · ${needsWork} need work`;
  }

  /* ── Wire up trainer buttons ────────────────────────────────────────── */
  function setupTrainer() {
    /* Mode toggle */
    document.getElementById('mode-explore').addEventListener('click', () => {
      if (!trainerMode) return;
      exitTrainerMode();
    });
    document.getElementById('mode-train').addEventListener('click', () => {
      if (trainerMode) return;
      enterTrainerMode();
    });

    /* Side selector */
    ['tr-white', 'tr-black', 'tr-both'].forEach(id => {
      document.getElementById(id).addEventListener('click', function () {
        ['tr-white', 'tr-black', 'tr-both'].forEach(i =>
          document.getElementById(i).classList.remove('active')
        );
        this.classList.add('active');
        trainerSetup.color = id === 'tr-white' ? 'w' : id === 'tr-black' ? 'b' : 'both';
      });
    });

    /* Drill mode selector */
    const drillBtns = {
      'tr-mode-pick':    'pick',
      'tr-mode-shuffle': 'shuffle',
      'tr-mode-weak':    'weak'
    };
    Object.entries(drillBtns).forEach(([id, mode]) => {
      document.getElementById(id).addEventListener('click', function () {
        Object.keys(drillBtns).forEach(i => document.getElementById(i).classList.remove('active'));
        this.classList.add('active');
        trainerSetup.drillMode = mode;
        document.getElementById('tr-line-picker').classList.toggle('hidden', mode !== 'pick');
      });
    });

    document.getElementById('tr-start-btn').addEventListener('click', trainerStartSession);
    document.getElementById('tr-hint-btn').addEventListener('click', trainerShowHint);
    document.getElementById('tr-reveal-btn').addEventListener('click', trainerRevealAnswer);
    document.getElementById('tr-next-btn').addEventListener('click', () => {
      clearTrainerHighlights();
      trainerDrill = null;
      if (trainerSession) trainerSession.idx++;
      trainerDrillLine();
    });
    document.getElementById('tr-end-btn').addEventListener('click', () => {
      trainerDrill   = null;
      trainerWaiting = false;
      clearTrainerHighlights();
      trainerShowSummary();
    });
    document.getElementById('tr-drill-weak-btn').addEventListener('click', () => {
      trainerSetup.drillMode = 'weak';
      ['tr-mode-pick', 'tr-mode-shuffle', 'tr-mode-weak'].forEach(i =>
        document.getElementById(i).classList.remove('active')
      );
      document.getElementById('tr-mode-weak').classList.add('active');
      document.getElementById('tr-line-picker').classList.add('hidden');
      trainerStartSession();
    });
    document.getElementById('tr-back-btn').addEventListener('click', () => {
      showTrainPanel('setup');
      trainerSession = null;
      trainerDrill   = null;
      clearTrainerHighlights();
      if (currentOpening) {
        const oc = new Chess();
        for (const san of currentOpening.moves) { if (!oc.move(san)) break; }
        historyFens = [oc.fen()]; historySans = []; historyFromTo = []; moveIdx = 0;
        selSq = null; legDests = [];
        render(); renderMoveHistory(); updateTurnIndicator();
      }
    });

    /* Lines tree toggle */
    document.getElementById('tr-lines-toggle').addEventListener('click', function () {
      const tree = document.getElementById('tr-lines-tree');
      const now  = tree.classList.contains('hidden');
      tree.classList.toggle('hidden', !now);
      this.textContent = now ? 'Hide' : 'Show';
    });
  }

  /* ── Init ───────────────────────────────────────────────────────────── */
  setupSearch();
  setupNavButtons();
  setupSourceToggle();
  setupPracticeButtons();
  setupTrainer();
  renderTroubleSpots();
  updateTurnIndicator();

  loadPieceImages().then(() => {
    render();
    loadPositionData();
  });

})();

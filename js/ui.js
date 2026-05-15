const UI = (() => {

  /* ------------------------------------------------------------------ */
  /*  Internal state                                                      */
  /* ------------------------------------------------------------------ */
  let _coachLoading    = false;
  let _lastPlayerColor = 'white';
  let _lastCurrentPly  = 0;
  let _lastMoveData    = null;
  let _chatHistory     = [];   // session-only
  let _analysisData    = null; // reference to current full analysis
  let _gameMetadata    = {};
  let _currentGameId   = null;

  const API_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:4000/api/analyze'
    : 'https://chess-lab-production.up.railway.app/api/analyze';

  /* ------------------------------------------------------------------ */
  /*  HELPERS                                                             */
  /* ------------------------------------------------------------------ */

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;');
  }

  function escapeAttr(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  function fmtEval(v) {
    if (typeof v !== 'number' || !isFinite(v)) return null;
    return (v >= 0 ? '+' : '') + v.toFixed(2);
  }

  /* ------------------------------------------------------------------ */
  /*  TOAST                                                               */
  /* ------------------------------------------------------------------ */

  let _toastTimer;
  function showToast(msg) {
    const el = document.getElementById('az-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  /* ------------------------------------------------------------------ */
  /*  TAB BAR                                                             */
  /* ------------------------------------------------------------------ */

  function initTabs() {
    document.querySelectorAll('.az-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const name = tab.dataset.tab;
        document.querySelectorAll('.az-tab').forEach(t => t.classList.remove('az-tab-active'));
        tab.classList.add('az-tab-active');
        document.querySelectorAll('.az-tab-panel').forEach(p => {
          p.classList.remove('az-tab-panel-active');
          p.classList.add('hidden');
        });
        const panel = document.getElementById('tab-panel-' + name);
        if (panel) {
          panel.classList.add('az-tab-panel-active');
          panel.classList.remove('hidden');
        }
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /*  TOPBAR CHIPS                                                        */
  /* ------------------------------------------------------------------ */

  function updateTopbarChips(metadata, playerColor) {
    _gameMetadata    = metadata || {};
    _lastPlayerColor = playerColor || 'white';

    const w = metadata.white || 'White';
    const b = metadata.black || 'Black';
    const youName  = playerColor === 'black' ? b : w;
    const oppName  = playerColor === 'black' ? w : b;

    const youChipName = document.getElementById('az-you-chip-name');
    const oppChipName = document.getElementById('az-opp-chip-name');
    const youChip     = document.getElementById('az-you-chip');
    const oppChip     = document.getElementById('az-opp-chip');
    const scoreChip   = document.getElementById('az-score-chip');
    const scoreText   = document.getElementById('az-score-text');

    if (youChipName) youChipName.textContent = youName;
    if (oppChipName) oppChipName.textContent = oppName;
    if (youChip)  youChip.classList.remove('hidden');
    if (oppChip)  oppChip.classList.remove('hidden');

    if (scoreChip && scoreText) {
      const result = metadata.result || '*';
      let scoreStr = '';
      if (result === '1-0')    scoreStr = playerColor === 'white' ? '1 – 0' : '0 – 1';
      else if (result === '0-1') scoreStr = playerColor === 'white' ? '0 – 1' : '1 – 0';
      else if (result === '1/2-1/2') scoreStr = '½ – ½';
      else scoreStr = result;
      scoreText.textContent = scoreStr;
      scoreChip.classList.remove('hidden');
    }
  }

  /* ------------------------------------------------------------------ */
  /*  ACCURACY BADGE (topbar)                                             */
  /* ------------------------------------------------------------------ */

  function updateAccBadge(accuracy) {
    const badge = document.getElementById('az-acc-badge');
    if (!badge) return;
    if (accuracy == null) {
      badge.textContent = '—';
      badge.className   = 'az-acc-badge az-acc-pending';
      return;
    }
    const acc = parseInt(accuracy, 10);
    badge.textContent = acc + '%';
    let cls = 'az-acc-red';
    if (acc >= 90) cls = 'az-acc-green';
    else if (acc >= 80) cls = 'az-acc-blue';
    else if (acc >= 70) cls = 'az-acc-yellow';
    else if (acc >= 60) cls = 'az-acc-orange';
    badge.className = 'az-acc-badge ' + cls;
  }

  /* ------------------------------------------------------------------ */
  /*  EVAL BAR                                                            */
  /* ------------------------------------------------------------------ */

  function updateEvalBar(evalVal, playerColor) {
    const fill    = document.getElementById('eval-bar-fill-black');
    const bar     = document.getElementById('eval-bar');
    const display = document.getElementById('eval-value');
    if (!fill) return;

    if (bar) bar.classList.toggle('player-black', playerColor === 'black');

    const clamped  = Math.max(-5, Math.min(5, evalVal));
    const blackPct = 50 - clamped * 10;
    fill.style.height = `${Math.max(0, Math.min(100, blackPct))}%`;

    if (display && typeof evalVal === 'number' && isFinite(evalVal)) {
      const dv   = playerColor === 'black' ? -evalVal : evalVal;
      const sign = dv > 0 ? '+' : '';
      display.textContent = sign + dv.toFixed(1);
    }
  }

  function setEvalMate(n, playerColor) {
    const fill    = document.getElementById('eval-bar-fill-black');
    const bar     = document.getElementById('eval-bar');
    const display = document.getElementById('eval-value');
    if (!fill) return;
    if (bar) bar.classList.toggle('player-black', playerColor === 'black');
    const adj = playerColor === 'black' ? -n : n;
    fill.style.height = adj > 0 ? '0%' : '100%';
    if (display) display.textContent = `M${Math.abs(n)}`;
  }

  /* ------------------------------------------------------------------ */
  /*  PLAYER BARS (material + captured pieces)                           */
  /* ------------------------------------------------------------------ */

  const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const PIECE_UNICODE = {
    white: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕' },
    black: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' }
  };

  function computeMaterial(chess) {
    const board = chess.board();
    let wMat = 0, bMat = 0;
    const captured = { white: {}, black: {} };
    const full = { p: 8, n: 2, b: 2, r: 2, q: 1 };

    const present = { white: {}, black: {} };
    board.forEach(row => row.forEach(sq => {
      if (!sq) return;
      const key = sq.type;
      if (sq.color === 'w') { present.white[key] = (present.white[key] || 0) + 1; wMat += (PIECE_VALUES[key] || 0); }
      else                  { present.black[key] = (present.black[key] || 0) + 1; bMat += (PIECE_VALUES[key] || 0); }
    }));

    // captured pieces = full count - present count
    for (const [type, max] of Object.entries(full)) {
      const wCap = max - (present.black[type] || 0);  // white captured black's pieces
      const bCap = max - (present.white[type] || 0);  // black captured white's pieces
      if (wCap > 0) captured.white[type] = wCap;
      if (bCap > 0) captured.black[type] = bCap;
    }

    return { wMat, bMat, captured };
  }

  function renderMaterialBars(chess, playerColor) {
    const youEl  = document.getElementById('az-pb-you-captures');
    const oppEl  = document.getElementById('az-pb-opp-captures');
    if (!youEl || !oppEl) return;

    const { wMat, bMat, captured } = computeMaterial(chess);

    // "You" captures pieces of the opponent color
    const yourColor = playerColor; // 'white' or 'black'
    const oppColor  = playerColor === 'white' ? 'black' : 'white';

    // Which captured pieces did you take? You take opponent pieces.
    // If you're white, you captured black pieces → captured.white holds what white captured
    const yourCapturedKey = yourColor;  // captured.white = pieces white took from black
    const oppCapturedKey  = oppColor;

    function buildCaptureStr(captureMap, takenColor) {
      let html = '';
      for (const [type, count] of Object.entries(captureMap)) {
        const sym = PIECE_UNICODE[takenColor]?.[type] || '';
        for (let i = 0; i < count; i++) html += `<span>${sym}</span>`;
      }
      return html;
    }

    // Material delta from your perspective
    const yourMat = yourColor === 'white' ? wMat : bMat;
    const oppMat  = yourColor === 'white' ? bMat : wMat;
    const delta   = yourMat - oppMat;

    youEl.innerHTML = buildCaptureStr(captured[yourCapturedKey] || {}, oppColor) +
      (delta > 0 ? ` <span style="color:var(--az-green);font-size:11px;font-weight:700">+${delta}</span>` : '');
    oppEl.innerHTML = buildCaptureStr(captured[oppCapturedKey]  || {}, yourColor) +
      (delta < 0 ? ` <span style="color:var(--az-green);font-size:11px;font-weight:700">+${Math.abs(delta)}</span>` : '');
  }

  function updateNameplates(metadata, playerColor) {
    const w = metadata.white || 'White';
    const b = metadata.black || 'Black';
    const youName = playerColor === 'black' ? b : w;
    const oppName = playerColor === 'black' ? w : b;

    const youEl  = document.getElementById('az-pb-you-name');
    const oppEl  = document.getElementById('az-pb-opp-name');
    if (youEl) youEl.textContent = youName;
    if (oppEl) oppEl.textContent = oppName;
  }

  /* ------------------------------------------------------------------ */
  /*  MOVE LIST                                                           */
  /* ------------------------------------------------------------------ */

  const BADGE_MAP = {
    best:       { text: 'Best',        cls: 'az-badge-best'       },
    excellent:  { text: 'Excellent',   cls: 'az-badge-excellent'  },
    inaccuracy: { text: 'Inaccuracy',  cls: 'az-badge-inaccuracy' },
    mistake:    { text: 'Mistake',     cls: 'az-badge-mistake'    },
    miss:       { text: 'Miss',        cls: 'az-badge-miss'       },
    blunder:    { text: 'Blunder',     cls: 'az-badge-blunder'    }
  };

  function renderMoveList(verboseHistory, analysisData, onMovePlyClick) {
    const container = document.getElementById('move-list');
    if (!container) return;
    container.innerHTML = '';

    const totalPlies = verboseHistory.length;
    for (let i = 0; i < totalPlies; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const pair = document.createElement('div');
      pair.className = 'move-pair';

      const numSpan = document.createElement('span');
      numSpan.className   = 'move-num';
      numSpan.textContent = moveNum + '.';
      pair.appendChild(numSpan);

      [i, i + 1].forEach(plyIdx => {
        if (plyIdx >= totalPlies) return;
        const plyNum  = plyIdx + 1;
        const move    = verboseHistory[plyIdx];
        const isWhite = (plyIdx % 2 === 0);
        const aData   = analysisData?.moves?.find(m => m.ply === plyNum);

        const span = document.createElement('span');
        span.className   = 'move-san';
        span.dataset.ply = plyNum;

        const sanText = document.createTextNode(move.san);
        span.appendChild(sanText);

        // Only show badges for the player's moves (not opponent)
        if (aData?.classification && BADGE_MAP[aData.classification]) {
          const { text, cls } = BADGE_MAP[aData.classification];
          const badge = document.createElement('span');
          badge.className   = 'az-badge ' + cls;
          badge.textContent = text;
          span.appendChild(badge);
        }

        span.addEventListener('click', () => onMovePlyClick(plyNum));
        pair.appendChild(span);
      });

      container.appendChild(pair);
    }
  }

  function setActivePly(plyNum) {
    document.querySelectorAll('.move-san').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.ply) === plyNum);
    });
    const active = document.querySelector(`.move-san[data-ply="${plyNum}"]`);
    if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ------------------------------------------------------------------ */
  /*  STOCKFISH PROGRESS BAR                                              */
  /* ------------------------------------------------------------------ */

  function showProgress(done, total) {
    const wrap  = document.getElementById('stockfish-progress');
    const label = document.getElementById('progress-label');
    const fill  = document.getElementById('progress-bar-fill');
    if (!wrap) return;
    wrap.classList.remove('hidden');
    if (label) label.textContent = `Analyzing position ${done + 1} of ${total}…`;
    if (fill && total > 0) fill.style.width = `${Math.round((done / total) * 100)}%`;
  }

  function hideProgress() {
    const wrap = document.getElementById('stockfish-progress');
    if (wrap) wrap.classList.add('hidden');
  }

  /* ------------------------------------------------------------------ */
  /*  SHOW ANALYSIS PANELS (drop zone → analysis view)                   */
  /* ------------------------------------------------------------------ */

  function showAnalysisPanels() {
    const dz = document.getElementById('az-dropzone-panel');
    if (dz) dz.classList.add('hidden');
    const detail = document.getElementById('panel-move-detail');
    if (detail) detail.classList.remove('hidden');
    const scroll = document.getElementById('az-review-scroll');
    if (scroll) scroll.classList.remove('hidden');
    const chat = document.getElementById('az-coach-chat');
    if (chat) chat.classList.remove('hidden');

    // Report tab: hide placeholder, show content
    const rp = document.getElementById('az-report-placeholder');
    if (rp) rp.style.display = 'none';
    const rc = document.getElementById('az-report-content');
    if (rc) rc.classList.remove('hidden');
  }

  function hideAnalysisPanels() {
    const dz = document.getElementById('az-dropzone-panel');
    if (dz) dz.classList.remove('hidden');
    const detail = document.getElementById('panel-move-detail');
    if (detail) detail.classList.add('hidden');
    const scroll = document.getElementById('az-review-scroll');
    if (scroll) scroll.classList.add('hidden');
    const chat = document.getElementById('az-coach-chat');
    if (chat) chat.classList.add('hidden');
  }

  /* ------------------------------------------------------------------ */
  /*  MOVE DETAIL (pinned top of review tab)                             */
  /* ------------------------------------------------------------------ */

  function renderMoveDetail(moveData, currentPly, playerColor) {
    _lastPlayerColor = playerColor;
    _lastCurrentPly  = currentPly;
    _lastMoveData    = moveData;

    const panel   = document.getElementById('panel-move-detail');
    const content = document.getElementById('move-detail-content');
    if (!panel || !content) return;

    if (_coachLoading) return;

    panel.classList.remove('hidden');

    if (!moveData || currentPly === 0) {
      content.innerHTML = '<p class="move-detail-empty">Navigate to a move to see coaching feedback.</p>';
      _updateChatSubtitle(currentPly);
      return;
    }

    const cls         = moveData.classification || 'good';
    const san         = moveData.san || '';
    const bestMoveSan = moveData.bestMoveSan || '';
    const evalBefore  = moveData.evalBefore;
    const evalAfter   = moveData.eval;
    const evalLoss    = moveData.evalLoss || 0;
    const pvSan       = moveData.pvSan || [];
    const explanation = moveData.explanation || '';

    const flip = (playerColor === 'black');
    const dispBefore = typeof evalBefore === 'number' ? (flip ? -evalBefore : evalBefore) : null;
    const dispAfter  = typeof evalAfter  === 'number' ? (flip ? -evalAfter  : evalAfter)  : null;
    const bStr = fmtEval(dispBefore);
    const aStr = fmtEval(dispAfter);

    const isLoss    = evalLoss < -0.05;
    const isPositive = cls === 'best' || cls === 'excellent' || cls === 'good';
    const showMiddle = cls !== 'best' && bestMoveSan;

    const clsLabel = {
      best: 'Best Move', excellent: 'Excellent', good: 'Good',
      inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder', miss: 'Miss'
    }[cls] || cls;

    const defaultExpl = isPositive
      ? 'Engine agrees — this is a strong move.'
      : (bestMoveSan ? `Engine recommended ${escapeHtml(bestMoveSan)}.` : '');

    const explText = explanation || defaultExpl;
    const pvText   = pvSan.slice(0, 8).join(' ');

    const badgeClsMap = {
      best: 'az-badge-best', excellent: 'az-badge-excellent', good: '',
      inaccuracy: 'az-badge-inaccuracy', mistake: 'az-badge-mistake',
      miss: 'az-badge-miss', blunder: 'az-badge-blunder'
    };
    const badgeCls = badgeClsMap[cls] || '';

    content.innerHTML = `
      <div class="coach-card coach-card-${escapeHtml(cls)}">
        <div class="coach-row-top">
          ${badgeCls ? `<span class="az-badge ${badgeCls}" style="font-size:13px;padding:3px 10px">${escapeHtml(clsLabel)}</span>` : `<span class="coach-badge coach-badge-${escapeHtml(cls)}">${escapeHtml(clsLabel)}</span>`}
          ${bStr && aStr ? `
          <span class="coach-eval-change">
            <span>${escapeHtml(bStr)}</span>
            <span class="coach-arrow ${isLoss ? 'coach-arrow-loss' : 'coach-arrow-gain'}">${isLoss ? '↓' : '↑'}</span>
            <span>${escapeHtml(aStr)}</span>
          </span>` : ''}
        </div>
        ${showMiddle ? `
        <div class="coach-row-middle">
          <span class="coach-played">You played: <strong>${escapeHtml(san)}</strong></span>
          <span class="coach-mid-sep">→</span>
          <span class="coach-best"><span class="coach-engine-icon">⚙</span> Best: <strong>${escapeHtml(bestMoveSan)}</strong></span>
        </div>` : `
        <div class="coach-row-middle">
          <span class="coach-played">You played: <strong>${escapeHtml(san)}</strong></span>
          ${cls === 'best' ? '<span style="color:var(--az-green);font-size:12px;margin-left:8px">(engine agrees)</span>' : ''}
        </div>`}
        <div class="coach-explanation">
          ${_coachLoading
            ? `<div class="coach-loading-wrap"><div class="coach-loading-text">Coach is reviewing</div><div class="coach-loading-dots"><span></span><span></span><span></span></div></div>`
            : escapeHtml(explText)
          }
        </div>
        ${pvText ? `
        <div class="coach-pv">
          <button class="coach-pv-toggle">Show engine line ▾</button>
          <div class="coach-pv-line hidden">${escapeHtml(pvText)}</div>
        </div>` : ''}
      </div>
    `;

    const pvToggle = content.querySelector('.coach-pv-toggle');
    const pvLine   = content.querySelector('.coach-pv-line');
    if (pvToggle && pvLine) {
      pvToggle.addEventListener('click', () => {
        const nowHidden = pvLine.classList.toggle('hidden');
        pvToggle.textContent = nowHidden ? 'Show engine line ▾' : 'Hide engine line ▴';
      });
    }

    _updateChatSubtitle(currentPly);
  }

  function _updateChatSubtitle(currentPly) {
    const el = document.getElementById('az-chat-subtitle');
    if (!el) return;
    el.textContent = currentPly > 0
      ? `Knows your full game · Move ${Math.ceil(currentPly / 2)} selected`
      : 'Knows your full game';
  }

  /* ------------------------------------------------------------------ */
  /*  COACH LOADING STATE                                                 */
  /* ------------------------------------------------------------------ */

  function showCoachLoading() {
    _coachLoading = true;
    const content = document.getElementById('move-detail-content');
    if (content) {
      content.innerHTML =
        '<div class="coach-loading-wrap">' +
          '<div class="coach-loading-text">Coach is reviewing your game…</div>' +
          '<div class="coach-loading-dots"><span></span><span></span><span></span></div>' +
        '</div>';
    }
  }

  function hideCoachLoading() {
    _coachLoading = false;
    renderMoveDetail(_lastMoveData, _lastCurrentPly, _lastPlayerColor);
  }

  function revealCoachingContent() {
    const content = document.getElementById('move-detail-content');
    if (content) {
      content.classList.remove('coach-fade-in');
      void content.offsetHeight;
      content.classList.add('coach-fade-in');
      content.addEventListener('animationend', () => content.classList.remove('coach-fade-in'), { once: true });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  EVAL GRAPH (new 60px SVG)                                          */
  /* ------------------------------------------------------------------ */

  let _graphTotal  = 0;
  let _graphOnClick = null;

  function renderEvalGraph(movesData, onPlyClick) {
    const svg = document.getElementById('eval-graph');
    if (!svg) return;
    svg.innerHTML = '';

    _graphTotal   = movesData.length;
    _graphOnClick = onPlyClick;

    if (_graphTotal === 0) return;

    const W = 1000, H = 60;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');

    const PAD = { l: 0, r: 0, t: 2, b: 2 };
    const midY = H / 2;
    const clamp = v => Math.max(-5, Math.min(5, v));
    const xOf   = i => PAD.l + (i / (_graphTotal - 1 || 1)) * (W - PAD.l - PAD.r);
    const yOf   = v => PAD.t + ((5 - clamp(v)) / 10) * (H - PAD.t - PAD.b);

    // Background
    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: '#111827' }));

    // Phase backgrounds
    const openEnd   = Math.min(_graphTotal - 1, 9);
    const midEnd    = Math.min(_graphTotal - 1, 29);
    const xOp = xOf(0), xMid = xOf(Math.min(openEnd, _graphTotal - 1));
    const xEnd = xOf(Math.min(midEnd, _graphTotal - 1));

    if (openEnd > 0)
      svg.appendChild(svgEl('rect', { x: xOp, y: 0, width: xMid - xOp, height: H, fill: 'rgba(74,222,128,0.04)' }));

    // Zero line
    svg.appendChild(svgEl('line', {
      x1: 0, y1: midY, x2: W, y2: midY,
      stroke: 'rgba(255,255,255,0.1)', 'stroke-width': '1', 'stroke-dasharray': '4 4'
    }));

    // Build line points
    const points = movesData.map((m, i) => ({ x: xOf(i), y: yOf(m.eval ?? 0), ...m }));
    const polyPoints = points.map(p => `${p.x},${p.y}`).join(' ');

    // Area fill
    const areaPoints = `${xOf(0)},${midY} ${polyPoints} ${xOf(_graphTotal - 1)},${midY}`;
    svg.appendChild(svgEl('polygon', { points: areaPoints, fill: 'rgba(74,222,128,0.08)', opacity: '0.8' }));

    // Eval line
    svg.appendChild(svgEl('polyline', {
      points: polyPoints, fill: 'none',
      stroke: '#4ade80', 'stroke-width': '1.5',
      'stroke-linejoin': 'round', 'stroke-linecap': 'round'
    }));

    // Mistake/blunder/miss markers
    points.forEach(p => {
      const cls = p.classification;
      let color = null;
      if      (cls === 'blunder') color = '#f87171';
      else if (cls === 'mistake') color = '#fb923c';
      else if (cls === 'miss')    color = '#fcd34d';
      if (color) {
        // Drop line
        svg.appendChild(svgEl('line', {
          x1: p.x, y1: p.y, x2: p.x, y2: H,
          stroke: color, 'stroke-width': '1', 'stroke-dasharray': '2 2', opacity: '0.5'
        }));
        // Dot
        const dot = svgEl('circle', {
          cx: p.x, cy: p.y, r: '4', fill: color,
          stroke: '#0d1321', 'stroke-width': '1.5'
        });
        dot.style.cursor = 'pointer';
        dot.addEventListener('click', e => {
          e.stopPropagation();
          if (_graphOnClick) _graphOnClick(p.ply);
        });
        svg.appendChild(dot);
      }
    });

    // Cursor
    const cursor = svgEl('line', {
      id: 'graph-cursor',
      x1: 0, y1: 0, x2: 0, y2: H,
      stroke: 'rgba(255,255,255,0.5)', 'stroke-width': '1'
    });
    svg.appendChild(cursor);

    svg.style.cursor = 'crosshair';
    svg.addEventListener('click', e => {
      const rect = svg.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const ply  = Math.round(pct * (_graphTotal - 1)) + 1;
      if (_graphOnClick) _graphOnClick(Math.max(1, Math.min(_graphTotal, ply)));
    });
  }

  function updateGraphCursor(plyNum, totalPlies) {
    const cursor = document.getElementById('graph-cursor');
    if (!cursor || totalPlies < 1) return;
    const W   = 1000;
    const idx = Math.max(0, plyNum - 1);
    const pct = idx / (totalPlies - 1 || 1);
    const x   = Math.max(0, Math.min(1, pct)) * W;
    cursor.setAttribute('x1', x);
    cursor.setAttribute('x2', x);
  }

  /* ------------------------------------------------------------------ */
  /*  OPENING PANEL                                                       */
  /* ------------------------------------------------------------------ */

  function renderOpeningPanel(opening) {
    const panel = document.getElementById('az-opening-panel');
    if (!panel) return;
    if (!opening || !opening.name) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');

    const nameEl = document.getElementById('az-opening-name');
    if (nameEl) nameEl.textContent = opening.name || 'Unknown Opening';

    const eco = document.getElementById('az-eco-badge');
    if (eco) {
      eco.textContent  = opening.eco || '';
      eco.style.display = opening.eco ? '' : 'none';
    }

    const movesEl = document.getElementById('az-opening-moves');
    if (movesEl) {
      // Build move sequence string from youPlayed + theorySays
      let seq = '';
      if (opening.bookedUntil) seq += `Book until move ${opening.bookedUntil}`;
      movesEl.textContent = seq;
    }

    const devEl  = document.getElementById('az-opening-deviation');
    const expLink = document.getElementById('az-opening-explore-link');
    if (devEl) {
      if (opening.youPlayed && opening.bookedUntil) {
        devEl.textContent = `Left theory: move ${opening.bookedUntil} — you played ${opening.youPlayed}, theory says ${opening.theorySays || '?'}`;
        devEl.classList.remove('hidden');
      } else {
        devEl.classList.add('hidden');
      }
    }
    if (expLink) {
      const openingParam = encodeURIComponent(opening.name || '');
      expLink.href = `openings.html?opening=${openingParam}`;
      expLink.classList.remove('hidden');
    }

    const linesEl = document.getElementById('az-opening-lines');
    if (linesEl) {
      linesEl.innerHTML = '';
      const lines = opening.linesToStudy || [];
      lines.slice(0, 2).forEach(line => {
        const d = document.createElement('div');
        d.className = 'az-opening-alt-line';
        d.textContent = (line.name || '') + (line.description ? ' — ' + line.description : '');
        linesEl.appendChild(d);
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  GAME SUMMARY → Report tab                                          */
  /* ------------------------------------------------------------------ */

  function renderGameSummary(summary) {
    // Update topbar accuracy
    updateAccBadge(summary.accuracy);

    // Report card grade
    const acc = summary.accuracy ?? 0;
    let grade = 'F';
    if (acc >= 90) grade = 'A';
    else if (acc >= 80) grade = 'B';
    else if (acc >= 70) grade = 'C';
    else if (acc >= 60) grade = 'D';

    const gradeEl = document.getElementById('az-grade-circle');
    if (gradeEl) {
      gradeEl.textContent = grade;
      gradeEl.className   = `az-grade-circle az-grade-${grade}`;
    }

    // Stat grid
    const grid = document.getElementById('az-stat-grid');
    if (grid) {
      const blunders    = (summary.blunders    ?? 0);
      const mistakes    = (summary.mistakes    ?? 0);
      const inaccuracies= (summary.inaccuracies ?? 0);
      // Count best+excellent from moves if available
      const cells = [
        { cls: 'az-stat-blunder',    val: blunders,     lbl: 'Blunders'    },
        { cls: 'az-stat-mistake',    val: mistakes,     lbl: 'Mistakes'    },
        { cls: 'az-stat-miss',       val: 0,            lbl: 'Misses'      },
        { cls: 'az-stat-inaccuracy', val: inaccuracies, lbl: 'Inaccuracies'},
        { cls: 'az-stat-good',       val: null,         lbl: 'Best/Excellent'},
        { cls: 'az-stat-acc',        val: acc + '%',    lbl: 'Accuracy'    },
        { cls: '',                   val: null,         lbl: 'Material'    },
        { cls: '',                   val: _getResultLabel(summary.result, summary.playerColor), lbl: 'Result' }
      ];
      grid.innerHTML = cells.map(c =>
        `<div class="az-stat-cell ${c.cls}">
          <span class="az-stat-val">${c.val != null ? escapeHtml(String(c.val)) : '—'}</span>
          <span class="az-stat-lbl">${escapeHtml(c.lbl)}</span>
        </div>`
      ).join('');
    }

    _renderPhaseAccuracy(summary);
  }

  function _getResultLabel(result, playerColor) {
    if (!result) return '—';
    if (result === '1/2-1/2') return 'Draw';
    if (result === '1-0') return playerColor === 'white' ? 'Win' : 'Loss';
    if (result === '0-1') return playerColor === 'black' ? 'Win' : 'Loss';
    return result;
  }

  function updateStatGridMisses(movesData, playerColor) {
    const missCount = (movesData || []).filter(m => m.color === playerColor && m.classification === 'miss').length;
    const grid = document.getElementById('az-stat-grid');
    if (!grid) return;
    const missCells = grid.querySelectorAll('.az-stat-miss');
    missCells.forEach(c => {
      const valEl = c.querySelector('.az-stat-val');
      if (valEl) valEl.textContent = missCount;
    });

    const bestExcCount = (movesData || []).filter(m => m.color === playerColor &&
      (m.classification === 'best' || m.classification === 'excellent')).length;
    const goodCells = grid.querySelectorAll('.az-stat-good');
    goodCells.forEach(c => {
      const valEl = c.querySelector('.az-stat-val');
      if (valEl) valEl.textContent = bestExcCount;
    });
  }

  function _renderPhaseAccuracy(summary) {
    // Phase accuracy is computed in renderReport(), called after full analysis
    // Here we just ensure the bars exist
  }

  function renderPhaseAccuracy(movesData, playerColor) {
    const phases = [
      { key: 'opening', max: 10,  fillId: 'az-phase-opening', pctId: 'az-phase-opening-pct' },
      { key: 'mid',     max: 30,  fillId: 'az-phase-mid',     pctId: 'az-phase-mid-pct' },
      { key: 'end',     max: 999, fillId: 'az-phase-end',     pctId: 'az-phase-end-pct' }
    ];

    function winPct(evalCp) {
      return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * evalCp)) - 1);
    }

    function phaseRange(key) {
      if (key === 'opening') return [1, 10];
      if (key === 'mid')     return [11, 30];
      return [31, Infinity];
    }

    phases.forEach(ph => {
      const [minPly, maxPly] = phaseRange(ph.key);
      const phaseMoves = (movesData || []).filter(m =>
        m.color === playerColor && m.ply >= minPly && m.ply <= maxPly
      );
      if (phaseMoves.length === 0) {
        const fill = document.getElementById(ph.fillId);
        const pct  = document.getElementById(ph.pctId);
        if (fill) fill.style.width = '0%';
        if (pct)  pct.textContent  = '—';
        return;
      }
      let total = 0;
      phaseMoves.forEach(m => {
        const wpBefore = winPct((m.evalBefore ?? 0) * 100);
        const wpAfter  = winPct((m.eval        ?? 0) * 100);
        const wpl = m.color === 'white'
          ? Math.max(0, wpBefore - wpAfter)
          : Math.max(0, wpAfter  - wpBefore);
        const acc = 103.1668 * Math.exp(-0.04354 * wpl) - 3.1669;
        total += Math.max(0, Math.min(100, acc));
      });
      const avg = Math.round(total / phaseMoves.length);
      const fill = document.getElementById(ph.fillId);
      const pct  = document.getElementById(ph.pctId);
      if (fill) fill.style.width = avg + '%';
      if (pct)  pct.textContent  = avg + '%';
    });
  }

  /* ------------------------------------------------------------------ */
  /*  COACH SUMMARY (My Report tab)                                      */
  /* ------------------------------------------------------------------ */

  function renderCoachSummary(summary, gameId) {
    _currentGameId = gameId;
    const n = gameId ? Object.keys(localStorage).filter(k => k.startsWith('csa_game_')).length : '?';
    const sub = document.getElementById('az-cs-subtitle');
    if (sub) sub.textContent = `Game #${n}`;

    const textEl = document.getElementById('az-coach-summary-text');
    if (!textEl) return;
    const strength = summary.strength || '';
    const weakness = summary.weakness || '';
    const pattern  = summary.recurringPattern || '';
    if (strength || weakness) {
      textEl.innerHTML =
        (strength ? `<p style="margin-bottom:8px"><strong>Strength:</strong> ${escapeHtml(strength)}</p>` : '') +
        (weakness ? `<p style="margin-bottom:8px"><strong>Weakness:</strong> ${escapeHtml(weakness)}</p>` : '') +
        (pattern  ? `<p><strong>Pattern:</strong> ${escapeHtml(pattern)}</p>` : '');
    } else {
      textEl.innerHTML = '<div class="coach-loading-wrap"><div class="coach-loading-text">Coach is reviewing…</div><div class="coach-loading-dots"><span></span><span></span><span></span></div></div>';
    }
  }

  /* ------------------------------------------------------------------ */
  /*  VS RECENT AVERAGE                                                  */
  /* ------------------------------------------------------------------ */

  function renderVsAverage(summary, movesData, playerColor) {
    const section = document.getElementById('az-vs-avg-section');
    const content = document.getElementById('az-vs-avg-content');
    if (!section || !content) return;

    const games  = _loadRecentGames();
    if (games.length < 3) {
      section.innerHTML = (section.querySelector('.az-card-header-sm')?.outerHTML || '') +
        '<p style="font-size:12px;color:var(--az-text2);padding:6px 0">Play more games to see trends.</p>';
      return;
    }

    const avgAcc    = _avg(games.map(g => g.analysis?.summary?.accuracy).filter(v => v != null));
    const avgBlund  = _avg(games.map(g => g.analysis?.summary?.blunders).filter(v => v != null));
    const avgMisses = _avg(games.map(g => _countMisses(g, playerColor)).filter(v => v != null));
    const avgBest   = _avg(games.map(g => _countBestExc(g, playerColor)).filter(v => v != null));

    const thisAcc   = summary.accuracy     ?? 0;
    const thisBlund = summary.blunders     ?? 0;
    const thisMiss  = (movesData || []).filter(m => m.color === playerColor && m.classification === 'miss').length;
    const thisBest  = (movesData || []).filter(m => m.color === playerColor && (m.classification === 'best' || m.classification === 'excellent')).length;

    const cells = [
      { label: 'Accuracy',   val: thisAcc   + '%', avg: avgAcc    != null ? Math.round(avgAcc) + '%' : '—', up: thisAcc > avgAcc },
      { label: 'Blunders',   val: thisBlund,        avg: avgBlund  != null ? (+avgBlund.toFixed(1)) : '—', up: thisBlund < avgBlund },
      { label: 'Misses',     val: thisMiss,         avg: avgMisses != null ? (+avgMisses.toFixed(1)) : '—', up: thisMiss < avgMisses },
      { label: 'Best Moves', val: thisBest,         avg: avgBest   != null ? (+avgBest.toFixed(1)) : '—', up: thisBest > avgBest }
    ];

    content.innerHTML = cells.map(c => {
      const arrow = c.up
        ? '<span class="az-vs-avg-arrow az-arrow-up">↑</span>'
        : '<span class="az-vs-avg-arrow az-arrow-down">↓</span>';
      return `<div class="az-vs-avg-cell">
        <div class="az-vs-avg-metric">${escapeHtml(c.label)}</div>
        <div class="az-vs-avg-val">${escapeHtml(String(c.val))}${arrow}</div>
        <div class="az-vs-avg-avg">avg ${escapeHtml(String(c.avg))}</div>
      </div>`;
    }).join('');
  }

  function _loadRecentGames() {
    const games = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('csa_game_')) {
        try { games.push(JSON.parse(localStorage.getItem(key))); } catch (_) {}
      }
    }
    return games.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || '')).slice(0, 10);
  }

  function _avg(arr) {
    if (!arr || arr.length === 0) return null;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  function _countMisses(game, playerColor) {
    return (game.analysis?.moves || []).filter(m => m.color === playerColor && m.classification === 'miss').length;
  }

  function _countBestExc(game, playerColor) {
    return (game.analysis?.moves || []).filter(m => m.color === playerColor &&
      (m.classification === 'best' || m.classification === 'excellent')).length;
  }

  /* ------------------------------------------------------------------ */
  /*  PATTERNS                                                            */
  /* ------------------------------------------------------------------ */

  function renderPatternsSummary() {
    const panel = document.getElementById('az-patterns-section');
    const content = document.getElementById('az-patterns-content');
    if (!panel || !content) return;

    let recs = null;
    try {
      const raw = localStorage.getItem('csa_recommendations');
      recs = raw ? JSON.parse(raw) : null;
    } catch (_) {}

    if (!recs) {
      content.innerHTML = '<p style="font-size:12px;color:var(--az-text2)">Analyze more games to see patterns across your games.</p>';
      return;
    }

    const topTwo = (recs.topWeaknesses || []).slice(0, 2);
    if (topTwo.length === 0) {
      content.innerHTML = '<p style="font-size:12px;color:var(--az-text2)">No patterns detected yet.</p>';
      return;
    }

    content.innerHTML = topTwo.map(w => {
      const sev = (w.severity || 'moderate').toLowerCase();
      const badgeCls = sev === 'severe' ? 'az-pattern-badge-warn' : 'az-pattern-badge-good';
      return `<div class="az-pattern-card">
        <div class="az-pattern-icon">⚠</div>
        <div class="az-pattern-body">
          <div class="az-pattern-title">
            ${escapeHtml(w.title || '')}
            <span class="az-pattern-badge ${badgeCls}">${escapeHtml(w.severity || 'moderate')}</span>
          </div>
          <div class="az-pattern-desc">${escapeHtml(w.frequency || '')}</div>
        </div>
      </div>`;
    }).join('');
  }

  /* ------------------------------------------------------------------ */
  /*  NEXT STEPS                                                          */
  /* ------------------------------------------------------------------ */

  function renderNextSteps(opening, summary) {
    const grid = document.getElementById('az-next-steps');
    if (!grid) return;

    const openingName = opening?.name || 'Opening';
    const deviationMove = opening?.bookedUntil || '?';
    const critPos = sessionStorage.getItem('az_critical_fen') || '';

    grid.innerHTML = `
      <a href="openings.html?opening=${encodeURIComponent(openingName)}" class="az-next-btn az-next-btn-primary">
        <span class="az-next-btn-icon">📖</span>
        <span class="az-next-btn-title">Drill ${escapeHtml(openingName)}</span>
        <span class="az-next-btn-sub">Left theory on move ${escapeHtml(String(deviationMove))}</span>
      </a>
      <button class="az-next-btn" onclick="UI.showToast('Tactics trainer coming soon!')">
        <span class="az-next-btn-icon">⚔</span>
        <span class="az-next-btn-title">Tactics Trainer</span>
        <span class="az-next-btn-sub">Practice forcing moves</span>
      </button>
      <a href="recommendations.html" class="az-next-btn">
        <span class="az-next-btn-icon">🎯</span>
        <span class="az-next-btn-title">Full Recommendations</span>
        <span class="az-next-btn-sub">Across all your games</span>
      </a>
      <button class="az-next-btn" onclick="UI._goToPractice()">
        <span class="az-next-btn-icon">♜</span>
        <span class="az-next-btn-title">Practice Board</span>
        <span class="az-next-btn-sub">Set up critical position</span>
      </button>
    `;
  }

  function _goToPractice() {
    const fen = sessionStorage.getItem('az_critical_fen');
    if (fen) sessionStorage.setItem('practice_fen', fen);
    window.location.href = 'practice.html';
  }

  /* ------------------------------------------------------------------ */
  /*  FULL REPORT RENDER (called after both SF + Claude complete)        */
  /* ------------------------------------------------------------------ */

  function renderFullReport(analysisData, movesData, playerColor, gameId) {
    _analysisData = analysisData;
    renderCoachSummary(analysisData.summary || {}, gameId);
    renderVsAverage(analysisData.summary || {}, movesData, playerColor);
    renderPatternsSummary();
    renderNextSteps(analysisData.opening || {}, analysisData.summary || {});
    renderPhaseAccuracy(movesData, playerColor);
    updateStatGridMisses(movesData, playerColor);

    // Store critical position FEN (worst blunder move if any)
    const blunder = (movesData || []).find(m => m.color === playerColor && m.classification === 'blunder');
    if (blunder) {
      // App will pass fens array separately; we just mark the ply
      sessionStorage.setItem('az_critical_ply', String(blunder.ply));
    }
  }

  /* ------------------------------------------------------------------ */
  /*  COACH CHAT                                                          */
  /* ------------------------------------------------------------------ */

  function initCoachChat(getStateCallback) {
    _chatHistory = [];

    const sendBtn   = document.getElementById('az-chat-send');
    const input     = document.getElementById('az-chat-input');
    if (!sendBtn || !input) return;

    sendBtn.addEventListener('click', () => _sendChat(getStateCallback));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendChat(getStateCallback); }
    });
  }

  function sendCoachOpeningMessage(summary) {
    if (!summary) return;
    const acc = summary.accuracy ?? 0;
    const blunders = summary.blunders ?? 0;

    let msg = '';
    if (acc >= 85) {
      msg = `Nice game — ${acc}% accuracy. You played solidly. `;
    } else if (acc >= 70) {
      msg = `Good effort — ${acc}% accuracy. There's room to improve. `;
    } else {
      msg = `Tough game — ${acc}% accuracy. Let's work on it. `;
    }

    if (blunders > 0) {
      msg += `I noticed ${blunders === 1 ? 'a blunder' : blunders + ' blunders'}. What were you thinking at that moment?`;
    } else if (summary.mistakes > 0) {
      msg += `You had ${summary.mistakes} mistake${summary.mistakes === 1 ? '' : 's'}. Want to talk through any of them?`;
    } else {
      msg += 'Overall clean play. Any moves you want to discuss?';
    }

    _appendCoachMsg(msg);
  }

  function _appendCoachMsg(text) {
    const container = document.getElementById('az-chat-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className   = 'az-chat-msg-coach';
    div.textContent = text;
    container.appendChild(div);
    _chatHistory.push({ role: 'assistant', content: text });
    container.scrollTop = container.scrollHeight;
  }

  function _appendUserMsg(text) {
    const container = document.getElementById('az-chat-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className   = 'az-chat-msg-user';
    div.textContent = text;
    container.appendChild(div);
    _chatHistory.push({ role: 'user', content: text });
    container.scrollTop = container.scrollHeight;
  }

  function _appendTyping() {
    const container = document.getElementById('az-chat-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'az-chat-typing';
    div.id        = 'az-typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function _removeTyping() {
    const el = document.getElementById('az-typing-indicator');
    if (el) el.remove();
  }

  async function _sendChat(getStateCallback) {
    const input = document.getElementById('az-chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    _appendUserMsg(text);
    const typing = _appendTyping();

    const state      = getStateCallback();
    const moves      = state.analysisData?.moves  || [];
    const summary    = state.analysisData?.summary || {};
    const opening    = state.analysisData?.opening || {};
    const fens       = state.fens || [];
    const pgn        = state.pgn  || '';
    const currentPly = state.currentPly;

    // Build full move list with all engine data for every move
    const moveListLines = moves.map(m => {
      const moveNum = Math.ceil(m.ply / 2);
      const side    = m.color === 'white' ? 'W' : 'B';
      const eb      = typeof m.evalBefore === 'number' ? m.evalBefore.toFixed(2) : '?';
      const ea      = typeof m.eval       === 'number' ? m.eval.toFixed(2)       : '?';
      const pv      = (m.pvSan || []).slice(0, 4).join(' ') || 'none';
      return `Move ${moveNum}${side} (ply ${m.ply}): ${m.san} | ${m.classification} | eval ${eb}→${ea} | engine best: ${m.bestMoveSan || 'none'} | engine line: ${pv}`;
    }).join('\n');

    // Current move context — reflects wherever the user has navigated
    const moveData   = moves.find(m => m.ply === currentPly) || null;
    const currentFen = fens[currentPly] || null;
    let currentMoveBlock;
    if (moveData && currentPly > 0) {
      const moveNum = Math.ceil(moveData.ply / 2);
      const eb      = typeof moveData.evalBefore === 'number' ? moveData.evalBefore.toFixed(2) : '?';
      const ea      = typeof moveData.eval       === 'number' ? moveData.eval.toFixed(2)       : '?';
      const pv      = (moveData.pvSan || []).slice(0, 4).join(' ') || 'none';
      currentMoveBlock =
        `CURRENT MOVE BEING DISCUSSED: Move ${moveNum} — ${moveData.san}\n` +
        `  FEN at this position: ${currentFen || 'not available'}\n` +
        `  Eval before: ${eb}\n` +
        `  Eval after: ${ea}\n` +
        `  Classification: ${moveData.classification}\n` +
        `  Engine best move: ${moveData.bestMoveSan || 'none'}\n` +
        `  Engine line: ${pv}`;
    } else {
      currentMoveBlock = 'CURRENT MOVE: Start position (no specific move selected)';
    }

    const systemPrompt =
`You are a chess coach reviewing a specific game. You have been given the EXACT game data below. Never guess, infer, or reconstruct positions — only reference moves, pieces, and positions that are explicitly stated in the data provided. If the user asks about something not in the data, say you don't have enough information rather than guessing.

GAME DATA:
- PGN: ${pgn}
- Player color: ${state.playerColor}
- Final accuracy: ${summary.accuracy ?? '?'}%
- Blunders: ${summary.blunders ?? 0}, Mistakes: ${summary.mistakes ?? 0}, Inaccuracies: ${summary.inaccuracies ?? 0}
- Opening: ${opening.name || 'unknown'}

MOVE LIST WITH CLASSIFICATIONS:
${moveListLines}

${currentMoveBlock}

When the user asks about a specific move number, reference ONLY the data for that move as listed above. Never suggest piece locations you cannot confirm from the FEN or move list. Never suggest moves that aren't in the engine line provided. If you are not 100% certain of a piece's location from the data provided, do not mention it. Say "based on the position at move N" and reference only what the engine data confirms. Respond concisely (2-4 sentences). Be specific and technical.`;

    // Messages includes current user msg already appended to _chatHistory above
    const messages = _chatHistory.slice(-6).map(m => ({ role: m.role, content: m.content }));

    try {
      const response = await fetch(API_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:      'claude-sonnet-4-6',
          max_tokens: 300,
          system:     systemPrompt,
          messages
        })
      });
      _removeTyping();
      if (!response.ok) { _appendCoachMsg('Sorry, I had trouble connecting. Try again.'); return; }
      const data = await response.json();
      const reply = data?.content?.[0]?.text || "I'm not sure — try rephrasing.";
      _appendCoachMsg(reply);
    } catch (_) {
      _removeTyping();
      _appendCoachMsg('Network error. Please check your connection.');
    }
  }

  /* ------------------------------------------------------------------ */
  /*  GAME HEADER (legacy helper — topbar chips replace it)              */
  /* ------------------------------------------------------------------ */

  function renderGameHeader(metadata) {
    updateTopbarChips(metadata, _lastPlayerColor);
  }

  /* ------------------------------------------------------------------ */
  /*  SIDEBAR                                                             */
  /* ------------------------------------------------------------------ */

  function renderGamesList(games, onLoad, onDelete) {
    const list = document.getElementById('games-list');
    if (!list) return;

    if (!games || games.length === 0) {
      list.innerHTML = '<p class="sidebar-empty">No saved games yet.</p>';
      return;
    }

    list.innerHTML = '';
    games.forEach(game => {
      const entry = document.createElement('div');
      entry.className = 'game-entry';

      const w   = game.metadata?.white  || 'White';
      const b   = game.metadata?.black  || 'Black';
      const res = game.metadata?.result || '*';
      const acc = game.analysis?.summary?.accuracy;
      const eco = game.analysis?.opening?.name || '';

      entry.innerHTML = `
        <div class="game-entry-players">${escapeHtml(w)} vs ${escapeHtml(b)}</div>
        <div class="game-entry-meta">
          ${escapeHtml(res)}
          ${acc != null ? ` · ${acc}% acc` : ''}
          ${eco ? ` · ${escapeHtml(eco.substring(0, 30))}` : ''}
        </div>
        <button class="game-entry-delete" title="Delete game">✕</button>
      `;

      entry.addEventListener('click', e => {
        if (e.target.classList.contains('game-entry-delete')) {
          e.stopPropagation();
          onDelete(game.id);
        } else {
          onLoad(game.id);
        }
      });

      list.appendChild(entry);
    });
  }

  function openSidebar() {
    const sidebar = document.getElementById('games-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar) return;
    sidebar.classList.remove('hidden');
    requestAnimationFrame(() => sidebar.classList.add('open'));
    if (overlay) overlay.classList.remove('hidden');
  }

  function closeSidebar() {
    const sidebar = document.getElementById('games-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar) return;
    sidebar.classList.remove('open');
    if (overlay) overlay.classList.add('hidden');
    sidebar.addEventListener('transitionend', () => {
      if (!sidebar.classList.contains('open')) sidebar.classList.add('hidden');
    }, { once: true });
  }

  /* ------------------------------------------------------------------ */
  /*  ERROR / DEBUG                                                       */
  /* ------------------------------------------------------------------ */

  function showError(message) {
    const banner = document.getElementById('error-banner');
    const msgEl  = document.getElementById('error-message');
    if (!banner || !msgEl) return;
    msgEl.textContent = message;
    banner.classList.remove('hidden');
  }

  function hideError() {
    const banner = document.getElementById('error-banner');
    if (banner) banner.classList.add('hidden');
  }

  function showParseError(rawText) {
    const existing = document.getElementById('debug-parse-error');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.id = 'debug-parse-error';
    div.style.cssText = `position:fixed;bottom:16px;right:16px;left:16px;max-height:200px;
      background:#1a0a0a;border:1px solid #8b2020;border-radius:8px;padding:12px;
      overflow-y:auto;z-index:800;font-family:monospace;font-size:11px;color:#f08080;`;
    div.innerHTML = `<strong style="display:block;margin-bottom:6px;">JSON Parse Error — Raw Claude Response:</strong>` +
      escapeHtml(rawText);
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Close';
    closeBtn.style.cssText = 'display:block;margin-top:8px;color:#f08080;font-size:11px;';
    closeBtn.onclick = () => div.remove();
    div.appendChild(closeBtn);
    document.body.appendChild(div);
  }

  /* ------------------------------------------------------------------ */
  /*  LEGACY STUBS (keep app.js working without changes)                 */
  /* ------------------------------------------------------------------ */

  function renderGameNotes() { /* superseded by renderFullReport */ }

  /* ------------------------------------------------------------------ */
  /*  INIT                                                                */
  /* ------------------------------------------------------------------ */

  function initDrawer() {
    // Collapsible toggle (not used in new layout but keep for safety)
    document.querySelectorAll('.section-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const section = btn.closest('.collapsible-section');
        if (section) section.classList.toggle('open');
      });
    });

    initTabs();
  }

  document.addEventListener('DOMContentLoaded', initDrawer);

  return {
    updateEvalBar,
    setEvalMate,
    renderGameHeader,
    updateNameplates,
    updateTopbarChips,
    renderMoveList,
    setActivePly,
    renderGameSummary,
    renderCoachSummary,
    renderEvalGraph,
    updateGraphCursor,
    renderOpeningPanel,
    renderMoveDetail,
    renderGameNotes,
    renderGamesList,
    showAnalysisPanels,
    hideAnalysisPanels,
    showProgress,
    hideProgress,
    showCoachLoading,
    hideCoachLoading,
    revealCoachingContent,
    openSidebar,
    closeSidebar,
    showError,
    hideError,
    showParseError,
    showToast,
    renderPatternsSummary,
    renderFullReport,
    renderPhaseAccuracy,
    renderMaterialBars,
    initCoachChat,
    sendCoachOpeningMessage,
    _goToPractice
  };
})();

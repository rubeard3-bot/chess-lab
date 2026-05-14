const UI = (() => {

  /* ------------------------------------------------------------------ */
  /*  COACH LOADING STATE — tracks last rendered move for post-Claude     */
  /*  refresh, and gates renderMoveDetail while Claude is pending.        */
  /* ------------------------------------------------------------------ */

  let _coachLoading    = false;
  let _lastPlayerColor = 'white';
  let _lastCurrentPly  = 0;
  let _lastMoveData    = null;

  /* ------------------------------------------------------------------ */
  /*  HAMBURGER DRAWER                                                    */
  /* ------------------------------------------------------------------ */

  function initDrawer() {
    // Hamburger / drawer / coming-soon wiring is handled by nav.js / initNav()

    // Collapsible section toggles
    document.querySelectorAll('.section-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const section = btn.closest('.collapsible-section');
        if (section) section.classList.toggle('open');
      });
    });

    // PGN dropdown toggle
    const pgnLoadBtn  = document.getElementById('pgn-load-btn');
    const pgnDropdown = document.getElementById('pgn-dropdown');
    const analyzeBtn  = document.getElementById('analyze-btn');
    if (pgnLoadBtn && pgnDropdown) {
      pgnLoadBtn.addEventListener('click', () => {
        const isOpen = pgnDropdown.classList.toggle('open');
        pgnLoadBtn.classList.toggle('active', isOpen);
      });
    }
    if (analyzeBtn && pgnDropdown) {
      analyzeBtn.addEventListener('click', () => {
        pgnDropdown.classList.remove('open');
        if (pgnLoadBtn) pgnLoadBtn.classList.remove('active');
      }, true); // capture so it fires before app.js handler
    }
  }

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
  /*  EVAL BAR                                                            */
  /* ------------------------------------------------------------------ */

  function updateEvalBar(evalVal, playerColor) {
    const fill    = document.getElementById('eval-bar-fill-black');
    const bar     = document.getElementById('eval-bar');
    const display = document.getElementById('eval-value');
    if (!fill || !display) return;

    if (bar) bar.classList.toggle('player-black', playerColor === 'black');

    const clamped  = Math.max(-5, Math.min(5, evalVal));
    const blackPct = 50 - clamped * 10;
    fill.style.height = `${Math.max(0, Math.min(100, blackPct))}%`;

    if (typeof evalVal === 'number' && isFinite(evalVal)) {
      const displayVal = playerColor === 'black' ? -evalVal : evalVal;
      const sign = displayVal > 0 ? '+' : '';
      display.textContent = sign + displayVal.toFixed(1);
    }
  }

  function setEvalMate(n, playerColor) {
    const fill    = document.getElementById('eval-bar-fill-black');
    const bar     = document.getElementById('eval-bar');
    const display = document.getElementById('eval-value');
    if (!fill || !display) return;
    if (bar) bar.classList.toggle('player-black', playerColor === 'black');
    const adjustedN = playerColor === 'black' ? -n : n;
    fill.style.height = adjustedN > 0 ? '0%' : '100%';
    display.textContent = `M${Math.abs(n)}`;
  }

  /* ------------------------------------------------------------------ */
  /*  GAME HEADER                                                         */
  /* ------------------------------------------------------------------ */

  function renderGameHeader(metadata) {
    const header = document.getElementById('game-header');
    if (!header) return;
    header.classList.remove('hidden');

    document.getElementById('player-white').textContent = metadata.white || 'White';
    document.getElementById('player-black').textContent = metadata.black || 'Black';
    const dateEl = document.getElementById('game-date');
    if (dateEl) dateEl.textContent = metadata.date || '';

    const badge = document.getElementById('game-result');
    badge.textContent = metadata.result || '*';
    badge.className   = 'result-badge';
    if (metadata.result === '1-0') badge.classList.add('white-win');
    else if (metadata.result === '0-1') badge.classList.add('black-win');
    else badge.classList.add('draw');
  }

  function updateNameplates(metadata, playerColor) {
    const w = metadata.white || 'White';
    const b = metadata.black || 'Black';
    const youName  = playerColor === 'black' ? b : w;
    const oppName  = playerColor === 'black' ? w : b;
    const youDot   = playerColor === 'black' ? '●' : '○';
    const oppDot   = playerColor === 'black' ? '○' : '●';

    const youEl  = document.getElementById('np-you-name');
    const oppEl  = document.getElementById('np-opp-name');
    const youDotEl = document.getElementById('np-you-dot');
    const oppDotEl = document.getElementById('np-opp-dot');
    if (youEl)  youEl.textContent  = youName;
    if (oppEl)  oppEl.textContent  = oppName;
    if (youDotEl)  youDotEl.textContent  = youDot;
    if (oppDotEl)  oppDotEl.textContent  = oppDot;
  }

  /* ------------------------------------------------------------------ */
  /*  MOVE LIST                                                           */
  /* ------------------------------------------------------------------ */

  const CLASS_BADGE = {
    blunder:    { text: '??', cls: 'badge-blunder' },
    mistake:    { text: '?',  cls: 'badge-mistake' },
    inaccuracy: { text: '⁈', cls: 'badge-inaccuracy' },
    miss:       { text: '!?', cls: 'badge-miss' },
    best:       { text: '!',  cls: 'badge-best' },
    excellent:  { text: '!',  cls: 'badge-excellent' }
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
        const plyNum = plyIdx + 1;
        const move   = verboseHistory[plyIdx];
        const aData  = analysisData?.moves?.find(m => m.ply === plyNum);

        const span = document.createElement('span');
        span.className       = 'move-san';
        span.dataset.ply     = plyNum;
        span.textContent     = move.san;
        if (aData?.classification) span.classList.add('move-' + aData.classification);

        if (aData && CLASS_BADGE[aData.classification]) {
          const { text, cls } = CLASS_BADGE[aData.classification];
          const badge = document.createElement('span');
          badge.className   = 'move-badge ' + cls;
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
    if (label) {
      label.textContent = `Analyzing position ${done + 1} of ${total}…`;
    }
    if (fill && total > 0) {
      fill.style.width = `${Math.round((done / total) * 100)}%`;
    }
  }

  function hideProgress() {
    const wrap = document.getElementById('stockfish-progress');
    if (wrap) wrap.classList.add('hidden');
  }

  /* ------------------------------------------------------------------ */
  /*  GAME SUMMARY                                                        */
  /* ------------------------------------------------------------------ */

  function renderGameSummary(summary) {
    const panel = document.getElementById('panel-summary');
    if (!panel) return;
    panel.classList.remove('hidden');

    const acc = summary.accuracy ?? 0;
    const accText = `${summary.accuracy ?? '—'}%`;
    const accCls  = acc >= 75 ? 'acc-green' : acc >= 55 ? 'acc-yellow' : 'acc-red';

    // In-section accuracy badge
    const badge = document.getElementById('accuracy-badge');
    if (badge) {
      badge.textContent = accText;
      badge.className   = 'accuracy-badge ' + accCls;
    }
    const colorLabel = document.getElementById('accuracy-color-label');
    if (colorLabel && summary.playerColor) {
      colorLabel.textContent = `as ${summary.playerColor}`;
    }

    // Navbar accuracy badge
    const navAcc = document.getElementById('navbar-acc');
    if (navAcc) {
      navAcc.textContent = accText;
      navAcc.className   = 'accuracy-badge ' + accCls;
    }
    const navAccLabel = document.getElementById('navbar-acc-label');
    if (navAccLabel && summary.playerColor) {
      navAccLabel.textContent = `as ${summary.playerColor}`;
    }
    const navAccWrap = document.getElementById('navbar-acc-wrap');
    if (navAccWrap) navAccWrap.classList.remove('hidden');

    const stats = [
      { label: 'Blunders',     value: summary.blunders     ?? 0, cls: 'stat-blunder' },
      { label: 'Mistakes',     value: summary.mistakes     ?? 0, cls: 'stat-mistake' },
      { label: 'Inaccuracies', value: summary.inaccuracies ?? 0, cls: 'stat-inaccuracy' }
    ];
    const row = document.getElementById('stats-row');
    row.innerHTML = '';
    stats.forEach(s => {
      const div = document.createElement('div');
      div.className = `stat-item ${s.cls}`;
      div.innerHTML = `<span class="stat-value">${s.value}</span><span class="stat-label">${s.label}</span>`;
      row.appendChild(div);
    });

    const existingTotal = row.parentElement.querySelector('.moves-total-label');
    if (existingTotal) existingTotal.remove();
    if (summary.totalMoves != null) {
      const totalDiv = document.createElement('div');
      totalDiv.className = 'moves-total-label';
      totalDiv.textContent = `${summary.totalMoves} moves total`;
      row.after(totalDiv);
    }

    const strength = document.getElementById('strength-card');
    strength.innerHTML = `<div class="insight-label">Strength</div>${escapeHtml(summary.strength || '')}`;

    const weakness = document.getElementById('weakness-card');
    weakness.innerHTML = `<div class="insight-label">Weakness</div>${escapeHtml(summary.weakness || '')}`;

    const patternCard = document.getElementById('pattern-card');
    if (summary.recurringPattern) {
      patternCard.innerHTML = `<div class="insight-label">Recurring Pattern</div>${escapeHtml(summary.recurringPattern)}`;
      patternCard.classList.remove('hidden');
    } else {
      patternCard.classList.add('hidden');
    }
  }

  /* ------------------------------------------------------------------ */
  /*  EVAL GRAPH                                                          */
  /* ------------------------------------------------------------------ */

  let graphMeta = { totalPlies: 0 };

  function renderEvalGraph(movesData, onPlyClick) {
    const svg = document.getElementById('eval-graph');
    if (!svg) return;
    svg.innerHTML = '';

    const W = 1000, H = 120;
    const PAD = { l: 8, r: 8, t: 8, b: 8 };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const panel = document.getElementById('panel-graph');
    panel.classList.remove('hidden');

    const total = movesData.length;
    graphMeta.totalPlies = total;
    if (total === 0) return;

    const clamp = v => Math.max(-5, Math.min(5, v));
    const xOf   = i => PAD.l + (i / (total - 1 || 1)) * (W - PAD.l - PAD.r);
    const yOf   = v => PAD.t + ((5 - clamp(v)) / 10) * (H - PAD.t - PAD.b);

    const midY  = yOf(0);

    const defs = svgEl('defs', {});
    const grad = svgEl('linearGradient', { id: 'evalGrad', x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#f0d9b5', 'stop-opacity': '0.25' }));
    grad.appendChild(svgEl('stop', { offset: '50%','stop-color': '#f0d9b5', 'stop-opacity': '0.05' }));
    grad.appendChild(svgEl('stop', { offset: '100%','stop-color': '#b58863','stop-opacity': '0.20' }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: '#0a1a30' }));
    svg.appendChild(svgEl('line', {
      x1: PAD.l, y1: midY, x2: W - PAD.r, y2: midY,
      stroke: 'rgba(255,255,255,0.12)', 'stroke-width': '1', 'stroke-dasharray': '4 4'
    }));

    const points = movesData.map((m, i) => ({ x: xOf(i), y: yOf(m.eval ?? 0), ...m }));

    const polyPoints = points.map(p => `${p.x},${p.y}`).join(' ');
    const areaPoints = `${xOf(0)},${midY} ${polyPoints} ${xOf(total - 1)},${midY}`;

    svg.appendChild(svgEl('polygon', {
      points: areaPoints,
      fill: 'url(#evalGrad)',
      opacity: '0.5'
    }));

    svg.appendChild(svgEl('polyline', {
      points: polyPoints,
      fill: 'none',
      stroke: 'rgba(220,220,220,0.85)',
      'stroke-width': '1.8',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round'
    }));

    points.forEach((p, i) => {
      const cls = p.classification;
      if (cls === 'blunder' || cls === 'mistake') {
        const dot = svgEl('circle', {
          cx: p.x, cy: p.y, r: '5',
          fill: cls === 'blunder' ? '#f05555' : '#e09952',
          stroke: '#1a1a2e',
          'stroke-width': '1.5'
        });
        svg.appendChild(dot);
      }
    });

    const cursor = svgEl('line', {
      id: 'graph-cursor',
      x1: PAD.l, y1: PAD.t, x2: PAD.l, y2: H - PAD.b,
      stroke: 'rgba(127,166,80,0.8)',
      'stroke-width': '1.5'
    });
    svg.appendChild(cursor);

    svg.style.cursor = 'crosshair';
    svg.addEventListener('click', e => {
      const rect = svg.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const ply  = Math.round(pct * (total - 1)) + 1;
      onPlyClick(Math.max(1, Math.min(total, ply)));
    });
  }

  function updateGraphCursor(plyNum, totalPlies) {
    const cursor = document.getElementById('graph-cursor');
    if (!cursor || totalPlies < 1) return;
    const W   = 1000;
    const PAD = { l: 8, r: 8 };
    const idx = Math.max(0, plyNum - 1);
    const pct = idx / (totalPlies - 1 || 1);
    const x   = PAD.l + Math.max(0, Math.min(1, pct)) * (W - PAD.l - PAD.r);
    cursor.setAttribute('x1', x);
    cursor.setAttribute('x2', x);
  }

  /* ------------------------------------------------------------------ */
  /*  OPENING PANEL                                                       */
  /* ------------------------------------------------------------------ */

  function renderOpeningPanel(opening) {
    const panel = document.getElementById('panel-opening');
    if (!panel) return;
    if (!opening || !opening.name) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');

    document.getElementById('opening-name-heading').textContent = opening.name || 'Unknown Opening';
    const eco = document.getElementById('eco-badge');
    eco.textContent = opening.eco || '';
    eco.style.display = opening.eco ? '' : 'none';

    const details = document.getElementById('opening-details');
    const rows = [
      { label: 'Book until', value: opening.bookedUntil ? `Move ${opening.bookedUntil}` : '—' },
      { label: 'You played', value: opening.youPlayed   || '—' },
      { label: 'Theory',     value: opening.theorySays  || '—' }
    ];
    details.innerHTML = rows.map(r =>
      `<div class="opening-row">
        <span class="opening-row-label">${r.label}</span>
        <span class="opening-row-value">${escapeHtml(r.value)}</span>
      </div>`
    ).join('');

    if (opening.explanation) {
      details.innerHTML += `<div class="opening-explanation">${escapeHtml(opening.explanation)}</div>`;
    }

    const studyWrap = document.getElementById('lines-to-study');
    studyWrap.innerHTML = '';
    const lines = opening.linesToStudy || [];
    if (lines.length > 0) {
      studyWrap.innerHTML = '<h4>Lines to Study</h4>';
      lines.forEach(line => {
        const card = document.createElement('div');
        card.className = 'study-card';
        const urlHtml = line.url
          ? `<a class="study-card-link" href="${escapeAttr(line.url)}" target="_blank" rel="noopener noreferrer">Open resource →</a>`
          : '';
        card.innerHTML = `
          <div class="study-card-name">${escapeHtml(line.name || '')}</div>
          <div class="study-card-desc">${escapeHtml(line.description || '')}</div>
          ${urlHtml}
        `;
        studyWrap.appendChild(card);
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  MOVE DETAIL PANEL — coaching card                                  */
  /* ------------------------------------------------------------------ */

  function fmtEval(v) {
    if (typeof v !== 'number' || !isFinite(v)) return null;
    return (v >= 0 ? '+' : '') + v.toFixed(2);
  }

  function renderMoveDetail(moveData, currentPly, playerColor) {
    _lastPlayerColor = playerColor;
    _lastCurrentPly  = currentPly;
    _lastMoveData    = moveData;

    const panel   = document.getElementById('panel-move-detail');
    const content = document.getElementById('move-detail-content');
    if (!panel || !content) return;

    if (_coachLoading) return;  // Loading placeholder shown — don't overwrite until Claude responds

    panel.classList.remove('hidden');

    if (!moveData || currentPly === 0) {
      content.innerHTML = '<p class="move-detail-empty">Navigate to a move to see coaching feedback.</p>';
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
    const lossStr   = Math.abs(evalLoss) >= 0.05 ? evalLoss.toFixed(2) + ' pawns' : null;
    const isPositive = cls === 'best' || cls === 'excellent' || cls === 'good';
    const showMiddle = cls !== 'best' && bestMoveSan;

    const clsLabel = {
      best: 'Best Move', excellent: 'Excellent', good: 'Good',
      inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder', miss: 'Miss'
    }[cls] || cls;

    const defaultExpl = isPositive
      ? 'Engine agrees with this move.'
      : (bestMoveSan ? `The engine recommended ${escapeHtml(bestMoveSan)} instead.` : '');

    const pvText = pvSan.slice(0, 8).join(' ');

    content.innerHTML = `
      <div class="coach-card coach-card-${escapeHtml(cls)}">

        <div class="coach-row-top">
          <span class="coach-badge coach-badge-${escapeHtml(cls)}">${clsLabel}</span>
          ${bStr && aStr ? `
          <span class="coach-eval-change">
            <span>${escapeHtml(bStr)}</span>
            <span class="coach-arrow ${isLoss ? 'coach-arrow-loss' : 'coach-arrow-gain'}">${isLoss ? '↓' : '↑'}</span>
            <span>${escapeHtml(aStr)}</span>
          </span>` : ''}
          ${lossStr ? `<span class="coach-loss${isLoss ? ' coach-loss-neg' : ''}">${escapeHtml(lossStr)}</span>` : ''}
        </div>

        ${showMiddle ? `
        <div class="coach-row-middle">
          <span class="coach-played">You played: <strong>${escapeHtml(san)}</strong></span>
          <span class="coach-mid-sep">→</span>
          <span class="coach-best"><span class="coach-engine-icon">⚙</span> Best: <strong>${escapeHtml(bestMoveSan)}</strong></span>
        </div>` : ''}

        <div class="coach-explanation">${escapeHtml(explanation || defaultExpl)}</div>

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

    // Drive Section 2: Why best move
    renderWhyBestMove(moveData);
    // Drive Section 3: Alternate moves
    renderAlternateMoves(moveData);
  }

  function renderWhyBestMove(moveData) {
    const panel   = document.getElementById('panel-why-best');
    const heading = document.getElementById('why-best-heading');
    const content = document.getElementById('why-best-content');
    if (!panel || !content) return;

    if (!moveData || moveData.classification === 'best' || !moveData.bestMoveSan) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');

    const bestSan = moveData.bestMoveSan || '';
    if (heading) heading.textContent = `Why ${escapeHtml(bestSan)} is best`;

    const pvText   = (moveData.pvSan || []).slice(0, 10).join(' ');
    const explanation = moveData.explanation || '';

    content.innerHTML =
      `<div class="why-best-move-row">
         <span style="font-size:14px;color:var(--text2)">Best move:</span>
         <span class="why-best-move-san">${escapeHtml(bestSan)}</span>
       </div>` +
      (explanation ? `<p style="font-size:15px;color:#dcdcea;line-height:1.8;margin-bottom:8px">${escapeHtml(explanation)}</p>` : '') +
      (pvText
        ? `<div class="engine-line"><span class="engine-line-label">Engine line</span>${escapeHtml(pvText)}</div>`
        : '');
  }

  function renderAlternateMoves(moveData) {
    const panel   = document.getElementById('panel-alternates');
    const content = document.getElementById('alternates-content');
    if (!panel || !content) return;

    const alts = moveData?.alternateMoves;
    if (!alts || alts.length === 0) {
      const isCritical = moveData &&
        (moveData.classification === 'blunder' || moveData.classification === 'mistake' || moveData.classification === 'miss');
      content.innerHTML = `<p class="no-alternates">${
        isCritical
          ? 'No significant alternatives — this was the critical moment.'
          : 'No alternate suggestions for this move.'
      }</p>`;
    } else {
      content.innerHTML = alts.slice(0, 3).map(a =>
        `<div class="alt-move-item">
           <span class="alt-move-san">${escapeHtml(a.san || '')}</span>
           <span class="alt-move-desc">${escapeHtml(a.explanation || '')}</span>
         </div>`
      ).join('');
    }
  }

  /* ------------------------------------------------------------------ */
  /*  COACH LOADING — shown while Railway/Claude call is in-flight       */
  /* ------------------------------------------------------------------ */

  function showCoachLoading() {
    _coachLoading = true;

    const content = document.getElementById('move-detail-content');
    if (content) {
      content.innerHTML =
        '<div class="coach-loading-wrap">' +
          '<div class="coach-loading-text">🔍 Your coach is reviewing your game…</div>' +
          '<div class="coach-loading-dots"><span></span><span></span><span></span></div>' +
        '</div>';
    }

    const whyBest = document.getElementById('panel-why-best');
    if (whyBest) whyBest.classList.add('hidden');
    const alts = document.getElementById('panel-alternates');
    if (alts) alts.classList.add('hidden');

    const strength = document.getElementById('strength-card');
    if (strength) strength.innerHTML =
      '<div class="insight-label">Strength</div>' +
      '<div class="coach-loading-inline"><span></span><span></span><span></span></div>';
    const weakness = document.getElementById('weakness-card');
    if (weakness) weakness.innerHTML =
      '<div class="insight-label">Weakness</div>' +
      '<div class="coach-loading-inline"><span></span><span></span><span></span></div>';
  }

  function hideCoachLoading() {
    _coachLoading = false;
    renderMoveDetail(_lastMoveData, _lastCurrentPly, _lastPlayerColor);
  }

  function revealCoachingContent() {
    ['move-detail-content', 'strength-card', 'weakness-card'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('coach-fade-in');
      void el.offsetHeight;
      el.classList.add('coach-fade-in');
      el.addEventListener('animationend', () => el.classList.remove('coach-fade-in'), { once: true });
    });
  }

  function renderGameNotes(analysisData) {
    const mid = analysisData?.summary?.middlegameNotes || analysisData?.middlegameNotes;
    const end = analysisData?.summary?.endgameNotes    || analysisData?.endgameNotes;

    const midPanel   = document.getElementById('panel-middlegame');
    const midContent = document.getElementById('middlegame-content');
    if (midPanel && midContent && mid) {
      midPanel.classList.remove('hidden');
      midContent.textContent = mid;
    }

    const endPanel   = document.getElementById('panel-endgame');
    const endContent = document.getElementById('endgame-content');
    if (endPanel && endContent && end) {
      endPanel.classList.remove('hidden');
      endContent.textContent = end;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  SAVED GAMES SIDEBAR                                                 */
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

      const w    = game.metadata?.white    || 'White';
      const b    = game.metadata?.black    || 'Black';
      const res  = game.metadata?.result   || '*';
      const acc  = game.analysis?.summary?.accuracy;
      const eco  = game.analysis?.opening?.name || '';

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

  /* ------------------------------------------------------------------ */
  /*  SHOW / HIDE PANELS                                                  */
  /* ------------------------------------------------------------------ */

  function showAnalysisPanels() {
    const placeholder = document.getElementById('analysis-placeholder');
    if (placeholder) placeholder.style.display = 'none';
    const colRight = document.getElementById('col-right');
    if (colRight) colRight.style.display = 'flex';
    // Always-visible sections (1-3)
    ['panel-move-detail','panel-why-best','panel-alternates'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('hidden');
    });
    // Collapsible sections revealed (but stay collapsed until toggled)
    ['panel-summary','panel-opening'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('hidden');
    });
  }

  function hideAnalysisPanels() {
    ['panel-summary','panel-graph','panel-opening','panel-move-detail',
     'panel-why-best','panel-alternates','panel-middlegame','panel-endgame'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    const placeholder = document.getElementById('analysis-placeholder');
    if (placeholder) placeholder.style.display = '';
    const navAccWrap = document.getElementById('navbar-acc-wrap');
    if (navAccWrap) navAccWrap.classList.add('hidden');
  }

  /* ------------------------------------------------------------------ */
  /*  SIDEBAR TOGGLE                                                      */
  /* ------------------------------------------------------------------ */

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
    div.id    = 'debug-parse-error';
    div.style.cssText = `
      position:fixed; bottom:16px; right:16px; left:16px; max-height:200px;
      background:#1a0a0a; border:1px solid #8b2020; border-radius:8px;
      padding:12px; overflow-y:auto; z-index:800; font-family:monospace;
      font-size:11px; color:#f08080;
    `;
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

  /* ------------------------------------------------------------------ */
  /*  PATTERNS SUMMARY PANEL (cross-game recommendations)                */
  /* ------------------------------------------------------------------ */

  function renderPatternsSummary() {
    const panel = document.getElementById('panel-patterns');
    if (!panel) return;

    let recs = null;
    try {
      const raw = localStorage.getItem('csa_recommendations');
      recs = raw ? JSON.parse(raw) : null;
    } catch (_) {}

    if (!recs) {
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');

    const content = document.getElementById('patterns-summary-content');
    if (!content) return;

    const overall  = recs.overallAssessment || '';
    const topTwo   = (recs.topWeaknesses   || []).slice(0, 2);
    const coach    = recs.coachMessage      || '';

    const weakHtml = topTwo.map(w => {
      const sev = (w.severity || 'moderate').toLowerCase();
      return `<div class="patterns-weakness-mini sev-${escapeHtml(sev)}">
        <div class="patterns-weakness-mini-title">${escapeHtml(w.title || '')}</div>
        <div class="patterns-weakness-mini-freq">${escapeHtml(w.frequency || '')}</div>
      </div>`;
    }).join('');

    content.innerHTML =
      `<p class="patterns-overall">${escapeHtml(overall)}</p>` +
      weakHtml +
      (coach ? `<div class="patterns-coach-msg">${escapeHtml(coach)}</div>` : '') +
      `<a href="recommendations.html" class="patterns-see-full">See full report →</a>`;
  }

  document.addEventListener('DOMContentLoaded', initDrawer);

  return {
    updateEvalBar,
    setEvalMate,
    renderGameHeader,
    updateNameplates,
    renderMoveList,
    setActivePly,
    renderGameSummary,
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
    renderPatternsSummary
  };
})();

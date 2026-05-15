/* ============================================================
   app.js — main entry point, state management
   ============================================================ */

const App = (() => {

  let playerColor = 'white';

  /* ---- mass import state ---- */
  let massImportQueue             = null;
  let massImportIndex             = 0;
  let massImportCountdownInterval = null;

  const state = {
    currentPly:     0,
    fens:           [],
    verboseHistory: [],
    analysisData:   null,
    metadata:       {},
    pgn:            '',
    currentGameId:  null,
    totalPlies:     0
  };

  /* ------------------------------------------------------------------ */
  /*  INIT                                                                */
  /* ------------------------------------------------------------------ */

  function getGameIdFromUrl() {
    return new URLSearchParams(window.location.search).get('gameId');
  }

  function init() {
    if (typeof initNav === 'function') initNav('analyzer');
    Board.init(document.getElementById('chess-board'));

    const initialChess = new Chess();
    Board.setPosition(initialChess, null, null, null, null);

    setupApiKeyModal();
    setupDropzone();
    setupColorToggle();
    setupNavigation();
    setupKeyboard();
    setupSidebar();
    setupErrorDismiss();
    setupNewGameBtn();

    UI.initCoachChat(() => ({
      currentPly:   state.currentPly,
      analysisData: state.analysisData,
      playerColor,
      metadata:     state.metadata
    }));

    const gameId = getGameIdFromUrl();
    if (gameId) {
      const savedGame = Storage.loadGame(gameId);
      if (savedGame && (savedGame.analysis || savedGame.pgn)) {
        if (savedGame.analysis) {
          playerColor = savedGame.playerColor || 'white';
          const parsed = Analysis.parsePGN(savedGame.pgn);
          if (parsed.valid) {
            loadGameIntoApp(savedGame.pgn, savedGame.metadata, parsed.verboseHistory, savedGame.analysis, savedGame.id);
          } else {
            UI.showError('Saved game PGN is invalid.');
          }
        } else {
          UI.showError('This game has no analysis. Please re-analyze it.');
        }
      } else {
        UI.showError('Game not found in storage.');
      }
      return;
    }

    if (checkMassImportQueue()) return;
    checkPendingPgn();
  }

  /* ------------------------------------------------------------------ */
  /*  MASS IMPORT                                                         */
  /* ------------------------------------------------------------------ */

  function checkMassImportQueue() {
    const queueJson = sessionStorage.getItem('csa_import_queue');
    if (!queueJson) return false;
    let queue, index;
    try {
      queue = JSON.parse(queueJson);
      index = parseInt(sessionStorage.getItem('csa_import_index') || '0', 10);
    } catch (e) { clearMassImport(); return false; }

    if (!Array.isArray(queue) || queue.length === 0 || index >= queue.length) {
      clearMassImport(); return false;
    }

    massImportQueue = queue;
    massImportIndex = index;
    showMassImportBanner();

    const { pgn, color } = queue[index];
    const textarea = document.getElementById('pgn-input');
    if (!textarea) return false;
    textarea.value = pgn;
    applyPlayerColor(color === 'black' ? 'black' : 'white');
    setTimeout(handleAnalyze, 500);
    return true;
  }

  function createMassImportBanner() {
    if (document.getElementById('mass-import-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'mass-import-banner';
    banner.className = 'mass-import-banner';
    banner.innerHTML = `
      <span class="mass-banner-label" id="mass-banner-label"></span>
      <div class="mass-banner-progress-wrap">
        <div class="mass-banner-progress-bar" id="mass-banner-bar" style="width:0%"></div>
      </div>
      <span class="mass-banner-status" id="mass-banner-status"></span>
      <button class="mass-banner-btn mass-banner-skip" id="mass-banner-skip">Skip this game</button>
      <button class="mass-banner-btn mass-banner-stop" id="mass-banner-stop">Stop import</button>
    `;
    document.body.prepend(banner);
    document.body.style.paddingTop = '50px';

    document.getElementById('mass-banner-skip').addEventListener('click', () => {
      clearMassImportCountdown();
      advanceMassImport();
    });
    document.getElementById('mass-banner-stop').addEventListener('click', () => {
      const btn = document.getElementById('mass-banner-stop');
      if (btn && btn.dataset.done) { removeMassImportBanner(); return; }
      clearMassImportCountdown();
      clearMassImport();
      removeMassImportBanner();
    });
  }

  function showMassImportBanner() {
    createMassImportBanner();
    const total = massImportQueue.length, current = massImportIndex + 1;
    updateBannerProgress(current, total, `Analyzing game ${current} of ${total}...`);
  }

  function updateBannerProgress(current, total, statusText) {
    const label  = document.getElementById('mass-banner-label');
    const bar    = document.getElementById('mass-banner-bar');
    const status = document.getElementById('mass-banner-status');
    if (label)  label.textContent  = `Mass Import: Game ${current} of ${total}`;
    if (bar)    bar.style.width    = `${Math.round((current / total) * 100)}%`;
    if (status) status.textContent = statusText || '';
  }

  function removeMassImportBanner() {
    const banner = document.getElementById('mass-import-banner');
    if (banner) banner.remove();
    document.body.style.paddingTop = '';
  }

  function clearMassImportCountdown() {
    if (massImportCountdownInterval) { clearInterval(massImportCountdownInterval); massImportCountdownInterval = null; }
  }

  function clearMassImport() {
    sessionStorage.removeItem('csa_import_queue');
    sessionStorage.removeItem('csa_import_index');
    massImportQueue = null; massImportIndex = 0;
    clearMassImportCountdown();
  }

  function advanceMassImport() {
    const nextIndex = massImportIndex + 1;
    if (nextIndex >= massImportQueue.length) {
      const total = massImportQueue.length;
      clearMassImport();
      const label = document.getElementById('mass-banner-label');
      const bar   = document.getElementById('mass-banner-bar');
      const status= document.getElementById('mass-banner-status');
      const skip  = document.getElementById('mass-banner-skip');
      const stop  = document.getElementById('mass-banner-stop');
      if (label)  label.textContent = `All ${total} game${total !== 1 ? 's' : ''} analyzed!`;
      if (bar)    bar.style.width   = '100%';
      if (status) status.innerHTML  = `<a href="recommendations.html" style="color:var(--az-blue);font-weight:600">View updated recommendations →</a>`;
      if (skip)   skip.style.display = 'none';
      if (stop) { stop.textContent = 'Dismiss'; stop.className = 'mass-banner-btn mass-banner-done'; stop.dataset.done = '1'; }
      if (typeof Recommendations !== 'undefined') {
        Recommendations.generateRecommendations().then(recs => {
          if (recs) localStorage.setItem('csa_recommendations', JSON.stringify(recs));
        }).catch(() => {});
      }
    } else {
      sessionStorage.setItem('csa_import_index', String(nextIndex));
      window.location.reload();
    }
  }

  function onMassImportGameComplete() {
    if (!massImportQueue) return;
    const total = massImportQueue.length, current = massImportIndex + 1;
    if (current >= total) { advanceMassImport(); return; }
    let remaining = 3;
    const statusEl = document.getElementById('mass-banner-status');
    const refresh  = () => { if (statusEl) statusEl.textContent = `Game ${current} of ${total} analyzed — next in ${remaining}s...`; };
    refresh();
    massImportCountdownInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) { clearMassImportCountdown(); advanceMassImport(); } else { refresh(); }
    }, 1000);
  }

  function checkPendingPgn() {
    const pgn   = sessionStorage.getItem('pending_pgn');
    const color = sessionStorage.getItem('pending_color') || 'white';
    if (!pgn) return;
    sessionStorage.removeItem('pending_pgn');
    sessionStorage.removeItem('pending_color');

    const textarea = document.getElementById('pgn-input');
    if (!textarea) return;
    textarea.value = pgn;
    applyPlayerColor(color === 'black' ? 'black' : 'white');
    setTimeout(handleAnalyze, 500);
  }

  /* ------------------------------------------------------------------ */
  /*  API KEY MODAL (no-op — Railway handles the key)                    */
  /* ------------------------------------------------------------------ */
  function setupApiKeyModal() { /* no-op */ }

  /* ------------------------------------------------------------------ */
  /*  NEW GAME BUTTON                                                     */
  /* ------------------------------------------------------------------ */

  function setupNewGameBtn() {
    // In new layout there is no separate new-game-btn; but analyze is available
    // from the drop zone which is always accessible by closing the analysis view.
    // We keep this as a no-op for now.
  }

  /* ------------------------------------------------------------------ */
  /*  DROPZONE & COLOR TOGGLE                                             */
  /* ------------------------------------------------------------------ */

  function setupDropzone() {
    const dropzone  = document.getElementById('az-pgn-dropzone');
    const fileInput = document.getElementById('pgn-file-input');
    const textarea  = document.getElementById('pgn-input');
    const filenameEl= document.getElementById('pgn-filename');
    const analyzeBtn= document.getElementById('analyze-btn');

    if (!dropzone || !fileInput || !textarea) return;

    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) readPgnFile(fileInput.files[0]);
      fileInput.value = '';
    });

    let dragDepth = 0;
    dropzone.addEventListener('dragover', e => { e.preventDefault(); });
    dropzone.addEventListener('dragenter', e => {
      e.preventDefault();
      if (++dragDepth === 1) dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', () => {
      if (--dragDepth === 0) dropzone.classList.remove('drag-over');
    });
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dragDepth = 0;
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) readPgnFile(e.dataTransfer.files[0]);
    });

    function readPgnFile(file) {
      hidePgnError();
      if (!file.name.toLowerCase().endsWith('.pgn')) { showPgnError('Please upload a .pgn file'); return; }
      const reader = new FileReader();
      reader.onload = evt => {
        textarea.value = evt.target.result;
        if (filenameEl) { filenameEl.textContent = '📄 ' + file.name + ' loaded'; filenameEl.classList.remove('hidden'); }
      };
      reader.onerror = () => showPgnError('Failed to read the file.');
      reader.readAsText(file);
    }

    if (analyzeBtn) analyzeBtn.addEventListener('click', handleAnalyze);

    // Auto-detect color from typed PGN
    let detectDebounce;
    textarea.addEventListener('input', () => {
      clearTimeout(detectDebounce);
      detectDebounce = setTimeout(() => {
        const text = textarea.value || '';
        const white = (text.match(/\[White "([^"]+)"\]/) || [])[1] || '';
        const black = (text.match(/\[Black "([^"]+)"\]/) || [])[1] || '';
        const detected = detectColorFromPgn({ white, black });
        if (detected) applyPlayerColor(detected, true);
      }, 300);
    });
  }

  function setupColorToggle() {
    const whiteBtn = document.getElementById('btn-color-white');
    const blackBtn = document.getElementById('btn-color-black');
    if (!whiteBtn || !blackBtn) return;
    whiteBtn.addEventListener('click', () => {
      playerColor = 'white';
      whiteBtn.classList.add('selected');
      blackBtn.classList.remove('selected');
      const autoMsg = document.getElementById('color-auto-msg');
      if (autoMsg) autoMsg.classList.add('hidden');
    });
    blackBtn.addEventListener('click', () => {
      playerColor = 'black';
      blackBtn.classList.add('selected');
      whiteBtn.classList.remove('selected');
      const autoMsg = document.getElementById('color-auto-msg');
      if (autoMsg) autoMsg.classList.add('hidden');
    });
  }

  function setAnalyzing(loading, phase) {
    const btn     = document.getElementById('analyze-btn');
    if (!btn) return;
    const text    = btn.querySelector('.btn-text');
    const spinner = document.getElementById('analyze-spinner');
    btn.disabled  = loading;
    btn.classList.toggle('loading', loading);
    if (text) {
      if (!loading)                text.textContent = 'Analyze Game';
      else if (phase === 'claude') text.textContent = 'Consulting Claude…';
      else                         text.textContent = 'Running Stockfish…';
    }
    if (spinner) spinner.classList.toggle('hidden', !loading);
  }

  function showPgnError(msg) {
    const el = document.getElementById('pgn-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function hidePgnError() {
    const el = document.getElementById('pgn-error');
    if (el) el.classList.add('hidden');
  }

  function detectColorFromPgn(metadata) {
    const rawUsername = localStorage.getItem('csa_chesscom_username') || '';
    const ccUser      = rawUsername.toLowerCase();
    const pgmWhite    = (metadata.white || '').toLowerCase();
    const pgmBlack    = (metadata.black || '').toLowerCase();
    if (!ccUser) return null;
    if (pgmWhite === ccUser) return 'white';
    if (pgmBlack === ccUser) return 'black';
    return null;
  }

  function applyPlayerColor(color, autoDetected = false) {
    playerColor = color;
    const whiteBtn = document.getElementById('btn-color-white');
    const blackBtn = document.getElementById('btn-color-black');
    whiteBtn?.classList.remove('selected');
    blackBtn?.classList.remove('selected');
    if (color === 'black') blackBtn?.classList.add('selected');
    else                   whiteBtn?.classList.add('selected');
    const autoMsg = document.getElementById('color-auto-msg');
    if (autoMsg) {
      if (autoDetected) {
        autoMsg.textContent = 'Playing as ' + (color === 'white' ? 'White' : 'Black') + ' (auto-detected)';
        autoMsg.classList.remove('hidden');
      } else {
        autoMsg.classList.add('hidden');
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  ANALYZE                                                             */
  /* ------------------------------------------------------------------ */

  async function handleAnalyze() {
    hidePgnError();
    UI.hideError();

    const pgn = (document.getElementById('pgn-input').value || '').trim();
    if (!pgn) { showPgnError('Please paste a PGN before analyzing.'); return; }

    const parsed = Analysis.parsePGN(pgn);
    if (!parsed.valid) { showPgnError(parsed.error); return; }

    const detected = detectColorFromPgn(parsed.metadata);
    if (detected) applyPlayerColor(detected, true);

    const fens = buildFens(parsed.verboseHistory);

    // Phase 1: Stockfish
    setAnalyzing(true, 'stockfish');
    UI.showProgress(0, fens.length);

    let sfResults;
    try {
      sfResults = await Engine.analyzeAllPositions(fens, (done, total) => UI.showProgress(done, total));
    } catch (err) {
      setAnalyzing(false);
      UI.hideProgress();
      handleAnalysisError(err);
      return;
    }

    UI.hideProgress();

    // Phase 2: Classify + accuracy
    const classifiedMoves = Analysis.classifyMoves(sfResults, parsed.verboseHistory);
    const accuracy        = Analysis.calculateAccuracy(classifiedMoves, playerColor);

    // Phase 3: Render board immediately
    const partialAnalysis = Analysis.buildAnalysis(classifiedMoves, accuracy, null, parsed.metadata, playerColor);
    const gameId          = Storage.saveGame(pgn, parsed.metadata, partialAnalysis, fens, playerColor);
    loadGameIntoApp(pgn, parsed.metadata, parsed.verboseHistory, partialAnalysis, gameId);
    setAnalyzing(false);
    UI.showCoachLoading();

    // Phase 4: Claude (non-blocking)
    const pastGames = Storage.loadAllGames();
    Analysis.callClaude(parsed.metadata, classifiedMoves, pastGames, playerColor)
      .then(claudeData => {
        const fullAnalysis = Analysis.buildAnalysis(classifiedMoves, accuracy, claudeData, parsed.metadata, playerColor);

        try {
          const key    = 'csa_game_' + gameId;
          const stored = JSON.parse(localStorage.getItem(key) || 'null');
          if (stored) { stored.analysis = fullAnalysis; localStorage.setItem(key, JSON.stringify(stored)); }
        } catch (_) {}

        state.analysisData = fullAnalysis;

        UI.hideCoachLoading();
        UI.renderGameSummary(fullAnalysis.summary || {});
        UI.renderOpeningPanel(fullAnalysis.opening || {});
        UI.renderGameNotes(fullAnalysis);
        const moveData = (fullAnalysis.moves || []).find(m => m.ply === state.currentPly) || null;
        UI.renderMoveDetail(moveData, state.currentPly, playerColor);
        UI.revealCoachingContent();
        UI.renderFullReport(fullAnalysis, fullAnalysis.moves, playerColor, gameId);
        UI.renderCoachSummary(fullAnalysis.summary || {}, gameId);
        UI.sendCoachOpeningMessage(fullAnalysis.summary || {});

        if (massImportQueue) { onMassImportGameComplete(); return; }

        if (typeof Recommendations !== 'undefined') {
          UI.showToast('Updating recommendations...');
          Recommendations.generateRecommendations().then(recs => {
            if (recs) { localStorage.setItem('csa_recommendations', JSON.stringify(recs)); UI.renderPatternsSummary(); }
          }).catch(() => {});
        }
      })
      .catch(err => {
        UI.hideCoachLoading();
        handleAnalysisError(err);
        if (massImportQueue) onMassImportGameComplete();
      });
  }

  function handleAnalysisError(err) {
    if (err.code === 'ENGINE_ERROR')  { UI.showError('Stockfish error: ' + err.message); return; }
    if (err.code === 'PARSE_ERROR')   { UI.showError('Claude returned unparseable JSON.'); UI.showParseError(err.rawText || ''); return; }
    if (err.code === 'NETWORK_ERROR') { UI.showError('Network error: ' + err.message); return; }
    if (err.status === 401)           { UI.showError('Authentication failed (401).'); return; }
    if (err.status === 429)           { UI.showError('Rate limited (429). Please wait and try again.'); return; }
    UI.showError('Error: ' + (err.message || String(err)));
  }

  /* ------------------------------------------------------------------ */
  /*  LOAD GAME INTO APP                                                  */
  /* ------------------------------------------------------------------ */

  function loadGameIntoApp(pgn, metadata, verboseHistory, analysisData, gameId) {
    state.pgn            = pgn;
    state.metadata       = metadata;
    state.verboseHistory = verboseHistory;
    state.analysisData   = analysisData;
    state.currentGameId  = gameId;
    state.totalPlies     = verboseHistory.length;
    state.fens           = buildFens(verboseHistory);

    UI.showAnalysisPanels();
    UI.updateTopbarChips(metadata, playerColor);
    UI.updateNameplates(metadata, playerColor);
    UI.renderMoveList(verboseHistory, analysisData, navigateToPly);
    UI.renderGameSummary(analysisData.summary || {});
    UI.renderEvalGraph(analysisData.moves || [], navigateToPly);
    UI.renderOpeningPanel(analysisData.opening || {});
    UI.renderGameNotes(analysisData);
    UI.renderFullReport(analysisData, analysisData.moves, playerColor, gameId);

    // Orient board: player's pieces at bottom
    const shouldBeFlipped = (playerColor === 'black');
    if (Board.isFlipped() !== shouldBeFlipped) Board.flip();

    // Store critical fen for practice board
    const critPly = parseInt(sessionStorage.getItem('az_critical_ply') || '0', 10);
    if (critPly > 0 && state.fens[critPly]) {
      sessionStorage.setItem('az_critical_fen', state.fens[critPly]);
    }

    navigateToPly(0);
    UI.renderPatternsSummary();
  }

  function buildFens(verboseHistory) {
    const chess = new Chess();
    const fens  = [chess.fen()];
    verboseHistory.forEach(move => { chess.move(move.san); fens.push(chess.fen()); });
    return fens;
  }

  /* ------------------------------------------------------------------ */
  /*  NAVIGATION                                                          */
  /* ------------------------------------------------------------------ */

  function setupNavigation() {
    document.getElementById('btn-first').addEventListener('click', () => navigateToPly(0));
    document.getElementById('btn-prev' ).addEventListener('click', () => navigateToPly(state.currentPly - 1));
    document.getElementById('btn-next' ).addEventListener('click', () => navigateToPly(state.currentPly + 1));
    document.getElementById('btn-last' ).addEventListener('click', () => navigateToPly(state.totalPlies));
    document.getElementById('btn-flip' ).addEventListener('click', () => { Board.flip(); navigateToPly(state.currentPly); });
  }

  function setupKeyboard() {
    document.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (e.key === 'ArrowLeft')  { e.preventDefault(); navigateToPly(state.currentPly - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); navigateToPly(state.currentPly + 1); }
      if (e.key === 'ArrowUp')    { e.preventDefault(); navigateToPly(0); }
      if (e.key === 'ArrowDown')  { e.preventDefault(); navigateToPly(state.totalPlies); }
    });
  }

  function navigateToPly(ply) {
    if (state.totalPlies === 0) return;
    const clamped = Math.max(0, Math.min(state.totalPlies, ply));
    state.currentPly = clamped;

    const fen   = state.fens[clamped] || state.fens[0];
    const chess = new Chess(fen);

    let fromSq = null, toSq = null, bFrom = null, bTo = null;
    if (clamped > 0) {
      const move = state.verboseHistory[clamped - 1];
      fromSq = move?.from || null;
      toSq   = move?.to   || null;
    }

    const moveData = state.analysisData?.moves?.find(m => m.ply === clamped);
    if (moveData) { bFrom = moveData.bestMoveFrom || null; bTo = moveData.bestMoveTo || null; }

    Board.setPosition(chess, fromSq, toSq, bFrom, bTo);
    updateEvalDisplay(moveData, clamped);

    // Material bars
    UI.renderMaterialBars(chess, playerColor);

    if (clamped > 0) UI.setActivePly(clamped);
    UI.renderMoveDetail(moveData || null, clamped, playerColor);
    UI.updateGraphCursor(clamped, state.totalPlies);
    updateNavButtons();
  }

  function updateEvalDisplay(moveData, ply) {
    if (!moveData && ply === 0) { UI.updateEvalBar(0, playerColor); return; }
    if (!moveData) return;
    const ev = moveData.eval;
    if (typeof ev === 'number' && isFinite(ev)) UI.updateEvalBar(ev, playerColor);
  }

  function updateNavButtons() {
    const ply = state.currentPly, total = state.totalPlies;
    document.getElementById('btn-first').disabled = ply <= 0;
    document.getElementById('btn-prev' ).disabled = ply <= 0;
    document.getElementById('btn-next' ).disabled = ply >= total;
    document.getElementById('btn-last' ).disabled = ply >= total;
  }

  /* ------------------------------------------------------------------ */
  /*  SIDEBAR                                                             */
  /* ------------------------------------------------------------------ */

  function setupSidebar() {
    document.getElementById('btn-games').addEventListener('click', openSidebar);
    document.getElementById('close-sidebar').addEventListener('click', UI.closeSidebar);
    document.getElementById('sidebar-overlay').addEventListener('click', UI.closeSidebar);
  }

  function openSidebar() {
    const games = Storage.loadAllGames();
    UI.renderGamesList(games, loadSavedGame, deleteSavedGame);
    UI.openSidebar();
  }

  function loadSavedGame(id) {
    const game = Storage.loadGame(id);
    if (!game) { UI.showError('Could not load game.'); return; }
    UI.closeSidebar();
    const parsed = Analysis.parsePGN(game.pgn);
    if (!parsed.valid) { UI.showError('Saved game PGN is invalid.'); return; }
    playerColor = game.playerColor || 'white';
    loadGameIntoApp(game.pgn, game.metadata, parsed.verboseHistory, game.analysis, id);
    document.getElementById('pgn-input').value = game.pgn;
  }

  function deleteSavedGame(id) {
    Storage.deleteGame(id);
    UI.renderGamesList(Storage.loadAllGames(), loadSavedGame, deleteSavedGame);
  }

  /* ------------------------------------------------------------------ */
  /*  ERROR DISMISS                                                       */
  /* ------------------------------------------------------------------ */

  function setupErrorDismiss() {
    const btn = document.getElementById('error-dismiss');
    if (btn) btn.addEventListener('click', UI.hideError);
  }

  /* ------------------------------------------------------------------ */
  /*  BOOT                                                                */
  /* ------------------------------------------------------------------ */

  document.addEventListener('DOMContentLoaded', init);

  return { navigateToPly };
})();

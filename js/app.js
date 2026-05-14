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
    const search = window.location.search;
    const params = new URLSearchParams(search);
    const id = params.get('gameId');
    return id;
  }

  function init() {
    if (typeof initNav === 'function') initNav('analyzer');
    Board.init(document.getElementById('chess-board'));

    const initialChess = new Chess();
    Board.setPosition(initialChess, null, null, null, null);

    setupApiKeyModal();
    setupTopbar();
    setupNavigation();
    setupKeyboard();
    setupSidebar();
    setupErrorDismiss();

    const gameId = getGameIdFromUrl();

    if (gameId) {
      const savedGame = Storage.loadGame(gameId);

      if (savedGame && (savedGame.analysis || savedGame.pgn)) {
        if (savedGame.analysis) {
          playerColor = savedGame.playerColor || 'white';

          const parsed = Analysis.parsePGN(savedGame.pgn);
          if (parsed.valid) {
            document.getElementById('pgn-input').value = savedGame.pgn;
            const filenameEl = document.getElementById('pgn-filename');
            if (filenameEl) {
              filenameEl.textContent = '📂 Loaded from archive';
              filenameEl.classList.remove('hidden');
            }
            loadGameIntoApp(savedGame.pgn, savedGame.metadata, parsed.verboseHistory, savedGame.analysis, savedGame.id);
            collapseTopbar();
          } else {
            console.error('[App] Could not load game from storage - PGN invalid');
            UI.showError('Saved game PGN is invalid.');
          }
        } else {
          // PGN exists but no analysis — ask user to re-analyze
          document.getElementById('pgn-input').value = savedGame.pgn;
          const filenameEl = document.getElementById('pgn-filename');
          if (filenameEl) {
            filenameEl.textContent = '📂 Loaded from archive — please re-analyze';
            filenameEl.classList.remove('hidden');
          }
          const topbar = document.getElementById('topbar');
          if (topbar) topbar.classList.remove('collapsed');
          const newGameBtn = document.getElementById('new-game-btn');
          if (newGameBtn) newGameBtn.classList.add('hidden');
          UI.showError('This game was saved before full analysis was available. Please re-analyze it.');
        }
      } else {
        console.error('[App] Could not load game from storage');
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
    } catch (e) {
      clearMassImport();
      return false;
    }

    if (!Array.isArray(queue) || queue.length === 0 || index >= queue.length) {
      clearMassImport();
      return false;
    }

    massImportQueue = queue;
    massImportIndex = index;

    showMassImportBanner();

    const { pgn, color } = queue[index];
    const textarea = document.getElementById('pgn-input');
    if (!textarea) return false;
    textarea.value = pgn;
    applyPlayerColor(color === 'black' ? 'black' : 'white');

    const topbar = document.getElementById('topbar');
    if (topbar) topbar.classList.remove('collapsed');
    const newGameBtn = document.getElementById('new-game-btn');
    if (newGameBtn) newGameBtn.classList.add('hidden');

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
      if (btn && btn.dataset.done) {
        removeMassImportBanner();
        return;
      }
      clearMassImportCountdown();
      clearMassImport();
      removeMassImportBanner();
    });
  }

  function showMassImportBanner() {
    createMassImportBanner();
    const total   = massImportQueue.length;
    const current = massImportIndex + 1;
    updateBannerProgress(current, total, `Analyzing game ${current} of ${total}...`);
  }

  function updateBannerProgress(current, total, statusText) {
    const label  = document.getElementById('mass-banner-label');
    const bar    = document.getElementById('mass-banner-bar');
    const status = document.getElementById('mass-banner-status');
    if (label)  label.textContent    = `Mass Import: Game ${current} of ${total}`;
    if (bar)    bar.style.width      = `${Math.round((current / total) * 100)}%`;
    if (status) status.textContent   = statusText || '';
  }

  function removeMassImportBanner() {
    const banner = document.getElementById('mass-import-banner');
    if (banner) banner.remove();
    document.body.style.paddingTop = '';
  }

  function clearMassImportCountdown() {
    if (massImportCountdownInterval) {
      clearInterval(massImportCountdownInterval);
      massImportCountdownInterval = null;
    }
  }

  function clearMassImport() {
    sessionStorage.removeItem('csa_import_queue');
    sessionStorage.removeItem('csa_import_index');
    massImportQueue = null;
    massImportIndex = 0;
    clearMassImportCountdown();
  }

  function advanceMassImport() {
    const nextIndex = massImportIndex + 1;
    if (nextIndex >= massImportQueue.length) {
      const total = massImportQueue.length;
      clearMassImport();

      const label  = document.getElementById('mass-banner-label');
      const bar    = document.getElementById('mass-banner-bar');
      const status = document.getElementById('mass-banner-status');
      const skip   = document.getElementById('mass-banner-skip');
      const stop   = document.getElementById('mass-banner-stop');
      if (label)  label.textContent  = `All ${total} game${total !== 1 ? 's' : ''} analyzed!`;
      if (bar)    bar.style.width    = '100%';
      if (status) status.innerHTML   =
        `<a href="recommendations.html" style="color:var(--accent);font-weight:600">View updated recommendations →</a>`;
      if (skip)   skip.style.display = 'none';
      if (stop) {
        stop.textContent  = 'Dismiss';
        stop.className    = 'mass-banner-btn mass-banner-done';
        stop.dataset.done = '1';
      }

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
    const total   = massImportQueue.length;
    const current = massImportIndex + 1;

    if (current >= total) {
      advanceMassImport();
      return;
    }

    let remaining = 3;
    const statusEl = document.getElementById('mass-banner-status');
    const refresh  = () => {
      if (statusEl) statusEl.textContent =
        `Game ${current} of ${total} analyzed — analyzing next game in ${remaining}s...`;
    };
    refresh();

    massImportCountdownInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearMassImportCountdown();
        advanceMassImport();
      } else {
        refresh();
      }
    }, 1000);
  }

  function checkPendingPgn() {
    const pgn   = sessionStorage.getItem('pending_pgn');
    const color = sessionStorage.getItem('pending_color') || 'white';

    if (!pgn) {
      return;
    }

    sessionStorage.removeItem('pending_pgn');
    sessionStorage.removeItem('pending_color');

    const textarea = document.getElementById('pgn-input');
    if (!textarea) {
      console.error('[App] pgn-input textarea not found!');
      return;
    }

    textarea.value = pgn;

    applyPlayerColor(color === 'black' ? 'black' : 'white');

    // Ensure topbar is visible for the analyze call
    const topbar = document.getElementById('topbar');
    if (topbar) topbar.classList.remove('collapsed');
    const newGameBtn = document.getElementById('new-game-btn');
    if (newGameBtn) newGameBtn.classList.add('hidden');

    if (typeof handleAnalyze !== 'function') {
      console.error('[App] handleAnalyze is not a function!');
      return;
    }

    setTimeout(handleAnalyze, 500);
  }

  /* ------------------------------------------------------------------ */
  /*  API KEY MODAL (removed — Railway backend handles the key)          */
  /* ------------------------------------------------------------------ */

  function setupApiKeyModal() {
    // no-op: API key management moved to Railway backend
  }

  /* ------------------------------------------------------------------ */
  /*  TOPBAR & ANALYZE                                                    */
  /* ------------------------------------------------------------------ */

  function setupTopbar() {
    const analyzeBtn = document.getElementById('analyze-btn');
    const newGameBtn = document.getElementById('new-game-btn');
    const whiteBtn   = document.getElementById('btn-color-white');
    const blackBtn   = document.getElementById('btn-color-black');

    analyzeBtn.addEventListener('click', handleAnalyze);

    newGameBtn.addEventListener('click', () => {
      document.getElementById('topbar').classList.remove('collapsed');
      newGameBtn.classList.add('hidden');
    });

    if (whiteBtn && blackBtn) {
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

    // Auto-detect color from pasted/typed PGN headers (debounced)
    const pgnTextarea = document.getElementById('pgn-input');
    if (pgnTextarea) {
      let detectDebounce;
      pgnTextarea.addEventListener('input', () => {
        clearTimeout(detectDebounce);
        detectDebounce = setTimeout(() => {
          const text = pgnTextarea.value || '';
          const white = (text.match(/\[White "([^"]+)"\]/) || [])[1] || '';
          const black = (text.match(/\[Black "([^"]+)"\]/) || [])[1] || '';
          const detected = detectColorFromPgn({ white, black });
          if (detected) applyPlayerColor(detected, true);
        }, 300);
      });
    }

    setupDropzone();
  }

  function setupDropzone() {
    const dropzone  = document.getElementById('pgn-dropzone');
    const fileInput = document.getElementById('pgn-file-input');
    const textarea  = document.getElementById('pgn-input');
    const filenameEl = document.getElementById('pgn-filename');
    if (!dropzone || !fileInput || !textarea) return;

    // Click to open file browser
    dropzone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) readPgnFile(fileInput.files[0]);
      fileInput.value = '';
    });

    // Drag-and-drop — use a counter so dragleave on child elements doesn't flicker
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
      const files = e.dataTransfer.files;
      if (files.length > 0) readPgnFile(files[0]);
    });

    function readPgnFile(file) {
      hidePgnError();

      if (!file.name.toLowerCase().endsWith('.pgn')) {
        showPgnError('Please upload a .pgn file');
        if (filenameEl) filenameEl.classList.add('hidden');
        return;
      }

      const reader = new FileReader();
      reader.onload = evt => {
        textarea.value = evt.target.result;
        if (filenameEl) {
          filenameEl.textContent = '📄 ' + file.name + ' loaded';
          filenameEl.classList.remove('hidden');
        }
      };
      reader.onerror = () => showPgnError('Failed to read the file.');
      reader.readAsText(file);
    }
  }

  function collapseTopbar() {
    const pgnDropdown = document.getElementById('pgn-dropdown');
    if (pgnDropdown) pgnDropdown.classList.remove('open');
    const pgnLoadBtn = document.getElementById('pgn-load-btn');
    if (pgnLoadBtn) pgnLoadBtn.classList.remove('active');
    const topbar = document.getElementById('topbar');
    if (topbar) topbar.classList.add('collapsed');
    const newGameBtn = document.getElementById('new-game-btn');
    if (newGameBtn) newGameBtn.classList.remove('hidden');
  }

  function setAnalyzing(loading, phase) {
    const btn     = document.getElementById('analyze-btn');
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

    let result = null;
    if (ccUser) {
      if (pgmWhite === ccUser) result = 'white';
      else if (pgmBlack === ccUser) result = 'black';
    }

    return result;
  }

  function applyPlayerColor(color, autoDetected = false) {
    playerColor = color;
    const whiteBtn = document.getElementById('btn-color-white');
    const blackBtn = document.getElementById('btn-color-black');
    // Clear both first, then mark the correct one
    whiteBtn?.classList.remove('selected');
    blackBtn?.classList.remove('selected');
    if (color === 'black') {
      blackBtn?.classList.add('selected');
    } else {
      whiteBtn?.classList.add('selected');
    }
    const filenameEl = document.getElementById('pgn-filename');
    if (filenameEl) {
      filenameEl.textContent = 'Analyzing as ' + (color === 'white' ? 'White ○' : 'Black ●');
      filenameEl.classList.remove('hidden');
    }
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

  async function handleAnalyze() {
    hidePgnError();
    UI.hideError();

    const pgn = (document.getElementById('pgn-input').value || '').trim();
    if (!pgn) { showPgnError('Please paste a PGN before analyzing.'); return; }

    const parsed = Analysis.parsePGN(pgn);
    if (!parsed.valid) { showPgnError(parsed.error); return; }

    // Auto-detect player color from PGN headers; fall back to toggle selection
    const detected = detectColorFromPgn(parsed.metadata);
    if (detected) applyPlayerColor(detected, true);

    // Build the full FEN array (ply 0 = start position, ply N = after last move)
    const fens = buildFens(parsed.verboseHistory);

    // ---- Phase 1: Stockfish ----------------------------------------
    setAnalyzing(true, 'stockfish');
    UI.showProgress(0, fens.length);

    let sfResults;
    try {
      sfResults = await Engine.analyzeAllPositions(fens, (done, total) => {
        UI.showProgress(done, total);
      });
    } catch (err) {
      setAnalyzing(false);
      UI.hideProgress();
      handleAnalysisError(err);
      return;
    }

    UI.hideProgress();

    // ---- Phase 2: Classify + accuracy (synchronous) ----------------
    const classifiedMoves = Analysis.classifyMoves(sfResults, parsed.verboseHistory);
    const accuracy        = Analysis.calculateAccuracy(classifiedMoves, playerColor);

    // ---- Phase 3: Render board immediately (before Claude) ---------
    // Build a partial analysis with Stockfish data only (no explanations yet).
    // The board, move list, eval bar, eval graph, and move classifications are
    // all derived from Stockfish — they're available right now.
    const partialAnalysis = Analysis.buildAnalysis(classifiedMoves, accuracy, null, parsed.metadata, playerColor);
    const gameId          = Storage.saveGame(pgn, parsed.metadata, partialAnalysis, fens, playerColor);
    loadGameIntoApp(pgn, parsed.metadata, parsed.verboseHistory, partialAnalysis, gameId);
    collapseTopbar();
    setAnalyzing(false);
    UI.showCoachLoading();

    // ---- Phase 4: Claude in background (non-blocking) ---------------
    // The user can click through moves and see Stockfish classifications
    // while Claude is generating the coaching text.
    const pastGames = Storage.loadAllGames();
    Analysis.callClaude(parsed.metadata, classifiedMoves, pastGames, playerColor)
      .then(claudeData => {
        const fullAnalysis = Analysis.buildAnalysis(
          classifiedMoves, accuracy, claudeData, parsed.metadata, playerColor
        );

        // Patch the already-saved game entry in-place (same ID, no new timestamp)
        try {
          const key    = 'csa_game_' + gameId;
          const stored = JSON.parse(localStorage.getItem(key) || 'null');
          if (stored) {
            stored.analysis = fullAnalysis;
            localStorage.setItem(key, JSON.stringify(stored));
          }
        } catch (_) {}

        // Update live app state so future navigation picks up explanations
        state.analysisData = fullAnalysis;

        // Refresh all coaching panels with real Claude data
        UI.hideCoachLoading();
        UI.renderGameSummary(fullAnalysis.summary || {});
        UI.renderOpeningPanel(fullAnalysis.opening || {});
        UI.renderGameNotes(fullAnalysis);
        const moveData = (fullAnalysis.moves || []).find(m => m.ply === state.currentPly) || null;
        UI.renderMoveDetail(moveData, state.currentPly, playerColor);
        UI.revealCoachingContent();

        if (massImportQueue) {
          onMassImportGameComplete();
          return;
        }

        // Cross-game recommendations (non-blocking)
        if (typeof Recommendations !== 'undefined') {
          UI.showToast('Updating recommendations...');
          Recommendations.generateRecommendations().then(recs => {
            if (recs) {
              localStorage.setItem('csa_recommendations', JSON.stringify(recs));
              UI.renderPatternsSummary();
            }
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
    if (err.code === 'ENGINE_ERROR') {
      UI.showError('Stockfish error: ' + err.message + '. Your browser may not support Web Workers from CDN.');
      return;
    }
    if (err.code === 'PARSE_ERROR') {
      UI.showError('Claude returned unparseable JSON. See the debug box below.');
      UI.showParseError(err.rawText || '');
      return;
    }
    if (err.code === 'NETWORK_ERROR') {
      UI.showError('Network error: ' + err.message + '. Check your connection and try again.');
      return;
    }
    if (err.status === 401) {
      UI.showError('Authentication failed (401). There may be a server configuration issue.');
      return;
    }
    if (err.status === 429) {
      UI.showError('Rate limited (429). Please wait a moment and try again.');
      return;
    }
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
    UI.renderGameHeader(metadata);
    UI.updateNameplates(metadata, playerColor);
    UI.renderMoveList(verboseHistory, analysisData, navigateToPly);
    UI.renderGameSummary(analysisData.summary || {});
    UI.renderEvalGraph(analysisData.moves || [], navigateToPly);
    UI.renderOpeningPanel(analysisData.opening || {});
    UI.renderGameNotes(analysisData);

    // Auto-orient board with player's pieces at the bottom
    const shouldBeFlipped = (playerColor === 'black');
    if (Board.isFlipped() !== shouldBeFlipped) {
      Board.flip();
    }

    navigateToPly(0);
    UI.renderPatternsSummary();
  }

  function buildFens(verboseHistory) {
    const chess = new Chess();
    const fens  = [chess.fen()];
    verboseHistory.forEach(move => {
      chess.move(move.san);
      fens.push(chess.fen());
    });
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

    // Arrow shows the engine's best move from the CURRENT position
    const moveData = state.analysisData?.moves?.find(m => m.ply === clamped);
    if (moveData) {
      bFrom = moveData.bestMoveFrom || null;
      bTo   = moveData.bestMoveTo   || null;
    }

    Board.setPosition(chess, fromSq, toSq, bFrom, bTo);
    updateEvalDisplay(moveData, clamped);

    if (clamped > 0) UI.setActivePly(clamped);

    UI.renderMoveDetail(moveData || null, clamped, playerColor);
    UI.updateGraphCursor(clamped, state.totalPlies);

    updateNavButtons();
  }

  function updateEvalDisplay(moveData, ply) {
    if (!moveData && ply === 0) {
      UI.updateEvalBar(0, playerColor);
      return;
    }
    if (!moveData) return;
    const ev = moveData.eval;
    if (typeof ev === 'number' && isFinite(ev)) {
      UI.updateEvalBar(ev, playerColor);
    }
  }

  function updateNavButtons() {
    const ply   = state.currentPly;
    const total = state.totalPlies;
    document.getElementById('btn-first').disabled = ply <= 0;
    document.getElementById('btn-prev' ).disabled = ply <= 0;
    document.getElementById('btn-next' ).disabled = ply >= total;
    document.getElementById('btn-last' ).disabled = ply >= total;
  }

  /* ------------------------------------------------------------------ */
  /*  SIDEBAR / SAVED GAMES                                               */
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

    loadGameIntoApp(game.pgn, game.metadata, parsed.verboseHistory, game.analysis, id);
    collapseTopbar();
    document.getElementById('pgn-input').value = game.pgn;
  }

  function deleteSavedGame(id) {
    Storage.deleteGame(id);
    const games = Storage.loadAllGames();
    UI.renderGamesList(games, loadSavedGame, deleteSavedGame);
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

/* ============================================================
   app.js — main entry point, state management
   ============================================================ */

const App = (() => {

  let playerColor = 'white';

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
    console.log('[App] Full URL search string:', search);
    const params = new URLSearchParams(search);
    const id = params.get('gameId');
    console.log('[App] Parsed gameId:', id);
    return id;
  }

  function init() {
    console.log('[App] init() — DOMContentLoaded');
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
      console.log('[App] Loading saved game:', gameId);
      const savedGame = Storage.loadGame(gameId);
      console.log('[App] savedGame:', savedGame);

      if (savedGame && (savedGame.analysis || savedGame.pgn)) {
        if (savedGame.analysis) {
          playerColor = savedGame.playerColor || 'white';

          // Rebuild fens from PGN since they may not be saved in older games
          let gameFens = (savedGame.fens && savedGame.fens.length > 0) ? savedGame.fens : null;
          if (!gameFens) {
            const chessTemp = new Chess();
            chessTemp.load_pgn(savedGame.pgn);
            const moves  = chessTemp.history();
            const chess2 = new Chess();
            gameFens = [chess2.fen()];
            for (const move of moves) {
              chess2.move(move);
              gameFens.push(chess2.fen());
            }
          }

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
            console.log('[App] Game loaded successfully from archive');
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

    checkPendingPgn();
  }

  function autoLoadGame(gameId) {
    console.log('Loading saved game:', gameId);
    const game = Storage.loadGame(gameId);
    if (!game) { UI.showError('Game not found in storage.'); return; }
    const parsed = Analysis.parsePGN(game.pgn);
    if (!parsed.valid) { UI.showError('Saved game PGN is invalid.'); return; }
    document.getElementById('pgn-input').value = game.pgn;
    const filenameEl = document.getElementById('pgn-filename');
    if (filenameEl) {
      filenameEl.textContent = '📂 Loaded from archive';
      filenameEl.classList.remove('hidden');
    }
    loadGameIntoApp(game.pgn, game.metadata, parsed.verboseHistory, game.analysis, game.id);
    collapseTopbar();
  }

  function checkPendingPgn() {
    const pgn   = sessionStorage.getItem('pending_pgn');
    const color = sessionStorage.getItem('pending_color') || 'white';

    console.log('[App] checkPendingPgn — pgn length:', pgn ? pgn.length : 0);

    if (!pgn) {
      if (!Storage.getApiKey()) {
        window.location.href = 'index.html?needsKey=true';
      }
      return;
    }

    if (!Storage.getApiKey()) {
      window.location.href = 'index.html?needsKey=true';
      return;
    }

    sessionStorage.removeItem('pending_pgn');
    sessionStorage.removeItem('pending_color');

    const textarea = document.getElementById('pgn-input');
    if (!textarea) {
      console.error('[App] pgn-input textarea not found!');
      return;
    }

    console.log('[App] PGN first 100 chars:', pgn.slice(0, 100));

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
  /*  API KEY MODAL                                                       */
  /* ------------------------------------------------------------------ */

  function setupApiKeyModal() {
    const saveBtn    = document.getElementById('api-key-save');
    const input      = document.getElementById('api-key-input');
    const changeLink = document.getElementById('change-api-key-link');

    saveBtn.addEventListener('click', () => {
      const key = (input.value || '').trim();
      if (!key || !key.startsWith('sk-')) {
        input.style.borderColor = 'var(--danger)';
        return;
      }
      input.style.borderColor = '';
      Storage.setApiKey(key);
      hideApiKeyModal();
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveBtn.click();
      input.style.borderColor = '';
    });

    changeLink.addEventListener('click', e => {
      e.preventDefault();
      input.value = Storage.getApiKey();
      showApiKeyModal();
    });
  }

  function showApiKeyModal() {
    const modal = document.getElementById('api-key-modal');
    if (modal) modal.classList.remove('hidden');
    const input = document.getElementById('api-key-input');
    if (input) setTimeout(() => input.focus(), 50);
  }

  function hideApiKeyModal() {
    const modal = document.getElementById('api-key-modal');
    if (modal) modal.classList.add('hidden');
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

    console.log('Detecting color, username:', rawUsername);
    console.log('PGN White header:', metadata.white || '');
    console.log('PGN Black header:', metadata.black || '');

    let result = null;
    if (ccUser) {
      if (pgmWhite === ccUser) result = 'white';
      else if (pgmBlack === ccUser) result = 'black';
    }

    console.log('Detected color:', result);
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

    if (!Storage.getApiKey()) { showApiKeyModal(); return; }

    // Auto-detect player color from PGN headers; fall back to toggle selection
    const detected = detectColorFromPgn(parsed.metadata);
    if (detected) applyPlayerColor(detected, true);

    // Build the full FEN array (ply 0 = start position, ply N = after last move)
    const fens = buildFens(parsed.verboseHistory);

    console.log(`Analyzing as ${playerColor}, filtering moves accordingly`);

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

    // ---- Phase 3: Claude for natural language ----------------------
    setAnalyzing(true, 'claude');

    let claudeData;
    try {
      const pastGames = Storage.loadAllGames();
      claudeData = await Analysis.callClaude(parsed.metadata, classifiedMoves, pastGames, playerColor);
    } catch (err) {
      setAnalyzing(false);
      handleAnalysisError(err);
      return;
    }

    setAnalyzing(false);

    // ---- Phase 4: Merge and display --------------------------------
    const analysis   = Analysis.buildAnalysis(classifiedMoves, accuracy, claudeData, parsed.metadata, playerColor);
    const fensToSave = buildFens(parsed.verboseHistory);
    const gameId     = Storage.saveGame(pgn, parsed.metadata, analysis, fensToSave, playerColor);
    console.log('Analysis complete, calling UI render functions');
    console.log('Analysis data:', JSON.stringify(analysis).substring(0, 200));
    // Hide welcome state before rendering — actual class in analyzer.html is "analysis-placeholder"
    document.querySelector('.analysis-placeholder')?.style.setProperty('display', 'none');
    loadGameIntoApp(pgn, parsed.metadata, parsed.verboseHistory, analysis, gameId);
    collapseTopbar();
  }

  function handleAnalysisError(err) {
    if (err.code === 'NO_API_KEY') {
      showApiKeyModal();
      return;
    }
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
      UI.showError('Authentication failed (401). Your API key may be incorrect.');
      showApiKeyModal();
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

  function rebuildFens(pgn) {
    const parsed = Analysis.parsePGN(pgn);
    if (!parsed.valid) return [];
    return buildFens(parsed.verboseHistory);
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

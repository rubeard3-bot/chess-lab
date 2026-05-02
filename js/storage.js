const Storage = (() => {
  const GAME_PREFIX = 'csa_game_';
  const API_KEY_KEY = 'csa_api_key';
  const MAX_GAMES = 50;

  function getApiKey() {
    return localStorage.getItem(API_KEY_KEY) || '';
  }

  function setApiKey(key) {
    localStorage.setItem(API_KEY_KEY, key.trim());
  }

  function saveGame(pgn, metadata, analysis, fens, playerColor) {
    const id = Date.now().toString();
    const entry = {
      id,
      pgn,
      metadata,
      analysis,
      fens:        fens || [],
      playerColor: playerColor || 'white',
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(GAME_PREFIX + id, JSON.stringify(entry));
    pruneOldGames();
    return id;
  }

  function loadAllGames() {
    const games = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(GAME_PREFIX)) {
        try {
          const game = JSON.parse(localStorage.getItem(key));
          if (game) games.push(game);
        } catch (e) {}
      }
    }
    return games.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  }

  function loadGame(id) {
    const raw = localStorage.getItem(GAME_PREFIX + id);
    if (!raw) return null;
    try {
      const game = JSON.parse(raw);
      return game;
    } catch (e) { return null; }
  }

  function deleteGame(id) {
    localStorage.removeItem(GAME_PREFIX + id);
  }

  function pruneOldGames() {
    const games = loadAllGames();
    if (games.length > MAX_GAMES) {
      games.slice(MAX_GAMES).forEach(g => deleteGame(g.id));
    }
  }

  return { getApiKey, setApiKey, saveGame, loadAllGames, loadGame, deleteGame };
})();

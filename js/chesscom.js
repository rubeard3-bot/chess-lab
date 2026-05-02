/* ============================================================
   chesscom.js — Chess.com public API helpers (no auth required)
   ============================================================ */

const ChessCom = (() => {
  const BASE = 'https://api.chess.com/pub/player';

  async function apiFetch(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  async function fetchPlayerProfile(username) {
    const enc = encodeURIComponent(username);
    const [profile, stats] = await Promise.all([
      apiFetch(`${BASE}/${enc}`),
      apiFetch(`${BASE}/${enc}/stats`)
    ]);
    if (!profile) return null;

    const ratings = {};
    if (stats) {
      if (stats.chess_rapid?.last?.rating)     ratings.rapid     = stats.chess_rapid.last.rating;
      if (stats.chess_blitz?.last?.rating)     ratings.blitz     = stats.chess_blitz.last.rating;
      if (stats.chess_bullet?.last?.rating)    ratings.bullet    = stats.chess_bullet.last.rating;
      if (stats.chess_classical?.last?.rating) ratings.classical = stats.chess_classical.last.rating;
    }
    return {
      username: profile.username,
      avatar:   profile.avatar || null,
      title:    profile.title  || null,
      ratings
    };
  }

  async function fetchGameArchives(username) {
    const data = await apiFetch(`${BASE}/${encodeURIComponent(username)}/games/archives`);
    if (!data?.archives) return null;
    return [...data.archives].reverse();
  }

  async function fetchRecentGames(username, year, month) {
    const m    = String(month).padStart(2, '0');
    const data = await apiFetch(`${BASE}/${encodeURIComponent(username)}/games/${year}/${m}`);
    if (!data?.games) return null;
    return [...data.games].reverse();
  }

  return { fetchPlayerProfile, fetchGameArchives, fetchRecentGames };
})();

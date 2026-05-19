/* ============================================================
   recommendations.js — cross-game pattern analysis
   ============================================================ */

const Recommendations = (() => {
  const SERVER_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:4000'
    : 'https://chess-lab-production.up.railway.app';

  const RECS_KEY = 'csa_recommendations';
  const META_KEY = 'csa_recommendations_meta';

  let _toastTimer;

  function loadRecommendations() {
    try {
      const raw = localStorage.getItem(RECS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function shouldRegenerate() {
    const games = Storage.loadAllGames();
    const meta  = (() => {
      try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; }
      catch (_) { return {}; }
    })();
    return games.length !== (meta.gameCount || 0);
  }

  function _notify(msg) {
    const el = document.getElementById('rec-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function _setProgress(label) {
    const btn = document.getElementById('rec-regenerate-btn');
    if (btn) btn.textContent = label;
    _notify(label);
  }

  async function generateRecommendations() {
    if (window._recsInFlight) {
      console.log('[Recommendations] Call already in flight, skipping.');
      return null;
    }
    window._recsInFlight = true;
    try {
      let games = Storage.loadAllGames();
      const totalGameCount = games.length;
      console.log('[Recommendations] Starting generation, games found:', totalGameCount);
      if (totalGameCount === 0) return null;

      games = games.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).slice(0, 10);

      _setProgress('Analyzing your games...');

      const response = await fetch(`${SERVER_URL}/api/recommendations`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ games })
      });

      console.log('[Recommendations] Server response status:', response.status);

      if (!response.ok) {
        const errText = await response.text();
        console.error('[Recommendations] Server error:', errText.substring(0, 500));
        if (response._partialFailure) {
          window.dispatchEvent(new CustomEvent('rec-parse-error', {
            detail: { message: `Partial results — ${response._partialFailure}` }
          }));
        }
        return null;
      }

      const merged = await response.json();

      if (merged._partialFailure) {
        console.warn('[Recommendations] Partial result:', merged._partialFailure);
        window.dispatchEvent(new CustomEvent('rec-parse-error', {
          detail: { message: `Partial results — ${merged._partialFailure}` }
        }));
      }

      console.log('[Recommendations] Merged result keys:', Object.keys(merged));

      localStorage.setItem(RECS_KEY, JSON.stringify(merged));
      localStorage.setItem(META_KEY, JSON.stringify({
        gameCount:   totalGameCount,
        generatedAt: new Date().toISOString()
      }));

      // Update coaching memory — never throws; failures surface in health + toast
      if (window.ChessLabMemory && typeof window.ChessLabMemory.update === 'function') {
        try {
          window.ChessLabMemory.update('manual_regenerate')
            .then(function (res) {
              if (res && !res.success) {
                console.warn('[Recommendations] Memory update rejected:', res.reason);
              }
            })
            .catch(function (e) {
              console.warn('[Recommendations] Memory update threw:', e && e.message);
            });
        } catch (e) {
          console.warn('[Recommendations] Memory update call failed synchronously:', e && e.message);
        }
      }

      _notify('Recommendations ready!');
      return merged;

    } catch (err) {
      console.error('[Recommendations] Fatal error:', err.message, err.stack);
      throw err;
    } finally {
      window._recsInFlight = false;
    }
  }

  return { generateRecommendations, loadRecommendations, shouldRegenerate };
})();

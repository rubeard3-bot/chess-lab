// Builds the upstream Lichess opening-explorer URL for /api/lichess-explorer.
// Pure function (no network), so tests/explorer_url.test.js can check it.
//
// db=masters selects the masters database; anything else (or no db) keeps the
// original players ("lichess") database. "db" only picks the path and is never
// forwarded upstream. Only whitelisted query parameters are passed through.
const EXPLORER_BASE = 'https://explorer.lichess.ovh/';
const ALLOWED = ['fen', 'speeds', 'ratings', 'moves', 'variant', 'play', 'since', 'until', 'topGames'];

function buildExplorerUrl(query) {
  const q = query || {};
  const db = q.db === 'masters' ? 'masters' : 'lichess';
  const params = new URLSearchParams();
  for (const key of ALLOWED) {
    if (q[key] != null) params.set(key, q[key]);
  }
  return EXPLORER_BASE + db + '?' + params.toString();
}

module.exports = { buildExplorerUrl, ALLOWED };

// Tests for server/explorer_url.js (the Lichess explorer proxy's upstream URL).
const path = require('path');
const { ROOT, check, done } = require('./helpers');
const { buildExplorerUrl } = require(path.join(ROOT, 'server', 'explorer_url.js'));

console.log('explorer_url: Lichess explorer proxy URL');
const FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

const players = new URL(buildExplorerUrl({ fen: FEN, speeds: 'rapid', ratings: '1600' }));
check('no db param keeps the players database', players.pathname, '/lichess');
check('fen is passed through', players.searchParams.get('fen'), FEN);
check('speeds is passed through', players.searchParams.get('speeds'), 'rapid');

const masters = new URL(buildExplorerUrl({ db: 'masters', fen: FEN, moves: '10', topGames: '0' }));
check('db=masters selects the masters database', masters.pathname, '/masters');
check('db itself is never forwarded upstream', masters.searchParams.has('db'), false);
check('masters filters are passed through', masters.searchParams.get('topGames'), '0');

check('any other db value falls back to players', new URL(buildExplorerUrl({ db: 'evil/../x', fen: FEN })).pathname, '/lichess');
check('non-whitelisted params are dropped', new URL(buildExplorerUrl({ fen: FEN, token: 'x' })).searchParams.has('token'), false);
check('host is always explorer.lichess.ovh', new URL(buildExplorerUrl({ db: 'masters' })).host, 'explorer.lichess.ovh');
done();

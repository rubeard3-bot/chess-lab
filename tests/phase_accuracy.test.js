// Phase-accuracy tests (non-protected). Exercises the SAME pure functions
// production uses (js/phase-accuracy.js), via the test harness loader — not a
// copy. Two guarantees:
//   1. FORMULA PARITY — overallAccuracy over ALL of a player's moves equals
//      Analysis.calculateAccuracy EXACTLY, and reproduces Lichess's official
//      numbers for the golden fixture (White 53 / Black 51).
//   2. EXACT DIVISION — divideGame on the fixture's board sequence returns the
//      boundaries Lichess itself reports.
const fs = require('fs');
const path = require('path');
const { ROOT, loadModule, check, done } = require('./helpers');

const Analysis      = loadModule('analysis.js', 'Analysis');
const PhaseAccuracy = loadModule('phase-accuracy.js', 'PhaseAccuracy');
const Chess         = loadModule('chess.js', 'Chess');

const pgn = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'lichess_LAPlrQCB.pgn'), 'utf8');

// --- Build classified moves from Lichess's own evals (identical to the golden
// --- test's inputs so overall accuracy must be White 53 / Black 51), adding a
// --- 1-based ply so phaseAccuracy can filter. calculateAccuracy ignores ply.
const evals = [...pgn.matchAll(/\[%eval ([^\]]+)\]/g)].map(m => m[1]);
if (evals.length < 10) { console.log('  FAIL  fixture has too few evals'); process.exit(1); }
const toPawns = e => e.startsWith('#') ? (parseInt(e.slice(1), 10) > 0 ? 99 : -99) : parseFloat(e);
const moves = [];
let prev = 0.15; // starting-position eval (~+0.15), same seed as the golden test
evals.forEach((e, i) => {
  const v = toPawns(e);
  moves.push({ ply: i + 1, color: i % 2 === 0 ? 'white' : 'black', evalBefore: prev, eval: v });
  prev = v;
});

console.log('phase_accuracy: Lichess game LAPlrQCB');

// 1. FORMULA PARITY — overallAccuracy must match calculateAccuracy exactly AND
//    reproduce Lichess's official accuracy for this game.
check('White overall == calculateAccuracy',
  PhaseAccuracy.overallAccuracy(moves, 'white'), Analysis.calculateAccuracy(moves, 'white'));
check('Black overall == calculateAccuracy',
  PhaseAccuracy.overallAccuracy(moves, 'black'), Analysis.calculateAccuracy(moves, 'black'));
check('White overall accuracy', PhaseAccuracy.overallAccuracy(moves, 'white'), 53);
check('Black overall accuracy', PhaseAccuracy.overallAccuracy(moves, 'black'), 51);

// 2. EXACT DIVISION — build the fixture's board sequence with index 0 = the
//    initial position (so board index == plies played), then divide.
const parsed = new Chess();
parsed.load_pgn(pgn, { sloppy: true });
const history = parsed.history({ verbose: true });
const replay  = new Chess();
const boards  = [replay.board()]; // index 0 = initial position
history.forEach(m => { replay.move({ from: m.from, to: m.to, promotion: m.promotion }); boards.push(replay.board()); });

const div = PhaseAccuracy.divideGame(boards);
// Lichess's own division for game LAPlrQCB, fetched 2026-10-19 via:
//   curl -s -H "Accept: application/json" "https://lichess.org/game/export/LAPlrQCB?division=true"
//   => "division":{"middle":24,"end":46}  (0-based ply indices; see scalachess DividerTest _.before.board)
check('divideGame middle', div.middle, 24);
check('divideGame end',    div.end,    46);

// 3. Empty-phase sentinel — a ply range with no moves returns null (renderer
//    shows "—") rather than a number or a crash.
check('empty phase -> null sentinel',
  PhaseAccuracy.phaseAccuracy(moves, 'white', 100000, 100001), null);

done();

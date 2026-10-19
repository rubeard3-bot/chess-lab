// GOLDEN TEST (protected): Chess Lab's accuracy formula must reproduce
// Lichess exactly when given Lichess's own engine evaluations.
// Source of truth for the expected numbers: tests/fixtures/README.md.
const fs = require('fs');
const path = require('path');
const { ROOT, loadModule, check, done } = require('./helpers');

const EXPECTED = { white: 53, black: 51 };   // Lichess's official accuracy for this game

const Analysis = loadModule('analysis.js', 'Analysis');
const pgn = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'lichess_LAPlrQCB.pgn'), 'utf8');
const evals = [...pgn.matchAll(/\[%eval ([^\]]+)\]/g)].map(m => m[1]);
if (evals.length < 10) { console.log('  FAIL  fixture has too few evals'); process.exit(1); }

// Convert Lichess evals to Chess Lab's stored format: pawns from White's point
// of view, mate stored as +/-99 pawns (matching js/engine.js).
const toPawns = e => e.startsWith('#') ? (parseInt(e.slice(1), 10) > 0 ? 99 : -99) : parseFloat(e);

const moves = [];
let prev = 0.15; // starting-position eval (about +0.15); Lichess seeds a similar constant
evals.forEach((e, i) => {
  const v = toPawns(e);
  moves.push({ color: i % 2 === 0 ? 'white' : 'black', evalBefore: prev, eval: v });
  prev = v;
});

console.log('accuracy_golden: Lichess game LAPlrQCB');
check('White accuracy', Analysis.calculateAccuracy(moves, 'white'), EXPECTED.white);
check('Black accuracy', Analysis.calculateAccuracy(moves, 'black'), EXPECTED.black);
check('Empty game', Analysis.calculateAccuracy([], 'white'), 0);
done();

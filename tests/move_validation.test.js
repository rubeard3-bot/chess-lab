// move-validation tests (non-protected). Exercises the SAME pure functions
// production uses (js/move-validation.js), required directly (the module is
// Node-safe: no DOM, localStorage access is guarded).
//
// Guarantees:
//   1. plyToMoveLabel ply->"N."/"N..." parity.
//   2. repairCoachText corrects a unique-SAN number (the Opera "11.Bc4" case),
//      strips ambiguous ones, strips absent ones, and logs every repair.
//   3. NUMBER-PRESERVATION (Russell item 1): percentages, evals, centipawns and
//      plain counts are never touched (zero repairs).
//   4. movePlayerLabel (Russell item 2): the "You played"/"Opponent played"
//      color gate, in both color vocabularies.
const { check, done } = require('./helpers');
const MV = require('../js/move-validation.js');

console.log('move_validation: coach move-number labels + repair layer');

/* ---- 1. plyToMoveLabel ---- */
check('plyToMoveLabel ply 11 Bc4', MV.plyToMoveLabel(11, 'Bc4'), '6. Bc4');
check('plyToMoveLabel ply 12 Nf6', MV.plyToMoveLabel(12, 'Nf6'), '6... Nf6');
check('plyToMoveLabel ply 1 (no san)', MV.plyToMoveLabel(1), '1. ...');

/* ---- 2. repairCoachText: the Opera case ---- */
// Bc4 uniquely at ply 11 -> correct move number is ceil(11/2) = 6.
const operaIndex = { e4: [1], e5: [2], Nf3: [3], d6: [4], d4: [5], Bg4: [6],
  dxe5: [7], Bxf3: [8], Qxf3: [9], dxe5b: [10], Bc4: [11], Nf6: [12] };
const opera = MV.repairCoachText('A classic blunder was 11.Bc4, developing with tempo.', operaIndex);
check('Opera repair text', opera.text, 'A classic blunder was 6.Bc4, developing with tempo.');
check('Opera repair count', opera.repairs.length, 1);
check('Opera repair reason', opera.repairs[0].reason, 'corrected');

// "move 11 Bc4" phrasing (Form B) corrects to "move 6 Bc4".
const operaB = MV.repairCoachText('On move 11 Bc4 you lost the thread.', operaIndex);
check('Opera Form B text', operaB.text, 'On move 6 Bc4 you lost the thread.');
check('Opera Form B count', operaB.repairs.length, 1);

// An already-correct number is left unchanged and NOT logged (idempotent).
const already = MV.repairCoachText('The move 6. Bc4 is fine.', operaIndex);
check('already-correct unchanged', already.text, 'The move 6. Bc4 is fine.');
check('already-correct no repairs', already.repairs.length, 0);

/* ---- 2b. ambiguous SAN -> number removed, SAN kept ---- */
const ambIndex = { Nf3: [3, 21] }; // Nf3 played at two plies
const amb = MV.repairCoachText('You hung a piece after 9.Nf3 here.', ambIndex);
check('ambiguous strips number', amb.text, 'You hung a piece after Nf3 here.');
check('ambiguous reason', amb.repairs[0].reason, 'ambiguous');

/* ---- 2c. absent SAN -> number removed, SAN kept ---- */
const absent = MV.repairCoachText('The engine liked 7.Qh5 instead.', operaIndex);
check('absent strips number', absent.text, 'The engine liked Qh5 instead.');
check('absent reason', absent.repairs[0].reason, 'absent');

/* ---- 2d. strip-only mode (null index, cross-game prose) ---- */
const strip = MV.repairCoachText('Your 11.Bc4 was premature.', null);
check('strip-only text', strip.text, 'Your Bc4 was premature.');
check('strip-only reason', strip.repairs[0].reason, 'no-game-context');

/* ---- 3. NUMBER-PRESERVATION (Russell item 1) ---- */
function preserved(label, str) {
  const rA = MV.repairCoachText(str, operaIndex); // with a real index
  const rB = MV.repairCoachText(str, null);       // strip-only mode
  check(label + ' (index) unchanged', rA.text, str);
  check(label + ' (index) zero repairs', rA.repairs.length, 0);
  check(label + ' (null) unchanged', rB.text, str);
  check(label + ' (null) zero repairs', rB.repairs.length, 0);
}
preserved('accuracy percent', 'Your accuracy 53% was solid.');
preserved('eval +1.5', 'The eval +1.5 favored you.');
preserved('eval -0.45', 'It dropped to -0.45 after that.');
preserved('evaluation 1.5', 'An evaluation 1.5 is comfortable.');
preserved('plain count', 'You won 3 games this week.');
preserved('move N no SAN', 'You had blunders on move 20 of the game.');

/* ---- 4. movePlayerLabel (Russell item 2) ---- */
check('label white/white', MV.movePlayerLabel('white', 'white'), 'You played');
check('label black/white', MV.movePlayerLabel('black', 'white'), 'Opponent played');
check('label w/white',     MV.movePlayerLabel('w', 'white'),     'You played');
check('label b/black',     MV.movePlayerLabel('b', 'black'),     'You played');

/* ---- 5. buildMoveIndex ---- */
const idx = MV.buildMoveIndex([{ san: 'e4' }, { san: 'e5' }, { san: 'Nf3' }]);
check('buildMoveIndex e4 ply', idx.e4[0], 1);
check('buildMoveIndex Nf3 ply', idx.Nf3[0], 3);

done();

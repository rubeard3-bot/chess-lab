/* Interactive board controller for the analysis page */

let board = null;
let movesData = [];
let currentIndex = 0;

function initBoard(moves, orientation) {
  movesData = moves;

  board = Chessboard('chessboard', {
    position: movesData[0].fen,
    orientation: orientation,
    pieceTheme: 'https://unpkg.com/@chrisoakman/chessboardjs@1.0.0/img/chesspieces/wikipedia/{piece}.png',
  });

  buildMoveList();
  gotoMove(0);

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); gotoMove(currentIndex - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); gotoMove(currentIndex + 1); }
    if (e.key === 'Home')       { e.preventDefault(); gotoMove(0); }
    if (e.key === 'End')        { e.preventDefault(); gotoMove(movesData.length - 1); }
  });
}

function gotoMove(idx) {
  idx = Math.max(0, Math.min(movesData.length - 1, idx));
  currentIndex = idx;
  const m = movesData[idx];

  // Update board
  board.position(m.fen, false);
  clearHighlights();

  // Highlight last move played
  if (m.move_uci && idx > 0) {
    const from = m.move_uci.slice(0, 2);
    const to   = m.move_uci.slice(2, 4);
    highlightSquare(from, 'rgba(255,255,0,0.3)');
    highlightSquare(to,   'rgba(255,255,0,0.3)');
  }

  // Highlight best move for user mistakes/blunders
  if (m.is_user_move && m.best_move_uci && (m.classification === 'blunder' || m.classification === 'mistake')) {
    const bFrom = m.best_move_uci.slice(0, 2);
    const bTo   = m.best_move_uci.slice(2, 4);
    highlightSquare(bFrom, 'rgba(34,197,94,0.45)');
    highlightSquare(bTo,   'rgba(34,197,94,0.55)');
  }

  // Update eval bar
  updateEvalBar(m.eval_cp, m.eval_bar_pct, m.eval_display);

  // Update move info bar
  const numBadge = document.getElementById('moveNumBadge');
  const sanEl    = document.getElementById('moveSanDisplay');
  const clsEl    = document.getElementById('clsBadge');
  const expEl    = document.getElementById('moveExplanation');

  if (idx === 0) {
    numBadge.textContent = 'Start';
    sanEl.textContent    = '—';
    clsEl.textContent    = '';
    clsEl.className      = 'cls-badge';
    expEl.textContent    = 'Use arrow keys or buttons to navigate through the game.';
  } else {
    const side = m.mover === 'white' ? '▷' : '▶';
    numBadge.textContent = `Move ${m.move_number}`;
    sanEl.textContent    = (m.mover === 'black' ? '…' : '') + m.move_san;

    if (m.is_user_move && m.classification && m.classification !== 'opponent') {
      clsEl.textContent = m.classification;
      clsEl.className   = `cls-badge cls-${m.classification}`;
    } else {
      clsEl.textContent = '';
      clsEl.className   = 'cls-badge';
    }

    expEl.textContent = m.explanation || '';
  }

  // Update move list highlighting
  updateMoveListActive(idx);
  scrollMoveListTo(idx);
}

function updateEvalBar(cp, pct, displayText) {
  const blackEl = document.getElementById('evalBlack');
  const whiteEl = document.getElementById('evalWhite');
  const label   = document.getElementById('evalLabel');

  const whitePct = typeof pct === 'number' ? pct : 50;
  blackEl.style.height = (100 - whitePct) + '%';
  whiteEl.style.height = whitePct + '%';
  label.textContent = displayText || '0.00';
}

function clearHighlights() {
  document.querySelectorAll('.square-55d63').forEach(sq => {
    sq.style.removeProperty('background');
    sq.style.removeProperty('box-shadow');
  });
}

function highlightSquare(algebraic, color) {
  const sq = document.querySelector(`.square-${algebraic}`);
  if (sq) sq.style.background = color;
}

function buildMoveList() {
  const container = document.getElementById('moveList');
  container.innerHTML = '';

  let rowEl = null;

  for (let i = 1; i < movesData.length; i++) {
    const m = movesData[i];

    if (m.mover === 'white') {
      rowEl = document.createElement('div');
      rowEl.className = 'ml-row';
      const numEl = document.createElement('span');
      numEl.className = 'ml-num';
      numEl.textContent = m.move_number + '.';
      rowEl.appendChild(numEl);
      container.appendChild(rowEl);
    }

    const moveEl = document.createElement('span');
    moveEl.className = `ml-move ${m.classification || ''}`;
    moveEl.textContent = m.move_san;
    moveEl.dataset.idx = i;
    moveEl.addEventListener('click', () => gotoMove(i));
    if (rowEl) rowEl.appendChild(moveEl);
  }
}

function updateMoveListActive(activeIdx) {
  document.querySelectorAll('.ml-move').forEach(el => {
    const i = parseInt(el.dataset.idx);
    if (i === activeIdx) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
}

// Jump to the move a user played on the given move number
function gotoMoveByNumber(moveNum, userColor) {
  // movesData index: 0=start, white's nth move is at index 2n-1, black's at 2n
  const targetIdx = userColor === 'white' ? moveNum * 2 - 1 : moveNum * 2;
  gotoMove(Math.min(targetIdx, movesData.length - 1));
}

function scrollMoveListTo(idx) {
  const el = document.querySelector(`.ml-move[data-idx="${idx}"]`);
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

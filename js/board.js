const Board = (() => {
  // Unicode fallback symbols (used only when an SVG fails to load)
  const PIECES = {
    wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
    bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟'
  };

  const PIECE_URLS = {
    wK: 'https://www.chess.com/chess-themes/pieces/neo/150/wk.png',
    wQ: 'https://www.chess.com/chess-themes/pieces/neo/150/wq.png',
    wR: 'https://www.chess.com/chess-themes/pieces/neo/150/wr.png',
    wB: 'https://www.chess.com/chess-themes/pieces/neo/150/wb.png',
    wN: 'https://www.chess.com/chess-themes/pieces/neo/150/wn.png',
    wP: 'https://www.chess.com/chess-themes/pieces/neo/150/wp.png',
    bK: 'https://www.chess.com/chess-themes/pieces/neo/150/bk.png',
    bQ: 'https://www.chess.com/chess-themes/pieces/neo/150/bq.png',
    bR: 'https://www.chess.com/chess-themes/pieces/neo/150/br.png',
    bB: 'https://www.chess.com/chess-themes/pieces/neo/150/bb.png',
    bN: 'https://www.chess.com/chess-themes/pieces/neo/150/bn.png',
    bP: 'https://www.chess.com/chess-themes/pieces/neo/150/bp.png',
  };

  const pieceImages = {};

  const LIGHT_SQ = '#f0d9b5';
  const DARK_SQ  = '#b58863';

  let canvas, ctx, wrap;
  let sqSize = 60;
  let flipped = false;

  let positionChess = null;
  let lastFrom = null, lastTo = null;
  let bestFrom = null, bestTo = null;

  function loadPieceImages() {
    const promises = Object.entries(PIECE_URLS).map(([key, url]) =>
      new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload  = () => { pieceImages[key] = img; resolve(); };
        img.onerror = () => resolve(); // falls through to circle+unicode rendering
        img.src     = url;
      })
    );
    return Promise.all(promises);
  }

  async function init(canvasEl) {
    canvas = canvasEl;
    ctx    = canvas.getContext('2d');
    wrap   = canvas.parentElement;

    await loadPieceImages();

    resizeAndRender();
    const ro = new ResizeObserver(() => resizeAndRender());
    ro.observe(wrap);
  }

  function resizeAndRender() {
    const size = wrap.clientWidth;
    if (!size) return;
    canvas.width  = size;
    canvas.height = size;
    sqSize = size / 8;
    render();
  }

  function setPosition(chess, fromSq, toSq, bFrom, bTo) {
    positionChess = chess;
    lastFrom = fromSq || null;
    lastTo   = toSq   || null;
    bestFrom = bFrom  || null;
    bestTo   = bTo    || null;
    render();
  }

  function flip() {
    flipped = !flipped;
    render();
  }

  function isFlipped() { return flipped; }

  function squareToColRow(sq) {
    const file = sq.charCodeAt(0) - 97;
    const rank = parseInt(sq[1]) - 1;
    const col = flipped ? 7 - file : file;
    const row = flipped ? rank     : 7 - rank;
    return { col, row };
  }

  function squareCenter(sq) {
    const { col, row } = squareToColRow(sq);
    return {
      x: col * sqSize + sqSize / 2,
      y: row * sqSize + sqSize / 2
    };
  }

  function render() {
    if (!ctx || !canvas.width) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBoard();
    drawHighlights();
    drawPieces();
    if (bestFrom && bestTo) drawArrow(bestFrom, bestTo);
    drawCoordinates();
  }

  function drawBoard() {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? LIGHT_SQ : DARK_SQ;
        ctx.fillRect(col * sqSize, row * sqSize, sqSize, sqSize);
      }
    }
  }

  function drawHighlights() {
    [lastFrom, lastTo].forEach(sq => {
      if (!sq) return;
      const { col, row } = squareToColRow(sq);
      ctx.fillStyle = 'rgba(255, 200, 0, 0.40)';
      ctx.fillRect(col * sqSize, row * sqSize, sqSize, sqSize);
    });
  }

  function drawPieces() {
    if (!positionChess) return;
    const boardArr = positionChess.board();
    boardArr.forEach((rowArr, ri) => {
      rowArr.forEach((piece, ci) => {
        if (!piece) return;
        const file = String.fromCharCode(97 + ci);
        const rank = (8 - ri).toString();
        const sq   = file + rank;
        const { col, row } = squareToColRow(sq);
        const key  = piece.color + piece.type.toUpperCase();
        const x    = col * sqSize;
        const y    = row * sqSize;

        if (pieceImages[key]) {
          ctx.drawImage(pieceImages[key], x, y, sqSize, sqSize);
        } else {
          // Colored-circle Unicode fallback: looks clean and distinct on any board
          const sym = PIECES[key];
          if (!sym) return;
          const cx = x + sqSize / 2;
          const cy = y + sqSize / 2;
          const r  = sqSize * 0.40;
          // Circle background
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = piece.color === 'w'
            ? 'rgba(248,241,222,0.96)'
            : 'rgba(24,24,32,0.92)';
          ctx.fill();
          ctx.strokeStyle = piece.color === 'w'
            ? 'rgba(0,0,0,0.25)'
            : 'rgba(255,255,255,0.18)';
          ctx.lineWidth = sqSize * 0.04;
          ctx.stroke();
          // Piece symbol
          const fs = Math.floor(sqSize * 0.52);
          ctx.font         = `${fs}px "Segoe UI Emoji","Apple Color Emoji",serif`;
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle    = piece.color === 'w' ? '#1a1a22' : '#e8e0cc';
          ctx.fillText(sym, cx, cy + sqSize * 0.02);
          ctx.restore();
        }
      });
    });
  }

  function drawArrow(fromSq, toSq) {
    const from = squareCenter(fromSq);
    const to   = squareCenter(toSq);

    const angle   = Math.atan2(to.y - from.y, to.x - from.x);
    const headLen = sqSize * 0.38;
    const lineW   = sqSize * 0.14;

    const bodyEndX = to.x - headLen * 0.65 * Math.cos(angle);
    const bodyEndY = to.y - headLen * 0.65 * Math.sin(angle);

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 210, 90, 0.78)';
    ctx.fillStyle   = 'rgba(0, 210, 90, 0.78)';
    ctx.lineWidth   = lineW;
    ctx.lineCap     = 'round';

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(bodyEndX, bodyEndY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(
      to.x - headLen * Math.cos(angle - Math.PI / 6),
      to.y - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      to.x - headLen * Math.cos(angle + Math.PI / 6),
      to.y - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawCoordinates() {
    const fontSize = Math.max(9, Math.floor(sqSize * 0.18));
    ctx.font = `600 ${fontSize}px "Segoe UI", sans-serif`;

    const files = flipped ? 'hgfedcba' : 'abcdefgh';
    const ranks = flipped ? '12345678' : '87654321';

    for (let row = 0; row < 8; row++) {
      const isLight = row % 2 === 0;
      ctx.fillStyle    = isLight ? DARK_SQ : LIGHT_SQ;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(ranks[row], 2, row * sqSize + 2);
    }

    for (let col = 0; col < 8; col++) {
      const isLight = col % 2 !== 0;
      ctx.fillStyle    = isLight ? DARK_SQ : LIGHT_SQ;
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(files[col], (col + 1) * sqSize - 2, 8 * sqSize - 2);
    }
  }

  return { init, setPosition, flip, isFlipped, resizeAndRender };
})();

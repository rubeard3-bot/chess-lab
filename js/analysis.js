const Analysis = (() => {
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MODEL   = 'claude-sonnet-4-5';

  /* ------------------------------------------------------------------ */
  /*  STEP 1 — Parse PGN                                                  */
  /* ------------------------------------------------------------------ */

  function parsePGN(pgn) {
    if (!pgn || !pgn.trim()) return { valid: false, error: 'PGN is empty.' };
    let chess;
    try { chess = new Chess(); } catch (e) {
      return { valid: false, error: 'chess.js failed to initialize.' };
    }

    if (!chess.load_pgn(pgn.trim())) {
      return { valid: false, error: 'Invalid PGN. Please check the format and try again.' };
    }

    const headers  = chess.header() || {};
    const metadata = {
      white:  headers.White  || 'White',
      black:  headers.Black  || 'Black',
      date:   headers.Date   || '',
      result: headers.Result || '*',
      event:  headers.Event  || ''
    };

    const verboseHistory = chess.history({ verbose: true });
    if (!verboseHistory || verboseHistory.length === 0) {
      return { valid: false, error: 'PGN loaded but contains no moves.' };
    }

    return { valid: true, metadata, verboseHistory };
  }

  /* ------------------------------------------------------------------ */
  /*  Win percentage helper (centipawns, white's perspective)             */
  /* ------------------------------------------------------------------ */

  function winPct(evalCp) {
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * evalCp)) - 1);
  }

  /* ------------------------------------------------------------------ */
  /*  STEP 3 — Classify moves from Stockfish results                      */
  /* ------------------------------------------------------------------ */

  function classifyMoves(sfResults, verboseHistory) {
    const classified = [];

    for (let n = 1; n < sfResults.length; n++) {
      const move   = verboseHistory[n - 1];
      const before = sfResults[n - 1];
      const after  = sfResults[n];
      const isWhiteMove = (n % 2 === 1);

      // eval stored in pawns, white's perspective — convert to centipawns for WP formula
      const wpBefore = winPct(before.eval * 100);
      const wpAfter  = winPct(after.eval  * 100);

      // Win percentage lost by the mover — clamped to zero (good moves never penalised)
      // White loses WP when white's WP drops; black loses WP when white's WP rises
      const winPercentageLoss = isWhiteMove
        ? Math.max(0, wpBefore - wpAfter)
        : Math.max(0, wpAfter  - wpBefore);

      // "Best" if the played move is the engine's top recommendation
      const playedUci = move.from + move.to + (move.promotion || '');
      const isBest    = !!before.bestMoveUci && (playedUci === before.bestMoveUci);

      // "Miss": blunder played from a position the mover was already winning (≥ 2 pawn advantage)
      const isMiss = winPercentageLoss > 15
        && (isWhiteMove ? before.eval >= 2.0 : before.eval <= -2.0);

      let classification;
      if (isBest)                          classification = 'best';
      else if (winPercentageLoss <=  1)    classification = 'excellent';
      else if (winPercentageLoss <=  3)    classification = 'good';
      else if (winPercentageLoss <=  7)    classification = 'inaccuracy';
      else if (winPercentageLoss <= 15)    classification = 'mistake';
      else if (isMiss)                     classification = 'miss';
      else                                 classification = 'blunder';

      // evalLoss in pawns from mover's perspective (always <= 0, kept for UI display)
      const evalDiff = isWhiteMove
        ? (after.eval - before.eval)
        : (before.eval - after.eval);

      classified.push({
        ply:              n,
        san:              move.san,
        color:            isWhiteMove ? 'white' : 'black',
        eval:             after.eval,
        evalBefore:       before.eval,
        evalLoss:         Math.min(0, evalDiff),
        winPercentageLoss,
        classification,
        bestMoveSan:      before.bestMoveSan,
        bestMoveFrom:     after.bestMoveFrom,
        bestMoveTo:       after.bestMoveTo,
        pvSan:            after.pvSan || []
      });
    }

    return classified;
  }

  /* ------------------------------------------------------------------ */
  /*  STEP 4 — Calculate accuracy (Lichess formula)                       */
  /* ------------------------------------------------------------------ */

  function calculateAccuracy(classifiedMoves, playerColor) {
    const playerMoves = classifiedMoves.filter(m => m.color === playerColor);
    if (!playerMoves.length) return 0;

    let total = 0;
    playerMoves.forEach(m => {
      // Recompute win-percent loss from the raw eval snapshots stored on each move.
      // This avoids relying on the pre-computed winPercentageLoss which may be stale or zero.
      const wpBefore = winPct((m.evalBefore ?? 0) * 100);
      const wpAfter  = winPct((m.eval        ?? 0) * 100);
      const wpl = m.color === 'white'
        ? Math.max(0, wpBefore - wpAfter)
        : Math.max(0, wpAfter  - wpBefore);

      const acc     = 103.1668 * Math.exp(-0.04354 * wpl) - 3.1669;
      const clamped = Math.max(0, Math.min(100, acc));

      total += clamped;
    });

    const avg = Math.round(total / playerMoves.length);
    return avg;
  }

  /* ------------------------------------------------------------------ */
  /*  STEP 5 — Call Claude for natural language only                      */
  /* ------------------------------------------------------------------ */

  async function callClaude(metadata, classifiedMoves, pastGames, playerColor) {
    const apiKey = Storage.getApiKey();
    if (!apiKey) {
      const err = new Error('No API key stored.');
      err.code  = 'NO_API_KEY';
      throw err;
    }

    const w = metadata.white  || 'White';
    const b = metadata.black  || 'Black';
    const d = metadata.date   || 'Unknown date';
    const r = metadata.result || '*';
    const playerName = playerColor === 'black' ? b : w;

    const fmt = v => typeof v === 'number' ? +v.toFixed(2) : null;

    const movesForPrompt = classifiedMoves.map(m => ({
      ply:            m.ply,
      san:            m.san,
      evalBefore:     fmt(m.evalBefore),
      eval:           fmt(m.eval),
      evalLoss:       fmt(m.evalLoss),
      classification: m.classification,
      bestMoveSan:    m.bestMoveSan || null
    }));

    const playerPlies = playerColor === 'black' ? 'even' : 'odd';

    const pastSummaries = (pastGames || []).slice(0, 5).map(g => ({
      opening:          g.analysis?.opening?.name,
      weakness:         g.analysis?.summary?.weakness,
      recurringPattern: g.analysis?.summary?.recurringPattern
    }));

    const prompt =
`You are a chess coach. Stockfish analysis is already complete — do not recalculate anything. Write natural language coaching feedback only, using the provided engine data.

Game: ${w} vs ${b}, ${d}, Result: ${r}
You are coaching: ${playerName} (playing ${playerColor})
Odd plies (1,3,5,...) = White's moves. Even plies (2,4,6,...) = Black's moves.

All moves with engine data:
${JSON.stringify(movesForPrompt)}

Past game patterns (do not re-analyze):
${JSON.stringify(pastSummaries)}

Return ONLY valid JSON with no markdown fences:
{
  "summary": {
    "strength": "<one sentence about what ${playerName} did well>",
    "weakness": "<one sentence about ${playerName}'s biggest weakness>",
    "recurringPattern": "<one sentence about recurring patterns in ${playerName}'s mistakes, or null>"
  },
  "opening": {
    "name": "<opening name>",
    "eco": "<ECO code>",
    "bookedUntil": <move number where eval first swung more than 0.3>,
    "youPlayed": "<the deviating move>",
    "theorySays": "<the correct move>",
    "explanation": "<2-3 sentences explaining the opening and deviation>",
    "linesToStudy": [
      { "name": "<resource>", "description": "<one line>", "url": "<real URL or null>" }
    ]
  },
  "moveExplanations": [
    { "ply": <number>, "explanation": "<coaching text>" }
  ]
}

RULES for moveExplanations — include EVERY ${playerPlies} ply (${playerName}'s moves):
- blunder / mistake / inaccuracy: 2-3 sentences. Name the move played, name the best move (bestMoveSan), cite the eval change (evalBefore → eval). Explain WHY bestMoveSan is better — choose the most relevant reason: piece activity, king safety, pawn structure, tactical threat, or endgame technique. Explain what went wrong with the move played. Be specific, like a coach talking to a student.
- best / excellent / good: 1 sentence explaining what made the move strong.
- Never write vague advice. Always reference the actual moves and eval numbers.`;

    let response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type':                              'application/json',
          'x-api-key':                                 apiKey,
          'anthropic-version':                         '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model:      MODEL,
          max_tokens: 8000,
          messages:   [{ role: 'user', content: prompt }]
        })
      });
    } catch (fetchErr) {
      const err = new Error('Network error: ' + fetchErr.message);
      err.code  = 'NETWORK_ERROR';
      throw err;
    }

    if (!response.ok) {
      let errBody = {};
      try { errBody = await response.json(); } catch (_) {}
      const msg = errBody?.error?.message || response.statusText || 'Unknown error';
      const err = new Error(`${response.status}: ${msg}`);
      err.code   = 'API_ERROR';
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text || '';
    if (!text) {
      const err = new Error('Empty response from API.');
      err.code  = 'EMPTY_RESPONSE';
      throw err;
    }

    return parseClaudeResponse(text);
  }

  function parseClaudeResponse(text) {
    let json = text.trim();
    json = json.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const firstBrace = json.indexOf('{');
    const lastBrace  = json.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      json = json.slice(firstBrace, lastBrace + 1);
    }
    let parsed;
    try {
      json   = json.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      parsed = JSON.parse(json);
    } catch (e) {
      const err = new Error('Failed to parse JSON response.');
      err.code    = 'PARSE_ERROR';
      err.rawText = text;
      throw err;
    }
    return parsed;
  }

  /* ------------------------------------------------------------------ */
  /*  STEP 6 — Merge Stockfish + Claude into final analysis object        */
  /* ------------------------------------------------------------------ */

  function buildAnalysis(classifiedMoves, accuracy, claudeData, metadata, playerColor) {
    const playerMoves = classifiedMoves.filter(m => m.color === playerColor);
    let blunders = 0, mistakes = 0, inaccuracies = 0;
    playerMoves.forEach(m => {
      if      (m.classification === 'blunder' || m.classification === 'miss') blunders++;
      else if (m.classification === 'mistake')    mistakes++;
      else if (m.classification === 'inaccuracy') inaccuracies++;
    });

    const explMap = {};
    (claudeData.moveExplanations || []).forEach(e => {
      explMap[e.ply] = e.explanation;
    });

    const moves = classifiedMoves.map(m => ({
      ...m,
      explanation: explMap[m.ply] || null
    }));

    return {
      summary: {
        accuracy,
        blunders,
        mistakes,
        inaccuracies,
        totalMoves:       classifiedMoves.length,
        playerColor,
        result:           metadata.result || '*',
        strength:         claudeData.summary?.strength         || '',
        weakness:         claudeData.summary?.weakness         || '',
        recurringPattern: claudeData.summary?.recurringPattern || null
      },
      opening: claudeData.opening || {},
      moves
    };
  }

  return { parsePGN, classifyMoves, calculateAccuracy, callClaude, buildAnalysis };
})();

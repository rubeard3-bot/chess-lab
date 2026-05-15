const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const fetch      = require('node-fetch');

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 4000;

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL          = 'claude-sonnet-4-6';

const corsOptions = {
  origin: [
    'https://chesslab.live',
    'https://www.chesslab.live',
    'https://rubeard3-bot.github.io',
    'http://localhost:3000',
    'http://localhost:4000'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));

app.use(rateLimit({
  windowMs:        60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function claudeHeaders() {
  return {
    'Content-Type':      'application/json',
    'x-api-key':         process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01'
  };
}

function parseResponse(text, label) {
  let json = text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const firstBrace = json.indexOf('{');
  const lastBrace  = json.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    json = json.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(json);
  } catch (parseErr) {
    console.error(`[${label}] JSON parse failed:`, parseErr.message);

    const lastCurly = json.lastIndexOf('}');
    if (lastCurly !== -1) {
      try { return JSON.parse(json.slice(0, lastCurly + 1)); } catch (_) {}
    }

    try { return JSON.parse(json + '}]}]}]}'); } catch (_) {}

    return null;
  }
}

async function callClaude(prompt, label, maxTokens = 1500) {
  console.log(`[${label}] sending prompt, length:`, prompt.length);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(CLAUDE_API_URL, {
        method:  'POST',
        headers: claudeHeaders(),
        body:    JSON.stringify({
          model:      MODEL,
          max_tokens: maxTokens,
          messages:   [{ role: 'user', content: prompt }]
        })
      });

      console.log(`[${label}] attempt ${attempt} status:`, response.status);

      if (!response.ok) {
        const errText = await response.text();
        if (response.status === 429) {
          console.warn(`[${label}] rate limited (429) on attempt ${attempt} — waiting 5 s before retry`);
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 5000));
            continue;
          }
          console.error(`[${label}] rate limited twice, giving up`);
          return null;
        }
        console.error(`[${label}] API error:`, errText.substring(0, 500));
        if (attempt < 2) { console.log(`[${label}] retrying...`); continue; }
        return null;
      }

      const data    = await response.json();
      const rawText = data?.content?.[0]?.text || '';
      console.log(`[${label}] raw response (first 300):`, rawText.substring(0, 300));

      if (!rawText) {
        if (attempt < 2) continue;
        return null;
      }

      const parsed = parseResponse(rawText, label);
      if (!parsed && attempt < 2) {
        console.log(`[${label}] retrying after parse failure...`);
        continue;
      }
      return parsed;

    } catch (err) {
      console.error(`[${label}] attempt ${attempt} network error:`, err.message);
      if (attempt < 2) continue;
      return null;
    }
  }
  return null;
}

function buildGamesSummary(games) {
  return games.map(g => ({
    gameId:      'csa_game_' + g.id,
    date:        g.savedAt ? g.savedAt.slice(0, 10) : '',
    playerColor: g.playerColor || 'white',
    openingName: g.analysis?.opening?.name || '',
    eco:         g.analysis?.opening?.eco  || '',
    accuracy:    g.analysis?.summary?.accuracy ?? null,
    blunders:    g.analysis?.summary?.blunders     || 0,
    mistakes:    g.analysis?.summary?.mistakes     || 0,
    inaccuracies: g.analysis?.summary?.inaccuracies || 0,
    result:      g.metadata?.result || '*',
    white:       g.metadata?.white  || '',
    black:       g.metadata?.black  || '',
    strength:    g.analysis?.summary?.strength         || '',
    weakness:    g.analysis?.summary?.weakness         || '',
    recurringPattern:  g.analysis?.summary?.recurringPattern || '',
    openingDeviations: {
      youPlayed:   g.analysis?.opening?.youPlayed   || '',
      theorySays:  g.analysis?.opening?.theorySays  || '',
      bookedUntil: g.analysis?.opening?.bookedUntil || null
    },
    moves: (g.analysis?.moves || []).map(m => ({
      ply:            m.ply,
      san:            m.san,
      classification: m.classification,
      evalLoss:       m.evalLoss
    }))
  }));
}

/* ------------------------------------------------------------------ */
/*  POST /api/analyze                                                   */
/* ------------------------------------------------------------------ */

app.post('/api/analyze', async (req, res) => {
  try {
    const { messages, model, max_tokens, system } = req.body;

    const body = {
      model:      model      || MODEL,
      max_tokens: max_tokens || 8000,
      messages
    };
    if (system) body.system = system;

    const response = await fetch(CLAUDE_API_URL, {
      method:  'POST',
      headers: claudeHeaders(),
      body:    JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText });
    }

    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error('[/api/analyze] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /api/recommendations                                           */
/* ------------------------------------------------------------------ */

app.post('/api/recommendations', async (req, res) => {
  try {
    const { games } = req.body;

    if (!games || !games.length) {
      return res.status(400).json({ error: 'No games provided' });
    }

    const gamesSummary = buildGamesSummary(games);
    const gamesJson    = JSON.stringify(gamesSummary);
    const preamble     =
`CRITICAL: Respond with ONLY a valid JSON object. Do not include any markdown formatting, code fences, backticks, or explanatory text before or after the JSON. Your entire response must be parseable by JSON.parse() with no preprocessing. Start your response with { and end with }.

You are a chess coach. Analyze the following complete game history and return ONLY valid JSON with no markdown or commentary.

Games data: ${gamesJson}

When citing specific games as examples, always include the gameId in examples arrays as objects with this shape: { "gameId": "csa_game_...", "description": "..." }

`;

    /* -- Call 1 — Core Analysis ---------------------------------------- */
    const prompt1 = preamble +
`Return ONLY this JSON structure (scores are 0-100):
{
  "overallAssessment": "<3-4 sentences about the player's current level, style, and biggest opportunities for improvement>",
  "accuracyTrend": {
    "direction": "<improving|declining|stable>",
    "message": "<2 sentences about accuracy trend over time>",
    "data": [{ "date": "YYYY-MM-DD", "accuracy": 85 }]
  },
  "phaseAnalysis": {
    "opening":    { "score": 0, "assessment": "<2 sentences>", "keyIssues": ["..."] },
    "middlegame": { "score": 0, "assessment": "<2 sentences>", "keyIssues": ["..."] },
    "endgame":    { "score": 0, "assessment": "<2 sentences>", "keyIssues": ["..."] }
  },
  "topWeaknesses": [
    {
      "title": "<weakness name>",
      "severity": "<critical|major|moderate>",
      "frequency": "<how many times across how many games>",
      "description": "<3-4 sentences explaining the pattern>",
      "examples": [{ "gameId": "<csa_game_...>", "move": "<specific move>", "description": "<what happened>" }],
      "studyPlan": {
        "priority": 1,
        "timeRecommended": "<e.g. 30 mins per day for 2 weeks>",
        "resources": [{ "name": "...", "type": "<video|book|puzzle|article>", "url": "<url if known>", "description": "<one line>" }],
        "drills": ["<specific drill or exercise>"]
      }
    }
  ]
}`;

    /* -- Call 2 — Opening and Tactical Analysis ------------------------ */
    const prompt2 = preamble +
`Return ONLY this JSON structure:
{
  "openingReport": {
    "repertoireAssessment": "<2-3 sentences about opening choices overall>",
    "openings": [
      {
        "name": "<opening name>",
        "gamesPlayed": 0,
        "averageAccuracy": 0,
        "commonMistake": "<most frequent deviation or error>",
        "recommendation": "<keep|modify|replace>",
        "gameExamples": [{ "gameId": "<csa_game_...>", "description": "<what happened in this game>" }],
        "studyResources": [{ "name": "...", "url": "..." }]
      }
    ]
  },
  "tacticalPatterns": [
    {
      "pattern": "<e.g. Missing back rank mates>",
      "occurrences": 0,
      "description": "<2 sentences>",
      "gameExamples": [{ "gameId": "<csa_game_...>", "description": "<what happened in this game>" }],
      "drills": ["<specific puzzle type to practice>"]
    }
  ],
  "improvements": [
    {
      "area": "<what improved>",
      "evidence": "<specific comparison across games showing improvement>",
      "gameId": "<csa_game_...>",
      "message": "<encouraging one sentence>"
    }
  ]
}`;

    /* -- Call 3 — Study Plan and Goals --------------------------------- */
    const prompt3 = preamble +
`Return ONLY this JSON structure:
{
  "weeklyStudyPlan": {
    "totalTimePerWeek": "<e.g. 5 hours>",
    "days": [
      {
        "day": "<Monday>",
        "focus": "<what to study>",
        "activities": ["<specific activity with time estimate>"],
        "duration": "<e.g. 45 minutes>"
      }
    ]
  },
  "nextGoals": [
    {
      "goal": "<specific measurable goal>",
      "timeframe": "<e.g. 2 weeks>",
      "howToAchieve": "<2-3 sentences>"
    }
  ],
  "coachMessage": "<A personal message from the coach to the player, 3-4 sentences, warm and encouraging but honest about what needs work>"
}`;

    /* -- Fire all 3 calls in parallel (Tier 2 rate limits have ample headroom) */
    console.log('[Recommendations] Firing all 3 Claude calls in parallel...');
    const [result1, result2, result3] = await Promise.all([
      callClaude(prompt1, 'Call1-Core',          2500),
      callClaude(prompt2, 'Call2-OpenTactics',   1500),
      callClaude(prompt3, 'Call3-StudyPlan',     1500)
    ]);

    /* -- Merge --------------------------------------------------------- */
    const failedSections = [
      !result1 && 'Core Analysis',
      !result2 && 'Opening & Tactics',
      !result3 && 'Study Plan'
    ].filter(Boolean);

    if (failedSections.length === 3) {
      return res.status(500).json({ error: 'All three Claude calls failed. Please try again.' });
    }

    const merged = Object.assign({}, result1 || {}, result2 || {}, result3 || {});

    if (!result1) {
      merged._partialFailure = 'Core Analysis (Call 1) failed — topWeaknesses and accuracyTrend are missing. Other sections may still be usable.';
      console.warn('[/api/recommendations] CRITICAL: Core Analysis (Call 1) failed — topWeaknesses and accuracyTrend unavailable.');
    } else if (failedSections.length > 0) {
      merged._partialFailure = `Some sections could not be generated: ${failedSections.join(', ')}`;
      console.warn('[/api/recommendations] Partial result, failed sections:', failedSections);
    }

    res.json(merged);

  } catch (err) {
    console.error('[/api/recommendations] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /api/theory                                                    */
/* ------------------------------------------------------------------ */

const theoryCache = new Map();

app.post('/api/theory', async (req, res) => {
  try {
    const { fen, moves, openingName } = req.body;
    if (!fen) return res.status(400).json({ error: 'FEN required' });

    if (theoryCache.has(fen)) {
      return res.json({ explanation: theoryCache.get(fen) });
    }

    const movesStr = Array.isArray(moves) && moves.length ? moves.join(' ') : 'Starting position';
    const prompt =
`You are a chess coach. Explain this chess opening position concisely.

Opening: ${openingName || 'Chess Opening'}
Moves played: ${movesStr}
FEN: ${fen}

In 3-4 sentences explain: the main strategic ideas, what each side wants to achieve, and the key themes or common plans. Be specific and educational. Plain text only — no JSON, no markdown.`;

    const response = await fetch(CLAUDE_API_URL, {
      method:  'POST',
      headers: claudeHeaders(),
      body:    JSON.stringify({
        model:      MODEL,
        max_tokens: 350,
        messages:   [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[/api/theory] Claude error:', errText.slice(0, 200));
      return res.status(502).json({ error: 'AI service unavailable' });
    }

    const data        = await response.json();
    const explanation = (data?.content?.[0]?.text || '').trim()
      || 'No explanation available for this position.';

    theoryCache.set(fen, explanation);
    if (theoryCache.size > 200) {
      theoryCache.delete(theoryCache.keys().next().value);
    }

    res.json({ explanation });
  } catch (err) {
    console.error('[/api/theory] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`ChessLab server running on port ${PORT}`);
});

/* ============================================================
   recommendations.js — cross-game pattern analysis
   ============================================================ */

const Recommendations = (() => {
  const API_URL  = 'https://api.anthropic.com/v1/messages';
  const MODEL    = 'claude-sonnet-4-5';
  const RECS_KEY = 'csa_recommendations';
  const META_KEY = 'csa_recommendations_meta';

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

  async function generateRecommendations() {
    try {
      const games  = Storage.loadAllGames();
      console.log('[Recommendations] Starting generation, games found:', games.length);
      if (games.length === 0) return null;

      const apiKey = Storage.getApiKey();
      console.log('[Recommendations] API key exists:', !!apiKey);
      console.log('[Recommendations] API key prefix:', apiKey ? apiKey.substring(0, 10) : '(none)');
      if (!apiKey) return null;

      const includeMoves = games.length <= 10;
      if (!includeMoves) {
        console.log('[Recommendations] More than 10 games — omitting move-by-move data to stay within token limit');
      }

      const gamesSummary = games.map(g => {
        const entry = {
          gameId:           'csa_game_' + g.id,
          date:             g.savedAt ? g.savedAt.slice(0, 10) : '',
          playerColor:      g.playerColor || 'white',
          openingName:      g.analysis?.opening?.name || '',
          eco:              g.analysis?.opening?.eco  || '',
          accuracy:         g.analysis?.summary?.accuracy ?? null,
          blunders:         g.analysis?.summary?.blunders     || 0,
          mistakes:         g.analysis?.summary?.mistakes     || 0,
          inaccuracies:     g.analysis?.summary?.inaccuracies || 0,
          result:           g.metadata?.result || '*',
          white:            g.metadata?.white  || '',
          black:            g.metadata?.black  || '',
          strength:         g.analysis?.summary?.strength         || '',
          weakness:         g.analysis?.summary?.weakness         || '',
          recurringPattern: g.analysis?.summary?.recurringPattern || '',
          coachingNotes:    g.analysis?.summary?.middlegameNotes  || '',
          openingDeviations: {
            youPlayed:   g.analysis?.opening?.youPlayed   || '',
            theorySays:  g.analysis?.opening?.theorySays  || '',
            bookedUntil: g.analysis?.opening?.bookedUntil || null
          }
        };
        if (includeMoves) {
          entry.moves = (g.analysis?.moves || []).map(m => ({
            ply:            m.ply,
            san:            m.san,
            classification: m.classification,
            evalLoss:       m.evalLoss,
            explanation:    m.explanation
          }));
        }
        return entry;
      });

      const prompt =
`You are a chess coach who has analyzed all of a student's games. Based on the complete game history below, provide an extremely detailed personalized coaching report.

Games data: ${JSON.stringify(gamesSummary)}

When citing specific games as examples, always include the gameId field in your response so the user can link back to that game. Include gameIds in the examples array as objects: { 'gameId': 'csa_game_...', 'description': '...' }

Return ONLY valid JSON with no markdown:
{
  "overallAssessment": "<3-4 sentences about the player's current level, style, and biggest opportunities for improvement>",
  "accuracyTrend": {
    "direction": "<improving|declining|stable>",
    "message": "<2 sentences about accuracy trend over time>",
    "data": [{ "date": "...", "accuracy": 85 }]
  },
  "topWeaknesses": [
    {
      "title": "<weakness name e.g. Rook Endgame Technique>",
      "severity": "<critical|major|moderate>",
      "frequency": "<how many times across how many games>",
      "description": "<3-4 sentences explaining the pattern in detail>",
      "examples": [{ "gameId": "<the csa_game_... id>", "move": "<specific move>", "description": "<what happened>" }],
      "studyPlan": {
        "priority": "<1-5, 1 being most urgent>",
        "timeRecommended": "<e.g. 30 mins per day for 2 weeks>",
        "resources": [
          { "name": "<resource name>", "type": "<video|book|puzzle|article>", "url": "<real URL if known>", "description": "<one line>" }
        ],
        "drills": ["<specific drill or exercise to practice this skill>"]
      }
    }
  ],
  "openingReport": {
    "repertoireAssessment": "<2-3 sentences about opening choices overall>",
    "openings": [
      {
        "name": "<opening name>",
        "gamesPlayed": 0,
        "averageAccuracy": 0,
        "commonMistake": "<the most frequent deviation or error>",
        "recommendation": "<keep/modify/replace and why>",
        "studyResources": [{ "name": "...", "url": "..." }],
        "gameExamples": [{ "gameId": "<csa_game_... id>", "description": "<what happened in this game>" }]
      }
    ]
  },
  "phaseAnalysis": {
    "opening":    { "score": 0, "assessment": "<2 sentences>", "keyIssues": ["..."] },
    "middlegame": { "score": 0, "assessment": "<2 sentences>", "keyIssues": ["..."] },
    "endgame":    { "score": 0, "assessment": "<2 sentences>", "keyIssues": ["..."] }
  },
  "tacticalPatterns": [
    {
      "pattern": "<e.g. Missing back rank mates>",
      "occurrences": 0,
      "description": "<2 sentences>",
      "drills": ["<specific puzzle type to practice>"],
      "gameExamples": [{ "gameId": "<csa_game_... id>", "description": "<what happened in this game>" }]
    }
  ],
  "improvements": [
    {
      "area": "<what improved>",
      "evidence": "<specific comparison across games showing improvement>",
      "message": "<encouraging one sentence>",
      "gameId": "<csa_game_... id of the game that best shows this improvement>"
    }
  ],
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

      console.log('[Recommendations] Sending prompt, length:', prompt.length);

      const headers = {
        'Content-Type':                              'application/json',
        'x-api-key':                                 apiKey,
        'anthropic-version':                         '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      };
      console.log('[Recommendations] Request headers (keys):', Object.keys(headers));
      console.log('[Recommendations] anthropic-dangerous-direct-browser-access header present:', !!headers['anthropic-dangerous-direct-browser-access']);

      const response = await fetch(API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model:      MODEL,
          max_tokens: 8000,
          messages:   [{ role: 'user', content: prompt }]
        })
      });

      console.log('[Recommendations] API response status:', response.status);

      if (!response.ok) {
        const errText = await response.text();
        console.error('[Recommendations] API error body:', errText.substring(0, 500));
        return null;
      }

      const data = await response.json();
      const rawText = data?.content?.[0]?.text || '';
      console.log('[Recommendations] Raw response:', rawText.substring(0, 500));
      if (!rawText) return null;

      let json = rawText.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      const firstBrace = json.indexOf('{');
      const lastBrace  = json.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        json = json.slice(firstBrace, lastBrace + 1);
      }

      let parsed;
      try {
        parsed = JSON.parse(json);
      } catch (parseErr) {
        console.error('[Recommendations] JSON parse failed:', parseErr.message);
        console.error('[Recommendations] JSON that failed to parse:', json.substring(0, 500));
        return null;
      }
      console.log('[Recommendations] Parsed successfully:', !!parsed);

      localStorage.setItem(RECS_KEY, JSON.stringify(parsed));
      localStorage.setItem(META_KEY, JSON.stringify({
        gameCount:   games.length,
        generatedAt: new Date().toISOString()
      }));

      return parsed;
    } catch (err) {
      console.error('[Recommendations] Fatal error:', err.message, err.stack);
      throw err;
    }
  }

  return { generateRecommendations, loadRecommendations, shouldRegenerate };
})();

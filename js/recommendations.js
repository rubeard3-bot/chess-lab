/* ============================================================
   recommendations.js — cross-game pattern analysis
   ============================================================ */

const Recommendations = (() => {
  const API_URL  = 'https://api.anthropic.com/v1/messages';
  const MODEL    = 'claude-sonnet-4-5';
  const RECS_KEY = 'csa_recommendations';
  const META_KEY = 'csa_recommendations_meta';

  let _toastTimer;

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

  function _notify(msg) {
    const el = document.getElementById('rec-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function _setProgress(label) {
    const btn = document.getElementById('rec-regenerate-btn');
    if (btn) btn.textContent = label;
    _notify(label);
  }

  function _buildHeaders(apiKey) {
    return {
      'Content-Type':                              'application/json',
      'x-api-key':                                 apiKey,
      'anthropic-version':                         '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
  }

  function _parseResponse(text, label) {
    let json = text.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    const firstBrace = json.indexOf('{');
    const lastBrace  = json.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      json = json.slice(firstBrace, lastBrace + 1);
    }

    try {
      return JSON.parse(json);
    } catch (parseErr) {
      console.error(`[Recommendations] ${label} JSON parse failed:`, parseErr.message);
      console.error(`[Recommendations] ${label} raw JSON length:`, json.length);

      let repaired = null;

      const lastCurly = json.lastIndexOf('}');
      if (lastCurly !== -1) {
        try { repaired = JSON.parse(json.slice(0, lastCurly + 1)); } catch (_) {}
      }

      if (!repaired) {
        try { repaired = JSON.parse(json + '}]}]}]}'); } catch (_) {}
      }

      if (repaired) return repaired;

      console.error(`[Recommendations] ${label} all repair attempts failed`);
      return null;
    }
  }

  async function _callApi(apiKey, prompt, label) {
    const headers = _buildHeaders(apiKey);
    console.log(`[Recommendations] ${label} sending prompt, length:`, prompt.length);

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch(API_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model:      MODEL,
            max_tokens: 4000,
            messages:   [{ role: 'user', content: prompt }]
          })
        });

        console.log(`[Recommendations] ${label} attempt ${attempt} status:`, response.status);

        if (!response.ok) {
          const errText = await response.text();
          console.error(`[Recommendations] ${label} API error:`, errText.substring(0, 500));
          if (attempt < 2) { console.log(`[Recommendations] ${label} retrying...`); continue; }
          return null;
        }

        const data    = await response.json();
        const rawText = data?.content?.[0]?.text || '';
        console.log(`[Recommendations] ${label} raw response (first 300):`, rawText.substring(0, 300));

        if (!rawText) {
          if (attempt < 2) continue;
          return null;
        }

        const parsed = _parseResponse(rawText, label);
        if (!parsed && attempt < 2) {
          console.log(`[Recommendations] ${label} retrying after parse failure...`);
          continue;
        }
        return parsed;

      } catch (err) {
        console.error(`[Recommendations] ${label} attempt ${attempt} network error:`, err.message);
        if (attempt < 2) continue;
        return null;
      }
    }
    return null;
  }

  function _buildGamesSummary(games) {
    return games.map(g => ({
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
      },
      moves: (g.analysis?.moves || []).map(m => ({
        ply:            m.ply,
        san:            m.san,
        classification: m.classification,
        evalLoss:       m.evalLoss,
        explanation:    m.explanation
      }))
    }));
  }

  async function generateRecommendations() {
    try {
      const games = Storage.loadAllGames();
      console.log('[Recommendations] Starting generation, games found:', games.length);
      if (games.length === 0) return null;

      const apiKey = Storage.getApiKey();
      console.log('[Recommendations] API key exists:', !!apiKey);
      console.log('[Recommendations] API key prefix:', apiKey ? apiKey.substring(0, 10) : '(none)');
      if (!apiKey) return null;

      const gamesSummary = _buildGamesSummary(games);
      const gamesJson    = JSON.stringify(gamesSummary);
      const preamble     =
`You are a chess coach. Analyze the following complete game history and return ONLY valid JSON with no markdown or commentary.

Games data: ${gamesJson}

When citing specific games as examples, always include the gameId in examples arrays as objects with this shape: { "gameId": "csa_game_...", "description": "..." }

`;

      // ----------------------------------------------------------------
      // Call 1 — Core Analysis
      // ----------------------------------------------------------------
      _setProgress('Analyzing your game patterns... (1/3)');

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

      const result1 = await _callApi(apiKey, prompt1, 'Call1-Core');

      // ----------------------------------------------------------------
      // Call 2 — Opening and Tactical Analysis
      // ----------------------------------------------------------------
      _setProgress('Analyzing your openings and tactics... (2/3)');

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

      const result2 = await _callApi(apiKey, prompt2, 'Call2-OpenTactics');

      // ----------------------------------------------------------------
      // Call 3 — Study Plan and Goals
      // ----------------------------------------------------------------
      _setProgress('Building your study plan... (3/3)');

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

      const result3 = await _callApi(apiKey, prompt3, 'Call3-StudyPlan');

      // ----------------------------------------------------------------
      // Merge
      // ----------------------------------------------------------------
      const failedSections = [
        !result1 && 'Core Analysis',
        !result2 && 'Opening & Tactics',
        !result3 && 'Study Plan'
      ].filter(Boolean);

      if (failedSections.length === 3) {
        console.error('[Recommendations] All three calls failed');
        return null;
      }

      const merged = Object.assign({}, result1 || {}, result2 || {}, result3 || {});

      if (failedSections.length > 0) {
        merged._partialFailure = `Some sections could not be generated: ${failedSections.join(', ')}`;
        console.warn('[Recommendations] Partial result, failed sections:', failedSections);
        window.dispatchEvent(new CustomEvent('rec-parse-error', {
          detail: { message: `Partial results — failed to generate: ${failedSections.join(', ')}` }
        }));
      }

      console.log('[Recommendations] Merged result keys:', Object.keys(merged));

      localStorage.setItem(RECS_KEY, JSON.stringify(merged));
      localStorage.setItem(META_KEY, JSON.stringify({
        gameCount:   games.length,
        generatedAt: new Date().toISOString()
      }));

      _notify('Recommendations ready!');
      return merged;

    } catch (err) {
      console.error('[Recommendations] Fatal error:', err.message, err.stack);
      throw err;
    }
  }

  return { generateRecommendations, loadRecommendations, shouldRegenerate };
})();

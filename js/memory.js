/* ============================================================================
   memory.js — Chess Lab Coaching Memory System (Step 1 / Foundation)
   ============================================================================

   Persistent, auditable coaching memory that accumulates over time.

   DESIGN PRINCIPLES (NON-NEGOTIABLE):
     1. Stockfish is the source of truth for all chess facts. Memory stores
        patterns + aggregations, never raw evals. Claude writes narrative only.
     2. Stockfish classifications are immutable: blunder stays blunder.
     3. Memory starts fresh on first activation — does NOT read csa_recommendations.
     4. Backwards compatibility is OUTPUT-ONLY: memory writes csa_recommendations
        in its existing shape (overlay merge); memory never reads csa_recommendations;
        memory never writes to csa_game_* entries (read-only forever).
     5. Cross-reference validation on every update.
     6. No silent degradation: every failure is logged AND visible (toast + health).

   MEMORY SCHEMA  (key: csa_coaching_memory)
     {
       version: 1,
       metadata: { createdAt, lastUpdated, lastFullRegenerate,
                   updatesSinceFullRegenerate, newGamesSinceLastBackup },
       buckets: { bullet: <bucket>, blitz: <bucket>, rapid: <bucket> }
     }

   BUCKET SCHEMA
     {
       gamesAnalyzedEver: int,
       activeGames: [ { id, date, ageWeight } ],
       weaknesses: { <key>: { title, severity, stockfishClassification,
                              firstSeen, lastSeen, activeOccurrences,
                              historicalOccurrences, trend,
                              narrativeDescription, exampleGameIds:[] } },
       strengths:  { <key>: { title, firstSeen, lastSeen,
                              activeOccurrences, historicalOccurrences,
                              narrativeDescription, exampleGameIds:[] } },
       openings:   { <name>: { gamesPlayed, wins, draws, losses,
                               avgAccuracy, verdict, commonMistake, lastPlayed } },
       trends:     { accuracyByMonth, blundersPerGameByMonth, totalGamesByMonth },
       archivedSummaries: { "YYYY-MM": { gamesPlayed, accuracy, blunders, mainWeakness } }
     }

   NOTE ON DATA SOURCE
     The original spec referenced a key called `csa_analyzed_games`. That key
     does not exist in this codebase — games are stored as individual
     `csa_game_<id>` entries (one localStorage key per game) and game IDs in
     this system are the FULL localStorage key, e.g. "csa_game_1714298400123".
     This matches the convention used by server/index.js when emitting gameIds.

   ============================================================================ */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1 — CONSTANTS AND SCHEMA
  // ═══════════════════════════════════════════════════════════════════════════

  var VERSION = 1;

  var KEY = {
    memory:           'csa_coaching_memory',
    history:          'csa_coaching_memory_history',
    audit:            'csa_coaching_memory_audit',
    health:           'csa_coaching_memory_health',
    autoBackupMem:    'csa_coaching_memory_autobackup',
    autoBackupRecs:   'csa_recommendations_autobackup',
    manualBackupMem:  'csa_coaching_memory_manual_backup',
    manualBackupRecs: 'csa_recommendations_manual_backup',
    legacyRecs:       'csa_recommendations',
    legacyRecsMeta:   'csa_recommendations_meta',
    gamePrefix:       'csa_game_'
  };

  var HISTORY_CAP            = 10;
  var AUDIT_CAP              = 100;
  var ACTIVE_GAMES_CAP       = 25;
  var AUTO_BACKUP_THRESHOLD  = 5;
  var LOCK_WAIT_MS           = 10000;
  var CLAUDE_TIMEOUT_MS      = 30000;
  var NEW_WEAKNESS_MIN_OCC   = 3;
  var WEAKNESS_DROP_MAX_PCT  = 0.30;  // catastrophic-forgetting guard
  var CLASSIFICATION_TOL_PCT = 0.05;

  var TC_BULLET_MAX_SECONDS = 180;
  var TC_BLITZ_MAX_SECONDS  = 600;

  var ALLOWED_CLASSIFICATIONS = ['blunder', 'mistake', 'inaccuracy', 'miss'];
  var ALLOWED_SEVERITIES      = ['critical', 'major', 'minor'];
  var ALLOWED_TRENDS          = ['worsening', 'stable', 'improving'];
  var SEVERITY_RANK           = { critical: 3, major: 2, minor: 1 };

  var SERVER_URL = (typeof window !== 'undefined' && window.location.hostname === 'localhost')
    ? 'http://localhost:4000'
    : 'https://chess-lab-production.up.railway.app';

  function nowISO() { return new Date().toISOString(); }

  function emptyBucket() {
    return {
      gamesAnalyzedEver: 0,
      activeGames:       [],
      weaknesses:        {},
      strengths:         {},
      openings:          {},
      trends: {
        accuracyByMonth:        {},
        blundersPerGameByMonth: {},
        totalGamesByMonth:      {}
      },
      archivedSummaries: {}
    };
  }

  function emptyMemory() {
    var now = nowISO();
    return {
      version: VERSION,
      metadata: {
        createdAt:                  now,
        lastUpdated:                now,
        lastFullRegenerate:         now,
        updatesSinceFullRegenerate: 0,
        newGamesSinceLastBackup:    0
      },
      buckets: {
        bullet: emptyBucket(),
        blitz:  emptyBucket(),
        rapid:  emptyBucket()
      }
    };
  }

  function emptyHealth() {
    return {
      status: 'healthy',
      lastUpdateAccepted: null,
      lastUpdateRejected: null,
      consecutiveRejections: 0,
      message: 'Memory has not run yet.'
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2 — STORAGE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); return true; } catch (_) { return false; }
  }
  function lsRemove(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }
  function lsGetJSON(key, fallback) {
    var raw = lsGet(key);
    if (raw == null) return fallback === undefined ? null : fallback;
    try { return JSON.parse(raw); } catch (_) { return fallback === undefined ? null : fallback; }
  }
  function lsSetJSON(key, obj) {
    try { return lsSet(key, JSON.stringify(obj)); } catch (_) { return false; }
  }

  function readMemory() {
    return lsGetJSON(KEY.memory, null);
  }
  function writeMemory(mem) {
    return lsSetJSON(KEY.memory, mem);
  }

  function readHistory() {
    var arr = lsGetJSON(KEY.history, []);
    return Array.isArray(arr) ? arr : [];
  }
  function writeHistory(arr) {
    return lsSetJSON(KEY.history, arr);
  }
  function pushHistory(entry) {
    var arr = readHistory();
    arr.unshift(entry);
    if (arr.length > HISTORY_CAP) arr = arr.slice(0, HISTORY_CAP);
    writeHistory(arr);
  }

  function readAudit() {
    var arr = lsGetJSON(KEY.audit, []);
    return Array.isArray(arr) ? arr : [];
  }
  function writeAudit(arr) {
    return lsSetJSON(KEY.audit, arr);
  }
  function appendAudit(entry) {
    var arr = readAudit();
    arr.unshift(entry);
    if (arr.length > AUDIT_CAP) arr = arr.slice(0, AUDIT_CAP);
    writeAudit(arr);
  }

  function readHealth() {
    var h = lsGetJSON(KEY.health, null);
    return h && typeof h === 'object' ? h : emptyHealth();
  }
  function writeHealth(h) {
    return lsSetJSON(KEY.health, h);
  }

  // ── Game enumeration (read-only across csa_game_* entries) ────────────────
  function enumerateGames() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(KEY.gamePrefix) === 0) {
          try {
            var g = JSON.parse(localStorage.getItem(k));
            if (g) {
              g._fullKey = k;            // canonical memory ID
              out.push(g);
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
    return out;
  }
  function gameExists(fullKey) {
    if (!fullKey || typeof fullKey !== 'string') return false;
    if (fullKey.indexOf(KEY.gamePrefix) !== 0) return false;
    try { return localStorage.getItem(fullKey) != null; } catch (_) { return false; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3 — TIME CONTROL CLASSIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  // PGN header e.g. [TimeControl "180"], [TimeControl "180+2"], [TimeControl "900+10"]
  function parseTimeControlFromPGN(pgn) {
    if (!pgn || typeof pgn !== 'string') return null;
    var m = pgn.match(/\[TimeControl\s+"([^"]+)"\]/);
    if (!m) return null;
    var raw = m[1].trim();
    if (raw === '' || raw === '-') return null;
    var base = raw.indexOf('+') >= 0 ? raw.split('+')[0] : raw;
    var seconds = parseInt(base, 10);
    if (isNaN(seconds) || seconds <= 0) return null;
    return seconds;
  }

  function classifyTimeControl(seconds) {
    if (seconds == null || isNaN(seconds)) return null;
    if (seconds < TC_BULLET_MAX_SECONDS) return 'bullet';
    if (seconds < TC_BLITZ_MAX_SECONDS)  return 'blitz';
    return 'rapid';
  }

  function bucketForGame(game) {
    var secs = parseTimeControlFromPGN(game && game.pgn);
    return classifyTimeControl(secs);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4 — AGE WEIGHT CALCULATION
  // ═══════════════════════════════════════════════════════════════════════════

  function daysBetween(isoA, isoB) {
    var a = new Date(isoA).getTime();
    var b = new Date(isoB).getTime();
    if (isNaN(a) || isNaN(b)) return null;
    return Math.floor((b - a) / 86400000);
  }

  // Returns 1.0 / 0.5 / 0.25, or null meaning "drop from activeGames".
  function calcAgeWeight(gameDate, nowIso) {
    var d = daysBetween(gameDate, nowIso);
    if (d == null || d < 0) return 1.0;
    if (d <= 30) return 1.0;
    if (d <= 60) return 0.5;
    if (d <= 90) return 0.25;
    return null;
  }

  function monthKey(iso) {
    if (!iso) return null;
    var s = String(iso);
    return s.length >= 7 ? s.slice(0, 7) : null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5 — VALIDATION (24 SANITY CHECKS + BUCKET-ROUTING PRECHECK)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // validateProposedBucket(prevMemory, bucketName, prevBucket, proposedBucket,
  //                        expectedNewGameRouting, gameIndex)
  //
  //   prevMemory:                full prior memory (for archivedSummaries cross-bucket isolation)
  //   bucketName:                'bullet'|'blitz'|'rapid'
  //   prevBucket, proposedBucket: bucket-level objects (the bucket Claude returned)
  //   expectedNewGameRouting:    { fullKey -> 'bullet'|'blitz'|'rapid' } we precomputed
  //   gameIndex:                 { fullKey -> game } for cross-reference lookups
  //
  // Returns { ok: bool, failedCheck: 'CheckN', reason: 'human reason' }

  function isISODateLike(v) {
    if (typeof v !== 'string') return false;
    var t = Date.parse(v);
    return !isNaN(t);
  }
  function isNonNegInt(n) { return typeof n === 'number' && isFinite(n) && n >= 0 && Math.floor(n) === n; }
  function isNonNegNum(n) { return typeof n === 'number' && isFinite(n) && n >= 0; }
  function isNonEmptyString(s) { return typeof s === 'string' && s.length > 0; }
  function inSet(v, set) { return set.indexOf(v) >= 0; }

  function countWeaknessKeys(bucket) {
    return bucket && bucket.weaknesses ? Object.keys(bucket.weaknesses).length : 0;
  }

  function countClassifiedMovesInBucket(bucketName, gameIndex, expectedNewGameRouting, allBucketGameIds) {
    // Sum over every game that BELONGS to this bucket (by TimeControl) — both
    // currently-active games and any aged-out games still in localStorage.
    var counts = { blunder: 0, mistake: 0, inaccuracy: 0, miss: 0 };
    var seen = {};
    function addGame(g) {
      if (!g || !g.analysis || !Array.isArray(g.analysis.moves)) return;
      var pc = g.playerColor || 'white';
      g.analysis.moves.forEach(function (m) {
        if (!m || m.color !== pc) return;
        if (counts.hasOwnProperty(m.classification)) counts[m.classification]++;
      });
    }
    // From the precomputed routing map (covers brand-new games and existing)
    Object.keys(expectedNewGameRouting || {}).forEach(function (fk) {
      if (expectedNewGameRouting[fk] === bucketName && gameIndex[fk] && !seen[fk]) {
        seen[fk] = true;
        addGame(gameIndex[fk]);
      }
    });
    // From the currently-active list as well
    (allBucketGameIds || []).forEach(function (fk) {
      if (!seen[fk] && gameIndex[fk]) {
        seen[fk] = true;
        addGame(gameIndex[fk]);
      }
    });
    return counts;
  }

  function earliestGameDateWithClassification(classification, bucketName, gameIndex, expectedNewGameRouting, allBucketGameIds) {
    var earliest = null;
    var seen = {};
    function consider(g) {
      if (!g || !g.analysis || !Array.isArray(g.analysis.moves)) return;
      var pc = g.playerColor || 'white';
      var has = g.analysis.moves.some(function (m) {
        return m && m.color === pc && m.classification === classification;
      });
      if (!has) return;
      var d = g.savedAt || null;
      if (!d) return;
      if (earliest == null || d < earliest) earliest = d;
    }
    Object.keys(expectedNewGameRouting || {}).forEach(function (fk) {
      if (expectedNewGameRouting[fk] === bucketName && gameIndex[fk] && !seen[fk]) {
        seen[fk] = true;
        consider(gameIndex[fk]);
      }
    });
    (allBucketGameIds || []).forEach(function (fk) {
      if (!seen[fk] && gameIndex[fk]) {
        seen[fk] = true;
        consider(gameIndex[fk]);
      }
    });
    return earliest;
  }

  function validateProposedBucket(prevMemory, bucketName, prevBucket, proposedBucket, expectedNewGameRouting, gameIndex, otherBucketActiveIds) {
    function fail(check, reason) { return { ok: false, failedCheck: check, reason: reason }; }

    // ── BUCKET ROUTING PRECHECK ──────────────────────────────────────────────
    // Every game ID in proposedBucket.activeGames that was newly routed must
    // match its expected bucket. (Games already in prevBucket.activeGames are
    // not re-checked — they were routed correctly at insertion time.)
    var prevActiveSet = {};
    (prevBucket.activeGames || []).forEach(function (g) { prevActiveSet[g.id] = true; });
    var p = proposedBucket || {};
    if (!Array.isArray(p.activeGames)) return fail('Check5', 'activeGames is not an array');

    for (var i = 0; i < p.activeGames.length; i++) {
      var entry = p.activeGames[i];
      if (!entry || !isNonEmptyString(entry.id)) {
        return fail('Routing', 'activeGames[' + i + '] is missing a valid id');
      }
      if (!prevActiveSet[entry.id]) {
        var expected = expectedNewGameRouting[entry.id];
        if (expected && expected !== bucketName) {
          return fail('Routing',
            'Bucket "' + bucketName + '" contains game ' + entry.id +
            ' that should be routed to "' + expected + '"');
        }
      }
    }

    // ── SCHEMA CHECKS (1–8) ──────────────────────────────────────────────────

    // 1: version is correct (validated at memory level upstream, repeated for safety)
    if (prevMemory && typeof prevMemory.version !== 'number') {
      return fail('Check1', 'prev memory has no numeric version');
    }

    // 2: metadata structure (validated at memory level upstream; sanity-check here)
    // 3: buckets exist (validated at memory level upstream)

    // 4: required bucket fields
    var requiredFields = ['gamesAnalyzedEver','activeGames','weaknesses','strengths','openings','trends','archivedSummaries'];
    for (var k = 0; k < requiredFields.length; k++) {
      if (!(requiredFields[k] in p)) {
        return fail('Check4', 'Bucket "' + bucketName + '" missing required field: ' + requiredFields[k]);
      }
    }

    // 5: activeGames array + weaknesses/strengths/openings objects
    if (!Array.isArray(p.activeGames)) return fail('Check5', 'activeGames must be an array');
    if (!p.weaknesses || typeof p.weaknesses !== 'object' || Array.isArray(p.weaknesses)) return fail('Check5', 'weaknesses must be an object');
    if (!p.strengths  || typeof p.strengths  !== 'object' || Array.isArray(p.strengths))  return fail('Check5', 'strengths must be an object');
    if (!p.openings   || typeof p.openings   !== 'object' || Array.isArray(p.openings))   return fail('Check5', 'openings must be an object');
    if (!p.trends     || typeof p.trends     !== 'object') return fail('Check5', 'trends must be an object');
    if (!p.archivedSummaries || typeof p.archivedSummaries !== 'object') return fail('Check5', 'archivedSummaries must be an object');

    // 6: weakness field types
    var wKeys = Object.keys(p.weaknesses);
    for (var wi = 0; wi < wKeys.length; wi++) {
      var wk = wKeys[wi], w = p.weaknesses[wk];
      if (!w || typeof w !== 'object') return fail('Check6', 'Weakness "' + wk + '" is not an object');
      if (!isNonEmptyString(w.title)) return fail('Check6', 'Weakness "' + wk + '" has empty title');
      if (!inSet(w.severity, ALLOWED_SEVERITIES)) return fail('Check6', 'Weakness "' + wk + '" has invalid severity "' + w.severity + '"');
      if (!inSet(w.stockfishClassification, ALLOWED_CLASSIFICATIONS)) {
        return fail('Check6', 'Weakness "' + wk + '" has invalid stockfishClassification "' + w.stockfishClassification + '"');
      }
      if (!isISODateLike(w.firstSeen))       return fail('Check6', 'Weakness "' + wk + '" has invalid firstSeen');
      if (!isISODateLike(w.lastSeen))        return fail('Check6', 'Weakness "' + wk + '" has invalid lastSeen');
      if (!isNonNegInt(w.activeOccurrences)) return fail('Check6', 'Weakness "' + wk + '" activeOccurrences not non-negative int');
      if (!isNonNegInt(w.historicalOccurrences)) return fail('Check6', 'Weakness "' + wk + '" historicalOccurrences not non-negative int');
      if (!inSet(w.trend, ALLOWED_TRENDS))   return fail('Check6', 'Weakness "' + wk + '" has invalid trend');
    }

    // 7: dates parse
    for (var ag = 0; ag < p.activeGames.length; ag++) {
      var entry7 = p.activeGames[ag];
      if (entry7.date && !isISODateLike(entry7.date)) return fail('Check7', 'activeGames[' + ag + '] has invalid ISO date');
    }

    // 8: non-negative counts
    if (!isNonNegInt(p.gamesAnalyzedEver)) return fail('Check8', 'gamesAnalyzedEver must be non-negative int');
    var tr = p.trends || {};
    function trendsNonNeg(obj, label) {
      if (!obj) return null;
      var ks = Object.keys(obj);
      for (var i = 0; i < ks.length; i++) {
        var v = obj[ks[i]];
        if (!isNonNegNum(v)) return fail('Check8', label + '[' + ks[i] + '] is negative or NaN');
      }
      return null;
    }
    var t8a = trendsNonNeg(tr.accuracyByMonth, 'accuracyByMonth');           if (t8a) return t8a;
    var t8b = trendsNonNeg(tr.blundersPerGameByMonth, 'blundersPerGameByMonth'); if (t8b) return t8b;
    var t8c = trendsNonNeg(tr.totalGamesByMonth, 'totalGamesByMonth');       if (t8c) return t8c;

    // ── PLAUSIBILITY CHECKS (9–15) ───────────────────────────────────────────

    // 9: lastUpdated advances — checked at memory level, but ensure proposed bucket
    //    didn't move backwards on internal counters
    if ((p.gamesAnalyzedEver || 0) < (prevBucket.gamesAnalyzedEver || 0)) {
      return fail('Check10', 'gamesAnalyzedEver decreased: ' + prevBucket.gamesAnalyzedEver + ' → ' + p.gamesAnalyzedEver);
    }

    // 11: per-weakness historicalOccurrences monotonic up
    var prevW = prevBucket.weaknesses || {};
    var pKeys = Object.keys(p.weaknesses);
    for (var pi = 0; pi < pKeys.length; pi++) {
      var pk = pKeys[pi];
      if (prevW[pk]) {
        if (p.weaknesses[pk].historicalOccurrences < prevW[pk].historicalOccurrences) {
          return fail('Check11',
            'Weakness "' + pk + '" historicalOccurrences decreased: ' +
            prevW[pk].historicalOccurrences + ' → ' + p.weaknesses[pk].historicalOccurrences);
        }
      }
    }

    // 12: catastrophic-forgetting guard
    var prevCount = countWeaknessKeys(prevBucket);
    var newCount  = countWeaknessKeys(p);
    if (prevCount > 0) {
      var dropFrac = (prevCount - newCount) / prevCount;
      if (dropFrac > WEAKNESS_DROP_MAX_PCT) {
        return fail('Check12',
          'Active weakness count dropped by ' + Math.round(dropFrac * 100) +
          '% (' + prevCount + ' → ' + newCount + '), exceeds ' + Math.round(WEAKNESS_DROP_MAX_PCT * 100) + '% limit');
      }
    }

    // 13: past-month trends are frozen
    var currentMonth = monthKey(nowISO());
    function frozenPastMonths(prevObj, newObj, label) {
      var prevKeys = Object.keys(prevObj || {});
      for (var i = 0; i < prevKeys.length; i++) {
        var mk = prevKeys[i];
        if (mk === currentMonth) continue;
        if (!(mk in (newObj || {}))) {
          return fail('Check13', label + ' lost past month "' + mk + '"');
        }
        if (newObj[mk] < prevObj[mk]) {
          return fail('Check13', label + ' past month "' + mk + '" decreased: ' + prevObj[mk] + ' → ' + newObj[mk]);
        }
      }
      return null;
    }
    var t13a = frozenPastMonths(prevBucket.trends && prevBucket.trends.totalGamesByMonth,      p.trends.totalGamesByMonth,      'totalGamesByMonth');      if (t13a) return t13a;
    var t13b = frozenPastMonths(prevBucket.trends && prevBucket.trends.blundersPerGameByMonth, p.trends.blundersPerGameByMonth, 'blundersPerGameByMonth'); if (t13b) return t13b;
    var t13c = frozenPastMonths(prevBucket.trends && prevBucket.trends.accuracyByMonth,        p.trends.accuracyByMonth,        'accuracyByMonth');        if (t13c) return t13c;

    // 14: newly-added weaknesses need ≥3 occurrences
    for (var pi2 = 0; pi2 < pKeys.length; pi2++) {
      var pk2 = pKeys[pi2];
      if (!prevW[pk2]) {
        if (p.weaknesses[pk2].activeOccurrences < NEW_WEAKNESS_MIN_OCC) {
          return fail('Check14',
            'New weakness "' + pk2 + '" has only ' + p.weaknesses[pk2].activeOccurrences + ' occurrence(s), need ≥' + NEW_WEAKNESS_MIN_OCC);
        }
      }
    }

    // 15: severity may move at most one rank per update
    for (var pi3 = 0; pi3 < pKeys.length; pi3++) {
      var pk3 = pKeys[pi3];
      if (prevW[pk3]) {
        var diff = Math.abs(SEVERITY_RANK[p.weaknesses[pk3].severity] - SEVERITY_RANK[prevW[pk3].severity]);
        if (diff > 1) {
          return fail('Check15',
            'Weakness "' + pk3 + '" severity jumped >1 rank: ' + prevW[pk3].severity + ' → ' + p.weaknesses[pk3].severity);
        }
      }
    }

    // ── CROSS-REFERENCE CHECKS (16–19) ───────────────────────────────────────

    // 16: weakness.exampleGameIds exist in csa_game_*
    for (var pi4 = 0; pi4 < pKeys.length; pi4++) {
      var pk4 = pKeys[pi4];
      var ex = p.weaknesses[pk4].exampleGameIds || [];
      for (var ei = 0; ei < ex.length; ei++) {
        if (!gameExists(ex[ei])) {
          return fail('Check16', 'Weakness "' + pk4 + '" references missing game ' + ex[ei]);
        }
      }
    }

    // 17: bucket.activeGames ids exist in csa_game_*
    for (var ai = 0; ai < p.activeGames.length; ai++) {
      if (!gameExists(p.activeGames[ai].id)) {
        return fail('Check17', 'activeGames references missing game ' + p.activeGames[ai].id);
      }
    }

    // 18: per-classification historical sums within tolerance of actual counts
    var allGameIds = p.activeGames.map(function (g) { return g.id; });
    var actualCounts = countClassifiedMovesInBucket(bucketName, gameIndex, expectedNewGameRouting, allGameIds);
    var historicalByClass = { blunder: 0, mistake: 0, inaccuracy: 0, miss: 0 };
    pKeys.forEach(function (wk2) {
      var w2 = p.weaknesses[wk2];
      if (historicalByClass.hasOwnProperty(w2.stockfishClassification)) {
        historicalByClass[w2.stockfishClassification] += w2.historicalOccurrences;
      }
    });
    for (var c = 0; c < ALLOWED_CLASSIFICATIONS.length; c++) {
      var cls = ALLOWED_CLASSIFICATIONS[c];
      var actual = actualCounts[cls];
      var sum = historicalByClass[cls];
      var ceiling = Math.ceil(actual * (1 + CLASSIFICATION_TOL_PCT));
      // Allow generous lower bound (not every move maps to a weakness pattern).
      if (sum > ceiling) {
        return fail('Check18',
          'Sum of historicalOccurrences for "' + cls + '" (' + sum + ') exceeds actual count ' + actual + ' +' +
          Math.round(CLASSIFICATION_TOL_PCT * 100) + '% in csa_game_* data');
      }
    }

    // 19: weakness firstSeen ≤ earliest game date with that classification
    for (var pi5 = 0; pi5 < pKeys.length; pi5++) {
      var pk5 = pKeys[pi5];
      var w5  = p.weaknesses[pk5];
      var earliest = earliestGameDateWithClassification(w5.stockfishClassification, bucketName, gameIndex, expectedNewGameRouting, allGameIds);
      if (earliest && w5.firstSeen > earliest) {
        return fail('Check19',
          'Weakness "' + pk5 + '" firstSeen (' + w5.firstSeen + ') is after earliest game with classification "' +
          w5.stockfishClassification + '" (' + earliest + ')');
      }
    }

    // ── CLAUDE-FABRICATION CHECKS (20–24) ────────────────────────────────────

    // 20: weakness titles unique within bucket
    var titleSet = {};
    for (var pi6 = 0; pi6 < pKeys.length; pi6++) {
      var title = p.weaknesses[pKeys[pi6]].title;
      if (titleSet[title]) return fail('Check20', 'Duplicate weakness title "' + title + '" in bucket ' + bucketName);
      titleSet[title] = true;
    }

    // 21: firstSeen ≤ lastSeen
    for (var pi7 = 0; pi7 < pKeys.length; pi7++) {
      var w7 = p.weaknesses[pKeys[pi7]];
      if (w7.firstSeen > w7.lastSeen) {
        return fail('Check21', 'Weakness "' + pKeys[pi7] + '" firstSeen > lastSeen');
      }
    }

    // 22: lastSeen not in future
    var futureCut = nowISO();
    for (var pi8 = 0; pi8 < pKeys.length; pi8++) {
      if (p.weaknesses[pKeys[pi8]].lastSeen > futureCut) {
        return fail('Check22', 'Weakness "' + pKeys[pi8] + '" lastSeen is in the future');
      }
    }

    // 23: archivedSummaries past-month entries append-only/immutable
    var prevArch = prevBucket.archivedSummaries || {};
    var prevArchKeys = Object.keys(prevArch);
    for (var pa = 0; pa < prevArchKeys.length; pa++) {
      var mk23 = prevArchKeys[pa];
      if (!(mk23 in (p.archivedSummaries || {}))) {
        return fail('Check23', 'archivedSummaries lost previously-archived month "' + mk23 + '"');
      }
      // Identical comparison via JSON serialization
      if (JSON.stringify(p.archivedSummaries[mk23]) !== JSON.stringify(prevArch[mk23])) {
        return fail('Check23', 'archivedSummaries month "' + mk23 + '" was modified after first written');
      }
    }

    // 24: bucket isolation — none of this bucket's activeGames may appear in another bucket
    for (var ai24 = 0; ai24 < p.activeGames.length; ai24++) {
      var idCheck = p.activeGames[ai24].id;
      if (otherBucketActiveIds && otherBucketActiveIds[idCheck]) {
        return fail('Check24',
          'Game ' + idCheck + ' appears in bucket "' + bucketName + '" and also in bucket "' + otherBucketActiveIds[idCheck] + '"');
      }
    }

    return { ok: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6 — CLAUDE API INTEGRATION
  // ═══════════════════════════════════════════════════════════════════════════

  function buildSystemPrompt() {
    return [
      'You are a chess data analyst. Your job is to merge new game data into an existing coaching memory file.',
      '',
      'CRITICAL RULES — these are non-negotiable:',
      '',
      'FIELD REQUIREMENTS for each weakness and strength:',
      '- The OBJECT KEY (e.g. \'missedConversions\') is a camelCase identifier — does not appear in user UI',
      '- The \'title\' field is the HUMAN-READABLE display name shown to the user — must be Title Case with spaces (e.g. \'Missed Conversions\', \'Blunders Under Pressure\', \'Premature Opening Deviations\')',
      '- The \'title\' must NEVER be empty',
      '- The \'title\' must NEVER equal the object key',
      '- The \'narrativeDescription\' is a full sentence explanation',
      '- All three fields (title, narrativeDescription, plus severity/stockfishClassification for weaknesses) are required for every weakness and strength',
      '',
      'Example of CORRECT weakness object:',
      '{ "missedConversions": { "title": "Missed Conversions", "severity": "critical", "stockfishClassification": "blunder", "narrativeDescription": "Reaching winning positions but failing to convert them...", ... } }',
      '',
      'Example of WRONG output (will be rejected):',
      '{ "missedConversions": { "title": "", ... } }   <-- empty title is rejected',
      '{ "blunderUnderPressure": { "title": "", ... } } <-- empty title is rejected',
      '',
      'DATE REQUIREMENTS for firstSeen and lastSeen:',
      '- firstSeen MUST equal or be after the earliest game.savedAt date among the games containing this weakness\'s classification',
      '- For a NEW weakness (not in previous memory), firstSeen should be the earliest game.savedAt date of the games where this pattern first appears',
      '- For an EXISTING weakness, firstSeen must remain UNCHANGED from previous memory — never modify firstSeen on an existing weakness',
      '- lastSeen must be the most recent game.savedAt date where this pattern occurred',
      '- Both dates must be in ISO 8601 format',
      '- Never use a date that doesn\'t appear in the provided games data',
      '',
      'The game data I provide includes game.savedAt for every game. Use those exact values. Do not estimate, round, or generate new dates.',
      '',
      '1. You can only use data that is actually present in the game analysis I provide. Do not invent game IDs, dates, counts, or eval numbers.',
      '2. All numeric data (eval drops, accuracy, classifications) comes from Stockfish analysis. Use only the values I provide.',
      '3. Stockfish classifications (blunder/mistake/inaccuracy/miss) are immutable. If a move is classified as "blunder" in the data, you must store it as "blunder".',
      '4. Your role is to write narrative descriptions of patterns. You are NOT determining what is a blunder — Stockfish already did that.',
      '5. activeOccurrences and historicalOccurrences counts MUST be computed from the data I provide. Do not estimate.',
      '6. Maintain the exact memory schema. Do not invent new fields. Do not drop existing fields.',
      '7. New weaknesses require evidence from at least 3 games before being added.',
      '8. Game IDs must come from the data provided — never generate them.',
      '',
      'Respond with ONLY valid JSON matching the exact bucket schema. No markdown, no commentary, no code fences. Include ALL fields from the current memory state plus your updates. Do not omit existing weaknesses or strengths unless they have aged out completely.'
    ].join('\n');
  }

  function buildGamePayload(game) {
    var pc = game.playerColor || 'white';
    var classified = (game.analysis && game.analysis.moves || []).filter(function (m) {
      return m && m.color === pc && ALLOWED_CLASSIFICATIONS.indexOf(m.classification) >= 0;
    }).map(function (m) {
      return {
        ply:            m.ply,
        san:            m.san,
        classification: m.classification,
        evalBefore:     m.evalBefore,
        evalAfter:      m.eval,
        evalLoss:       m.evalLoss,
        bestMoveSan:    m.bestMoveSan,
        fenBefore:      Array.isArray(game.fens) ? game.fens[m.ply - 1] : null
      };
    });
    return {
      id:           game._fullKey,
      date:         game.savedAt,
      opening:      (game.analysis && game.analysis.opening && game.analysis.opening.name) || '',
      eco:          (game.analysis && game.analysis.opening && game.analysis.opening.eco)  || '',
      playerColor:  pc,
      result:       (game.metadata && game.metadata.result) || '*',
      accuracy:     (game.analysis && game.analysis.summary && game.analysis.summary.accuracy) || null,
      classifiedMoves: classified
    };
  }

  function buildUserPrompt(bucketName, currentBucket, newGames, agingOutSummaries) {
    var parts = [
      'Current memory state for bucket "' + bucketName + '":',
      JSON.stringify(currentBucket),
      '',
      'New games to incorporate (' + newGames.length + '):',
      JSON.stringify(newGames.map(buildGamePayload)),
      '',
      'Games to age out (60-90 days old, weight 0.25):',
      JSON.stringify(agingOutSummaries),
      '',
      'Your task:',
      '1. Update activeOccurrences for each weakness based on new game data',
      '2. Update historicalOccurrences (lifetime counter — can only go up)',
      '3. Add new weaknesses ONLY if a clear pattern emerges in 3+ new games',
      '4. Update trends.accuracyByMonth, blundersPerGameByMonth, totalGamesByMonth for months containing new games',
      '5. Move aged-out game data into archivedSummaries for the appropriate month',
      '6. Update narrativeDescription for weaknesses where the pattern has meaningfully changed',
      '7. Update openings dictionary with new games openings',
      '8. Do not remove existing weaknesses unless they have NO occurrences in the last 90 days',
      '',
      'Respond with ONLY the updated bucket JSON. No markdown, no commentary.'
    ];
    return parts.join('\n');
  }

  function withTimeout(promise, ms, errMsg) {
    return new Promise(function (resolve, reject) {
      var to = setTimeout(function () { reject(new Error(errMsg || 'timeout')); }, ms);
      promise.then(function (v) { clearTimeout(to); resolve(v); },
                   function (e) { clearTimeout(to); reject(e); });
    });
  }

  function parseClaudeJSON(text) {
    if (!text || typeof text !== 'string') return null;
    var s = text.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    var first = s.indexOf('{');
    var last  = s.lastIndexOf('}');
    if (first < 0 || last <= first) return null;
    var slice = s.slice(first, last + 1);
    try { return JSON.parse(slice); } catch (_) { return null; }
  }

  async function callClaudeForBucket(bucketName, currentBucket, newGames, agingOutSummaries) {
    var body = {
      model:      'claude-sonnet-4-6',
      max_tokens: 6000,
      system:     buildSystemPrompt(),
      messages:   [{ role: 'user', content: buildUserPrompt(bucketName, currentBucket, newGames, agingOutSummaries) }]
    };
    var resp;
    try {
      resp = await withTimeout(
        fetch(SERVER_URL + '/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }),
        CLAUDE_TIMEOUT_MS,
        'Claude API timeout'
      );
    } catch (err) {
      throw new Error(err && err.message ? err.message : 'Claude API network error');
    }
    if (!resp.ok) throw new Error('Claude API error ' + resp.status);
    var data = await resp.json();
    var text = data && data.content && data.content[0] && data.content[0].text;
    var parsed = parseClaudeJSON(text);
    if (!parsed) throw new Error('Claude returned unparseable JSON');
    return parsed;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 7 — UPDATE FLOW
  // ═══════════════════════════════════════════════════════════════════════════

  function showRejectionToast(reason) {
    try {
      window.dispatchEvent(new CustomEvent('memory-rejection', { detail: { reason: reason } }));
    } catch (_) {}

    // Inline toast (so it works on pages without a dedicated toast element)
    try {
      var existing = document.getElementById('mem-toast');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      if (!document.body) return;
      var el = document.createElement('div');
      el.id = 'mem-toast';
      el.style.cssText =
        'position:fixed;right:20px;bottom:20px;z-index:99999;' +
        'background:#450a0a;color:#fca5a5;border:1px solid #7f1d1d;' +
        'padding:10px 14px;border-radius:8px;font:13px/1.4 system-ui,sans-serif;' +
        'max-width:340px;box-shadow:0 4px 18px rgba(0,0,0,0.45);';
      var checkMatch = reason && reason.match(/^(Check\d+):\s*([\s\S]*)$/);
      var checkLabel = checkMatch ? checkMatch[1] : null;
      var checkBody  = checkMatch ? checkMatch[2] : reason;
      el.textContent = 'Memory update rejected' + (checkLabel ? ' (' + checkLabel + ')' : '') + ': ' + checkBody + '. See profile audit log.';
      document.body.appendChild(el);
      setTimeout(function () {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }, 8000);
    } catch (_) {}
  }

  function setHealth(status, message, extra) {
    var h = readHealth();
    h.status = status;
    h.message = message || '';
    if (status === 'healthy') {
      h.lastUpdateAccepted = nowISO();
      h.consecutiveRejections = 0;
    } else {
      h.lastUpdateRejected = nowISO();
      h.consecutiveRejections = (h.consecutiveRejections || 0) + 1;
      if (h.consecutiveRejections >= 3) h.status = 'broken';
    }
    if (extra && typeof extra === 'object') {
      Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    }
    writeHealth(h);
    return h;
  }

  // Folds an aging-out game's contribution into archivedSummaries.
  function foldGameIntoArchive(bucket, game) {
    if (!game) return;
    var mk = monthKey(game.savedAt);
    if (!mk) return;
    var s = bucket.archivedSummaries[mk] || { gamesPlayed: 0, accuracy: 0, blunders: 0, mainWeakness: '' };
    var accSum = (s.accuracy || 0) * (s.gamesPlayed || 0);
    var games = (s.gamesPlayed || 0) + 1;
    var ga = (game.analysis && game.analysis.summary && game.analysis.summary.accuracy) || 0;
    var gb = (game.analysis && game.analysis.summary && game.analysis.summary.blunders) || 0;
    s.gamesPlayed = games;
    s.accuracy = games > 0 ? (accSum + ga) / games : 0;
    s.blunders = (s.blunders || 0) + gb;
    s.mainWeakness = s.mainWeakness || (game.analysis && game.analysis.summary && game.analysis.summary.weakness) || '';
    bucket.archivedSummaries[mk] = s;
  }

  // Reapplies age weights, removes >90d games, folds them into archivedSummaries.
  // Returns { droppedIds: [...] } for diagnostics.
  function reapplyAgeWeights(memory, gameIndex) {
    var now = nowISO();
    var dropped = [];
    ['bullet','blitz','rapid'].forEach(function (bn) {
      var b = memory.buckets[bn];
      var kept = [];
      for (var i = 0; i < b.activeGames.length; i++) {
        var e = b.activeGames[i];
        var w = calcAgeWeight(e.date, now);
        if (w == null) {
          dropped.push(e.id);
          var g = gameIndex[e.id];
          if (g) foldGameIntoArchive(b, g);
        } else {
          e.ageWeight = w;
          kept.push(e);
        }
      }
      b.activeGames = kept;
    });
    return { droppedIds: dropped };
  }

  // Enforces the 25-game cap. Returns the list of removed ids per bucket.
  function enforceActiveCap(bucket, gameIndex) {
    if (bucket.activeGames.length <= ACTIVE_GAMES_CAP) return [];
    bucket.activeGames.sort(function (a, b) {
      // newest first; we'll slice the tail
      return (b.date || '').localeCompare(a.date || '');
    });
    var keep = bucket.activeGames.slice(0, ACTIVE_GAMES_CAP);
    var drop = bucket.activeGames.slice(ACTIVE_GAMES_CAP);
    drop.forEach(function (e) {
      var g = gameIndex[e.id];
      if (g) foldGameIntoArchive(bucket, g);
    });
    bucket.activeGames = keep;
    return drop.map(function (e) { return e.id; });
  }

  // Memory-level validation that wraps the per-bucket checks plus check 2/3/9.
  function validateMemoryUpdate(prev, proposed, expectedNewGameRouting, gameIndex) {
    function fail(check, reason) { return { ok: false, failedCheck: check, reason: reason }; }

    // Check 1: version
    if (typeof proposed.version !== 'number' || proposed.version !== VERSION) {
      return fail('Check1', 'proposed.version is not ' + VERSION);
    }
    // Check 2: metadata
    var md = proposed.metadata || {};
    var mdFields = ['createdAt','lastUpdated','lastFullRegenerate','updatesSinceFullRegenerate','newGamesSinceLastBackup'];
    for (var i = 0; i < mdFields.length; i++) {
      if (!(mdFields[i] in md)) return fail('Check2', 'metadata missing field: ' + mdFields[i]);
    }
    // Check 3: buckets
    if (!proposed.buckets || !proposed.buckets.bullet || !proposed.buckets.blitz || !proposed.buckets.rapid) {
      return fail('Check3', 'proposed.buckets missing bullet/blitz/rapid');
    }
    // Check 9: lastUpdated must advance
    if (prev && prev.metadata && md.lastUpdated <= prev.metadata.lastUpdated) {
      return fail('Check9', 'metadata.lastUpdated did not advance');
    }

    // Per-bucket
    var names = ['bullet','blitz','rapid'];
    // Build cross-bucket "where else does this id live?" map for Check 24
    var otherBucketActiveIds = {};
    names.forEach(function (n) {
      (proposed.buckets[n].activeGames || []).forEach(function (e) {
        otherBucketActiveIds[e.id] = otherBucketActiveIds[e.id]
          ? otherBucketActiveIds[e.id]   // first occurrence wins; second will trigger Check24
          : n;
      });
    });

    for (var bi = 0; bi < names.length; bi++) {
      var bn = names[bi];
      // Per-Check-24 map for this bucket: every id that appears in a DIFFERENT bucket
      var foreignIds = {};
      names.forEach(function (other) {
        if (other === bn) return;
        (proposed.buckets[other].activeGames || []).forEach(function (e) {
          foreignIds[e.id] = other;
        });
      });
      var res = validateProposedBucket(
        prev, bn,
        (prev && prev.buckets && prev.buckets[bn]) || emptyBucket(),
        proposed.buckets[bn],
        expectedNewGameRouting, gameIndex, foreignIds
      );
      if (!res.ok) {
        res.bucket = bn;
        return res;
      }
    }
    return { ok: true };
  }

  function diffSummary(prev, proposed, newGameIds, droppedIds) {
    var parts = [];
    ['bullet','blitz','rapid'].forEach(function (bn) {
      var pb = (prev && prev.buckets && prev.buckets[bn]) || emptyBucket();
      var nb = proposed.buckets[bn];
      var added = Object.keys(nb.weaknesses).filter(function (k) { return !pb.weaknesses[k]; });
      var removed = Object.keys(pb.weaknesses).filter(function (k) { return !nb.weaknesses[k]; });
      parts.push(bn + ': ' + (added.length ? '+' + added.length + 'w ' : '') + (removed.length ? '-' + removed.length + 'w ' : '') + (nb.activeGames.length - pb.activeGames.length >= 0 ? '+' : '') + (nb.activeGames.length - pb.activeGames.length) + 'g');
    });
    return parts.join(' · ') + ' (' + newGameIds.length + ' new, ' + droppedIds.length + ' dropped)';
  }

  // Overlay memory-derived fields onto current csa_recommendations.
  // STEP 1 RULE: only overwrite topWeaknesses and openingReport.openings.
  // Preserve all other existing fields (overallAssessment, phaseAnalysis,
  // tacticalPatterns, improvements, weeklyStudyPlan, nextGoals, coachMessage,
  // accuracyTrend, repertoireAssessment) — they are generated by other paths
  // and Step 1 explicitly promises ZERO behavior change.
  function pickPrimaryBucket(memory) {
    var names = ['bullet','blitz','rapid'];
    var best = null, bestN = -1;
    names.forEach(function (n) {
      var b = memory.buckets[n];
      if (b && b.gamesAnalyzedEver > bestN) { best = b; bestN = b.gamesAnalyzedEver; }
    });
    return best || memory.buckets.rapid;
  }

  function deriveTopWeaknesses(bucket) {
    var keys = Object.keys(bucket.weaknesses || {});
    var arr = keys.map(function (k) {
      var w = bucket.weaknesses[k];
      return {
        title:        w.title,
        severity:     w.severity,
        frequency:    w.activeOccurrences + 'x active / ' + w.historicalOccurrences + 'x lifetime',
        description:  w.narrativeDescription || '',
        examples:    (w.exampleGameIds || []).map(function (id) { return { gameId: id, description: w.title }; }),
        _sortKey:     SEVERITY_RANK[w.severity] * 1000 + w.activeOccurrences
      };
    });
    arr.sort(function (a, b) { return b._sortKey - a._sortKey; });
    return arr.map(function (w) { delete w._sortKey; return w; });
  }

  function deriveOpeningsArray(bucket) {
    var keys = Object.keys(bucket.openings || {});
    return keys.map(function (n) {
      var o = bucket.openings[n];
      var games = o.gamesPlayed || 0;
      var wins = o.wins || 0, draws = o.draws || 0, losses = o.losses || 0;
      return {
        name:            n,
        gamesPlayed:     games,
        averageAccuracy: Math.round(o.avgAccuracy || 0),
        commonMistake:   o.commonMistake || '',
        recommendation:  o.verdict || 'keep',
        gameExamples:    [],
        studyResources:  [],
        _winRate:        games > 0 ? (wins + 0.5 * draws) / games : 0
      };
    }).sort(function (a, b) {
      if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
      return b._winRate - a._winRate;
    }).map(function (o) { delete o._winRate; return o; });
  }

  function writeLegacyRecs(memory) {
    var primary = pickPrimaryBucket(memory);
    var existing = lsGetJSON(KEY.legacyRecs, {}) || {};
    var topW = deriveTopWeaknesses(primary);
    if (topW.length) existing.topWeaknesses = topW;
    var ops = deriveOpeningsArray(primary);
    if (ops.length) {
      existing.openingReport = existing.openingReport || {};
      existing.openingReport.openings = ops;
    }
    lsSetJSON(KEY.legacyRecs, existing);
  }

  // ── Lock helpers ──────────────────────────────────────────────────────────
  function acquireLock() {
    return new Promise(function (resolve) {
      var start = Date.now();
      (function poll() {
        if (!window._memoryUpdateInFlight) {
          window._memoryUpdateInFlight = true;
          resolve(true);
        } else if (Date.now() - start >= LOCK_WAIT_MS) {
          resolve(false);
        } else {
          setTimeout(poll, 100);
        }
      })();
    });
  }
  function releaseLock() { window._memoryUpdateInFlight = false; }

  // ── The main update orchestrator ──────────────────────────────────────────
  async function update(trigger) {
    var locked = await acquireLock();
    if (!locked) {
      return { success: false, reason: 'Update already in progress' };
    }

    var prevMemory = readMemory();
    var startSnapshot = prevMemory ? JSON.parse(JSON.stringify(prevMemory)) : null;
    var skippedGames = [];

    try {
      // Initialize fresh if missing
      if (!prevMemory) prevMemory = emptyMemory();

      // Read all games and build a key→game index
      var allGames = enumerateGames();
      var gameIndex = {};
      allGames.forEach(function (g) { gameIndex[g._fullKey] = g; });

      // Identify games already known to any bucket
      var knownIds = {};
      ['bullet','blitz','rapid'].forEach(function (bn) {
        (prevMemory.buckets[bn].activeGames || []).forEach(function (e) { knownIds[e.id] = bn; });
      });

      // Route new games (and any older orphans) to buckets
      var expectedRouting = {};
      var newGamesByBucket = { bullet: [], blitz: [], rapid: [] };
      allGames.forEach(function (g) {
        if (knownIds[g._fullKey]) {
          expectedRouting[g._fullKey] = knownIds[g._fullKey];
          return;
        }
        var bn = bucketForGame(g);
        if (!bn) {
          skippedGames.push({ id: g._fullKey, reason: 'TimeControl header missing or unparseable' });
          return;
        }
        expectedRouting[g._fullKey] = bn;
        newGamesByBucket[bn].push(g);
      });

      // Apply age weights and drop >90d games — operate on a deep copy so we
      // can compare against prev for validation.
      var working = JSON.parse(JSON.stringify(prevMemory));
      var ageRes = reapplyAgeWeights(working, gameIndex);

      // Inject new games' activeGames entries before calling Claude so the
      // bucket Claude sees already reflects new arrivals; Claude only fills
      // in narrative/aggregations.
      var anyNewGames = false;
      ['bullet','blitz','rapid'].forEach(function (bn) {
        var b = working.buckets[bn];
        newGamesByBucket[bn].forEach(function (g) {
          if (b.activeGames.some(function (e) { return e.id === g._fullKey; })) return;
          b.activeGames.unshift({
            id:        g._fullKey,
            date:      g.savedAt,
            ageWeight: calcAgeWeight(g.savedAt, nowISO()) || 1.0
          });
          b.gamesAnalyzedEver = (b.gamesAnalyzedEver || 0) + 1;
          anyNewGames = true;
        });
        enforceActiveCap(b, gameIndex);
      });

      // Decide if we have anything to do
      var newGameIds = [];
      ['bullet','blitz','rapid'].forEach(function (bn) {
        newGamesByBucket[bn].forEach(function (g) { newGameIds.push(g._fullKey); });
      });

      if (!anyNewGames && ageRes.droppedIds.length === 0) {
        // No-op: nothing to update. Still write current state so age weights persist.
        working.metadata.lastUpdated = nowISO();
        writeMemory(working);
        appendAudit({
          timestamp: nowISO(), trigger: trigger,
          bucketsUpdated: [], gamesAdded: [], gamesAgedOut: [],
          weaknessesAdded: [], weaknessesRemoved: [], weaknessesUpdated: [],
          validationResult: 'passed',
          rejectionReason: null,
          diffSummary: 'no-op (no new games, no aged-out games)',
          claudeTokensUsed: 0,
          autoBackupCreated: false,
          skippedGames: skippedGames
        });
        setHealth('healthy', 'No-op update completed.');
        return { success: true, bucketsUpdated: [], gamesAdded: [], gamesAgedOut: [], noop: true, skippedGames: skippedGames };
      }

      // Try a Claude update for each bucket that has new games or recent drops.
      var bucketsTouched = [];
      for (var bi = 0; bi < 3; bi++) {
        var bn2 = ['bullet','blitz','rapid'][bi];
        var hasNew  = newGamesByBucket[bn2].length > 0;
        var hasDrops = ageRes.droppedIds.length > 0; // not bucket-specific but cheap to send
        if (!hasNew && !hasDrops) continue;
        try {
          var agingOutSummaries = [];
          var proposedBucket = await callClaudeForBucket(
            bn2,
            working.buckets[bn2],
            newGamesByBucket[bn2],
            agingOutSummaries
          );
          working.buckets[bn2] = proposedBucket;
          bucketsTouched.push(bn2);
        } catch (err) {
          var reason = err && err.message ? err.message : 'Claude call failed';
          appendAudit({
            timestamp: nowISO(), trigger: trigger,
            bucketsUpdated: bucketsTouched, gamesAdded: newGameIds, gamesAgedOut: ageRes.droppedIds,
            weaknessesAdded: [], weaknessesRemoved: [], weaknessesUpdated: [],
            validationResult: 'rejected',
            rejectionReason: 'Bucket "' + bn2 + '" Claude call failed: ' + reason,
            diffSummary: 'rejected — Claude error',
            claudeTokensUsed: 0,
            autoBackupCreated: false,
            skippedGames: skippedGames
          });
          setHealth('degraded', reason);
          showRejectionToast(reason);
          return { success: false, reason: reason, skippedGames: skippedGames };
        }
      }

      // Update memory-level metadata
      working.metadata.lastUpdated = nowISO();
      working.metadata.newGamesSinceLastBackup =
        (prevMemory.metadata.newGamesSinceLastBackup || 0) + newGameIds.length;
      if (trigger === 'force_full_regenerate') {
        working.metadata.lastFullRegenerate = nowISO();
        working.metadata.updatesSinceFullRegenerate = 0;
      } else {
        working.metadata.updatesSinceFullRegenerate =
          (prevMemory.metadata.updatesSinceFullRegenerate || 0) + 1;
      }

      // Validate
      var validation = validateMemoryUpdate(prevMemory, working, expectedRouting, gameIndex);
      if (!validation.ok) {
        var rejectReason = validation.failedCheck + ': ' + validation.reason +
          (validation.bucket ? ' (bucket ' + validation.bucket + ')' : '');
        appendAudit({
          timestamp: nowISO(), trigger: trigger,
          bucketsUpdated: bucketsTouched, gamesAdded: newGameIds, gamesAgedOut: ageRes.droppedIds,
          weaknessesAdded: [], weaknessesRemoved: [], weaknessesUpdated: [],
          validationResult: 'rejected',
          rejectionReason: rejectReason,
          diffSummary: 'rejected — validation failed',
          claudeTokensUsed: 0,
          autoBackupCreated: false,
          skippedGames: skippedGames
        });
        setHealth('degraded', rejectReason);
        showRejectionToast(rejectReason);
        return { success: false, reason: rejectReason, skippedGames: skippedGames };
      }

      // Push prior state to history
      pushHistory({
        timestamp:      nowISO(),
        trigger:        trigger,
        memorySnapshot: startSnapshot,
        diffSummary:    diffSummary(prevMemory, working, newGameIds, ageRes.droppedIds)
      });

      // Persist memory + derive legacy recs
      writeMemory(working);
      writeLegacyRecs(working);

      // Auto-backup
      var autoBackupCreated = false;
      if ((working.metadata.newGamesSinceLastBackup || 0) >= AUTO_BACKUP_THRESHOLD) {
        lsSetJSON(KEY.autoBackupMem, working);
        var currentRecs = lsGetJSON(KEY.legacyRecs, null);
        if (currentRecs) lsSetJSON(KEY.autoBackupRecs, currentRecs);
        working.metadata.newGamesSinceLastBackup = 0;
        writeMemory(working);
        autoBackupCreated = true;
      }

      // Compute weakness diffs for the audit entry
      var added = [], removed = [], updated = [];
      ['bullet','blitz','rapid'].forEach(function (bn) {
        var pb = prevMemory.buckets[bn].weaknesses || {};
        var nb = working.buckets[bn].weaknesses || {};
        Object.keys(nb).forEach(function (k) { if (!pb[k]) added.push(bn + ':' + k); else if (JSON.stringify(pb[k]) !== JSON.stringify(nb[k])) updated.push(bn + ':' + k); });
        Object.keys(pb).forEach(function (k) { if (!nb[k]) removed.push(bn + ':' + k); });
      });

      appendAudit({
        timestamp: nowISO(), trigger: trigger,
        bucketsUpdated: bucketsTouched,
        gamesAdded: newGameIds,
        gamesAgedOut: ageRes.droppedIds,
        weaknessesAdded: added,
        weaknessesRemoved: removed,
        weaknessesUpdated: updated,
        validationResult: 'passed',
        rejectionReason: null,
        diffSummary: diffSummary(prevMemory, working, newGameIds, ageRes.droppedIds),
        claudeTokensUsed: 0,
        autoBackupCreated: autoBackupCreated,
        skippedGames: skippedGames
      });

      setHealth('healthy', 'Update succeeded.');
      return {
        success: true,
        bucketsUpdated: bucketsTouched,
        gamesAdded: newGameIds,
        gamesAgedOut: ageRes.droppedIds,
        autoBackupCreated: autoBackupCreated,
        skippedGames: skippedGames
      };

    } catch (err) {
      var msg = (err && err.message) || 'Unknown error during memory update';
      try {
        appendAudit({
          timestamp: nowISO(), trigger: trigger,
          bucketsUpdated: [], gamesAdded: [], gamesAgedOut: [],
          weaknessesAdded: [], weaknessesRemoved: [], weaknessesUpdated: [],
          validationResult: 'rejected',
          rejectionReason: 'Exception: ' + msg,
          diffSummary: 'rejected — exception',
          claudeTokensUsed: 0,
          autoBackupCreated: false,
          skippedGames: skippedGames
        });
      } catch (_) {}
      setHealth('degraded', msg);
      showRejectionToast(msg);
      return { success: false, reason: msg, skippedGames: skippedGames };
    } finally {
      releaseLock();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 8 — PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  function init() {
    try {
      var mem = readMemory();
      if (!mem) {
        // Do NOT seed from csa_recommendations — start fresh per principle 3.
        mem = emptyMemory();
        writeMemory(mem);
      } else if (mem.version !== VERSION) {
        // Migration placeholder. Step 1 only supports version 1.
        mem.version = VERSION;
        writeMemory(mem);
      }
      // Reapply age weights / drop >90d games on every page load
      var all = enumerateGames();
      var gi = {}; all.forEach(function (g) { gi[g._fullKey] = g; });
      reapplyAgeWeights(mem, gi);
      writeMemory(mem);
      // Ensure a health record exists
      var h = lsGetJSON(KEY.health, null);
      if (!h) writeHealth(emptyHealth());
      return mem;
    } catch (err) {
      setHealth('degraded', 'init() failed: ' + (err && err.message));
      return emptyMemory();
    }
  }

  function getMemory()  { return readMemory(); }
  function getBucket(b) {
    var m = readMemory();
    return m && m.buckets && m.buckets[b] ? m.buckets[b] : null;
  }

  function backup() {
    try {
      var mem = readMemory();
      if (mem) lsSetJSON(KEY.manualBackupMem, mem);
      var recs = lsGetJSON(KEY.legacyRecs, null);
      if (recs) lsSetJSON(KEY.manualBackupRecs, recs);
      var ts = nowISO();
      appendAudit({
        timestamp: ts, trigger: 'manual_backup',
        bucketsUpdated: [], gamesAdded: [], gamesAgedOut: [],
        weaknessesAdded: [], weaknessesRemoved: [], weaknessesUpdated: [],
        validationResult: 'passed', rejectionReason: null,
        diffSummary: 'Manual backup created', claudeTokensUsed: 0,
        autoBackupCreated: false, skippedGames: []
      });
      return { success: true, timestamp: ts };
    } catch (err) {
      return { success: false, reason: (err && err.message) || 'backup failed' };
    }
  }

  function undoLastUpdate() {
    try {
      var hist = readHistory();
      if (!hist.length) return { success: false, reason: 'No history to undo' };
      var entry = hist[0]; // most recent
      lsSetJSON(KEY.memory, entry.memorySnapshot);
      writeLegacyRecs(entry.memorySnapshot);
      // Remove the entry we just restored from
      var rest = hist.slice(1);
      writeHistory(rest);
      appendAudit({
        timestamp: nowISO(), trigger: 'undo_last_update',
        bucketsUpdated: [], gamesAdded: [], gamesAgedOut: [],
        weaknessesAdded: [], weaknessesRemoved: [], weaknessesUpdated: [],
        validationResult: 'passed', rejectionReason: null,
        diffSummary: 'Undone to ' + entry.timestamp,
        claudeTokensUsed: 0, autoBackupCreated: false, skippedGames: []
      });
      setHealth('healthy', 'Restored to ' + entry.timestamp);
      return { success: true, restoredTo: entry.timestamp };
    } catch (err) {
      return { success: false, reason: (err && err.message) || 'undo failed' };
    }
  }

  function getHistory() { return readHistory(); }

  function restoreToVersion(historyIndex) {
    try {
      var hist = readHistory();
      if (historyIndex < 0 || historyIndex >= hist.length) {
        return { success: false, reason: 'historyIndex out of range' };
      }
      var entry = hist[historyIndex];
      lsSetJSON(KEY.memory, entry.memorySnapshot);
      writeLegacyRecs(entry.memorySnapshot);
      appendAudit({
        timestamp: nowISO(), trigger: 'restore_to_version',
        bucketsUpdated: [], gamesAdded: [], gamesAgedOut: [],
        weaknessesAdded: [], weaknessesRemoved: [], weaknessesUpdated: [],
        validationResult: 'passed', rejectionReason: null,
        diffSummary: 'Restored to history index ' + historyIndex + ' (' + entry.timestamp + ')',
        claudeTokensUsed: 0, autoBackupCreated: false, skippedGames: []
      });
      setHealth('healthy', 'Restored to ' + entry.timestamp);
      return { success: true, restoredTo: entry.timestamp };
    } catch (err) {
      return { success: false, reason: (err && err.message) || 'restore failed' };
    }
  }

  function restoreFromAutoBackup() {
    try {
      var mem = lsGetJSON(KEY.autoBackupMem, null);
      if (!mem) return { success: false, reason: 'No auto-backup available' };
      var recs = lsGetJSON(KEY.autoBackupRecs, null);
      lsSetJSON(KEY.memory, mem);
      if (recs) lsSetJSON(KEY.legacyRecs, recs);
      appendAudit({
        timestamp: nowISO(), trigger: 'restore_from_auto_backup',
        bucketsUpdated: [], gamesAdded: [], gamesAgedOut: [],
        weaknessesAdded: [], weaknessesRemoved: [], weaknessesUpdated: [],
        validationResult: 'passed', rejectionReason: null,
        diffSummary: 'Restored from auto-backup',
        claudeTokensUsed: 0, autoBackupCreated: false, skippedGames: []
      });
      setHealth('healthy', 'Restored from auto-backup.');
      return { success: true, backupTimestamp: mem.metadata && mem.metadata.lastUpdated };
    } catch (err) {
      return { success: false, reason: (err && err.message) || 'auto-backup restore failed' };
    }
  }

  function restoreFromManualBackup() {
    try {
      var mem = lsGetJSON(KEY.manualBackupMem, null);
      if (!mem) return { success: false, reason: 'No manual backup available' };
      var recs = lsGetJSON(KEY.manualBackupRecs, null);
      lsSetJSON(KEY.memory, mem);
      if (recs) lsSetJSON(KEY.legacyRecs, recs);
      appendAudit({
        timestamp: nowISO(), trigger: 'restore_from_manual_backup',
        bucketsUpdated: [], gamesAdded: [], gamesAgedOut: [],
        weaknessesAdded: [], weaknessesRemoved: [], weaknessesUpdated: [],
        validationResult: 'passed', rejectionReason: null,
        diffSummary: 'Restored from manual backup',
        claudeTokensUsed: 0, autoBackupCreated: false, skippedGames: []
      });
      setHealth('healthy', 'Restored from manual backup.');
      return { success: true, backupTimestamp: mem.metadata && mem.metadata.lastUpdated };
    } catch (err) {
      return { success: false, reason: (err && err.message) || 'manual backup restore failed' };
    }
  }

  function reset() {
    try {
      lsRemove(KEY.memory);
      lsRemove(KEY.history);
      writeHealth(emptyHealth());
      appendAudit({
        timestamp: nowISO(), trigger: 'reset',
        bucketsUpdated: [], gamesAdded: [], gamesAgedOut: [],
        weaknessesAdded: [], weaknessesRemoved: [], weaknessesUpdated: [],
        validationResult: 'passed', rejectionReason: null,
        diffSummary: 'Memory reset (csa_recommendations and csa_game_* preserved)',
        claudeTokensUsed: 0, autoBackupCreated: false, skippedGames: []
      });
      return { success: true };
    } catch (err) {
      return { success: false, reason: (err && err.message) || 'reset failed' };
    }
  }

  function getAuditLog() { return readAudit(); }

  function getHealth() {
    var h = readHealth();
    // Build a useful one-line summary based on current memory state
    var mem = readMemory();
    if (mem) {
      var total = ['bullet','blitz','rapid'].reduce(function (n, b) { return n + (mem.buckets[b].activeGames.length); }, 0);
      h.totalActiveGames = total;
      h.bucketCounts = {
        bullet: mem.buckets.bullet.activeGames.length,
        blitz:  mem.buckets.blitz.activeGames.length,
        rapid:  mem.buckets.rapid.activeGames.length
      };
      h.lastUpdated = mem.metadata.lastUpdated;
    }
    return h;
  }

  // ── Page-load init ────────────────────────────────────────────────────────
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { try { init(); } catch (_) {} });
    } else {
      try { init(); } catch (_) {}
    }
  }

  // ── Public exports ────────────────────────────────────────────────────────
  window.ChessLabMemory = {
    init:                     init,
    getMemory:                getMemory,
    getBucket:                getBucket,
    update:                   update,
    backup:                   backup,
    undoLastUpdate:           undoLastUpdate,
    getHistory:               getHistory,
    restoreToVersion:         restoreToVersion,
    restoreFromAutoBackup:    restoreFromAutoBackup,
    restoreFromManualBackup:  restoreFromManualBackup,
    reset:                    reset,
    getAuditLog:              getAuditLog,
    getHealth:                getHealth,
    _VERSION:                 VERSION,
    _KEYS:                    KEY
  };
})();

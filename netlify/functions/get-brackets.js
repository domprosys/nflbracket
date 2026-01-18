import { neon } from '@neondatabase/serverless';

// 1 point per correct prediction, regardless of round

export default async (req) => {
  try {
    const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
    
    if (!connectionString) {
      return new Response(JSON.stringify({ error: 'Database not configured' }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const sanitizedConnectionString = connectionString.replace('channel_binding=require&', '').replace('&channel_binding=require', '').replace('?channel_binding=require', '?');
    const sql = neon(sanitizedConnectionString);

    // Get all predictions - first try with score column, fallback to without
    let predictions = [];
    let hasScoreColumn = true;
    try {
      const result = await sql`SELECT id, predictions, creator, created_at, score FROM predictions ORDER BY created_at`;
      predictions = result;
    } catch (e) {
      // score column might not exist yet, try without it
      console.log('Score column not found, querying without it');
      hasScoreColumn = false;
      try {
        const result = await sql`SELECT id, predictions, creator, created_at FROM predictions ORDER BY created_at`;
        predictions = result;
      } catch (e2) {
        console.error('Failed to query predictions:', e2.message);
        predictions = [];
      }
    }

    // Get all results
    let resultsMap = {};
    try {
      const results = await sql`SELECT round, conference, matchup_id, team1, team2, score1, score2, winner FROM results`;
      results.forEach(r => {
        const key = `${r.round}-${r.conference}-${r.matchup_id}`;
        resultsMap[key] = {
          team1: r.team1,
          team2: r.team2,
          score1: r.score1,
          score2: r.score2,
          winner: r.winner
        };
      });
    } catch (e) {
      // Table doesn't exist yet
    }

    // Process each bracket: compute score and alive status
    const brackets = predictions.map(row => {
      const preds = row.predictions;
      if (!Array.isArray(preds)) {
        return {
          id: row.id,
          creator: row.creator || 'Anonymous',
          predictions: [],
          score: 0,
          alive: false,
          aliveAfterWildCard: false
        };
      }

      let score = 0;
      let alive = true;
      let aliveAfterWildCard = true;

      // New scoring: count teams correctly predicted to reach each round
      // Collect actual teams that reached each round from results
      const actualDivisional = new Set(); // WC winners (exclude #1 seeds)
      const actualConference = new Set(); // Divisional winners
      const actualSB = new Set(); // Conference winners
      let actualChampion = null; // SB winner

      for (const key in resultsMap) {
        const result = resultsMap[key];
        const [round] = key.split('-');

        if (round === 'wildcard') {
          actualDivisional.add(result.winner); // WC winner advances to divisional
        }
        if (round === 'divisional') {
          actualConference.add(result.winner); // Divisional winner advances to conference
        }
        if (round === 'conference') {
          actualSB.add(result.winner); // Conference winner advances to SB
        }
        if (round === 'sb') {
          actualChampion = result.winner; // SB winner is champion
        }
      }

      // Get user's predicted teams at each round
      const predictedDivisional = preds.filter(p => p.round === 'divisional').map(p => p.team);
      const predictedConference = preds.filter(p => p.round === 'conference').map(p => p.team);
      const predictedSB = preds.filter(p => p.round === 'sb').map(p => p.team);
      const predictedChampion = preds.find(p => p.round === 'champion')?.team;

      // Score: 1 point for each team correctly predicted to reach that round
      // Divisional: only count WC winners (not #1 seeds who had bye)
      for (const team of actualDivisional) {
        if (predictedDivisional.includes(team)) {
          score += 1;
        }
      }

      // Conference: count divisional winners user predicted to be in conference
      for (const team of actualConference) {
        if (predictedConference.includes(team)) {
          score += 1;
        }
      }

      // Super Bowl: count conference winners user predicted to be in SB
      for (const team of actualSB) {
        if (predictedSB.includes(team)) {
          score += 1;
        }
      }

      // Champion: 1 point if predicted correctly
      if (actualChampion && predictedChampion === actualChampion) {
        score += 1;
      }

      // Alive status: check if all predictions match actual results
      for (const team of actualDivisional) {
        if (!predictedDivisional.includes(team)) {
          alive = false;
          aliveAfterWildCard = false;
        }
      }
      for (const team of actualConference) {
        if (!predictedConference.includes(team)) {
          alive = false;
        }
      }
      for (const team of actualSB) {
        if (!predictedSB.includes(team)) {
          alive = false;
        }
      }
      if (actualChampion && predictedChampion !== actualChampion) {
        alive = false;
      }

      // Check if bracket has all required predictions (complete bracket)
      const hasDivisional = preds.filter(p => p.round === 'divisional').length >= 6;
      const hasConference = preds.filter(p => p.round === 'conference').length >= 4;
      const hasSB = preds.filter(p => p.round === 'sb').length >= 2;
      const hasChampion = preds.filter(p => p.round === 'champion').length >= 1;
      
      const isComplete = hasDivisional && hasConference && hasSB && hasChampion;
      
      if (!isComplete) {
        aliveAfterWildCard = false;
        alive = false;
      }

      // Use pre-computed score from DB if available, otherwise use calculated
      const finalScore = row.score !== null && row.score !== undefined ? row.score : score;

      return {
        id: row.id,
        creator: row.creator || 'Anonymous',
        predictions: preds,
        score: finalScore,
        alive,
        aliveAfterWildCard,
        created_at: row.created_at
      };
    });

    // Filter to only complete brackets (have all required predictions)
    const completeBrackets = brackets.filter(b => {
      const preds = b.predictions;
      if (!Array.isArray(preds)) return false;
      const hasDivisional = preds.filter(p => p.round === 'divisional').length >= 6;
      const hasConference = preds.filter(p => p.round === 'conference').length >= 4;
      const hasSB = preds.filter(p => p.round === 'sb').length >= 2;
      const hasChampion = preds.filter(p => p.round === 'champion').length >= 1;
      return hasDivisional && hasConference && hasSB && hasChampion;
    });
    
    // Sort by score (descending), then by created_at (ascending - earlier first)
    completeBrackets.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(a.created_at) - new Date(b.created_at);
    });
    
    // Calculate max possible points based on teams that advanced
    // Divisional: 6 WC winners (exclude #1 seeds), Conference: 4, SB: 2, Champion: 1
    let maxPoints = 0;
    let wcCount = 0, divCount = 0, confCount = 0, sbCount = 0;
    for (const key in resultsMap) {
      const [round] = key.split('-');
      if (round === 'wildcard') wcCount++;
      if (round === 'divisional') divCount++;
      if (round === 'conference') confCount++;
      if (round === 'sb') sbCount++;
    }
    maxPoints = wcCount + divCount + confCount + sbCount; // Each result = 1 team advancing = 1 possible point
    const totalMatches = maxPoints;
    
    // Filter for leaderboard: show brackets with score >= 5
    const leaderboardBrackets = completeBrackets.filter(b => b.score >= 5);
    
    // For backwards compatibility
    const qualifiedBrackets = leaderboardBrackets;

    const aliveBrackets = completeBrackets.filter(b => b.alive).length;

    return new Response(JSON.stringify({ 
      brackets: qualifiedBrackets,
      totalQualified: qualifiedBrackets.length,
      totalMatches,
      aliveBrackets,
      results: resultsMap
    }), {
      headers: { 
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate"
      }
    });

  } catch (error) {
    console.error('Get brackets error:', error.message);
    return new Response(JSON.stringify({ error: 'Failed to get brackets' }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

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

      // Check results - 1 point per correct prediction
      for (const key in resultsMap) {
        const result = resultsMap[key];
        const [round, conference, matchupIdStr] = key.split('-');

        if (round === 'wildcard') {
          const winnerInDivisional = preds.some(p => 
            p.round === 'divisional' && p.team === result.winner
          );
          
          if (winnerInDivisional) {
            score += 1;
          } else {
            alive = false;
            aliveAfterWildCard = false;
          }
        }

        if (round === 'divisional') {
          const winnerInConference = preds.some(p => 
            p.round === 'conference' && p.team === result.winner
          );
          
          if (winnerInConference) {
            score += 1;
          } else {
            alive = false;
          }
        }

        if (round === 'conference') {
          const winnerInSB = preds.some(p => 
            p.round === 'sb' && p.team === result.winner
          );
          
          if (winnerInSB) {
            score += 1;
          } else {
            alive = false;
          }
        }

        if (round === 'sb') {
          const winnerIsChampion = preds.some(p => 
            p.round === 'champion' && p.team === result.winner
          );
          
          if (winnerIsChampion) {
            score += 1;
          } else {
            alive = false;
          }
        }
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
        aliveAfterWildCard
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
    
    // Sort by score (descending)
    completeBrackets.sort((a, b) => {
      return b.score - a.score;
    });
    
    // Count total matches with results registered
    const totalMatches = Object.keys(resultsMap).length;
    
    // Filter for leaderboard: show all brackets (sorted by score)
    const leaderboardBrackets = completeBrackets;
    
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

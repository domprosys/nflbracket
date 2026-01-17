import { neon } from '@neondatabase/serverless';

// Points per round
const POINTS = {
  wildcard: 1,    // For picking WC winner (shown in divisional)
  divisional: 2,  // For picking divisional winner (shown in conference)
  conference: 4,  // For picking conference winner (shown in sb)
  sb: 8,          // For picking SB winner (shown in champion)
  champion: 16    // For picking correct champion
};

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

    // Get all predictions with id, creator, and pre-computed score
    const predictions = await sql('SELECT id, predictions, creator, created_at, score FROM predictions ORDER BY created_at');

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

      // Check Wild Card results (winner should be in divisional predictions)
      for (const key in resultsMap) {
        const result = resultsMap[key];
        const [round, conference, matchupIdStr] = key.split('-');

        if (round === 'wildcard') {
          const winnerInDivisional = preds.some(p => 
            p.round === 'divisional' && p.team === result.winner
          );
          
          if (winnerInDivisional) {
            score += POINTS.wildcard;
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
            score += POINTS.divisional;
          } else {
            alive = false;
          }
        }

        if (round === 'conference') {
          const winnerInSB = preds.some(p => 
            p.round === 'sb' && p.team === result.winner
          );
          
          if (winnerInSB) {
            score += POINTS.conference;
          } else {
            alive = false;
          }
        }

        if (round === 'sb') {
          const winnerIsChampion = preds.some(p => 
            p.round === 'champion' && p.team === result.winner
          );
          
          if (winnerIsChampion) {
            score += POINTS.sb + POINTS.champion;
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

    // Filter to only brackets that were alive after Wild Card
    const qualifiedBrackets = brackets.filter(b => b.aliveAfterWildCard);
    
    // Sort by score (descending), then by alive status
    qualifiedBrackets.sort((a, b) => {
      if (a.alive !== b.alive) return b.alive - a.alive; // Alive first
      return b.score - a.score; // Then by score
    });

    const aliveBrackets = qualifiedBrackets.filter(b => b.alive).length;

    return new Response(JSON.stringify({ 
      brackets: qualifiedBrackets,
      totalQualified: qualifiedBrackets.length,
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

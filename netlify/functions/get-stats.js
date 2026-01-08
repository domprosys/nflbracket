import { neon } from '@neondatabase/serverless';

// Wild Card matchups - teams that play each other
const WC_MATCHUPS = {
  AFC: [
    ['NE', 'LAC'],   // #2 vs #7
    ['JAX', 'BUF'],  // #3 vs #6
    ['PIT', 'HOU']   // #4 vs #5
  ],
  NFC: [
    ['CHI', 'GB'],   // #2 vs #7
    ['PHI', 'SF'],   // #3 vs #6
    ['CAR', 'LAR']   // #4 vs #5
  ]
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

    // Get all predictions
    const predictions = await sql('SELECT predictions, creator FROM predictions');
    
    if (predictions.length === 0) {
      return new Response(JSON.stringify({ 
        totalBrackets: 0,
        teamCounts: {},
        champion: {}
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    const totalBrackets = predictions.length;
    
    // Simple approach: count how many times each team appears in each round
    // Structure: { "divisional": { "NE": 45, "LAC": 33, ... }, "conference": {...}, ... }
    const roundCounts = {
      divisional: {},
      conference: {},
      sb: {},
      champion: {}
    };

    predictions.forEach(row => {
      const preds = row.predictions;
      if (!Array.isArray(preds)) return;

      preds.forEach(pred => {
        if (!pred.team) return;
        
        const round = pred.round;
        if (round === 'divisional' || round === 'conference' || round === 'sb') {
          if (!roundCounts[round][pred.team]) {
            roundCounts[round][pred.team] = 0;
          }
          roundCounts[round][pred.team]++;
        }
        
        if (round === 'champion') {
          if (!roundCounts.champion[pred.team]) {
            roundCounts.champion[pred.team] = 0;
          }
          roundCounts.champion[pred.team]++;
        }
      });
    });

    // Now compute percentages per matchup
    // For each WC matchup, get counts for both teams and compute relative percentages
    const wcStats = {};
    
    ['AFC', 'NFC'].forEach(conf => {
      WC_MATCHUPS[conf].forEach((matchup, idx) => {
        const team1 = matchup[0];
        const team2 = matchup[1];
        
        const count1 = roundCounts.divisional[team1] || 0;
        const count2 = roundCounts.divisional[team2] || 0;
        const matchupTotal = count1 + count2;
        
        const key = `${conf}-${idx}`;
        wcStats[key] = {
          [team1]: matchupTotal > 0 ? Math.round((count1 / matchupTotal) * 100) : 0,
          [team2]: matchupTotal > 0 ? Math.round((count2 / matchupTotal) * 100) : 0,
          total: matchupTotal
        };
      });
    });

    // Champion percentages (relative to total brackets)
    const championPercentages = {};
    for (const team in roundCounts.champion) {
      championPercentages[team] = Math.round((roundCounts.champion[team] / totalBrackets) * 100);
    }

    console.log('Total brackets:', totalBrackets);
    console.log('Divisional counts:', JSON.stringify(roundCounts.divisional));
    console.log('WC Stats:', JSON.stringify(wcStats));

    return new Response(JSON.stringify({ 
      totalBrackets,
      wcStats,
      roundCounts,
      champion: championPercentages
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('Stats error:', error.message);
    return new Response(JSON.stringify({ error: 'Failed to get stats' }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

import { neon } from '@neondatabase/serverless';

// 1 point per correct prediction, regardless of round

export default async (req) => {
  // Only allow POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const { adminKey } = await req.json();

    // Simple admin key check
    const expectedKey = process.env.ADMIN_KEY || 'nflromania2026';
    if (adminKey !== expectedKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
    
    if (!connectionString) {
      return new Response(JSON.stringify({ error: 'Database not configured' }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const sanitizedConnectionString = connectionString.replace('channel_binding=require&', '').replace('&channel_binding=require', '').replace('?channel_binding=require', '?');
    const sql = neon(sanitizedConnectionString);

    // Add score column to predictions table if it doesn't exist
    try {
      await sql`ALTER TABLE predictions ADD COLUMN IF NOT EXISTS score INTEGER DEFAULT 0`;
    } catch (e) {
      // Column might already exist
    }

    // Get all results
    const results = await sql`SELECT round, conference, matchup_id, team1, team2, winner FROM results`;
    const resultsMap = {};
    results.forEach(r => {
      const key = `${r.round}-${r.conference}-${r.matchup_id}`;
      resultsMap[key] = r;
    });

    // Get all predictions
    const predictions = await sql`SELECT id, predictions FROM predictions`;

    let updatedCount = 0;

    // Calculate score for each bracket
    for (const row of predictions) {
      const preds = row.predictions;
      if (!Array.isArray(preds)) continue;

      let score = 0;

      for (const key in resultsMap) {
        const result = resultsMap[key];
        const [round] = key.split('-');

        if (round === 'wildcard') {
          const winnerInDivisional = preds.some(p => 
            p.round === 'divisional' && p.team === result.winner
          );
          if (winnerInDivisional) score += 1;
        }

        if (round === 'divisional') {
          const winnerInConference = preds.some(p => 
            p.round === 'conference' && p.team === result.winner
          );
          if (winnerInConference) score += 1;
        }

        if (round === 'conference') {
          const winnerInSB = preds.some(p => 
            p.round === 'sb' && p.team === result.winner
          );
          if (winnerInSB) score += 1;
        }

        if (round === 'sb') {
          const winnerIsChampion = preds.some(p => 
            p.round === 'champion' && p.team === result.winner
          );
          if (winnerIsChampion) score += 1;
        }
      }

      // Update score in database
      await sql`UPDATE predictions SET score = ${score} WHERE id = ${row.id}`;
      updatedCount++;
    }

    return new Response(JSON.stringify({ 
      success: true,
      message: `Recomputed scores for ${updatedCount} brackets`
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('Recompute scores error:', error.message);
    return new Response(JSON.stringify({ error: 'Failed to recompute scores: ' + error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

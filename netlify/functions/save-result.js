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
    const { round, conference, matchupId, team1, team2, score1, score2, adminKey } = await req.json();

    // Simple admin key check (you should set this in Netlify env vars)
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

    // Create results table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS results (
        id SERIAL PRIMARY KEY,
        round VARCHAR(50) NOT NULL,
        conference VARCHAR(10) NOT NULL,
        matchup_id INTEGER NOT NULL,
        team1 VARCHAR(10) NOT NULL,
        team2 VARCHAR(10) NOT NULL,
        score1 INTEGER NOT NULL,
        score2 INTEGER NOT NULL,
        winner VARCHAR(10) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(round, conference, matchup_id)
      )
    `;

    // Add score column to predictions table if it doesn't exist
    try {
      await sql`ALTER TABLE predictions ADD COLUMN IF NOT EXISTS score INTEGER DEFAULT 0`;
    } catch (e) {
      // Column might already exist
    }

    // Determine winner
    const winner = score1 > score2 ? team1 : team2;

    // Upsert the result
    await sql`
      INSERT INTO results (round, conference, matchup_id, team1, team2, score1, score2, winner)
      VALUES (${round}, ${conference}, ${matchupId}, ${team1}, ${team2}, ${score1}, ${score2}, ${winner})
      ON CONFLICT (round, conference, matchup_id)
      DO UPDATE SET 
        team1 = ${team1},
        team2 = ${team2},
        score1 = ${score1},
        score2 = ${score2},
        winner = ${winner}
    `;

    // Recalculate scores for all brackets
    await recalculateAllScores(sql);

    return new Response(JSON.stringify({ 
      success: true,
      winner,
      message: `Result saved: ${team1} ${score1} - ${score2} ${team2}. Scores recalculated.`
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('Save result error:', error.message);
    return new Response(JSON.stringify({ error: 'Failed to save result: ' + error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

async function recalculateAllScores(sql) {
  // Get all results
  const results = await sql`SELECT round, conference, matchup_id, team1, team2, winner FROM results`;
  const resultsMap = {};
  results.forEach(r => {
    const key = `${r.round}-${r.conference}-${r.matchup_id}`;
    resultsMap[key] = r;
  });

  // Get all predictions
  const predictions = await sql`SELECT id, predictions FROM predictions`;

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
  }
}

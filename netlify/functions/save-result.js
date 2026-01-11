import { neon } from '@neondatabase/serverless';

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

    return new Response(JSON.stringify({ 
      success: true,
      winner,
      message: `Result saved: ${team1} ${score1} - ${score2} ${team2}`
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

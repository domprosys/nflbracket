import { neon } from '@neondatabase/serverless';

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

    // Get all results
    const results = await sql`
      SELECT round, conference, matchup_id, team1, team2, score1, score2, winner
      FROM results
      ORDER BY created_at
    `;

    // Convert to a lookup object for easy access
    const resultsMap = {};
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

    return new Response(JSON.stringify({ 
      results: resultsMap,
      count: results.length
    }), {
      headers: { 
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate"
      }
    });

  } catch (error) {
    // Table might not exist yet, return empty results
    if (error.message.includes('does not exist')) {
      return new Response(JSON.stringify({ results: {}, count: 0 }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    console.error('Get results error:', error.message);
    return new Response(JSON.stringify({ error: 'Failed to get results' }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

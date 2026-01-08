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

    // Get all predictions
    const predictions = await sql('SELECT predictions, creator FROM predictions');
    
    if (predictions.length === 0) {
      return new Response(JSON.stringify({ 
        totalBrackets: 0,
        stats: {},
        champion: {}
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Aggregate stats
    // Structure: { "AFC-divisional-0": { "BUF": 45, "DEN": 30 }, ... }
    const stats = {};
    const championCounts = {};

    predictions.forEach(row => {
      const preds = row.predictions;
      if (!Array.isArray(preds)) return;

      preds.forEach(pred => {
        if (pred.round === 'champion') {
          // Track champion picks separately
          championCounts[pred.team] = (championCounts[pred.team] || 0) + 1;
        } else {
          // Create key for this matchup position
          const conf = pred.conference ? pred.conference.toUpperCase() : '';
          const key = `${conf}-${pred.round}-${pred.slot}`;
          if (!stats[key]) {
            stats[key] = {};
          }
          stats[key][pred.team] = (stats[key][pred.team] || 0) + 1;
        }
      });
    });

    // Convert counts to percentages
    const totalBrackets = predictions.length;
    const percentages = {};

    for (const key in stats) {
      percentages[key] = {};
      for (const team in stats[key]) {
        percentages[key][team] = Math.round((stats[key][team] / totalBrackets) * 100);
      }
    }

    // Champion percentages
    const championPercentages = {};
    for (const team in championCounts) {
      championPercentages[team] = Math.round((championCounts[team] / totalBrackets) * 100);
    }

    return new Response(JSON.stringify({ 
      totalBrackets,
      stats: percentages,
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

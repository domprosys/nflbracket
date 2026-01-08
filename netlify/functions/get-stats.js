import { neon } from '@neondatabase/serverless';

// Wild Card matchups by seed (same for both conferences)
const WC_MATCHUPS = [
  { id: 0, seeds: [2, 7] },  // #2 vs #7
  { id: 1, seeds: [3, 6] },  // #3 vs #6
  { id: 2, seeds: [4, 5] }   // #4 vs #5
];

// Team seed mapping (abbr -> seed)
const TEAM_SEEDS = {
  AFC: { DEN: 1, NE: 2, JAX: 3, PIT: 4, HOU: 5, BUF: 6, LAC: 7 },
  NFC: { SEA: 1, CHI: 2, PHI: 3, CAR: 4, LAR: 5, SF: 6, GB: 7 }
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
        wcStats: {},
        divStats: {},
        confStats: {},
        sbStats: {},
        champion: {}
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    const totalBrackets = predictions.length;
    
    // Initialize stats structures
    // wcStats: { "AFC-0": { "NE": 50, "LAC": 30 }, ... } - per matchup
    const wcStats = {};
    const divStats = {};
    const confStats = {};
    const sbStats = { AFC: {}, NFC: {} };
    const championCounts = {};

    predictions.forEach(row => {
      const preds = row.predictions;
      if (!Array.isArray(preds)) return;

      // Get all teams that advanced to divisional for this bracket
      const divTeams = { AFC: [], NFC: [] };
      
      preds.forEach(pred => {
        const conf = pred.conference ? pred.conference.toUpperCase() : '';
        
        if (pred.round === 'divisional' && pred.team) {
          divTeams[conf].push(pred.team);
        }
        
        if (pred.round === 'conference' && pred.team) {
          const key = `${conf}-${pred.slot}`;
          if (!divStats[key]) divStats[key] = {};
          divStats[key][pred.team] = (divStats[key][pred.team] || 0) + 1;
        }
        
        if (pred.round === 'sb' && pred.team) {
          const confKey = conf.toUpperCase();
          if (!sbStats[confKey]) sbStats[confKey] = {};
          sbStats[confKey][pred.team] = (sbStats[confKey][pred.team] || 0) + 1;
        }
        
        if (pred.round === 'champion' && pred.team) {
          championCounts[pred.team] = (championCounts[pred.team] || 0) + 1;
        }
      });

      // For each conference, determine WC matchup winners
      ['AFC', 'NFC'].forEach(conf => {
        const teamSeeds = TEAM_SEEDS[conf];
        
        WC_MATCHUPS.forEach(matchup => {
          const key = `${conf}-${matchup.id}`;
          if (!wcStats[key]) wcStats[key] = {};
          
          // Find which team from this matchup advanced to divisional
          divTeams[conf].forEach(teamAbbr => {
            const seed = teamSeeds[teamAbbr];
            if (matchup.seeds.includes(seed)) {
              wcStats[key][teamAbbr] = (wcStats[key][teamAbbr] || 0) + 1;
            }
          });
        });
      });
    });

    // Convert counts to percentages
    const wcPercentages = {};
    for (const key in wcStats) {
      wcPercentages[key] = {};
      for (const team in wcStats[key]) {
        wcPercentages[key][team] = Math.round((wcStats[key][team] / totalBrackets) * 100);
      }
    }

    const divPercentages = {};
    for (const key in divStats) {
      divPercentages[key] = {};
      for (const team in divStats[key]) {
        divPercentages[key][team] = Math.round((divStats[key][team] / totalBrackets) * 100);
      }
    }

    const sbPercentages = {};
    for (const conf in sbStats) {
      sbPercentages[conf] = {};
      for (const team in sbStats[conf]) {
        sbPercentages[conf][team] = Math.round((sbStats[conf][team] / totalBrackets) * 100);
      }
    }

    const championPercentages = {};
    for (const team in championCounts) {
      championPercentages[team] = Math.round((championCounts[team] / totalBrackets) * 100);
    }

    console.log('WC Stats:', JSON.stringify(wcPercentages));
    console.log('Champion stats:', JSON.stringify(championPercentages));

    return new Response(JSON.stringify({ 
      totalBrackets,
      wcStats: wcPercentages,
      divStats: divPercentages,
      confStats: {},
      sbStats: sbPercentages,
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

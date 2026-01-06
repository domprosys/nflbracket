import { neon } from '@neondatabase/serverless';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    const { predictions, creator, timestamp } = body;
    
    const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
    
    if (!connectionString) {
      return new Response(JSON.stringify({ success: true, warning: 'Database not configured' }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    const sanitizedConnectionString = connectionString.replace('channel_binding=require&', '').replace('&channel_binding=require', '').replace('?channel_binding=require', '?');
    const sql = neon(sanitizedConnectionString);

    const predictionsJsonString = JSON.stringify(predictions);
    
    const result = await sql(
      'INSERT INTO predictions (creator, predictions, created_at) VALUES ($1, $2::jsonb, $3) RETURNING id',
      [creator, predictionsJsonString, timestamp]
    );

    return new Response(JSON.stringify({ success: true, id: result[0].id }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error('Database error:', error.message);
    return new Response(JSON.stringify({ error: 'Failed to save prediction' }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

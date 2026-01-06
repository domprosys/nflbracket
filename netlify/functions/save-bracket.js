// Version: 2026-01-06-v3
import { neon } from '@neondatabase/serverless';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

    try {
    const body = await req.json();
    console.log('Received request body:', JSON.stringify(body));
    const { predictions, creator, timestamp } = body;
    
    const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
    
    if (!connectionString) {
      console.error('No database connection string found!');
      return new Response(JSON.stringify({ success: false, error: 'Database not configured' }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log('Connection string found, attempting to connect...');
    const sanitizedConnectionString = connectionString.replace('channel_binding=require&', '').replace('&channel_binding=require', '').replace('?channel_binding=require', '?');
    const sql = neon(sanitizedConnectionString);

    // Insert prediction using raw query with explicit JSONB cast
    console.log('Attempting to insert prediction for creator:', creator);
    const predictionsJsonString = JSON.stringify(predictions);
    console.log('Predictions as JSON string:', predictionsJsonString);
    
    // Use parameterized query - $1, $2, $3 are placeholders
    const result = await sql(
      'INSERT INTO predictions (creator, predictions, created_at) VALUES ($1, $2::jsonb, $3) RETURNING id',
      [creator, predictionsJsonString, timestamp]
    );
    console.log('Insert successful, ID:', result[0].id);

    return new Response(JSON.stringify({ success: true, id: result[0].id }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error('Database error:', error);
    console.error('Error details:', error.message, error.stack);
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Failed to save prediction',
      details: error.message 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

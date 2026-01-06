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

    // Insert prediction
    console.log('Attempting to insert prediction for creator:', creator);
    const result = await sql`
      INSERT INTO predictions (creator, predictions, created_at)
      VALUES (${creator}, ${JSON.stringify(predictions)}::jsonb, ${timestamp})
      RETURNING id
    `;
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

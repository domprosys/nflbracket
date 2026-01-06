import { neon } from '@neondatabase/serverless';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

    try {
    const body = await req.json();
    console.log('Received payload:', JSON.stringify(body, null, 2));
    const { predictions, creator, timestamp } = body;
    
    // Connect to Neon database using the environment variable
    // Check both standard DATABASE_URL and NETLIFY_DATABASE_URL
    const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
    
    if (!connectionString) {
      console.warn('No database connection string found');
      // Return success anyway so frontend doesn't break, just log the config error
      return new Response(JSON.stringify({ success: true, warning: 'Database not configured' }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log('Database URL configured, initializing client...');
    
    // Sometimes channel_binding=require causes issues in serverless environments
    const sanitizedConnectionString = connectionString.replace('channel_binding=require&', '').replace('&channel_binding=require', '').replace('?channel_binding=require', '?');
    
    const sql = neon(sanitizedConnectionString);

    try {
      console.log('Testing connection with simple query...');
      const testResult = await sql`SELECT 1 as connected`;
      console.log('Connection test successful:', testResult);
      
      console.log('Checking/Creating table...');
      await sql`
        CREATE TABLE IF NOT EXISTS predictions (
          id SERIAL PRIMARY KEY,
          creator TEXT,
          predictions JSONB,
          created_at TIMESTAMP
        )
      `;
      console.log('Table check complete.');
    } catch (connError) {
      console.error('Initial connection or table check failed:', connError);
      throw connError;
    }

    // Insert prediction
    console.log('Attempting INSERT...');
    try {
      const result = await sql`
        INSERT INTO predictions (creator, predictions, created_at)
        VALUES (${creator}, ${JSON.stringify(predictions)}::jsonb, ${timestamp})
        RETURNING id
      `;
      console.log('Insert successful, ID:', result[0].id);

      return new Response(JSON.stringify({ success: true, id: result[0].id }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (insertError) {
      console.error('Error during INSERT:', insertError);
      throw insertError;
    }
  } catch (error) {
    console.error('Database error:', error);
    return new Response(JSON.stringify({ error: 'Failed to save prediction' }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

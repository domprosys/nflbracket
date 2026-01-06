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
    const sql = neon(connectionString);

    try {
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
    } catch (tableError) {
      console.error('Error creating table:', tableError);
      throw tableError;
    }

    // Insert prediction
    console.log('Attempting INSERT...');
    try {
      const result = await sql`
        INSERT INTO predictions (creator, predictions, created_at)
        VALUES (${creator}, ${predictions}, ${timestamp})
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

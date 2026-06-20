import postgres from 'https://deno.land/x/postgresjs@v3.4.4/mod.js';

Deno.serve(async () => {
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false });
  try {
    const rows = await sql`
      select t.status, t.connection_type, t.attempts, t.error, t.sent_at, t.scheduled_for, now() as server_now
      from campaign_targets t
      join campaigns c on c.id = t.campaign_id
      where c.name = 'teste'
      order by t.created_at desc limit 3`;
    return new Response(JSON.stringify(rows, null, 2), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  } finally {
    await sql.end();
  }
});

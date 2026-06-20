import postgres from 'npm:postgres@3.4.4';
Deno.serve(async () => {
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false });
  const out: Record<string, unknown> = {};
  const q = async (k: string, fn: () => Promise<any>) => { try { const r = await fn(); out[k] = r ?? 'ok'; } catch (e) { out[k] = 'ERR: ' + String(e); } };

  // Confirmar que el test de Hotmart NO dejó residuos
  await q('org_residuo', () => sql`select count(*)::int as n from organizations where hotmart_customer_email='e2e-test-deleteme@example.com'`);
  await q('billing_residuo', () => sql`select count(*)::int as n from billing_history where metadata->>'hotmart_id'='E2E-TEST-TX-DELETEME'`);
  // Confirmar que el lead E2E del quiz tampoco quedó
  await q('lead_quiz_residuo', () => sql`select count(*)::int as n from leads where name='E2E-TEST-DELETEME'`);
  await q('funnel_counter_ok', () => sql`select total_leads from capture_funnels where name ilike '%Peugeot Ideal%'`);

  await sql.end();
  return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
});

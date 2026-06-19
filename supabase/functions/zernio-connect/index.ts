// zernio-connect
// Recibe la API key del wizard, valida contra Zernio (GET /v1/accounts),
// cifra y guarda la conexión, y registra el webhook automáticamente.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { encryptSecret } from '../_shared/meta-crypto.ts';

const ZERNIO_BASE = 'https://zernio.com/api/v1';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function randomSecret(): string {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const sbUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const sbAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: userData, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401);
  const userId = userData.user.id;

  const body = await req.json().catch(() => ({}));
  const { organization_id, api_key, account_id, display_name } = body ?? {};
  if (!organization_id || !api_key) return json({ error: 'missing organization_id or api_key' }, 400);

  const { data: belongs } = await sbAdmin.rpc('user_belongs_to_organization', { _user_id: userId, _org_id: organization_id });
  if (!belongs) return json({ error: 'forbidden' }, 403);

  // 1) Validar la key listando cuentas WhatsApp
  let accounts: any[] = [];
  try {
    const r = await fetch(`${ZERNIO_BASE}/accounts?platform=whatsapp`, { headers: { Authorization: `Bearer ${api_key}` } });
    if (r.status === 401) return json({ error: 'API key inválida' }, 422);
    if (!r.ok) return json({ error: `Zernio respondió ${r.status}` }, 422);
    const data = await r.json();
    accounts = Array.isArray(data?.accounts) ? data.accounts : [];
  } catch (e) {
    return json({ error: `No se pudo contactar Zernio: ${String(e)}` }, 502);
  }
  if (accounts.length === 0) return json({ error: 'No hay números de WhatsApp conectados en esta cuenta de Zernio.' }, 422);

  const acct = account_id ? accounts.find((a) => a._id === account_id) : accounts[0];
  if (!acct) return json({ error: 'account_id no encontrado en la cuenta de Zernio' }, 404);

  const webhookSecret = randomSecret();

  // 2) Guardar conexión (cifrada). Upsert por (org, account_id).
  const { data: saved, error: saveErr } = await sbAdmin
    .from('zernio_connections')
    .upsert({
      organization_id,
      account_id: acct._id,
      api_key_encrypted: await encryptSecret(api_key),
      display_name: display_name || acct.displayName || acct.username || 'Zernio WhatsApp',
      phone_number: acct.username ?? null,
      webhook_secret: webhookSecret,
      status: 'active',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,account_id' })
    .select('id')
    .single();
  if (saveErr || !saved) return json({ error: saveErr?.message ?? 'no se pudo guardar' }, 500);

  const connId = saved.id as string;
  const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/zernio-webhook/${connId}`;

  // 3) Registrar el webhook en Zernio (best-effort)
  let webhookOk = false;
  let webhookError: string | null = null;
  try {
    const r = await fetch(`${ZERNIO_BASE}/webhooks/settings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Vendus CRM',
        url: webhookUrl,
        secret: webhookSecret,
        events: ['message.received', 'message.delivered', 'message.read', 'message.failed'],
      }),
    });
    webhookOk = r.ok;
    if (!r.ok) { const t = await r.text().catch(() => ''); webhookError = `status ${r.status}: ${t.slice(0, 200)}`; }
  } catch (e) {
    webhookError = String(e);
  }
  if (webhookOk) {
    await sbAdmin.from('zernio_connections').update({ webhook_subscribed_at: new Date().toISOString() }).eq('id', connId);
  }

  return json({
    ok: true,
    connection_id: connId,
    account_id: acct._id,
    phone_number: acct.username ?? null,
    display_name: acct.displayName ?? null,
    webhook_url: webhookUrl,
    webhook_secret: webhookSecret,
    webhook_subscribed: webhookOk,
    // Si la key no es de "owner", Zernio rechaza el registro por API; el usuario
    // debe crear el webhook a mano en Zernio → Webhooks con la URL + secret de arriba.
    webhook_manual_setup: !webhookOk,
    ...(webhookError ? { webhook_error: webhookError } : {}),
  });
});

// zernio-conversion
// Envía un evento de conversión a la Conversions API de Zernio (atribución de
// anuncios Click-to-WhatsApp en Meta). Resuelve la conexión + conversación Zernio
// a partir de una conversación de Vendus.
//   POST https://zernio.com/api/v1/whatsapp/conversions
// eventName ∈ LeadSubmitted | Purchase | AddToCart | InitiateCheckout | ViewContent
import { createClient } from 'npm:@supabase/supabase-js@2';
import { decryptSecret } from '../_shared/meta-crypto.ts';

const ZERNIO_BASE = 'https://zernio.com/api/v1';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const ALLOWED = new Set(['LeadSubmitted', 'Purchase', 'AddToCart', 'InitiateCheckout', 'ViewContent']);

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!req.headers.get('Authorization')) return json({ error: 'Unauthorized' }, 401);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));
  const {
    conversation_id,        // conversación de Vendus
    event_name,
    event_id,               // clave de dedup (ej. Purchase-<dealId>)
    value, currency,
    content_ids, email, external_id,
  } = body ?? {};

  if (!conversation_id || !event_name || !event_id) return json({ error: 'conversation_id, event_name y event_id requeridos' }, 400);
  if (!ALLOWED.has(event_name)) return json({ error: `event_name inválido (usar: ${[...ALLOWED].join(', ')})` }, 400);

  // Resolver conversación Vendus → conexión + conversación Zernio
  const { data: conv } = await sb
    .from('webchat_conversations')
    .select('zernio_connection_id, zernio_conversation_id, visitor_phone')
    .eq('id', conversation_id)
    .maybeSingle();
  if (!conv?.zernio_connection_id) return json({ ok: false, skipped: 'not_a_zernio_conversation' });

  const { data: conn } = await sb
    .from('zernio_connections')
    .select('account_id, api_key_encrypted, status')
    .eq('id', conv.zernio_connection_id)
    .maybeSingle();
  if (!conn || conn.status !== 'active') return json({ ok: false, skipped: 'connection_inactive' });

  const apiKey = await decryptSecret(conn.api_key_encrypted);
  const payload: Record<string, unknown> = {
    accountId: conn.account_id,
    eventName: event_name,
    eventId: event_id,
    ...(conv.zernio_conversation_id ? { conversationId: conv.zernio_conversation_id } : { phoneE164: String(conv.visitor_phone ?? '').replace(/^\+/, '') }),
    ...(typeof value === 'number' ? { value } : {}),
    ...(currency ? { currency } : {}),
    ...(Array.isArray(content_ids) ? { contentIds: content_ids } : {}),
    ...(email ? { email } : {}),
    ...(external_id ? { externalId: external_id } : {}),
  };

  try {
    const r = await fetch(`${ZERNIO_BASE}/whatsapp/conversions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    let data: any; try { data = JSON.parse(txt); } catch { data = txt; }
    if (!r.ok) {
      console.error('[zernio-conversion] failed', r.status, txt.slice(0, 300));
      return json({ ok: false, status: r.status, error: data?.error ?? data }, 200);
    }
    return json({ ok: true, eventsReceived: data?.eventsReceived ?? null, traceId: data?.traceId ?? null });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 200);
  }
});

// track-conversion
// Dispatcher único de eventos de conversión (LeadSubmitted/Purchase/...) a Meta.
// Resuelve la conexión de la conversación y enruta:
//   - Zernio  → zernio-conversion (Conversions API vía Zernio)
//   - Meta    → meta-conversion   (CAPI nativa: graph.facebook.com/{dataset}/events)
// Acepta conversation_id directo o lead_id (resuelve su conversación de WhatsApp).
// Desplegar con --no-verify-jwt; valida un secret compartido para llamadas desde DB triggers.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-vendus-secret',
};
function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Auth: service_role bearer O secret compartido (para triggers de DB).
  const sharedSecret = Deno.env.get('CONVERSION_TRIGGER_SECRET') ?? '';
  const auth = req.headers.get('Authorization') ?? '';
  const reqSecret = req.headers.get('x-vendus-secret') ?? '';
  const isService = auth === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (!isService && (!sharedSecret || reqSecret !== sharedSecret)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));
  let { conversation_id, lead_id, event_name, event_id, value, currency, content_ids } = body ?? {};
  if (!event_name || !event_id) return json({ error: 'event_name y event_id requeridos' }, 400);

  // Resolver conversación desde lead_id si hace falta (la más reciente de WhatsApp).
  if (!conversation_id && lead_id) {
    const { data: conv } = await sb
      .from('webchat_conversations')
      .select('id')
      .eq('lead_id', lead_id)
      .eq('channel', 'whatsapp')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    conversation_id = conv?.id ?? null;
  }
  if (!conversation_id) return json({ ok: false, skipped: 'no_conversation' });

  const { data: conv } = await sb
    .from('webchat_conversations')
    .select('zernio_connection_id, meta_connection_id')
    .eq('id', conversation_id)
    .maybeSingle();
  if (!conv) return json({ ok: false, skipped: 'conversation_not_found' });

  const payload = { conversation_id, event_name, event_id, value, currency, content_ids };

  if (conv.zernio_connection_id) {
    const { data, error } = await sb.functions.invoke('zernio-conversion', { body: payload });
    return json({ ok: !error && (data as any)?.ok !== false, provider: 'zernio', result: data, error: error?.message });
  }
  if (conv.meta_connection_id) {
    const { data, error } = await sb.functions.invoke('meta-conversion', { body: payload });
    return json({ ok: !error && (data as any)?.ok !== false, provider: 'meta', result: data, error: error?.message });
  }
  return json({ ok: false, skipped: 'no_official_connection (evolution u otro canal sin CAPI)' });
});

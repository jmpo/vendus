// meta-conversion
// Conversions API NATIVA de Meta para Click-to-WhatsApp (action_source=business_messaging).
//   POST https://graph.facebook.com/v21.0/{dataset_id}/events
// Requiere: dataset_id configurado en la conexión + ctwa_clid capturado en la conversación
// (lo setea meta-whatsapp-webhook desde el referral del primer mensaje tras el click del anuncio).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { decryptSecret } from '../_shared/meta-crypto.ts';

const GRAPH = 'https://graph.facebook.com/v21.0';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!req.headers.get('Authorization')) return json({ error: 'Unauthorized' }, 401);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));
  const { conversation_id, event_name, event_id, value, currency } = body ?? {};
  if (!conversation_id || !event_name || !event_id) return json({ error: 'conversation_id, event_name y event_id requeridos' }, 400);

  const { data: conv } = await sb
    .from('webchat_conversations')
    .select('meta_connection_id, metadata, visitor_phone')
    .eq('id', conversation_id)
    .maybeSingle();
  if (!conv?.meta_connection_id) return json({ ok: false, skipped: 'not_a_meta_conversation' });

  const { data: conn } = await sb
    .from('whatsapp_meta_connections')
    .select('access_token_encrypted, conversions_dataset_id, status')
    .eq('id', conv.meta_connection_id)
    .maybeSingle();
  if (!conn) return json({ ok: false, skipped: 'connection_not_found' });
  if (!conn.conversions_dataset_id) {
    return json({ ok: false, skipped: 'no_dataset_id', message: 'Configurá el Dataset ID de la conexión Meta para enviar conversiones.' });
  }

  const ctwaClid = (conv.metadata as any)?.ctwa_clid ?? null;
  const accessToken = await decryptSecret(conn.access_token_encrypted);

  const userData: Record<string, unknown> = {};
  if (ctwaClid) userData.ctwa_clid = ctwaClid;
  // Sin ctwa_clid el evento se manda igual pero NO atribuye a un anuncio (lead orgánico).

  const event: Record<string, unknown> = {
    event_name,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    event_id,
    user_data: userData,
    ...(typeof value === 'number' || currency
      ? { custom_data: { ...(typeof value === 'number' ? { value } : {}), ...(currency ? { currency } : {}) } }
      : {}),
  };

  try {
    const r = await fetch(`${GRAPH}/${conn.conversions_dataset_id}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [event], access_token: accessToken }),
    });
    const txt = await r.text();
    let data: any; try { data = JSON.parse(txt); } catch { data = txt; }
    if (!r.ok) {
      console.error('[meta-conversion] failed', r.status, txt.slice(0, 300));
      return json({ ok: false, status: r.status, error: data?.error ?? data }, 200);
    }
    return json({ ok: true, events_received: data?.events_received ?? null, fbtrace_id: data?.fbtrace_id ?? null, attributed: !!ctwaClid });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 200);
  }
});

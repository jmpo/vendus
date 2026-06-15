// meta-whatsapp-send
// Envia mensaje via Cloud API. Detecta janela 24h:
//  - dentro: texto/mídia livre
//  - fora: exige template HSM aprovado

import { createClient } from 'npm:@supabase/supabase-js@2';
import { GRAPH_BASE, graphFetch, GraphError } from '../_shared/meta-graph.ts';
import { decryptSecret } from '../_shared/meta-crypto.ts';
import { normalizePhoneBR } from '../_shared/phone.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const sbAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = await req.json().catch(() => ({}));
  const {
    connection_id,
    organization_id,
    to,                        // teléfono destino
    conversation_id,           // opcional: para gravar mensaje + checar janela
    type = 'text',             // text | template | image | audio | video | document
    text,                      // string
    media,                     // { id?, link?, caption?, filename? }
    template,                  // { name, language, components? }
  } = body ?? {};

  if (!connection_id || !to) return json({ error: 'missing connection_id or to' }, 400);

  const { fecha: conn, error: connErr } = await sbAdmin
    .from('whatsapp_meta_connections')
    .select('*')
    .eq('id', connection_id)
    .maybeSingle();
  if (connErr || !conn) return json({ error: 'connection not found' }, 404);
  if (organization_id && conn.organization_id !== organization_id) return json({ error: 'org mismatch' }, 403);
  if (conn.status !== 'active') return json({ error: `connection status=${conn.status}` }, 422);

  // janela 24h
  if (conversation_id && type !== 'template') {
    const { fecha: ok } = await sbAdmin.rpc('is_within_24h_window', { _conversation_id: conversation_id });
    if (!ok) {
      return json({ error: 'OUT_OF_WINDOW', message: 'Fora da janela 24h — envie um template HSM aprovado.' }, 422);
    }
  }

  const accessToken = await decryptSecret(conn.access_token_encrypted);
  const toNorm = (normalizePhoneBR(to) ?? String(to)).replace(/^\+/, '');

  // build payload
  const payload: any = { messaging_product: 'whatsapp', to: toNorm, type };
  if (type === 'text') {
    payload.text = { body: text ?? '', preview_url: true };
  } else if (type === 'template') {
    if (!template?.name || !template?.language) return json({ error: 'template.name e template.language obrigatórios' }, 400);
    payload.template = {
      name: template.name,
      language: { code: template.language },
      ...(template.components ? { components: template.components } : {}),
    };
  } else if (['image', 'audio', 'video', 'document', 'sticker'].includes(type)) {
    payload[type] = { ...(media ?? {}) };
  } else {
    return json({ error: `tipo ${type} no suportado` }, 400);
  }

  // send
  let res: any;
  try {
    res = await graphFetch(`/${conn.phone_number_id}/messages`, accessToken, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const ge = e as GraphError;
    if (conversation_id) {
      await sbAdmin.from('webchat_messages').insert({
        conversation_id,
        direction: 'outbound',
        sender_type: 'agent',
        content: text ?? `[${type}]`,
        content_type: 'text',
        delivery_status: 'failed',
        metadata: { error: ge.graph?.message ?? String(e), payload },
      });
    }
    return json({ error: ge.graph?.message ?? String(e) }, ge.status ?? 500);
  }

  const metaMsgId = res?.messages?.[0]?.id ?? null;

  if (conversation_id) {
    await sbAdmin.from('webchat_messages').insert({
      conversation_id,
      direction: 'outbound',
      sender_type: 'agent',
      content: text ?? `[${type}]`,
      content_type: type === 'text' || type === 'template' ? 'text' : (type === 'image' ? 'image' : type === 'audio' ? 'audio' : 'file'),
      message_type: type,
      meta_message_id: metaMsgId,
      delivery_status: 'sent',
      metadata: { meta_send_payload_type: type, ...(template ? { template } : {}), ...(media ? { media } : {}) },
    });
    await sbAdmin.from('webchat_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation_id);
  }

  return json({ ok: true, meta_message_id: metaMsgId });
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// instagram-send
// Envia DM via Graph: POST /{page_id}/messages
// recipient.id = ig_sender_id (PSID do usuário IG).
// Detecta janela 24h via RPC is_within_24h_window.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { graphFetch, GraphError } from '../_shared/meta-graph.ts';
import { decryptSecret } from '../_shared/meta-crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = await req.json().catch(() => ({}));
  const {
    connection_id,
    organization_id,
    conversation_id,
    recipient_id,                // ig_sender_id (PSID)
    text,
    media,                       // { url, type: 'image'|'video'|'audio'|'file' }
    tag,                         // opcional: 'HUMAN_AGENT', 'ACCOUNT_UPDATE', etc.
  } = body ?? {};

  let connId = connection_id;
  let toId = recipient_id;

  // Resolver via conversation_id se faltar
  if (conversation_id && (!connId || !toId)) {
    const { data: conv } = await sb
      .from('webchat_conversations')
      .select('instagram_connection_id, ig_sender_id, organization_id')
      .eq('id', conversation_id)
      .maybeSingle();
    if (!conv) return json({ error: 'conversation not found' }, 404);
    connId = connId ?? conv.instagram_connection_id;
    toId = toId ?? conv.ig_sender_id;
  }

  if (!connId || !toId) return json({ error: 'missing connection_id or recipient_id' }, 400);

  const { data: conn, error: connErr } = await sb
    .from('instagram_connections')
    .select('*')
    .eq('id', connId)
    .maybeSingle();
  if (connErr || !conn) return json({ error: 'connection not found' }, 404);
  if (organization_id && conn.organization_id !== organization_id) return json({ error: 'org mismatch' }, 403);
  if (conn.status !== 'active') return json({ error: `connection status=${conn.status}` }, 422);

  // janela 24h
  if (conversation_id && !tag) {
    const { data: ok } = await sb.rpc('is_within_24h_window', { _conversation_id: conversation_id });
    if (ok === false) {
      return json({
        error: 'OUT_OF_WINDOW',
        message: 'Fora da janela 24h do Instagram. Para responder, use uma message tag (ex: HUMAN_AGENT) ou aguarde o usuário enviar nova mensagem.',
      }, 422);
    }
  }

  const token = await decryptSecret(conn.page_access_token_encrypted);

  // build payload
  const payload: any = {
    recipient: { id: String(toId) },
    messaging_type: tag ? 'MESSAGE_TAG' : 'RESPONSE',
    ...(tag ? { tag } : {}),
  };
  if (media?.url) {
    payload.message = {
      attachment: {
        type: media.type ?? 'image',
        payload: { url: media.url, is_reusable: false },
      },
    };
  } else {
    payload.message = { text: String(text ?? '') };
  }

  let res: any;
  try {
    res = await graphFetch(`/${conn.fb_page_id}/messages`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const ge = e as GraphError;
    if (conversation_id) {
      await sb.from('webchat_messages').insert({
        conversation_id,
        direction: 'outbound',
        sender_type: 'agent',
        content: text ?? '[mídia]',
        content_type: 'text',
        metadata: { delivery_status: 'failed', error: ge.graph?.message ?? String(e), payload },
      });
    }
    return json({ error: ge.graph?.message ?? String(e) }, ge.status ?? 500);
  }

  const mid = res?.message_id ?? null;

  if (conversation_id) {
    await sb.from('webchat_messages').insert({
      conversation_id,
      direction: 'outbound',
      sender_type: 'agent',
      content: text ?? (media?.url ?? '[mídia]'),
      content_type: media?.url ? (media.type === 'image' ? 'image' : media.type === 'audio' ? 'audio' : 'file') : 'text',
      message_type: media?.type ?? 'text',
      ig_message_id: mid,
      metadata: { delivery_status: 'sent', ...(media ? { media } : {}) },
    });
    await sb.from('webchat_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation_id);
  }

  return json({ ok: true, ig_message_id: mid });
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

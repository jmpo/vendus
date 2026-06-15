// meta-whatsapp-webhook
// Receiver público da Meta Cloud API.
// GET: handshake (?hub.mode=subscribe + verify_token).
// POST: eventos (mensajes, status). Valida X-Hub-Signature-256.
// verify_jwt = false (público — segurança via verify_token + HMAC).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { hmacSha256Hex, timingSafeEqual } from '../_shared/meta-graph.ts';
import { decryptSecret } from '../_shared/meta-crypto.ts';
import { normalizePhoneBR } from '../_shared/phone.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hub-signature-256',
};

function supa() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractConnectionIdFromPath(url: URL): string | null {
  // Aceita /functions/v1/meta-whatsapp-webhook/{uuid}
  const parts = url.pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return UUID_RE.test(last) ? last : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const pathConnectionId = extractConnectionIdFromPath(url);

  // -------- GET handshake --------
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode !== 'subscribe' || !token || !challenge) {
      return new Response('bad request', { status: 400 });
    }
    const sb = supa();
    // Resolve por path id (preferido) ou por el próprio token (retrocompat).
    let connRow: { id: string; webhook_verify_token: string } | null = null;
    if (pathConnectionId) {
      const { data } = await sb
        .from('whatsapp_meta_connections')
        .select('id, webhook_verify_token')
        .eq('id', pathConnectionId)
        .maybeSingle();
      connRow = data ?? null;
    } else {
      const { data } = await sb
        .from('whatsapp_meta_connections')
        .select('id, webhook_verify_token')
        .eq('webhook_verify_token', token)
        .limit(1)
        .maybeSingle();
      connRow = data ?? null;
    }
    if (!connRow || connRow.webhook_verify_token !== token) {
      console.log('[verify] reject', { has_path_id: !!pathConnectionId });
      return new Response('forbidden', { status: 403 });
    }
    // Marca que a Meta validou o webhook de esta conexión.
    await sb
      .from('whatsapp_meta_connections')
      .update({ webhook_subscribed_at: new Date().toISOString() })
      .eq('id', connRow.id);
    console.log('[verify] ok', { connection_id: connRow.id });
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const rawBody = await req.text();
  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return new Response('invalid json', { status: 400 }); }

  const sb = supa();

  // Cuando a URL carrega o connection_id, resolve uma vez e usa o mismo
  // App Secret para validar a assinatura de TODO o payload (preferido).
  let pinnedConn: any = null;
  if (pathConnectionId) {
    const { data } = await sb
      .from('whatsapp_meta_connections')
      .select('id, organization_id, app_secret_encrypted, access_token_encrypted')
      .eq('id', pathConnectionId)
      .maybeSingle();
    pinnedConn = data ?? null;
    if (!pinnedConn) return new Response('forbidden', { status: 403 });

    // Valida HMAC ANTES de processar (assinatura cobre o body inteiro).
    const sig = req.headers.get('x-hub-signature-256') ?? '';
    if (!sig.startsWith('sha256=')) return new Response('forbidden', { status: 403 });
    try {
      const appSecret = await decryptSecret(pinnedConn.app_secret_encrypted);
      const expected = 'sha256=' + (await hmacSha256Hex(appSecret, rawBody));
      if (!timingSafeEqual(sig, expected)) {
        await sb.from('whatsapp_meta_webhook_logs').insert({
          connection_id: pinnedConn.id,
          organization_id: pinnedConn.organization_id,
          event_type: 'invalid_signature',
          payload,
          processed: false,
          error: 'HMAC mismatch',
        });
        return new Response('forbidden', { status: 403 });
      }
    } catch (e) {
      console.error('signature check failed (pinned)', e);
      return new Response('forbidden', { status: 403 });
    }
  }

  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value ?? {};
      const phoneNumberId = value?.metadata?.phone_number_id;

      // Resolve conexión: pinned (path) tiene prioridade; fallback por phone_number_id.
      let conn: any = pinnedConn;
      if (!conn) {
        if (!phoneNumberId) continue;
        const { data } = await sb
          .from('whatsapp_meta_connections')
          .select('id, organization_id, app_secret_encrypted, access_token_encrypted')
          .eq('phone_number_id', phoneNumberId)
          .limit(1)
          .maybeSingle();
        conn = data ?? null;
      }
      if (!conn) {
        await sb.from('whatsapp_meta_webhook_logs').insert({
          event_type: 'unknown_phone_id',
          payload,
          processed: false,
          error: `phone_number_id ${phoneNumberId ?? '-'} not registered`,
        });
        continue;
      }


      // valida assinatura HMAC (solo no caminho fallback — pinnedConn ya validou).
      if (!pinnedConn) {
        try {
          const sig = req.headers.get('x-hub-signature-256') ?? '';
          if (sig.startsWith('sha256=')) {
            const appSecret = await decryptSecret(conn.app_secret_encrypted);
            const expected = 'sha256=' + (await hmacSha256Hex(appSecret, rawBody));
            if (!timingSafeEqual(sig, expected)) {
              await sb.from('whatsapp_meta_webhook_logs').insert({
                connection_id: conn.id,
                organization_id: conn.organization_id,
                event_type: 'invalid_signature',
                payload,
                processed: false,
                error: 'HMAC mismatch',
              });
              return new Response('forbidden', { status: 403 });
            }
          }
        } catch (e) {
          console.error('signature check failed', e);
        }
      }


      // mensajes recebidas
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const msg of messages) {
        try {
          await handleInboundMessage(sb, conn, msg, contacts);
        } catch (e) {
          console.error('inbound error', e);
          await sb.from('whatsapp_meta_webhook_logs').insert({
            connection_id: conn.id,
            organization_id: conn.organization_id,
            event_type: 'inbound_error',
            payload: msg,
            processed: false,
            error: String(e),
          });
        }
      }

      // status callbacks
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      for (const st of statuses) {
        try { await handleStatus(sb, st); } catch (e) { console.error('status error', e); }
      }

      // template status updates
      if (change?.field === 'message_template_status_update') {
        try {
          await sb.from('whatsapp_meta_templates')
            .update({ status: value?.event ?? 'PENDING', rejected_reason: value?.reason ?? null })
            .eq('connection_id', conn.id)
            .eq('meta_template_id', String(value?.message_template_id ?? ''));
        } catch (e) { console.error('tpl status error', e); }
      }
    }
  }

  // Siempre 200 — Meta reenvia se receber cualquier otro código
  return new Response('ok', { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
});

async function handleInboundMessage(sb: any, conn: any, msg: any, contacts: any[]) {
  const fromRaw = String(msg.from ?? '');
  const fromNorm = normalizePhoneBR(fromRaw) ?? fromRaw;
  const metaMsgId = String(msg.id ?? '');
  const contactName = contacts?.[0]?.profile?.name ?? null;

  // 1) localizar/abrir conversación por (org, channel='whatsapp', visitor_phone_normalized)
  const { data: existing } = await sb
    .from('webchat_conversations')
    .select('id, status, lead_id')
    .eq('organization_id', conn.organization_id)
    .eq('channel', 'whatsapp')
    .eq('visitor_phone_normalized', fromNorm)
    .order('status', { ascending: true })
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1);

  let conversationId: string;
  if (existing && existing.length > 0) {
    conversationId = existing[0].id;
    await sb.from('webchat_conversations')
      .update({
        meta_connection_id: conn.id,
        last_inbound_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        closed_at: null,
        ...(contactName ? { visitor_name: contactName } : {}),
      })
      .eq('id', conversationId);
  } else {
    // encontrar widget ativo da org (compat con webchat schema)
    const { data: widget } = await sb
      .from('webchat_widgets')
      .select('id')
      .eq('organization_id', conn.organization_id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    const { data: created, error: insErr } = await sb
      .from('webchat_conversations')
      .insert({
        organization_id: conn.organization_id,
        widget_id: widget?.id ?? null,
        channel: 'whatsapp',
        status: 'bot_active',
        visitor_id: crypto.randomUUID(),
        visitor_phone: fromNorm,
        visitor_name: contactName ?? fromNorm,
        meta_connection_id: conn.id,
        last_inbound_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (insErr) throw insErr;
    conversationId = created.id;
  }

  // 2) extrair conteúdo
  const { content, contentType, metadata } = await extractContent(msg, conn);

  // 3) inserir mensaje (idempotente por meta_message_id)
  const { error: msgErr } = await sb.from('webchat_messages').insert({
    conversation_id: conversationId,
    direction: 'inbound',
    sender_type: 'visitor',
    content,
    content_type: contentType,
    message_type: contentType,
    meta_message_id: metaMsgId,
    metadata,
  });
  if (msgErr && (msgErr as any).code !== '23505') throw msgErr;

  // 4) log
  await sb.from('whatsapp_meta_webhook_logs').insert({
    connection_id: conn.id,
    organization_id: conn.organization_id,
    event_type: 'inbound:' + (msg.type ?? 'unknown'),
    payload: msg,
    processed: true,
  });

  // 5) disparar webchat-bot (fire-and-forget)
  try {
    await sb.functions.invoke('webchat-bot', {
      body: { conversation_id: conversationId, trigger: 'inbound_whatsapp_meta' },
    });
  } catch (e) {
    console.error('webchat-bot invoke error', e);
  }
}

async function extractContent(msg: any, conn: any): Promise<{ content: string; contentType: string; metadata: Record<string, any> }> {
  const type = msg.type ?? 'text';
  const baseMeta: Record<string, any> = { meta_type: type };

  if (type === 'text') return { content: msg.text?.body ?? '', contentType: 'text', metadata: baseMeta };
  if (type === 'button') return { content: msg.button?.text ?? '', contentType: 'text', metadata: { ...baseMeta, payload: msg.button?.payload } };
  if (type === 'interactive') {
    const i = msg.interactive ?? {};
    const txt = i.button_reply?.title ?? i.list_reply?.title ?? i.nfm_reply?.response_json ?? '';
    return { content: String(txt), contentType: 'text', metadata: { ...baseMeta, interactive: i } };
  }
  if (type === 'location') {
    const l = msg.location ?? {};
    return { content: `📍 ${l.name ?? ''} ${l.address ?? ''}`.trim() || `${l.latitude},${l.longitude}`, contentType: 'text', metadata: { ...baseMeta, location: l } };
  }
  if (type === 'contacts') {
    return { content: '📇 Contato compartilhado', contentType: 'text', metadata: { ...baseMeta, contacts: msg.contacts } };
  }
  if (type === 'reaction') {
    return { content: msg.reaction?.emoji ?? '', contentType: 'text', metadata: { ...baseMeta, reaction: msg.reaction } };
  }

  // mídia: image, audio, video, document, sticker, voice
  const mediaSpec = msg[type];
  if (mediaSpec?.id) {
    try {
      const accessToken = await decryptSecret(conn.access_token_encrypted);
      const downloaded = await downloadAndStoreMedia(conn, mediaSpec.id, mediaSpec.mime_type, accessToken);
      const ct = type === 'image' ? 'image' : (type === 'audio' || type === 'voice') ? 'audio' : 'file';
      return {
        content: downloaded.url ?? `[${type}]`,
        contentType: ct,
        metadata: { ...baseMeta, media: { id: mediaSpec.id, mime: mediaSpec.mime_type, storage_path: downloaded.path, caption: mediaSpec.caption ?? null } },
      };
    } catch (e) {
      console.error('media download error', e);
      return { content: `[${type}]`, contentType: 'text', metadata: { ...baseMeta, media: { id: mediaSpec.id, error: String(e) } } };
    }
  }

  return { content: `[${type}]`, contentType: 'text', metadata: baseMeta };
}

async function downloadAndStoreMedia(conn: any, mediaId: string, _mime: string, accessToken: string): Promise<{ url: string | null; path: string }> {
  const meta = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).then((r) => r.json());
  const url = meta?.url;
  if (!url) throw new Error('no media url');
  const bin = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const buf = new Uint8Array(await bin.arrayBuffer());
  const contentType = meta?.mime_type ?? bin.headers.get('content-type') ?? 'application/octet-stream';
  const ext = guessExt(contentType);
  const path = `${conn.organization_id}/${conn.id}/${mediaId}${ext}`;
  const sb = supa();
  const { error } = await sb.storage.from('whatsapp-meta-media').upload(path, buf, { contentType, upsert: true });
  if (error) throw error;
  const { data: signed } = await sb.storage.from('whatsapp-meta-media').createSignedUrl(path, 60 * 60 * 24 * 7);
  return { url: signed?.signedUrl ?? null, path };
}

function guessExt(mime: string): string {
  if (mime.includes('jpeg')) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('mp4')) return '.mp4';
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('mpeg')) return '.mp3';
  if (mime.includes('pdf')) return '.pdf';
  return '';
}

async function handleStatus(sb: any, st: any) {
  const id = String(st.id ?? '');
  const status = String(st.status ?? '');
  if (!id || !status) return;
  await sb.from('webchat_messages')
    .update({ delivery_status: status })
    .eq('meta_message_id', id);
}

// instagram-webhook — receiver público (Meta Instagram Messaging).
// URL: /functions/v1/instagram-webhook/{connection_id}
// GET handshake: ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
// POST events: { object: "instagram", entry: [{ id: <ig_business_account_id>, messaging: [...] }] }
// HMAC SHA-256 validado con app_secret da conexión.
// verify_jwt = false.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { hmacSha256Hex, timingSafeEqual, GRAPH_BASE } from '../_shared/meta-graph.ts';
import { decryptSecret } from '../_shared/meta-crypto.ts';

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
  const parts = url.pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return UUID_RE.test(last) ? last : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const pathConnectionId = extractConnectionIdFromPath(url);

  // ---------- GET handshake ----------
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    // Compat: aceitar ?conn= como fallback caso o usuario tenga colado a URL antiga.
    const connId = pathConnectionId ?? url.searchParams.get('conn');
    if (mode !== 'subscribe' || !token || !challenge || !connId) {
      return new Response('bad request', { status: 400 });
    }
    const sb = supa();
    const { data: conn } = await sb
      .from('instagram_connections')
      .select('id, webhook_verify_token')
      .eq('id', connId)
      .maybeSingle();
    if (!conn || conn.webhook_verify_token !== token) {
      console.log('[ig-verify] reject', { has_path_id: !!pathConnectionId });
      return new Response('forbidden', { status: 403 });
    }
    await sb
      .from('instagram_connections')
      .update({ webhook_subscribed_at: new Date().toISOString() })
      .eq('id', conn.id);
    console.log('[ig-verify] ok', { connection_id: conn.id });
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const rawBody = await req.text();
  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return new Response('invalid json', { status: 400 }); }

  if (payload?.object !== 'instagram') {
    return new Response('ok', { status: 200 });
  }

  const sb = supa();
  const sig = req.headers.get('x-hub-signature-256') ?? '';
  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  // Resolver conexión: prioriza path; fallback resolve por el entry.id (ig_business_account_id) entre conexiones ativas.
  let resolvedConn: any = null;
  if (pathConnectionId) {
    const { data } = await sb
      .from('instagram_connections')
      .select('*')
      .eq('id', pathConnectionId)
      .maybeSingle();
    resolvedConn = data ?? null;
  }

  for (const entry of entries) {
    let conn = resolvedConn;
    if (!conn) {
      const entryId = String(entry?.id ?? '');
      if (!entryId) continue;
      const { data } = await sb
        .from('instagram_connections')
        .select('*')
        .eq('ig_business_account_id', entryId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      conn = data ?? null;
    }
    if (!conn) {
      console.log('[ig-webhook] no connection match', { entry_id: entry?.id });
      continue;
    }

    // Valida HMAC
    let valid = false;
    try {
      const appSecret = await decryptSecret(conn.app_secret_encrypted);
      const expected = 'sha256=' + (await hmacSha256Hex(appSecret, rawBody));
      valid = sig.length > 0 && timingSafeEqual(sig, expected);
    } catch (e) {
      console.error('[ig-webhook] sig check error', e);
    }
    if (!valid) {
      await sb.from('instagram_webhook_logs').insert({
        connection_id: conn.id,
        organization_id: conn.organization_id,
        event_type: 'invalid_signature',
        payload: entry,
        signature_valid: false,
        error: 'HMAC mismatch',
      });
      return new Response('forbidden', { status: 403 });
    }

    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const m of messaging) {
      try {
        await handleEvent(sb, conn, m);
      } catch (e) {
        console.error('[ig-webhook] event error', e);
        await sb.from('instagram_webhook_logs').insert({
          connection_id: conn.id,
          organization_id: conn.organization_id,
          event_type: 'event_error',
          payload: m,
          signature_valid: true,
          error: String(e),
        });
      }
    }
  }

  return new Response('ok', { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
});

async function handleEvent(sb: any, conn: any, evt: any) {
  if (evt?.message?.is_echo) return;

  const senderId = String(evt?.sender?.id ?? '');
  if (!senderId) return;

  const msg = evt.message ?? {};
  const mid = String(msg?.mid ?? '');
  if (!mid && !msg?.text && !msg?.attachments && !msg?.reaction) return;

  // 1) localizar/abrir conversación
  const { data: existing } = await sb
    .from('webchat_conversations')
    .select('id, status')
    .eq('organization_id', conn.organization_id)
    .eq('channel', 'instagram')
    .eq('instagram_connection_id', conn.id)
    .eq('ig_sender_id', senderId)
    .order('status', { ascending: true })
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1);

  let conversationId: string;
  let visitorName: string | null = null;

  try {
    const token = await decryptSecret(conn.page_access_token_encrypted);
    const prof = await fetch(`${GRAPH_BASE}/${senderId}?fields=name,username&access_token=${encodeURIComponent(token)}`).then((r) => r.json());
    visitorName = prof?.name ?? prof?.username ?? null;
  } catch { /* ignore */ }

  if (existing && existing.length > 0) {
    conversationId = existing[0].id;
    await sb.from('webchat_conversations').update({
      last_inbound_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
      closed_at: null,
      ...(visitorName ? { visitor_name: visitorName } : {}),
    }).eq('id', conversationId);
  } else {
    const { data: widget } = await sb
      .from('webchat_widgets')
      .select('id')
      .eq('organization_id', conn.organization_id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    const { data: created, error: insErr } = await sb.from('webchat_conversations').insert({
      organization_id: conn.organization_id,
      widget_id: widget?.id ?? null,
      channel: 'instagram',
      status: 'bot_active',
      visitor_id: crypto.randomUUID(),
      visitor_name: visitorName ?? `Instagram ${senderId.slice(-4)}`,
      instagram_connection_id: conn.id,
      ig_sender_id: senderId,
      last_inbound_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    }).select('id').single();
    if (insErr) throw insErr;
    conversationId = created.id;
  }

  await sb.from('instagram_connections').update({ last_inbound_at: new Date().toISOString() }).eq('id', conn.id);

  // 2) extrair contenido
  const { content, contentType, metadata } = await extractContent(msg, conn);

  // 3) inserir mensaje (idempotente por ig_message_id)
  const { error: msgErr } = await sb.from('webchat_messages').insert({
    conversation_id: conversationId,
    direction: 'inbound',
    sender_type: 'visitor',
    content,
    content_type: contentType,
    message_type: contentType,
    ig_message_id: mid || null,
    metadata,
  });
  if (msgErr && (msgErr as any).code !== '23505') throw msgErr;

  await sb.from('instagram_webhook_logs').insert({
    connection_id: conn.id,
    organization_id: conn.organization_id,
    event_type: 'inbound',
    payload: evt,
    signature_valid: true,
  });

  // 4) dispara webchat-bot e envía respuesta via IG
  try {
    const { data: botRes } = await sb.functions.invoke('webchat-bot', {
      body: {
        conversation_id: conversationId,
        message: content,
        channel: 'instagram',
        trigger: 'inbound_instagram',
      },
    });
    const chunks: string[] = Array.isArray((botRes as any)?.chunks)
      ? (botRes as any).chunks
      : ((botRes as any)?.response ? [(botRes as any).response] : []);
    for (const chunk of chunks) {
      if (!chunk || typeof chunk !== 'string') continue;
      await sb.functions.invoke('instagram-send', {
        body: { connection_id: conn.id, conversation_id: conversationId, recipient_id: senderId, text: chunk },
      });
      await new Promise((r) => setTimeout(r, 800));
    }
  } catch (e) {
    console.error('[ig-webhook] webchat-bot invoke error', e);
  }
}

async function extractContent(msg: any, conn: any): Promise<{ content: string; contentType: string; metadata: Record<string, any> }> {
  if (msg?.text) return { content: String(msg.text), contentType: 'text', metadata: { ig_type: 'text' } };

  const atts = Array.isArray(msg?.attachments) ? msg.attachments : [];
  if (atts.length > 0) {
    const a = atts[0];
    const t = a?.type ?? 'file';
    const url = a?.payload?.url ?? null;
    let stored: { url: string | null; path: string } | null = null;
    if (url && msg?.mid) {
      try { stored = await downloadAndStoreMedia(conn, msg.mid, url, t); } catch (e) { console.error('[ig-webhook] media err', e); }
    }
    const map: Record<string, string> = { image: 'image', audio: 'audio', video: 'file', file: 'file', story_mention: 'image', share: 'text', ig_reel: 'file' };
    return {
      content: stored?.url ?? url ?? `[${t}]`,
      contentType: map[t] ?? 'text',
      metadata: { ig_type: t, attachments: atts, storage_path: stored?.path ?? null },
    };
  }

  if (msg?.reaction) return { content: String(msg.reaction.emoji ?? '❤️'), contentType: 'text', metadata: { ig_type: 'reaction', reaction: msg.reaction } };

  return { content: '[mensaje]', contentType: 'text', metadata: { ig_type: 'unknown', raw: msg } };
}

async function downloadAndStoreMedia(conn: any, mid: string, url: string, type: string): Promise<{ url: string | null; path: string }> {
  const bin = await fetch(url);
  if (!bin.ok) throw new Error(`download ${bin.status}`);
  const buf = new Uint8Array(await bin.arrayBuffer());
  const ct = bin.headers.get('content-type') ?? 'application/octet-stream';
  const ext = guessExt(ct, type);
  const path = `${conn.organization_id}/${conn.id}/${mid}${ext}`;
  const sb = supa();
  const { error } = await sb.storage.from('instagram-media').upload(path, buf, { contentType: ct, upsert: true });
  if (error) throw error;
  const { data: signed } = await sb.storage.from('instagram-media').createSignedUrl(path, 60 * 60 * 24 * 7);
  return { url: signed?.signedUrl ?? null, path };
}

function guessExt(mime: string, type: string): string {
  if (mime.includes('jpeg')) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('mp4')) return '.mp4';
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('mpeg')) return '.mp3';
  if (type === 'image') return '.jpg';
  if (type === 'video') return '.mp4';
  if (type === 'audio') return '.mp3';
  return '';
}

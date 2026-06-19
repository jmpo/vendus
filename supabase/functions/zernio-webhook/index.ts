// zernio-webhook
// Receiver público de Zernio. POST con eventos firmados (X-Zernio-Signature = hex HMAC-SHA256 del body).
// Maneja message.received (entrante) → dispara webchat-bot → responde vía zernio-send.
// También message.delivered/read/failed → actualiza delivery_status.
// Desplegar con --no-verify-jwt.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { hmacSha256Hex, timingSafeEqual } from '../_shared/meta-graph.ts';
import { normalizePhoneBR } from '../_shared/phone.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-zernio-signature',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function supa() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  const pathConnId = UUID_RE.test(last) ? last : null;

  const rawBody = await req.text();
  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return new Response('invalid json', { status: 400 }); }

  const sb = supa();

  // Resolver conexión: por path id (preferido) o por account._id del payload
  let conn: any = null;
  if (pathConnId) {
    const { data } = await sb.from('zernio_connections').select('*').eq('id', pathConnId).maybeSingle();
    conn = data ?? null;
  }
  if (!conn) {
    const accId = payload?.account?.id ?? payload?.account?._id ?? payload?.message?.accountId ?? null;
    if (accId) {
      const { data } = await sb.from('zernio_connections').select('*').eq('account_id', String(accId)).maybeSingle();
      conn = data ?? null;
    }
  }
  if (!conn) return new Response('ok', { status: 200 }); // no registrada → ignorar

  // Verificar firma HMAC si hay secret configurado
  if (conn.webhook_secret) {
    const sig = (req.headers.get('x-zernio-signature') ?? '').trim();
    try {
      const expected = await hmacSha256Hex(conn.webhook_secret, rawBody);
      if (!sig || !timingSafeEqual(sig.toLowerCase(), expected.toLowerCase())) {
        return new Response('forbidden', { status: 403 });
      }
    } catch (_) {
      return new Response('forbidden', { status: 403 });
    }
  }

  const event: string = payload?.event ?? '';
  try {
    if (event === 'message.received') {
      const m = payload?.message ?? {};
      if (m.direction === 'incoming') {
        // Respondemos 200 al instante y procesamos en segundo plano (IA + envío de respuestas).
        // Evita que Zernio marque el webhook como "failed" por timeout y reintente.
        EdgeRuntime.waitUntil(
          handleInbound(sb, conn, payload).catch((e) => console.error('[zernio-webhook] handleInbound bg error', e)),
        );
      }
    } else if (event === 'message.delivered' || event === 'message.read' || event === 'message.failed') {
      const id = String(payload?.message?.platformMessageId ?? payload?.message?.id ?? '');
      const status = event === 'message.delivered' ? 'delivered' : event === 'message.read' ? 'read' : 'failed';
      if (id) await sb.from('webchat_messages').update({ delivery_status: status }).eq('metadata->>zernio_message_id', id);
    } else if (event.startsWith('whatsapp.template')) {
      await handleTemplateStatus(sb, conn, payload);
    }
  } catch (e) {
    console.error('[zernio-webhook] error', e);
  }

  return new Response('ok', { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
});

async function handleInbound(sb: any, conn: any, payload: any) {
  const m = payload.message ?? {};
  const sender = m.sender ?? {};
  const phoneRaw = String(sender.phoneNumber ?? sender.id ?? '').replace(/^\+/, '');
  if (!phoneRaw) return;
  const fromNorm = normalizePhoneBR(phoneRaw) ?? phoneRaw;
  const zernioConvId = String(m.conversationId ?? '');
  const platformMsgId = String(m.platformMessageId ?? m.id ?? '');
  const contactName = sender.name ?? null;

  // Marca la conexión como verificada al recibir el primer evento (Zernio no tiene handshake).
  if (!conn.webhook_subscribed_at) {
    await sb.from('zernio_connections').update({ webhook_subscribed_at: new Date().toISOString() }).eq('id', conn.id);
  }

  // 1) Conversación abierta de ESTA conexión Zernio (por conexión).
  //    El UNIQUE es (org, channel, telefono, conexión), así que cada conexión/número
  //    tiene su propia conversación con el mismo contacto — no se mezclan entre canales.
  const { data: existing } = await sb
    .from('webchat_conversations')
    .select('id, status')
    .eq('organization_id', conn.organization_id)
    .eq('channel', 'whatsapp')
    .eq('zernio_connection_id', conn.id)
    .eq('visitor_phone_normalized', fromNorm)
    .neq('status', 'closed')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1);

  let conversationId: string;
  if (existing && existing.length > 0) {
    conversationId = existing[0].id;
    await sb.from('webchat_conversations').update({
      last_inbound_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
      zernio_conversation_id: zernioConvId || undefined,
      ...(contactName ? { visitor_name: contactName } : {}),
    }).eq('id', conversationId);
  } else {
    const { data: widget } = await sb
      .from('webchat_widgets').select('id').eq('organization_id', conn.organization_id).eq('is_active', true).limit(1).maybeSingle();
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
        zernio_connection_id: conn.id,
        zernio_conversation_id: zernioConvId || null,
        last_inbound_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
      })
      .select('id').single();
    if (insErr) throw insErr;
    conversationId = created.id;
  }

  // 2) Dedup por platformMessageId
  if (platformMsgId) {
    const { data: dup } = await sb
      .from('webchat_messages').select('id')
      .eq('conversation_id', conversationId)
      .eq('metadata->>zernio_message_id', platformMsgId)
      .limit(1).maybeSingle();
    if (dup?.id) return;
  }

  // 3) Contenido (texto o adjunto). Zernio ya hostea las URLs de media.
  const att = Array.isArray(m.attachments) ? m.attachments[0] : null;
  let content = String(m.text ?? '').trim();
  let contentType = 'text';
  const metadata: Record<string, any> = { provider: 'zernio', zernio_message_id: platformMsgId };
  // Interactivos (botón/lista)
  if (payload?.metadata?.interactiveId || payload?.metadata?.buttonPayload) {
    metadata.interactive = payload.metadata;
  }
  if (att?.url) {
    const kind = att.type === 'image' ? 'image' : att.type === 'audio' ? 'audio' : att.type === 'video' ? 'video' : att.type === 'sticker' ? 'sticker' : 'document';
    contentType = kind === 'image' ? 'image' : kind === 'audio' ? 'audio' : kind === 'video' ? 'video' : 'file';
    metadata.media = { url: att.url, kind, ...(att.payload ? { payload: att.payload } : {}) };
    const label: Record<string, string> = { image: '[imagen]', audio: '[audio]', video: '[vídeo]', document: '[documento]', sticker: '[sticker]' };
    if (!content) content = label[kind] ?? `[${att.type}]`;

    // Audio/imagen → transcripción/visión para que la IA "entienda"
    if (kind === 'audio' || kind === 'image') {
      try {
        const bin = await fetch(att.url);
        const buf = new Uint8Array(await bin.arrayBuffer());
        const b64 = bytesToBase64(buf);
        const { data: tRes } = await sb.functions.invoke('process-media-message', {
          body: { kind, base64: b64, mime: bin.headers.get('content-type') ?? (kind === 'audio' ? 'audio/ogg' : 'image/jpeg'), organization_id: conn.organization_id },
        });
        const txt = (tRes as any)?.text ? String((tRes as any).text).trim() : '';
        if (txt) metadata.transcription = kind === 'audio' ? `🎙️ Audio del cliente (transcrito): ${txt}` : `🖼️ Imagen del cliente: ${txt}`;
      } catch (e) { console.warn('[zernio-webhook] media process failed', e); }
    }
  }

  // 4) Insertar mensaje entrante
  const { data: insertedMsg, error: msgErr } = await sb.from('webchat_messages').insert({
    conversation_id: conversationId,
    direction: 'inbound',
    sender_type: 'visitor',
    content,
    content_type: contentType,
    message_type: contentType,
    metadata,
  }).select('*').single();
  if (msgErr && (msgErr as any).code !== '23505') throw msgErr;

  // Broadcast realtime → el inbox (SellerInbox) escucha `conversation:{id}` y lo muestra al instante.
  if (insertedMsg) {
    try {
      const ch = sb.channel(`conversation:${conversationId}`);
      await ch.send({ type: 'broadcast', event: 'new_message', payload: insertedMsg });
      await sb.removeChannel(ch);
    } catch (e) { console.error('[zernio-webhook] broadcast (visitor) non-fatal:', e); }
  }

  // 5) Disparar IA y responder
  try {
    const transcription = metadata.transcription as string | undefined;
    const botMessage = transcription?.trim() || (content || '[mensaje]');
    const { data: botRes } = await sb.functions.invoke('webchat-bot', {
      body: { conversation_id: conversationId, message: botMessage, visitor_name: contactName ?? fromNorm, channel: 'whatsapp', trigger: 'inbound_whatsapp_zernio' },
    });
    const chunks: string[] = Array.isArray((botRes as any)?.chunks)
      ? (botRes as any).chunks
      : ((botRes as any)?.response ? [(botRes as any).response] : []);
    for (const chunk of chunks) {
      if (!chunk || typeof chunk !== 'string') continue;
      try {
        await sb.functions.invoke('zernio-send', {
          body: { connection_id: conn.id, organization_id: conn.organization_id, conversation_id: conversationId, to: fromNorm, type: 'text', text: chunk },
        });
      } catch (sendErr) { console.error('[zernio-webhook] zernio-send error', sendErr); }
      await new Promise((r) => setTimeout(r, 800));
    }
  } catch (e) {
    console.error('[zernio-webhook] webchat-bot invoke error', e);
  }
}

// Estado de plantillas (aprobada/rechazada) → notifica al equipo.
// La primera plantilla aprobada de la org recibe una notificación especial de felicitación.
async function handleTemplateStatus(sb: any, conn: any, payload: any) {
  const t = payload?.template ?? payload?.data ?? payload?.message_template ?? payload ?? {};
  const rawStatus = String(t.status ?? t.event ?? payload?.status ?? '').toUpperCase();
  const name = t.name ?? t.template_name ?? t.templateName ?? t.display_name ?? 'tu plantilla';
  const reason = t.rejected_reason ?? t.reason ?? t.rejection_reason ?? null;

  let approved: boolean | null = null;
  if (rawStatus.includes('APPROV')) approved = true;
  else if (rawStatus.includes('REJECT') || rawStatus.includes('DECLIN')) approved = false;
  if (approved === null) return; // PENDING u otro → no notificamos

  // ¿Es la PRIMERA plantilla aprobada de esta organización?
  let isFirst = false;
  if (approved) {
    const { data: org } = await sb.from('organizations').select('first_template_approved_at').eq('id', conn.organization_id).maybeSingle();
    if (org && !org.first_template_approved_at) {
      isFirst = true;
      await sb.from('organizations').update({ first_template_approved_at: new Date().toISOString() }).eq('id', conn.organization_id);
    }
  }

  // Destinatarios: admins/super_admins de la org
  const recipients = new Set<string>();
  const { data: admins } = await sb.from('user_roles')
    .select('user_id, profiles!inner(organization_id)')
    .in('role', ['admin', 'super_admin'])
    .eq('profiles.organization_id', conn.organization_id);
  (admins || []).forEach((a: any) => a.user_id && recipients.add(a.user_id));
  if (recipients.size === 0) return;

  const title = approved
    ? (isFirst ? '🎉🥳 ¡Felicidades por tu primera plantilla aprobada!' : '✅ Plantilla aprobada')
    : '❌ Plantilla rechazada';
  const message = approved
    ? (isFirst
        ? `¡Felicitaciones! Tu primera plantilla "${name}" fue aprobada por Meta 🚀. Ya podés reenganchar clientes fuera de las 24h y lanzar campañas. ¡A vender!`
        : `La plantilla "${name}" fue aprobada por Meta. Ya está disponible para campañas y follow-ups.`)
    : `La plantilla "${name}" fue rechazada por Meta${reason ? `: ${reason}` : ''}. Editala y reenviala a revisión.`;

  const rows = Array.from(recipients).map((uid) => ({
    organization_id: conn.organization_id,
    user_id: uid,
    title,
    message,
    type: 'opportunity' as any,
    metadata: { kind: 'template_status', template: name, approved, first: isFirst, source: 'zernio' },
  }));
  await sb.from('notifications').insert(rows);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

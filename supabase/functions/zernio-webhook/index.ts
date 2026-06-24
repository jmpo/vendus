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
  const msg = payload?.message ?? {};
  try {
    if (event === 'message.received' && msg.direction === 'incoming') {
      // Entrante del cliente. Respondemos 200 al toque y procesamos en background (IA + sentAt).
      EdgeRuntime.waitUntil(
        handleInbound(sb, conn, payload).catch((e) => console.error('[zernio-webhook] handleInbound bg error', e)),
      );
    } else if (
      event === 'message.failed' || // un fallo SIEMPRE es de un saliente (aunque falte direction)
      (msg.direction === 'outgoing' &&
        (event === 'message.sent' || event === 'message.delivered' || event === 'message.read' || event === 'message.received'))
    ) {
      // Saliente: actualiza estado y — si fue enviado DESDE el panel de Zernio (no desde el
      // CRM) — lo registra para que el CRM sea un espejo completo de la conversación.
      EdgeRuntime.waitUntil(
        handleOutgoing(sb, conn, payload, event).catch((e) => console.error('[zernio-webhook] handleOutgoing bg error', e)),
      );
    } else if (event === 'message.edited') {
      await handleEdited(sb, payload);
    } else if (event === 'message.deleted') {
      await handleDeleted(sb, payload);
    } else if (event === 'reaction.received') {
      await handleReaction(sb, payload);
    } else if (event === 'lead.received') {
      await handleAdLead(sb, conn, payload);
    } else if (event.startsWith('whatsapp.template')) {
      await handleTemplateStatus(sb, conn, payload);
    } else if (event.startsWith('whatsapp.number') || event === 'whatsapp.automatic_event') {
      // Estado del número/cuenta (suspensión, verificación, reactivación…) → estado + alerta.
      await handleNumberStatus(sb, conn, payload, event);
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
  // Timestamp REAL de WhatsApp (cuándo el cliente envió) → ancla de la ventana 24h.
  // Crítico para costos: usar esto, NO el momento en que nuestra DB inserta.
  const inboundAt = String(m.sentAt ?? new Date().toISOString());

  // Marca la conexión como verificada al recibir el primer evento (Zernio no tiene handshake).
  if (!conn.webhook_subscribed_at) {
    await sb.from('zernio_connections').update({ webhook_subscribed_at: new Date().toISOString() }).eq('id', conn.id);
  }

  // 1) Conversación abierta de ESTA conexión Zernio (por conexión).
  //    El UNIQUE es (org, channel, telefono, conexión), así que cada conexión/número
  //    tiene su propia conversación con el mismo contacto — no se mezclan entre canales.
  const { data: existing } = await sb
    .from('webchat_conversations')
    .select('id, status, lead_id')
    .eq('organization_id', conn.organization_id)
    .eq('channel', 'whatsapp')
    .eq('zernio_connection_id', conn.id)
    .eq('visitor_phone_normalized', fromNorm)
    .neq('status', 'closed')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1);

  // Find-or-create del LEAD por teléfono (sin duplicar). El CRM es WhatsApp-first:
  // cada contacto que escribe DEBE tener un lead → habilita etiquetas, pipeline,
  // reportes, follow-up y vinculación de citas. (Antes Zernio no creaba lead nunca.)
  const ensureLeadId = async (): Promise<string | null> => {
    try {
      // Buscar por phone_normalized (columna INDEXADA + base del UNIQUE (org, phone_normalized)).
      const { data: existingLead } = await sb
        .from('leads')
        .select('id')
        .eq('organization_id', conn.organization_id)
        .eq('phone_normalized', fromNorm)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (existingLead?.id) return existingLead.id;
      const { data: newLead, error: leadErr } = await sb
        .from('leads')
        .insert({
          organization_id: conn.organization_id,
          name: contactName || fromNorm,
          phone: fromNorm,
          phone_normalized: fromNorm, // necesario para el UNIQUE (org, phone_normalized) → dedup real
          source: 'whatsapp',
          whatsapp_opt_in: true, // nos escribió → opted-in (habilita follow-up/campañas)
        })
        .select('id')
        .single();
      if (leadErr) {
        // Carrera / violación de UNIQUE: si otro mensaje lo creó en paralelo, re-buscar.
        const { data: race } = await sb
          .from('leads').select('id')
          .eq('organization_id', conn.organization_id).eq('phone_normalized', fromNorm)
          .order('created_at', { ascending: true }).limit(1).maybeSingle();
        if (race?.id) return race.id;
        console.error('[zernio-webhook] lead create error', leadErr.message);
        return null;
      }
      return newLead?.id || null;
    } catch (e) {
      console.error('[zernio-webhook] ensureLead failed', e);
      return null;
    }
  };

  let conversationId: string;
  if (existing && existing.length > 0) {
    conversationId = existing[0].id;
    // Backfill: conversación vieja sin lead → vincular ahora.
    const leadIdForExisting = existing[0].lead_id || (await ensureLeadId());
    await sb.from('webchat_conversations').update({
      last_inbound_at: inboundAt,
      last_message_at: new Date().toISOString(),
      zernio_conversation_id: zernioConvId || undefined,
      ...(contactName ? { visitor_name: contactName } : {}),
      ...(existing[0].lead_id ? {} : (leadIdForExisting ? { lead_id: leadIdForExisting } : {})),
    }).eq('id', conversationId);
  } else {
    const { data: widget } = await sb
      .from('webchat_widgets').select('id').eq('organization_id', conn.organization_id).eq('is_active', true).limit(1).maybeSingle();
    const leadIdForNew = await ensureLeadId();
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
        lead_id: leadIdForNew,
        last_inbound_at: inboundAt,
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

    // AGENDAMIENTO con BOTONES: si el bot preparó horarios como botones, mandamos
    // UN solo mensaje interactivo (pregunta + botones) en vez de los chunks de texto.
    // Lleva el scheduling_context en metadata para que el tap del cliente matchee
    // con el horario ofrecido. Botones SOLO en agendamientos (decisión del cliente).
    const sBtns = (botRes as any)?.scheduling_buttons;
    if (sBtns && Array.isArray(sBtns.buttons) && sBtns.buttons.length > 0) {
      try {
        await sb.functions.invoke('zernio-send', {
          body: { connection_id: conn.id, organization_id: conn.organization_id, conversation_id: conversationId, to: fromNorm, type: 'typing' },
        });
        await new Promise((r) => setTimeout(r, 1500));
      } catch { /* typing non-fatal */ }
      try {
        await sb.functions.invoke('zernio-send', {
          body: {
            connection_id: conn.id,
            organization_id: conn.organization_id,
            conversation_id: conversationId,
            to: fromNorm,
            type: 'text',
            text: sBtns.body || '¿Qué horario te queda mejor?',
            buttons: sBtns.buttons,
            extra_metadata: (botRes as any)?.metadata?.scheduling_context
              ? { scheduling_context: (botRes as any).metadata.scheduling_context }
              : undefined,
          },
        });
      } catch (sendErr) { console.error('[zernio-webhook] zernio-send buttons error', sendErr); }
    } else {
    for (const chunk of chunks) {
      if (!chunk || typeof chunk !== 'string') continue;
      // "Escribiendo…" visible en el WhatsApp del cliente antes de cada burbuja (humanización).
      try {
        await sb.functions.invoke('zernio-send', {
          body: { connection_id: conn.id, organization_id: conn.organization_id, conversation_id: conversationId, to: fromNorm, type: 'typing' },
        });
        // Delay proporcional al largo del mensaje (más natural), acotado 1.2–5s.
        const thinkMs = Math.min(5000, Math.max(1200, chunk.length * 45));
        await new Promise((r) => setTimeout(r, thinkMs));
      } catch { /* typing non-fatal */ }
      try {
        await sb.functions.invoke('zernio-send', {
          body: { connection_id: conn.id, organization_id: conn.organization_id, conversation_id: conversationId, to: fromNorm, type: 'text', text: chunk },
        });
      } catch (sendErr) { console.error('[zernio-webhook] zernio-send error', sendErr); }
      await new Promise((r) => setTimeout(r, 600));
    }
    }
  } catch (e) {
    console.error('[zernio-webhook] webchat-bot invoke error', e);
  }
}

// ============================================================
// Errores de WhatsApp que Zernio reporta en message.failed.
// Mapeamos código → motivo claro (es) para mostrarlo en el CRM y ALERTAR al
// equipo cuando es accionable (token, cuenta, spam, límite).
// Doc: https://zernio.com/whatsapp/errors
// ============================================================
const ZERNIO_ERROR_REASONS: Record<string, string> = {
  '10': 'Acceso revocado por Meta — reconectá WhatsApp',
  '190': 'Token de WhatsApp inválido o expirado — reconectá la cuenta',
  '131031': 'Cuenta de WhatsApp bloqueada por Meta',
  '131051': 'Ventana de 24h expirada — fuera de las 24h solo se puede enviar una plantilla',
  '131026': 'El cliente no escribió recientemente — enviá una plantilla para reabrir',
  '131047': 'Límite de envío excedido (rate limit) — esperá unos minutos',
  '131021': 'Número de teléfono inválido',
  '131030': 'El número no está en la lista de permitidos (modo de prueba)',
  'receiver_incapable': 'El número no tiene WhatsApp',
  '132000': 'Plantilla no encontrada',
  '132001': 'Plantilla pausada o deshabilitada por Meta',
  '132007': 'Parámetros de la plantilla inválidos',
  '131052': 'No se pudo descargar el archivo enviado',
  '131053': 'Formato de archivo no soportado por WhatsApp',
  '131048': 'Mensaje marcado como spam por Meta — bajá el ritmo de envío',
  '500': 'Servicio de WhatsApp no disponible — reintentá en unos minutos',
};
// Códigos que requieren ACCIÓN del equipo (no solo "este mensaje falló") → se alerta.
const ZERNIO_CRITICAL_ERRORS = new Set(['10', '190', '131031', '131047', '131048']);

// Extrae código + motivo del payload de fallo (la doc no documenta el shape exacto,
// así que probamos varias ubicaciones y caemos a un texto genérico).
function extractZernioError(payload: any, m: any): { code: string; reason: string } {
  const e = m?.error ?? m?.failure ?? m?.failed ?? payload?.error ?? payload?.failure ?? payload?.data?.error ?? {};
  const codeRaw = e?.code ?? e?.errorCode ?? e?.error_code ?? m?.errorCode ?? m?.error_code ?? m?.failureCode ?? payload?.errorCode ?? payload?.code ?? '';
  const code = String(codeRaw).trim();
  const text = e?.title ?? e?.message ?? e?.reason ?? e?.detail ?? m?.failureReason ?? m?.failed_reason ?? (typeof m?.error === 'string' ? m.error : null) ?? payload?.errorMessage ?? null;
  const reason = (code && ZERNIO_ERROR_REASONS[code]) || (typeof text === 'string' && text) || (code ? `Error ${code}` : 'Envío fallido (motivo no informado)');
  return { code, reason };
}

// Alerta a admins de la org sobre un error accionable de WhatsApp. Throttle: 1 por
// código por hora (evita spam de notificaciones en rate-limit/spam recurrente).
async function notifyWhatsAppError(sb: any, conn: any, code: string, reason: string) {
  try {
    const { data: recent } = await sb.from('notifications')
      .select('id').eq('metadata->>kind', 'whatsapp_error').eq('metadata->>code', code)
      .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()).limit(1);
    if (recent && recent.length) return; // ya avisamos por este código hace poco

    const recipients = new Set<string>();
    const { data: admins } = await sb.from('user_roles')
      .select('user_id, profiles!inner(organization_id)')
      .in('role', ['admin', 'super_admin'])
      .eq('profiles.organization_id', conn.organization_id);
    (admins || []).forEach((a: any) => a.user_id && recipients.add(a.user_id));
    if (recipients.size === 0) return;

    const rows = Array.from(recipients).map((uid) => ({
      user_id: uid,
      title: '⚠️ Error de WhatsApp',
      message: `${reason}${code ? ` (código ${code})` : ''}. Revisá la conexión de WhatsApp en Configuración.`,
      type: 'system' as any,
      metadata: { kind: 'whatsapp_error', code, reason, source: 'zernio' },
    }));
    await sb.from('notifications').insert(rows);
    console.log('[zernio-webhook] ⚠️ alerta de error WhatsApp enviada:', code, reason);
  } catch (e) { console.error('[zernio-webhook] notifyWhatsAppError failed', e); }
}

// ============================================================
// Estado del NÚMERO/CUENTA de WhatsApp (suspensión, verificación, etc.).
// CRÍTICO para "que el mensaje siempre llegue": si el número se suspende o requiere
// acción, hay que avisar YA + marcar la conexión como caída (system-health-check la
// detecta si status ∉ active/connected/open). Eventos del panel de webhooks de Zernio.
// ============================================================
const NUMBER_EVENT_INFO: Record<string, { status: string | null; critical: boolean; title: string; msg: string }> = {
  'whatsapp.number.suspended':             { status: 'suspended',             critical: true,  title: '🚫 Número de WhatsApp suspendido',        msg: 'Meta suspendió tu número de WhatsApp. NO se pueden enviar mensajes hasta resolverlo. Revisá tu cuenta de WhatsApp Business.' },
  'whatsapp.number.action_required':       { status: 'action_required',       critical: true,  title: '⚠️ WhatsApp requiere una acción',        msg: 'Tu número de WhatsApp requiere una acción en Meta/Zernio para seguir operando. Resolvelo para no perder envíos.' },
  'whatsapp.number.verification_required': { status: 'verification_required', critical: true,  title: '⚠️ Verificación de WhatsApp requerida',  msg: 'El número necesita verificación. Completala cuanto antes para no cortar los envíos.' },
  'whatsapp.number.declined':              { status: 'declined',              critical: true,  title: '❌ Número de WhatsApp rechazado',         msg: 'La solicitud de tu número fue rechazada por Meta. Revisá los datos en Zernio.' },
  'whatsapp.number.released':              { status: 'released',              critical: true,  title: '⚠️ Número de WhatsApp liberado',         msg: 'El número fue liberado/desvinculado. Reconectá WhatsApp para seguir enviando.' },
  'whatsapp.number.reactivated':           { status: 'connected',             critical: false, title: '✅ Número de WhatsApp reactivado',        msg: 'Tu número volvió a estar activo. Ya podés enviar normalmente.' },
  'whatsapp.number.activated':             { status: 'connected',             critical: false, title: '✅ Número de WhatsApp activado',          msg: 'El número quedó activo y listo para enviar.' },
  'whatsapp.number.kyc_submitted':         { status: null,                    critical: false, title: 'ℹ️ KYC de WhatsApp enviado',             msg: 'Se envió la verificación KYC del número. Esperá la aprobación de Meta.' },
};

async function handleNumberStatus(sb: any, conn: any, payload: any, event: string) {
  console.log('[zernio-webhook] number/account event:', event, JSON.stringify(payload).slice(0, 500));
  const info = NUMBER_EVENT_INFO[event];
  if (!info) return; // whatsapp.automatic_event u otro no mapeado → solo log

  // Actualizar el estado de la conexión (lo lee system-health-check + el panel).
  if (info.status) {
    try { await sb.from('zernio_connections').update({ status: info.status }).eq('id', conn.id); }
    catch (e) { console.error('[zernio-webhook] update connection status failed', e); }
  }

  // Avisar a los admins (crítico o recuperación). Throttle 1/hora por evento.
  try {
    const { data: recent } = await sb.from('notifications')
      .select('id').eq('metadata->>kind', 'whatsapp_number_status').eq('metadata->>event', event)
      .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()).limit(1);
    if (recent && recent.length) return;

    const recipients = new Set<string>();
    const { data: admins } = await sb.from('user_roles')
      .select('user_id, profiles!inner(organization_id)')
      .in('role', ['admin', 'super_admin'])
      .eq('profiles.organization_id', conn.organization_id);
    (admins || []).forEach((a: any) => a.user_id && recipients.add(a.user_id));
    if (recipients.size === 0) return;

    const rows = Array.from(recipients).map((uid) => ({
      user_id: uid,
      title: info.title,
      message: info.msg,
      type: 'system' as any,
      metadata: { kind: 'whatsapp_number_status', event, critical: info.critical, source: 'zernio' },
    }));
    await sb.from('notifications').insert(rows);
    console.log('[zernio-webhook] 📣 alerta de estado de número enviada:', event);
  } catch (e) { console.error('[zernio-webhook] handleNumberStatus notify failed', e); }
}

// Busca nuestra fila de mensaje por los ids de Zernio (cubre inbound y outbound).
async function findZernioMsgRow(sb: any, m: any) {
  const internalId = String(m?.id ?? '');
  const platformId = String(m?.platformMessageId ?? '');
  const tries: Array<[string, string]> = [
    ['metadata->>zernio_message_id', internalId],
    ['metadata->>zernio_message_id', platformId],
    ['metadata->>zernio_platform_message_id', platformId],
  ];
  for (const [col, val] of tries) {
    if (!val) continue;
    const { data } = await sb.from('webchat_messages')
      .select('id, conversation_id, content, metadata, is_deleted')
      .eq(col, val).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (data) return data;
  }
  return null;
}

async function broadcastMsgUpdate(sb: any, conversationId: string, row: any) {
  try {
    const ch = sb.channel(`conversation:${conversationId}`);
    await ch.send({ type: 'broadcast', event: 'message_updated', payload: row });
    await sb.removeChannel(ch);
  } catch (_) { /* non-fatal */ }
}

// message.edited → reflejar el nuevo texto + marcar editada (el CRM muestra "(editada)").
async function handleEdited(sb: any, payload: any) {
  const m = payload?.message ?? {};
  const row = await findZernioMsgRow(sb, m);
  if (!row) return;
  const newText = String(m?.text ?? row.content ?? '');
  const { data: updated } = await sb.from('webchat_messages')
    .update({ content: newText, edited_at: new Date().toISOString() })
    .eq('id', row.id).select('*').single();
  if (updated) await broadcastMsgUpdate(sb, row.conversation_id, updated);
}

// message.deleted → marcar eliminada (el CRM muestra "mensaje eliminado").
async function handleDeleted(sb: any, payload: any) {
  const m = payload?.message ?? {};
  const row = await findZernioMsgRow(sb, m);
  if (!row) return;
  const { data: updated } = await sb.from('webchat_messages')
    .update({ is_deleted: true }).eq('id', row.id).select('*').single();
  if (updated) await broadcastMsgUpdate(sb, row.conversation_id, updated);
}

// reaction.received → guardar la reacción del cliente (el hook de reacciones la muestra en vivo).
// WhatsApp manda emoji vacío para QUITAR la reacción. La doc no fija el shape: probamos varios campos.
async function handleReaction(sb: any, payload: any) {
  const m = payload?.message ?? {};
  console.log('[zernio-webhook] reaction.received payload:', JSON.stringify(payload).slice(0, 600));
  const emoji = String(payload?.reaction?.emoji ?? m?.reaction?.emoji ?? m?.emoji ?? (typeof m?.text === 'string' ? m.text : '') ?? '').trim();
  const targetM = {
    id: m?.reactionTo ?? m?.contextMessageId ?? m?.context?.id ?? payload?.reaction?.messageId ?? m?.quotedMessageId ?? null,
    platformMessageId: m?.reactionToPlatformId ?? payload?.reaction?.platformMessageId ?? m?.context?.platformMessageId ?? null,
  };
  const row = await findZernioMsgRow(sb, targetM);
  if (!row) { console.log('[zernio-webhook] reaction sin target — target:', JSON.stringify(targetM)); return; }
  // Una reacción por cliente por mensaje (WhatsApp reemplaza; emoji vacío = quitar).
  await sb.from('message_reactions').delete().eq('message_id', row.id).eq('reactor_type', 'visitor');
  if (emoji) {
    await sb.from('message_reactions').insert({
      message_id: row.id, conversation_id: row.conversation_id, emoji, reactor_type: 'visitor',
    });
  }
}

// lead.received → lead desde un anuncio (Meta/Zernio Ads). Avisamos al equipo + log para
// confirmar el shape antes de automatizar el alta del lead.
async function handleAdLead(sb: any, conn: any, payload: any) {
  console.log('[zernio-webhook] lead.received payload:', JSON.stringify(payload).slice(0, 800));
  const l = payload?.lead ?? payload?.data ?? payload?.message ?? {};
  const name = l?.name ?? l?.fullName ?? l?.full_name ?? null;
  const phone = l?.phone ?? l?.phoneNumber ?? l?.phone_number ?? null;
  const email = l?.email ?? null;
  try {
    const recipients = new Set<string>();
    const { data: admins } = await sb.from('user_roles')
      .select('user_id, profiles!inner(organization_id)').in('role', ['admin', 'super_admin'])
      .eq('profiles.organization_id', conn.organization_id);
    (admins || []).forEach((a: any) => a.user_id && recipients.add(a.user_id));
    if (recipients.size === 0) return;
    const desc = [name, phone, email].filter(Boolean).join(' · ') || 'sin datos de contacto';
    const rows = Array.from(recipients).map((uid) => ({
      user_id: uid, title: '🎯 Nuevo lead de anuncio',
      message: `Llegó un lead desde un anuncio: ${desc}.`,
      type: 'opportunity' as any,
      metadata: { kind: 'ad_lead', source: 'zernio', name, phone, email },
    }));
    await sb.from('notifications').insert(rows);
  } catch (e) { console.error('[zernio-webhook] handleAdLead failed', e); }
}

// Mensaje SALIENTE de Zernio: actualiza el estado de los que envió el CRM y REGISTRA
// los que se enviaron desde el panel de Zernio (para que el CRM sea espejo completo).
async function handleOutgoing(sb: any, conn: any, payload: any, event: string) {
  const m = payload.message ?? {};
  const internalId = String(m.id ?? '');
  const platformId = String(m.platformMessageId ?? '');
  const statusMap: Record<string, string> = {
    'message.read': 'read', 'message.delivered': 'delivered',
    'message.failed': 'failed', 'message.sent': 'sent', 'message.received': 'sent',
  };
  const status = statusMap[event] ?? 'sent';
  const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

  // Buscar nuestra fila. OJO: zernio-send guarda en zernio_message_id el id que devuelve
  // la API de envío de Zernio, que suele ser el WAMID (platformMessageId), NO el id interno
  // del webhook (m.id). Por eso probamos las 3 combinaciones — si solo buscáramos por m.id,
  // no la encontraríamos y se insertaría una fila DUPLICADA en cada sent/delivered/read.
  let found: any = null;
  const tries: Array<[string, string]> = [
    ['metadata->>zernio_message_id', internalId],
    ['metadata->>zernio_message_id', platformId],          // ← zernio-send guarda el WAMID acá
    ['metadata->>zernio_platform_message_id', platformId],
  ];
  for (const [col, val] of tries) {
    if (found || !val) continue;
    const r = await sb.from('webchat_messages').select('id, delivery_status, metadata')
      .eq(col, val).order('created_at', { ascending: false }).limit(1).maybeSingle();
    found = r.data;
  }

  if (found) {
    // Solo "sube" el estado (no bajar read→delivered); failed siempre gana.
    const cur = rank[found.delivery_status as string] ?? 0;
    if (status === 'failed' || (rank[status] ?? 0) >= cur) {
      const patch: any = { delivery_status: status };
      if (status === 'failed') {
        const { code, reason } = extractZernioError(payload, m);
        if (!code) console.log('[zernio-webhook] message.failed SIN código — payload:', JSON.stringify(payload).slice(0, 900));
        else console.log('[zernio-webhook] message.failed:', code, '—', reason);
        // Guardar motivo en la fila → el CRM muestra el banner con el porqué real.
        patch.metadata = { ...(found.metadata || {}), error: reason, error_code: code || null, failed_at: new Date().toISOString() };
        if (code && ZERNIO_CRITICAL_ERRORS.has(code)) await notifyWhatsAppError(sb, conn, code, reason);
      }
      await sb.from('webchat_messages').update(patch).eq('id', found.id);
    }
    return;
  }

  // No la tenemos → enviado DESDE el panel de Zernio → registrar como saliente.
  const participant = String(payload?.conversation?.participantId ?? '').replace(/^\+/, '');
  if (!participant) return;
  const phoneNorm = normalizePhoneBR(participant) ?? participant;
  const { data: conv } = await sb.from('webchat_conversations').select('id')
    .eq('organization_id', conn.organization_id).eq('channel', 'whatsapp')
    .eq('zernio_connection_id', conn.id).eq('visitor_phone_normalized', phoneNorm)
    .neq('status', 'closed').order('last_message_at', { ascending: false }).limit(1).maybeSingle();
  if (!conv) return;

  // Si llega como fallido (sin que lo tengamos), igual capturamos el motivo.
  let failMeta: Record<string, any> = {};
  if (status === 'failed') {
    const { code, reason } = extractZernioError(payload, m);
    if (!code) console.log('[zernio-webhook] message.failed (no-rastreado) SIN código — payload:', JSON.stringify(payload).slice(0, 900));
    else console.log('[zernio-webhook] message.failed (no-rastreado):', code, '—', reason);
    failMeta = { error: reason, error_code: code || null, failed_at: new Date().toISOString() };
    if (code && ZERNIO_CRITICAL_ERRORS.has(code)) await notifyWhatsAppError(sb, conn, code, reason);
  }
  const { data: inserted, error: insErr } = await sb.from('webchat_messages').insert({
    conversation_id: conv.id,
    direction: 'outbound',
    sender_type: 'agent',
    content: String(m.text ?? '[mensaje]'),
    delivery_status: status,
    metadata: {
      provider: 'zernio', zernio_message_id: internalId || null,
      zernio_platform_message_id: platformId || null, sent_from: 'zernio', zernio_sent_at: m.sentAt ?? null,
      ...failMeta,
    },
  }).select('*').single();
  if (insErr) return; // carrera con otra entrega del mismo mensaje → ignorar
  await sb.from('webchat_conversations').update({ last_message_at: m.sentAt ?? new Date().toISOString() }).eq('id', conv.id);
  if (inserted) {
    try {
      const ch = sb.channel(`conversation:${conv.id}`);
      await ch.send({ type: 'broadcast', event: 'new_message', payload: inserted });
      await sb.removeChannel(ch);
    } catch (_) { /* non-fatal */ }
  }
}

// Estado de plantillas (aprobada/rechazada) → notifica al equipo.
// La primera plantilla aprobada de la org recibe una notificación especial de felicitación.
async function handleTemplateStatus(sb: any, conn: any, payload: any) {
  // Log del payload crudo para poder afinar (la doc de Zernio no lo documenta).
  console.log('[zernio-webhook] template.status payload:', JSON.stringify(payload).slice(0, 800));

  const t = payload?.template ?? payload?.data ?? payload?.message_template ?? payload ?? {};
  const name = t.name ?? t.template_name ?? t.templateName ?? t.display_name ?? payload?.name ?? 'tu plantilla';
  const reason = t.rejected_reason ?? t.reason ?? t.rejection_reason ?? null;

  // Detección robusta del estado: escanea todo el payload (shape no documentado por Zernio).
  const blob = JSON.stringify(payload ?? {}).toUpperCase();
  let approved: boolean | null = null;
  if (/APPROVED/.test(blob)) approved = true;
  else if (/REJECTED|DECLINED/.test(blob)) approved = false;
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
    user_id: uid,
    title,
    message,
    type: 'opportunity' as any,
    metadata: { kind: 'template_status', template: name, approved, first: isFirst, source: 'zernio' },
  }));
  const { error: notifErr } = await sb.from('notifications').insert(rows);
  if (notifErr) console.error('[zernio-webhook] notification insert failed', notifErr);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

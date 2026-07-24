// zernio-send
// Envía por el canal Zernio (WhatsApp oficial gestionado).
//  - Dentro de 24h / con conversación abierta: mensaje freeform
//    POST /v1/inbox/conversations/{conversationId}/messages
//  - Para iniciar/reenganchar (fuera de 24h): template
//    POST /v1/inbox/conversations
import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import { decryptSecret } from '../_shared/meta-crypto.ts';

const ZERNIO_BASE = 'https://zernio.com/api/v1';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const TIMEOUT_MS = 20000;

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function zfetch(apiKey: string, path: string, body: unknown) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${ZERNIO_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const txt = await r.text();
    let data: any; try { data = JSON.parse(txt); } catch { data = txt; }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    clearTimeout(t);
    const aborted = (e as Error)?.name === 'AbortError';
    return { ok: false, status: aborted ? 504 : 502, data: { error: aborted ? 'timeout' : String(e) } };
  }
}

// profileId de Zernio: obligatorio para la API de Broadcasts (la única que puede enviar
// plantillas con header de imagen). Se resuelve on-demand; solo se usa en envíos de plantilla.
async function getProfileId(apiKey: string): Promise<string | null> {
  try {
    const r = await fetch(`${ZERNIO_BASE}/profiles`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    const list = d?.profiles ?? d?.data ?? d ?? [];
    if (!Array.isArray(list) || list.length === 0) return null;
    const def = list.find((p: any) => p?.isDefault) ?? list[0];
    return def?._id ?? def?.id ?? null;
  } catch (e) {
    console.error('[zernio-send] getProfileId falló:', String(e));
    return null;
  }
}

// Nuestro media.kind → attachmentType de Zernio
function mapAttachmentType(kind?: string): string {
  switch (kind) {
    case 'image': return 'image';
    case 'video': return 'video';
    case 'audio': return 'audio';
    case 'sticker': return 'image';
    default: return 'file';
  }
}

// ─── Vista de plantilla (para que el chat la muestre igual que WhatsApp) ───
// Estructura guardada en metadata.template_view: header_image/header_text, body,
// footer y buttons. La imagen del header se re-hostea en Storage porque la URL
// de scontent.whatsapp.net caduca (param `oe=`).
export interface TemplateView {
  name: string;
  language: string;
  header_image?: string | null;
  header_text?: string | null;
  body?: string | null;
  footer?: string | null;
  buttons?: Array<{ type: string; text: string; url?: string }>;
}

// Cache por isolate: un batch de campaña reutiliza el mismo fetch de plantillas.
const tplCache = new Map<string, { at: number; list: any[] }>();
const TPL_TTL_MS = 10 * 60_000;

async function getTemplateView(
  sb: ReturnType<typeof createClient>,
  apiKey: string,
  accountId: string,
  name: string,
  language: string,
): Promise<TemplateView | null> {
  try {
    let entry = tplCache.get(accountId);
    if (!entry || Date.now() - entry.at > TPL_TTL_MS) {
      const r = await fetch(`${ZERNIO_BASE}/whatsapp/templates?accountId=${accountId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!r.ok) return null;
      const d = await r.json().catch(() => null);
      entry = { at: Date.now(), list: d?.templates ?? [] };
      tplCache.set(accountId, entry);
    }
    const tpl = entry.list.find((t: any) => t.name === name && (!language || t.language === language))
      ?? entry.list.find((t: any) => t.name === name);
    if (!tpl) return null;

    const view: TemplateView = { name, language: tpl.language ?? language };
    for (const c of tpl.components ?? []) {
      const ctype = String(c.type ?? '').toUpperCase();
      if (ctype === 'HEADER') {
        if (String(c.format ?? '').toUpperCase() === 'IMAGE') {
          const raw = c.example?.header_handle?.[0] ?? null;
          if (raw) {
            // Re-hostear una vez por plantilla (path determinístico + upsert = idempotente)
            try {
              const bin = await fetch(raw);
              if (bin.ok) {
                const bytes = new Uint8Array(await bin.arrayBuffer());
                const mime = bin.headers.get('content-type') ?? 'image/jpeg';
                const ext = /png/.test(mime) ? '.png' : '.jpg';
                const path = `templates/${accountId}/${name}${ext}`;
                const { error: upErr } = await sb.storage.from('chat-media')
                  .upload(path, bytes, { contentType: mime, upsert: true });
                if (!upErr) {
                  const { data: pub } = sb.storage.from('chat-media').getPublicUrl(path);
                  view.header_image = pub.publicUrl;
                }
              }
            } catch { /* si falla, dejamos la URL original (funciona un tiempo) */ }
            if (!view.header_image) view.header_image = raw;
          }
        } else if (c.text) {
          view.header_text = c.text;
        }
      } else if (ctype === 'BODY') view.body = c.text ?? null;
      else if (ctype === 'FOOTER') view.footer = c.text ?? null;
      else if (ctype === 'BUTTONS') {
        view.buttons = (c.buttons ?? []).map((b: any) => ({
          type: String(b.type ?? 'QUICK_REPLY'),
          text: String(b.text ?? ''),
          ...(b.url ? { url: String(b.url) } : {}),
        }));
      }
    }
    return view;
  } catch (e) {
    console.warn('[zernio-send] getTemplateView falló (no crítico):', String(e));
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!req.headers.get('Authorization')) return json({ error: 'Unauthorized' }, 401);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));
  const {
    connection_id, organization_id, conversation_id,
    to, type = 'text', text, media, template,
    buttons, interactive, // mensajes interactivos (botones / lista) — passthrough a Zernio
    quickReplies,         // hasta 13 opciones (excluyente con buttons, que topa en 3)
    location,             // WhatsApp: pin de ubicación { latitude, longitude, name?, address? }
    contacts,             // WhatsApp: tarjetas de contacto [{ name: { formatted_name }, phones?, emails? }]
    extra_metadata, // metadata extra a fundir en la fila guardada (ej: scheduling_context)
    reply_to_message_id, // UUID del mensaje a citar (responder encima) → se traduce a replyTo (wamid)
    record = true, // si false: el llamador ya grabó la fila (evita bolha dupla)
    // Ahorro de ventana 24h: si el cliente respondió hace <24h, el mismo contenido de la
    // plantilla se envía como mensaje LIBRE (gratis) en vez de broadcast (Marketing pago).
    // Default ON — pasar false para forzar plantilla siempre.
    prefer_free_window = true,
    // Texto PERSONALIZADO para los envíos por ventana abierta (campañas). Si viene,
    // reemplaza al cuerpo de la plantilla en el mensaje libre; la imagen y los botones
    // de la plantilla se mantienen. Si está vacío, se usa el cuerpo de la plantilla.
    free_window_message,
  } = body ?? {};

  if (!connection_id || (!to && type !== 'typing')) return json({ error: 'missing connection_id or to' }, 400);

  const { data: conn, error: connErr } = await sb
    .from('zernio_connections').select('*').eq('id', connection_id).maybeSingle();
  if (connErr || !conn) return json({ error: 'connection not found' }, 404);
  if (organization_id && conn.organization_id !== organization_id) return json({ error: 'org mismatch' }, 403);
  if (conn.status !== 'active') return json({ error: `connection status=${conn.status}` }, 422);

  const apiKey = await decryptSecret(conn.api_key_encrypted);
  const accountId = conn.account_id as string;
  const phone = String(to).replace(/^\+/, '');

  // ¿Hay conversación Zernio ya abierta?
  let zernioConvId: string | null = null;
  if (conversation_id) {
    const { data: convRow } = await sb
      .from('webchat_conversations').select('zernio_conversation_id').eq('id', conversation_id).maybeSingle();
    zernioConvId = (convRow as any)?.zernio_conversation_id ?? null;
  }

  // Indicador "escribiendo…" (humanización). No envía mensaje ni graba fila.
  // WhatsApp lo muestra hasta 25s y marca el último entrante como leído.
  if (type === 'typing') {
    if (!zernioConvId) return json({ ok: false, error: 'no_zernio_conversation' });
    const r = await zfetch(apiKey, `/inbox/conversations/${zernioConvId}/typing`, { accountId });
    return json({ ok: r.ok, status: r.status });
  }

  const hasMedia = media && media.url && media.kind;
  let res: { ok: boolean; status: number; data: any };
  let zernioMsgId: string | null = null;
  let zernioBroadcastId: string | null = null; // plantillas: id del broadcast (no hay wamid por destinatario)
  let templateView: TemplateView | null = null; // estructura visual de la plantilla (header/body/botones)
  let sentAsFreeWindow = false; // plantilla convertida a mensaje libre (ventana 24h abierta = gratis)

  if (type === 'template' || (!zernioConvId && template)) {
    // ─── PLANTILLAS: se envían por BROADCASTS, no por /inbox/conversations ───
    // /inbox/conversations solo acepta templateName/Language/Params y NO permite pasar la
    // media del header → las plantillas con imagen fallaban con 131053 ("formato no soportado").
    // La API de Broadcasts resuelve sola la media aprobada de la plantilla (verificado contra
    // la API real: basta con { name, language }). Flujo de 3 pasos: crear → destinatarios → enviar.
    if (!template?.name || !template?.language) return json({ error: 'template.name y template.language requeridos' }, 400);

    // Estructura visual (no crítico: si falla, el envío sigue; solo pierde la vista rica)
    templateView = await getTemplateView(sb, apiKey, accountId, template.name, template.language);

    // ── AHORRO ventana 24h: cliente activo hace <24h → mismo contenido como mensaje
    //    LIBRE (US$ 0) en vez de broadcast Marketing (pago). Botones QUICK_REPLY se
    //    replican como quickReplies; la imagen del header va como adjunto. ──
    const freeText = (typeof free_window_message === 'string' && free_window_message.trim())
      ? free_window_message.trim()
      : templateView?.body ?? null;
    if (prefer_free_window && zernioConvId && conversation_id && freeText) {
      const { data: within } = await sb.rpc('is_within_24h_window', { _conversation_id: conversation_id });
      if (within === true) {
        const qr = (templateView?.buttons ?? [])
          .filter((b) => String(b.type).toUpperCase() === 'QUICK_REPLY' && b.text)
          .map((b) => b.text as string)
          .slice(0, 13);
        const freeBody: Record<string, unknown> = {
          accountId,
          message: freeText,
          ...(templateView?.header_image ? { attachmentUrl: templateView.header_image, attachmentType: 'image' } : {}),
          ...(qr.length ? { quickReplies: qr } : {}),
        };
        const rf = await zfetch(apiKey, `/inbox/conversations/${zernioConvId}/messages`, freeBody);
        console.log('[zernio-send] plantilla→ventana24h (gratis) ←', rf.status, JSON.stringify(rf.data).slice(0, 200));
        if (rf.ok) {
          res = rf;
          zernioMsgId = rf.data?.data?.messageId ?? rf.data?.messageId ?? null;
          sentAsFreeWindow = true;
          // La vista guardada debe reflejar lo que REALMENTE se envió (texto custom incluido)
          if (templateView) templateView = { ...templateView, body: freeText };
          else templateView = { name: template.name, language: template.language, body: freeText };
        }
        // Si el freeform falla (p.ej. combinación no soportada), caemos al broadcast normal.
      }
    }

    if (sentAsFreeWindow) {
      // nada más que hacer: res/zernioMsgId ya quedaron seteados
    } else {
    const profileId = await getProfileId(apiKey);
    if (!profileId) {
      res = { ok: false, status: 502, data: { error: 'No se pudo resolver el profileId de Zernio' } };
    } else {
      const nombre = `${template.name}-${Date.now()}`;
      const crear = await zfetch(apiKey, '/broadcasts', {
        profileId, accountId, platform: 'whatsapp', name: nombre,
        template: { name: template.name, language: template.language },
      });
      const bId = crear.data?.broadcast?.id ?? crear.data?.data?.id ?? null;
      console.log('[zernio-send] broadcast crear ←', crear.status, bId);

      if (!crear.ok || !bId) {
        res = { ok: false, status: crear.status, data: crear.data };
      } else {
        const dest = await zfetch(apiKey, `/broadcasts/${bId}/recipients`, { phones: [phone], useSegment: false });
        console.log('[zernio-send] broadcast destinatarios ←', dest.status, JSON.stringify(dest.data).slice(0, 200));
        if (!dest.ok || (dest.data?.added ?? 0) < 1) {
          res = { ok: false, status: dest.status, data: { error: 'No se pudo agregar el destinatario', raw: dest.data } };
        } else {
          const env = await zfetch(apiKey, `/broadcasts/${bId}/send`, {});
          console.log('[zernio-send] broadcast enviar ←', env.status, JSON.stringify(env.data).slice(0, 200));
          const enviados = Number(env.data?.sent ?? 0);
          res = enviados > 0
            ? { ok: true, status: env.status, data: { ...env.data, broadcastId: bId } }
            : { ok: false, status: env.status, data: { error: `Broadcast sin envíos (failed: ${env.data?.failed ?? '?'})`, raw: env.data } };
          // Broadcasts no devuelve un wamid por destinatario; guardamos el id del broadcast
          // para poder rastrearlo (el webhook de entrega espeja el mensaje).
          zernioMsgId = null;
          zernioBroadcastId = bId;
        }
      }
    }
    } // fin del else (envío por broadcast cuando no aplicó la ventana gratis)
  } else if (zernioConvId) {
    // Ventana 24h: fuera de ella, WhatsApp oficial NO permite mensajes libres → exige template.
    if (conversation_id) {
      const { data: within } = await sb.rpc('is_within_24h_window', { _conversation_id: conversation_id });
      if (within === false) {
        return json({ ok: false, error: 'OUT_OF_WINDOW', message: 'Fuera de la ventana 24h — se requiere un template HSM aprobado.' }, 200);
      }
    }
    // Responder citando: Zernio usa `replyTo` = platformMessageId (wamid) del mensaje objetivo.
    let replyTo: string | null = null;
    if (reply_to_message_id) {
      const { data: tgt } = await sb.from('webchat_messages').select('metadata').eq('id', reply_to_message_id).maybeSingle();
      const tmeta = (tgt as any)?.metadata || {};
      replyTo = tmeta.zernio_platform_message_id || tmeta.zernio_message_id || null;
    }
    // Freeform dentro de conversación abierta. Si hay media, el caption va como message.
    const msgText = text || (hasMedia ? media.caption : undefined);
    const freeformBody = {
      accountId,
      ...(msgText ? { message: msgText } : {}),
      ...(hasMedia ? { attachmentUrl: media.url, attachmentType: mapAttachmentType(media.kind) } : {}),
      ...(hasMedia && media.kind === 'audio' && media.ptt ? { voiceNote: true } : {}),
      // buttons (máx 3) y quickReplies (máx 13) son EXCLUYENTES: si vienen los dos, gana quickReplies.
      ...(quickReplies && Array.isArray(quickReplies) && quickReplies.length
        ? { quickReplies: quickReplies.slice(0, 13) }
        : (buttons ? { buttons } : {})),
      ...(interactive ? { interactive } : {}),
      ...(location ? { location } : {}),
      ...(contacts && Array.isArray(contacts) && contacts.length ? { contacts } : {}),
      ...(replyTo ? { replyTo } : {}),
    };
    console.log('[zernio-send] freeform →', JSON.stringify({ convId: zernioConvId, attachmentType: (freeformBody as any).attachmentType, hasMedia, kind: media?.kind, mime: media?.mime, url: media?.url?.slice(0, 120) }));
    res = await zfetch(apiKey, `/inbox/conversations/${zernioConvId}/messages`, freeformBody);
    console.log('[zernio-send] freeform ← status', res.status, JSON.stringify(res.data).slice(0, 400));
    zernioMsgId = res.data?.data?.messageId ?? res.data?.messageId ?? null;
  } else {
    return json({ error: 'NO_CONVERSATION', message: 'Sin conversación abierta — se requiere un template para iniciar.' }, 422);
  }

  // Registrar el mensaje saliente (solo si el llamador no lo grabó ya).
  if (conversation_id && record !== false) {
    const { data: insertedMsg } = await sb.from('webchat_messages').insert({
      conversation_id,
      direction: 'outbound',
      sender_type: 'agent',
      content: text ?? (hasMedia ? `[${media.kind}]`
        : location ? `📍 Ubicación${location.name ? `: ${location.name}` : ''}`
        : (contacts && contacts.length) ? `👤 Contacto: ${contacts[0]?.name?.formatted_name ?? ''}`.trim()
        // Plantillas: guardamos el CUERPO real (no "[template]") → el chat y el preview
        // de la lista muestran lo mismo que recibió el cliente.
        : templateView?.body ? templateView.body
        : `[${type}]`),
      content_type: hasMedia ? (media.kind === 'image' ? 'image' : media.kind === 'audio' ? 'audio' : media.kind === 'video' ? 'video' : 'file') : 'text',
      message_type: type,
      delivery_status: res.ok ? 'sent' : 'failed',
      metadata: {
        provider: 'zernio',
        zernio_message_id: zernioMsgId,
        ...(zernioBroadcastId ? { zernio_broadcast_id: zernioBroadcastId } : {}),
        ...(hasMedia ? { media } : {}),
        ...(template ? { template } : {}),
        ...(templateView ? { template_view: templateView } : {}),
        // Ahorro: salió como mensaje libre (US$ 0) porque la ventana 24h estaba abierta
        ...(sentAsFreeWindow ? { sent_as: 'free_window' } : {}),
        ...(buttons ? { buttons } : {}),
        ...(quickReplies ? { quickReplies } : {}),
        ...(interactive ? { interactive } : {}),
        ...(location ? { location } : {}),
        ...(contacts ? { contacts } : {}),
        ...(extra_metadata && typeof extra_metadata === 'object' ? extra_metadata : {}),
        ...(res.ok ? {} : { error: res.data?.error ?? res.data ?? `status ${res.status}`, failed_at: new Date().toISOString() }),
      },
    }).select('*').single();
    await sb.from('webchat_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation_id);

    // Broadcast realtime → el inbox lo muestra al instante.
    if (insertedMsg) {
      try {
        const ch = sb.channel(`conversation:${conversation_id}`);
        await ch.send({ type: 'broadcast', event: 'new_message', payload: insertedMsg });
        await sb.removeChannel(ch);
      } catch (e) { console.error('[zernio-send] broadcast non-fatal:', e); }
    }
  }

  if (!res.ok) {
    return json({ ok: false, error: res.data?.error ?? `Error ${res.status}`, code: res.data?.code ?? null, raw: res.data }, 200);
  }
  return json({ ok: true, zernio_message_id: zernioMsgId, conversation_id: zernioConvId });
});

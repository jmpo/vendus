// Helper de roteamento WhatsApp: respeita a conexão de origem da conversa.
// Se a conversa entrou pela Meta Cloud API (meta_connection_id), envia via
// `meta-whatsapp-send` usando a MESMA conexão (mesmo número oficial).
// Se entrou pela Evolution (evolution_instance_id), envia via `evolution-send`
// na mesma instância. Sem fallback silencioso para a instância default da org.

export type WAConversation = {
  id?: string;
  organization_id?: string | null;
  meta_connection_id?: string | null;
  evolution_instance_id?: string | null;
  zernio_connection_id?: string | null;
  visitor_phone?: string | null;
};

export type WAMedia = {
  kind: 'image' | 'audio' | 'video' | 'document' | 'sticker';
  url: string;
  mime?: string;
  filename?: string;
  caption?: string;
};

export type WARouterResult = {
  ok: boolean;
  provider: 'meta' | 'evolution' | 'zernio' | 'none';
  error?: string;
  message?: string;
  message_id?: string | null;
  raw?: unknown;
};

export type WARouterInput = {
  supabase: any;
  conversation: WAConversation;
  to: string; // já normalizado idealmente
  text?: string;
  media?: WAMedia;
  reply_to_message_id?: string | null; // UUID del mensaje a citar (responder encima)
  // WhatsApp (Zernio): extras nativos. quickReplies admite 13 opciones (buttons solo 3).
  quickReplies?: Array<Record<string, unknown>> | null;
  location?: { latitude: number; longitude: number; name?: string; address?: string } | null;
  contacts?: Array<Record<string, unknown>> | null;
};

import { phoneVariantsBR } from './phone.ts';

function normalizePhoneBR(p: string): string {
  let phone = (p || '').replace(/\D/g, '');
  if (!phone) return phone;
  if (!phone.startsWith('55')) phone = '55' + phone;
  return phone;
}

// WhatsApp solo soporta JPEG/PNG en imágenes. AVIF/WebP fallan (error 131053 en Meta/Zernio).
// Las servimos transcodeadas a JPG vía proxy (wsrv.nl). Punto central → cubre TODOS los envíos
// (inbox manual, catálogo, follow-up) por cualquier proveedor.
function normalizeImageUrlForWA(u: string): string {
  if (u && /\.(avif|webp)(\?|$)/i.test(u)) {
    return `https://wsrv.nl/?url=${encodeURIComponent(u)}&output=jpg&w=1600&q=82`;
  }
  return u;
}

export async function sendWhatsAppForConversation(
  input: WARouterInput,
): Promise<WARouterResult> {
  const { supabase, conversation } = input;
  const to = normalizePhoneBR(input.to || conversation.visitor_phone || '');

  // Normaliza imágenes incompatibles (AVIF/WebP → JPG) antes de despachar a cualquier proveedor.
  if (input.media && input.media.kind === 'image' && input.media.url) {
    input.media = { ...input.media, url: normalizeImageUrlForWA(input.media.url) };
  }

  // Prioridad: Zernio (canal oficial actual) > Meta. Evolution (API NO oficial) quedó DESACTIVADA:
  // el número se bloqueaba y ya no se usa. Si una conversación vieja todavía tiene
  // evolution_instance_id, se IGNORA a propósito y se envía por Zernio si hay conexión.
  const provider: 'meta' | 'zernio' | 'none' =
    conversation.zernio_connection_id ? 'zernio'
      : conversation.meta_connection_id ? 'meta'
        : 'none';

  console.log(
    `[wa-router] provider=${provider} conv=${conversation.id ?? '-'} ` +
    `meta_conn=${conversation.meta_connection_id ?? '-'} ` +
    `evo_inst=${conversation.evolution_instance_id ?? '-'} ` +
    `zernio_conn=${conversation.zernio_connection_id ?? '-'} to=${to}`,
  );

  if (provider === 'none') {
    return {
      ok: false,
      provider,
      error: 'NO_CONNECTION',
      message: 'Conversa sem conexão WhatsApp vinculada (Meta, Evolution ou Zernio).',
    };
  }

  if (provider === 'zernio') {
    const { data, error } = await supabase.functions.invoke('zernio-send', {
      body: {
        connection_id: conversation.zernio_connection_id,
        organization_id: conversation.organization_id,
        conversation_id: conversation.id,
        to,
        type: input.media ? input.media.kind : 'text',
        text: input.text,
        media: input.media,
        reply_to_message_id: input.reply_to_message_id, // responder citando (replyTo en Zernio)
        ...(input.quickReplies ? { quickReplies: input.quickReplies } : {}),
        ...(input.location ? { location: input.location } : {}),
        ...(input.contacts ? { contacts: input.contacts } : {}),
        // O chamador (webchat-inbox/etc) já inseriu a mensagem. zernio-send só
        // resolve a conversa/janela 24h e envia — NÃO grava 2ª linha (evita bolha dupla).
        record: false,
      },
    });
    const ok = !error && (data as any)?.ok !== false;
    if (!ok) {
      console.error('[wa-router] zernio-send FAILED:', JSON.stringify({ error, data }).slice(0, 500));
      return { ok: false, provider, error: error?.message || (data as any)?.error || 'zernio-send failed', message: (data as any)?.message, raw: data };
    }
    return { ok: true, provider, message_id: (data as any)?.zernio_message_id ?? null, raw: data };
  }

  if (provider === 'meta') {
    // Adapta mídia: meta espera { link, caption, filename }
    let type: string = 'text';
    let mediaPayload: Record<string, unknown> | undefined;
    if (input.media) {
      const k = input.media.kind;
      // Meta não tem "sticker" no mesmo endpoint do send livre — manda como image
      type = k === 'sticker' ? 'image' : k;
      mediaPayload = {
        link: input.media.url,
        ...(input.media.caption && k !== 'audio' ? { caption: input.media.caption } : {}),
        ...(input.media.filename && k === 'document' ? { filename: input.media.filename } : {}),
      };
    }

    const body: Record<string, unknown> = {
      connection_id: conversation.meta_connection_id,
      organization_id: conversation.organization_id,
      // IMPORTANTE: NÃO passamos conversation_id aqui — a mensagem já foi
      // inserida pelo chamador (webchat-inbox/etc). Passar duplicaria.
      to,
      type,
    };
    if (type === 'text') body.text = input.text ?? '';
    else if (mediaPayload) body.media = mediaPayload;

    const { data, error } = await supabase.functions.invoke('meta-whatsapp-send', { body });
    const ok = !error && (data as any)?.ok !== false && !(data as any)?.error;
    if (!ok) {
      const errMsg = (data as any)?.error || error?.message || 'meta-whatsapp-send failed';
      const msg = (data as any)?.message;
      console.error('[wa-router] meta-whatsapp-send FAILED:', JSON.stringify({ error, data }).slice(0, 500));
      return { ok: false, provider, error: errMsg, message: msg, raw: data };
    }
    return { ok: true, provider, raw: data };
  }

  // Evolution (API no oficial) fue ELIMINADA: sus funciones ya no existen y el canal se abandonó
  // porque bloqueaban el número. Este punto es inalcanzable (provider ∈ zernio|meta|none).
  return { ok: false, provider, error: 'NO_PROVIDER', message: 'Sin proveedor de WhatsApp disponible.' };
}

// Envío proativo a un teléfono SIN conversación explícita (booking, recordatorios, etc.).
// Resuelve la conversación más reciente del lead por teléfono y envía por SU conexión
// (Meta/Evolution/Zernio). Si no hay conversación, cae a la instancia Evolution provista
// (compatibilidad con el comportamiento legado). Así el agendamiento respeta cada conexión.
export async function sendWhatsAppToPhone(opts: {
  supabase: any;
  organizationId: string;
  phone: string;
  text?: string;
  media?: WAMedia;
  fallbackEvolutionInstanceId?: string | null;
}): Promise<WARouterResult> {
  const { supabase, organizationId, phone } = opts;
  const variants = phoneVariantsBR(phone);

  let conversation: WAConversation | null = null;
  if (variants.length) {
    const { data } = await supabase
      .from('webchat_conversations')
      .select('id, organization_id, meta_connection_id, evolution_instance_id, zernio_connection_id, visitor_phone')
      .eq('organization_id', organizationId)
      .in('visitor_phone_normalized', variants)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) conversation = data as WAConversation;
  }

  if (conversation && (conversation.zernio_connection_id || conversation.meta_connection_id)) {
    return sendWhatsAppForConversation({
      supabase,
      conversation,
      to: conversation.visitor_phone || phone,
      text: opts.text,
      media: opts.media,
    });
  }

  // Sin conversación previa: usamos la conexión Zernio ACTIVA de la organización.
  // (Antes acá caía a una instancia Evolution; ese canal ya no existe.)
  const { data: zconn } = await supabase
    .from('zernio_connections')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (zconn?.id) {
    return sendWhatsAppForConversation({
      supabase,
      conversation: { organization_id: organizationId, zernio_connection_id: zconn.id, visitor_phone: phone },
      to: phone,
      text: opts.text,
      media: opts.media,
    });
  }

  return { ok: false, provider: 'none', error: 'NO_CONNECTION', message: 'La organización no tiene una conexión de WhatsApp activa.' };
}

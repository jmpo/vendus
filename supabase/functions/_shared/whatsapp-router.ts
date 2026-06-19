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
  provider: 'meta' | 'evolution' | 'none';
  error?: string;
  message?: string;
  raw?: unknown;
};

export type WARouterInput = {
  supabase: any;
  conversation: WAConversation;
  to: string; // já normalizado idealmente
  text?: string;
  media?: WAMedia;
};

function normalizePhoneBR(p: string): string {
  let phone = (p || '').replace(/\D/g, '');
  if (!phone) return phone;
  if (!phone.startsWith('55')) phone = '55' + phone;
  return phone;
}

export async function sendWhatsAppForConversation(
  input: WARouterInput,
): Promise<WARouterResult> {
  const { supabase, conversation } = input;
  const to = normalizePhoneBR(input.to || conversation.visitor_phone || '');

  // Prioridade: Meta (oficial) tem preferência se ambos por acaso estiverem setados.
  const provider: 'meta' | 'evolution' | 'none' =
    conversation.meta_connection_id ? 'meta'
      : conversation.evolution_instance_id ? 'evolution'
        : 'none';

  console.log(
    `[wa-router] provider=${provider} conv=${conversation.id ?? '-'} ` +
    `meta_conn=${conversation.meta_connection_id ?? '-'} ` +
    `evo_inst=${conversation.evolution_instance_id ?? '-'} to=${to}`,
  );

  if (provider === 'none') {
    return {
      ok: false,
      provider,
      error: 'NO_CONNECTION',
      message: 'Conversa sem conexão WhatsApp vinculada (Meta ou Evolution).',
    };
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

  // provider === 'evolution'
  let evoBody: Record<string, unknown>;
  if (input.media) {
    const m = input.media;
    evoBody = {
      organization_id: conversation.organization_id,
      instance_id: conversation.evolution_instance_id,
      type: 'media',
      to,
      payload: {
        type: m.kind === 'sticker' ? 'image' : m.kind,
        url: m.url,
        mimetype: m.mime || (m.kind === 'audio' ? 'audio/ogg' : undefined),
        fileName: m.filename || (m.kind === 'audio' ? `audio-${Date.now()}.ogg` : undefined),
        caption: m.kind === 'audio' ? undefined : (input.text || m.caption || undefined),
      },
    };
  } else {
    evoBody = {
      organization_id: conversation.organization_id,
      instance_id: conversation.evolution_instance_id,
      type: 'text',
      to,
      payload: { text: input.text ?? '' },
    };
  }

  const { data, error } = await supabase.functions.invoke('evolution-send', { body: evoBody });
  const ok = !error && (data as any)?.ok !== false;
  if (!ok) {
    console.error('[wa-router] evolution-send FAILED:', JSON.stringify({ error, data }).slice(0, 500));
    return {
      ok: false,
      provider,
      error: error?.message || (data as any)?.body || 'evolution-send failed',
      raw: data,
    };
  }
  return { ok: true, provider, raw: data };
}

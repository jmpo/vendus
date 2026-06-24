// zernio-send
// Envía por el canal Zernio (WhatsApp oficial gestionado).
//  - Dentro de 24h / con conversación abierta: mensaje freeform
//    POST /v1/inbox/conversations/{conversationId}/messages
//  - Para iniciar/reenganchar (fuera de 24h): template
//    POST /v1/inbox/conversations
import { createClient } from 'npm:@supabase/supabase-js@2';
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!req.headers.get('Authorization')) return json({ error: 'Unauthorized' }, 401);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));
  const {
    connection_id, organization_id, conversation_id,
    to, type = 'text', text, media, template,
    record = true, // si false: el llamador ya grabó la fila (evita bolha dupla)
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

  if (type === 'template' || (!zernioConvId && template)) {
    // Iniciar/reenganchar con template
    if (!template?.name || !template?.language) return json({ error: 'template.name y template.language requeridos' }, 400);
    const tplBody = {
      accountId,
      participantId: phone,
      templateName: template.name,
      templateLanguage: template.language,
      ...(template.params ? { templateParams: template.params } : {}),
    };
    console.log('[zernio-send] template →', JSON.stringify(tplBody));
    res = await zfetch(apiKey, '/inbox/conversations', tplBody);
    console.log('[zernio-send] template ← status', res.status, JSON.stringify(res.data).slice(0, 500));
    zernioMsgId = res.data?.data?.messageId ?? null;
    const newConvId = res.data?.data?.conversationId ?? null;
    if (res.ok && newConvId && conversation_id) {
      await sb.from('webchat_conversations').update({ zernio_conversation_id: newConvId }).eq('id', conversation_id);
      zernioConvId = newConvId;
    }
  } else if (zernioConvId) {
    // Ventana 24h: fuera de ella, WhatsApp oficial NO permite mensajes libres → exige template.
    if (conversation_id) {
      const { data: within } = await sb.rpc('is_within_24h_window', { _conversation_id: conversation_id });
      if (within === false) {
        return json({ ok: false, error: 'OUT_OF_WINDOW', message: 'Fuera de la ventana 24h — se requiere un template HSM aprobado.' }, 200);
      }
    }
    // Freeform dentro de conversación abierta. Si hay media, el caption va como message.
    const msgText = text || (hasMedia ? media.caption : undefined);
    const freeformBody = {
      accountId,
      ...(msgText ? { message: msgText } : {}),
      ...(hasMedia ? { attachmentUrl: media.url, attachmentType: mapAttachmentType(media.kind) } : {}),
      ...(hasMedia && media.kind === 'audio' && media.ptt ? { voiceNote: true } : {}),
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
      content: text ?? (hasMedia ? `[${media.kind}]` : `[${type}]`),
      content_type: hasMedia ? (media.kind === 'image' ? 'image' : media.kind === 'audio' ? 'audio' : media.kind === 'video' ? 'video' : 'file') : 'text',
      message_type: type,
      delivery_status: res.ok ? 'sent' : 'failed',
      metadata: {
        provider: 'zernio',
        zernio_message_id: zernioMsgId,
        ...(hasMedia ? { media } : {}),
        ...(template ? { template } : {}),
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

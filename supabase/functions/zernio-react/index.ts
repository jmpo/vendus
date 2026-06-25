// zernio-react
// Envía una reacción (emoji) del AGENTE a un mensaje de WhatsApp vía Zernio.
// POST {ZERNIO_BASE}/inbox/conversations/{convId}/messages/{messageId}/reactions  { accountId, emoji }
// Lo llama el front cuando un vendedor reacciona en el CRM (sentido saliente).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { decryptSecret } from "../_shared/meta-crypto.ts";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const { conversation_id, message_id, emoji } = body ?? {};
  if (!conversation_id || !message_id || !emoji) return json({ ok: false, error: "conversation_id, message_id y emoji requeridos" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // Conversación → conexión + id de conversación en Zernio.
    const { data: conv } = await sb.from("webchat_conversations")
      .select("zernio_connection_id, zernio_conversation_id, channel").eq("id", conversation_id).maybeSingle();
    if (!conv?.zernio_connection_id || !conv?.zernio_conversation_id) {
      return json({ ok: false, error: "no_zernio_conversation" }); // no es Zernio → reacción queda solo en CRM
    }

    const { data: conn } = await sb.from("zernio_connections").select("*").eq("id", conv.zernio_connection_id).maybeSingle();
    if (!conn || conn.status !== "active") return json({ ok: false, error: "connection_inactive" });
    const apiKey = await decryptSecret(conn.api_key_encrypted);

    // Mensaje objetivo → id de Zernio (preferimos el id interno; fallback a wamid).
    const { data: msg } = await sb.from("webchat_messages").select("metadata").eq("id", message_id).maybeSingle();
    const meta = (msg as any)?.metadata || {};
    const zMsgId = meta.zernio_internal_id || meta.zernio_message_id || meta.zernio_platform_message_id;
    if (!zMsgId) return json({ ok: false, error: "no_zernio_message_id" });

    const r = await fetch(`${ZERNIO_BASE}/inbox/conversations/${conv.zernio_conversation_id}/messages/${zMsgId}/reactions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: conn.account_id, emoji }),
    });
    const data = await r.text().then((t) => { try { return JSON.parse(t); } catch { return t; } });
    if (!r.ok) console.warn("[zernio-react] zernio respondió", r.status, JSON.stringify(data).slice(0, 200));
    return json({ ok: r.ok, status: r.status, data });
  } catch (e) {
    console.error("[zernio-react]", String(e));
    return json({ ok: false, error: String(e) }, 500);
  }
});

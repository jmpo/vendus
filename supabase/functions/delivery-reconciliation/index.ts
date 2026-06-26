// delivery-reconciliation
// Backstop de "que el mensaje SIEMPRE llegue". Corre por cron (cada 5 min).
//  1) Mensajes SALIENTES fallidos recientes y sin reconciliar:
//       - error transitorio (500/rate-limit/…) y 1er intento → REINTENTA el envío real.
//       - no recuperable → ALERTA al vendedor (+admins) y marca reconciliado.
//  2) Mensajes "sent" sin confirmación de entrega hace rato → cuenta (visibilidad).
// No reintenta nunca un mensaje 'delivered'/'read' (esos sí llegaron) → cero duplicados.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { sendWhatsAppForConversation } from "../_shared/whatsapp-router.ts";
import { notifySendFailure } from "../_shared/alerts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Códigos transitorios: reintentar TIENE sentido. El resto (formato/nº inválido/fuera de ventana)
// no se arregla reintentando → solo se alerta.
const RETRYABLE = new Set(["500", "131047", "131016", "131000", "131005", "131048"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const report = { failed_seen: 0, retried: 0, recovered: 0, alerted: 0, stuck_sent: 0 };

  try {
    // ── 1) Fallidos recientes sin reconciliar ──────────────────────────────
    const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const { data: failed } = await sb.from("webchat_messages")
      .select("id, conversation_id, content, content_type, message_type, metadata, created_at")
      .eq("direction", "outbound").eq("delivery_status", "failed")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200);

    for (const msg of (failed || []) as any[]) {
      const meta = msg.metadata || {};
      if (meta.reconciled === true) continue;
      report.failed_seen++;

      const { data: conv } = await sb.from("webchat_conversations")
        .select("id, organization_id, meta_connection_id, evolution_instance_id, zernio_connection_id, visitor_phone, assigned_user_id, product_id")
        .eq("id", msg.conversation_id).maybeSingle();
      if (!conv) {
        await sb.from("webchat_messages").update({ metadata: { ...meta, reconciled: true } }).eq("id", msg.id);
        continue;
      }

      const code = String(meta.error_code || "");
      const retryCount = Number(meta.retry_count || 0);
      const isCatalog = msg.message_type === "catalog_card" && meta?.catalog_item?.id;
      const isText = !isCatalog && !!msg.content && (msg.content_type === "text" || !msg.content_type);

      // ¿Reintentar? Solo 1 vez, solo transitorios (o sin código), y solo lo que sabemos reenviar.
      let recovered = false;
      if (retryCount < 1 && (RETRYABLE.has(code) || !code)) {
        try {
          if (isCatalog) {
            const { data: sd } = await sb.functions.invoke("send-catalog-item", {
              body: { conversation_id: conv.id, item_id: meta.catalog_item.id },
            });
            recovered = (sd as any)?.delivered === true;
          } else if (isText) {
            const res = await sendWhatsAppForConversation({
              supabase: sb, conversation: conv, to: conv.visitor_phone || "", text: msg.content,
            });
            recovered = res.ok;
          }
        } catch (e) { console.error("[recon] retry exception", String(e)); }
      }

      if (recovered) {
        report.retried++; report.recovered++;
        await sb.from("webchat_messages").update({
          delivery_status: "sent",
          metadata: { ...meta, reconciled: true, retry_count: retryCount + 1, retried_at: new Date().toISOString(), recovered: true },
        }).eq("id", msg.id);
      } else {
        // No recuperable (o no reintentable) → avisar (throttle por conversación) y cerrar.
        const did = await notifySendFailure(sb, {
          organizationId: conv.organization_id,
          conversationId: conv.id,
          who: conv.visitor_phone || null,
          what: isCatalog ? "una foto del catálogo" : "un mensaje",
          reason: meta.error || (code ? `error ${code}` : "envío fallido"),
          throttleKey: `send_fail:${conv.id}`,
          productId: conv.product_id || null,
          metadata: { source: "reconciliation", message_id: msg.id, error_code: code || null },
        });
        if (did) report.alerted++;
        await sb.from("webchat_messages").update({
          metadata: { ...meta, reconciled: true, retry_count: retryCount, reconciled_at: new Date().toISOString() },
        }).eq("id", msg.id);
      }
    }

    // ── 2) "Enviados" sin confirmación de entrega hace > 1h (posible drop silencioso) ──
    const stuckSince = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await sb.from("webchat_messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "outbound").eq("delivery_status", "sent")
      .lt("created_at", stuckSince).gte("created_at", dayAgo);
    report.stuck_sent = count || 0;

    return new Response(JSON.stringify({ ok: true, ...report, checked_at: new Date().toISOString() }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[delivery-reconciliation] fatal", String(e));
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

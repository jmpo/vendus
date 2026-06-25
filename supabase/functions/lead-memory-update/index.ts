// lead-memory-update
// Mantiene la "ficha del cliente" (memoria por lead): destila hechos de la conversación
// y los fusiona con la ficha existente. Se llama en background desde webchat-bot.
// SELF-THROTTLE: solo gasta una llamada de IA si hay >=6 mensajes nuevos desde la última
// destilación (así no duplica el costo por cada mensaje).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { resolveAIConfig, prepareAIRequestBody, recordAIUsage } from "../_shared/ai-router.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const MIN_NEW_MSGS = 6;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const conversationId = body?.conversation_id;
  const leadId = body?.lead_id;
  if (!conversationId || !leadId) return json({ ok: false, error: "conversation_id y lead_id requeridos" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { count } = await sb.from("webchat_messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
    const total = count ?? 0;

    const { data: mem } = await sb.from("lead_memory").select("facts, msg_count, organization_id").eq("lead_id", leadId).maybeSingle();
    // Throttle: ya existe ficha y no hay suficientes mensajes nuevos → no gastar IA.
    if (mem && total - (mem.msg_count ?? 0) < MIN_NEW_MSGS) return json({ ok: true, skipped: "throttled", total });

    // Org (de la ficha o del lead).
    let orgId = mem?.organization_id ?? body?.organization_id ?? null;
    if (!orgId) {
      const { data: lead } = await sb.from("leads").select("organization_id").eq("id", leadId).maybeSingle();
      orgId = lead?.organization_id ?? null;
    }
    if (!orgId) return json({ ok: false, error: "sin organization_id" }, 400);

    const { data: msgs } = await sb.from("webchat_messages")
      .select("direction, content").eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }).limit(80);
    const transcript = (msgs ?? []).filter((m: any) => String(m.content ?? "").trim())
      .map((m: any) => `${m.direction === "inbound" ? "cliente" : "agente"}: ${String(m.content).slice(0, 400)}`).join("\n");
    if (!transcript) return json({ ok: true, skipped: "sin contenido" });

    const sys = "Mantenés una FICHA de cliente para ventas de autos. Extraés SOLO lo que el cliente dijo o se deduce con certeza. Respondé únicamente con JSON válido.";
    const user =
`FICHA ACTUAL (mantené lo que siga vigente, actualizá si cambió):
${JSON.stringify(mem?.facts ?? {})}

CONVERSACIÓN:
${transcript}

Devolvé EXACTAMENTE:
{"facts":{"uso":"", "ocupantes":"", "nuevo_o_usado":"", "presupuesto":"", "financiacion":"", "entrega_usado":"", "modelos_interes":"", "objecion":"", "etapa":"", "otros":""}, "summary":"1-2 frases con lo esencial del cliente para que el vendedor lo tenga presente"}
Reglas: OMITÍ los campos sin dato real (no inventes). Mantené valores cortos. summary en español, natural.`;

    const aiCfg = await resolveAIConfig(sb, orgId, "agent_chat");
    const res = await fetch(aiCfg.endpoint, {
      method: "POST", headers: aiCfg.headers,
      body: JSON.stringify(prepareAIRequestBody({
        model: aiCfg.model,
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        temperature: 0.2, max_tokens: 500,
      }, aiCfg)),
    });
    if (!res.ok) return json({ ok: false, error: `ai_${res.status}` }, 502);
    const data = await res.json();
    await recordAIUsage(sb, orgId, aiCfg, "agent_chat", data?.usage, "lead-memory-update");
    let raw = String(data?.choices?.[0]?.message?.content ?? "").trim().replace(/^```json\s*|\s*```$/g, "");
    let parsed: any; try { parsed = JSON.parse(raw); } catch { return json({ ok: false, error: "parse" }, 502); }

    const facts = parsed?.facts && typeof parsed.facts === "object" ? parsed.facts : {};
    // Limpiar campos vacíos.
    for (const k of Object.keys(facts)) { if (!String(facts[k] ?? "").trim()) delete facts[k]; }
    const summary = String(parsed?.summary ?? "").slice(0, 600);

    await sb.from("lead_memory").upsert({
      lead_id: leadId, organization_id: orgId,
      facts, summary, msg_count: total, updated_at: new Date().toISOString(),
    }, { onConflict: "lead_id" });

    return json({ ok: true, updated: true, total });
  } catch (e) {
    console.error("[lead-memory-update]", String(e));
    return json({ ok: false, error: String(e) }, 500);
  }
});

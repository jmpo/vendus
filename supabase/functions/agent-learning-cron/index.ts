// agent-learning-cron
// "Cerebro que aprende" (inspirado en la memoria auto-mejorable de Hermes / Nous Research,
// adaptado a ventas). Corre 1x/día:
//   1) CAPTURA trayectorias de conversaciones que cerraron: test drive agendado (booking_requests),
//      venta ganada (deals.status='won') y, para contraste, perdidas (deals.status='lost').
//   2) DESTILA aprendizajes accionables por org (qué funciona / qué evitar).
//   3) Reemplaza el set activo de agent_learnings → el bot los inyecta en su prompt.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { resolveAIConfig, prepareAIRequestBody, recordAIUsage } from "../_shared/ai-router.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const DAYS_LOOKBACK = 7;          // ventana de captura
const MAX_MSGS = 30;              // mensajes por trayectoria
const MAX_TRAJ_FOR_DISTILL = 24;  // trayectorias por org que mira el destilador

function rolize(m: any): { role: string; content: string } {
  const who = m.direction === "inbound" || m.sender_type === "visitor" ? "cliente" : "agente";
  return { role: who, content: String(m.content ?? "").slice(0, 500) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // organization_id opcional → re-aprendizaje manual de UNA org (botón del panel).
  let onlyOrg: string | null = null;
  try { const b = await req.json(); onlyOrg = b?.organization_id ?? null; } catch { /* sin body = todas */ }
  const sinceIso = new Date(Date.now() - DAYS_LOOKBACK * 86400000).toISOString();
  const result: Record<string, any> = { captured: 0, orgs_distilled: 0, learnings_written: 0 };

  // Snapshot de la conversación más reciente de un lead → [{role,content}].
  const snapshot = async (orgId: string, leadId: string | null): Promise<{ convId: string | null; agentType: string | null; msgs: any[] }> => {
    if (!leadId) return { convId: null, agentType: null, msgs: [] };
    const { data: conv } = await sb.from("webchat_conversations")
      .select("id, current_agent_id").eq("organization_id", orgId).eq("lead_id", leadId)
      .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
    if (!conv) return { convId: null, agentType: null, msgs: [] };
    const { data: msgs } = await sb.from("webchat_messages")
      .select("direction, sender_type, content, created_at").eq("conversation_id", conv.id)
      .order("created_at", { ascending: true }).limit(120);
    const mapped = (msgs ?? []).filter((m: any) => String(m.content ?? "").trim()).map(rolize).slice(-MAX_MSGS);
    let agentType: string | null = null;
    if (conv.current_agent_id) {
      const { data: ag } = await sb.from("product_agents").select("agent_type").eq("id", conv.current_agent_id).maybeSingle();
      agentType = ag?.agent_type ?? null;
    }
    return { convId: conv.id, agentType, msgs: mapped };
  };

  const capture = async (orgId: string, leadId: string | null, outcome: string) => {
    const { convId, agentType, msgs } = await snapshot(orgId, leadId);
    if (!convId || msgs.length < 2) return; // necesita una charla real
    const { error } = await sb.from("agent_trajectories").insert({
      organization_id: orgId, conversation_id: convId, lead_id: leadId, agent_type: agentType,
      outcome, messages: msgs,
    });
    if (!error) result.captured++; // si choca con el índice único (ya capturada) → ignorar
  };

  try {
    // ---- 1) CAPTURA ----
    // Test drives agendados (booking_requests).
    let bq = sb.from("booking_requests")
      .select("organization_id, lead_id, created_at").gte("created_at", sinceIso).not("lead_id", "is", null).limit(500);
    if (onlyOrg) bq = bq.eq("organization_id", onlyOrg);
    const { data: bookings } = await bq;
    for (const b of bookings ?? []) await capture(b.organization_id, b.lead_id, "booked");

    // Ventas ganadas / perdidas (deals).
    let dq = sb.from("deals")
      .select("organization_id, lead_id, status, closed_at, updated_at").gte("updated_at", sinceIso).limit(500);
    if (onlyOrg) dq = dq.eq("organization_id", onlyOrg);
    const { data: deals } = await dq;
    for (const d of deals ?? []) {
      const st = String(d.status ?? "").toLowerCase();
      if (st === "won") await capture(d.organization_id, d.lead_id, "won");
      else if (st === "lost") await capture(d.organization_id, d.lead_id, "lost");
    }

    // ---- 2) DESTILAR por org ----
    let orgIds: string[];
    if (onlyOrg) {
      orgIds = [onlyOrg];
    } else {
      const { data: orgsRaw } = await sb.from("agent_trajectories").select("organization_id").gte("created_at", sinceIso);
      orgIds = [...new Set((orgsRaw ?? []).map((r: any) => r.organization_id))];
    }

    for (const orgId of orgIds) {
      try {
        const { data: trajs } = await sb.from("agent_trajectories")
          .select("outcome, messages, agent_type").eq("organization_id", orgId)
          .order("created_at", { ascending: false }).limit(MAX_TRAJ_FOR_DISTILL);
        const wins = (trajs ?? []).filter((t: any) => t.outcome === "won" || t.outcome === "booked");
        if (wins.length === 0) continue; // sin material positivo, no destilamos
        const losses = (trajs ?? []).filter((t: any) => t.outcome === "lost");

        const fmt = (arr: any[]) => arr.slice(0, 8).map((t: any, i: number) =>
          `--- Conversación ${i + 1} (${t.outcome}) ---\n` +
          (t.messages as any[]).map((m) => `${m.role}: ${m.content}`).join("\n")
        ).join("\n\n");

        const sys = "Sos un analista experto en ventas por WhatsApp. Tu trabajo: extraer APRENDIZAJES accionables de conversaciones reales, para que un agente de IA venda mejor. Respondé SOLO con un JSON válido.";
        const user =
`Estas son conversaciones que TERMINARON BIEN (test drive agendado o venta ganada):

${fmt(wins)}

${losses.length ? `Y estas TERMINARON MAL (se perdieron), para contraste:\n\n${fmt(losses)}\n` : ""}
Extraé entre 3 y 6 APRENDIZAJES concretos, cortos y accionables sobre QUÉ HACER (y qué evitar) para cerrar más. Basate SOLO en lo que ves en estas charlas, no inventes.
Devolvé EXACTAMENTE este formato JSON:
{"learnings":[{"category":"objecion|cierre|agendamiento|general","insight":"texto corto y accionable en español"}]}`;

        const aiCfg = await resolveAIConfig(sb, orgId, "agent_chat");
        const res = await fetch(aiCfg.endpoint, {
          method: "POST", headers: aiCfg.headers,
          body: JSON.stringify(prepareAIRequestBody({
            model: aiCfg.model,
            messages: [{ role: "system", content: sys }, { role: "user", content: user }],
            temperature: 0.4, max_tokens: 700,
          }, aiCfg)),
        });
        if (!res.ok) { console.error("[learning-cron] AI", orgId, res.status); continue; }
        const data = await res.json();
        await recordAIUsage(sb, orgId, aiCfg, "agent_chat", data?.usage, "agent-learning-cron:distill");
        let raw = String(data?.choices?.[0]?.message?.content ?? "").trim().replace(/^```json\s*|\s*```$/g, "");
        let parsed: any; try { parsed = JSON.parse(raw); } catch { console.error("[learning-cron] parse fail", orgId); continue; }
        const learnings = Array.isArray(parsed?.learnings) ? parsed.learnings : [];
        if (learnings.length === 0) continue;

        // Reemplazar el set activo: desactivar lo viejo, insertar lo nuevo (fresco y acotado).
        await sb.from("agent_learnings").update({ active: false, updated_at: new Date().toISOString() })
          .eq("organization_id", orgId).eq("active", true);
        const rows = learnings.slice(0, 6).map((l: any) => ({
          organization_id: orgId,
          category: String(l.category ?? "general").slice(0, 40),
          insight: String(l.insight ?? "").slice(0, 400),
          evidence_count: wins.length,
        })).filter((r: any) => r.insight);
        if (rows.length) {
          const { error } = await sb.from("agent_learnings").insert(rows);
          if (!error) { result.orgs_distilled++; result.learnings_written += rows.length; }
        }
      } catch (e) { console.error("[learning-cron] org err", orgId, String(e)); }
    }
  } catch (e) {
    console.error("[learning-cron] fatal", String(e));
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }

  console.log("[learning-cron] done", JSON.stringify(result));
  return new Response(JSON.stringify({ ok: true, ...result }), { headers: { ...cors, "Content-Type": "application/json" } });
});

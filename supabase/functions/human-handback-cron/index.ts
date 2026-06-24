// human-handback-cron: devuelve a la IA las conversaciones que quedaron en atención
// humana SIN actividad por más de IDLE_MINUTES, para que ninguna atención quede colgada.
// Avisa al vendedor asignado que la IA retomó. Corre por cron cada 5 min.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_IDLE_MINUTES = 30; // fallback si la org no configuró handback_idle_minutes

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Conversaciones en atención humana (tomada o esperando). Filtramos por inactividad
  // POR ORGANIZACIÓN (cada org configura su handback_idle_minutes).
  const { data: candidates, error } = await supabase
    .from("webchat_conversations")
    .select("id, organization_id, assigned_user_id, visitor_name, status, last_message_at")
    .in("status", ["human_active", "waiting_human"])
    .order("last_message_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[human-handback] query error:", error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Mapa org → idle_minutes
  const orgIds = [...new Set((candidates || []).map((c) => c.organization_id).filter(Boolean))];
  const idleByOrg = new Map<string, number>();
  if (orgIds.length) {
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, handback_idle_minutes")
      .in("id", orgIds);
    for (const o of orgs || []) idleByOrg.set(o.id, Number(o.handback_idle_minutes) || DEFAULT_IDLE_MINUTES);
  }

  const nowMs = Date.now();
  const stale = (candidates || []).filter((c) => {
    if (!c.last_message_at) return false;
    const idle = idleByOrg.get(c.organization_id) ?? DEFAULT_IDLE_MINUTES;
    return nowMs - new Date(c.last_message_at).getTime() > idle * 60_000;
  });

  let handed = 0;
  for (const conv of stale) {
    const IDLE_MINUTES = idleByOrg.get(conv.organization_id) ?? DEFAULT_IDLE_MINUTES;
    try {
      // Devolver la conversación a la IA
      await supabase
        .from("webchat_conversations")
        .update({ status: "bot_active", needs_human: false })
        .eq("id", conv.id);

      // Avisar al vendedor asignado (si hay) que la IA retomó
      if (conv.assigned_user_id) {
        await supabase.from("notifications").insert({
          user_id: conv.assigned_user_id,
          type: "urgency",
          title: "🤖 La IA retomó una conversación",
          message: `La conversación con ${conv.visitor_name || "el cliente"} estuvo ${IDLE_MINUTES} min sin respuesta y la IA la retomó para no dejar al cliente esperando. Si querés, podés volver a tomarla.`,
          action_url: `/?tab=inbox`,
          metadata: { conversation_id: conv.id, reason: "human_inactivity", idle_minutes: IDLE_MINUTES },
        });
      }

      console.log(`[human-handback] conv ${conv.id} devuelta a la IA (inactiva ${IDLE_MINUTES}min)`);
      handed++;
    } catch (e: any) {
      console.error(`[human-handback] error en conv ${conv.id}:`, e?.message || e);
    }
  }

  return new Response(JSON.stringify({ ok: true, handed_back: handed, checked: stale.length, candidates: (candidates || []).length }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

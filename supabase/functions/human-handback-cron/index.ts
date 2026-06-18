// human-handback-cron: devuelve a la IA las conversaciones que quedaron en atención
// humana SIN actividad por más de IDLE_MINUTES, para que ninguna atención quede colgada.
// Avisa al vendedor asignado que la IA retomó. Corre por cron cada 5 min.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IDLE_MINUTES = 30; // tiempo de inactividad antes de que la IA retome

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cutoff = new Date(Date.now() - IDLE_MINUTES * 60_000).toISOString();

  // Conversaciones en atención humana (tomada o esperando) sin actividad reciente
  const { data: stale, error } = await supabase
    .from("webchat_conversations")
    .select("id, assigned_user_id, visitor_name, status, last_message_at")
    .in("status", ["human_active", "waiting_human"])
    .lt("last_message_at", cutoff)
    .limit(50);

  if (error) {
    console.error("[human-handback] query error:", error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let handed = 0;
  for (const conv of (stale || [])) {
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

  return new Response(JSON.stringify({ ok: true, handed_back: handed, checked: (stale || []).length }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

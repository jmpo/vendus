// Cron (cada ~10 min): importa los eventos de Google Calendar de todas las conexiones
// activas hacia el CRM (calendar_events). Así la disponibilidad del agendamiento respeta
// los eventos creados directamente en Google sin depender de un "Sincronizar ahora" manual.
//
// google-calendar-sync es por-usuario; acá iteramos las conexiones y disparamos el import
// de cada una (secuencial, N chico). El export sigue ocurriendo al crear cada cita.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { data: conns } = await supabase
      .from("google_calendar_connections")
      .select("user_id, sync_direction")
      .eq("is_active", true)
      .eq("sync_enabled", true);

    let triggered = 0;
    const errors: string[] = [];

    for (const c of conns || []) {
      // Solo importamos si la dirección lo incluye (import / both / sin definir = todo).
      if (c.sync_direction && !["import", "both"].includes(c.sync_direction)) continue;
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/google-calendar-sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ userId: c.user_id, direction: "import", daysAhead: 30, daysBehind: 1 }),
        });
        if (resp.ok) triggered++;
        else errors.push(`user ${c.user_id}: HTTP ${resp.status}`);
      } catch (e) {
        errors.push(`user ${c.user_id}: ${String(e)}`);
      }
    }

    return new Response(JSON.stringify({ ok: true, connections: (conns || []).length, triggered, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[google-calendar-sync-cron] error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

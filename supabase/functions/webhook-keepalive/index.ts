// webhook-keepalive: re-apunta los webhooks de las instancias de Evolution al destino.
// Se ejecuta por cron cada pocos minutos para AUTO-RECUPERAR la conexión si el
// servidor Evolution (easypanel) se reinicia y pierde la config del webhook.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Config del servidor Evolution (global)
  const { data: settings } = await supabase
    .from("platform_settings")
    .select("evolution_go_url, evolution_go_global_api_key")
    .limit(1)
    .maybeSingle();

  if (!settings?.evolution_go_url) {
    return new Response(JSON.stringify({ ok: false, error: "no_evolution_config" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const server = String(settings.evolution_go_url).replace(/\/$/, "");
  const webhookUrl = `${supabaseUrl}/functions/v1/evolution-webhook`;

  // Instancias activas
  const { data: instances } = await supabase
    .from("evolution_instances")
    .select("instance_id, instance_token, name, status");

  const results: any[] = [];
  for (const inst of (instances || [])) {
    if (!inst.instance_id) continue;
    try {
      const r = await fetch(`${server}/instance/connect`, {
        method: "POST",
        headers: {
          apikey: inst.instance_token || settings.evolution_go_global_api_key,
          instanceId: inst.instance_id,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ webhookUrl, subscribe: ["ALL"], immediate: false }),
      });
      results.push({ name: inst.name, ok: r.ok, status: r.status });
    } catch (e: any) {
      results.push({ name: inst.name, ok: false, error: String(e?.message || e) });
    }
  }

  console.log("[webhook-keepalive] re-apuntados:", JSON.stringify(results));
  return new Response(JSON.stringify({ ok: true, webhookUrl, results }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

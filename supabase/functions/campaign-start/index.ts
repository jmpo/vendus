// Inicia uma campanha: resolve público (snapshot), insere targets,
// sorteia contexto + número, calcula scheduled_for por preset de velocidade.
// POST { campaign_id }

import { resolveAudience, createServiceClient, getSellerRestriction, type CampaignFilters } from "../_shared/campaign-audience.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SpeedPreset = "safe" | "recommended" | "fast" | "aggressive" | "custom";

function speedSecondsRange(preset: SpeedPreset, custom?: any): [number, number] {
  switch (preset) {
    case "safe": return [120, 300];
    case "recommended": return [60, 180];
    case "fast": return [30, 120];
    case "aggressive": return [10, 45];
    case "custom":
      return [Number(custom?.min_seconds ?? 60), Number(custom?.max_seconds ?? 180)];
    default: return [60, 180];
  }
}

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function weightedPick<T extends { weight?: number }>(items: T[]): T | null {
  if (!items.length) return null;
  const total = items.reduce((s, i) => s + (i.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.weight ?? 1;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { campaign_id } = (await req.json()) as { campaign_id: string };
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: "Missing campaign_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createServiceClient();

    const { data: campaign, error: cErr } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaign_id)
      .single();
    if (cErr || !campaign) throw new Error("Campaign not found");

    if (campaign.status === "active") {
      return new Response(JSON.stringify({ error: "Campaign already active" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Vendedor que inicia su propia campaña → audiencia restringida a sus leads.
    const restrictTo = await getSellerRestriction(supabase, req.headers.get("Authorization"));

    // Resolve público (snapshot)
    const audience = await resolveAudience(
      supabase,
      campaign.organization_id,
      (campaign.audience_filters ?? {}) as CampaignFilters,
      (campaign.exclusion_filters ?? {}) as CampaignFilters,
      restrictTo,
    );
    let { leadIds } = audience;
    const { total } = audience;
    let { excluded } = audience;

    // Opt-out guard: remove leads que pediram para sair (whatsapp_opt_in=false)
    if (leadIds.length) {
      const { data: optedOut } = await supabase
        .from('leads')
        .select('id')
        .in('id', leadIds)
        .eq('whatsapp_opt_in', false);
      const optedSet = new Set(((optedOut ?? []) as any[]).map((r) => r.id));
      if (optedSet.size) {
        leadIds = leadIds.filter((id) => !optedSet.has(id));
        excluded = (excluded ?? 0) + optedSet.size;
        console.log(`[campaign-start] ${optedSet.size} lead(s) excluído(s) por opt-out`);
      }
    }

    // Resolve instâncias disponíveis (Evolution + Meta WhatsApp + Zernio)
    let instances: Array<{ id: string; status: string; connection_type: 'evolution' | 'meta_whatsapp' | 'zernio'; weight: number }> = [];
    const distItems = Array.isArray(campaign.instance_distribution) ? (campaign.instance_distribution as any[]) : [];

    if (campaign.instance_strategy === "manual" && distItems.length) {
      const evoIds = distItems
        .filter((i) => (i.connection_type ?? 'evolution') === 'evolution')
        .map((i) => i.instance_id)
        .filter(Boolean);
      const metaIds = distItems
        .filter((i) => i.connection_type === 'meta_whatsapp')
        .map((i) => i.instance_id)
        .filter(Boolean);
      const zernioIds = distItems
        .filter((i) => i.connection_type === 'zernio')
        .map((i) => i.instance_id)
        .filter(Boolean);

      const [{ data: evos }, { data: metas }, { data: zernios }] = await Promise.all([
        evoIds.length
          ? supabase.from("evolution_instances").select("id, status").in("id", evoIds)
          : Promise.resolve({ data: [] as any[] }),
        metaIds.length
          ? supabase.from("whatsapp_meta_connections").select("id, status").in("id", metaIds)
          : Promise.resolve({ data: [] as any[] }),
        zernioIds.length
          ? supabase.from("zernio_connections").select("id, status").in("id", zernioIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const findWeight = (id: string) => distItems.find((x) => x.instance_id === id)?.weight ?? 1;
      instances = [
        ...((evos ?? []) as any[])
          .filter((i) => i.status === "connected")
          .map((i) => ({ id: i.id, status: i.status, connection_type: 'evolution' as const, weight: findWeight(i.id) })),
        ...((metas ?? []) as any[])
          .filter((i) => i.status === "active")
          .map((i) => ({ id: i.id, status: i.status, connection_type: 'meta_whatsapp' as const, weight: findWeight(i.id) })),
        ...((zernios ?? []) as any[])
          .filter((i) => i.status === "active")
          .map((i) => ({ id: i.id, status: i.status, connection_type: 'zernio' as const, weight: findWeight(i.id) })),
      ];
    } else {
      const [{ data: evos }, { data: metas }, { data: zernios }] = await Promise.all([
        supabase
          .from("evolution_instances")
          .select("id, status")
          .eq("organization_id", campaign.organization_id)
          .eq("status", "connected"),
        supabase
          .from("whatsapp_meta_connections")
          .select("id, status")
          .eq("organization_id", campaign.organization_id)
          .eq("status", "active"),
        supabase
          .from("zernio_connections")
          .select("id, status")
          .eq("organization_id", campaign.organization_id)
          .eq("status", "active"),
      ]);
      instances = [
        ...((evos ?? []) as any[]).map((i) => ({ id: i.id, status: i.status, connection_type: 'evolution' as const, weight: 1 })),
        ...((metas ?? []) as any[]).map((i) => ({ id: i.id, status: i.status, connection_type: 'meta_whatsapp' as const, weight: 1 })),
        ...((zernios ?? []) as any[]).map((i) => ({ id: i.id, status: i.status, connection_type: 'zernio' as const, weight: 1 })),
      ];
    }

    if (!instances.length) {
      return new Response(
        JSON.stringify({ error: "Nenhum número WhatsApp conectado para envio" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve contextos disponíveis
    const contextEntries: Array<{ text: string; id?: string; weight: number }> = [];
    const declared = Array.isArray(campaign.contexts) ? (campaign.contexts as any[]) : [];
    for (const c of declared) {
      if (c.inline_text) {
        contextEntries.push({ text: c.inline_text, weight: c.weight ?? 1 });
      } else if (c.context_id) {
        const { data: ctx } = await supabase
          .from("campaign_contexts")
          .select("instructions, objective, tone, cta")
          .eq("id", c.context_id)
          .maybeSingle();
        if (ctx) {
          const text = [
            ctx.objective ? `Objetivo: ${ctx.objective}` : "",
            ctx.tone ? `Tom: ${ctx.tone}` : "",
            ctx.cta ? `CTA: ${ctx.cta}` : "",
            ctx.instructions,
          ].filter(Boolean).join("\n");
          contextEntries.push({ text, id: c.context_id, weight: c.weight ?? 1 });
        }
      }
    }
    if (!contextEntries.length) {
      // fallback: nome da campanha como contexto mínimo
      contextEntries.push({ text: campaign.description ?? campaign.name, weight: 1 });
    }

    // Velocidade
    const [minSec, maxSec] = speedSecondsRange(campaign.speed_preset as SpeedPreset, campaign.speed_config);

    // Base time
    const baseTime = campaign.schedule_type === "scheduled" && campaign.scheduled_at
      ? new Date(campaign.scheduled_at).getTime()
      : Date.now();

    // Constrói targets
    const distribution = campaign.context_distribution as string;
    const targets: any[] = [];
    // Cursor SOLO para Evolution (necesita retardo anti-baneo). Las conexiones oficiales
    // (Meta/Zernio) usan plantilla aprobada → sin riesgo → envío inmediato (todas en baseTime;
    // el dispatcher ya throttlea por tick para respetar el rate-limit de Meta).
    let evoCursor = baseTime;
    let seqIdx = 0;
    let instIdx = 0;

    for (const leadId of leadIds) {
      // Pick context
      let ctx;
      if (distribution === "sequential") {
        ctx = contextEntries[seqIdx % contextEntries.length];
        seqIdx++;
      } else if (distribution === "weighted") {
        ctx = weightedPick(contextEntries)!;
      } else {
        ctx = contextEntries[Math.floor(Math.random() * contextEntries.length)];
      }

      // Pick instance
      let inst;
      if (campaign.instance_strategy === "rotation") {
        inst = instances[instIdx % instances.length];
        instIdx++;
      } else if (campaign.instance_strategy === "manual") {
        inst = weightedPick(instances)!;
      } else {
        inst = instances[Math.floor(Math.random() * instances.length)];
      }

      // Spread time: Evolution con retardo (anti-baneo); Meta/Zernio inmediato.
      const isApi = inst.connection_type === "meta_whatsapp" || inst.connection_type === "zernio";
      let scheduledFor: string;
      if (isApi) {
        scheduledFor = new Date(baseTime).toISOString();
      } else {
        evoCursor += randomBetween(minSec, maxSec) * 1000;
        scheduledFor = new Date(evoCursor).toISOString();
      }

      targets.push({
        campaign_id,
        lead_id: leadId,
        organization_id: campaign.organization_id,
        status: "queued",
        context_used: ctx.text,
        context_id: ctx.id ?? null,
        instance_id: inst.id,
        connection_type: inst.connection_type,
        scheduled_for: scheduledFor,
      });
    }

    // Insere em chunks (upsert para evitar duplicar em reexecuções)
    const CHUNK = 500;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const batch = targets.slice(i, i + CHUNK);
      const { error: insErr } = await supabase
        .from("campaign_targets")
        .upsert(batch, { onConflict: "campaign_id,lead_id", ignoreDuplicates: true });
      if (insErr) {
        console.error("[campaign-start] insert error", insErr);
        throw insErr;
      }
    }

    // Atualiza campanha
    await supabase
      .from("campaigns")
      .update({
        status: "active",
        started_at: new Date().toISOString(),
        totals: { audience: total, will_receive: leadIds.length, excluded },
      })
      .eq("id", campaign_id);

    // Incrementa usage_count dos contextos da biblioteca
    const usedIds = Array.from(new Set(contextEntries.map((c) => c.id).filter(Boolean))) as string[];
    if (usedIds.length) {
      for (const id of usedIds) {
        await supabase.rpc("noop").catch(() => {});
        // increment usage_count manually
        const { data: row } = await supabase
          .from("campaign_contexts")
          .select("usage_count")
          .eq("id", id)
          .maybeSingle();
        if (row) {
          await supabase
            .from("campaign_contexts")
            .update({ usage_count: (row.usage_count ?? 0) + 1 })
            .eq("id", id);
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        total_audience: total,
        scheduled: leadIds.length,
        excluded,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[campaign-start]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

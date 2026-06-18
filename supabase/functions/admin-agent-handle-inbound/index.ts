// Recibe mensajes del admin vía WhatsApp, rutea al Lovable AI Gateway
// con tools read-only y responde vía WhatsApp.
//
// El agente tipo 'admin' es un CARGO (Chief of Staff ejecutivo), no una
// personalidad libre — ver EXECUTIVE_KERNEL abajo. Los campos del banco
// (objetivo, tono, prompt adicional) son MODIFICADORES de tono/énfasis, nunca
// pueden alterar las reglas del kernel.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceSupabase, sendAdminMessage } from "../_shared/admin-send.ts";
import { parseHandoffTag } from "../_shared/handoff-parser.ts";
import { recordLovableUsage } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─────────────────────────────────────────────────────────────────────
// EXECUTIVE_KERNEL — comportamiento blindado por TIPO (no editable)
// Se aplica a todo agente con agent_type='admin', en cualquier org.
// ─────────────────────────────────────────────────────────────────────
function buildExecutiveKernel(args: {
  agentName: string;
  adminName: string;
  orgName: string;
  productNames: string[];
  monitoredCount: number | null;
  availableAgents: Array<{ name: string; agent_type: string; product_name: string | null }>;
  availableUsers: Array<{ name: string; role: string }>;
}): string {
  const { agentName, adminName, orgName, productNames, monitoredCount, availableAgents, availableUsers } = args;
  const productsLine = productNames.length
    ? `La organización *${orgName}* vende: ${productNames.join(", ")}. Vos YA CONOCÉS todos los productos de la casa — nunca preguntes sobre ellos al admin ni te ofrezcas a explicarlos.`
    : `La organización es *${orgName}*.`;

  const scopeLine = monitoredCount && monitoredCount > 0
    ? `Vos monitoreás ${monitoredCount} producto(s) específicos. Los datos de las tools ya vienen filtrados.`
    : `Vos monitoreás TODOS los productos de la organización.`;

  // ─────────────────────────────────────────────────────────────────
  // Catálogo dinámico de transferencia. Sin esto el agente "tira" tags
  // como [HANDOFF:support] en vez de [HANDOFF_TO_AGENT:Ana].
  // ─────────────────────────────────────────────────────────────────
  const agentsCatalog = availableAgents.length
    ? availableAgents
        .map((a) => {
          const prodPart = a.product_name ? `${a.agent_type} — ${a.product_name}` : `${a.agent_type} — global`;
          const firstName = a.name.split(/[ |\-]/)[0].trim();
          return `- ${a.name} (${prodPart}) → \`[HANDOFF_TO_AGENT:${firstName}]\``;
        })
        .join("\n")
    : "(ningún agente IA configurado)";

  const usersCatalog = availableUsers.length
    ? availableUsers
        .map((u) => {
          const firstName = u.name.split(" ")[0];
          return `- ${u.name} (${u.role}) → \`[HANDOFF_TO_USER:${firstName}]\``;
        })
        .join("\n")
    : "(ningún humano registrado)";


  return `# EXECUTIVE_KERNEL (reglas inmutables — sobrescriben cualquier modificador)

## QUIÉN SOS
Vos sos *${agentName}*, **Chief of Staff** (mano derecha ejecutiva) de ${adminName}, dueño(a)/admin da organización ${orgName}.
Usted NO es vendedor. NO es SDR. NO es agente. NO es assistente de producto.
Vos sos o **asesor interno** do gestor, solo-lectura, focado em datos operativos de la empresa.

## CON QUIÉN HABLÁS
Usted fala SOLO con ${adminName}, su jefe direto. O número de él/ela está registrado como admin en el sistema.
Tratalo/a como gestor de la casa, NUNCA como lead, prospecto ou cliente.

## CONTEXTO DE LA EMPRESA
${productsLine}
${scopeLine}

## LO QUE NUNCA HACÉS (reglas absolutas)
- ❌ NUNCA tentla agendar reunión con ${adminName} (él/ela es tu jefe, no un lead)
- ❌ NUNCA pregunta "cómo puedo ayudarte con [producto]" ou "tiene interés en [producto]"
- ❌ NUNCA uses pitch comercial: "implementación", "recorrido", "vamos a avanzar", "ICP", "calificación"
- ❌ NUNCA pidas nombre, teléfono, email, segmento — vos ya sabés quién es
- ❌ NUNCA tratés al admin como lead o prospecto
- ❌ NUNCA creés, editás, movés o borrás datos (vos sos SOLO-LECTURA)
- Si te piden acción de escritura: "Soy solo-lectura. Usá el panel para esta acción."

## LO QUE SIEMPRE HACÉS
- ✅ Antes de responder cualquier pregunta sobre datos, USÁ unla herramienta. Sin adivinar.
- ✅ Si el admin pide "resumen", "cómo está hoy", "briefing", "situación", "panorama" → usá SIEMPRE \`get_today_briefing\` PRIMERO. Nunca preguntes "cuál resumen".
- ✅ "¿Hay reservas hoy?" / "¿Reuniones hoy?" → \`get_bookings range=today\` (consulta lla agenda DEL EQUIPO, no intentes marcar reunión con vos).
- ✅ "¿Cómo está [nombre de vendedor]?" → \`get_team_status\` y respondé solo sobre esa persona.
- ✅ "Pipeline / embudo / negocios" → \`get_pipeline_summary\`.
- ✅ "Inbox / atención / sin respuesta" → \`get_inbox_status\`.
- ✅ "Comisión / ingresos / financiero" → \`get_financial_summary\`.
- ✅ "Metas / progreso" → \`get_goals_progress\`.
- ✅ "Tareas / pendientes" → \`get_tasks_overview\`.
- ✅ "Errores / agentes / IA" → \`get_agent_logs\`.
- ✅ Si la pregunta es vaga, elegí lla herramienta más probable y mostrá el resultado — después ofrecé "¿querés ver más detalles?".

## SALUDO ESTÁNDAR (solo en el PRIMER mensaje de la conversación)
Si ${adminName} dice "hola", "qué tal", "cuál es tu nombre", "cómo va" **y aún no hay historial de mensajes en esta conversación**:
> "Hola ${adminName}. Soy *${agentName}*, tu Chief of Staff. Podés preguntarme sobre pipeline, equipo, agenda, financiero, metas o alertas."
NADA más que eso. Sin ofrecer producto, sin preguntar interés, sin pitch.

## MEMORIA Y CONTINUIDAD (CRÍTICO)
- Tenés acceso al historial de esta conversación (los mensajes anteriores aparecen antes del actual).
- **NUNCA repitas una pregunta que ya hiciste antes.** Si ya ofreciste "¿querés briefing, pipeline o financiero?", no lo ofrezcas de nuevo.
- **NUNCA repitas el saludo "Hola ${adminName}"** si ya hablaste en esta conversación. Andá directo a la información.
- Si ${adminName} dice **"sí"**, **"mandá"**, **"puede"**, **"mandá todo"**, **"va"**, **"ok"** — ejecutá INMEDIATAMENTE la última cosa que ofreciste, usando lla herramienta correspondiente. No preguntes de nuevo "cuál querés ver".
- Si ofreciste briefing y dice "sí" → llamá \`get_today_briefing\` y respondé con los datos.
- Si pidió algo y todavía no trajiste los datos, **traelos ahora** — no quedes preguntando qué quiere.

## ALCANCE TOTAL DE RESPUESTA
- Vos sos admin agent. Podés responder CUALQUIER pregunta sobre datos/operación de la empresa.
- NUNCA digas "fuera del alcance", "no puedo ayudar con eso", "consultá el panel" para cosas que están en tus tools.
- Si la pregunta no encaja perfectamente, elegí lla herramienta más cercana y mostrá el resultado.

## TRANSFERENCIA (única forma autorizada)
Vos NUNCA ejecutás transferencias por texto libre — quien mueve conversaciones es el sistema, y el sistema solo entiende TAG. Cuando ${adminName} pida explícitamente hablar con alguien o que vos acciones otro agente, cerrá tu mensaje con UNA de las tags de abajo, **sola en la última línea**, sin comillas, sin markdown, sin emoji:

- \`[HANDOFF_TO_AGENT:Nombre]\` — para accionar OTRO AGENTE IA por nombre (ej.: "llamá a Ana", "pasalo a Sofía", "activá el soporte de Poupe Ya").
- \`[HANDOFF_TO_USER:Nombre]\` — para pasar la conversación a un HUMANO específico del equipo (ej.: "pasalo a Guillermo", "transferí a María del financiero").
- \`[HANDOFF:humano]\` — cuando te pidan genéricamente "agente humano" / "alguien del equipo" sin nombre específico.

### CATÁLOGO DE TRANSFERENCIA (usá EXACTAMENTE estos nombres)
**AGENTES IA disponibles:**
${agentsCatalog}

**HUMANOS del equipo:**
${usersCatalog}

REGLAS DE LAS TAGS (críticas):
1. Usá SOLO los nombres del catálogo de arriba. Si el admin pide un nombre que NO está listado → usá \`[HANDOFF:humano]\` en vez de inventar.
2. NUNCA emitas tags genéricas de rol como \`[HANDOFF:closer]\`, \`[HANDOFF:sdr]\`, \`[HANDOFF:support]\` o \`[HANDOFF:financial]\` — esas tags son para otros agentes especialistas, no para vos. Vos SÓLO usás \`[HANDOFF_TO_AGENT:...]\`, \`[HANDOFF_TO_USER:...]\` o \`[HANDOFF:humano]\`.
3. Tu frase ANTES de la tag debe ser CORTA — solo confirmación ("Listo." / "Va." / "Hecho."). NUNCA escribas "voy a transferir", "te paso", "aguardá un momento", "te conecto con Ana" — eso lo dice la configuración de despedida del agente automáticamente.
4. La tag SIEMPRE va sola en la ÚLTIMA línea, exactamente en el formato de arriba. El sistema usa regex — cualquier variación ("[HANDOFF para Ana]", "transferir Ana") es IGNORADA.
5. Si ${adminName} solo relata un problema ("el soporte está lento", "necesito ayuda con X") SIN pedir transferencia explícitamente — NO emitas tag. Respondé con tus tools.
6. NUNCA te ofrezcas a transferir vos mismo/a si no te lo pidieron — vos sos admin agent, no vendedor/a.

## FORMATO DE RESPUESTA
- Español, WhatsApp, **máximo 4 líneas**
- *Negrita* en números y nombres
- Emojis funcionales (📊 💰 🔥 ⏰ ✅ ❌ 📈 📉) — nunca decorativos
- Fechas en es-PY
- Si la respuesta es larga, resumí en 4 líneas y ofrecé el detalle`;
}

function buildSystemPrompt(args: {
  agent: any;
  adminName: string;
  orgName: string;
  productNames: string[];
  monitoredProductIds: string[] | null;
  availableAgents: Array<{ name: string; agent_type: string; product_name: string | null }>;
  availableUsers: Array<{ name: string; role: string }>;
}): string {
  const { agent, adminName, orgName, productNames, monitoredProductIds, availableAgents, availableUsers } = args;
  const agentName = agent?.name || "Chief of Staff";

  const kernel = buildExecutiveKernel({
    agentName,
    adminName,
    orgName,
    productNames,
    monitoredCount: monitoredProductIds?.length ?? null,
    availableAgents,
    availableUsers,
  });

  // Modificadores opcionales del banco — entran DESPUÉS del kernel y jamás lo sobrescriben
  const modifiers: string[] = [];
  if (agent?.tone_style) modifiers.push(`Tono: ${agent.tone_style}.`);
  if (agent?.message_style) modifiers.push(`Estilo: ${agent.message_style}.`);
  if (agent?.primary_objective) modifiers.push(`Foco/énfasis: ${agent.primary_objective}`);
  if (agent?.additional_prompt) modifiers.push(`Observaciones del gestor: ${agent.additional_prompt}`);

  let prompt = kernel;
  if (modifiers.length) {
    prompt += `\n\n## MODIFICADORES DE TONO (solo ajuste fino — NUNCA alteran las reglas del kernel de arriba)\n${modifiers.join("\n")}`;
  }
  return prompt;
}

const TOOLS = [
  { type: "function", function: { name: "get_today_briefing", description: "ATAJO PRIORITARIO: resumen ejecutivo de hoy agregando pipeline, inbox, agenda, tareas y financiero en un único call. Usá SIEMPRE cuando el admin pida 'resumen', 'briefing', 'cómo está hoy', 'situación', 'panorama'.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "get_pipeline_summary", description: "Resumen de deals abiertos por etapa y valores", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "get_inbox_status", description: "Conversaciones activas en el inbox y sin atención", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "get_team_status", description: "Estado de cada vendedor (online/ausente/offline) y número de leads activos", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "get_tasks_overview", description: "Tareas pendientes y vencidas", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "get_bookings", description: "Reuniones/reservas del equipo en el período (today/week/next). NO es agendar reunión — solo consulta.", parameters: { type: "object", properties: { range: { type: "string", enum: ["today", "week", "next"] } }, required: ["range"], additionalProperties: false } } },
  { type: "function", function: { name: "get_financial_summary", description: "Comisiones pendientes, ingresos cerrados y previsión", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "get_goals_progress", description: "Progreso de las metas en el período actual", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "get_agent_logs", description: "Estado y errores recientes de los agentes IA", parameters: { type: "object", properties: { hours: { type: "number" } }, additionalProperties: false } } },
];

async function runTool(
  name: string,
  args: any,
  orgId: string,
  monitoredProductIds: string[] | null,
): Promise<string> {
  const supabase = getServiceSupabase();
  const productFilter = monitoredProductIds && monitoredProductIds.length > 0 ? monitoredProductIds : null;
  try {
    switch (name) {
      case "get_today_briefing": {
        // Agrega pipeline + inbox + bookings hoy + tareas + financiero num call só
        const now = new Date();
        const startDay = new Date(now); startDay.setHours(0, 0, 0, 0);
        const endDay = new Date(now); endDay.setHours(23, 59, 59, 999);
        const startMonth = new Date(); startMonth.setDate(1); startMonth.setHours(0, 0, 0, 0);
        const nowIso = now.toISOString();

        // Pipeline aberto
        let dealsQ = supabase.from("deals").select("deal_value, product_id").eq("organization_id", orgId).eq("status", "open");
        if (productFilter) dealsQ = dealsQ.in("product_id", productFilter);
        const { data: openDeals } = await dealsQ;
        const pipelineOpen = (openDeals ?? []).reduce((s, d: any) => s + Number(d.deal_value ?? 0), 0);

        // Receita do mes
        let wonQ = supabase.from("deals").select("deal_value, product_id")
          .eq("organization_id", orgId).eq("status", "won").gte("closed_at", startMonth.toISOString());
        if (productFilter) wonQ = wonQ.in("product_id", productFilter);
        const { data: wonDeals } = await wonQ;
        const revenueMonth = (wonDeals ?? []).reduce((s, d: any) => s + Number(d.deal_value ?? 0), 0);

        // Inbox ativo
        const { count: activeInbox } = await supabase.from("webchat_conversations")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId).neq("status", "closed");

        // Agenda hoy
        let bkQ = supabase.from("calendar_events")
          .select("title, start_time, product_id", { count: "exact" })
          .eq("organization_id", orgId)
          .gte("start_time", startDay.toISOString())
          .lte("start_time", endDay.toISOString())
          .order("start_time").limit(10);
        if (productFilter) bkQ = bkQ.in("product_id", productFilter);
        const { data: todayBookings, count: bookingsCount } = await bkQ;

        // Tareas atrasadas / pendentes
        let overdueQ = supabase.from("tasks").select("id", { count: "exact", head: true })
          .eq("organization_id", orgId).neq("status", "completed").lt("due_date", nowIso);
        let pendingQ = supabase.from("tasks").select("id", { count: "exact", head: true })
          .eq("organization_id", orgId).eq("status", "pending");
        if (productFilter) {
          overdueQ = overdueQ.in("product_id", productFilter);
          pendingQ = pendingQ.in("product_id", productFilter);
        }
        const { count: overdueTasks } = await overdueQ;
        const { count: pendingTasks } = await pendingQ;

        // Comisiones pendentes
        let comQ = supabase.from("commissions").select("amount, product_id").eq("organization_id", orgId).eq("status", "pending");
        if (productFilter) comQ = comQ.in("product_id", productFilter);
        const { data: pendingCom } = await comQ;
        const commissionsPending = (pendingCom ?? []).reduce((s, c: any) => s + Number(c.amount ?? 0), 0);

        // Equipo online
        const { data: members } = await supabase.from("profiles").select("id").eq("organization_id", orgId);
        const ids = (members ?? []).map((m: any) => m.id);
        let onlineCount = 0;
        if (ids.length) {
          const { count } = await supabase.from("user_status").select("user_id", { count: "exact", head: true })
            .in("user_id", ids).eq("status", "online");
          onlineCount = count ?? 0;
        }

        return JSON.stringify({
          date: now.toISOString(),
          pipeline_open: pipelineOpen,
          revenue_month: revenueMonth,
          deals_open_count: (openDeals ?? []).length,
          inbox_active: activeInbox ?? 0,
          bookings_today_count: bookingsCount ?? 0,
          bookings_today: (todayBookings ?? []).map((b: any) => ({ title: b.title, start: b.start_time })),
          tasks_overdue: overdueTasks ?? 0,
          tasks_pending: pendingTasks ?? 0,
          commissions_pending: commissionsPending,
          team_online: onlineCount,
          team_total: ids.length,
          filtered_by_products: !!productFilter,
        });
      }
      case "get_pipeline_summary": {
        let dealsQ = supabase.from("deals").select("deal_value, status, product_id").eq("organization_id", orgId).eq("status", "open");
        if (productFilter) dealsQ = dealsQ.in("product_id", productFilter);
        const { data: deals } = await dealsQ;
        const total = (deals ?? []).reduce((s, d: any) => s + Number(d.deal_value ?? 0), 0);
        const { data: stages } = await supabase.from("pipeline_stages").select("id, name, order_index").eq("organization_id", orgId).order("order_index");
        let leadsQ = supabase.from("leads").select("current_stage_id, deal_value, product_id").eq("organization_id", orgId).eq("status", "active");
        if (productFilter) leadsQ = leadsQ.in("product_id", productFilter);
        const { data: leads } = await leadsQ;
        const byStage: Record<string, { name: string; count: number; value: number }> = {};
        for (const st of (stages ?? []) as any[]) byStage[st.id] = { name: st.name, count: 0, value: 0 };
        for (const l of (leads ?? []) as any[]) {
          if (!l.current_stage_id || !byStage[l.current_stage_id]) continue;
          byStage[l.current_stage_id].count++;
          byStage[l.current_stage_id].value += Number(l.deal_value ?? 0);
        }
        return JSON.stringify({
          pipeline_total: total,
          stages: Object.values(byStage),
          deals_open: (deals ?? []).length,
          filtered_by_products: !!productFilter,
        });
      }
      case "get_inbox_status": {
        let convQ = supabase.from("webchat_conversations")
          .select("id, status, last_message_at, webchat_widgets(product_id)", { count: "exact" })
          .eq("organization_id", orgId).neq("status", "closed").limit(200);
        const { data: convs, count } = await convQ;
        const filtered = productFilter
          ? (convs ?? []).filter((c: any) => {
              const pid = c.webchat_widgets?.product_id;
              return !pid || productFilter.includes(pid);
            })
          : (convs ?? []);
        const now = Date.now();
        const unattended = filtered.filter((c: any) => {
          if (!c.last_message_at) return false;
          return (now - +new Date(c.last_message_at)) > 15 * 60 * 1000 && c.status !== "human_handling";
        }).length;
        return JSON.stringify({ active: productFilter ? filtered.length : (count ?? 0), unattended });
      }
      case "get_team_status": {
        const { data: members } = await supabase.from("profiles").select("id, full_name").eq("organization_id", orgId);
        const ids = (members ?? []).map((m: any) => m.id);
        if (!ids.length) return JSON.stringify({ team: [] });
        const { data: statuses } = await supabase.from("user_status").select("user_id, status, active_leads_count").in("user_id", ids);
        const map = new Map((statuses ?? []).map((s: any) => [s.user_id, s]));
        const team = (members ?? []).map((m: any) => ({
          name: m.full_name,
          status: (map.get(m.id) as any)?.status ?? "offline",
          active_leads: (map.get(m.id) as any)?.active_leads_count ?? 0,
        }));
        return JSON.stringify({ team });
      }
      case "get_tasks_overview": {
        const now = new Date().toISOString();
        let overdueQ = supabase.from("tasks")
          .select("id", { count: "exact" }).eq("organization_id", orgId).neq("status", "completed").lt("due_date", now);
        let pendingQ = supabase.from("tasks")
          .select("id", { count: "exact" }).eq("organization_id", orgId).eq("status", "pending");
        if (productFilter) {
          overdueQ = overdueQ.in("product_id", productFilter);
          pendingQ = pendingQ.in("product_id", productFilter);
        }
        const { count: cOverdue } = await overdueQ;
        const { count: cPending } = await pendingQ;
        return JSON.stringify({ overdue: cOverdue ?? 0, pending: cPending ?? 0 });
      }
      case "get_bookings": {
        const range = args?.range ?? "today";
        const now = new Date();
        const start = new Date(now); start.setHours(0, 0, 0, 0);
        const end = new Date(now);
        if (range === "today") end.setHours(23, 59, 59, 999);
        else if (range === "week") end.setDate(end.getDate() + 7);
        else end.setDate(end.getDate() + 30);
        let q = supabase.from("calendar_events")
          .select("id, title, start_time, status, product_id, attendees, user_id, profiles:user_id(full_name)", { count: "exact" })
          .eq("organization_id", orgId)
          .gte("start_time", start.toISOString())
          .lte("start_time", end.toISOString())
          .order("start_time").limit(20);
        if (productFilter) q = q.in("product_id", productFilter);
        const { data, count } = await q;
        const events = (data ?? []).map((e: any) => ({
          title: e.title,
          start: e.start_time,
          status: e.status,
          host: e.profiles?.full_name ?? null,
        }));
        return JSON.stringify({ count: count ?? 0, range, events });
      }
      case "get_financial_summary": {
        let pendingQ = supabase.from("commissions").select("amount, product_id").eq("organization_id", orgId).eq("status", "pending");
        if (productFilter) pendingQ = pendingQ.in("product_id", productFilter);
        const { data: pending } = await pendingQ;
        const pendingTotal = (pending ?? []).reduce((s, c: any) => s + Number(c.amount ?? 0), 0);
        const startMonth = new Date(); startMonth.setDate(1); startMonth.setHours(0, 0, 0, 0);
        let closedQ = supabase.from("deals").select("deal_value, product_id")
          .eq("organization_id", orgId).eq("status", "won").gte("closed_at", startMonth.toISOString());
        let openQ = supabase.from("deals").select("deal_value, product_id").eq("organization_id", orgId).eq("status", "open");
        if (productFilter) {
          closedQ = closedQ.in("product_id", productFilter);
          openQ = openQ.in("product_id", productFilter);
        }
        const { data: closed } = await closedQ;
        const closedTotal = (closed ?? []).reduce((s, d: any) => s + Number(d.deal_value ?? 0), 0);
        const { data: open } = await openQ;
        const openTotal = (open ?? []).reduce((s, d: any) => s + Number(d.deal_value ?? 0), 0);
        return JSON.stringify({ commissions_pending: pendingTotal, revenue_month: closedTotal, pipeline_open: openTotal });
      }
      case "get_goals_progress": {
        const { data: goals } = await supabase.from("goals")
          .select("id, name, target_value, achieved_value, period_end, user_id, profiles(full_name)")
          .eq("organization_id", orgId)
          .gte("period_end", new Date().toISOString())
          .limit(20);
        return JSON.stringify({
          goals: (goals ?? []).map((g: any) => ({
            name: g.name,
            owner: g.profiles?.full_name ?? "Equipo",
            target: g.target_value,
            achieved: g.achieved_value,
            pct: g.target_value > 0 ? Math.round((g.achieved_value / g.target_value) * 100) : 0,
          })),
        });
      }
      case "get_agent_logs": {
        const hours = args?.hours ?? 24;
        const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
        let q = supabase.from("agent_action_logs")
          .select("agent_id, success, action_type, product_id")
          .eq("organization_id", orgId).gte("created_at", since).limit(500);
        if (productFilter) q = q.in("product_id", productFilter);
        const { data } = await q;
        const byAgent: Record<string, { ok: number; fail: number }> = {};
        for (const l of (data ?? []) as any[]) {
          const k = l.agent_id ?? "unknown";
          if (!byAgent[k]) byAgent[k] = { ok: 0, fail: 0 };
          if (l.success) byAgent[k].ok++; else byAgent[k].fail++;
        }
        return JSON.stringify({ hours, agents: byAgent });
      }
      default:
        return JSON.stringify({ error: `unknown tool ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
}

async function callAI(
  messages: any[],
  orgId: string,
  monitoredProductIds: string[] | null,
  tools: any[] = TOOLS,
): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  for (let i = 0; i < 4; i++) {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        tools,
      }),
    });

    if (resp.status === 429) return "Estoy sobrecarregado ahora. Probá em 1 min.";
    if (resp.status === 402) return "Créditos da plataforma esgotados. Avise o time.";
    if (!resp.ok) {
      console.error("[admin-handle-inbound] ai error", resp.status, await resp.text());
      return "Tive un problema técnico. Probá de nuevo.";
    }
    const data = await resp.json();
    await recordLovableUsage(getServiceSupabase(), orgId, 'agent_chat', 'gpt-4o-mini', data?.usage, 'admin-agent-handle-inbound');
    const choice = data.choices?.[0];
    const msg = choice?.message;
    if (!msg) return "No pude procesar tu mensaje.";

    if (msg.tool_calls?.length) {
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        const args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        const result = await runTool(tc.function.name, args, orgId, monitoredProductIds);
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
      continue;
    }
    return msg.content || "Sin respuesta.";
  }
  return "No pude completar tu solicitud. Probá reformularlo.";
}

// Resolve nombre do admin a partir da config (admin_user_id) con fallback
// para el profile cujo phone bate con admin_whatsapp_number.
async function resolveAdminName(
  supabase: any,
  orgId: string,
  adminUserId: string | null,
  adminPhone: string | null,
): Promise<string> {
  if (adminUserId) {
    const { data } = await supabase
      .from("profiles").select("full_name").eq("id", adminUserId).maybeSingle();
    if (data?.full_name) return String(data.full_name).split(" ")[0]; // primero nombre
  }
  if (adminPhone) {
    const tail = adminPhone.replace(/\D/g, "").slice(-10);
    const { data } = await supabase
      .from("profiles").select("full_name, phone").eq("organization_id", orgId);
    const match = (data ?? []).find((p: any) => {
      const pp = String(p.phone ?? "").replace(/\D/g, "");
      return pp && pp.slice(-10) === tail;
    });
    if (match?.full_name) return String(match.full_name).split(" ")[0];
  }
  return "Gestor";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { organization_id, message, phone, agent_id, instance_id, skip_send, conversation_id } = await req.json();
    if (!organization_id || !message) {
      return new Response(JSON.stringify({ error: "missing params" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = getServiceSupabase();

    // Log inbound
    await supabase.from("admin_agent_messages").insert({
      organization_id,
      direction: "inbound",
      message_type: "reactive",
      content: message,
    });

    // Get config (whatsapp number + monitored products + admin user)
    const { data: cfg } = await supabase.from("auto_notification_settings")
      .select("admin_whatsapp_number, monitored_product_ids, admin_user_id")
      .eq("organization_id", organization_id).maybeSingle();
    if (!cfg?.admin_whatsapp_number) {
      return new Response(JSON.stringify({ error: "admin not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve agent (passed in or default global admin)
    let agent: any = null;
    if (agent_id) {
      const { data } = await supabase
        .from("product_agents")
        .select("*")
        .eq("id", agent_id)
        .eq("organization_id", organization_id)
        .maybeSingle();
      agent = data;
    }
    if (!agent) {
      const { data: candidates } = await supabase
        .from("product_agents")
        .select("*")
        .eq("organization_id", organization_id)
        .eq("agent_type", "admin")
        .is("product_id", null)
        .eq("is_active", true);
      agent =
        (candidates ?? []).find((a: any) => a.is_default) ||
        (candidates ?? [])[0] ||
        null;
    }

    if (!agent) {
      const fallback = "⚠️ O Agente Executivo no está configurado en esta organización. Acesse o panel → Agentes para crear um agente do tipo Administrativo.";
      await sendAdminMessage({
        organizationId: organization_id,
        phone: phone || cfg.admin_whatsapp_number,
        message: fallback,
        messageType: "reactive",
        instanceId: instance_id,
      });
      return new Response(JSON.stringify({ ok: true, warning: "no_admin_agent" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Identidade de la empresa e do admin (para el kernel) + catálogo de transferencia
    const [orgRes, prodsRes, adminName, agentsCatalogRes, usersCatalogRes] = await Promise.all([
      supabase.from("organizations").select("name").eq("id", organization_id).maybeSingle(),
      supabase.from("products").select("name, id").eq("organization_id", organization_id).limit(20),
      resolveAdminName(supabase, organization_id, cfg.admin_user_id ?? null, cfg.admin_whatsapp_number),
      // Catálogo de agentes IA disponibles (admin sees ALL — global by design)
      supabase
        .from("product_agents")
        .select("name, agent_type, product_id, products(name)")
        .eq("organization_id", organization_id)
        .eq("is_active", true)
        .neq("id", agent.id), // exclude self
      // Catálogo de humanos do time
      supabase
        .from("profiles")
        .select("id, full_name, user_roles(role)")
        .eq("organization_id", organization_id)
        .not("full_name", "is", null)
        .limit(50),
    ]);
    const orgName = (orgRes.data as any)?.name ?? "su empresa";
    const allProducts = (prodsRes.data ?? []) as any[];
    const monitored = (cfg.monitored_product_ids ?? null) as string[] | null;
    const productNames = monitored && monitored.length > 0
      ? allProducts.filter((p) => monitored.includes(p.id)).map((p) => p.name)
      : allProducts.map((p) => p.name);

    const availableAgents = ((agentsCatalogRes.data ?? []) as any[]).map((a) => ({
      name: a.name,
      agent_type: a.agent_type,
      product_name: a.products?.name ?? null,
    }));

    const availableUsers = ((usersCatalogRes.data ?? []) as any[]).map((u) => {
      const roles = Array.isArray(u.user_roles) ? u.user_roles.map((r: any) => r.role).filter(Boolean) : [];
      const role = roles.includes("admin") ? "admin" : roles.includes("manager") ? "manager" : (roles[0] || "vendedor");
      return { name: u.full_name as string, role };
    });

    const systemPrompt = buildSystemPrompt({
      agent,
      adminName,
      orgName,
      productNames,
      monitoredProductIds: monitored,
      availableAgents,
      availableUsers,
    });

    // Permisos por fonte (tool_configs.allowed_sources). Se no definido, libera tudo.
    const allowedSources = (agent?.tool_configs as any)?.allowed_sources;
    const filteredTools = Array.isArray(allowedSources)
      ? TOOLS.filter((t: any) => allowedSources.includes(t.function?.name))
      : TOOLS;

    // Load conversation history (last 20 messages) when delegated from webchat-bot.
    // This gives the admin agent memory of what was offered/asked before.
    const historyMessages: any[] = [];
    if (conversation_id) {
      try {
        const { data: prev } = await supabase
          .from("webchat_messages")
          .select("direction, content, created_at")
          .eq("conversation_id", conversation_id)
          .order("created_at", { ascending: false })
          .limit(20);
        const ordered = [...(prev ?? [])].reverse();
        for (const m of ordered) {
          const text = typeof m.content === "string" ? m.content : "";
          if (!text.trim()) continue;
          if (text.trim() === String(message).trim() && m.direction === "inbound") continue; // avoid duplicating current message
          historyMessages.push({
            role: m.direction === "outbound" ? "assistant" : "user",
            content: text,
          });
        }
      } catch (histErr) {
        console.warn("[admin-agent-handle-inbound] failed to load history (non-fatal):", histErr);
      }
    }

    const reply = await callAI([
      { role: "system", content: systemPrompt },
      ...historyMessages,
      { role: "user", content: String(message) },
    ], organization_id, monitored, filteredTools);

    // ─────────────────────────────────────────────────────────────────
    // Parse handoff tags emitted by the admin agent.
    // The kernel teaches the model to emit one of:
    //   [HANDOFF_TO_AGENT:Nombre]  → switch to another AI agent (by name)
    //   [HANDOFF_TO_USER:Nombre]   → assign conversation to a human teammate
    //   [HANDOFF:humano]         → mark needs_human, drop AI ownership
    // We strip the tag from the reply, then perform the side-effect.
    // ─────────────────────────────────────────────────────────────────
    let finalReply = reply;
    let handoffInfo: any = null;

    if (conversation_id) {
      const parsed = parseHandoffTag(reply);
      if (parsed.kind) {
        console.log(
          "[admin-agent-handle-inbound] handoff parsed:",
          { kind: parsed.kind, target: parsed.targetName ?? parsed.handoffTo, rawTag: parsed.rawTag },
        );
        finalReply = (parsed.cleanText || "").trim() || "Combinado.";

        try {
          if (parsed.kind === "agent_name" && parsed.targetName) {
            // Resolve target agent by name within the same organization
            const { data: candidates } = await supabase
              .from("product_agents")
              .select("id, name, agent_type, product_id, handoff_outgoing_message, handoff_incoming_message, handoff_delay_seconds")
              .eq("organization_id", organization_id)
              .eq("is_active", true)
              .ilike("name", `%${parsed.targetName}%`);

            const target = (candidates ?? [])[0];
            if (target) {
              console.log("[admin-agent-handle-inbound] target agent resolved:", target.name);

              // Switch active agent on the conversation
              await supabase
                .from("webchat_conversations")
                .update({ current_agent_id: target.id, needs_human: false })
                .eq("id", conversation_id);

              // If target has its own outgoing template, use that as the spoken
              // farewell (renders nicer than Malu's "Combinado."). Otherwise keep finalReply.
              // Variables are minimal here — full rendering happens in the greeter.
              const outTpl = (agent as any)?.handoff_outgoing_message as string | undefined;
              if (outTpl?.trim()) {
                finalReply = outTpl
                  .replace(/\{\{\s*proximo_agente\s*\}\}/g, target.name || "")
                  .replace(/\{\{\s*nombre\s*\}\}/g, "")
                  .replace(/\{\{\s*producto\s*\}\}/g, "")
                  .replace(/\s{2,}/g, " ")
                  .trim();
              }

              // Schedule the new agent's auto-greeting via the dedicated greeter edge fn.
              // Background dispatch — does not block the admin response.
              try {
                const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
                const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
                const greeterPromise = fetch(`${supabaseUrl}/functions/v1/agent-handoff-greeter`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${serviceKey}`,
                  },
                  body: JSON.stringify({
                    conversation_id,
                    to_agent_id: target.id,
                    from_agent_name: agent?.name || "Chief of Staff",
                    product_id: target.product_id || null,
                  }),
                }).catch((e) => console.warn("[admin-agent-handle-inbound] greeter dispatch failed:", e));
                // @ts-ignore EdgeRuntime is provided by Supabase Deno runtime
                if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any)?.waitUntil) {
                  // @ts-ignore
                  (EdgeRuntime as any).waitUntil(greeterPromise);
                }
              } catch (greeterErr) {
                console.warn("[admin-agent-handle-inbound] greeter schedule error:", greeterErr);
              }

              handoffInfo = { kind: "agent_name", to_agent_id: target.id, to_agent_name: target.name };
            } else {
              console.warn("[admin-agent-handle-inbound] target agent NOT FOUND for name:", parsed.targetName);
              finalReply = `No encontrei um agente con o nombre "${parsed.targetName}" ativo na organización. Confirme o nombre ou crie o agente.`;
            }
          } else if (parsed.kind === "user_name" && parsed.targetName) {
            // Resolve target human teammate by full_name
            const { data: profiles } = await supabase
              .from("profiles")
              .select("id, full_name")
              .eq("organization_id", organization_id)
              .ilike("full_name", `%${parsed.targetName}%`)
              .limit(5);

            const targetUser = (profiles ?? [])[0];
            if (targetUser) {
              console.log("[admin-agent-handle-inbound] target user resolved:", targetUser.full_name);
              await supabase
                .from("webchat_conversations")
                .update({
                  assigned_user_id: targetUser.id,
                  status: "human_handling",
                  current_agent_id: null,
                  needs_human: true,
                })
                .eq("id", conversation_id);
              handoffInfo = { kind: "user_name", to_user_id: targetUser.id, to_user_name: targetUser.full_name };
            } else {
              console.warn("[admin-agent-handle-inbound] target user NOT FOUND for name:", parsed.targetName);
              finalReply = `No encontrei "${parsed.targetName}" no time. Verificá o nombre no panel da equipo.`;
            }
          } else if (parsed.kind === "role" && parsed.handoffTo === "humano") {
            await supabase
              .from("webchat_conversations")
              .update({
                needs_human: true,
                current_agent_id: null,
                status: "human_handling",
              })
              .eq("id", conversation_id);
            handoffInfo = { kind: "human_queue" };
          }
        } catch (handoffErr) {
          console.error("[admin-agent-handle-inbound] handoff side-effect failed:", handoffErr);
        }
      }
    }

    // skip_send=true is used when this function is called as a delegated kernel
    // by webchat-bot (admin manual takeover). The caller will deliver the reply
    // through the conversation's own channel (e.g., evolution-send to the lead).
    if (!skip_send) {
      await sendAdminMessage({
        organizationId: organization_id,
        phone: phone || cfg.admin_whatsapp_number,
        message: finalReply,
        messageType: "reactive",
        instanceId: instance_id,
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      reply: finalReply,
      agent_id: agent.id,
      handoff: handoffInfo,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[admin-agent-handle-inbound] error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

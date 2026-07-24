import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { splitIntoBubbles } from "../_shared/humanizer.ts";
import { recordLovableUsage, resolveAIConfig, recordAIUsage } from "../_shared/ai-router.ts";
import { resolveAgentSendConnection } from "../_shared/agent-connection.ts";
import { normalizePhoneBR } from "../_shared/phone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json() as {
      lead_ids: string[];
      agent_id: string;
      organization_id: string;
      objective?: string;
      extra_context?: string;
      event_context?: Record<string, unknown>;
      mode?: 'direct' | 'conversational';
      force_when_human?: boolean;
      instance_id?: string;
      connection_type?: 'evolution' | 'meta_whatsapp' | 'zernio';
      template_config?: { template_id: string; variable_mapping?: Record<string, any> } | null;
    };
    const {
      lead_ids,
      agent_id,
      organization_id,
      objective,
      extra_context,
      event_context,
      mode = 'direct',
      force_when_human = false,
      template_config,
    } = body;
    let instance_id: string | undefined = body.instance_id;
    let connection_type: 'evolution' | 'meta_whatsapp' | 'zernio' = body.connection_type ?? 'evolution';

    if (!lead_ids?.length || !agent_id) {
      return new Response(JSON.stringify({ error: "Missing lead_ids or agent_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get agent
    const { data: agent } = await supabase
      .from("product_agents")
      .select("*")
      .eq("id", agent_id)
      .single();

    if (!agent) throw new Error("Agent not found");

    // Interruptor MAESTRO de IA de la organización. Con ai_enabled=false la IA no
    // puede GENERAR texto (tampoco acá — antes este módulo lo ignoraba y las campañas
    // sin plantilla salían igual con texto inventado). Plantillas aprobadas y mensajes
    // escritos por el usuario NO son IA → esos sí pueden salir.
    const { data: orgAi } = await supabase
      .from("organizations")
      .select("ai_enabled")
      .eq("id", organization_id)
      .maybeSingle();
    const aiOff = (orgAi as any)?.ai_enabled === false;

    // 🔒 Resolve conexão (sem fallback silencioso para default da org)
    if (!instance_id) {
      const resolved = await resolveAgentSendConnection(supabase, agent_id);
      if (!resolved) {
        console.error(`[ManualOutreach] Agente ${agent_id} sem conexão WhatsApp vinculada.`);
        return new Response(
          JSON.stringify({
            error: 'Agente sem conexão WhatsApp vinculada. Configure uma conexão (Evolution ou API Oficial) nas opções do agente.',
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      instance_id = resolved.connection_id;
      connection_type = resolved.connection_type;
      console.log(`[ManualOutreach] usando connection_type=${connection_type} connection_id=${instance_id} (origem: agent-resolver, label=${resolved.label})`);
    } else {
      console.log(`[ManualOutreach] usando connection_type=${connection_type} connection_id=${instance_id} (origem: explicit)`);
    }

    // Resolve widget para a conversa
    let outreachWidgetId: string | null = null;
    {
      const { data: existingWidget } = await supabase
        .from("webchat_widgets")
        .select("id")
        .eq("organization_id", organization_id)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (existingWidget?.id) {
        outreachWidgetId = existingWidget.id;
      } else {
        const { data: createdWidget, error: createWidgetErr } = await supabase
          .from("webchat_widgets")
          .insert({ organization_id, name: "Outreach (automático)", is_active: true })
          .select("id")
          .single();
        if (createWidgetErr) console.error("[ManualOutreach] Falha ao criar widget interno:", createWidgetErr);
        outreachWidgetId = createdWidget?.id ?? null;
      }
    }

    // Knowledge para prompt
    const { data: knowledgeSources } = await supabase
      .from("ai_knowledge_base")
      .select("title, content, category")
      .eq("product_id", agent.product_id)
      .eq("is_active", true)
      .limit(10);

    const knowledgeContext = (knowledgeSources || [])
      .map((k: any) => `[${k.category}] ${k.title}: ${k.content}`)
      .join("\n\n");

    const results: any[] = [];

    for (const leadId of lead_ids) {
      try {
        const { data: lead } = await supabase
          .from("leads")
          .select("name, email, phone, metadata, temperature, deal_value, whatsapp_opt_in")
          .eq("id", leadId)
          .single();

        // Opt-out guard: lead pediu para sair → não envia mais nada
        if ((lead as any)?.whatsapp_opt_in === false) {
          results.push({ leadId, skipped: true, reason: 'OPTED_OUT', code: 'OPTED_OUT' });
          continue;
        }

        // Normaliza respetando números internacionales (no fuerza prefijo 55 en números
        // que ya tienen código de país, p. ej. Paraguay 595…).
        const leadPhone = normalizePhoneBR(lead?.phone) ?? "";
        if (!leadPhone) {
          results.push({ leadId, skipped: true, reason: "No phone" });
          continue;
        }

        // Conversa existente?
        const { data: existingConv } = await supabase
          .from("webchat_conversations")
          .select("id, status, metadata")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        // Dedupe outreach recente — só bloqueia se a janela 24h do WhatsApp estiver
        // realmente aberta (mensagem anterior entregue). Se a tentativa anterior falhou
        // (janela nunca abriu / expirou), permite novo disparo.
        const { data: existingOutreach } = await supabase
          .from("ai_outreach_queue")
          .select("id, last_outreach_at, status")
          .eq("lead_id", leadId)
          .eq("agent_id", agent_id)
          .in("status", ["pending", "sent"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingOutreach && !force_when_human) {
          const lastAt = existingOutreach.last_outreach_at ? new Date(existingOutreach.last_outreach_at).getTime() : 0;
          const hoursSince = (Date.now() - lastAt) / 3600000;
          if (hoursSince < 24) {
            let windowOpen = false;
            if (existingConv?.id) {
              const { data: ok } = await supabase.rpc('is_within_24h_window', { _conversation_id: existingConv.id });
              windowOpen = !!ok;
            }

            let lastMsgFailed = false;
            if (existingConv?.id) {
              const { data: lastMsg } = await supabase
                .from("webchat_messages")
                .select("delivery_status, sender_type")
                .eq("conversation_id", existingConv.id)
                .in("sender_type", ["agent", "ai", "system"])
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              lastMsgFailed = lastMsg?.delivery_status === 'failed';
            }

            if (windowOpen && !lastMsgFailed) {
              console.log(`[ManualOutreach] Dedupe: lead ${leadId} já tem outreach do agente ${agent_id} há ${hoursSince.toFixed(1)}h e janela 24h está aberta — pulando.`);
              results.push({ leadId, skipped: true, reason: "Outreach ativo recente para este agente" });
              continue;
            }
            console.log(`[ManualOutreach] Dedupe bypass: lead ${leadId} outreach há ${hoursSince.toFixed(1)}h mas janela 24h fechada (windowOpen=${windowOpen}, lastMsgFailed=${lastMsgFailed}) — permitindo novo disparo.`);
          }
        }

        if (existingConv && !force_when_human && (existingConv.status === "human_active" || existingConv.status === "waiting_human")) {
          results.push({ leadId, skipped: true, reason: `Conversation in ${existingConv.status}` });
          continue;
        }

        // Template Zernio (identificado por NAME + language, no por template_id de Meta).
        const leadFirstName = (lead?.name ? String(lead.name).trim().split(/\s+/)[0] : '') || 'Hola';

        // Resuelve un valor de variable según el mapeo configurado en la campaña.
        const resolveVar = (m: any): string => {
          switch (m?.source) {
            case 'full_name': return (lead?.name ? String(lead.name).trim() : '') || leadFirstName;
            case 'email':     return (lead?.email ? String(lead.email).trim() : '') || '';
            case 'phone':     return leadPhone || '';
            case 'static':    return String(m?.static_value ?? '');
            case 'first_name':
            default:          return leadFirstName;
          }
        };

        // params en orden de variable ({{1}}, {{2}}, …) desde variable_mapping; si no hay mapeo,
        // mantiene compatibilidad: params explícitos o {{1}} = primer nombre.
        const varMap = (template_config as any)?.variable_mapping ?? null;
        let zernioParams: string[];
        if (varMap && Object.keys(varMap).length) {
          const nums = Object.keys(varMap).map((k) => parseInt(k, 10)).filter((n) => !isNaN(n)).sort((a, b) => a - b);
          zernioParams = nums.map((n) => resolveVar(varMap[String(n)]));
        } else {
          zernioParams = (template_config as any)?.params ?? (template_config as any)?.template_params ?? [leadFirstName];
        }

        const zernioTemplate = connection_type === 'zernio' && template_config && (template_config as any).zernio_template_name
          ? {
              name: (template_config as any).zernio_template_name,
              language: (template_config as any).zernio_template_language || 'es',
              params: zernioParams,
            }
          : null;

        // === Guard Meta: fora da janela 24h sem template = bloqueia antes da IA ===
        const useTemplate = !!(template_config?.template_id && connection_type === 'meta_whatsapp');
        // Si se enviará una plantilla (Meta o Zernio), NO se genera mensaje con IA (no hace falta).
        const willSendTemplate = useTemplate || !!zernioTemplate;
        if (connection_type === 'meta_whatsapp' && !useTemplate) {
          let withinWindow = false;
          if (existingConv?.id) {
            const { data: ok } = await supabase.rpc('is_within_24h_window', { _conversation_id: existingConv.id });
            withinWindow = !!ok;
          }
          if (!withinWindow) {
            results.push({
              leadId,
              error: 'API Oficial fora da janela 24h. Selecione um template HSM aprovado para abrir conversa.',
              code: 'OUT_OF_WINDOW_NEEDS_TEMPLATE',
            });
            continue;
          }
        }

        // === Cria/recupera conversa ANTES do envio para sempre aparecer no Inbox ===
        let conversationId: string | null = existingConv?.id ?? null;
        if (!conversationId) {
          const convMeta: Record<string, unknown> = {
            ai_outreach: true,
            manual_trigger: true,
            outreach_mode: willSendTemplate ? 'template' : mode,
            created_via: 'manual_outreach',
          };
          // Persistir campaign_id para que respostas (botões HSM) consigam aplicar button_actions
          if (event_context && (event_context as any).campaign_id) {
            convMeta.campaign_id = (event_context as any).campaign_id;
          }
          if (mode === 'conversational' && event_context && Object.keys(event_context).length > 0) {
            convMeta.pending_payment_data = event_context;
            convMeta.pending_payment_objective = objective || null;
          }
          const { data: newConv, error: convErr } = await supabase
            .from("webchat_conversations")
            .insert({
              organization_id,
              widget_id: outreachWidgetId,
              visitor_id: crypto.randomUUID(),
              visitor_name: lead?.name || "Lead",
              visitor_email: lead?.email,
              visitor_phone: leadPhone,
              channel: "whatsapp",
              status: "bot_active",
              lead_id: leadId,
              current_agent_id: agent_id,
              meta_connection_id: connection_type === 'meta_whatsapp' ? instance_id : null,
              evolution_instance_id: connection_type === 'evolution' ? instance_id : null,
              zernio_connection_id: connection_type === 'zernio' ? instance_id : null,
              metadata: convMeta,
            })
            .select("id")
            .single();
          if (convErr || !newConv) {
            console.error(`[ManualOutreach] Conversation insert failed for lead ${leadId}:`, convErr);
            results.push({ leadId, error: `conversation insert failed: ${convErr?.message || "unknown"}` });
            continue;
          }
          conversationId = newConv.id;
        } else {
          // Garante vínculo da conexão na conversa existente
          const patch: Record<string, unknown> = { current_agent_id: agent_id };
          if (connection_type === 'meta_whatsapp') patch.meta_connection_id = instance_id;
          if (connection_type === 'evolution') patch.evolution_instance_id = instance_id;
          if (connection_type === 'zernio') patch.zernio_connection_id = instance_id;
          const baseMeta = ((existingConv.metadata as any) || {});
          let mergedMeta: any = null;
          if (event_context && (event_context as any).campaign_id) {
            mergedMeta = { ...baseMeta, campaign_id: (event_context as any).campaign_id };
          }
          if (mode === 'conversational' && event_context && Object.keys(event_context).length > 0) {
            mergedMeta = { ...(mergedMeta ?? baseMeta), pending_payment_data: event_context, pending_payment_objective: objective || null };
          }
          if (mergedMeta) patch.metadata = mergedMeta;
          await supabase.from('webchat_conversations').update(patch).eq('id', conversationId);
        }

        // === Genera mensaje (texto libre) O prepara template ===
        let bubbles: string[] = [];

        // Mensaje PERSONALIZADO de la campaña (escrito por el usuario): se envía TAL CUAL,
        // sin pasar por la IA. Es el camino para campañas de texto controlado sin plantilla.
        const customCampaignText = typeof (template_config as any)?.free_window_message === 'string'
          ? (template_config as any).free_window_message.trim()
          : '';

        if (!willSendTemplate && customCampaignText) {
          bubbles = [customCampaignText];
        } else if (!willSendTemplate && aiOff) {
          // IA apagada y sin plantilla ni mensaje del usuario → NO inventamos nada.
          results.push({
            leadId,
            skipped: true,
            reason: 'IA desactivada (interruptor maestro). Configurá una plantilla o escribí el mensaje de la campaña.',
            code: 'AI_DISABLED',
          });
          continue;
        } else if (!willSendTemplate) {
          const eventCtxLines = event_context
            ? Object.entries(event_context).map(([k, v]) => `- ${k}: ${v}`).join("\n")
            : "";

          // Prompt en ESPAÑOL: el público habla español. Antes estaba en portugués
          // (herencia de Lovable) → las campañas sin plantilla salían "Olá! Sou o...".
          const modeRules = mode === 'conversational'
            ? `MODO: CONVERSACIÓN INTENCIONAL
- Generá SOLO una apertura corta (1–2 líneas, máx. 25 palabras).
- Hacé UNA pregunta provocadora referenciando el evento.
- NO entregues links, códigos ni datos del evento ahora — solo preguntá.`
            : `MODO: MENSAJE DIRECTO
- Generá un mensaje completo de máx. 2 párrafos cortos.
- Si hay un link, ponelo en su propia línea.
- Terminá con UNA pregunta o CTA claro.`;

          const systemPrompt = `Sos ${agent.name}, agente de ${agent.agent_type} de la empresa.
IDIOMA: escribí SIEMPRE en español (es-PY/es-AR neutro). NUNCA en portugués ni en otro idioma.
MISIÓN: ${agent.primary_objective}
TONO DE VOZ: ${agent.tone_style || "Consultivo"}
ESTILO DE MENSAJE: ${agent.message_style || "Corto y directo"}
${agent.can_do?.length ? `LO QUE PODÉS HACER:\n${agent.can_do.map((c: string) => `- ${c}`).join("\n")}` : ""}
${agent.cannot_do?.length ? `LO QUE NO PODÉS HACER:\n${agent.cannot_do.map((c: string) => `- ${c}`).join("\n")}` : ""}
${knowledgeContext ? `CONOCIMIENTO DEL PRODUCTO:\n${knowledgeContext}` : ""}
${objective ? `OBJETIVO DE ESTE CONTACTO: ${objective}` : ""}
${extra_context ? `CONTEXTO ADICIONAL: ${extra_context}` : ""}
${eventCtxLines ? `CONTEXTO DEL EVENTO:\n${eventCtxLines}` : ""}
${modeRules}
REGLAS GENERALES:
- Generá SOLO el mensaje, sin explicaciones ni prefijos.
- Natural y humano, sin clichés.
- WhatsApp: sin markdown, sin HTML.`;

          const userPrompt = `Generá el mensaje de primer contacto por WhatsApp para este lead (EN ESPAÑOL):
Nombre: ${lead?.name || "Lead"}
Email: ${lead?.email || "No informado"}
Teléfono: ${leadPhone}
Temperatura: ${lead?.temperature || "indefinida"}`;

          // Router de IA: usa la conexión configurada (OpenAI propio / Lovable / pool). NO hardcodea Lovable.
          const aiCfg = await resolveAIConfig(supabase, organization_id, 'agent_chat');
          const aiResponse = await fetch(aiCfg.endpoint, {
            method: "POST",
            headers: aiCfg.headers,
            body: JSON.stringify({
              model: aiCfg.model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
            }),
          });

          if (!aiResponse.ok) {
            const errTxt = await aiResponse.text().catch(() => '');
            console.error('[ManualOutreach] AI failed', aiResponse.status, aiCfg.provider, errTxt.slice(0, 200));
            await logFailedMessage(supabase, conversationId, `[falha IA ${aiResponse.status}]`, `AI failed: ${aiResponse.status}`);
            results.push({ leadId, error: `AI failed: ${aiResponse.status}`, conversationId });
            continue;
          }

          const aiData = await aiResponse.json();
          await recordAIUsage(supabase, organization_id, aiCfg, 'agent_chat', aiData?.usage, 'manual-outreach');
          const generatedMessage = aiData.choices?.[0]?.message?.content?.trim();
          if (!generatedMessage) {
            await logFailedMessage(supabase, conversationId, '[IA retornou vazio]', 'AI returned empty message');
            results.push({ leadId, error: "AI returned empty message", conversationId });
            continue;
          }

          bubbles = mode === 'conversational'
            ? [generatedMessage]
            : splitIntoBubbles(generatedMessage, { maxChunks: 2, targetCharsPerChunk: 280 });
        }

        console.log(`[ManualOutreach] (${useTemplate ? 'template' : mode}) -> ${lead?.name} (${leadPhone}) conv=${conversationId}`);

        // === ENVIO ===
        let sent = false;
        let lastError: string | null = null;

        if (useTemplate) {
          const r = await supabase.functions.invoke('meta-whatsapp-send', {
            body: {
              organization_id,
              connection_id: instance_id,
              conversation_id: conversationId,
              to: leadPhone,
              type: 'template',
              template: {
                template_id: template_config!.template_id,
                variable_mapping: template_config!.variable_mapping ?? {},
                lead_id: leadId,
                context: [objective, extra_context].filter(Boolean).join('\n'),
              },
            },
          });
          const ok = !r.error && (r.data as any)?.ok !== false && !(r.data as any)?.error;
          if (!ok) {
            lastError = r.error?.message || (r.data as any)?.error || 'template send failed';
            // meta-whatsapp-send já loga falha quando recebe conversation_id; só garante fallback
            console.error('[ManualOutreach] template send failed', lastError);
          } else {
            sent = true;
          }
        } else if (connection_type === 'meta_whatsapp') {
          for (let i = 0; i < bubbles.length; i++) {
            const r = await supabase.functions.invoke('meta-whatsapp-send', {
              body: {
                organization_id,
                connection_id: instance_id,
                conversation_id: conversationId,
                to: leadPhone,
                type: 'text',
                text: bubbles[i],
              },
            });
            const ok = !r.error && (r.data as any)?.ok !== false && !(r.data as any)?.error;
            if (!ok) {
              lastError = r.error?.message || (r.data as any)?.error || 'meta send failed';
              console.error(`[ManualOutreach] meta send failed:`, lastError);
              break;
            }
            sent = true;
            if (i < bubbles.length - 1) await new Promise((r) => setTimeout(r, 800));
          }
        } else if (connection_type === 'zernio') {
          // Zernio: template (reenganche fuera de 24h) o texto libre (dentro de ventana).
          // zernio-send registra y enruta; fuera de ventana sin template devuelve OUT_OF_WINDOW.
          if (zernioTemplate) {
            const r = await supabase.functions.invoke('zernio-send', {
              body: {
                connection_id: instance_id, organization_id, conversation_id: conversationId,
                to: leadPhone, type: 'template', template: zernioTemplate,
                // Texto personalizado para ventana 24h abierta (envío gratis)
                ...((template_config as any)?.free_window_message
                  ? { free_window_message: (template_config as any).free_window_message }
                  : {}),
                // Marca el mensaje con la campaña → permite el desglose "gratis vs plantilla paga"
                ...(event_context && (event_context as any).campaign_id
                  ? { extra_metadata: { campaign_id: (event_context as any).campaign_id } }
                  : {}),
              },
            });
            const ok = !r.error && (r.data as any)?.ok !== false && !(r.data as any)?.error;
            if (!ok) { lastError = r.error?.message || (r.data as any)?.error || 'zernio template send failed'; console.error('[ManualOutreach] zernio template failed:', lastError); }
            else sent = true;
          } else {
            for (let i = 0; i < bubbles.length; i++) {
              const r = await supabase.functions.invoke('zernio-send', {
                body: { connection_id: instance_id, organization_id, conversation_id: conversationId, to: leadPhone, type: 'text', text: bubbles[i] },
              });
              const ok = !r.error && (r.data as any)?.ok !== false && !(r.data as any)?.error;
              if (!ok) { lastError = r.error?.message || (r.data as any)?.error || 'zernio send failed'; console.error('[ManualOutreach] zernio send failed:', lastError); break; }
              sent = true;
              if (i < bubbles.length - 1) await new Promise((r) => setTimeout(r, 800));
            }
          }
        } else {
          // Evolution: send + logamos a mensagem nós mesmos
          for (let i = 0; i < bubbles.length; i++) {
            const r = await supabase.functions.invoke('evolution-send', {
              body: {
                organization_id,
                instance_id,
                type: 'text',
                to: leadPhone,
                payload: { text: bubbles[i] },
              },
            });
            const ok = !r.error && (r.data as any)?.ok !== false && !(r.data as any)?.error;
            if (!ok) {
              lastError = r.error?.message || (r.data as any)?.error || 'evolution send failed';
              console.error(`[ManualOutreach] evolution send failed:`, lastError);
              await logFailedMessage(supabase, conversationId, bubbles[i], lastError);
              break;
            }
            await supabase.from("webchat_messages").insert({
              conversation_id: conversationId,
              content: bubbles[i],
              sender_type: "bot",
              direction: "outbound",
              delivery_status: "sent",
              metadata: { outreach_mode: mode },
            });
            sent = true;
            if (i < bubbles.length - 1) await new Promise((r) => setTimeout(r, 800));
          }
        }

        if (!sent) {
          // Garante registro visível de falha mesmo para o caminho Meta
          if (connection_type === 'meta_whatsapp' && !useTemplate && bubbles[0]) {
            await logFailedMessage(supabase, conversationId, bubbles[0], lastError || 'send failed');
          }
          results.push({ leadId, error: lastError || "WhatsApp send failed", conversationId });
          continue;
        }

        // Atualiza/insere outreach_queue
        if (existingOutreach) {
          await supabase.from("ai_outreach_queue").update({
            objective: objective || "Abordagem manual retroativa",
            extra_context: extra_context ?? undefined,
            last_outreach_at: new Date().toISOString(),
            next_followup_at: new Date(Date.now() + 24 * 3600000).toISOString(),
            status: "sent",
            conversation_id: conversationId,
          }).eq("id", existingOutreach.id);
        } else {
          await supabase.from("ai_outreach_queue").insert({
            organization_id,
            lead_id: leadId,
            conversation_id: conversationId,
            product_id: agent.product_id,
            agent_id,
            objective: objective || "Abordagem manual retroativa",
            extra_context: extra_context ?? null,
            lead_data: { name: lead?.name, email: lead?.email, phone: leadPhone },
            status: "sent",
            followup_enabled: !useTemplate,
            followup_interval_hours: 24,
            max_followups: 2,
            followup_steps: [{ delay_hours: 24 }, { delay_hours: 48 }],
            business_hours_start: "09:00",
            business_hours_end: "18:00",
            business_days: [1, 2, 3, 4, 5],
            followups_sent: 0,
            last_outreach_at: new Date().toISOString(),
            next_followup_at: new Date(Date.now() + 24 * 3600000).toISOString(),
          });
        }

        results.push({ leadId, name: lead?.name, sent: true, conversationId, via: useTemplate ? 'template' : connection_type });
      } catch (err) {
        results.push({ leadId, error: String(err) });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function logFailedMessage(supabase: any, conversationId: string | null, content: string, errorMsg: string) {
  if (!conversationId) return;
  try {
    await supabase.from("webchat_messages").insert({
      conversation_id: conversationId,
      content,
      sender_type: "bot",
      direction: "outbound",
      delivery_status: "failed",
      metadata: { error: errorMsg, source: 'manual-outreach' },
    });
  } catch (e) {
    console.error('[ManualOutreach] failed to log failed message:', e);
  }
}

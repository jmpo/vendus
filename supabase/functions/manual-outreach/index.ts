import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { splitIntoBubbles } from "../_shared/humanizer.ts";
import { recordLovableUsage } from "../_shared/ai-router.ts";
import { resolveAgentSendConnection } from "../_shared/agent-connection.ts";

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
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
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
      connection_type?: 'evolution' | 'meta_whatsapp';
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
    let connection_type: 'evolution' | 'meta_whatsapp' = body.connection_type ?? 'evolution';

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

        let leadPhone = lead?.phone?.replace(/\D/g, "");
        if (!leadPhone) {
          results.push({ leadId, skipped: true, reason: "No phone" });
          continue;
        }
        if (!leadPhone.startsWith("55")) leadPhone = "55" + leadPhone;

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

        // === Guard Meta: fora da janela 24h sem template = bloqueia antes da IA ===
        const useTemplate = !!(template_config?.template_id && connection_type === 'meta_whatsapp');
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
            outreach_mode: useTemplate ? 'template' : mode,
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

        // === Gera mensagem (texto livre) OU prepara template ===
        let bubbles: string[] = [];
        if (!useTemplate) {
          const eventCtxLines = event_context
            ? Object.entries(event_context).map(([k, v]) => `- ${k}: ${v}`).join("\n")
            : "";

          const modeRules = mode === 'conversational'
            ? `MODO: CONVERSA INTENCIONAL
- Gere APENAS uma abertura curta (1–2 linhas, no máx. 25 palavras).
- Faça UMA pergunta provocativa referenciando o evento.
- NÃO entregue Pix, link, código ou dados do evento agora — só pergunte.`
            : `MODO: MENSAGEM DIRETA
- Gere uma mensagem completa em no máx. 2 parágrafos curtos.
- Se houver Pix/link, coloque cada um em linha própria.
- Termine com UMA pergunta ou CTA claro.`;

          const systemPrompt = `Você é ${agent.name}, um agente de ${agent.agent_type} da empresa.
MISSÃO: ${agent.primary_objective}
TOM DE VOZ: ${agent.tone_style || "Consultivo"}
ESTILO DE MENSAGEM: ${agent.message_style || "Curta e objetiva"}
${agent.can_do?.length ? `O QUE VOCÊ PODE FAZER:\n${agent.can_do.map((c: string) => `- ${c}`).join("\n")}` : ""}
${agent.cannot_do?.length ? `O QUE VOCÊ NÃO PODE FAZER:\n${agent.cannot_do.map((c: string) => `- ${c}`).join("\n")}` : ""}
${knowledgeContext ? `CONHECIMENTO DO PRODUTO:\n${knowledgeContext}` : ""}
${objective ? `OBJETIVO DESTA ABORDAGEM: ${objective}` : ""}
${extra_context ? `CONTEXTO ADICIONAL: ${extra_context}` : ""}
${eventCtxLines ? `CONTEXTO DO EVENTO:\n${eventCtxLines}` : ""}
${modeRules}
REGRAS GERAIS:
- Gere APENAS a mensagem, sem explicações ou prefixos.
- Seja natural e humano, sem clichês.
- WhatsApp: sem markdown, sem HTML.`;

          const userPrompt = `Gere a mensagem de primeira abordagem via WhatsApp para este lead:
Nome: ${lead?.name || "Lead"}
Email: ${lead?.email || "Não informado"}
Telefone: ${leadPhone}
Temperatura: ${lead?.temperature || "indefinida"}`;

          const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
            }),
          });

          if (!aiResponse.ok) {
            await logFailedMessage(supabase, conversationId, `[falha IA ${aiResponse.status}]`, `AI failed: ${aiResponse.status}`);
            results.push({ leadId, error: `AI failed: ${aiResponse.status}`, conversationId });
            continue;
          }

          const aiData = await aiResponse.json();
          await recordLovableUsage(supabase, organization_id, 'agent_chat', 'google/gemini-2.5-flash', aiData?.usage, 'manual-outreach');
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

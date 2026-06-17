import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildAgentTemplate, describeAgentMission, type AgentTypeKey } from "../_shared/agent-prompt-templates.ts";
import { recordLovableUsage } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AgentGenerationRequest {
  product_id: string | null;
  agent_type: AgentTypeKey;
  custom_context?: string;
  scope?: 'product' | 'organization';
  optimize_field?: string;
  current_value?: string;
}

const GLOBAL_TYPES: AgentTypeKey[] = ['admin', 'support', 'financial', 'orchestrator'];

function pricingToText(pricing: any): string {
  if (!pricing) return '';
  if (typeof pricing === 'string') return pricing;
  if (Array.isArray(pricing)) {
    return pricing
      .map((p: any) => {
        const label = p?.label || p?.name || p?.plan || '';
        const price = p?.price ?? p?.value ?? p?.amount ?? '';
        return label || price ? `${label} ${price}`.trim() : '';
      })
      .filter(Boolean)
      .join(' · ');
  }
  if (typeof pricing === 'object') {
    return Object.entries(pricing)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' · ');
  }
  return String(pricing);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { product_id, agent_type, custom_context, scope, optimize_field, current_value } =
      await req.json() as AgentGenerationRequest;

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Identify caller user → organization
    const authHeader = req.headers.get("Authorization");
    let organizationId: string | null = null;
    let adminName: string | null = null;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: userData } = await supabase.auth.getUser(token);
      if (userData?.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("organization_id, full_name")
          .eq("id", userData.user.id)
          .maybeSingle();
        organizationId = profile?.organization_id || null;
        adminName = profile?.full_name || null;
      }
    }

    const isOrgScope =
      !product_id && (scope === "organization" || GLOBAL_TYPES.includes(agent_type));

    // ============= Load org context =============
    let orgName = 'Empresa';
    let refundPolicy = '';
    let paymentPolicy = '';
    if (organizationId) {
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .maybeSingle();
      if (org?.name) orgName = org.name;
      const { data: settings } = await supabase
        .from("auto_notification_settings")
        .select("alert_critical_product_idle_hours")
        .eq("organization_id", organizationId)
        .maybeSingle();
      // refund/payment policies: pull from any product if available
      if (settings) { /* placeholder: org-level policy table not present */ }
    }

    // ============= Load product context (when applicable) =============
    let productCtx: any = null;
    let supportKnowledge = '';
    if (product_id) {
      const { data: product } = await supabase
        .from("products")
        .select("name, description, icp, pitch_15s, pitch_30s, organization_id, pricing")
        .eq("id", product_id)
        .maybeSingle();
      if (product) {
        organizationId = organizationId || product.organization_id;
        productCtx = product;
      }
      // Pull product knowledge sources (objections, benefits, etc.)
      const { data: sources } = await supabase
        .from("product_knowledge_sources")
        .select("title, source_type, extracted_content, question, answer")
        .eq("product_id", product_id)
        .eq("is_active", true)
        .limit(8);
      if (sources && sources.length > 0) {
        supportKnowledge = sources
          .map((s) => {
            if (s.source_type === 'faq' && s.question && s.answer) {
              return `FAQ — ${s.title}: P: ${s.question} | R: ${s.answer}`;
            }
            return `${s.title}: ${(s.extracted_content || '').slice(0, 600)}`;
          })
          .filter(Boolean)
          .join('\n\n');
      }
      // Objections
      const { data: objections } = await supabase
        .from('objections')
        .select('what_they_say, suggested_response')
        .eq('product_id', product_id)
        .limit(8);
      if (objections && objections.length > 0) {
        productCtx = {
          ...productCtx,
          objections_text: objections
            .map((o: any) => `- "${o.what_they_say}" → ${o.suggested_response || '(sin respuesta registrada)'}`)
            .join('\n'),
        };
      }
    }

    // ============= Org-wide product list + routing matrix =============
    let productsList = '';
    let routingMatrix = '';
    let monitoredCount = 0;
    if (organizationId && (isOrgScope || agent_type === 'orchestrator' || agent_type === 'admin')) {
      const { data: products } = await supabase
        .from("products")
        .select("id, name, description")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .limit(20);
      const { data: existingAgents } = await supabase
        .from("product_agents")
        .select("id, name, agent_type, product_id")
        .eq("organization_id", organizationId)
        .eq("is_active", true);

      productsList =
        (products || []).length > 0
          ? (products || [])
              .map((p) => `- ${p.name}${p.description ? ` — ${String(p.description).slice(0, 120)}` : ''}`)
              .join('\n')
          : '(ningún producto registrado)';

      const lines: string[] = [];
      (products || []).forEach((p) => {
        const specialists = (existingAgents || [])
          .filter((a) => a.product_id === p.id)
          .map((a) => `${a.name} (${a.agent_type})`);
        lines.push(
          `- ${p.name} → ${specialists.length > 0 ? specialists.join(', ') : 'SEM ESPECIALISTAS (orquestrador atende direto)'}`
        );
      });
      const globals = (existingAgents || [])
        .filter((a) => !a.product_id && ['support', 'financial'].includes(a.agent_type))
        .map((a) => `${a.name} (${a.agent_type})`);
      if (globals.length > 0) lines.push(`- Globais: ${globals.join(', ')}`);
      routingMatrix = lines.length > 0 ? lines.join('\n') : '(sin agentes especialistas cadastrados)';

      // Admin monitored products
      if (agent_type === 'admin') {
        const { data: notif } = await supabase
          .from('auto_notification_settings')
          .select('monitored_product_ids')
          .eq('organization_id', organizationId)
          .maybeSingle();
        monitoredCount = Array.isArray(notif?.monitored_product_ids)
          ? notif.monitored_product_ids.length
          : 0;
      }
    }

    // ============= Org-wide support materials (for support agent) =============
    let orgSupportMaterials = '';
    if (agent_type === 'support' && organizationId) {
      const { data: mats } = await supabase
        .from('agent_training_materials')
        .select('title, extracted_content')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .is('product_id', null)
        .limit(10);
      if (mats && mats.length > 0) {
        orgSupportMaterials = mats
          .map((m: any) => `[${m.title}]: ${(m.extracted_content || '').slice(0, 600)}`)
          .join('\n\n');
      }
    }

    // ============= Build the type-specific template =============
    const templateArgs = {
      organization_name: orgName,
      product_name: productCtx?.name,
      product_description: productCtx?.description,
      product_benefits: productCtx?.differentials?.join?.(', '),
      product_objections: productCtx?.objections_text,
      product_plans: pricingToText(productCtx?.pricing),
      product_prices: pricingToText(productCtx?.pricing),
      product_guarantee: '',
      payment_conditions: '',
      discount_policy: '',
      refund_deadline: refundPolicy,
      payment_policy: paymentPolicy,
      support_knowledge_base: orgSupportMaterials || supportKnowledge,
      products_list: productsList,
      routing_matrix: routingMatrix,
      admin_name: adminName || undefined,
      monitored_count: monitoredCount,
      custom_context: custom_context,
    };

    const blueprintTemplate = buildAgentTemplate(agent_type, templateArgs);
    const mission = describeAgentMission(agent_type);

    const contextSummary = `
🏢 ORGANIZAÇÃO: ${orgName}
${productCtx ? `📦 PRODUTO: ${productCtx.name} — ${productCtx.description || ''}\n${productCtx.icp ? `🎯 ICP: ${productCtx.icp}\n` : ''}${productCtx.pitch_15s ? `⚡ Pitch: ${productCtx.pitch_15s}\n` : ''}${productCtx.objections_text ? `🛡️ Objeciones:\n${productCtx.objections_text}\n` : ''}` : ''}
${productsList ? `📦 PRODUTOS DA ORG:\n${productsList}\n` : ''}
${routingMatrix ? `🧭 MATRIZ DE ROTEAMENTO:\n${routingMatrix}\n` : ''}
${supportKnowledge ? `📚 CONHECIMENTO DO PRODUTO (resumen):\n${supportKnowledge.slice(0, 1500)}\n` : ''}
${orgSupportMaterials ? `📚 MATERIAIS DE SUPORTE GLOBAIS:\n${orgSupportMaterials.slice(0, 1500)}\n` : ''}
`.trim();

    // ================== Optimize single field ==================
    if (optimize_field && current_value) {
      const fieldPrompts: Record<string, string> = {
        primary_objective: "Reescribí o objetivo principal del agente para ser mais claro, estratégico e acionável.",
        additional_prompt: "Melhore as instrucciones adicionais para serem mais detalladas, específicas e blindadas contra desvios.",
        can_do: "Sugiere 3-5 capacidades que este agente debe ter, baseado no contexto.",
        cannot_do: "Sugiere 3-5 restricciones importantes para garantir que no ultrapasse su papel.",
        handoff_triggers: "Sugiere 3-5 situaciones em que o agente debe transferir para um humano.",
      };

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Vos sos especialista em design de agentes de IA conversacionais.
Misión de este agente: ${mission}

CONTEXTO REAL:
${contextSummary}

${fieldPrompts[optimize_field] || 'Otimize o campo fornecido para ser mais efetivo.'}`,
            },
            {
              role: "user",
              content: `Valor atual do campo "${optimize_field}":
"${current_value}"

Devuelve una versión otimizada que respeite o tipo del agente e o contexto real.`,
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "optimize_field",
                description: "Return the optimized value",
                parameters: {
                  type: "object",
                  properties: {
                    optimized: {
                      type: optimize_field.includes('_do') || optimize_field.includes('triggers') ? "array" : "string",
                      description: "The optimized value",
                      items: optimize_field.includes('_do') || optimize_field.includes('triggers') ? { type: "string" } : undefined,
                    },
                    reasoning: { type: "string", description: "Brief explanation of improvements" },
                  },
                  required: ["optimized", "reasoning"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "optimize_field" } },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("AI gateway error:", response.status, errorText);
        if (response.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw new Error("AI gateway error");
      }

      const data = await response.json();
      await recordLovableUsage(supabase, organizationId, 'content_generation', 'gpt-4o-mini', data?.usage, 'generate-agent-ai');
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        const result = JSON.parse(toolCall.function.arguments);
        return new Response(JSON.stringify({ field: optimize_field, ...result }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("Failed to get optimization result");
    }

    // ================== Generate complete agent ==================
    const isAdmin = agent_type === 'admin';
    const isOrchestrator = agent_type === 'orchestrator';
    const isSupport = agent_type === 'support';

    const systemPrompt = `Vos sos um especialista em design de agentes de IA conversacionais.

🎯 TIPO DE AGENTE A CRIAR: ${agent_type.toUpperCase()}
📋 MISSÃO DESTE TIPO: ${mission}

⚠️ REGRA CRÍTICA: Vos sostá criando um agente do tipo "${agent_type}" — ele NÃO puede agir como otro tipo.
${isAdmin ? '- Admin: Chief of Staff INTERNO. NUNCA tenta vender, agendar reunión con o admin, ou tratá-lo comel lead.' : ''}
${isOrchestrator ? '- Orquestrador: SOLO classifica e roteia. NUNCA explica producto, NUNCA dá precio, NUNCA negocia.' : ''}
${isSupport ? '- Suporte: Resolve dudas técnicas. NUNCA vende producto adicional. Usa SOLO materiais cadastrados.' : ''}
${agent_type === 'sdr' ? '- SDR: Qualifica e identifica intención. NUNCA dá precio fechado, NUNCA data venta — passa para Closer. ENVIA fotos/vídeos/PDFs/links do CATÁLOGO siempre que el cliente pedir material visual — esse es o canal oficial. NUNCA invente bloqueios como "no posso enviar por acá", "off-market", "restricción de segurança".' : ''}
${agent_type === 'closer' ? '- Closer: Apresenta oferta e data. NUNCA dá descuento sin política autorizada. ENVIA fotos/vídeos/PDFs/links do CATÁLOGO direto no WhatsApp cuando o cliente pedir — no desvia, no inventa restricción.' : ''}
${agent_type === 'financial' ? '- Financeiro: Lida con boletos/NF/cobrança. NUNCA negocia dívida sin autorização.' : ''}
${agent_type === 'custom' ? '- Custom: Se for foco comercial, ENVIA fotos/vídeos/PDFs/links do CATÁLOGO siempre que pedido — canal oficial de mídia.' : ''}

🧱 TEMPLATE BASE BLINDADO (use COMO ponto de partida do additional_prompt — adapte/expanda mas NÃO desconfigure as regras críticas):
\`\`\`
${blueprintTemplate}
\`\`\`

🌐 CONTEXTO REAL DA ORGANIZAÇÃO/PRODUTO:
${contextSummary}

${custom_context ? `\n📝 INSTRUÇÕES ADICIONAIS DO USUÁRIO:\n${custom_context}\n` : ''}

PRINCÍPIOS DE DESIGN:
1. O objetivo debe ser claro, mensurável e ALINHADO ao tipo del agente
2. As regras (can_do/cannot_do) devem ser específicas — espelhe o template blindado
3. handoff_triggers devem proteger a experiência del cliente E o escopo del agente
4. tone_style e message_style devem combinar con a misión
5. additional_prompt DEVE incorporar o template blindado acima, populado con dados reais — no invente do zero

🎭 HUMANIZAÇÃO (campo "humanization") — OBRIGATÓRIO para sdr/closer/custom/support:
- persona.age: 25–45. persona.city: "Cidade, UF" coerente con a região do ICP.
- persona.backstory: 1ª pessoa, ATÉ 500 chars, conectada à dor do ICP do producto. Se ICP es "gestor de tráfego", a backstory reflete alguém que viveu essa dor. Se es "dueño de loja", alguém que trabajou no varejo. SEM clichés de marketing.
- persona.hobbies: 3–5 plausíveis (ex: "rodar bike no fin de semana", "torcer pro Palmeiras", "café especial").
- persona.stories: 3–5 micro-histórias { title, description }. Cada description es uma FRASE REAL que o agente usaria, em 1ª pessoa, espelhando uma objeción/dor do producto. Ex: title "Cuando travei con o ROAS", description "Eu tava igualzinho — torrava grana e no saía do lugar, hasta que descobri que o problema no era a campaña, era o embudo".
- persona.loved_words: 6–12 jargões/modismos do nicho (ex pra tráfego: "ROAS", "CPL", "criativo cansado").
- persona.forbidden_words: 6–12 ítems. SIEMPRE inclua: "incrível", "fantástico", "maravilhoso", "revolucionário", "atenciosamente", "prezado", "estamos à disposición", "agradecemos o contato", "como podemos ajudar".
- tics.region: elegí coerente con persona.city. tics.slang/openers/connectors/fillers: 2–6 ítems cada, sutis, sin caricatura.
- reactions.enabled: true (excepto admin/orchestrator/financial). reactions.rules: 3–6 regras.
  • SDR: regra keyword "precio/valor/quanto custa" → action "context" transferindo pro Closer real (use o nombre em routing_matrix). Regra keyword "quiero comprar/fechar" → context pro Closer.
  • Closer: regra keyword "tá caro/descuento" → context con instrucción de objeción. Regra keyword "vou pensar" → context de follow-up.
  • Suporte: regra keyword "urgente/parou/no funciona" → context de priorização.
  • Admin/Orchestrator/Financial: puede omitir humanization OU mandar reactions.enabled=false.

NÃO retorne timing, splitting nem style — esses ficam no default do front (ya curados).`;

    const userInstruction = isAdmin
      ? `Crea o agente Chief of Staff (admin executivo) ${adminName ? `para ${adminName}` : ''} da ${orgName}. O additional_prompt DEVE conter o EXECUTIVE_KERNEL completo do template, con nombre do admin e productos da organización preenchidos. Tom executivo, mensajes curtas (4 líneas), nunca vendedor.`
      : isOrchestrator
      ? `Crea o agente Orquestrador da ${orgName}. O additional_prompt DEVE conter a matriz de roteamento real e regras claras de "se intención X + producto Y → [HANDOFF:role]". Mensajes ultra curtas (1-2 líneas).`
      : isSupport
      ? `Crea o agente de Suporte global da ${orgName}. O additional_prompt DEVE referenciar os materiais cadastrados e o protocolo de 3 passos (confirmar → resolver → confirmar resolución). NUNCA inventa solución.`
      : agent_type === 'financial'
      ? `Crea o agente Financeiro global da ${orgName}. O additional_prompt DEVE listar os assuntos que resolve (boleto, NF, reembolso, segunda via) e os protocolos. Tom profissional, claro.`
      : productCtx
      ? `Crea o agente ${agent_type.toUpperCase()} para el producto "${productCtx.name}" da ${orgName}. Usa o cérebro do producto (descripción, ICP, objeciones, pitch) para personalizar o additional_prompt. Usa o template blindado como base.`
      : `Crea o agente ${agent_type.toUpperCase()} para la ${orgName}. Usa o template blindado como base.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userInstruction },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "create_agent",
              description: "Create a complete AI agent configuration",
              parameters: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Nombre criativo e profissional para el agente" },
                  description: { type: "string", description: "Descripción breve del agente (1 frase)" },
                  primary_objective: { type: "string", description: "Objetivo principal claro e estratégico, ALINHADO ao tipo" },
                  additional_prompt: {
                    type: "string",
                    description: "Instrucciones detalladas — DEVE incorporar o template blindado fornecido, populado con dados reais (org/producto/admin/matriz). 3-8 parágrafos.",
                  },
                  can_do: { type: "array", items: { type: "string" }, description: "4-6 capacidades específicas do tipo" },
                  cannot_do: { type: "array", items: { type: "string" }, description: "3-5 restricciones críticas do tipo (ex: admin nunca vende, orquestrador nunca dá precio)" },
                  handoff_triggers: { type: "array", items: { type: "string" }, description: "3-5 situaciones para transferir/escalar" },
                  end_conversation_triggers: { type: "array", items: { type: "string" }, description: "2-3 situaciones para cierrar" },
                  tone_style: { type: "string", enum: ["formal", "consultive", "friendly", "technical"] },
                  message_style: { type: "string", enum: ["short", "balanced", "detailed"] },
                  required_phrases: { type: "array", items: { type: "string" }, description: "0-3 frases recorrentes" },
                   prohibited_phrases: { type: "array", items: { type: "string" }, description: "2-3 frases proibidas (ex: admin nunca diz 'cómo puedo ayudarte con [producto]')" },
                   humanization: {
                     type: "object",
                     description: "Humanización del agente: persona estendida, tics regionais e reações automáticas. Para tipos comerciais/relacionais (sdr, closer, custom, support) es OBRIGATÓRIO preencher persona e tics adaptados ao ICP/producto. Para admin/orchestrator/financial puede vir vacío (papel interno/técnico).",
                     properties: {
                       persona: {
                         type: "object",
                         description: "Persona humana adaptada ao ICP do producto. Backstory em 1ª pessoa, sin clichés de marketing.",
                         properties: {
                           age: { type: "number", description: "Idade entre 25 e 45" },
                           city: { type: "string", description: "'Cidade, UF' (ex: 'Son Paulo, SP')" },
                           backstory: { type: "string", description: "Backstory em 1ª pessoa, hasta 500 chars, conectada ao ICP/dor do producto" },
                           hobbies: { type: "array", items: { type: "string" }, description: "3 a 5 hobbies plausíveis" },
                           stories: {
                             type: "array",
                             description: "3 a 5 micro-histórias con title + description, ligadas a objeciones/dores reais do producto",
                             items: {
                               type: "object",
                               properties: {
                                 title: { type: "string" },
                                 description: { type: "string", description: "Frase real que o agente usaria, 1ª pessoa" },
                               },
                               required: ["title", "description"],
                             },
                           },
                           loved_words: { type: "array", items: { type: "string" }, description: "6 a 12 modismos/jargões do nicho que o agente usa naturalmente" },
                           forbidden_words: {
                             type: "array",
                             items: { type: "string" },
                             description: "6 a 12 clichés proibidos. SIEMPRE inclua: incrível, fantástico, maravilhoso, revolucionário, atenciosamente, prezado, estamos à disposición, agradecemos o contato, como podemos ajudar",
                           },
                         },
                       },
                       tics: {
                         type: "object",
                         description: "Maneirismos regionais sutis",
                         properties: {
                           region: { type: "string", enum: ["neutral", "paulista", "carioca", "nordestino", "sulista", "mineiro"] },
                           slang: { type: "array", items: { type: "string" }, description: "3 a 6 modismos regionais sutis" },
                           openers: { type: "array", items: { type: "string" }, description: "2 a 4 abridores curtos (ex: 'Opa', 'Eai')" },
                           connectors: { type: "array", items: { type: "string" }, description: "2 a 4 conectores (ex: 'entonces', 'aí')" },
                           fillers: { type: "array", items: { type: "string" }, description: "2 a 4 muletas curtas" },
                         },
                       },
                       reactions: {
                         type: "object",
                         description: "Reações automáticas a disparadores. Para SDR/Closer gere regras de keyword 'precio/valor' e 'quiero comprar' que transferem al agente certo (use a matriz de roteamento). Suporte: regra para 'urgente'. Admin: deixe vacío.",
                         properties: {
                           enabled: { type: "boolean" },
                           rules: {
                             type: "array",
                             description: "3 a 6 regras customizadas por tipo de agente",
                             items: {
                               type: "object",
                               properties: {
                                 id: { type: "string", description: "slug corto, ex: 'r-preco'" },
                                 enabled: { type: "boolean" },
                                 label: { type: "string" },
                                 type: { type: "string", enum: ["keyword", "message_type", "inactive_hours"] },
                                 keywords: { type: "array", items: { type: "string" } },
                                 message_type: { type: "string" },
                                 hours: { type: "number" },
                                 match: { type: "string", enum: ["any", "all"] },
                                 action: { type: "string", enum: ["reply", "context"] },
                                 reply: { type: "string" },
                                 context: { type: "string" },
                               },
                               required: ["id", "enabled", "label", "type", "action"],
                             },
                           },
                         },
                       },
                     },
                   },
                 },
                 required: [
                   "name", "description", "primary_objective", "additional_prompt",
                   "can_do", "cannot_do", "handoff_triggers", "tone_style", "message_style",
                   ...(["sdr", "closer", "custom", "support"].includes(agent_type) ? ["humanization"] : []),
                 ],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "create_agent" } },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required. Please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    await recordLovableUsage(supabase, organizationId, 'content_generation', 'gpt-4o-mini', data?.usage, 'generate-agent-ai');
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (toolCall?.function?.arguments) {
      const result = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify({ agent: result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Failed to generate agent");
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

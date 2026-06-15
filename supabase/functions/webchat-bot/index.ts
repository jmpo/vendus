import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { matchAgentByMessage, type MatcherChannel } from "../_shared/agent-matcher.ts";
import { parseHandoffTag, handoffTargetToAgentRole } from "../_shared/handoff-parser.ts";
import { runOrchestrator, type Intent } from "../_shared/orchestrator.ts";
import {
  formatMenuMessage,
  matchMenuOption,
  sanitizeMenuOptions,
  getInvalidMessage,
  type QuickMenuOption,
} from "../_shared/quick-menu.ts";
import {
  listTools as listRegistryTools,
  toolsToOpenAISchema as registryToolsToSchema,
  executeTool as executeRegistryTool,
  getTool as getRegistryTool,
} from "../_shared/tools/registry.ts";
import { resolveAIConfig, logAIConfig, prepareAIRequestBody, recordAIUsage, type ResolvedAIConfig } from "../_shared/ai-router.ts";
import { humanize, buildHumanizationPromptBlock, detectReaction, type HumanizationConfig, type HumanizationChannel, type ReactionsConfig } from "../_shared/humanizer.ts";
import { extractFirstName, safeFirstName } from "../_shared/name-utils.ts";

// Map orchestrator intent → preferred specialist agent_type(s) (in order of preference)
function mapIntentToRoles(intent: Intent): string[] {
  switch (intent) {
    case 'compra': return ['closer', 'sdr'];
    case 'informacao': return ['sdr', 'closer'];
    case 'suporte': return ['support'];
    case 'financiero': return ['financial'];
    case 'humano': return [];
    case 'indefinida':
    default: return ['sdr', 'closer'];
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Handoff helpers ────────────────────────────────────────────────────────
const DEFAULT_HANDOFF_OUTGOING =
  'Beleza, {{nombre}}! Vou te passar pra {{proximo_agente}}, que segue de aquí contigo. Ya te chama em instantes.';

const KNOWN_PLACEHOLDERS = new Set([
  'nombre', 'producto', 'agente_anterior', 'agent_name', 'resumen', 'proximo_agente',
]);

function renderHandoffTpl(tpl: string, vars: Record<string, string>): string {
  return tpl
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => vars[k] ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Remove placeholders {{xxx}} que o modelo escreveu mas que ninguém vai
 * renderizar (ex: {{checkout_link}}). Mantém solo variáveis conhecidas.
 * Se uma linha ficar vazia/só con placeholder, ela es removida.
 */
function stripUnrenderedPlaceholders(text: string): string {
  if (!text || !text.includes('{{')) return text;
  let removed = 0;
  const cleaned = text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => {
    if (KNOWN_PLACEHOLDERS.has(k)) return m;
    removed++;
    return '';
  });
  // Drop linhas que ficaram só con pontuação/espaço
  const lines = cleaned.split('\n').filter((ln) => ln.replace(/[\s\.,;:!?\-—_]/g, '').length > 0);
  if (removed > 0) {
    console.log('[webchat-bot] ⚠️ stripped unrendered placeholders, count=', removed);
  }
  return lines.join('\n').trim();
}

/**
 * Detecta tags falsas de transferência que o modelo às vezes inventa
 * (ex: "[TRANSFER]", "[TRANSFERIR]", "[HANDOFF]" sin :role, "[PASSAR]").
 * Retorna { cleaned, fakeFound }.
 */
const VALID_HANDOFF_ROLES = ['sdr', 'closer', 'support', 'financial', 'humano', 'human'];
function stripFakeHandoffTags(text: string): { cleaned: string; fakeFound: boolean } {
  if (!text) return { cleaned: text, fakeFound: false };
  let fakeFound = false;
  const fakeRe = /\[\s*(?:transfer(?:ir)?|hand[\s_-]*off|passar(?:\s+para[^\]]*)?|enviar\s+para[^\]]*|transferir\s+para[^\]]*)\s*\]/gi;
  const invalidRoleRe = /\[\s*handoff\s*:\s*([a-z_]+)\s*\]/gi;
  let cleaned = text.replace(fakeRe, () => { fakeFound = true; return ''; });
  cleaned = cleaned.replace(invalidRoleRe, (m, role: string) => {
    if (VALID_HANDOFF_ROLES.includes(role.toLowerCase())) return m;
    fakeFound = true;
    return '';
  });
  // Remove "entregáveis" inventados em colchetes (ex: "[Depoimento: https://...]",
  // "[Vídeo aqui]", "[Link]", "[Material]"). Se o agente quiser enviar mídia,
  // tiene que usar send_catalog_item / send_video — no escrever placeholders.
  const fakeAssetRe = /\[\s*(?:depoimento|case|v[ií]deo|pdf|ficha|folder|material|link|prova[\s_-]*social|brochura)\b[^\]]*\]/gi;
  cleaned = cleaned.replace(fakeAssetRe, () => { fakeFound = true; return ''; });
  cleaned = cleaned.split('\n').filter((ln) => ln.replace(/[\s\.,;:!?\-—_]/g, '').length > 0).join('\n').trim();
  return { cleaned, fakeFound };
}

// ============================================================
// In-memory state for orchestrator TEST mode (AgentEditor → Testar).
// Keyed by the synthetic conversation_id sent by the test client.
// Each entry has its own state machine (idle → aguardando_menu →
// em_atendimento|humano). Auto-expires after TEST_STATE_TTL_MS.
// Lives only inside this isolate; perfectly fine for interactive testing.
// ============================================================
type OrchestratorTestState = {
  state: 'idle' | 'aguardando_menu' | 'em_atendimento' | 'humano';
  questionCount: number;
  context: string;
  routedAgentId: string | null;
  routedAgentName: string | null;
  updatedAt: number;
};
const TEST_STATE_TTL_MS = 30 * 60 * 1000; // 30 min
const orchestratorTestStates = new Map<string, OrchestratorTestState>();

function getTestState(key: string): OrchestratorTestState {
  // Lazy GC: prune anything older than TTL on access.
  const now = Date.now();
  for (const [k, v] of orchestratorTestStates) {
    if (now - v.updatedAt > TEST_STATE_TTL_MS) orchestratorTestStates.delete(k);
  }
  let s = orchestratorTestStates.get(key);
  if (!s) {
    s = {
      state: 'idle',
      questionCount: 0,
      context: '',
      routedAgentId: null,
      routedAgentName: null,
      updatedAt: now,
    };
    orchestratorTestStates.set(key, s);
  }
  return s;
}

function saveTestState(key: string, patch: Partial<OrchestratorTestState>) {
  const cur = getTestState(key);
  Object.assign(cur, patch, { updatedAt: Date.now() });
}

interface BotRequest {
  conversation_id: string;
  message: string;
  product_id?: string;
  channel?: string;
  is_test?: boolean;
  /**
   * When set, signals a special test flow:
   *   'orchestrator' — run welcome+menu+routing using in-memory state
   *                    (no DB writes), so admins can test the orchestrator
   *                    agent end-to-end from the AgentEditor "Testar" tab.
   */
  test_mode?: 'orchestrator';
  visitor_name?: string;
  agent_id?: string;  // Specific agent to use
  // Flow execution fields
  flow_context?: {
    current_flow_id: string | null;
    current_block_id: string | null;
    flow_variables: Record<string, string>;
    flow_completed: boolean;
  };
  agent_config: {
    agent_name: string;
    system_prompt: string;
    sales_prompt?: string;
    knowledge_base: string | null;
    faq: Array<{ question: string; answer: string }>;
    fallback_message: string;
    temperature?: number;
    max_tokens?: number;
    persona_style?: string;
    use_product_brain?: boolean;
    chunked_messages_enabled?: boolean;
    typing_delay_ms?: number;
    max_message_length?: number;
  };
}

// Product Agent interface
interface ProductAgent {
  id: string;
  name: string;
  agent_type: string;
  primary_objective: string;
  can_do: string[];
  cannot_do: string[];
  handoff_triggers: string[];
  tone_style: string;
  message_style: string;
  always_end_with_question: boolean;
  additional_prompt: string | null;
  required_phrases: string[];
  prohibited_phrases: string[];
  is_active: boolean;
  is_default: boolean;
  // Tool permissions
  can_update_pipeline: boolean;
  can_create_tasks: boolean;
  can_schedule_meetings: boolean;
  can_apply_tags: boolean;
  can_update_lead: boolean;
  can_send_emails: boolean;
  can_send_materials: boolean;
  can_trigger_flows: boolean;
  can_transfer: boolean;
  can_notify: boolean;
  can_add_notes: boolean;
  can_start_cadence: boolean;
  can_qualify: boolean;
  tool_configs: Record<string, any>;
  // Optional fields used for routing/persona heuristics
  product_id?: string | null;
  personality?: string | null;
  organization_id?: string | null;
}

interface KnowledgeSource {
  source_type: string;
  title: string;
  extracted_content: string | null;
  transcript: string | null;
  question: string | null;
  answer: string | null;
}

interface Product {
  name: string;
  description: string | null;
  pitch_15s: string | null;
  pitch_30s: string | null;
  pitch_2min: string | null;
  icp: string | null;
  differentials: string[] | null;
}

interface Objection {
  what_they_say: string;
  suggested_response: string;
}

interface TrainingMaterial {
  title: string;
  category: string;
  extracted_content: string | null;
}

interface ProductCTA {
  id: string;
  cta_type: string;
  label: string;
  action_url: string | null;
  whatsapp_number: string | null;
  whatsapp_message: string | null;
  video_url: string | null;
  intent_level: string;
  trigger_keywords: string[] | null;
}

interface ChatButton {
  id: string;
  label: string;
  type: 'url' | 'whatsapp' | 'callback' | 'calendar' | 'video' | 'flow_button';
  action: string;
  style: 'primary' | 'secondary' | 'outline';
  cta_type: string;
}

// Flow Block Types
type ButtonActionType = 'next_block' | 'url' | 'whatsapp' | 'handoff' | 'ai_takeover';

interface FlowBlockButton {
  id: string;
  label: string;
  emoji?: string;
  action_type: ButtonActionType;
  next_block_id: string | null;
  url?: string;
  open_in_new_tab?: boolean;
  whatsapp_number?: string;
  whatsapp_message?: string;
  ai_context?: string;
}

interface FlowBlock {
  id: string;
  type: 'message' | 'input' | 'buttons' | 'ai_takeover' | 'handoff' | 'tag' | 'video' | 'delay' | 'agent_switch';
  position: { x: number; y: number };
  data: {
    content?: string;
    delay_ms?: number;
    input_type?: string;
    variable_name?: string;
    placeholder?: string;
    validation?: string;
    error_message?: string;
    buttons?: FlowBlockButton[];
    buttons_layout?: string;
    ai_context_prompt?: string;
    transfer_variables?: boolean;
    handoff_message?: string;
    handoff_target?: string;
    handoff_user_id?: string;
    handoff_squad_id?: string;
    tag_name?: string;
    tag_value?: string;
    video_url?: string;
    video_title?: string;
    delay_seconds?: number;
    agent_id?: string;  // For agent_switch and ai_takeover blocks
    // Override permissions (for ai_takeover)
    override_can_do?: string[];
    override_cannot_do?: string[];
    override_handoff_triggers?: string[];
    // Auto-switch configuration (for ai_takeover)
    auto_switch_enabled?: boolean;
    auto_switch_agents?: Array<{
      agent_id: string;
      trigger_condition: string;
    }>;
  };
  next_block_id?: string | null;
}

interface ChatFlow {
  id: string;
  blocks: FlowBlock[];
  start_block_id: string | null;
  collected_variables: Array<{ name: string; type: string; label: string }>;
}

// Agent type labels
const AGENT_TYPE_LABELS: Record<string, string> = {
  sdr: 'SDR (Qualificação)',
  closer: 'Closer (Fechamento)',
  support: 'Suporte',
  financial: 'Financeiro',
  admin: 'Administrativo',
  custom: 'Personalizado',
};

// Default super sales prompt - Vendedor Consultivo Estratégico
const DEFAULT_SALES_PROMPT = `Vos sos um VENDEDOR CONSULTIVO ESTRATÉGICO de alta performance. Su missão es VENDER a través de CONEXÃO GENUÍNA e DIAGNÓSTICO REAL, no solo informar.

═══════════════════════════════════════
REGLAS CRÍTICAS ANTI-REPETICIÓN
═══════════════════════════════════════

ANTES de responder, ANALIZÁ TODO el historial de la conversación y seguí estas reglas:

1. NUNCA repitas el mismo saludo, frase de apertura o cierre ya usado en el historial
2. NUNCA uses el mismo emoji en 2 mensajes consecutivos (máximo 1 emoji por mensaje)
3. Si ya agendaste reunión, NO ofrezcas agendar de nuevo
4. Si ya recolectaste email/teléfono, NO los pidas de nuevo
5. Si ya presentaste el producto, NO repitas la presentación — avanzá a la próxima etapa
6. Cadel mensaje DEBE hacer avanzar la conversación — nunca volver a un punto ya cubierto

FRASES ABSOLUTAMENTE PROHIBIDAS:
- "Todo bárbaro por acá"
- "Cerrar con broche de oro"
- "Quedo a disposición"
- "Sin problemas"
- "Quedate tranquilo"
- "Por supuesto"
- "¡Perfecto!"
- Cualquier frase que ya apareció en el historial de esta conversación

═══════════════════════════════════════
TÉCNICA DE VENTAS CONSULTIVAS (SPIN)
═══════════════════════════════════════

Seguí esta progresión natural (NO saltes etapas):

1. SITUACIÓN (1-2 msgs): Entendé el escenario actual del cliente
   - "¿Cómo funciona [proceso X] hoy en su operación?"
   - "¿Cuánto tiempo dedican a [actividad Y] por semana?"

2. PROBLEMA (1-2 msgs): Identificá el DOLOR real
   - "¿Y qué es lo que más te incomoda en ese proceso actual?"
   - "¿Cuál es el mayor cuello de botela que enfrentan con eso?"

3. IMPLICACIÓN (1 msg): Amplificá el dolor con consecuencias
   - "¿Y eso termina impactando [resultado Z] de qué forma?"
   - "¿Cuánto estiman que pierden por eso?"

4. NECESIDAD (1 msg): Hacé que el cliente verbalice la solución
   - "Si pudieras resolver eso, ¿cuál sería el escenario ideal?"
   - "¿Qué cambiaría en su operación si [problema] ya no existiera?"

5. SOLUCIÓN (1-2 msgs): Conectá el beneficio específico con el dolor identificado
   - No enumeres features — mostrá cómo resuelve el DOLOR específico que mencionó

6. ACCIÓN (1 msg): Conducí hacia el próximo paso concreto y específico

═══════════════════════════════════════
ESTILO DE COMUNICACIÓN
═══════════════════════════════════════

- Mensajes CORTOS: máximo 3-4 líneas por mensaje
- Enviá TODO en UN ÚNICO mensaje — NUNCA partas en múltiples párrafos separados por \\n\\n
- Si la respuesta queda larga, resumí y priorizá lo más importante en un único bloque
- SIEMPRE terminá con UNA pregunta que avance la venta
- Usá el NOMBRE del cliente cuando lo sepas (pero no en cadel mensaje)
- Hablá como humano — lenguaje natural del día a día
- Sé específico: números, ejemplos reales, datos concretos
- NUNCA hagas más de 1 pregunta por mensaje
- Variá la estructura: alterná preguntas directas, observaciones y provocaciones
- Adaptá el tono al humor del cliente (si es directo, sé directo; si es detallista, dale detalles)

═══════════════════════════════════════
LO QUE NUNCA DEBÉS HACER
═══════════════════════════════════════

- Respuestas largas (más de 2 líneas en un único bloque)
- Mensajes con más de 150 caracteres sin salto de párrafo
- Listar features sin conectar a beneficio/dolor
- Responder sin hacer pregunta de retorno
- Parecer genérico o robotizado
- Dar toda la información de una vez — dale de a poco, una cosa por mensaje
- Repetir cualquier elemento del historial (saludos, emojis, frases)
- Usar más de 1 emoji por mensaje
- Ignorar lo que ya fue discutido/acordado en la conversación`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: BotRequest = await req.json();
    
    console.log('[webchat-bot] Request received for conversation:', body.conversation_id);
    console.log('[webchat-bot] Message:', body.message?.substring(0, 100));
    console.log('[webchat-bot] Visitor name:', body.visitor_name);
    console.log('[webchat-bot] Flow context:', body.flow_context);

    // Required: conversation_id + message. Agent is optional here because the
    // orchestrator may take over and resolve the specialist agent downstream.
    if (!body.conversation_id || !body.message) {
      console.error('[webchat-bot] Missing required fields (conversation_id/message)');
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============================================================
    // 🔒 HUMAN TAKEOVER GUARD (CRITICAL)
    // If a human seller has taken over this conversation, the AI must NOT
    // respond — not even with a fallback. Any reply here would "talk over"
    // the seller and confuse the customer (e.g., "Desculpe, no entendi"
    // sent right after the seller's message).
    // The whatsapp-webhook does this check too (defense-in-depth), but
    // webchat-bot is also called by other entrypoints (Inbox revival,
    // simulator, social channels), so we MUST guard here as well.
    // ============================================================
    try {
      const { data: convStatus } = await supabase
        .from('webchat_conversations')
        .select('status')
        .eq('id', body.conversation_id)
        .maybeSingle();
      if (convStatus?.status === 'human_active' || convStatus?.status === 'waiting_human') {
        console.log('[webchat-bot] 🔒 Conversation is with human (' + convStatus.status + '), skipping AI');
        return new Response(
          JSON.stringify({ ok: true, skipped: true, reason: 'human_active' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (e) {
      console.warn('[webchat-bot] human takeover precheck failed (non-fatal):', e);
    }

    // If no agent_config was passed, create a minimal default. The actual
    // specialist agent (if any) will be resolved later by orchestrator /
    // keyword matcher / instance-bound fallback / product default agent.
    if (!body.agent_config) {
      body.agent_config = {
        agent_name: 'Assistente',
        system_prompt: '',
        knowledge_base: null,
        faq: [],
        fallback_message: 'Vou pedir para um agente humano continuar o su atención, só um instante. 🙋',
        use_product_brain: true,
      };
    }

    // ============================================================
    // ORCHESTRATOR TEST MODE
    // When the AgentEditor "Testar" tab is testing an Orchestrator-style
    // agent, run a self-contained simulation of welcome → menu → routing
    // using in-memory state. No DB writes, no specialist execution —
    // the goal is to let admins validate the orchestrator's UX exactly
    // as the lead would experience it.
    // ============================================================
    if (body.is_test === true && body.test_mode === 'orchestrator' && body.agent_id) {
      try {
        const { data: orchAgent } = await supabase
          .from('product_agents')
          .select('id, name, agent_type, organization_id, welcome_enabled, welcome_message, quick_menu_mode, quick_menu_intro, quick_menu_options, quick_menu_invalid_message')
          .eq('id', body.agent_id)
          .maybeSingle();

        if (!orchAgent) {
          return new Response(
            JSON.stringify({
              message: { content: '⚠️ Agente no encontrado para la prueba.', message_type: 'text' },
              response: '⚠️ Agente no encontrado para la prueba.',
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const menuOptions: QuickMenuOption[] = sanitizeMenuOptions((orchAgent as any).quick_menu_options);
        const menuMode = (orchAgent as any).quick_menu_mode || 'off';
        const greetingEnabled = !!(orchAgent as any).welcome_enabled;
        const greetingText: string = ((orchAgent as any).welcome_message || '').trim();

        const stateKey = body.conversation_id;
        const ts = getTestState(stateKey);

        // Resolve {{vars}} for greeting
        let orgName = '';
        if ((orchAgent as any).organization_id) {
          const { data: orgRow } = await supabase
            .from('organizations')
            .select('name')
            .eq('id', (orchAgent as any).organization_id)
            .maybeSingle();
          orgName = orgRow?.name || '';
        }
        const safeNameForMenu = safeFirstName(body.visitor_name);
        const renderVars = (s: string) =>
          s
            .replaceAll('{{nombre}}', safeNameForMenu)
            .replaceAll('{{visitor_name}}', safeNameForMenu)
            .replaceAll('{{agent_name}}', (orchAgent as any).name || '')
            .replaceAll('{{organization_name}}', orgName);

        // CASE A — Lead is replying to a quick menu we previously sent
        if (ts.state === 'aguardando_menu' && menuOptions.length > 0) {
          const match = matchMenuOption(body.message, menuOptions);
          if (!match) {
            const invalidMsg = getInvalidMessage((orchAgent as any).quick_menu_invalid_message);
            const menuMsg = formatMenuMessage((orchAgent as any).quick_menu_intro, menuOptions);
            return new Response(
              JSON.stringify({
                message: { content: `${invalidMsg}\n\n${menuMsg}`, message_type: 'text' },
                response: `${invalidMsg}\n\n${menuMsg}`,
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          const opt = match.option;
          if (opt.action === 'transfer_to_human') {
            saveTestState(stateKey, { state: 'humano', context: `Menu: ${opt.label}` });
            const msg = `[Prueba] 👤 Encaminhando para um agente humano (opción: ${opt.label}).`;
            return new Response(
              JSON.stringify({
                message: { content: msg, message_type: 'text' },
                response: msg,
                test_routing: { action: 'transfer_to_human', label: opt.label },
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          if (opt.action === 'transfer_to_agent' && opt.target_agent_id) {
            const { data: targetAgent } = await supabase
              .from('product_agents')
              .select('id, name, agent_type')
              .eq('id', opt.target_agent_id)
              .maybeSingle();

            if (!targetAgent) {
              const msg = '[Prueba] ⚠️ Agente alvo configurado no menu no existe ou fue desativado.';
              return new Response(
                JSON.stringify({
                  message: { content: msg, message_type: 'text' },
                  response: msg,
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }

            saveTestState(stateKey, {
              state: 'em_atendimento',
              context: `Menu: ${opt.label}`,
              routedAgentId: (targetAgent as any).id,
              routedAgentName: (targetAgent as any).name,
            });
            const msg = `[Prueba] 🎯 Ruteo completado a **${(targetAgent as any).name}** (opción: ${opt.label}).\n\nEn producción, desde aquí el lead conversaría directamente con este agente.`;
            return new Response(
              JSON.stringify({
                message: { content: msg, message_type: 'text' },
                response: msg,
                test_routing: {
                  action: 'transfer_to_agent',
                  label: opt.label,
                  target_agent_id: (targetAgent as any).id,
                  target_agent_name: (targetAgent as any).name,
                },
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          if (opt.action === 'start_flow') {
            saveTestState(stateKey, { state: 'em_atendimento', context: `Menu: ${opt.label}` });
            const msg = `[Prueba] ▶️ Iniciaría el flujo configurado para la opción "${opt.label}".`;
            return new Response(
              JSON.stringify({
                message: { content: msg, message_type: 'text' },
                response: msg,
                test_routing: { action: 'start_flow', label: opt.label, target_flow_id: opt.target_flow_id },
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }

        // CASE B — Already routed in this test session
        if (ts.state === 'em_atendimento' && ts.routedAgentName) {
          const msg = `[Prueba] ✅ Lla conversación ya fue ruteada a **${ts.routedAgentName}** en esta sesión de prueba.\n\nHacé clic en "Limpiar" para reiniciar el flujo del orquestador.`;
          return new Response(
            JSON.stringify({
              message: { content: msg, message_type: 'text' },
              response: msg,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (ts.state === 'humano') {
          const msg = `[Prueba] ✅ La conversación ya fue derivada a humano en esta sesión de prueba.\n\nHacé clic en "Limpiar" para reiniciar.`;
          return new Response(
            JSON.stringify({
              message: { content: msg, message_type: 'text' },
              response: msg,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // CASE C — First message: send greeting + (maybe) menu
        const showMenu = menuMode === 'always' && menuOptions.length > 0;
        const greeting = greetingEnabled ? renderVars(greetingText) : '';
        const menuMsg = showMenu
          ? formatMenuMessage((orchAgent as any).quick_menu_intro, menuOptions)
          : '';
        const fullMsg = [greeting.trim(), menuMsg.trim()].filter(Boolean).join('\n\n');

        if (fullMsg) {
          saveTestState(stateKey, {
            state: showMenu ? 'aguardando_menu' : 'em_atendimento',
            questionCount: 0,
            context: '',
          });
          return new Response(
            JSON.stringify({
              message: { content: fullMsg, message_type: 'text' },
              response: fullMsg,
              test_state: showMenu ? 'aguardando_menu' : 'em_atendimento',
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // No greeting and no menu configured → tell admin to configure something
        const msg =
          '[Prueba] ℹ️ Este agente Orquestrador no tiene mensaje de boas-vindas nem menu rápido configurado.\n\n' +
          'Configure por el menos um de ellos nas abas **Boas-vindas** ou **Roteamento** para testar el flujo.';
        return new Response(
          JSON.stringify({
            message: { content: msg, message_type: 'text' },
            response: msg,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (testErr) {
        console.error('[webchat-bot] orchestrator test mode error:', testErr);
        return new Response(
          JSON.stringify({
            message: {
              content: '⚠️ Error ao executar prueba del orquestador. Veja os logs.',
              message_type: 'text',
            },
            response: '⚠️ Error ao executar prueba del orquestador.',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Check if we're in flow execution mode (flow active and not completed)
    const flowContext = body.flow_context;
    if (flowContext && flowContext.current_flow_id && flowContext.current_block_id && !flowContext.flow_completed) {
      console.log('[webchat-bot] Executing flow block:', flowContext.current_block_id);
      
      const flowResult = await executeFlowBlock(
        supabase,
        body.conversation_id,
        body.message,
        flowContext,
        body.product_id
      );
      
      return new Response(
        JSON.stringify(flowResult),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const { data: messages } = await supabase
      .from('webchat_messages')
      .select('*')
      .eq('conversation_id', body.conversation_id)
      .order('created_at', { ascending: true })
      .limit(80);

    const conversationHistory = (messages || []).map(msg => {
      const base = {
        role: msg.direction === 'inbound' ? 'user' : 'assistant',
        content: msg.content,
      };
      // Enrich with scheduling context if available
      const metadata = msg.metadata as any;
      if (metadata?.scheduling_context?.action === 'slots_offered') {
        const slots = metadata.scheduling_context.suggestions;
        base.content += `\n[CONTEXTO INTERNO - NÃO REPITA ISSO AO CLIENTE: Horários ya ofrecidos: ${
          slots.map((s: any) => `${s.date} ${s.time}`).join(', ')
        }. event_type_id: ${metadata.scheduling_context.event_type_id}, schedule_user_id: ${metadata.scheduling_context.schedule_user_id}. Se o cliente confirmar um horario, use schedule_meeting IMEDIATAMENTE. NÃO chame check_available_slots novamente.]`;
      }
      return base;
    });

    // Fetch product CTAs if product_id is available
    let productCTAs: ProductCTA[] = [];
    if (body.product_id) {
      const { data: ctas } = await supabase
        .from('product_ctas')
        .select('*')
        .eq('product_id', body.product_id)
        .eq('is_active', true)
        .order('display_order', { ascending: true });
      
      productCTAs = ctas || [];
      console.log('[webchat-bot] Found CTAs:', productCTAs.length);
    }

    // Fetch product agent if available
    let activeAgent: ProductAgent | null = null;
    let keywordMatchInfo: { matched_term: string; match_type: string; takeover: boolean; from_agent_id: string | null } | null = null;
    let orchestratorEarlyResponse: { content: string; needsHuman: boolean } | null = null;

    // === STEP -2: Manual Admin takeover guard (highest priority) ===
    // If a gestor manually transferred this conversation to an Admin agent (e.g., Malu),
    // we MUST short-circuit orchestrator + keyword matcher + instance-bound resolution
    // and run with the admin agent. This protects intentional human intervention.
    let adminTakeoverActive = false;
    if (body.conversation_id) {
      try {
        // Check 1: explicit body.agent_id pointing to an admin agent
        if (body.agent_id) {
          const { data: explicitAdmin } = await supabase
            .from('product_agents')
            .select('*')
            .eq('id', body.agent_id)
            .eq('agent_type', 'admin')
            .eq('is_active', true)
            .maybeSingle();
          if (explicitAdmin) {
            activeAgent = explicitAdmin as ProductAgent;
            adminTakeoverActive = true;
            if (explicitAdmin.product_id && !body.product_id) {
              body.product_id = explicitAdmin.product_id;
            }
            console.log('[webchat-bot] 🔒 Admin takeover (explicit agent_id):', explicitAdmin.name);
          }
        }

        // Check 2: conversation.current_agent_id pointing to admin (no explicit agent_id)
        if (!adminTakeoverActive && !body.agent_id) {
          const { data: convAdmin } = await supabase
            .from('webchat_conversations')
            .select('current_agent_id, product_agents:current_agent_id(*)')
            .eq('id', body.conversation_id)
            .maybeSingle();
          const candidate = (convAdmin as any)?.product_agents;
          if (candidate?.agent_type === 'admin' && candidate?.is_active) {
            activeAgent = candidate as ProductAgent;
            adminTakeoverActive = true;
            if (candidate.product_id && !body.product_id) {
              body.product_id = candidate.product_id;
            }
            console.log('[webchat-bot] 🔒 Admin takeover detected (current_agent_id):', candidate.name);
          }
        }
      } catch (e) {
        console.warn('[webchat-bot] admin takeover check failed (non-fatal):', e);
      }
    }

    // === STEP -2.5: Delegate to admin-agent-handle-inbound when admin takeover is active ===
    // The admin agent has a dedicated kernel (EXECUTIVE_KERNEL) and read-only tools.
    // Running it through the generic webchat-bot pipeline produces "Desculpe, no entendi".
    if (adminTakeoverActive && activeAgent && body.conversation_id) {
      try {
        const { data: convForAdmin } = await supabase
          .from('webchat_conversations')
          .select('organization_id, channel, visitor_phone, evolution_instance_id, lead_id')
          .eq('id', body.conversation_id)
          .maybeSingle();

        if (convForAdmin?.organization_id) {
          console.log('[webchat-bot] 🎯 Delegating to admin-agent-handle-inbound', {
            agent: activeAgent.name,
            agent_id: activeAgent.id,
            conv: body.conversation_id,
            channel: convForAdmin.channel,
            phone: convForAdmin.visitor_phone,
            has_product_id: !!body.product_id,
          });

          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const adminRes = await fetch(`${supabaseUrl}/functions/v1/admin-agent-handle-inbound`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              organization_id: convForAdmin.organization_id,
              message: body.message,
              phone: convForAdmin.visitor_phone || null,
              agent_id: activeAgent.id,
              instance_id: convForAdmin.evolution_instance_id || null,
              conversation_id: body.conversation_id,
              skip_send: true,
            }),
          });

          const adminJson = await adminRes.json().catch(() => ({} as any));
          console.log('[webchat-bot] ← admin-agent-handle-inbound response', {
            status: adminRes.status,
            ok: adminRes.ok,
            has_reply: !!adminJson?.reply,
            handoff: adminJson?.handoff || null,
          });

          const replyText = (adminJson?.reply as string) || 'Sem respuesta.';
          const handoffInfo = adminJson?.handoff || null;

          // Persist outbound reply in webchat_messages so the Inbox UI shows it.
          // If a handoff happened, mark it on the metadata so downstream reads
          // know the next inbound will go to a different agent.
          try {
            await supabase.from('webchat_messages').insert({
              conversation_id: body.conversation_id,
              direction: 'outbound',
              content: replyText,
              metadata: {
                admin_takeover: true,
                agent_id: activeAgent.id,
                agent_name: activeAgent.name,
                ...(handoffInfo ? { handoff: handoffInfo } : {}),
              },
            });
          } catch (persistErr) {
            console.warn('[webchat-bot] failed to persist admin outbound (non-fatal):', persistErr);
          }

          // Return in a shape that evolution-webhook understands (chunks) AND
          // that webchat clients understand (response/message.content).
          return new Response(
            JSON.stringify({
              response: replyText,
              chunks: [replyText],
              message: { content: replyText, role: 'assistant' },
              admin_takeover: true,
              agent_id: activeAgent.id,
              agent_name: activeAgent.name,
              handoff: handoffInfo,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } else {
          console.warn('[webchat-bot] admin delegation skipped: no organization_id on conversation', {
            conv: body.conversation_id,
          });
        }
      } catch (delegateErr) {
        console.error('[webchat-bot] admin delegation FAILED with exception:', delegateErr);
        // Even on failure, do NOT fall through into the sales pipeline (scheduling,
        // pipeline movement, etc) — those tools must NEVER respond to an admin
        // takeover conversation. Return a safe placeholder instead.
        const fallback = 'Tive um problema técnico ao acceder os dados. Tente novamente.';
        return new Response(
          JSON.stringify({
            response: fallback,
            chunks: [fallback],
            message: { content: fallback, role: 'assistant' },
            admin_takeover: true,
            error: 'admin_delegation_failed',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // === STEP -1: Orchestrator triage (runs FIRST when enabled) ===
    // The orchestrator classifies product+intent and routes to a specialist.
    // Only runs when org has orchestration enabled AND conversation is in 'triagem' state (or null).
    try {
      const { data: convInit } = await supabase
        .from('webchat_conversations')
        .select('id, organization_id, channel, visitor_phone, lead_id, current_agent_id, orchestrator_state, orchestrator_context, orchestrator_question_count')
        .eq('id', body.conversation_id)
        .maybeSingle();

      if (convInit?.organization_id) {
        const { data: orchConfig } = await supabase
          .from('organization_orchestrator_config')
          .select('*')
          .eq('organization_id', convInit.organization_id)
          .maybeSingle();

        const orchEnabled = orchConfig?.is_enabled === true && !!orchConfig?.orchestrator_agent_id;
        let currentState = convInit.orchestrator_state || null;
        let inTriage = currentState === null || currentState === 'triagem';

        // === Auto-reset: returning lead after long silence ===
        // If the conversation hasn't received an outbound message in a long time
        // (>6h) OR the conversation was previously closed, treat as a fresh start
        // so the orchestrator's welcome message + quick menu fire again.
        // This guarantees: every NEW or REOPENED conversation passes through
        // the orchestrator's greeting flow before any specialist agent answers.
        if (orchEnabled && !body.agent_id && !adminTakeoverActive) {
          try {
            const { data: lastOutbound } = await supabase
              .from('webchat_messages')
              .select('created_at')
              .eq('conversation_id', body.conversation_id)
              .eq('direction', 'outbound')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
            const lastOutboundAt = lastOutbound?.created_at ? new Date(lastOutbound.created_at).getTime() : 0;
            const silenceTooLong = lastOutboundAt > 0 && (Date.now() - lastOutboundAt) > SIX_HOURS_MS;

            // If the orchestrator state is "stuck" (e.g., triagem/em_atendimento) but
            // no outbound was ever sent, it means the welcome flow was missed
            // (e.g., a previous deploy / failure). Force-reset so the welcome fires now.
            const noOutboundEver = !lastOutbound;
            const stateLooksStuck =
              currentState !== null && currentState !== 'aguardando_menu' && noOutboundEver;

            if (silenceTooLong || stateLooksStuck) {
              await supabase
                .from('webchat_conversations')
                .update({
                  orchestrator_state: null,
                  orchestrator_context: null,
                  orchestrator_question_count: 0,
                  current_agent_id: null,
                })
                .eq('id', body.conversation_id);
              currentState = null;
              inTriage = true;
              console.log('[webchat-bot] 🧭 Orchestrator state reset', {
                reason: silenceTooLong ? 'silence>6h' : 'stuck_state_no_outbound',
                previous_state: convInit.orchestrator_state,
              });
            }
          } catch (resetErr) {
            console.warn('[webchat-bot] orchestrator reset check failed (non-fatal):', resetErr);
          }
        }

        // === Pre-step: Welcome message + Quick menu ===
        // The orchestrator agent can greet the lead and offer a quick numeric menu
        // before any AI classification runs. Configured per-agent in the admin.
        if (orchEnabled && !body.agent_id && !adminTakeoverActive) {
          try {
            const { data: orchAgentFull } = await supabase
              .from('product_agents')
              .select('id, name, welcome_enabled, welcome_message, quick_menu_mode, quick_menu_intro, quick_menu_options, quick_menu_invalid_message')
              .eq('id', orchConfig.orchestrator_agent_id)
              .maybeSingle();

            const menuOptions: QuickMenuOption[] = sanitizeMenuOptions((orchAgentFull as any)?.quick_menu_options);
            const menuMode = (orchAgentFull as any)?.quick_menu_mode || 'off';
            const greetingEnabled = !!(orchAgentFull as any)?.welcome_enabled;
            const greetingText: string = ((orchAgentFull as any)?.welcome_message || '').trim();

            // CASE A — User is replying to a quick menu we previously sent.
            if (currentState === 'aguardando_menu' && menuOptions.length > 0) {
              const match = matchMenuOption(body.message, menuOptions);
              if (!match) {
                // Count previous invalid attempts (outbound msgs since the menu was sent
                // that contained the invalid-input marker). If >= 2, fall through to free
                // triage so we don't loop forever asking for a number.
                const prevInvalid = convInit.orchestrator_question_count || 0;
                if (prevInvalid >= 2) {
                  // Reset state → let the orchestrator triage / specialist agent answer naturally.
                  await supabase
                    .from('webchat_conversations')
                    .update({
                      orchestrator_state: null,
                      orchestrator_question_count: 0,
                      orchestrator_context: 'menu_bypassed_after_invalid_attempts',
                    })
                    .eq('id', body.conversation_id);
                  currentState = null;
                  inTriage = true;
                  console.log('[webchat-bot] 🧭 Menu bypassed after 2 invalid attempts → free triage');
                  // Do NOT set orchestratorEarlyResponse → pipeline continues to AI triage.
                } else {
                  // Still under threshold: re-send menu with invalid-input message
                  await supabase
                    .from('webchat_conversations')
                    .update({ orchestrator_question_count: prevInvalid + 1 })
                    .eq('id', body.conversation_id);
                  const invalidMsg = getInvalidMessage((orchAgentFull as any)?.quick_menu_invalid_message);
                  const menuMsg = formatMenuMessage((orchAgentFull as any)?.quick_menu_intro, menuOptions);
                  orchestratorEarlyResponse = {
                    content: `${invalidMsg}\n\n${menuMsg}`,
                    needsHuman: false,
                  };
                }
              } else {
                const opt = match.option;

                if (opt.action === 'transfer_to_human') {
                  await supabase
                    .from('webchat_conversations')
                    .update({
                      orchestrator_state: 'humano',
                      needs_human: true,
                      orchestrator_context: `Menu: ${opt.label}`,
                    })
                    .eq('id', body.conversation_id);
                  orchestratorEarlyResponse = {
                    content: 'Perfeito, vou te conectar con um dos nossos atendentes. Aguarde um instante.',
                    needsHuman: true,
                  };
                } else if (opt.action === 'transfer_to_agent' && opt.target_agent_id) {
                  const { data: targetAgent } = await supabase
                    .from('product_agents')
                    .select('*')
                    .eq('id', opt.target_agent_id)
                    .eq('is_active', true)
                    .maybeSingle();

                  if (targetAgent) {
                    activeAgent = targetAgent as any;
                    const targetProductId = (targetAgent as any).product_id || null;
                    if (targetProductId) body.product_id = targetProductId;
                    await supabase
                      .from('webchat_conversations')
                      .update({
                        orchestrator_state: 'em_atendimento',
                        current_agent_id: targetAgent.id,
                        product_id: targetProductId,
                        orchestrator_context: `Menu: ${opt.label}`,
                      })
                      .eq('id', body.conversation_id);
                    console.log('[webchat-bot] 🧭 Quick-menu match → routing to:', (targetAgent as any).name);
                    // Fall through: the rest of the pipeline will run with activeAgent set.
                    // Override the user message so the specialist sees the lead's intent
                    // (the original numeric "1" alone wouldn't make sense to the agent).
                    body.message = `[Menu: ${opt.label}] — ${body.message}`;
                  } else {
                    orchestratorEarlyResponse = {
                      content: 'Esse atención está temporariamente indisponible. Vou te conectar con um humano.',
                      needsHuman: true,
                    };
                    await supabase
                      .from('webchat_conversations')
                      .update({ orchestrator_state: 'humano', needs_human: true })
                      .eq('id', body.conversation_id);
                  }
                } else {
                  // Unknown / unsupported action → fallback to human
                  orchestratorEarlyResponse = {
                    content: 'Vou te conectar con um dos nossos atendentes.',
                    needsHuman: true,
                  };
                  await supabase
                    .from('webchat_conversations')
                    .update({ orchestrator_state: 'humano', needs_human: true })
                    .eq('id', body.conversation_id);
                }
              }
            }
            // CASE B — First message of conversation: send greeting (and menu if mode=always).
            // Fires whenever no outbound message was ever sent and the conversation is
            // not already in an active attendance / human / menu-awaiting state.
            // This is more robust than checking only `currentState === null`, because
            // a previous failed run may have set the state to 'triagem' without ever
            // sending the welcome message.
            else if (
              currentState !== 'aguardando_menu' &&
              currentState !== 'em_atendimento' &&
              currentState !== 'humano'
            ) {
              // Lock atômico: só dispara welcome se welcome_sent_at AINDA estiver NULL.
              // Isso evita que reentregas paralelas do webhook (Evolution Go retry) ou
              // múltiplas invocações concorrentes mandem o welcome mais de uma vez.
              const greetingWanted = greetingEnabled || (menuMode === 'always' && menuOptions.length > 0);
              let isFirstInteraction = false;
              if (greetingWanted) {
                const { data: lockRow } = await supabase
                  .from('webchat_conversations')
                  .update({ welcome_sent_at: new Date().toISOString() })
                  .eq('id', body.conversation_id)
                  .is('welcome_sent_at', null)
                  .select('id')
                  .maybeSingle();
                isFirstInteraction = !!lockRow?.id;
                if (!isFirstInteraction) {
                  console.log('[webchat-bot] 🧭 welcome skip: welcome_sent_at ya preenchido (lock)');
                }
              }

              if (isFirstInteraction && greetingWanted) {
                // Resolve {{variables}} in greeting
                const { data: orgRowG } = await supabase
                  .from('organizations')
                  .select('name')
                  .eq('id', convInit.organization_id)
                  .maybeSingle();
                let greeting = greetingEnabled ? greetingText : '';
                const safeWelcomeName = safeFirstName(body.visitor_name);
                greeting = greeting
                  .replaceAll('{{nombre}}', safeWelcomeName)
                  .replaceAll('{{visitor_name}}', safeWelcomeName)
                  .replaceAll('{{agent_name}}', (orchAgentFull as any)?.name || '')
                  .replaceAll('{{organization_name}}', orgRowG?.name || '');
                // Limpa saludo tipo "Oi , todo bien?" cuando nombre ficou vazio
                greeting = greeting.replace(/\s+,/g, ',').replace(/(Oi|Hola|Opa|E aí)\s+,/gi, '$1,');

                const showMenu = menuMode === 'always' && menuOptions.length > 0;
                const menuMsg = showMenu
                  ? formatMenuMessage((orchAgentFull as any)?.quick_menu_intro, menuOptions)
                  : '';

                const fullMsg = [greeting.trim(), menuMsg.trim()].filter(Boolean).join('\n\n');

                if (fullMsg) {
                  await supabase
                    .from('webchat_conversations')
                    .update({
                      orchestrator_state: showMenu ? 'aguardando_menu' : 'triagem',
                      // Clear any leaked specialist agent so the next turn flows
                      // through the orchestrator pipeline cleanly.
                      current_agent_id: null,
                      orchestrator_context: null,
                      orchestrator_question_count: 0,
                    })
                    .eq('id', body.conversation_id);

                  orchestratorEarlyResponse = {
                    content: fullMsg,
                    needsHuman: false,
                  };
                  console.log('[webchat-bot] 🧭 Greeting sent, state =', showMenu ? 'aguardando_menu' : 'triagem');
                }
              }
            }
          } catch (welcomeErr) {
            console.warn('[webchat-bot] welcome/menu pipeline error (non-fatal):', welcomeErr);
          }
        }

        // === STEP -1 (continued): Orchestrator AI triage ===
        // Skip if greeting/menu just produced an early response,
        // or if conversation is already in 'aguardando_menu' or 'em_atendimento'.
        if (orchEnabled && inTriage && !body.agent_id && !adminTakeoverActive && !orchestratorEarlyResponse && !activeAgent) {
          console.log('[webchat-bot] 🧭 Orchestrator enabled, running triage...');

          const { data: orgRow } = await supabase
            .from('organizations')
            .select('name')
            .eq('id', convInit.organization_id)
            .maybeSingle();

          const { data: orgProducts } = await supabase
            .from('products')
            .select('id, name, description')
            .eq('organization_id', convInit.organization_id)
            .eq('is_active', true)
            .limit(20);

          const { data: orchAgent } = await supabase
            .from('product_agents')
            .select('additional_prompt, quick_menu_mode, quick_menu_intro, quick_menu_options, quick_menu_invalid_message')
            .eq('id', orchConfig.orchestrator_agent_id)
            .maybeSingle();

          const result = await runOrchestrator({
            supabase,
            organizationId: convInit.organization_id,
            organizationName: orgRow?.name || 'a empresa',
            channel: convInit.channel || 'chat',
            channelIdentifier: convInit.visitor_phone || null,
            products: (orgProducts || []).map(p => ({ id: p.id, name: p.name, description: p.description })),
            orchestratorContext: convInit.orchestrator_context || '',
            questionCount: convInit.orchestrator_question_count || 0,
            maxTriageQuestions: orchConfig.max_triage_questions || 2,
            message: body.message,
            customPrompt: orchAgent?.additional_prompt || null,
          });

          console.log('[webchat-bot] 🧭 Orchestrator result:', JSON.stringify({
            intencao: result.intencao,
            produto_id: result.produto_id,
            confianca: result.confianca,
          }));

          // Persist orchestration log (best-effort)
          try {
            await supabase.from('orchestration_logs').insert({
              organization_id: convInit.organization_id,
              conversation_id: body.conversation_id,
              lead_id: convInit.lead_id || null,
              message: body.message,
              detected_intent: result.intencao,
              detected_product_id: result.produto_id,
              confidence: result.confianca,
              extracted_context: result.contexto_extraido,
              orchestrator_response: result.resposta_orquestrador || null,
            });
          } catch (logErr) {
            console.warn('[webchat-bot] orchestration_logs insert failed (non-fatal):', logErr);
          }

          const minConfidence = orchConfig.min_confidence ?? 0.6;
          const maxQuestions = orchConfig.max_triage_questions ?? 2;
          const questionCount = convInit.orchestrator_question_count || 0;

          // CASE 1: Lead asked for human OR too many failed triage questions → handoff
          if (result.intencao === 'humano' || (questionCount >= maxQuestions && result.confianca < minConfidence)) {
            await supabase
              .from('webchat_conversations')
              .update({
                orchestrator_state: 'humano',
                needs_human: true,
                detected_intent: result.intencao,
                orchestrator_context: result.contexto_extraido,
              })
              .eq('id', body.conversation_id);

            orchestratorEarlyResponse = {
              content: result.resposta_orquestrador || 'Vou te conectar con um dos nossos atendentes ahora.',
              needsHuman: true,
            };
          }
          // CASE 2: Low confidence and still has triage budget → ask clarifying question
          else if (result.confianca < minConfidence && result.resposta_orquestrador) {
            await supabase
              .from('webchat_conversations')
              .update({
                orchestrator_state: 'triagem',
                orchestrator_question_count: questionCount + 1,
                orchestrator_context: result.contexto_extraido,
                detected_intent: result.intencao,
              })
              .eq('id', body.conversation_id);

            orchestratorEarlyResponse = {
              content: result.resposta_orquestrador,
              needsHuman: false,
            };
          }
          // CASE 3: Confident classification → route to specialist with fallback chain
          else if (result.confianca >= minConfidence && result.produto_id) {
            // Inject orchestrator-detected product into the request
            body.product_id = result.produto_id;

            const preferredRoles = mapIntentToRoles(result.intencao);
            let routedAgent: ProductAgent | null = null;

            // Try each preferred role for this product
            for (const role of preferredRoles) {
              const { data: candidate } = await supabase
                .from('product_agents')
                .select('*')
                .eq('product_id', result.produto_id)
                .eq('agent_type', role)
                .eq('is_active', true)
                .order('is_default', { ascending: false })
                .limit(1)
                .maybeSingle();
              if (candidate) {
                routedAgent = candidate;
                console.log('[webchat-bot] 🧭 Routed to specialist:', candidate.name, '(', role, ')');
                break;
              }
            }

            // Fallback 1: any default agent of the product
            if (!routedAgent) {
              const { data: defaultAgent } = await supabase
                .from('product_agents')
                .select('*')
                .eq('product_id', result.produto_id)
                .eq('is_default', true)
                .eq('is_active', true)
                .maybeSingle();
              if (defaultAgent) {
                routedAgent = defaultAgent;
                console.log('[webchat-bot] 🧭 Fallback: default agent of product:', defaultAgent.name);
              }
            }

            // Fallback 2: orchestrator itself assumes the conversation with product context
            if (!routedAgent) {
              const { data: orchAsAgent } = await supabase
                .from('product_agents')
                .select('*')
                .eq('id', orchConfig.orchestrator_agent_id)
                .eq('is_active', true)
                .maybeSingle();
              if (orchAsAgent) {
                routedAgent = orchAsAgent;
                console.warn('[webchat-bot] 🧭 No specialist found — orchestrator assumes conversation');
              }
            }

            if (routedAgent) {
              activeAgent = routedAgent;
              await supabase
                .from('webchat_conversations')
                .update({
                  orchestrator_state: 'em_atendimento',
                  current_agent_id: routedAgent.id,
                  orchestrator_context: result.contexto_extraido,
                  detected_intent: result.intencao,
                  product_id: result.produto_id,
                })
                .eq('id', body.conversation_id);
            } else {
              // No agent at all → human
              await supabase
                .from('webchat_conversations')
                .update({
                  orchestrator_state: 'humano',
                  needs_human: true,
                  detected_intent: result.intencao,
                  orchestrator_context: result.contexto_extraido,
                })
                .eq('id', body.conversation_id);
              orchestratorEarlyResponse = {
                content: 'Vou te conectar con um dos nossos atendentes para te ajudar melhor.',
                needsHuman: true,
              };
            }
          }
        } else if (currentState === 'em_atendimento' && convInit.current_agent_id) {
          // Already in active conversation — load the assigned specialist
          const { data: assigned } = await supabase
            .from('product_agents')
            .select('*')
            .eq('id', convInit.current_agent_id)
            .eq('is_active', true)
            .maybeSingle();
          if (assigned) {
            activeAgent = assigned;
            if (assigned.product_id) body.product_id = assigned.product_id;
            console.log('[webchat-bot] 🧭 Continuing with assigned specialist:', assigned.name);
          }
        }
      }
    } catch (orchErr) {
      console.warn('[webchat-bot] orchestrator pipeline error (non-fatal):', orchErr);
    }

    // If orchestrator wants to send a triage question or hand off to human, return early
    if (orchestratorEarlyResponse) {
      // Persist outbound message
      try {
        await supabase.from('webchat_messages').insert({
          conversation_id: body.conversation_id,
          direction: 'outbound',
          content: orchestratorEarlyResponse.content,
          metadata: { orchestrator: true, needs_human: orchestratorEarlyResponse.needsHuman },
        });
      } catch (msgErr) {
        console.warn('[webchat-bot] failed to persist orchestrator message (non-fatal):', msgErr);
      }
      return new Response(
        JSON.stringify({
          response: orchestratorEarlyResponse.content,
          needs_human: orchestratorEarlyResponse.needsHuman,
          orchestrator: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }


    // === STEP 0: Keyword/phrase auto-activation ===
    // Keywords may switch agents only when there is no explicit agent_id. For
    // WhatsApp instance locks, evolution-webhook sends agent_id deliberately;
    // in that case no keyword/orchestrator rule may override the bound agent.
    if (body.product_id && body.message && !body.agent_id && !adminTakeoverActive) {
      try {
        // Resolve channel for scope filtering
        const { data: convForChannel } = await supabase
          .from('webchat_conversations')
          .select('channel, current_agent_id')
          .eq('id', body.conversation_id)
          .maybeSingle();

        const rawChannel = (convForChannel?.channel || 'chat').toLowerCase();
        const channel: MatcherChannel =
          rawChannel === 'whatsapp' ? 'whatsapp' :
          rawChannel === 'inbox' ? 'inbox' :
          rawChannel === 'funnel' ? 'funnel' : 'chat';

        const { data: candidateAgents } = await supabase
          .from('product_agents')
          .select('id, name, is_active, activation_keywords, activation_phrases, activation_priority, activation_scope, takeover_on_match, updated_at')
          .eq('product_id', body.product_id)
          .eq('is_active', true);

        const match = matchAgentByMessage(body.message, candidateAgents || [], channel);
        if (match) {
          const { data: full } = await supabase
            .from('product_agents')
            .select('*')
            .eq('id', match.agent.id)
            .maybeSingle();

          if (full) {
            activeAgent = full;
            const takeover = match.agent.takeover_on_match !== false;
            keywordMatchInfo = {
              matched_term: match.matched_term,
              match_type: match.match_type,
              takeover,
              from_agent_id: convForChannel?.current_agent_id || null,
            };
            console.log('[webchat-bot] 🎯 Keyword match → agent:', full.name, 'term:', match.matched_term, 'takeover:', takeover);

            if (takeover && convForChannel?.current_agent_id !== full.id) {
              await supabase
                .from('webchat_conversations')
                .update({ current_agent_id: full.id })
                .eq('id', body.conversation_id);
            }

            // Audit log (best-effort)
            try {
              const { data: convInfo } = await supabase
                .from('webchat_conversations')
                .select('organization_id, lead_id')
                .eq('id', body.conversation_id)
                .maybeSingle();
              if (convInfo?.organization_id) {
                await supabase.from('agent_activation_logs').insert({
                  organization_id: convInfo.organization_id,
                  product_id: body.product_id,
                  conversation_id: body.conversation_id,
                  lead_id: convInfo.lead_id || null,
                  from_agent_id: keywordMatchInfo.from_agent_id,
                  to_agent_id: full.id,
                  matched_term: match.matched_term,
                  match_type: match.match_type,
                  channel,
                });
              }
            } catch (logErr) {
              console.warn('[webchat-bot] activation log failed (non-fatal):', logErr);
            }
          }
        }
      } catch (matchErr) {
        console.warn('[webchat-bot] activation matcher error (non-fatal):', matchErr);
      }
    }

    // First check if agent_id is provided directly (only if no keyword match)
    if (!activeAgent && body.agent_id) {
      const { data: agent } = await supabase
        .from('product_agents')
        .select('*')
        .eq('id', body.agent_id)
        .eq('is_active', true)
        .maybeSingle();

      activeAgent = agent;
      console.log('[webchat-bot] Using specified agent:', activeAgent?.name);
    }

    // Priority #2 (manual admin takeover): if the conversation's current_agent_id
    // points to an active Admin agent, that override wins over instance-bound rules.
    // This protects manual transfers made by gestores via the Inbox UI.
    if (!activeAgent && !body.agent_id) {
      const { data: convAdminCheck } = await supabase
        .from('webchat_conversations')
        .select('current_agent_id, product_agents:current_agent_id(*)')
        .eq('id', body.conversation_id)
        .maybeSingle();

      const candidateAgent = (convAdminCheck as any)?.product_agents;
      if (candidateAgent?.agent_type === 'admin' && candidateAgent?.is_active) {
        activeAgent = candidateAgent as ProductAgent;
        console.log('[webchat-bot] 🔒 Using admin agent (manual takeover):', activeAgent.name);
      }
    }

    // Priority #3 (after explicit agent_id and admin override): agent bound to this
    // conversation's Evolution WhatsApp instance. This isolates attendance per-number —
    // a message arriving on number X is handled by the agent bound to that connection.
    // IMPORTANT: skip this fallback while the conversation is still owned by the
    // Orchestrator (states: null / 'triagem' / 'aguardando_menu'). Otherwise an
    // instance-bound SDR (e.g., Natan) would answer before the welcome flow runs.
    if (!activeAgent && !body.agent_id) {
      const { data: convInst } = await supabase
        .from('webchat_conversations')
        .select('evolution_instance_id, orchestrator_state, organization_id')
        .eq('id', body.conversation_id)
        .maybeSingle();

      let orchOwnsThis = false;
      if (convInst?.organization_id) {
        const { data: orchCfgFb } = await supabase
          .from('organization_orchestrator_config')
          .select('is_enabled, orchestrator_agent_id')
          .eq('organization_id', convInst.organization_id)
          .maybeSingle();
        const orchActive = !!(orchCfgFb?.is_enabled && orchCfgFb?.orchestrator_agent_id);
        const st = (convInst as any).orchestrator_state || null;
        orchOwnsThis = orchActive && (st === null || st === 'triagem' || st === 'aguardando_menu');
      }

      if (orchOwnsThis) {
        console.log('[webchat-bot] 📱 Skipping instance-bound fallback — orchestrator owns conversation');
      } else if (convInst?.evolution_instance_id) {
        const { data: boundAgent } = await supabase
          .from('product_agents')
          .select('*')
          .eq('evolution_instance_id', convInst.evolution_instance_id)
          .eq('is_active', true)
          .order('is_default', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (boundAgent) {
          activeAgent = boundAgent as ProductAgent;
          console.log('[webchat-bot] 📱 Using instance-bound agent:', activeAgent.name, 'for instance:', convInst.evolution_instance_id);
        }
      }
    }
    // Then check conversation's current_agent_id and fetch flow_variables for overrides
    let flowVariables: Record<string, string> = {};
    
    if (!body.agent_id) {
      const { data: conversation } = await supabase
        .from('webchat_conversations')
        .select('current_agent_id, flow_variables')
        .eq('id', body.conversation_id)
        .maybeSingle();
      
      if (conversation?.flow_variables) {
        flowVariables = conversation.flow_variables as Record<string, string>;
        console.log('[webchat-bot] Flow variables loaded:', Object.keys(flowVariables));
      }
      
      // Only fall back to conversation's current_agent_id if no keyword match already set activeAgent
      if (!activeAgent && conversation?.current_agent_id) {
        const { data: agent } = await supabase
          .from('product_agents')
          .select('*')
          .eq('id', conversation.current_agent_id)
          .eq('is_active', true)
          .maybeSingle();
        
        activeAgent = agent;
        console.log('[webchat-bot] Using conversation agent:', activeAgent?.name);
      }
    }
    // Finally, try to get default agent for product
    if (!activeAgent && body.product_id) {
      const { data: defaultAgent } = await supabase
        .from('product_agents')
        .select('*')
        .eq('product_id', body.product_id)
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle();
      
      activeAgent = defaultAgent;
      if (activeAgent) {
        console.log('[webchat-bot] Using default product agent:', activeAgent.name);
      }
    }

    // Fallback: first active agent for product (when no default is set)
    if (!activeAgent && body.product_id) {
      const { data: firstActiveAgent } = await supabase
        .from('product_agents')
        .select('*')
        .eq('product_id', body.product_id)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      
      activeAgent = firstActiveAgent;
      if (activeAgent) {
        console.log('[webchat-bot] Using first active agent as fallback:', activeAgent.name);
      }
    }
    
    // Build permission overrides from flow variables
    const permissionOverrides: PermissionOverrides = {};
    if (flowVariables['__override_can_do']) {
      try { permissionOverrides.can_do = JSON.parse(flowVariables['__override_can_do']); } catch {}
    }
    if (flowVariables['__override_cannot_do']) {
      try { permissionOverrides.cannot_do = JSON.parse(flowVariables['__override_cannot_do']); } catch {}
    }
    if (flowVariables['__override_handoff_triggers']) {
      try { permissionOverrides.handoff_triggers = JSON.parse(flowVariables['__override_handoff_triggers']); } catch {}
    }
    if (flowVariables['__ai_context']) {
      permissionOverrides.context = flowVariables['__ai_context'];
    }
    
    // Check for auto-switch configuration
    let schedulingMetadata: any = null;
    let autoSwitchConfig: Array<{ agent_id: string; trigger_condition: string }> = [];
    if (flowVariables['__auto_switch_config']) {
      try { 
        autoSwitchConfig = JSON.parse(flowVariables['__auto_switch_config']);
        console.log('[webchat-bot] Auto-switch enabled with', autoSwitchConfig.length, 'agents');
      } catch {}
    }

    // ─── Phase 3: Contextual reactions (pre-AI) ──────────────────────
    // Detect emoji-only/audio/keywords/inactivity BEFORE calling the LLM.
    // Direct-reply rules short-circuit the AI call entirely; context rules
    // get injected into the system prompt so the LLM responds the right way.
    let reactionContext: string | null = null;
    let reactionDirectReply: string | null = null;
    try {
      const reactionsCfg = (activeAgent as any)?.humanization?.reactions as ReactionsConfig | undefined;
      if (reactionsCfg && reactionsCfg.enabled !== false) {
        // Find the previous interaction timestamp (any message before now in this conv)
        let lastInteractionAt: string | null = null;
        try {
          const { data: prevMsg } = await supabase
            .from('webchat_messages')
            .select('created_at')
            .eq('conversation_id', body.conversation_id)
            .order('created_at', { ascending: false })
            .limit(2);
          // index 0 is current inbound, 1 is the previous
          lastInteractionAt = prevMsg && prevMsg[1]?.created_at ? prevMsg[1].created_at : null;
        } catch (_) { /* non-fatal */ }

        const match = detectReaction(
          { text: body.message || '', lastInteractionAt },
          reactionsCfg
        );
        if (match) {
          console.log('[webchat-bot] Reaction matched:', match.rule.id, '→', match.kind);
          if (match.kind === 'reply') reactionDirectReply = match.text;
          else reactionContext = match.text;
        }
      }
    } catch (rxErr: any) {
      console.warn('[webchat-bot] reaction detection failed (non-fatal):', rxErr?.message);
    }

    // Check FAQ first
    const faqAnswer = findFAQMatch(body.message, body.agent_config.faq);
    
    let responseContent: string = '';
    let responseButtons: ChatButton[] | null = null;
    let responseVideoUrl: string | null = null;
    
    if (reactionDirectReply) {
      // Skip AI entirely — use the reaction's pre-defined reply.
      responseContent = reactionDirectReply;
    } else if (faqAnswer) {
      responseContent = faqAnswer;
    } else {
      // Build system prompt - use agent config if available, otherwise default
      let systemPrompt = '';
      
      if (activeAgent) {
        // Build prompt from product agent configuration with overrides
        const hasOverrides = Object.keys(permissionOverrides).length > 0;
        systemPrompt = buildAgentSystemPrompt(activeAgent, body.visitor_name || '', hasOverrides ? permissionOverrides : undefined);
        console.log('[webchat-bot] Using agent-based prompt for:', activeAgent.name, hasOverrides ? '(with overrides)' : '');
      } else {
        // Fall back to default sales prompt
        const salesPrompt = body.agent_config.sales_prompt || DEFAULT_SALES_PROMPT;
        const agentName = body.agent_config.agent_name || 'Assistente';
        
        systemPrompt = `Vos sos ${agentName}, assistente virtual de ventas.\n\n`;
        systemPrompt += salesPrompt;
        
        // Add persona style
        const personaStyle = body.agent_config.persona_style || 'friendly';
        const personaInstructions = getPersonaInstructions(personaStyle);
        systemPrompt += `\n\n${personaInstructions}`;
      }

      // Append humanization persona/tics/style block (Phase 2) so the LLM
      // already produces text in a humanized voice. Post-processing
      // (splitting + delays) still runs on top in the chunked branch.
      if (activeAgent && (activeAgent as any).humanization) {
        const humanBlock = buildHumanizationPromptBlock((activeAgent as any).humanization as HumanizationConfig);
        if (humanBlock) systemPrompt += humanBlock;
      }

      // Phase 3: append contextual reaction guidance, if a rule matched.
      if (reactionContext) {
        systemPrompt += `\n\n⚡ CONTEXTO IMEDIATO (prioridade máxima en esta respuesta):\n${reactionContext}`;
      }
      
      const rawVisitorName = body.visitor_name || '';
      const visitorName = extractFirstName(rawVisitorName) || '';

      // Só usa o nombre se for primeiro nombre confiável (no razão social).
      if (visitorName && !activeAgent) {
        systemPrompt += `\n\n👤 CONTEXTO DO CLIENTE:\n- Primeiro nombre: ${visitorName}\n- Usa con naturalidade, sin repetir en cadel mensaje.`;
      } else if (rawVisitorName && !visitorName) {
        systemPrompt += `\n\n👤 CONTEXTO DO CLIENTE:\n- O registro veio con "${rawVisitorName}", que parece nombre de empresa.\n- NÃO trate el lead por esse nombre.\n- Pergunte o primeiro nombre de él de forma natural antes de seguir.`;
      }

      // 🧠 Memória de turno: últimas 6 mensajes del agente, pra IA no repetir.
      try {
        const recentBotMsgs = (messages || [])
          .filter((m: any) => m.direction === 'outbound' && (m.sender_type === 'bot' || m.sender_type === 'agent'))
          .slice(-6)
          .map((m: any, i: number) => `${i + 1}. ${String(m.content || '').slice(0, 220)}`)
          .join('\n');
        if (recentBotMsgs) {
          systemPrompt += `\n\n🧠 MENSAGENS QUE VOS JÁ MANDOU NESTA CONVERSA (no repita ideias, no se presentes de novo):\n${recentBotMsgs}`;
        }
      } catch { /* non-fatal */ }

      // 🔀 HANDOFF RECEBIDO — se este agente acabou de receber la conversación,
      // injeta um bloco de contexto pra ele NÃO recomeçar do zero.
      try {
        if (activeAgent?.id) {
          const { data: lastHandoff } = await supabase
            .from('agent_activation_logs')
            .select('from_agent_id, created_at')
            .eq('conversation_id', body.conversation_id)
            .eq('to_agent_id', activeAgent.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const handoffAgeMs = lastHandoff?.created_at
            ? Date.now() - new Date(lastHandoff.created_at).getTime()
            : Infinity;

          // Considera "fresh" se ocorreu nos últimos 30 minutos
          if (lastHandoff && handoffAgeMs < 30 * 60 * 1000) {
            let prevAgentName = '';
            if (lastHandoff.from_agent_id) {
              const { data: prev } = await supabase
                .from('product_agents')
                .select('name')
                .eq('id', lastHandoff.from_agent_id)
                .maybeSingle();
              prevAgentName = (prev as any)?.name || '';
            }
            // Resumen cru: últimas 8 trocas (lead + agente)
            const tail = (messages || [])
              .slice(-8)
              .map((m: any) => `${m.direction === 'inbound' ? 'Lead' : 'Agente'}: ${String(m.content || '').slice(0, 200)}`)
              .join('\n');

            systemPrompt += `\n\n🔀 HANDOFF RECEBIDO\n` +
              `Agente anterior: ${prevAgentName || 'colega de equipo'}\n` +
              `Histórico recente:\n${tail || '(sem mensajes prévias)'}\n\n` +
              `INSTRUÇÃO CRÍTICA:\n` +
              `- NÃO recomece la conversación. NÃO se representes (ya fui apresentado).\n` +
              `- Leia o historial antes de responder. Capture estágio, dor e objeção.\n` +
              `- Próximo passo OBRIGATÓRIO: confirmar interesse e ir pro CTA.\n` +
              `  • Lead pronto → use a tool gerar_link_pagamento.\n` +
              `  • Lead em duda → ofrezcas 2 horários específicos via tool de reserva.\n` +
              `- Máximo 2 linhas por mensaje. 1 pregunta por turno. Tom profissional.\n` +
              `- PROHIBIDO escrever placeholders literais como {{checkout_link}}, {{link}}, {{precio}}. Siempre use as tools.\n` +
              `- PROHIBIDO clichés: "boa!", "que ótimo", "fico feliz", "show!", "perfeito!", "maravilha", "fechou".`;
          }
        }
      } catch (e) {
        console.warn('[webchat-bot] handoff context injection failed (non-fatal):', e);
      }


      try {
        const { data: convRow } = await supabase
          .from('webchat_conversations')
          .select('metadata')
          .eq('id', body.conversation_id)
          .maybeSingle();
        const meta = (convRow?.metadata as any) || {};
        const pending = meta.pending_payment_data;
        if (pending && typeof pending === 'object' && Object.keys(pending).length > 0) {
          const lines = Object.entries(pending)
            .map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
            .join('\n');
          systemPrompt += `\n\n💳 DATOS PENDIENTES DE ESTE LEAD (úsalos SOLO cuando el cliente lo pida, muestre dudas sobre el pago, o cuando sea natural ofrecerlos):\n${lines}\n\nObjetivo del abordaje: ${meta.pending_payment_objective || 'ayudar al lead a concretar el pago'}.\nNo entregues todos los datos de una sola vez. Resolvelo por conversación: preguntá, entendé, y recién ofrecé link/instrucción cuando él indique que lo necesita.`;
        }
      } catch { /* non-fatal */ }

      // Fetch product knowledge if enabled
      if (body.agent_config.use_product_brain && body.product_id) {
        const productKnowledge = await fetchProductBrain(supabase, body.product_id);
        if (productKnowledge) {
          systemPrompt += productKnowledge;
        }
        
        // Also fetch sales training materials (product + agent-specific)
        const trainingKnowledge = await fetchTrainingMaterials(supabase, body.product_id, activeAgent?.id);
        if (trainingKnowledge) {
          systemPrompt += trainingKnowledge;
        }
      } else if (body.agent_config.knowledge_base) {
        systemPrompt += `\n\nBase de conhecimento:\n${body.agent_config.knowledge_base}`;
      }
      
      // Add FAQ context — HIGH PRIORITY for direct answers
      if (body.agent_config.faq && body.agent_config.faq.length > 0) {
        systemPrompt += '\n\n❓ FAQs — RESPOSTAS OFICIAIS (use EXATAMENTE estas respuestas cuando a pregunta coincidir):';
        body.agent_config.faq.forEach(item => {
          systemPrompt += `\n\nPERGUNTA: ${item.question}\nRESPOSTA OFICIAL: ${item.answer}`;
        });
        systemPrompt += '\n\n⚠️ Se o cliente fizer uma pregunta similar a alguna FAQ acima, use a RESPOSTA OFICIAL como base. NÃO invente uma respuesta diferente.';
      }

      // Add CTA instructions if available
      if (productCTAs.length > 0) {
        systemPrompt += '\n\n🔘 BOTONES DE ACCIÓN (CTAs):';
        systemPrompt += '\nPodés enviar botones interactivos al cliente usando la función send_cta_buttons.';
        systemPrompt += '\nPara enviar videos explicativos, usá la función send_video.';
        systemPrompt += '\nUsá los CTAs según la intención detectada en la conversación:';
        
        productCTAs.forEach(cta => {
          const ctaInfo = cta.cta_type === 'video' 
            ? `\n- ID: ${cta.id} | "${cta.label}" (VÍDEO) | Intenção: ${cta.intent_level}`
            : `\n- ID: ${cta.id} | "${cta.label}" | Intenção: ${cta.intent_level}`;
          systemPrompt += ctaInfo;
          if (cta.trigger_keywords && cta.trigger_keywords.length > 0) {
            systemPrompt += ` | Gatilhos: ${cta.trigger_keywords.join(', ')}`;
          }
        });
        
        systemPrompt += '\n\nRegras para CTAs:';
        systemPrompt += '\n- Envie CTAs de intenção "high" cuando cliente demonstrar forte interesse em comprar';
        systemPrompt += '\n- Envie CTAs de intenção "medium" cuando tiver dudas específicas';
        systemPrompt += '\n- Envie CTAs de intenção "low" no inicio de la conversación para exploração';
        systemPrompt += '\n- Para VÍDEOS: envie cuando cliente precisar de demonstração visual ou explicação detalhada';
        systemPrompt += '\n- NÃO envie muchos CTAs de uma vez (máximo 3)';
        systemPrompt += '\n- Siempre inclua umel mensaje de contexto antes dos botões';
      }

      // ============================================================
      // FIX 1 — Auto-capture email/phone/name from latest user message.
      // Detects contact info in the visitor's message and persists it
      // to webchat_conversations + leads BEFORE leadContext is built,
      // so the same turn already sees the new data and the AI never
      // re-asks for what it just received.
      // ============================================================
      const capturedFromMessage: { email?: string; phone?: string; name?: string } = {};
      if (body.conversation_id && body.message) {
        try {
          const emailMatch = body.message.match(/[\w.+-]+@[\w-]+\.[\w.-]+/i);
          const digitsOnly = body.message.replace(/\D+/g, '');
          const phoneMatch = digitsOnly.length >= 10 && digitsOnly.length <= 13 ? digitsOnly : null;

          if (emailMatch) capturedFromMessage.email = emailMatch[0].toLowerCase();
          if (phoneMatch) capturedFromMessage.phone = phoneMatch;

          const { data: convRow } = await supabase
            .from('webchat_conversations')
            .select('id, organization_id, lead_id, visitor_email, visitor_phone, visitor_name')
            .eq('id', body.conversation_id)
            .maybeSingle();

          if (convRow) {
            const convUpdate: Record<string, string> = {};
            if (capturedFromMessage.email && !convRow.visitor_email) convUpdate.visitor_email = capturedFromMessage.email;
            if (capturedFromMessage.phone && !convRow.visitor_phone) convUpdate.visitor_phone = capturedFromMessage.phone;
            if (Object.keys(convUpdate).length > 0) {
              await supabase.from('webchat_conversations').update(convUpdate).eq('id', body.conversation_id);
              console.log('[webchat-bot] 📩 captured contact info to conversation:', Object.keys(convUpdate).join(','));
            }

            if (convRow.lead_id && (capturedFromMessage.email || capturedFromMessage.phone)) {
              const { data: leadRow } = await supabase
                .from('leads')
                .select('id, email, phone')
                .eq('id', convRow.lead_id)
                .maybeSingle();
              const leadUpdate: Record<string, string> = {};
              if (capturedFromMessage.email && !leadRow?.email) leadUpdate.email = capturedFromMessage.email;
              if (capturedFromMessage.phone && !leadRow?.phone) leadUpdate.phone = capturedFromMessage.phone;
              if (Object.keys(leadUpdate).length > 0) {
                await supabase.from('leads').update(leadUpdate).eq('id', convRow.lead_id);
                console.log('[webchat-bot] 📩 captured contact info tel lead:', Object.keys(leadUpdate).join(','));

                // Audit log
                if (convRow.organization_id) {
                  await supabase.from('agent_action_logs').insert({
                    organization_id: convRow.organization_id,
                    conversation_id: body.conversation_id,
                    agent_id: null,
                    lead_id: convRow.lead_id,
                    product_id: body.product_id || null,
                    action_type: 'contact_info_captured',
                    success: true,
                    action_data: { fields: Object.keys(leadUpdate), source: 'user_message_regex' },
                    result: leadUpdate,
                  }).then(() => {}, () => {});
                }
              }
            }
          }
        } catch (capErr) {
          console.warn('[webchat-bot] auto-capture failed (non-fatal):', capErr);
        }
      }

      // Fetch lead context for the conversation
      let leadContext: any = null;
      let leadId: string | null = null;
      if (body.conversation_id) {
        const { data: convLead } = await supabase
          .from('webchat_conversations')
          .select('lead_id')
          .eq('id', body.conversation_id)
          .maybeSingle();
        
        if (convLead?.lead_id) {
          leadId = convLead.lead_id;
          const { data: lead } = await supabase
            .from('leads')
            .select('id, name, email, phone, temperature, tags, deal_value, company, source, custom_fields, current_stage_id, assigned_to, product_id')
            .eq('id', convLead.lead_id)
            .maybeSingle();
          
          if (lead) {
            leadContext = lead;
            // Detect if lead is already a customer (won stage OR "Cliente" tag OR has won deal)
            let isCustomer = false;
            if (lead.current_stage_id) {
              const { data: stage } = await supabase
                .from('pipeline_stages')
                .select('name, is_won')
                .eq('id', lead.current_stage_id)
                .maybeSingle();
              if (stage) {
                leadContext.stage_name = stage.name;
                if (stage.is_won === true) isCustomer = true;
              }
            }
            // Tag-based detection: any tag containing "cliente" treats lead as customer
            const tagsLower = (lead.tags || []).map((t: string) => String(t).toLowerCase());
            if (tagsLower.some((t) => t.includes('cliente'))) isCustomer = true;
            // Won deal detection
            if (!isCustomer) {
              const { data: wonDeal } = await supabase
                .from('deals')
                .select('id')
                .eq('lead_id', lead.id)
                .eq('status', 'won')
                .limit(1)
                .maybeSingle();
              if (wonDeal) isCustomer = true;
            }
            leadContext.is_customer = isCustomer;

            systemPrompt += `\n\n👤 CONTEXTO DO LEAD:
- Nombre: ${lead.name || 'No informado'}
- Email: ${lead.email || 'No informado'}
- Teléfono: ${lead.phone || 'No informado'}
- Temperatura: ${lead.temperature || 'No classificado'}
- Estágio: ${leadContext.stage_name || 'No definido'}
- Tags: ${(lead.tags || []).join(', ') || 'Ningunoa'}
- Valor do Deal: ${lead.deal_value ? `R$ ${lead.deal_value}` : 'No definido'}
- Empresa: ${lead.company || 'No informada'}
- Ya es CLIENTE: ${isCustomer ? 'SIM' : 'NÃO'}`;
            if (lead.custom_fields && Object.keys(lead.custom_fields).length > 0) {
              systemPrompt += `\n- Campos personalizados: ${JSON.stringify(lead.custom_fields)}`;
            }

            if (isCustomer) {
              systemPrompt += `\n\n🚫 REGRA DE NEGÓCIO — CONTATO JÁ É CLIENTE:
Este contato JÁ COMPROU e es um CLIENTE ATIVO. Por isso:
- NÃO ofrezcas reunión de presentación, demo, "bate-papo de presentación" ou cualquier reserva comercial.
- Se ele pedir uma reunión, responda que vai conectar con o time de pós-venta/suporte (no agende usted misma).
- Foque em tirar dudas de uso do producto, suporte, materiais e onboarding. Para questões comerciais novas, encaminhe para el time responsável.`;
            }
          }
        }
      }

      // Reflect captured-from-message data intel leadContext immediately
      // so this turn's prompt already knows the email/phone we just saved.
      if (capturedFromMessage.email || capturedFromMessage.phone) {
        if (!leadContext) leadContext = {};
        if (capturedFromMessage.email && !leadContext.email) leadContext.email = capturedFromMessage.email;
        if (capturedFromMessage.phone && !leadContext.phone) leadContext.phone = capturedFromMessage.phone;
      }

      // Final instructions for response format
      const maxLength = body.agent_config.max_message_length || 300;
      systemPrompt += `\n\n═══════════════════════════════════════
⚠️ REGRA MAIS IMPORTANTE — FONTE DAS RESPOSTAS
═══════════════════════════════════════

Usted DEVE responder EXCLUSIVAMENTE con base nas información fornecidas nas seções:
- 🧠 CONHECIMENTO DO PRODUTO
- 📖 BASE DE CONHECIMENTO DO AGENTE
- ❓ FAQs
- 🛡️ CONTORNO DE OBJEÇÕES

NUNCA invente, suponha ou "complete" información que NÃO estejam explicitamente no conhecimento fornecido.
Se a respuesta para a pregunta del cliente NÃO estiver na base de conhecimento:
1. Diga que vai verificar essa información específica
2. Ofereça conectar con um especialista que puede responder con precisão
3. NUNCA dê uma respuesta genérica ou inventada

Exemplo ERRADO: Cliente pregunta "quantos usuarios suporta?" e usted responde "a estrutura es escalável" (genérico, inventado)
Exemplo CORRETO: Cliente pregunta "quantos usuarios suporta?" e a FAQ diz "300 a 500 na VPS inicial" → responda con esses dados exatos

═══════════════════════════════════════

⚠️ FORMATO DA RESPOSTA:
- Máximo 2 linhas por bolha. 1 pregunta por turno. Pode quebrar em até 3 mensajes curtas e naturais (o sistema entrega cada bolha separada).
- Limite total: ${maxLength} caracteres somando todas as bolhas.
- ANTES de responder, releia o historial e verifique: já preguntesi isso? Já usei essa frase? Já cobri esse assunto?
- SIEMPRE termine con pregunta de retorno que AVANÇA a conversación
- NUNCA repita saudações, emojis ou frases já usadas en esta conversación
- Se a información no estiver na base de conhecimento, NÃO invente — diga que vai verificar

🚫 PROHIBIDO INVENTAR ENTREGÁVEIS:
- NÃO prometa enviar "depoimento", "case", "vídeo", "PDF", "ficha", "folder", "material", "link", "depoimentos", "prova social" se o cliente NÃO pediu, OU se usted no tiene a tool/catálogo correspondente disponible.
- NÃO escreva colchetes con nomes de archivos/links inventados (ex: "[Depoimento: ...]", "[Vídeo aqui]", "[Link]"). Se for enviar mídia, use a tool send_catalog_item / send_video. Se no tiene, NÃO ofrezcas.
- Em transferência: faça a despedida corta e profissional. NÃO crie etapa intermediária ("vou te mandar um material e ya te conecto") se no fue pedido. Solo transferí.`;

      // Build tools array for CTA buttons, video, and schedule_meeting
      const videoCTAs = productCTAs.filter(c => c.cta_type === 'video');
      const buttonCTAs = productCTAs.filter(c => c.cta_type !== 'video');
      
      // Check if agent can schedule meetings
      let canSchedule = false;
      let scheduleUserId: string | null = null;
      // Tipos de evento permitidos para esse agente en esta conversación.
      // Se vazio, IA no puede agendar. Se 1+, IA usa esses tipos (e só esses).
      let allowedEventTypes: any[] = [];
      if (body.product_id) {
        const { data: convData } = await supabase
          .from('webchat_conversations')
          .select('assigned_user_id, widget_id, organization_id')
          .eq('id', body.conversation_id)
          .maybeSingle();

        // Prioridade 1: agente tiene default_schedule_user_id explícito
        // Prioridade 2: assigned_user_id de la conversación
        // Prioridade 3: dueño do primeiro event_type ativo da org
        const agentHostId = (activeAgent as any)?.default_schedule_user_id ?? null;
        let checkUserId: string | null = agentHostId || convData?.assigned_user_id || null;

        if (!checkUserId && convData?.organization_id) {
          const { data: eventOwner } = await supabase
            .from('booking_event_types')
            .select('user_id')
            .eq('organization_id', convData.organization_id)
            .eq('is_active', true)
            .limit(1)
            .maybeSingle();
          checkUserId = eventOwner?.user_id || null;
        }

        if (checkUserId) {
          // Carrega tipos de evento do host
          const allowedIds: string[] = Array.isArray((activeAgent as any)?.allowed_event_type_ids)
            ? (activeAgent as any).allowed_event_type_ids
            : [];

          let etQuery = supabase
            .from('booking_event_types')
            .select('id, name, description, duration_minutes, location_type, location_details, buffer_before, buffer_after, min_notice_hours, create_meet, user_id')
            .eq('user_id', checkUserId)
            .eq('is_active', true);

          // Se o agente tiene allowlist, filtra por ela.
          if (allowedIds.length > 0) {
            etQuery = etQuery.in('id', allowedIds);
            const { data: ets } = await etQuery.order('created_at', { ascending: true });
            allowedEventTypes = ets || [];
          } else if (agentHostId) {
            // host definido mas SEM allowlist => tentar fallback automático
            // criando um event type "Apresentação {producto}" sob demanda.
            const productIdForFallback = (activeAgent as any)?.product_id || body.product_id || null;
            const orgIdForFallback = (activeAgent as any)?.organization_id || convData?.organization_id || null;

            if (productIdForFallback && orgIdForFallback) {
              try {
                const { data: prodRow } = await supabase
                  .from('products')
                  .select('id, name')
                  .eq('id', productIdForFallback)
                  .maybeSingle();

                const productName = (prodRow?.name || '').trim();
                if (productName) {
                  const slugify = (s: string) => s
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '');
                  const productSlug = slugify(productName) || 'producto';
                  const fallbackSlug = `apresentacao-${productSlug}`.slice(0, 80);
                  const fallbackName = `Apresentação ${productName}`.slice(0, 120);

                  // Idempotência: tenta encontrar event type ya existente para esse host+slug
                  const { data: existing } = await supabase
                    .from('booking_event_types')
                    .select('id, name, description, duration_minutes, location_type, location_details, buffer_before, buffer_after, min_notice_hours, create_meet, user_id')
                    .eq('user_id', checkUserId)
                    .eq('slug', fallbackSlug)
                    .maybeSingle();

                  let fallbackEvent: any = existing || null;

                  if (!fallbackEvent) {
                    const { data: created, error: createErr } = await supabase
                      .from('booking_event_types')
                      .insert({
                        organization_id: orgIdForFallback,
                        user_id: checkUserId,
                        name: fallbackName,
                        slug: fallbackSlug,
                        description: `Reunión de presentación do ${productName}`,
                        duration_minutes: 30,
                        location_type: 'google_meet',
                        is_active: true,
                        create_meet: true,
                        confirmation_message: `Su reunión sobre ${productName} fue confirmada! Em breve usted receberá o link de acesso.`,
                      })
                      .select('id, name, description, duration_minutes, location_type, location_details, buffer_before, buffer_after, min_notice_hours, create_meet, user_id')
                      .maybeSingle();

                    if (createErr) {
                      console.warn('[webchat-bot] Failed to auto-create event type:', createErr.message);
                    } else if (created) {
                      fallbackEvent = created;
                      console.log('[webchat-bot] Auto-created event type for product', productIdForFallback, '→', created.id, `(${fallbackName})`);
                    }
                  }

                  if (fallbackEvent) {
                    allowedEventTypes = [fallbackEvent];
                    // Persiste no agente para próximas conversaciones usarem direto
                    try {
                      await supabase
                        .from('product_agents')
                        .update({ allowed_event_type_ids: [fallbackEvent.id] })
                        .eq('id', (activeAgent as any).id);
                    } catch (persistErr) {
                      console.warn('[webchat-bot] Could not persist fallback event_type_id on agent:', persistErr);
                    }
                  }
                }
              } catch (fbErr) {
                console.warn('[webchat-bot] Fallback event type creation failed:', fbErr);
              }
            }

            if (allowedEventTypes.length === 0) {
              console.log('[webchat-bot] Agent has host but no allowed_event_type_ids and fallback unavailable — scheduling disabled');
            }
          } else {
            // Sem host explícito del agente => comportamento legado (host = assigned/owner)
            const { data: ets } = await etQuery.order('created_at', { ascending: true });
            allowedEventTypes = ets || [];
          }

          if (allowedEventTypes.length > 0) {
            canSchedule = true;
            scheduleUserId = checkUserId;
          }
        }
      }
      
      const toolsList: any[] = [];
      
      if (productCTAs.length > 0) {
        toolsList.push({
          type: "function",
          function: {
            name: "send_cta_buttons",
            description: "Enviar botões de CTA interativos para el cliente.",
            parameters: {
              type: "object",
              properties: {
                message: { type: "string", description: "Mensaje que acompanha os botões" },
                cta_ids: { type: "array", items: { type: "string" }, description: `IDs dos CTAs: ${buttonCTAs.map(c => c.id).join(', ')}` }
              },
              required: ["message", "cta_ids"]
            }
          }
        });
        
        if (videoCTAs.length > 0) {
          toolsList.push({
            type: "function",
            function: {
              name: "send_video",
              description: "Enviar vídeo explicativo.",
              parameters: {
                type: "object",
                properties: {
                  message: { type: "string", description: "Mensaje de contexto" },
                  video_id: { type: "string", description: `ID do vídeo: ${videoCTAs.map(c => c.id).join(', ')}` }
                },
                required: ["message", "video_id"]
              }
            }
          });
        }
      }
      
      // Block scheduling tools entirely when the lead is already a customer.
      if (leadContext?.is_customer) {
        canSchedule = false;
      }

      if (canSchedule && scheduleUserId) {
        // Inject lead data into scheduling prompt if available
        let leadDataPrompt = '';
        if (leadContext) {
          const knownData: string[] = [];
          if (leadContext.name) knownData.push(`Nombre: ${leadContext.name}`);
          if (leadContext.email) knownData.push(`Email: ${leadContext.email}`);
          if (leadContext.phone) knownData.push(`Teléfono: ${leadContext.phone}`);
          if (knownData.length > 0) {
            leadDataPrompt = `\n\nDADOS DO CLIENTE JÁ CONHECIDOS (use no schedule_meeting SEM preguntar novamente):\n- ${knownData.join('\n- ')}`;
          }
        }

        const hasLeadEmail = !!(leadContext?.email);
        const emailEnforcementPrompt = hasLeadEmail
          ? ''
          : `\n\n🚨 EMAIL OBRIGATÓRIO ANTES DE AGENDAR:
- Usted AINDA NÃO tiene o email del cliente.
- ANTES de ofrecer cualquier horario ou chamar schedule_meeting, usted NECESITÁS recolectar o email real.
- Usa a frase exata (ou variação natural): "Pra eu trabar esse horario e te mandar a confirmação, cuál es o melhor email su?"
- NUNCA use emails inventados como "exemplo.com", "cliente@email.com", etc. Se no tiene o email real, PERGUNTE.`;

        systemPrompt += `\n\n📅 AGENDAMENTO ESTRATÉGICO AUTOMÁTICO:
Usted possui 2 ferramentas para reserva inteligente:

1. check_available_slots: Consulta horários disponibles nos próximos días.
   - Usa SOMENTE cuando AINDA NÃO ofreceu horários en esta conversación.
   - Retorna 2 sugestões estratégicas (manhã + tarde).

2. schedule_meeting: Agenda a reunión con o cliente.
   - Usa IMEDIATAMENTE cuando o cliente confirmar um dos horários ofrecidos E usted tiver o email dele.

🛑 REGRAS ABSOLUTAS — VIOLAR QUEBRA O SISTEMA:

A) **NUNCA inventes fechas ni horarios.** Se usted aún NO llamaste check_available_slots en esta conversación, es PROHIBIDO mencionar cualquier data/hora específica (ex: "quinta às 15:30", "mañana 10h"). Decí solo: "Dejame ver mi agenda un momento" e LLAMÁ check_available_slots.

B) **NUNCA chame schedule_meeting sin email real del cliente.** Se faltar email, PARE e preguntes: "Pra eu trabar esse horario, cuál es o melhor email pra eu mandar a confirmação?"

C) **NUNCA escreva "✅ Reunión agendada", "reserva confirmado", "Confirmação enviada para..." ANTES de receber a respuesta de éxito da tool schedule_meeting.** Esse texto es gerado AUTOMATICAMENTE por el sistema después a tool executar con éxito. Se vos soscrever isso antes, o sistema BLOQUEIA su mensaje e mostra o error al cliente.

D) **Se usted for tentado a confirmar um reserva sin ter chamado a tool, PARE imediatamente e chame schedule_meeting primeiro.** Se faltar dado (email/horario), preguntes al cliente en vez de inventar.

E) **Se o historial contém [CONTEXTO INTERNO] con "Horários ya ofrecidos"**, usted JÁ consultou a disponibilidade — no chame check_available_slots de novo (loop infinito). Cuando o cliente confirmar ("puede ser às 9h", "o primeiro", "14h"), chame schedule_meeting IMEDIATAMENTE con os dados reais.

F) Se o cliente pedir um horario DIFERENTE dos ofrecidos OU um día específico que usted no tiene certeza se está livre, chame check_available_slots novamente (usted puede aumentar days_ahead para 14). NUNCA invente que "naquele día/hora no tiene disponibilidade" sin checar — siempre consulte a tool primeiro e ofrezcas os 2 próximos horários reais disponibles.

FLUXO OBRIGATÓRIO:
1. Detectar interesse → (se faltar email, preguntar email primeiro) → chamar check_available_slots
2. Apresentar horários reais retornados por la tool
3. Cliente confirma horario → chamar schedule_meeting con (nombre, email REAL, data, hora)
4. Sistema responde éxito → texto de confirmação aparece automaticamente${emailEnforcementPrompt}
${leadDataPrompt}

🛑 ANTI-REPETIÇÃO (ABSOLUTO):
- Si ya preguntaste o email en esta conversación Y el cliente respondió con algo que parece email (contiene @), o email FUE RECOLECTADO. NO preguntes de nuevo. Andá directo al próximo paso.
- Se usted JÁ chamou check_available_slots e ofreceu horários, NUNCA repita "deixa eu ver a agenda" / "vou consultar a agenda" / "aguarda um instante que vou verificar". O cliente ya tiene os horários. Se ele confirmou um → chame schedule_meeting AGORA. Se quiere otro → check_available_slots de novo, mas SEM avisar "vou ver".
- Se vos sostá prestes a escrever uma frase que JÁ está no historial recente do assistente (mismo verbo + mismo objeto), REESCREVA con palavras diferentes ou pule a etapa.`;

        toolsList.push({
          type: "function",
          function: {
            name: "check_available_slots",
            description: "Consultar horários disponibles nos próximos días. SIEMPRE chame antes de sugerir reserva. Retorna 2 sugestões estratégicas (manhã e tarde).",
            parameters: {
              type: "object",
              properties: {
                days_ahead: { type: "number", description: "Quantos días à frente verificar (estándar 3, máximo 7)" }
              },
              required: []
            }
          }
        });

        toolsList.push({
          type: "function",
          function: {
            name: "schedule_meeting",
            description: "Agendar reunión con o cliente APÓS ele escolher um horario das sugestões.",
            parameters: {
              type: "object",
              properties: {
                guest_name: { type: "string", description: "Nombre completo del cliente" },
                guest_email: { type: "string", description: "Email del cliente" },
                guest_phone: { type: "string", description: "Teléfono (opcional)" },
                preferred_date: { type: "string", description: "Fecha YYYY-MM-DD" },
                preferred_time: { type: "string", description: "Horario HH:MM" }
              },
              required: ["guest_name", "guest_email", "preferred_date", "preferred_time"]
            }
          }
        });
      }

      // === DYNAMIC AGENT TOOLS based on permissions ===
      if (activeAgent) {
        const agentToolPrompts: string[] = [];
        
        if (activeAgent.can_update_pipeline) {
          // Fetch pipeline stages for context
          let stagesList = '';
          if (body.product_id) {
            const { data: stages } = await supabase
              .from('pipeline_stages')
              .select('id, name')
              .eq('product_id', body.product_id)
              .order('order_index', { ascending: true });
            if (stages) stagesList = stages.map((s: any) => `${s.name} (${s.id})`).join(' > ');
          }
          toolsList.push({
            type: "function",
            function: {
              name: "move_pipeline_stage",
              description: `Mover lead para otro estágio do pipeline. Estágios: ${stagesList || 'No disponible'}`,
              parameters: {
                type: "object",
                properties: {
                  stage_id: { type: "string", description: "ID do estágio destino" },
                  reason: { type: "string", description: "Motivo da movimentação" }
                },
                required: ["stage_id"]
              }
            }
          });
          agentToolPrompts.push('- move_pipeline_stage: Usa cuando el lead avanzar na recorrido');
        }

        if (activeAgent.can_apply_tags) {
          toolsList.push({
            type: "function",
            function: {
              name: "apply_tags",
              description: "Aplicar tags al lead para categorização.",
              parameters: {
                type: "object",
                properties: {
                  tags: { type: "array", items: { type: "string" }, description: "Tags a aplicar" }
                },
                required: ["tags"]
              }
            }
          });
          toolsList.push({
            type: "function",
            function: {
              name: "remove_tags",
              description: "Remover tags del lead.",
              parameters: {
                type: "object",
                properties: {
                  tags: { type: "array", items: { type: "string" }, description: "Tags a eliminar" }
                },
                required: ["tags"]
              }
            }
          });
          agentToolPrompts.push('- apply_tags/remove_tags: Categorize el lead baseado en la conversación');
        }

        if (activeAgent.can_update_lead) {
          toolsList.push({
            type: "function",
            function: {
              name: "update_lead_temperature",
              description: "Alterar temperatura del lead (cold, warm, hot).",
              parameters: {
                type: "object",
                properties: {
                  temperature: { type: "string", enum: ["cold", "warm", "hot"], description: "Nova temperatura" }
                },
                required: ["temperature"]
              }
            }
          });
          toolsList.push({
            type: "function",
            function: {
              name: "update_lead_field",
              description: "Atualizar campo del lead (deal_value, company, source, etc).",
              parameters: {
                type: "object",
                properties: {
                  field: { type: "string", description: "Nombre do campo" },
                  value: { type: "string", description: "Novo valor" }
                },
                required: ["field", "value"]
              }
            }
          });
          agentToolPrompts.push('- update_lead_temperature: Clasifica baseado no interesse demonstrado');
          agentToolPrompts.push('- update_lead_field: Atualize información coletadas en la conversación');
        }

        if (activeAgent.can_create_tasks) {
          toolsList.push({
            type: "function",
            function: {
              name: "create_task",
              description: "Criar tarea vinculada al lead para acompanhamento.",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Título da tarea" },
                  description: { type: "string", description: "Descripción" },
                  due_date: { type: "string", description: "Fecha de vencimento YYYY-MM-DD (opcional)" }
                },
                required: ["title"]
              }
            }
          });
          agentToolPrompts.push('- create_task: Crea cuando identificar acción pendente do vendedor');
        }

        if (activeAgent.can_send_emails) {
          toolsList.push({
            type: "function",
            function: {
              name: "send_email",
              description: "Enviar email al lead.",
              parameters: {
                type: "object",
                properties: {
                  subject: { type: "string", description: "Assunto do email" },
                  body: { type: "string", description: "Conteúdo en texto" }
                },
                required: ["subject", "body"]
              }
            }
          });
          agentToolPrompts.push('- send_email: Envie información detalhadas ou propostas');
        }

        if (activeAgent.can_transfer) {
          // ─────────────────────────────────────────────────────────────
          // Build the list of agents this agent is ALLOWED to transfer to.
          // Rule: an agent bound to a product can only transfer within the
          // same product OR to global agents (admin / orchestrator). Global
          // agents themselves can transfer to anyone in the same org.
          // The DB check still runs at execution time — this is just to
          // shape what the model "sees" so it doesn't propose invalid IDs.
          // ─────────────────────────────────────────────────────────────
          const isAdminAgent = activeAgent.agent_type === 'admin';
          const isGlobalAgent = !activeAgent.product_id; // admin/orchestrator
          const orgIdForList = (activeAgent as any).organization_id;

          let allowedAgents: Array<{ id: string; name: string; agent_type: string; product_id: string | null }> = [];
          if (orgIdForList) {
            let agentsQuery = supabase
              .from('product_agents')
              .select('id, name, agent_type, product_id')
              .eq('organization_id', orgIdForList)
              .eq('is_active', true)
              .neq('id', activeAgent.id);

            if (!isGlobalAgent) {
              // Bound agents: same product OR global (product_id IS NULL)
              const sameProduct = activeAgent.product_id;
              agentsQuery = agentsQuery.or(`product_id.eq.${sameProduct},product_id.is.null`);
            }
            // Bots normais no podem chamar admin (Malu es privada do gestor)
            if (!isAdminAgent) {
              agentsQuery = agentsQuery.neq('agent_type', 'admin');
            }

            const { data: agents } = await agentsQuery;
            allowedAgents = agents || [];
          }

          const otherAgents = allowedAgents
            .map((a) => `${a.name} [${a.agent_type}${a.product_id ? '' : ' · global'}] (${a.id})`)
            .join(', ');

          const transferDescription = isAdminAgent
            ? `Vos sos o Agente Admin (gestor). Podés transferir para cualquier agente da organización. Agentes disponibles: ${otherAgents || 'Ninguno'}`
            : isGlobalAgent
            ? `Vos sos um agente global e puede rutear para cualquier agente especialista da organización. NUNCA transferí para agentes do tipo 'admin'. Agentes disponibles: ${otherAgents || 'Ninguno'}`
            : `Transferir conversación para otro agente IA — APENAS dentro do su producto ou para agentes globais (orquestrador). NUNCA transferí para agentes de otros productos nem para el admin. Agentes disponibles: ${otherAgents || 'Ninguno'}`;


          toolsList.push({
            type: "function",
            function: {
              name: "transfer_to_agent",
              description: transferDescription,
              parameters: {
                type: "object",
                properties: {
                  agent_id: { type: "string", description: "ID del agente destino" },
                  reason: { type: "string", description: "Motivo da transferência" }
                },
                required: ["agent_id"]
              }
            }
          });
          toolsList.push({
            type: "function",
            function: {
              name: "transfer_to_human",
              description: "Transferir conversación para atención humano.",
              parameters: {
                type: "object",
                properties: {
                  reason: { type: "string", description: "Motivo da transferência" }
                },
                required: ["reason"]
              }
            }
          });
          agentToolPrompts.push('- transfer_to_agent/transfer_to_human: Escale cuando necessário');
        }

        if (activeAgent.can_notify) {
          toolsList.push({
            type: "function",
            function: {
              name: "notify_team",
              description: "Enviar notificación/alerta para la equipo.",
              parameters: {
                type: "object",
                properties: {
                  message: { type: "string", description: "Mensaje da notificación" },
                  priority: { type: "string", enum: ["low", "medium", "high"], description: "Prioridade" }
                },
                required: ["message"]
              }
            }
          });
          agentToolPrompts.push('- notify_team: Alertá cuando algo urgente requiera atención');
        }

        if (activeAgent.can_add_notes) {
          toolsList.push({
            type: "function",
            function: {
              name: "add_lead_note",
              description: "Adicionar nota interna ao perfil del lead.",
              parameters: {
                type: "object",
                properties: {
                  content: { type: "string", description: "Conteúdo da nota" }
                },
                required: ["content"]
              }
            }
          });
          agentToolPrompts.push('- add_lead_note: Registre información relevantes de la conversación');
        }

        if (activeAgent.can_start_cadence) {
          toolsList.push({
            type: "function",
            function: {
              name: "start_cadence",
              description: "Iniciar cadência automática de follow-up.",
              parameters: {
                type: "object",
                properties: {
                  objective: { type: "string", description: "Objetivo da cadência" },
                  interval_hours: { type: "number", description: "Intervalo em horas entre follow-ups" },
                  max_followups: { type: "number", description: "Máximo de follow-ups" }
                },
                required: ["objective"]
              }
            }
          });
          agentToolPrompts.push('- start_cadence: Inicie follow-up automático quandel lead esfriar');
        }

        if (activeAgent.can_qualify) {
          toolsList.push({
            type: "function",
            function: {
              name: "qualify_lead",
              description: "Registrar calificación BANT del lead.",
              parameters: {
                type: "object",
                properties: {
                  budget: { type: "string", description: "Orçamento disponible" },
                  authority: { type: "string", description: "Nível de decisão" },
                  need: { type: "string", description: "Necessidade identificada" },
                  timeline: { type: "string", description: "Prazo para decisão" }
                },
                required: ["need"]
              }
            }
          });
          agentToolPrompts.push('- qualify_lead: Registre BANT cuando coletar información de calificación');
        }

        // Add tool usage instructions to system prompt
        if (agentToolPrompts.length > 0) {
          systemPrompt += `\n\n🔧 FERRAMENTAS AUTÔNOMAS DISPONÍVEIS:\n${agentToolPrompts.join('\n')}`;
          systemPrompt += `\n\nREGRAS DE USO DAS FERRAMENTAS:
- Execute acciones automaticamente cuando fizer sentido no contexto da conversación
- NÃO peça permiso al lead para acciones internas (tags, notas, temperatura)
- SIEMPRE confirme antes de acciones visíveis al lead (agendar reunión, enviar email)
- Registre información importantes coletadas na conversación usando as ferramentas
- NUNCA mencione al lead que vos sostá usando ferramentas internas`;
        }
      }

      // === CATALOG TOOLS (search + send) — habilita SIEMPRE que org tiver itens ativos
      // (no traba no product_id; busca prioriza producto atual mas faz fallback org-wide)
      try {
        const { data: convForCatalog } = await supabase
          .from('webchat_conversations')
          .select('organization_id')
          .eq('id', body.conversation_id)
          .maybeSingle();
        const orgId = convForCatalog?.organization_id;

        if (orgId) {
          // Cuenta itens ativos da ORG inteira (sem filtrar por producto atual).
          // Assim o agente siempre tiene a tool cuando há catálogo, mismo se o producto
          // de él no tiver itens próprios.
          const { count: orgCatalogCount } = await supabase
            .from('product_catalog_items')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('is_active', true);

          // Cuenta itens do producto atual só pra log/contexto
          let productCatalogCount = 0;
          if (body.product_id) {
            const { count: pc } = await supabase
              .from('product_catalog_items')
              .select('id', { count: 'exact', head: true })
              .eq('organization_id', orgId)
              .eq('product_id', body.product_id)
              .eq('is_active', true);
            productCatalogCount = pc || 0;
          }

          if ((orgCatalogCount || 0) > 0) {
            console.log('[webchat-bot] 📦 Catalog tools enabled — org items:', orgCatalogCount, 'current product items:', productCatalogCount);

            toolsList.push({
              type: "function",
              function: {
                name: "search_catalog",
                description: "Buscar itens no catálogo (imóveis, productos, etc) por texto livre + filtros. Usa cuando o cliente descrever o que procura (ex: 'apto 2 quartos no Batel hasta 600 mil', 'tiene o modelo X?'). Retorna no máximo 5 itens.",
                parameters: {
                  type: "object",
                  properties: {
                    query: { type: "string", description: "Texto livre da busca (ex: 'apartamento 2 quartos batel')" },
                    price_min: { type: "number", description: "Preço mínimo (opcional)" },
                    price_max: { type: "number", description: "Preço máximo (opcional)" },
                    attribute_filters: {
                      type: "object",
                      description: "Filtros por atributo (ex: {bairro:'Batel', quartos:2}). Usa chaves do attributes do catálogo.",
                      additionalProperties: true,
                    },
                    tags: { type: "array", items: { type: "string" }, description: "Tags exigidas (opcional)" },
                    limit: { type: "number", description: "Máximo de resultados (1-5, estándar 3)" },
                  },
                  required: [],
                },
              },
            });

            toolsList.push({
              type: "function",
              function: {
                name: "send_catalog_item",
                description: "Enviar UM item do catálogo al cliente. Por estándar envia solo FOTO + título + precio + link. Usa include_videos=true APENAS se o cliente pediu vídeo/tour/demonstração. Usa include_documents=true APENAS se o cliente pediu ficha/folder/specs/brochura/PDF. Só chame después o cliente CONFIRMAR interesse num item específico retornado por search_catalog. NÃO envie múltiplos itens automaticamente — preguntes antes.",
                parameters: {
                  type: "object",
                  properties: {
                    item_id: { type: "string", description: "ID do item retornado por search_catalog" },
                    caption: { type: "string", description: "Legenda customizada opcional. Se vazio, gera automaticamente." },
                    include_videos: { type: "boolean", description: "Inclui vídeo se disponible. SÓ use se cliente pediu vídeo/tour explicitamente. Default false." },
                    include_documents: { type: "boolean", description: "Inclui PDF/documento se disponible. SÓ use se cliente pediu ficha/folder/PDF/specs. Default false." },
                  },
                  required: ["item_id"],
                },
              },
            });

            systemPrompt += `\n\n📦 CATÁLOGO PESQUISÁVEL DISPONÍVEL (CANAL OFICIAL DE ENVIO DE MÍDIA):
Usted tiene acesso a um catálogo de itens (imóveis/productos) con busca semântica e mídia rica (fotos, vídeos, PDFs, link).
Esse catálogo es o CANAL OFICIAL para entregar fotos, vídeos, fichas e links en este WhatsApp.

🚨 REGRAS PRIORITÁRIAS — VIOLAÇÃO É ERRO GRAVE:
- Se o cliente pedir FOTO, VÍDEO, PDF, FICHA, LINK, SITE, TOUR, PLANTA, FOLDER, BROCHURA, IMAGENS, MATERIAL → usted DEVE chamar search_catalog (se todavía no souber cuál item) e em seguida send_catalog_item. Sem rodeios.
- PROHIBIDO inventar bloqueios. NÃO diga "no posso enviar por aqui", "o sistema restringe", "é off-market", "no está aberto ao público", "precisa de registro prévio", "vou alinhar con especialista", "no tengo acesso", "no está disponible publicamente" se NÃO hay regra explícita registrada. Se o item está no catálogo e ativo, ele PODE e DEVE ser enviado.
- Vos solo podés negar envío si: (a) search_catalog devolvió 0 itens compatibles, OU (b) hay instrucción explícita registrada prohibiéndolo. Em cualquier otro caso, ENVIÁ.
- Se o cliente pediu só "o link", chame send_catalog_item normalmente — o link oficial va junto, ou responda con a URL do item retornado por search_catalog.

REGRAS DE USO:
1. Cliente descreve o que procura (sem pedir mídia ainda) → search_catalog con query + filtros relevantes
2. Cliente pede mídia/link diretamente sobre algo identificável → search_catalog imediato e después send_catalog_item no item correto (no preguntes "qual?" se ya es óbvio por lel mensaje)
3. Apresente no MÁXIMO 3 opciones en texto corto e estratégico cuando hay múltiplos resultados
4. NUNCA invente itens — só fale de itens retornados por search_catalog
5. Cada item tiene flags has_video e has_document. Cuando relevante, OFEREÇA: "Tenho fotos, vídeo do tour e a ficha. Quero te mandar todo ou comenzar por las fotos?"
6. send_catalog_item: por estándar envia FOTO + título + precio + link. Usa include_videos=true se cliente pediu vídeo/tour/demonstração. Usa include_documents=true se pediu ficha/folder/specs/PDF/brochura/planta.
7. Escale con bueno senso: foto → (se interesse) vídeo → (se precisar) documento. Mas se o cliente pediu "manda tudo", mande tudo.
8. Múltiplos itens: um por vez, aguardando reação entre envios.
9. search_catalog vazio → ofrezcas relaxar filtros / otra região / otra faixa. NUNCA invente desculpa de "off-market" ou "restrição".
10. Se o envio falhar por algún motivo técnico, mande por el menos o LINK oficial do item (nunca devolva respuesta vazia).`;
          }
        }
      } catch (catErr) {
        console.warn('[webchat-bot] catalog tools setup failed (non-fatal):', catErr);
      }

      // === REGISTRY TOOLS (Fase 1 — agentes que agem) ===
      // Adiciona as tools modulares do registry centralizado.
      // Só habilita se temos agente ativo (caso contrário no há contexto pra executar).
      // Filtra nomes ya presentes na toolsList legada pra evitar conflito.
      try {
        if (activeAgent) {
          const existingNames = new Set(toolsList.map((t: any) => t?.function?.name).filter(Boolean));
          const registryTools = listRegistryTools();
          const registrySchemas = registryToolsToSchema(registryTools).filter(
            (s) => !existingNames.has(s.function.name),
          );
          if (registrySchemas.length > 0) {
            toolsList.push(...registrySchemas);
            console.log('[webchat-bot] 🧰 Registry tools enabled:', registrySchemas.map((s) => s.function.name).join(', '));
          }
        }
      } catch (regErr) {
        console.warn('[webchat-bot] registry tools setup failed (non-fatal):', regErr);
      }

      const tools = toolsList.length > 0 ? toolsList : undefined;

      // ============================================
      // MEMÓRIA DE AGENDAMENTO — evita reagendar reunión confirmada
      // ============================================
      try {
        const { data: convMeeting } = await supabase
          .from('webchat_conversations')
          .select('meeting_scheduled_at, meeting_metadata')
          .eq('id', body.conversation_id)
          .maybeSingle();
        if (convMeeting?.meeting_scheduled_at) {
          const meetingDate = new Date(convMeeting.meeting_scheduled_at);
          const formatted = meetingDate.toLocaleString('es-PY', {
            weekday: 'long',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Sao_Paulo',
          });
          const meta = convMeeting.meeting_metadata as any;
          const extra = meta?.attendee_email ? ` (confirmação enviada para ${meta.attendee_email})` : '';
          systemPrompt +=
            `\n\n📅 REUNIÃO JÁ AGENDADA NESTA CONVERSA: ${formatted}${extra}.\n` +
            `REGRA CRÍTICA: NUNCA proponha um novo horario. NUNCA preguntes "prefere 09h ou 12h?". ` +
            `A reunión ya fue confirmada. Solo siga la conversación normalmente focando no producto/objeção del cliente. ` +
            `Só sugira remarcar se o cliente pedir explicitamente para mudar o horario.`;
          console.log('[webchat-bot] Meeting context injected:', formatted);
        }
      } catch (meetErr) {
        console.warn('[webchat-bot] meeting context check failed (non-fatal):', meetErr);
      }

      // ============================================
      // SPRINT 2 — Memória semântica + Supervisor
      // ============================================
      // Buscar memorias relevantes del lead (silencioso em caso de falla)
      try {
        const convInfo: any = await supabase
          .from('webchat_conversations')
          .select('lead_id, organization_id')
          .eq('id', body.conversation_id)
          .maybeSingle();
        const leadId = convInfo?.data?.lead_id;
        const orgId = convInfo?.data?.organization_id;

        if (leadId && orgId) {
          // 1) Retrieval: busca memorias relevantes
          const memResp = await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/memory-search`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({
                lead_id: leadId,
                query: body.message,
                match_count: 5,
                min_similarity: 0.55,
              }),
            },
          );
          if (memResp.ok) {
            const memData = await memResp.json();
            const memories = memData?.memories ?? [];
            if (memories.length > 0) {
              const memBlock = memories
                .map(
                  (m: any) =>
                    `- [${m.source}${m.role ? `/${m.role}` : ''}] ${m.content.slice(0, 280)}`,
                )
                .join('\n');
              systemPrompt +=
                `\n\n🧠 MEMÓRIA SEMÂNTICA (contexto historial relevante de este cliente):\n${memBlock}\n\nUse essas información para personalizar su respuesta sin repetir o que ele ya disse.`;
              console.log('[webchat-bot] Injected', memories.length, 'memories into prompt');
            }
          }

          // 2) Persistência fire-and-forget: salvel mensaje do usuario como memoria
          fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/memory-embedder`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({
                lead_id: leadId,
                organization_id: orgId,
                conversation_id: body.conversation_id,
                content: body.message,
                source: 'message',
                role: 'user',
                importance_score: 0.6,
              }),
            },
          ).catch((e) => console.warn('[webchat-bot] embed user msg failed:', e));
        }
      } catch (memErr) {
        console.warn('[webchat-bot] memory layer failed (non-fatal):', memErr);
      }

      // ============================================
      // SPRINT 3 — A/B Testing de prompts
      // ============================================
      let activeVariantId: string | null = null;
      try {
        const convInfo2: any = await supabase
          .from('webchat_conversations')
          .select('lead_id, organization_id')
          .eq('id', body.conversation_id)
          .maybeSingle();
        const orgId2 = convInfo2?.data?.organization_id;
        const seed = convInfo2?.data?.lead_id || body.conversation_id;

        if (orgId2 && seed) {
          const pickResp = await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/prompt-experiment-pick`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({
                organization_id: orgId2,
                agent_id: activeAgent?.id ?? null,
                seed,
              }),
            },
          );
          if (pickResp.ok) {
            const pickData = await pickResp.json();
            const variant = pickData?.variant;
            if (variant?.prompt_override) {
              activeVariantId = variant.id;
              if (variant.prompt_mode === 'replace') {
                systemPrompt = variant.prompt_override;
              } else {
                systemPrompt += `\n\n🧪 VARIANTE ${variant.label}:\n${variant.prompt_override}`;
              }
              console.log('[webchat-bot] A/B variant active:', variant.label, variant.id);
            }
          }
        }
      } catch (abErr) {
        console.warn('[webchat-bot] A/B picker failed (non-fatal):', abErr);
      }

      // Call Lovable AI Gateway
      try {
        const temperature = body.agent_config.temperature ?? 0.7;
        const maxTokens = body.agent_config.max_tokens ?? 800;
        // Resolución completa: provider + model + endpoint + key vindo de
        // Configurações > Integrações > Roteamento de IA. Se a org tiver chave
        // externa (ex.: OpenAI) configurada, chamamos direto o provedor — sem
        // gastar créditos Lovable.
        let orgIdForRouting = (activeAgent as any)?.organization_id || null;
        if (!orgIdForRouting && body.conversation_id) {
          const { data: convForRouting } = await supabase
            .from('webchat_conversations')
            .select('organization_id')
            .eq('id', body.conversation_id)
            .maybeSingle();
          orgIdForRouting = convForRouting?.organization_id || null;
        }
        if (!orgIdForRouting && body.product_id) {
          const { data: productForRouting } = await supabase
            .from('products')
            .select('organization_id')
            .eq('id', body.product_id)
            .maybeSingle();
          orgIdForRouting = productForRouting?.organization_id || null;
        }
        let aiConfig: ResolvedAIConfig;
        try {
          aiConfig = await resolveAIConfig(supabase, orgIdForRouting, 'agent_chat');
        } catch (cfgErr: any) {
          console.error('[webchat-bot] AI config error:', cfgErr?.message);
          return new Response(JSON.stringify({
            error: 'ai_provider_not_configured',
            message: cfgErr?.message || 'Provedor de IA no configurado e fallback desativado.',
          }), { status: 412, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const agentModel = aiConfig.model;

        logAIConfig('webchat-bot', aiConfig);
        console.log('[webchat-bot] Agent:', activeAgent?.name);
        console.log('[webchat-bot] Temperature:', temperature, 'Max tokens:', maxTokens);
        console.log('[webchat-bot] Tools enabled:', !!tools);

        // === ANTI-HALLUCINATION RAILS (mandatory, last in system prompt) ===
        // Two real bugs we are protecting against:
        //  1. The AI "becoming" another agent because the conversation history
        //     contains messages from a previous specialist (e.g. Sofia/Poupe Ya)
        //     that drifted into a Natan/ihMob conversation. The agent must keep
        //     ITS identity regardless of what was said before.
        //  2. The AI pretending it heard an audio or saw an image even though
        //     no transcription/description was generated (the placeholder
        //     "[Audio recibido — no pude transcribir]" arrives in chat).
        const fixedAgentName = activeAgent?.name || body.agent_config?.agent_name || 'Assistente';
        const identityRail =
          `\n\n=== REGRAS CRÍTICAS DE IDENTIDADE E HONESTIDADE (NÃO QUEBRAR) ===\n` +
          `1. Vos sos EXCLUSIVAMENTE "${fixedAgentName}". Mantenha SIEMPRE este nombre, papel e empresa.\n` +
          `2. Mensagens anteriores no historial podem ter sido escritas por OUTRO agente que cuidou del cliente antes. IGNORE personas, ofertas, productos ou nomes próprios mencionados en esas mensajes passadas se conflitarem con a su identidade atual.\n` +
          `3. Se o cliente preguntar su nombre, responda APENAS con "${fixedAgentName}".\n` +
          `4. NUNCA finjas que escuchaste un audio o viste una imagen. Se a últimel mensaje del cliente for un placeholder do tipo "🎙️ [Audio recibido — no pude transcribir...]" ou "🖼️ [Imagen recibida — no pude analizar...]", responda DICIENDO QUE TUVO PROBLEMA TÉCNICO PARA ESCUCHAR/VER e pedile al cliente que reenvíe o describa en texto. NO inventes contenido.\n` +
          `5. Cuando el mensaje comenzar con "🎙️ Áudio del cliente (transcrito):" ou "🖼️ Imagen del cliente:", essa É el mensaje real del cliente — trate como tal.\n`;

        const finalSystemPrompt = systemPrompt + identityRail;

        const requestBody: any = {
          model: agentModel,
          messages: [
            { role: 'system', content: finalSystemPrompt },
            ...conversationHistory,
            { role: 'user', content: body.message },
          ],
          max_tokens: maxTokens,
          temperature: temperature,
        };

        if (tools) {
          requestBody.tools = tools;
        }

        const aiResponse = await fetch(aiConfig.endpoint, {
          method: 'POST',
          headers: aiConfig.headers,
          body: JSON.stringify(prepareAIRequestBody(requestBody, aiConfig)),
        });

        console.log('[webchat-bot] AI response status:', aiResponse.status);

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          await recordAIUsage(supabase, orgIdForRouting, aiConfig, 'agent_chat', aiData?.usage, 'webchat-bot');
          const choice = aiData.choices?.[0];
          
          // Check if AI used tool calling
          let responseVideoUrl: string | null = null;
          let scheduleSucceeded = false; // anti-hallucination guard
          
          if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
            const toolCall = choice.message.tool_calls[0];
            console.log('[webchat-bot] Tool call detected:', toolCall.function.name);
            
            // Redirect loop: lets the deterministic shortcut in check_available_slots
            // mutate toolCall to schedule_meeting and re-enter the dispatch chain ONCE.
            let __redirectAttempts = 0;
            while (__redirectAttempts < 2) {
              const __previousToolName = toolCall.function.name;
              __redirectAttempts++;
            if (toolCall.function.name === 'send_cta_buttons') {
              try {
                const args = JSON.parse(toolCall.function.arguments);
                responseContent = args.message || '';
                
                // Build buttons from CTA IDs
                const selectedCTAs = productCTAs.filter(c => args.cta_ids?.includes(c.id));
                responseButtons = selectedCTAs.map((cta, index) => ({
                  id: cta.id,
                  label: cta.label,
                  type: mapCTATypeToButtonType(cta.cta_type),
                  action: getButtonAction(cta),
                  style: index === 0 ? 'primary' as const : 'secondary' as const,
                  cta_type: cta.cta_type,
                }));
                
                console.log('[webchat-bot] Generated buttons:', responseButtons.length);
              } catch (parseError) {
                console.error('[webchat-bot] Error parsing tool arguments:', parseError);
                responseContent = choice.message?.content || body.agent_config.fallback_message;
              }
            } else if (toolCall.function.name === 'send_video') {
              try {
                const args = JSON.parse(toolCall.function.arguments);
                responseContent = args.message || '';
                
                // Find the video CTA
                const videoCTA = productCTAs.find(c => c.id === args.video_id);
                if (videoCTA && videoCTA.video_url) {
                  responseVideoUrl = videoCTA.video_url;
                  console.log('[webchat-bot] Sending video:', responseVideoUrl);
                }
              } catch (parseError) {
                console.error('[webchat-bot] Error parsing video arguments:', parseError);
                responseContent = choice.message?.content || body.agent_config.fallback_message;
              }
            } else if (toolCall.function.name === 'search_catalog') {
              try {
                const args = JSON.parse(toolCall.function.arguments || '{}');
                const { data: convForCat } = await supabase
                  .from('webchat_conversations')
                  .select('organization_id')
                  .eq('id', body.conversation_id)
                  .maybeSingle();

                const filtersPayload = {
                  price_min: args.price_min,
                  price_max: args.price_max,
                  attribute_filters: args.attribute_filters,
                  tags: args.tags,
                };
                const limitPayload = Math.min(args.limit || 3, 5);

                // 1ª tentativa: priorizar producto atual (se hay)
                let { data: searchData, error: searchErr } = await supabase.functions.invoke('catalog-search', {
                  body: {
                    organization_id: convForCat?.organization_id,
                    product_id: body.product_id || null,
                    query: args.query || '',
                    filters: filtersPayload,
                    limit: limitPayload,
                  },
                });

                let items = (searchData as any)?.items || [];
                console.log('[webchat-bot] 📦 catalog-search (product scope) returned', items.length, 'items');

                // 2ª tentativa: fallback org-wide se o producto atual no trouxe nada
                if (items.length === 0 && body.product_id) {
                  const { data: orgSearchData } = await supabase.functions.invoke('catalog-search', {
                    body: {
                      organization_id: convForCat?.organization_id,
                      product_id: null,
                      query: args.query || '',
                      filters: filtersPayload,
                      limit: limitPayload,
                    },
                  });
                  items = (orgSearchData as any)?.items || [];
                  console.log('[webchat-bot] 📦 catalog-search (org-wide fallback) returned', items.length, 'items');
                }

                // Detect if user EXPLICITLY asked for media in the current message
                const userMsgLower = (body.message || '').toLowerCase();
                const mediaIntentRegex = /\b(foto|fotos|imagen|imagens|video|vídeo|videos|vídeos|tour|planta|pdf|ficha|folder|brochura|material|materiais|link|site|envia|manda|mandar|enviar|envie|me\s+manda|me\s+envia|quero\s+ver|posso\s+ver)\b/i;
                const explicitMediaRequest = mediaIntentRegex.test(userMsgLower);
                const wantsVideo = /\b(video|vídeo|tour|demonstr)/i.test(userMsgLower);
                const wantsDoc = /\b(pdf|ficha|folder|brochura|planta|specs)/i.test(userMsgLower);

                let toolResultText: string;
                if (items.length === 0) {
                  toolResultText = 'Ninguno item encontrado con esses critérios. Sugiere al cliente relaxar filtros ou explorar alternativas. NÃO invente desculpa de "off-market" ou "restrição".';
                } else if (explicitMediaRequest) {
                  // User asked for media → IA must send NOW, not ask
                  const topItem = items[0];
                  toolResultText = `ITENS ENCONTRADOS NO CATÁLOGO (use o id cuando for chamar send_catalog_item):\n${JSON.stringify(items, null, 2)}\n\n🚨 O CLIENTE JÁ PEDIU MÍDIA EXPLICITAMENTE NESTA MENSAGEM ("${body.message}"). VOS DEVE CHAMAR send_catalog_item AGORA con item_id="${topItem.id}"${wantsVideo ? ' e include_videos=true' : ''}${wantsDoc ? ' e include_documents=true' : ''}. NÃO PERGUNTE "qual interessa?" — envie direto. Se hay múltiplos itens mucho relevantes, elegí o que mais combina con o pedido. No devolva texto explicando — chame a tool send_catalog_item.`;
                } else {
                  toolResultText = `ITENS ENCONTRADOS NO CATÁLOGO (use o id cuando for chamar send_catalog_item):\n${JSON.stringify(items, null, 2)}\n\nApresente no máximo 3 opciones de forma corta e estratégica. Pergunte cuál interessa antes de chamar send_catalog_item.`;
                }

                // Follow-up: deixa a IA formatar a respuesta — COM tools habilitadas
                // para que ela possa chamar send_catalog_item no mismo ciclo.
                const followUpBody: any = {
                  model: agentModel,
                  messages: [
                    { role: 'system', content: systemPrompt },
                    ...conversationHistory,
                    { role: 'user', content: body.message },
                    { role: 'assistant', content: null, tool_calls: [toolCall] },
                    { role: 'tool', tool_call_id: toolCall.id, content: toolResultText },
                  ],
                  max_tokens: 500,
                  temperature: 0.5,
                };
                if (tools) followUpBody.tools = tools;
                // Force tool use when media was explicitly requested
                if (explicitMediaRequest && items.length > 0) {
                  followUpBody.tool_choice = { type: 'function', function: { name: 'send_catalog_item' } };
                }

                const followUp = await fetch(aiConfig.endpoint, {
                  method: 'POST',
                  headers: aiConfig.headers,
                  body: JSON.stringify(prepareAIRequestBody(followUpBody, aiConfig)),
                });

                if (followUp.ok) {
                  const fuData = await followUp.json();
                  await recordAIUsage(supabase, orgIdForRouting, aiConfig, 'agent_chat', fuData?.usage, 'webchat-bot:followup');
                  const fuChoice = fuData.choices?.[0];
                  const fuToolCall = fuChoice?.message?.tool_calls?.[0];

                  if (fuToolCall?.function?.name === 'send_catalog_item') {
                    // Chain: execute send_catalog_item right now
                    console.log('[webchat-bot] 📦 follow-up triggered send_catalog_item, chaining…');
                    try {
                      const sendArgs = JSON.parse(fuToolCall.function.arguments || '{}');
                      if (!sendArgs.item_id && items.length > 0) sendArgs.item_id = items[0].id;
                      if (explicitMediaRequest && wantsVideo) sendArgs.include_videos = true;
                      if (explicitMediaRequest && wantsDoc) sendArgs.include_documents = true;

                      const { data: sendData, error: sendErr } = await supabase.functions.invoke('send-catalog-item', {
                        body: {
                          conversation_id: body.conversation_id,
                          item_id: sendArgs.item_id,
                          caption_override: sendArgs.caption || null,
                          send_videos: sendArgs.include_videos === true,
                          send_documents: sendArgs.include_documents === true,
                        },
                      });

                      if (sendErr) {
                        console.error('[webchat-bot] chained send_catalog_item error:', sendErr);
                        const fallbackItem = items.find((i: any) => i.id === sendArgs.item_id) || items[0];
                        responseContent = fallbackItem?.url
                          ? `Aqui está: ${fallbackItem.title} — ${fallbackItem.url}`
                          : 'Houve um problema al enviar. Posso te mandar o link manualmente?';
                      } else {
                        const sent = sendData as any;
                        console.log('[webchat-bot] 📦 chained catalog item sent:', sent?.delivered, sent?.delivery_channel, sent?.sent_counts);
                        const counts = sent?.sent_counts || {};
                        const parts: string[] = [];
                        if (counts.images) parts.push(`${counts.images} foto${counts.images > 1 ? 's' : ''}`);
                        if (counts.videos) parts.push(`${counts.videos} vídeo`);
                        if (counts.documents) parts.push(`${counts.documents} documento`);
                        const summary = parts.length > 0 ? parts.join(' + ') : 'os detalles';
                        responseContent = sent?.delivered
                          ? `Acabei de te mandar ${summary} de ${sent?.item?.title || 'o imóvel'}. O que achou?`
                          : `Aqui está: ${sent?.item?.title || 'item'}${sent?.item?.url ? ` — ${sent.item.url}` : ''}. O que achou?`;
                      }
                    } catch (chainErr) {
                      console.error('[webchat-bot] chain send_catalog_item exception:', chainErr);
                      const fallbackItem = items[0];
                      responseContent = fallbackItem?.url
                        ? `Aqui está: ${fallbackItem.title} — ${fallbackItem.url}`
                        : 'No consegui enviar ahora. Quer que eu tente novamente?';
                    }
                  } else {
                    // Plain text response from follow-up
                    responseContent = fuChoice?.message?.content || toolResultText;
                    // Safety net: if user asked for media but model returned text only,
                    // force-send the top item with link as fallback.
                    if (explicitMediaRequest && items.length > 0 && !fuToolCall) {
                      console.log('[webchat-bot] ⚠️ Model ignored forced tool_choice — falling back to direct send');
                      try {
                        const topItem = items[0];
                        const { data: sendData } = await supabase.functions.invoke('send-catalog-item', {
                          body: {
                            conversation_id: body.conversation_id,
                            item_id: topItem.id,
                            send_videos: wantsVideo,
                            send_documents: wantsDoc,
                          },
                        });
                        const sent = sendData as any;
                        const counts = sent?.sent_counts || {};
                        const parts: string[] = [];
                        if (counts.images) parts.push(`${counts.images} foto${counts.images > 1 ? 's' : ''}`);
                        if (counts.videos) parts.push(`${counts.videos} vídeo`);
                        if (counts.documents) parts.push(`${counts.documents} documento`);
                        const summary = parts.length > 0 ? parts.join(' + ') : 'os detalles';
                        responseContent = sent?.delivered
                          ? `Acabei de te mandar ${summary} de ${topItem.title}. O que achou?`
                          : `Aqui está: ${topItem.title}${topItem.url ? ` — ${topItem.url}` : ''}. O que achou?`;
                      } catch (e) {
                        console.error('[webchat-bot] fallback direct send failed:', e);
                      }
                    }
                  }
                } else {
                  responseContent = items.length === 0
                    ? 'No encontrei itens con esses critérios. Quer ajustar a busca?'
                    : `Achei ${items.length} ${items.length === 1 ? 'opción' : 'opciones'} pra usted. Quer que eu envie os detalles?`;
                }
              } catch (catErr) {
                console.error('[webchat-bot] search_catalog error:', catErr);
                responseContent = 'No consegui consultar o catálogo ahora. Pode descrever melhor o que procura?';
              }
            } else if (toolCall.function.name === 'send_catalog_item') {
              try {
                const args = JSON.parse(toolCall.function.arguments || '{}');
                if (!args.item_id) {
                  responseContent = choice.message?.content || 'Posso te enviar mais detalles? Confirma cuál te interessa?';
                } else {
                  const { data: sendData, error: sendErr } = await supabase.functions.invoke('send-catalog-item', {
                    body: {
                      conversation_id: body.conversation_id,
                      item_id: args.item_id,
                      caption_override: args.caption || null,
                      send_videos: args.include_videos === true,
                      send_documents: args.include_documents === true,
                    },
                  });

                  if (sendErr) {
                    console.error('[webchat-bot] send_catalog_item error:', sendErr);
                    responseContent = 'Houve um problema al enviar o item. Posso te mandar o link manualmente?';
                  } else {
                    const sent = sendData as any;
                    console.log('[webchat-bot] 📦 catalog item sent:', sent?.delivered, sent?.delivery_channel, sent?.sent_counts);
                    const counts = sent?.sent_counts || {};
                    const parts: string[] = [];
                    if (counts.images) parts.push(`${counts.images} foto${counts.images > 1 ? 's' : ''}`);
                    if (counts.videos) parts.push(`${counts.videos} vídeo`);
                    if (counts.documents) parts.push(`${counts.documents} documento`);
                    const summary = parts.length > 0 ? parts.join(' + ') : 'os detalles';
                    responseContent = sent?.delivered
                      ? `Acabei de te mandar ${summary}. O que achou?`
                      : `Aqui está: ${sent?.item?.title || 'item'}${sent?.item?.url ? ` — ${sent.item.url}` : ''}. O que achou?`;
                  }
                }
              } catch (catErr) {
                console.error('[webchat-bot] send_catalog_item exception:', catErr);
                responseContent = 'No consegui enviar ahora. Quer que eu tente novamente?';
              }
            } else if (toolCall.function.name === 'check_available_slots' && scheduleUserId) {
              try {
                const args = JSON.parse(toolCall.function.arguments);
                const daysAhead = Math.min(args.days_ahead || 3, 7);
                console.log('[webchat-bot] Checking available slots for next', daysAhead, 'days');

                // ============================================================
                // FIX 2 — GUARD: block redundant check_available_slots if we
                // already offered slots in the last 60 minutes. Force the
                // model to use schedule_meeting instead.
                // ============================================================
                const { data: recentMsgs } = await supabase
                  .from('webchat_messages')
                  .select('metadata, created_at')
                  .eq('conversation_id', body.conversation_id)
                  .eq('direction', 'outbound')
                  .order('created_at', { ascending: false })
                  .limit(5);

                const recentSlotMsg = (recentMsgs || []).find((m: any) =>
                  m.metadata?.scheduling_context?.action === 'slots_offered'
                );
                const slotMsgAgeMin = recentSlotMsg
                  ? (Date.now() - new Date(recentSlotMsg.created_at).getTime()) / 60000
                  : Infinity;

                let skipSlotSearch = false;
                if (recentSlotMsg && slotMsgAgeMin < 60) {
                  const offered = recentSlotMsg.metadata.scheduling_context.suggestions || [];
                  const guestEmail = leadContext?.email || capturedFromMessage.email || '';
                  const guestName = leadContext?.name || body.visitor_name || 'Cliente';

                  console.log('[webchat-bot] 🛑 BLOCKING redundant check_available_slots — slots already offered', slotMsgAgeMin.toFixed(1), 'min ago');

                  // Try to deterministically match user's confirmation against offered slots
                  const userMsgLower = (body.message || '').toLowerCase();
                  let matchedSlot: any = null;
                  for (let i = 0; i < offered.length; i++) {
                    const s = offered[i];
                    const timeNorm = s.time.replace(':', '');
                    const timeAlt = s.time.replace(':', 'h');
                    if (userMsgLower.includes(s.time) ||
                        userMsgLower.includes(timeNorm) ||
                        userMsgLower.includes(timeAlt) ||
                        (i === 0 && /\b(primeir|opción 1|opcao 1|primeira|primeiro)\b/.test(userMsgLower)) ||
                        (i === 1 && /\b(segund|opción 2|opcao 2|segunda)\b/.test(userMsgLower))) {
                      matchedSlot = s;
                      break;
                    }
                  }

                  if (matchedSlot && guestEmail) {
                    // Deterministic shortcut: rewrite this toolCall as schedule_meeting
                    // and let the schedule_meeting branch below execute it.
                    toolCall.function.name = 'schedule_meeting';
                    toolCall.function.arguments = JSON.stringify({
                      guest_name: guestName,
                      guest_email: guestEmail,
                      preferred_date: matchedSlot.date,
                      preferred_time: matchedSlot.time,
                    });
                    console.log('[webchat-bot] 🔁 Deterministic redirect → schedule_meeting', matchedSlot.date, matchedSlot.time);
                    // skipSlotSearch stays false here, but the dispatch below uses if-else;
                    // we set skipSlotSearch=true and re-route by finishing this branch
                    // and letting a small inline schedule_meeting trigger run.
                    skipSlotSearch = true;
                  } else if (!guestEmail) {
                    responseContent = 'Pra eu trabar esse horario pra usted, cuál o melhor email pra mandar a confirmação?';
                    skipSlotSearch = true;
                  } else {
                    // Have email but couldn't match slot text → ask short clarification
                    const opts = offered.map((s: any, i: number) => `${i + 1}) ${s.dateLabel || s.date} às ${s.time}`).join(' ou ');
                    responseContent = `Qual de esos prefere: ${opts}?`;
                    skipSlotSearch = true;
                  }
                }

                if (!skipSlotSearch) {




                // Find event type — usa allowedEventTypes se disponible (vinculado al agente),
                // senão fallback para el primeiro ativo do host
                let eventType: any = null;
                if (allowedEventTypes.length > 0) {
                  eventType = allowedEventTypes[0];
                } else {
                  const { data: et } = await supabase
                    .from('booking_event_types')
                    .select('*')
                    .eq('user_id', scheduleUserId)
                    .eq('is_active', true)
                    .order('created_at', { ascending: true })
                    .limit(1)
                    .single();
                  eventType = et;
                }

                if (!eventType) {
                  responseContent = 'No momento no tengo horários configurados. Posso verificar alternativas para usted?';
                } else {
                  const today = new Date();
                  const allSlots: Array<{ date: string; dateLabel: string; time: string; period: 'morning' | 'afternoon' }> = [];

                  for (let d = 0; d < daysAhead; d++) {
                    const checkDate = new Date(today);
                    checkDate.setDate(today.getDate() + d);
                    const dateStr = checkDate.toISOString().split('T')[0];
                    const dayOfWeek = checkDate.getDay();

                    // Skip if today and already past business hours
                    if (d === 0 && today.getHours() >= 18) continue;

                    // Fetch weekly availability
                    const { data: weeklyAvail } = await supabase
                      .from('user_availability')
                      .select('*')
                      .eq('user_id', scheduleUserId)
                      .eq('day_of_week', dayOfWeek)
                      .eq('is_available', true);

                    // Check overrides
                    const { data: override } = await supabase
                      .from('availability_overrides')
                      .select('*')
                      .eq('user_id', scheduleUserId)
                      .eq('date', dateStr)
                      .maybeSingle();

                    if (override && !override.is_available) continue;

                    let timeRanges: { start: string; end: string }[] = [];
                    if (override?.is_available && override.start_time && override.end_time) {
                      timeRanges = [{ start: override.start_time, end: override.end_time }];
                    } else if (weeklyAvail && weeklyAvail.length > 0) {
                      timeRanges = weeklyAvail.map((a: any) => ({ start: a.start_time, end: a.end_time }));
                    }

                    if (timeRanges.length === 0) continue;

                    // Fetch existing events
                    const { data: existingEvents } = await supabase
                      .from('calendar_events')
                      .select('start_time, end_time')
                      .eq('user_id', scheduleUserId)
                      .neq('status', 'cancelled')
                      .gte('start_time', `${dateStr}T00:00:00`)
                      .lte('start_time', `${dateStr}T23:59:59`);

                    const duration = eventType.duration_minutes;
                    const bufferBefore = eventType.buffer_before || 0;
                    const bufferAfter = eventType.buffer_after || 0;
                    const minNoticeHours = eventType.min_notice_hours || 0;
                    const minNoticeTime = new Date(today.getTime() + minNoticeHours * 60 * 60 * 1000);

                    const dateLabel = checkDate.toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long' });

                    for (const range of timeRanges) {
                      const [startH, startM] = range.start.split(':').map(Number);
                      const [endH, endM] = range.end.split(':').map(Number);
                      let cur = startH * 60 + startM;
                      const endMin = endH * 60 + endM;

                      while (cur + duration <= endMin) {
                        const slotH = Math.floor(cur / 60);
                        const slotM = cur % 60;
                        const timeStr = `${slotH.toString().padStart(2, '0')}:${slotM.toString().padStart(2, '0')}`;
                        // BRT (-03:00) explicit so comparison with minNoticeTime is correct
                        const slotDT = new Date(`${dateStr}T${timeStr}:00-03:00`);

                        if (slotDT < minNoticeTime) { cur += 30; continue; }

                        let conflict = false;
                        for (const ev of existingEvents || []) {
                          const evS = new Date(ev.start_time);
                          const evE = new Date(ev.end_time);
                          // Convert evt to minutes-of-day in BRT to compare with cur (which is BRT minutes)
                          const evSBrt = new Date(evS.getTime() - 3 * 3600_000);
                          const evEBrt = new Date(evE.getTime() - 3 * 3600_000);
                          const evSM = evSBrt.getUTCHours() * 60 + evSBrt.getUTCMinutes() - bufferBefore;
                          const evEM = evEBrt.getUTCHours() * 60 + evEBrt.getUTCMinutes() + bufferAfter;
                          if (cur < evEM && cur + duration > evSM) { conflict = true; break; }
                        }

                        if (!conflict) {
                          allSlots.push({
                            date: dateStr,
                            dateLabel,
                            time: timeStr,
                            period: slotH < 12 ? 'morning' : 'afternoon',
                          });
                        }
                        cur += 30;
                      }
                    }

                    // If we found enough slots, stop searching
                    if (allSlots.length >= 10) break;
                  }

                  // Strategic selection: pick 1 morning + 1 afternoon slot, preferring same/next day
                  const morningSlots = allSlots.filter(s => s.period === 'morning');
                  const afternoonSlots = allSlots.filter(s => s.period === 'afternoon');

                  const suggestions: typeof allSlots = [];
                  if (morningSlots.length > 0) suggestions.push(morningSlots[0]);
                  if (afternoonSlots.length > 0) suggestions.push(afternoonSlots[0]);
                  // Fallback: if only one period available, pick 2 from same period
                  if (suggestions.length === 0 && allSlots.length > 0) {
                    suggestions.push(allSlots[0]);
                    if (allSlots.length > 1) suggestions.push(allSlots[1]);
                  } else if (suggestions.length === 1 && allSlots.length > 1) {
                    const extra = allSlots.find(s => s.time !== suggestions[0].time || s.date !== suggestions[0].date);
                    if (extra) suggestions.push(extra);
                  }

                  if (suggestions.length === 0) {
                    responseContent = 'Infelizmente no encontrei horários disponibles nos próximos días. Posso verificar otras opciones para usted?';
                  } else {
                    // Save scheduling context as metadata for persistence
                    schedulingMetadata = {
                      scheduling_context: {
                        action: 'slots_offered',
                        suggestions: suggestions.map(s => ({
                          date: s.date,
                          time: s.time,
                          period: s.period,
                          dateLabel: s.dateLabel,
                        })),
                        event_type_id: eventType.id,
                        schedule_user_id: scheduleUserId,
                      }
                    };
                    console.log('[webchat-bot] Saved scheduling metadata with', suggestions.length, 'suggestions');

                    // Build a natural response for the AI to relay
                    let slotsInfo = '📅 HORÁRIOS DISPONÍVEIS ENCONTRADOS:\n';
                    suggestions.forEach((s, i) => {
                      slotsInfo += `\nOpção ${i + 1}: ${s.dateLabel} às ${s.time} (${s.period === 'morning' ? 'manhã' : 'tarde'}) [data: ${s.date}]`;
                    });
                    slotsInfo += '\n\nApresente esses horários al cliente de forma natural e estratégica. NÃO mostrá o formato de data técnico (YYYY-MM-DD).';

                    // FIX 3: slim follow-up prompt — drop emailEnforcement, anti-CTAs etc.
                    // We only want a clean "present these slots and ask which one" reply.
                    const slimAgentName = activeAgent?.name || 'Assistente';
                    const slimAgentPersona = activeAgent?.personality || 'consultivo, claro e cordial';
                    const slimFollowUpSystem = `Vos sos ${slimAgentName}. Tom: ${slimAgentPersona}.\n\nApresente os horários encontrados de forma natural, corta (no máximo 2 linhas) e preguntes cuál o cliente prefere. NUNCA preguntes o email novamente — usted ya tiene ou pedirá después. NUNCA diga "deixa eu ver a agenda" — usted acabou de ver. NUNCA invente otros horários além dos fornecidos.`;

                    // Make a follow-up call to the AI with the slot info
                    const followUpResponse = await fetch(aiConfig.endpoint, {
                      method: 'POST',
                      headers: aiConfig.headers,
                      body: JSON.stringify(prepareAIRequestBody({
                        model: agentModel,
                        messages: [
                          { role: 'system', content: slimFollowUpSystem },
                          { role: 'user', content: body.message },
                          { role: 'assistant', content: null, tool_calls: [toolCall] },
                          { role: 'tool', tool_call_id: toolCall.id, content: slotsInfo },
                        ],
                        max_tokens: 200,
                        temperature: 0.6,
                      }, aiConfig)),
                    });

                    if (followUpResponse.ok) {
                      const followUpData = await followUpResponse.json();
                      await recordAIUsage(supabase, orgIdForRouting, aiConfig, 'agent_chat', followUpData?.usage, 'webchat-bot:schedule-followup');
                      responseContent = followUpData.choices?.[0]?.message?.content || slotsInfo;
                    } else {
                      // Fallback: present slots directly
                      responseContent = suggestions.map((s, i) => 
                        `Opción ${i + 1}: ${s.dateLabel} às ${s.time}`
                      ).join('\n');
                      responseContent = `Encontrei esses horários disponibles:\n\n${responseContent}\n\nQual funciona melhor pra usted?`;
                    }
                  }
                }
                } // end if (!skipSlotSearch)
                console.log('[webchat-bot] Available slots check completed');
              } catch (slotsError) {
                console.error('[webchat-bot] Check slots error:', slotsError);
                responseContent = 'No consegui verificar a agenda ahora. Posso tentar novamente ou transferir para um agente?';
              }
            } else if (toolCall.function.name === 'schedule_meeting' && scheduleUserId) {
              try {
                const args = JSON.parse(toolCall.function.arguments);
                console.log('[webchat-bot] Schedule meeting requested:', args);
                
                // Find event type for this user.
                // Se o cliente passou event_type_id (escolheu entre múltiplos), prioriza esse.
                // Senão usa allowedEventTypes[0] (vínculo del agente) ou fallback para el mais antigo.
                let eventType: any = null;
                const requestedEtId = (args as any).event_type_id;
                if (requestedEtId && allowedEventTypes.length > 0) {
                  eventType = allowedEventTypes.find((e: any) => e.id === requestedEtId) || null;
                }
                if (!eventType && allowedEventTypes.length > 0) {
                  eventType = allowedEventTypes[0];
                }
                if (!eventType) {
                  const { data: et } = await supabase
                    .from('booking_event_types')
                    .select('*')
                    .eq('user_id', scheduleUserId)
                    .eq('is_active', true)
                    .order('created_at', { ascending: true })
                    .limit(1)
                    .single();
                  eventType = et;
                }
                
                if (eventType) {
                  // Combine date and time into ISO string — BRT offset (-03:00) explicit
                  // so a string like "14:00" stays as 14:00 BRT (17:00 UTC) and NOT as 14:00 UTC (11:00 BRT).
                  const startTime = new Date(`${args.preferred_date}T${args.preferred_time}:00-03:00`);
                  const endTime = new Date(startTime.getTime() + eventType.duration_minutes * 60000);
                  
                  // Get user's org
                   const { data: hostProfile } = await supabase
                    .from('profiles')
                    .select('organization_id, full_name')
                    .eq('id', scheduleUserId)
                    .single();
                  
                  if (hostProfile) {
                    // Create calendar event (NUNCA enviar campos que no existem na tabela calendar_events,
                    // ex.: location_details — isso fazia o insert falhar silenciosamente e o reserva
                    // ficava sin vínculo con a agenda interna nem ia para el Google).
                    const locationDetailsText = eventType.location_details
                      ? (typeof eventType.location_details === 'string'
                          ? eventType.location_details
                          : JSON.stringify(eventType.location_details))
                      : null;

                    const baseDescription = `Agendado via chat AI\nCliente: ${args.guest_name}\nEmail: ${args.guest_email}${args.guest_phone ? `\nTelefone: ${args.guest_phone}` : ''}`;
                    const fullDescription = locationDetailsText
                      ? `${baseDescription}\n\nLocal: ${locationDetailsText}`
                      : baseDescription;

                    // Resolve product_id del lead (para que o evento apareça cuando o vendedor filtra por producto)
                    let resolvedProductId: string | null = body.product_id || null;
                    if (!resolvedProductId && leadId) {
                      const { data: leadRow } = await supabase
                        .from('leads')
                        .select('product_id')
                        .eq('id', leadId)
                        .maybeSingle();
                      resolvedProductId = leadRow?.product_id || null;
                    }

                    const { data: calendarEvent, error: calendarInsertError } = await supabase
                      .from('calendar_events')
                      .insert({
                        title: `${eventType.name} - ${args.guest_name}`,
                        start_time: startTime.toISOString(),
                        end_time: endTime.toISOString(),
                        timezone: 'America/Sao_Paulo',
                        user_id: scheduleUserId,
                        organization_id: hostProfile.organization_id,
                        event_type: 'booking',
                        status: 'confirmed',
                        description: fullDescription,
                        location: eventType.location_type || null,
                        create_meet: eventType.create_meet ?? false,
                        color: eventType.color || null,
                        attendees: [{ email: args.guest_email, name: args.guest_name }],
                        lead_id: leadId || null,
                        product_id: resolvedProductId,
                        metadata: {
                          booking_event_type_id: eventType.id,
                          guest_name: args.guest_name,
                          guest_email: args.guest_email,
                          guest_phone: args.guest_phone || null,
                          source: 'webchat-bot',
                        },
                      })
                      .select()
                      .single();

                    if (calendarInsertError || !calendarEvent) {
                      console.error('[webchat-bot] calendar_events insert failed:', calendarInsertError);
                      responseContent = 'Tive um problema técnico para trabar esse horario na agenda. Podés dar 1 minutinho que eu confirmo con a equipo?';
                      try {
                        await supabase.from('notifications').insert({
                          organization_id: hostProfile.organization_id,
                          user_id: scheduleUserId,
                          title: '⚠️ Falha ao crear reserva via IA',
                          message: `No consegui crear o evento na agenda para ${args.guest_name} (${args.guest_email}) em ${args.preferred_date} ${args.preferred_time}. Verifique manualmente. Error: ${calendarInsertError?.message || 'desconhecido'}`,
                          type: 'system_alert',
                          product_id: body.product_id || null,
                        });
                      } catch (_e) {}
                      break; // sai do loop — no declarar "agendado con éxito"
                    }

                    // Create booking request — calendar_event_id ahora es OBRIGATÓRIO
                    await supabase.from('booking_requests').insert({
                      event_type_id: eventType.id,
                      host_user_id: scheduleUserId,
                      organization_id: hostProfile.organization_id,
                      guest_name: args.guest_name,
                      guest_email: args.guest_email,
                      guest_phone: args.guest_phone || null,
                      start_time: startTime.toISOString(),
                      end_time: endTime.toISOString(),
                      timezone: 'America/Sao_Paulo',
                      status: 'confirmed',
                      calendar_event_id: calendarEvent.id,
                      lead_id: leadId || null,
                    });
                    
                    // Send confirmation email to the guest
                    const confirmationToken = crypto.randomUUID();
                    const confirmationUrl = `${Deno.env.get('SUPABASE_URL')?.replace('/rest/v1', '')}/functions/v1/booking-confirmation?token=${confirmationToken}`;
                    
                    let emailSent = false;
                    try {
                      await supabase.from('booking_requests')
                        .update({ confirmation_token: confirmationToken })
                        .eq('calendar_event_id', calendarEvent?.id);

                      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
                      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
                      
                      const emailResp = await fetch(`${supabaseUrl}/functions/v1/send-booking-confirmation`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${supabaseKey}`,
                        },
                        body: JSON.stringify({
                          bookingId: calendarEvent?.id || '',
                          guestName: args.guest_name,
                          guestEmail: args.guest_email,
                          eventName: eventType.name,
                          hostName: hostProfile.full_name || 'Equipo',
                          startTime: startTime.toISOString(),
                          endTime: endTime.toISOString(),
                          meetLink: calendarEvent?.meet_link || '',
                          confirmationToken,
                          confirmationUrl,
                        }),
                      });
                      
                      if (emailResp.ok) {
                        const emailJson = await emailResp.json().catch(() => ({}));
                        emailSent = !!emailJson?.success;
                        console.log('[webchat-bot] Confirmation email response:', emailResp.status, 'success:', emailSent);
                      } else {
                        console.error('[webchat-bot] Confirmation email HTTP error:', emailResp.status, await emailResp.text().catch(() => ''));
                      }
                    } catch (emailError) {
                      console.error('[webchat-bot] Failed to send confirmation email:', emailError);
                    }
                    
                    // Mark schedule as truly succeeded — guard for anti-hallucination check
                    scheduleSucceeded = true;

                    // === Fire-and-forget: push to host's Google Calendar if connected ===
                    try {
                      const { data: gconn } = await supabase
                        .from('google_calendar_connections')
                        .select('id')
                        .eq('user_id', scheduleUserId)
                        .eq('is_active', true)
                        .maybeSingle();
                      if (gconn) {
                        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
                        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
                        fetch(`${supabaseUrl}/functions/v1/google-calendar-sync`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
                          body: JSON.stringify({ userId: scheduleUserId, direction: 'export', daysAhead: 60 }),
                        }).then(() => console.log('[webchat-bot] GCal sync triggered'))
                          .catch((e) => console.warn('[webchat-bot] GCal sync trigger failed:', e));
                      }
                    } catch (gcalErr) {
                      console.warn('[webchat-bot] GCal sync check failed (non-fatal):', gcalErr);
                    }


                    // Persist meeting context on the conversation so future
                    // messages don't re-propose times. Read in the system
                    // prompt at the top of every bot invocation.
                    try {
                      await supabase
                        .from('webchat_conversations')
                        .update({
                          meeting_scheduled_at: startTime.toISOString(),
                          meeting_event_id: calendarEvent?.id || null,
                          meeting_metadata: {
                            event_type_id: eventType.id,
                            event_type_name: eventType.name,
                            attendee_email: args.guest_email,
                            attendee_name: args.guest_name,
                            host_user_id: scheduleUserId,
                          },
                        })
                        .eq('id', body.conversation_id);
                    } catch (persistErr) {
                      console.warn('[webchat-bot] Failed to persist meeting context (non-fatal):', persistErr);
                    }

                    // === Notificações internas para la equipo ===
                    try {
                      const formattedDateNotif = startTime.toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
                      const formattedTimeNotif = startTime.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
                      const agentNameNotif = activeAgent?.name || 'IA';
                      const recipientIds = new Set<string>();

                      // Usuários explícitos configurados no agente
                      const explicitIds: string[] = Array.isArray((activeAgent as any)?.booking_notification_user_ids)
                        ? (activeAgent as any).booking_notification_user_ids
                        : [];
                      explicitIds.forEach((id) => id && recipientIds.add(id));

                      // Notificar todos os admins da org se a flag estiver ativa
                      if ((activeAgent as any)?.booking_notify_org_admins) {
                        const { data: admins } = await supabase
                          .from('user_roles')
                          .select('user_id, profiles!inner(organization_id)')
                          .eq('role', 'admin')
                          .eq('profiles.organization_id', hostProfile.organization_id);
                        (admins || []).forEach((a: any) => a.user_id && recipientIds.add(a.user_id));
                      }

                      // Siempre incluir o host (anfitrião)
                      if (scheduleUserId) recipientIds.add(scheduleUserId);

                      const notifTitle = `📅 Nova reunión agendada via ${agentNameNotif}`;
                      const notifMsg = `${eventType.name} con ${args.guest_name} (${args.guest_email}) em ${formattedDateNotif} às ${formattedTimeNotif}.`;

                      const notifRows = Array.from(recipientIds).map((uid) => ({
                        organization_id: hostProfile.organization_id,
                        user_id: uid,
                        title: notifTitle,
                        message: notifMsg,
                        type: 'system' as any,
                        product_id: body.product_id || null,
                        metadata: {
                          calendar_event_id: calendarEvent?.id || null,
                          event_type_id: eventType.id,
                          agent_id: activeAgent?.id || null,
                          guest_email: args.guest_email,
                          guest_name: args.guest_name,
                          start_time: startTime.toISOString(),
                        },
                      }));

                      if (notifRows.length > 0) {
                        await supabase.from('notifications').insert(notifRows);
                        console.log(`[webchat-bot] Sent booking notifications to ${notifRows.length} users`);
                      }
                    } catch (notifyErr) {
                      console.error('[webchat-bot] Failed to send team notifications:', notifyErr);
                    }
                    
                    // Format confirmation for AI to relay
                    const formattedDate = startTime.toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
                    const formattedTime = startTime.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
                    
                    if (emailSent) {
                      responseContent = `✅ Reunión agendada con éxito!\n\n📅 ${formattedDate} às ${formattedTime}\n📧 Confirmação enviada para ${args.guest_email}\n\nPosso ajudar con mais alguna coisa?`;
                    } else {
                      responseContent = `✅ Reunión agendada con éxito!\n\n📅 ${formattedDate} às ${formattedTime}\n\n⚠️ Tive um problema ao disparar o email automático para ${args.guest_email}. Nosso time va te enviar a confirmação manualmente em instantes.`;
                      // Notify internal team
                      try {
                        await supabase.from('notifications').insert({
                          organization_id: hostProfile.organization_id,
                          user_id: scheduleUserId,
                          title: '⚠️ Email de confirmação falló',
                          message: `Reserva creado para ${args.guest_name} (${args.guest_email}) em ${formattedDate} ${formattedTime}, mas o email automático no fue enviado. Confirme manualmente.`,
                          type: 'system_alert',
                          product_id: body.product_id,
                        });
                      } catch (notifyErr) {
                        console.error('[webchat-bot] Failed to create internal notification:', notifyErr);
                      }
                    }
                    console.log('[webchat-bot] Meeting scheduled successfully, emailSent:', emailSent);
                  } else {
                    responseContent = 'Desculpe, no fue posible agendar no momento. Posso transferir usted para um agente para confirmar o reserva?';
                  }
                } else {
                  responseContent = 'Infelizmente no tengo horários disponibles no momento. Posso verificar alternativas para usted?';
                }
              } catch (scheduleError) {
                console.error('[webchat-bot] Schedule error:', scheduleError);
                responseContent = 'Desculpe, ocorreu um error ao agendar. Posso transferir para um agente?';
              }
            } else {
              // Handle dynamic agent tools
              const toolName = toolCall.function.name;
              try {
                const args = JSON.parse(toolCall.function.arguments);
                console.log('[webchat-bot] Agent tool call:', toolName, args);

                // Helper to log action
                const logAction = async (success: boolean, result: any = {}, errorMsg?: string) => {
                  if (!activeAgent || !body.product_id) return;
                  const { data: conv } = await supabase.from('webchat_conversations').select('organization_id').eq('id', body.conversation_id).maybeSingle();
                  if (conv) {
                    await supabase.from('agent_action_logs').insert({
                      organization_id: conv.organization_id,
                      conversation_id: body.conversation_id,
                      product_id: body.product_id,
                      agent_id: activeAgent.id,
                      lead_id: leadId,
                      action_type: toolName,
                      action_data: args,
                      result,
                      success,
                      error_message: errorMsg || null,
                    });
                  }
                };

                // ============================================================
                // ANTI-RECOVERY GUARD: bloqueia re-envio de PIX / checkout
                // cuando o cliente ACABOU de confirmar pago.
                // ============================================================
                const PAYMENT_RECOVERY_TOOLS = new Set([
                  'gerar_link_pagamento',
                  'send_pix_link',
                  'send_checkout_link',
                  'send_payment_link',
                  'reenviar_pix',
                  'reenviar_checkout',
                ]);
                if (PAYMENT_RECOVERY_TOOLS.has(toolName)) {
                  const lastUserMsg = String(body.message || '').toLowerCase();
                  const paymentConfirmedMarkers = [
                    'ja paguei', 'ya paguei',
                    'ja efetuei', 'ya efetuei',
                    'efetuei o pago', 'efetuei pago',
                    'pago efetuado', 'pago realizado', 'pago concluido', 'pago concluído',
                    'paguei ahora', 'acabei de pagar', 'acabo de pagar',
                    'pix enviado', 'pix realizado', 'pix pago', 'pix efetuado', 'fiz o pix', 'fiz pix',
                    'comprovante', 'segue comprovante',
                    'transferencia hecha', 'transferência hecha',
                    'compra finalizada', 'compra concluida', 'compra concluída',
                  ];
                  const isPaymentConfirmed = paymentConfirmedMarkers.some(m => lastUserMsg.includes(m));
                  if (isPaymentConfirmed) {
                    console.warn('[webchat-bot] 🛡️ ANTI-RECOVERY: bloqueando', toolName, '— cliente ya confirmou pago. Msg:', lastUserMsg.slice(0, 120));
                    await logAction(false, { blocked: true, reason: 'payment_already_confirmed', user_message: body.message }, 'Tool bloqueada: cliente confirmou pago');
                    responseContent = choice.message?.content || '';
                    break; // sai do while de redirect/tool dispatch — follow-up gera respuesta natural
                  }
                }


                if (toolName === 'move_pipeline_stage' && leadId) {
                  await supabase.from('leads').update({ current_stage_id: args.stage_id }).eq('id', leadId);
                  await supabase.from('lead_stage_history').insert({ lead_id: leadId, stage_id: args.stage_id, changed_by: null });
                  await logAction(true, { stage_id: args.stage_id });
                  responseContent = choice.message?.content || 'Lead movido no pipeline con éxito.';
                } else if (toolName === 'apply_tags' && leadId) {
                  const { data: currentLead } = await supabase.from('leads').select('tags').eq('id', leadId).maybeSingle();
                  const currentTags = currentLead?.tags || [];
                  const newTags = [...new Set([...currentTags, ...(args.tags || [])])];
                  await supabase.from('leads').update({ tags: newTags }).eq('id', leadId);
                  await logAction(true, { tags: args.tags });
                  responseContent = choice.message?.content || '';
                } else if (toolName === 'remove_tags' && leadId) {
                  const { data: currentLead } = await supabase.from('leads').select('tags').eq('id', leadId).maybeSingle();
                  const currentTags = currentLead?.tags || [];
                  const filtered = currentTags.filter((t: string) => !(args.tags || []).includes(t));
                  await supabase.from('leads').update({ tags: filtered }).eq('id', leadId);
                  await logAction(true, { removed: args.tags });
                  responseContent = choice.message?.content || '';
                } else if (toolName === 'update_lead_temperature' && leadId) {
                  await supabase.from('leads').update({ temperature: args.temperature }).eq('id', leadId);
                  await logAction(true, { temperature: args.temperature });
                  responseContent = choice.message?.content || '';
                } else if (toolName === 'update_lead_field' && leadId) {
                  const allowedFields = ['deal_value', 'company', 'source', 'email', 'phone', 'name'];
                  if (allowedFields.includes(args.field)) {
                    await supabase.from('leads').update({ [args.field]: args.value }).eq('id', leadId);
                    await logAction(true, { field: args.field, value: args.value });
                  }
                  responseContent = choice.message?.content || '';
                } else if (toolName === 'create_task' && leadId) {
                  const { data: conv } = await supabase.from('webchat_conversations').select('organization_id, assigned_user_id').eq('id', body.conversation_id).maybeSingle();
                  if (conv) {
                    await supabase.from('tasks').insert({
                      title: args.title,
                      description: args.description || '',
                      lead_id: leadId,
                      product_id: body.product_id,
                      organization_id: conv.organization_id,
                      assigned_to: conv.assigned_user_id,
                      due_date: args.due_date || null,
                      created_by: activeAgent?.id || null,
                    });
                    await logAction(true, { title: args.title });
                  }
                  responseContent = choice.message?.content || 'Tarea creada con éxito.';
                } else if (toolName === 'transfer_to_agent') {
                  // ─────────────────────────────────────────────────────
                  // Cross-product safety: an agent bound to a product can only
                  // transfer within the same product OR to a global agent
                  // (admin / orchestrator). Global agents may transfer freely.
                  // We enforce this here even if the model proposes an invalid ID.
                  // ─────────────────────────────────────────────────────
                  const targetAgentId = args.agent_id;

                  // No-op se ya estamos no agente alvo (evita transferência redundante
                  // cuando o modelo "reaplica" a tool después handoff anterior).
                  const alreadyOnTarget = !!(targetAgentId && activeAgent?.id && targetAgentId === activeAgent.id);

                  if (alreadyOnTarget) {
                    console.log('[webchat-bot] 🔁 transfer_to_agent: already on target, skipping', { agent: activeAgent?.name });
                    await logAction(true, { target_agent: targetAgentId, reason: 'already_on_target', noop: true });
                    responseContent = choice.message?.content || 'Pode seguir comigo, ya estou aqui.';
                  } else {
                  const { data: targetAgent } = await supabase
                    .from('product_agents')
                    .select('id, name, agent_type, product_id, organization_id, handoff_incoming_message')
                    .eq('id', targetAgentId)
                    .eq('is_active', true)
                    .maybeSingle();

                  const activeIsGlobal = !activeAgent?.product_id;
                  const sameOrg = targetAgent && (targetAgent.organization_id === (activeAgent as any)?.organization_id);
                  const targetIsGlobal = targetAgent && !targetAgent.product_id;
                  const sameProduct = targetAgent && activeAgent?.product_id && targetAgent.product_id === activeAgent.product_id;
                  const isAllowed = !!targetAgent && !!sameOrg && (activeIsGlobal || targetIsGlobal || sameProduct);
                  // Bots normais nunca podem chamar admin
                  const tryingToCallAdmin = targetAgent?.agent_type === 'admin' && activeAgent?.agent_type !== 'admin';

                  if (!targetAgent) {
                    console.warn('[webchat-bot] ⛔ transfer_to_agent: target not found / inactive', { targetAgentId });
                    await logAction(false, { target_agent: targetAgentId, reason: 'target_not_found' });
                    responseContent = 'No consegui localizar esse agente. Posso continuar te atendendo aqui.';
                  } else if (tryingToCallAdmin) {
                    console.warn('[webchat-bot] ⛔ transfer_to_agent: bots cannot call admin agents', {
                      from: activeAgent?.name, to: targetAgent.name,
                    });
                    await logAction(false, { target_agent: targetAgentId, reason: 'admin_is_private' });
                    responseContent = 'Esse agente es exclusivo do gestor da organización. Posso seguir aquí ou chamar otro especialista?';
                  } else if (!isAllowed) {
                    console.warn('[webchat-bot] ⛔ cross-product transfer blocked', {
                      from: `${activeAgent?.name} (product ${activeAgent?.product_id})`,
                      to: `${targetAgent.name} (product ${targetAgent.product_id})`,
                    });
                    await logAction(false, {
                      target_agent: targetAgentId,
                      reason: 'cross_product_blocked',
                      from_product: activeAgent?.product_id,
                      to_product: targetAgent.product_id,
                    });
                    responseContent = 'Esse agente atende otro producto, no posso transferir. Posso continuar con usted por aqui?';
                  } else {
                    // ✅ Allowed — switch the conversation and fire the greeter so
                    // the new agent introduces itself even if the lead doesn't reply.
                    await supabase
                      .from('webchat_conversations')
                      .update({ current_agent_id: targetAgentId })
                      .eq('id', body.conversation_id);
                    await logAction(true, { target_agent: targetAgentId, reason: args.reason });
                    console.log('[webchat-bot] 🔀 transfer_to_agent OK', {
                      from: activeAgent?.name, to: targetAgent.name,
                    });

                    // Registra em agent_activation_logs pra que el próximo turno del
                    // novo agente detecte "handoff recibido" e injete o contexto.
                    try {
                      const { data: convOrg } = await supabase
                        .from('webchat_conversations')
                        .select('organization_id, lead_id')
                        .eq('id', body.conversation_id)
                        .maybeSingle();
                      if (convOrg?.organization_id) {
                        await supabase.from('agent_activation_logs').insert({
                          organization_id: convOrg.organization_id,
                          product_id: targetAgent.product_id || activeAgent?.product_id || null,
                          conversation_id: body.conversation_id,
                          lead_id: convOrg.lead_id || null,
                          from_agent_id: activeAgent?.id || null,
                          to_agent_id: targetAgentId,
                          matched_term: 'tool:transfer_to_agent',
                          match_type: 'transfer_tool',
                          channel: null,
                        });
                      }
                    } catch (logErr) {
                      console.warn('[webchat-bot] activation log failed (non-fatal):', logErr);
                    }

                    // Background dispatch of the handoff greeter (auto-introduction)
                    try {
                      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
                      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
                      const greeterPromise = fetch(`${supabaseUrl}/functions/v1/agent-handoff-greeter`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          Authorization: `Bearer ${serviceKey}`,
                        },
                        body: JSON.stringify({
                          conversation_id: body.conversation_id,
                          to_agent_id: targetAgentId,
                          from_agent_name: activeAgent?.name || null,
                          product_id: targetAgent.product_id || activeAgent?.product_id || null,
                        }),
                      }).catch((e) => console.warn('[webchat-bot] greeter dispatch failed:', e));
                      // @ts-ignore EdgeRuntime is provided by Supabase Deno runtime
                      if (typeof EdgeRuntime !== 'undefined' && (EdgeRuntime as any)?.waitUntil) {
                        // @ts-ignore
                        (EdgeRuntime as any).waitUntil(greeterPromise);
                      }
                    } catch (greeterErr) {
                      console.warn('[webchat-bot] greeter schedule error:', greeterErr);
                    }

                    // Despedida del agente atual: usa template configurado OU default.
                    // Resolve nombre del lead pra renderização das vars.
                    let nomeLead = '';
                    try {
                      const { data: convL } = await supabase
                        .from('webchat_conversations')
                        .select('lead_id')
                        .eq('id', body.conversation_id)
                        .maybeSingle();
                      if (convL?.lead_id) {
                        const { data: lead } = await supabase
                          .from('leads')
                          .select('name, full_name')
                          .eq('id', convL.lead_id)
                          .maybeSingle();
                        nomeLead = ((lead as any)?.full_name || (lead as any)?.name || '').split(' ')[0] || '';
                      }
                    } catch { /* non-fatal */ }

                    const outTpl = ((activeAgent as any)?.handoff_outgoing_message || '').trim() || DEFAULT_HANDOFF_OUTGOING;
                    responseContent = renderHandoffTpl(outTpl, {
                      nombre: nomeLead,
                      producto: '',
                      proximo_agente: targetAgent.name || 'minha colega',
                      agent_name: activeAgent?.name || '',
                    });
                  }
                  } // end else (alreadyOnTarget guard)
                } else if (toolName === 'transfer_to_human') {
                  // IA larga el lead: limpa agente IA, marca needs_human e devolve à fila do sector
                  await supabase.from('webchat_conversations').update({
                    status: 'waiting_human',
                    current_agent_id: null,
                    assigned_user_id: null,
                    needs_human: true,
                  }).eq('id', body.conversation_id);
                  await logAction(true, { reason: args.reason });
                  responseContent = choice.message?.content || 'Vou transferir usted para um agente. Aguarde um momento!';
                } else if (toolName === 'notify_team') {
                  const { data: conv } = await supabase.from('webchat_conversations').select('organization_id, assigned_user_id').eq('id', body.conversation_id).maybeSingle();
                  if (conv) {
                    await supabase.from('notifications').insert({
                      organization_id: conv.organization_id,
                      user_id: conv.assigned_user_id,
                      title: '🤖 Alerta do Agente IA',
                      message: args.message,
                      type: 'agent_alert',
                      product_id: body.product_id,
                    });
                    await logAction(true, { message: args.message });
                  }
                  responseContent = choice.message?.content || '';
                } else if (toolName === 'add_lead_note' && leadId) {
                  const { data: conv } = await supabase.from('webchat_conversations').select('organization_id').eq('id', body.conversation_id).maybeSingle();
                  if (conv) {
                    await supabase.from('lead_notes').insert({
                      lead_id: leadId,
                      content: `[IA - ${activeAgent?.name || 'Agente'}] ${args.content}`,
                      created_by: null,
                    });
                    await logAction(true, { content: args.content });
                  }
                  responseContent = choice.message?.content || '';
                } else if (toolName === 'start_cadence' && leadId) {
                  const { data: conv } = await supabase.from('webchat_conversations').select('organization_id').eq('id', body.conversation_id).maybeSingle();
                  if (conv) {
                    await supabase.from('ai_outreach_queue').insert({
                      lead_id: leadId,
                      organization_id: conv.organization_id,
                      product_id: body.product_id,
                      agent_id: activeAgent?.id,
                      conversation_id: body.conversation_id,
                      objective: args.objective || 'Follow-up automático',
                      followup_enabled: true,
                      followup_interval_hours: args.interval_hours || 24,
                      max_followups: args.max_followups || 3,
                      status: 'pending',
                    });
                    await logAction(true, { objective: args.objective });
                  }
                  responseContent = choice.message?.content || '';
                } else if (toolName === 'qualify_lead' && leadId) {
                  const qualification = { budget: args.budget, authority: args.authority, need: args.need, timeline: args.timeline };
                  const { data: currentLead } = await supabase.from('leads').select('custom_fields').eq('id', leadId).maybeSingle();
                  const customFields = (currentLead?.custom_fields || {}) as Record<string, any>;
                  customFields['bant_qualification'] = qualification;
                  await supabase.from('leads').update({ custom_fields: customFields }).eq('id', leadId);
                  await logAction(true, qualification);
                  responseContent = choice.message?.content || '';
                } else if (toolName === 'send_email' && leadId && leadContext?.email) {
                  // Send via Resend
                  try {
                    const resendKey = Deno.env.get('RESEND_API_KEY');
                    if (resendKey) {
                      await fetch('https://api.resend.com/emails', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
                        body: JSON.stringify({
                          from: 'noreply@resend.dev',
                          to: [leadContext.email],
                          subject: args.subject,
                          text: args.body,
                        }),
                      });
                      await logAction(true, { subject: args.subject, to: leadContext.email });
                    }
                  } catch (emailErr) {
                    console.error('[webchat-bot] Email error:', emailErr);
                    await logAction(false, {}, String(emailErr));
                  }
                  responseContent = choice.message?.content || 'Email enviado con éxito!';
                } else if (getRegistryTool(toolName)) {
                  // === REGISTRY DISPATCH (Fase 1) ===
                  // Ferramenta nova do registry centralizado. Auditoria automática.
                  const orgIdForTool = (activeAgent as any)?.organization_id || null;
                  if (!orgIdForTool) {
                    console.warn('[webchat-bot] registry tool sin organization_id — pulando:', toolName);
                    responseContent = choice.message?.content || body.agent_config.fallback_message;
                  } else {
                    const registryResult = await executeRegistryTool(toolName, args, {
                      organizationId: orgIdForTool,
                      agentId: activeAgent?.id ?? null,
                      agentName: activeAgent?.name ?? null,
                      leadId: leadId ?? null,
                      conversationId: body.conversation_id ?? null,
                      channel: body.channel ?? null,
                      supabase,
                    });
                    console.log('[webchat-bot] 🧰 Registry tool result:', toolName, registryResult.success ? 'OK' : 'FAIL', registryResult.error || '');
                    // Mantém logAction legado también, pra retrocompatibilidade do panel antigo
                    await logAction(registryResult.success, registryResult.data || {}, registryResult.error);
                    responseContent =
                      choice.message?.content ||
                      registryResult.user_message ||
                      ''; // ← vazio força o follow-up completion (linhas abaixo) a gerar respuesta natural
                                                                                          // en vez de mandar "Acción ejecutada con éxito." pro cliente

                  }
                } else {
                  responseContent = choice.message?.content || body.agent_config.fallback_message;
                }
              } catch (toolError) {
                console.error('[webchat-bot] Agent tool error:', toolError);
                responseContent = choice.message?.content || body.agent_config.fallback_message;
              }
            }
              // 🔁 If the agent only emitted a tool call (no text), do a follow-up
              // completion so the user actually receives a reply. Without this,
              // tools like update_lead_temperature / add_lead_note / apply_tags
              // make the bot go silent.
              if (
                toolCall &&
                (!responseContent || !responseContent.trim()) &&
                (!choice?.message?.content || !choice.message.content.trim())
              ) {
                try {
                  console.log('[webchat-bot] 🔁 Empty response after tool call → running follow-up for', toolCall.function.name);
                  const followUpBody: any = {
                    model: agentModel,
                    messages: [
                      { role: 'system', content: systemPrompt },
                      ...conversationHistory,
                      { role: 'user', content: body.message },
                      { role: 'assistant', content: null, tool_calls: [toolCall] },
                      { role: 'tool', tool_call_id: toolCall.id, content: 'Acción ejecutada con éxito. Continue la conversación naturalmente respondiendo à últimel mensaje del cliente. NO menciones que ejecutaste una herramienta.' },
                    ],
                    max_tokens: 400,
                    temperature: 0.6,
                  };
                  const fu = await fetch(aiConfig.endpoint, {
                    method: 'POST',
                    headers: aiConfig.headers,
                    body: JSON.stringify(prepareAIRequestBody(followUpBody, aiConfig)),
                  });
                  if (fu.ok) {
                    const fuJson = await fu.json();
                    await recordAIUsage(supabase, orgIdForRouting, aiConfig, 'agent_chat', fuJson?.usage, 'webchat-bot:tool-followup');
                    const fuText = fuJson?.choices?.[0]?.message?.content?.trim();
                    if (fuText) {
                      responseContent = fuText;
                      console.log('[webchat-bot] 🔁 Follow-up produced reply (', fuText.length, 'chars)');
                    }
                  } else {
                    console.warn('[webchat-bot] follow-up failed:', fu.status);
                  }
                } catch (fuErr) {
                  console.warn('[webchat-bot] follow-up exception:', fuErr);
                }
              }
              // Break unless toolCall.function.name was mutated (deterministic redirect)
              if (toolCall.function.name === __previousToolName) break;
              console.log('[webchat-bot] 🔁 Redirect attempt → re-dispatching as', toolCall.function.name);
            } // end while redirect loop
          } else {
            responseContent = choice?.message?.content || body.agent_config.fallback_message;
          }
          
          // ============================================================
          // ANTI-HALLUCINATION GUARD: blocks fake booking confirmations
          // If the model wrote a "meeting scheduled" message but the
          // schedule_meeting tool was NOT actually executed in this turn,
          // replace the message and log the attempt.
          // ============================================================
          if (canSchedule && !scheduleSucceeded && responseContent) {
            const lowered = responseContent.toLowerCase();
            const hallucinationMarkers = [
              'reunión agendada',
              'reuniao agendada',
              'reserva confirmado',
              'agendado con éxito',
              'confirmação enviada para',
              'confirmacao enviada para',
              'agendei su reunión',
              'agendei su reuniao',
              'marquei su reunión',
              'marquei su reuniao',
            ];
            const matchedMarker = hallucinationMarkers.find(m => lowered.includes(m));
            
            if (matchedMarker) {
              console.warn('[webchat-bot] 🚨 HALLUCINATED BOOKING BLOCKED — marker:', matchedMarker);
              console.warn('[webchat-bot] Original (blocked) content:', responseContent);
              
              const originalContent = responseContent;
              const needsEmail = !leadContext?.email;
              responseContent = needsEmail
                ? 'Deixa eu confirmar a agenda aquí rapidinho antes de fechar con usted. Podés passar o melhor email pra eu mandar a confirmação?'
                : 'Deixa eu confirmar a agenda aquí rapidinho antes de trabar o horario. Só um instante…';
              
              // Log attempt for audit
              try {
                const { data: convForLog } = await supabase
                  .from('webchat_conversations')
                  .select('organization_id')
                  .eq('id', body.conversation_id)
                  .maybeSingle();
                if (convForLog?.organization_id) {
                  await supabase.from('agent_action_logs').insert({
                    organization_id: convForLog.organization_id,
                    agent_id: activeAgent?.id || null,
                    conversation_id: body.conversation_id,
                    lead_id: leadId || null,
                    product_id: body.product_id || null,
                    action_type: 'hallucinated_booking_blocked',
                    success: false,
                    action_data: { matched_marker: matchedMarker, user_message: body.message },
                    result: { original_content: originalContent, replaced_with: responseContent },
                    error_message: `Model wrote booking confirmation without calling schedule_meeting tool (marker: "${matchedMarker}")`,
                  });
                }
              } catch (logErr) {
                console.error('[webchat-bot] Failed to log hallucination:', logErr);
              }
            } else {
              // Detect "scheduling intent missed": user confirmed a slot but model didn't call tool
              const userMsg = (body.message || '').toLowerCase();
              const confirmationTerms = /\b(puede ser|fechado|ok|combinado|vamos|marca pra mim|marca pra mim|tá bom|ta bom|beleza|perfeito|puede marcar)\b/;
              const timePattern = /\b\d{1,2}[:h]\d{0,2}\b/;
              const hasConfirmation = confirmationTerms.test(userMsg) || timePattern.test(userMsg);
              
              if (hasConfirmation) {
                try {
                  const { data: convForLog } = await supabase
                    .from('webchat_conversations')
                    .select('organization_id')
                    .eq('id', body.conversation_id)
                    .maybeSingle();
                  if (convForLog?.organization_id) {
                    await supabase.from('agent_action_logs').insert({
                      organization_id: convForLog.organization_id,
                      agent_id: activeAgent?.id || null,
                      conversation_id: body.conversation_id,
                      lead_id: leadId || null,
                      product_id: body.product_id || null,
                      action_type: 'scheduling_intent_missed',
                      success: false,
                      action_data: { user_message: body.message, has_email: !!leadContext?.email },
                      result: { ai_response: responseContent },
                      error_message: 'User appeared to confirm a slot but schedule_meeting tool was not invoked',
                    });
                  }
                } catch (logErr) {
                  console.error('[webchat-bot] Failed to log scheduling_intent_missed:', logErr);
                }
              }
            }
          }
          
          // ============================================================
          // FIX 4 — ANTI-REPETITION SIMILARITY FILTER
          // If the new response repeats a key sentence from the last 4
          // assistant messages, ask the model to rewrite once.
          // ============================================================
          if (responseContent && responseContent.length > 30) {
            try {
              const { data: recentAssistantMsgs } = await supabase
                .from('webchat_messages')
                .select('content')
                .eq('conversation_id', body.conversation_id)
                .eq('direction', 'outbound')
                .order('created_at', { ascending: false })
                .limit(4);

              const norm = (s: string) => s.toLowerCase().replace(/[^a-záéíóúâêôãõç0-9 ]/gi, '').replace(/\s+/g, ' ').trim();
              const splitSentences = (s: string) => s.split(/[.!?\n]+/).map(x => norm(x)).filter(x => x.length > 25);

              const newSentences = splitSentences(responseContent);
              let repeatedPhrase: string | null = null;

              for (const prevMsg of recentAssistantMsgs || []) {
                const prevSentences = splitSentences(prevMsg.content || '');
                for (const newS of newSentences) {
                  for (const prevS of prevSentences) {
                    // Cheap similarity: trigram overlap or substring match
                    if (newS === prevS || prevS.includes(newS) || newS.includes(prevS)) {
                      repeatedPhrase = prevS.length > 80 ? prevS.slice(0, 80) + '…' : prevS;
                      break;
                    }
                    // Token-overlap fallback
                    const aTokens = new Set(newS.split(' '));
                    const bTokens = new Set(prevS.split(' '));
                    const inter = [...aTokens].filter(t => bTokens.has(t)).length;
                    const ratio = inter / Math.max(aTokens.size, bTokens.size);
                    if (ratio >= 0.8) {
                      repeatedPhrase = prevS.length > 80 ? prevS.slice(0, 80) + '…' : prevS;
                      break;
                    }
                  }
                  if (repeatedPhrase) break;
                }
                if (repeatedPhrase) break;
              }

              if (repeatedPhrase) {
                console.warn('[webchat-bot] 🔁 REPETITION DETECTED, asking model to rewrite. Repeated:', repeatedPhrase);
                const rewriteResp = await fetch(aiConfig.endpoint, {
                  method: 'POST',
                  headers: aiConfig.headers,
                  body: JSON.stringify(prepareAIRequestBody({
                    model: agentModel,
                    messages: [
                      { role: 'system', content: `Vos sos un editor. Reescribí el mensaje do assistente quitando cualquier frase parecida a: "${repeatedPhrase}". A novel mensaje debe AVANZAR la conversación para el próximo paso, ser corto (máx 2 líneas) e NÃO repetir nada que ya se haya dicho. Respondé solo con el texto nuevo, sin comillas.` },
                      { role: 'user', content: responseContent },
                    ],
                    max_tokens: 200,
                    temperature: 0.6,
                  }, aiConfig)),
                });
                if (rewriteResp.ok) {
                  const rewriteData = await rewriteResp.json();
                  await recordAIUsage(supabase, orgIdForRouting, aiConfig, 'content_generation', rewriteData?.usage, 'webchat-bot:rewrite');
                  const rewritten = rewriteData.choices?.[0]?.message?.content?.trim();
                  if (rewritten && rewritten.length > 10) {
                    console.log('[webchat-bot] ✓ Rewritten response used');
                    // Log the repetition event for audit
                    try {
                      const { data: convForLog } = await supabase
                        .from('webchat_conversations')
                        .select('organization_id')
                        .eq('id', body.conversation_id)
                        .maybeSingle();
                      if (convForLog?.organization_id) {
                        await supabase.from('agent_action_logs').insert({
                          organization_id: convForLog.organization_id,
                          agent_id: activeAgent?.id || null,
                          conversation_id: body.conversation_id,
                          lead_id: leadId || null,
                          product_id: body.product_id || null,
                          action_type: 'response_repetition_detected',
                          success: true,
                          action_data: { repeated_phrase: repeatedPhrase },
                          result: { original: responseContent, rewritten },
                        });
                      }
                    } catch (e) { /* non-fatal */ }
                    responseContent = rewritten;
                  }
                }
              }
            } catch (simErr) {
              console.error('[webchat-bot] similarity filter error:', simErr);
            }
          }
          
          console.log('[webchat-bot] Response length:', responseContent?.length || 0);
        } else {
          const errorText = await aiResponse.text();
          console.error('[webchat-bot] AI API error:', aiResponse.status, errorText);
          responseContent = body.agent_config.fallback_message || 
            'Desculpe, no consegui processar su mensaje. Posso transferir usted para um agente?';
        }
      } catch (aiError) {
        console.error('[webchat-bot] AI call failed:', aiError);
        responseContent = body.agent_config.fallback_message ||
          'Desculpe, estou con dificuldades técnicas. Posso transferir usted para um agente?';
      }
    }

    // ============================================================
    // [HANDOFF:xxx] tag interpreter — runs AFTER agent generated reply
    // If the AI ended its message with [HANDOFF:closer|humano|cs|sdr|support|financial],
    // we strip the tag, switch the conversation's current_agent_id to the matching role,
    // or escalate to a human (mark conversation needs_human + create activation log).
    // The current message is delivered to the lead clean (without the tag).
    // The NEXT inbound message will be handled by the new agent automatically.
    // ============================================================
    if (responseContent && activeAgent && body.product_id) {
      try {
        // 🔧 PRÉ-CORREÇÃO: se o modelo escreveu tags inventadas tipo [TRANSFER],
        // [TRANSFERIR], [HANDOFF] (sem role) ou [PASSAR PARA SONIA], converte
        // para [HANDOFF:closer] antes do parser oficial. Assim a transferência
        // realmente acontece en vez de só ser limpa silenciosamente.
        if (/\[\s*(?:transfer(?:ir)?|hand[\s_-]*off|passar(?:\s+para[^\]]*)?|enviar\s+para[^\]]*|transferir\s+para[^\]]*)\s*\]/i.test(responseContent)
            && !/\[HANDOFF:\s*(?:closer|sdr|cs|support|financial|humano|human)\s*\]/i.test(responseContent)) {
          // Default seguro: closer (cenário comercial). Se o agente atual ya es closer,
          // vira humano (escalonamento natural).
          const fallbackRole = activeAgent.agent_type === 'closer' ? 'humano' : 'closer';
          responseContent = responseContent.replace(
            /\[\s*(?:transfer(?:ir)?|hand[\s_-]*off|passar(?:\s+para[^\]]*)?|enviar\s+para[^\]]*|transferir\s+para[^\]]*)\s*\]/gi,
            `[HANDOFF:${fallbackRole}]`,
          );
          console.log('[webchat-bot] 🔁 Fake transfer tag promoted to [HANDOFF:' + fallbackRole + ']');
        }

        const parsedHandoff = parseHandoffTag(responseContent);
        if (parsedHandoff.handoffTo) {
          responseContent = parsedHandoff.cleanText || responseContent;
          const target = parsedHandoff.handoffTo;
          const targetRole = handoffTargetToAgentRole(target);

          console.log('[webchat-bot] 🔀 HANDOFF detected →', target, 'rawTag:', parsedHandoff.rawTag);

          // Get conversation org for logging + lead/product names for variable rendering
          const { data: convForHandoff } = await supabase
            .from('webchat_conversations')
            .select('organization_id, lead_id, channel, visitor_phone')
            .eq('id', body.conversation_id)
            .maybeSingle();

          // Resolve variables for the OUTGOING message (Sofia → Ana)
          let leadFirstName = '';
          let productName = '';
          if (convForHandoff?.lead_id) {
            const { data: lead } = await supabase
              .from('leads')
              .select('name, full_name')
              .eq('id', convForHandoff.lead_id)
              .maybeSingle();
            leadFirstName = ((lead as any)?.full_name || (lead as any)?.name || '').split(' ')[0] || '';
          }
          if (body.product_id) {
            const { data: prod } = await supabase
              .from('products')
              .select('name')
              .eq('id', body.product_id)
              .maybeSingle();
            productName = (prod as any)?.name || '';
          }

          const renderTpl = (tpl: string, vars: Record<string, string>) =>
            tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => vars[k] ?? '').replace(/\s{2,}/g, ' ').trim();

          if (target === 'humano') {
            // Escalate to human queue
            await supabase
              .from('webchat_conversations')
              .update({
                needs_human: true,
                current_agent_id: null,
              })
              .eq('id', body.conversation_id);

            // Replace AI reply with the configured outgoing message OR default farewell
            const outTpl = ((activeAgent as any).handoff_outgoing_message || '').trim() || DEFAULT_HANDOFF_OUTGOING;
            responseContent = renderTpl(outTpl, {
              nombre: leadFirstName,
              producto: productName,
              proximo_agente: 'um especialista humano',
              agent_name: activeAgent.name || '',
            });

            // Best-effort log
            if (convForHandoff?.organization_id) {
              try {
                await supabase.from('agent_activation_logs').insert({
                  organization_id: convForHandoff.organization_id,
                  product_id: body.product_id,
                  conversation_id: body.conversation_id,
                  lead_id: convForHandoff.lead_id || null,
                  from_agent_id: activeAgent.id,
                  to_agent_id: null,
                  matched_term: parsedHandoff.rawTag || '[HANDOFF:humano]',
                  match_type: 'handoff_human',
                  channel: null,
                });
              } catch (logErr) {
                console.warn('[webchat-bot] handoff log failed (non-fatal):', logErr);
              }
            }
          } else if (targetRole) {
            // Find specialist agent of the requested role for the same product
            const { data: nextAgent } = await supabase
              .from('product_agents')
              .select('id, name, agent_type, handoff_incoming_message, handoff_delay_seconds')
              .eq('product_id', body.product_id)
              .eq('agent_type', targetRole)
              .eq('is_active', true)
              .order('is_default', { ascending: false })
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (nextAgent && nextAgent.id !== activeAgent.id) {
              await supabase
                .from('webchat_conversations')
                .update({ current_agent_id: nextAgent.id })
                .eq('id', body.conversation_id);
              console.log('[webchat-bot] ✅ Switched current_agent_id →', nextAgent.name);

              // Replace the AI's reply with the configured outgoing (farewell) message OR default
              const outTpl = ((activeAgent as any).handoff_outgoing_message || '').trim() || DEFAULT_HANDOFF_OUTGOING;
              responseContent = renderTpl(outTpl, {
                nombre: leadFirstName,
                producto: productName,
                proximo_agente: nextAgent.name || 'la próxima agente',
                agent_name: activeAgent.name || '',
              });

              // Schedule the incoming agent's auto-greeting in background.
              // Siempre dispara: o greeter usa o template configurado OU o default interno
              // (DEFAULT_TEMPLATE em agent-handoff-greeter), garantindo presentación.
              try {
                const greeterPayload = {
                  conversation_id: body.conversation_id,
                  to_agent_id: nextAgent.id,
                  from_agent_name: activeAgent.name || null,
                  product_id: body.product_id,
                };
                const greeterPromise = supabase.functions.invoke('agent-handoff-greeter', {
                  body: greeterPayload,
                }).then((r) => {
                  if ((r as any).error) {
                    console.warn('[webchat-bot] greeter invoke error:', (r as any).error);
                  }
                }).catch((e) => {
                  console.warn('[webchat-bot] greeter invoke threw:', e);
                });
                // @ts-ignore EdgeRuntime is available in Supabase Deno runtime
                if (typeof EdgeRuntime !== 'undefined' && (EdgeRuntime as any)?.waitUntil) {
                  // @ts-ignore
                  (EdgeRuntime as any).waitUntil(greeterPromise);
                }
                console.log('[webchat-bot] 📨 Scheduled incoming greeting for', nextAgent.name);
              } catch (e) {
                console.warn('[webchat-bot] failed to schedule greeter:', e);
              }

              if (convForHandoff?.organization_id) {
                try {
                  await supabase.from('agent_activation_logs').insert({
                    organization_id: convForHandoff.organization_id,
                    product_id: body.product_id,
                    conversation_id: body.conversation_id,
                    lead_id: convForHandoff.lead_id || null,
                    from_agent_id: activeAgent.id,
                    to_agent_id: nextAgent.id,
                    matched_term: parsedHandoff.rawTag || `[HANDOFF:${target}]`,
                    match_type: 'handoff_tag',
                    channel: null,
                  });
                } catch (logErr) {
                  console.warn('[webchat-bot] handoff log failed (non-fatal):', logErr);
                }
              }
            } else {
              console.log('[webchat-bot] ⚠️ No specialist found for role:', targetRole, '— staying with current agent');
            }
          }
        }
      } catch (handoffErr) {
        console.warn('[webchat-bot] handoff parser error (non-fatal):', handoffErr);
      }
    }

    // Sanitize: remove placeholders {{xxx}} desconhecidos que o modelo escapou
    // (ex: {{checkout_link}}). Fuerza al agente a usar tools en el próximo turno.
    if (responseContent) {
      responseContent = stripUnrenderedPlaceholders(responseContent);
      const fakeRes = stripFakeHandoffTags(responseContent);
      if (fakeRes.fakeFound) {
        console.log('[webchat-bot] ⚠️ fake transfer/handoff tag detected and stripped');
      }
      responseContent = fakeRes.cleaned;
    }

    // Check if chunked messages are enabled
    const chunkedEnabled = body.agent_config.chunked_messages_enabled !== false;

    // Test mode - return without saving
    if (body.is_test) {
      const messageType = responseButtons ? 'buttons' : (responseVideoUrl ? 'video' : 'text');
      
      return new Response(
        JSON.stringify({ 
          message: { 
            content: responseContent,
            message_type: messageType,
            buttons: responseButtons,
            video_url: responseVideoUrl,
          },
          response: responseContent,
          buttons: responseButtons,
          video_url: responseVideoUrl,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine message type
    const messageType = responseButtons ? 'buttons' : (responseVideoUrl ? 'video' : 'text');

    // For WhatsApp (and other chunked-delivery channels), DON'T save the full
    // response upfront. The orchestrator (e.g. evolution-webhook) will save
    // one row per chunk so the Inbox mirrors exactly what the lead sees.
    const incomingChannel = String((body as any).channel || 'webchat').toLowerCase();
    const skipFullPersist =
      incomingChannel === 'whatsapp' &&
      (body.agent_config.chunked_messages_enabled !== false) &&
      !responseButtons;

    let botMessage: any = null;
    if (!skipFullPersist) {
      const { data: saved, error: msgError } = await supabase
        .from('webchat_messages')
        .insert({
          conversation_id: body.conversation_id,
          direction: 'outbound',
          sender_type: 'bot',
          content: responseContent,
          message_type: messageType,
          buttons: responseButtons,
          video_url: responseVideoUrl,
          metadata: schedulingMetadata || null,
        })
        .select()
        .single();

      if (msgError) {
        console.error('Error saving bot message:', msgError);
        return new Response(
          JSON.stringify({ error: 'Failed to save bot response' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      botMessage = saved;
    }

    // Return with chunked info for widget to process
    if (chunkedEnabled && !responseButtons) {
      // Apply humanization (style + smart splitting + delays) using the agent config.
      const humanCfg = (activeAgent as any)?.humanization as HumanizationConfig | undefined;
      const channel = ((body as any).channel || 'webchat') as HumanizationChannel;
      const humanResult = humanCfg && humanCfg.enabled !== false
        ? humanize(responseContent, humanCfg, channel)
        : {
            bubbles: splitIntoChunks(responseContent),
            firstDelayMs: 0,
            betweenDelaysMs: [] as number[],
            typingMsPerBubble: [] as number[],
            typingIndicator: true,
            postponeUntil: null,
          };

      // ============================================================
      // CAP de bolhas — respeita config del agente (humanization.splitting.max_bubbles)
      // con teto absoluto de 4 para WhatsApp (anti-spam / queima de número).
      // No colapsa abaixo do que o humanizer decidiu naturalmente.
      // ============================================================
      const isWhatsApp = String(channel).toLowerCase() === 'whatsapp';
      let bubbles: string[] = Array.isArray(humanResult.bubbles) ? humanResult.bubbles.filter(b => typeof b === 'string' && b.trim().length > 0) : [];
      let between: number[] = Array.isArray(humanResult.betweenDelaysMs) ? [...humanResult.betweenDelaysMs] : [];
      let typingMs: number[] = Array.isArray(humanResult.typingMsPerBubble) ? [...humanResult.typingMsPerBubble] : [];

      if (isWhatsApp && bubbles.length > 0) {
        const cfgMax = Math.min(4, Math.max(1, Number((humanCfg as any)?.splitting?.max_bubbles ?? 3)));
        const MAX_BUBBLES = cfgMax;
        if (bubbles.length > MAX_BUBBLES) {
          const head = bubbles.slice(0, MAX_BUBBLES - 1);
          const tail = bubbles.slice(MAX_BUBBLES - 1).join('\n\n').trim();
          bubbles = MAX_BUBBLES === 1 ? [bubbles.join('\n\n').trim()] : [...head, tail];
          between = between.slice(0, Math.max(0, MAX_BUBBLES - 1));
          while (between.length < MAX_BUBBLES - 1) between.push(1200);
          if (typingMs.length > MAX_BUBBLES) {
            const headTyping = typingMs.slice(0, MAX_BUBBLES - 1);
            const tailTyping = typingMs.slice(MAX_BUBBLES - 1).reduce((a, b) => a + b, 0);
            typingMs = [...headTyping, tailTyping];
          }
          console.log('[webchat-bot] whatsapp cap: bubbles=', bubbles.length, '(max=', MAX_BUBBLES, ')');
        }
        // Clamp between delays: 800ms..4000ms para naturalidade
        between = between.map((n) => Math.min(4000, Math.max(800, Number(n) || 1200)));
      }

      return new Response(
        JSON.stringify({
          message: botMessage,
          chunked: true,
          chunks: bubbles,
          delays: {
            firstMs: humanResult.firstDelayMs,
            betweenMs: between,
          },
          typingMs,
          typingIndicator: humanResult.typingIndicator,
          postponeUntil: humanResult.postponeUntil,
          metadata: schedulingMetadata || null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ 
        message: botMessage,
        buttons: responseButtons,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in webchat-bot:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Map CTA type to button type
function mapCTATypeToButtonType(ctaType: string): 'url' | 'whatsapp' | 'callback' | 'calendar' {
  switch (ctaType) {
    case 'whatsapp':
      return 'whatsapp';
    case 'callback':
      return 'callback';
    case 'calendar':
      return 'calendar';
    default:
      return 'url';
  }
}

// Get button action based on CTA type
function getButtonAction(cta: ProductCTA): string {
  if (cta.cta_type === 'whatsapp') {
    return cta.whatsapp_number || '';
  }
  return cta.action_url || '';
}

// Split response into natural chunks for typing effect
function splitIntoChunks(text: string): string[] {
  if (!text || text.length < 50) return [text];
  
  // Split by sentence endings, questions, or exclamations
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim());
  
  if (sentences.length <= 1) {
    // If only one sentence, split by line breaks or natural pauses
    const parts = text.split(/\n+/).filter(s => s.trim());
    if (parts.length > 1) return parts;
    return [text];
  }
  
  // Group very short sentences together
  const chunks: string[] = [];
  let current = '';
  
  for (const sentence of sentences) {
    if (current.length + sentence.length < 80) {
      current += (current ? ' ' : '') + sentence;
    } else {
      if (current) chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  
  return chunks.slice(0, 4); // Max 4 chunks
}

// Get persona instructions
function getPersonaInstructions(style: string): string {
  switch (style) {
    case 'professional':
      return '🎩 TOM: Sé formal, objetivo e técnico. Usa lenguaje corporativa. Transmita autoridade e conhecimento.';
    case 'casual':
      return '😎 TOM: Sé descontracturado e informal. Usá lenguaje liviano, modismos cuando apropiado, e sé cercano al cliente.';
    case 'friendly':
    default:
      return '😊 TOM: Sé amigable, cálido e prestativo. Equilíbrio entre profissional e descontracturado. Crea conexión genuína.';
  }
}

// Interface for permission overrides
interface PermissionOverrides {
  can_do?: string[];
  cannot_do?: string[];
  handoff_triggers?: string[];
  context?: string;
}

// Build system prompt based on product agent configuration with optional overrides
function buildAgentSystemPrompt(
  agent: ProductAgent, 
  visitorName: string,
  overrides?: PermissionOverrides
): string {
  const typeLabel = AGENT_TYPE_LABELS[agent.agent_type] || agent.agent_type;
  
  let prompt = `IDENTIDADE: Vos sos ${agent.name}, agente de ${typeLabel}.\n\n`;
  
  // Primary objective
  prompt += `OBJETIVO PRINCIPAL:\n${agent.primary_objective}\n\n`;
  
  // Tone of voice
  const toneInstructions: Record<string, string> = {
    formal: 'Sé formal, objetivo e profissional. Usa lenguaje corporativa e transmita autoridade.',
    consultive: 'Sé consultivo, demonstrando expertise e conduzindo o cliente con confiança. Faça preguntas estratégicas.',
    friendly: 'Sé amigable, cálido y cercano. Creá conexión genuina sin ser artificial.',
    technical: 'Sé técnico, preciso e detalhista. Usa termos apropiados ao contexto.',
  };
  prompt += `TOM DE VOZ: ${toneInstructions[agent.tone_style] || toneInstructions.friendly}\n\n`;

  // Regras adicionais para evitar bugs reais que apareceram em conversaciones (Maria → leads).
  prompt += `🚫 NUNCA reconheça verbalmente bugs, falhas, repetição de mensaje ou que o sinal "travou". Se algo parecer estranho, ignore e siga.\n`;
  prompt += `🚫 NUNCA se presentes de novo se ya se apresentou en esta conversación.\n`;
  if (agent.agent_type === 'sdr') {
    prompt += `🎯 VOS SOS SDR: NO vendés, NO hacés pitch de producto, NO explicás detalles técnicos. Tu rol es calificar y llevar al próximo paso (grupo, live, reserva, closer).\n`;
    prompt += `🎯 Si el lead YA hizo la CTA (entró al grupo, agendó, compró), PARE de calificar e PARE de hacer preguntas novas — solo reforzá el próximo paso.\n`;
  }
  prompt += `📱 Estilo WhatsApp: frases curtas terminadas em ".", "?" ou "!". Cada ideia em uma frase. NUNCA mande parágrafo gigante.\n`;
  prompt += `🚨 TRAVA ANTI-SPAM (OBRIGATÓRIA): O lead puede mandar várias mensajes seguidas — usted as recebe AGRUPADAS em um único bloco. Responda UMA ÚNICA VEZ, em UN mensaje só, considerando TUDO que ele disse. NUNCA gere múltiplas respuestas separadas, NUNCA reajel mensaje por mensaje. Resposta corta (hasta ~500 caracteres), pontual, certeira, con no máximo 1 pregunta no final. Se for absolutamente necessário dividir, no MÁXIMO 2 mensajes — nunca 3 ou mais.\n\n`;

  // CRITICAL: Anti-repetition and context awareness rules
  prompt += `═══════════════════════════════════════
REGRAS CRÍTICAS DE COMPORTAMENTO (OBRIGATÓRIAS)
═══════════════════════════════════════

1. ANALISE o historial COMPLETO antes de CADA respuesta
2. NUNCA repita saudações, frases ou emojis já usados no historial
3. Se já realizou uma acción (agendou reunión, coletou dados, envió email), NÃO repita nem ofrezcas novamente
4. Adapte su estilo baseado nas respuestas e humor del cliente
5. CADA mensaje debe PROGREDIR a conversación — nunca retroceda a pontos já cobertos
6. Máximo 1 emoji por mensaje, NUNCA o mismo emoji em mensajes consecutivas

FRASES ABSOLUTAMENTE PROIBIDAS:
- "Tudo ótimo por aqui"
- "Fechar con chave de ouro"
- "Fico à disposición"
- "Sem problemas"
- "Fique à vontade"
- "Com certeza!"
- "Perfeito!"
- Cualquier frase ou saludo que já apareceu en esta conversación

VARIAÇÃO OBRIGATÓRIA:
- Alterne entre preguntas diretas, observaciones estratégicas e provocações construtivas
- Varie a estrutura das mensajes (no use siempre o mismo estándar)
- Usa o nombre del cliente de forma natural (no em todel mensaje, a cada 2-3 msgs)
- Adapte o tom: se o cliente es direto, seja direto; se es detalhista, explore

TÉCNICA CONSULTIVA:
1. Descubrí el DOLOR real antes de presentar cualquier solución
2. Faça preguntas ABERTAS que revelam necessidades (no preguntas de sí/no)
3. Conecte benefícios ESPECÍFICOS às dores ESPECÍFICAS mencionadas por el cliente
4. Crea urgência baseada na REALIDADE del cliente, no urgência artificial
5. Progrida naturalmente: Situação → Problema → Implicação → Solução → Acción

FONTE DAS RESPOSTAS (REGRA MAIS IMPORTANTE):
- TODAS as sus respuestas DEVEM ser baseadas EXCLUSIVAMENTE no conhecimento fornecido (Cérebro do Producto + Treinamento)
- Se a información no estiver na base de conhecimento, DIGA que vai verificar — NUNCA invente
- Usa dados, números e fatos EXATOS da base — no generalize nem parafraseie de forma vaga
- Quando o cliente preguntar algo coberto por el FAQ ou base de conhecimento, cite os dados reais

CONTINUIDADE PÓS-TRANSFERÊNCIA:
- Se o historial mostrar que otro agente já estava conversando con o lead, usted ASSUMIU a conversación: NÃO se representes novamente, NÃO repita preguntas já feitas, NÃO peça dados que o lead já forneceu
- Reconocé brevemente el contexto anterior ("vi que estaban hablando sobre X") e seguí con el próximo paso natural
- Se já hay umel mensaje automática de saludo su no historial, vá DIRETO ao assunto

NUNCA AJA COMO SUPORTE (a menos que su agent_type seja explicitamente "support"):
- Usted NUNCA pede CPF, número de pedido, "motivo do su contato" ou age como agente de SAC/suporte técnico
- Se o objetivo principal menciona "transferir pra suporte", isso es uma INSTRUÇÃO DE ROTEAMENTO, no um exemplo de fala — no copie esse tom
- Se o lead pedir suporte explicitamente E for um cliente atual con problema técnico, use a tool transfer_to_human ou transfer_to_agent (nunca finja ser suporte)
- Para cualquier otra intenção (compra, duda comercial, reserva), seguí tu rol de ventas/SDR normalmente

═══════════════════════════════════════\n\n`;

  // Apply overrides - merge with agent defaults
  const effectiveCanDo = [
    ...(agent.can_do || []),
    ...(overrides?.can_do || [])
  ];
  
  const effectiveCannotDo = [
    ...(agent.cannot_do || []),
    ...(overrides?.cannot_do || [])
  ];
  
  const effectiveHandoffTriggers = [
    ...(agent.handoff_triggers || []),
    ...(overrides?.handoff_triggers || [])
  ];
  
  // What the agent can do (with overrides)
  if (effectiveCanDo.length > 0) {
    prompt += `✅ VOS PODE:\n${effectiveCanDo.map(c => `- ${c}`).join('\n')}\n\n`;
  }
  
  // What the agent cannot do (with overrides)
  if (effectiveCannotDo.length > 0) {
    prompt += `❌ VOS NÃO PODE:\n${effectiveCannotDo.map(c => `- ${c}`).join('\n')}\n\n`;
  }
  
  // When to hand off to human (with overrides)
  if (effectiveHandoffTriggers.length > 0) {
    prompt += `🙋 TRANSFIRA PARA HUMANO QUANDO:\n${effectiveHandoffTriggers.map(t => `- ${t}`).join('\n')}\n\n`;
  }
  
  // Required phrases
  if (agent.required_phrases && agent.required_phrases.length > 0) {
    prompt += `📝 INCLUA SIEMPRE: ${agent.required_phrases.join(', ')}\n\n`;
  }
  
  // Prohibited phrases - merge with built-in blacklist
  const allProhibited = [
    ...(agent.prohibited_phrases || []),
    'Tudo ótimo por aqui',
    'Fechar con chave de ouro', 
    'Fico à disposición',
    'Sem problemas',
  ];
  const uniqueProhibited = [...new Set(allProhibited)];
  prompt += `🚫 NUNCA USE: ${uniqueProhibited.join(', ')}\n\n`;
  
  // Additional prompt
  if (agent.additional_prompt) {
    prompt += `📌 INSTRUÇÕES ADICIONAIS:\n${agent.additional_prompt}\n\n`;
  }

  // Support agent: inject curated links + quick answers from tool_configs
  if (agent.agent_type === 'support') {
    const tc = (agent as any).tool_configs || {};
    const links = Array.isArray(tc.support_links) ? tc.support_links : [];
    const quick = Array.isArray(tc.support_quick_answers) ? tc.support_quick_answers : [];
    if (links.length > 0) {
      prompt += `🔗 LINKS OFICIAIS DE SUPORTE (use APENAS estes — no invente URLs):\n`;
      links.forEach((l: any) => {
        if (l?.title && l?.url) {
          prompt += `- ${l.title}: ${l.url}${l.description ? ` — ${l.description}` : ''}\n`;
        }
      });
      prompt += '\n';
    }
    if (quick.length > 0) {
      prompt += `💡 RESPOSTAS RÁPIDAS OFICIAIS (use EXATAMENTE cuando a pregunta coincidir):\n`;
      quick.forEach((q: any) => {
        if (q?.question && q?.answer) {
          prompt += `\nP: ${q.question}\nR: ${q.answer}\n`;
        }
      });
      prompt += '\n';
    }
  }

  // Context override from flow
  if (overrides?.context) {
    prompt += `📌 CONTEXTO ADICIONAL NESTE MOMENTO:\n${overrides.context}\n\n`;
  }
  
  // Visitor name context
  if (visitorName) {
    prompt += `👤 CLIENTE: ${visitorName}\n- Usa o nombre de forma natural (no en cadel mensaje)\n\n`;
  }
  
  // Message style
  const messageLength: Record<string, string> = {
    short: '2 linhas',
    balanced: '3-4 linhas',
    detailed: '5-6 linhas',
  };
  prompt += `⚠️ FORMATO: Mensagens de no máximo ${messageLength[agent.message_style] || '3-4 linhas'}.`;
  prompt += ' ANTES de responder, releia o historial e verifique se no está repetindo nada.';
  
  if (agent.always_end_with_question) {
    prompt += ' SIEMPRE termine con uma pregunta que AVANÇA la conversación para el objetivo.';
  }
  
  return prompt;
}

// Fetch product brain knowledge
async function fetchProductBrain(supabase: any, productId: string): Promise<string | null> {
  try {
    const { data: product } = await supabase
      .from('products')
      .select('name, description, pitch_15s, pitch_30s, pitch_2min, icp, differentials')
      .eq('id', productId)
      .single() as { data: Product | null };

    const { data: sources } = await supabase
      .from('product_knowledge_sources')
      .select('source_type, title, extracted_content, transcript, question, answer')
      .eq('product_id', productId)
      .eq('is_active', true)
      .eq('processing_status', 'completed') as { data: KnowledgeSource[] | null };

    const { data: objections } = await supabase
      .from('objections')
      .select('what_they_say, suggested_response')
      .eq('product_id', productId) as { data: Objection[] | null };

    if (!product && !sources?.length && !objections?.length) {
      return null;
    }

    let context = '\n\n=== 🧠 CONHECIMENTO DO PRODUTO (RESPONDA COM BASE NESTES DADOS) ===';

    if (product) {
      context += `\n\n📦 SOBRE O PRODUTO:`;
      context += `\nNome: ${product.name}`;
      if (product.description) context += `\nDescrição: ${product.description}`;
      if (product.pitch_15s) context += `\n⚡ Pitch rápido: ${product.pitch_15s}`;
      if (product.pitch_30s) context += `\n💡 Pitch médio: ${product.pitch_30s}`;
      if (product.icp) context += `\n🎯 Cliente ideal: ${product.icp}`;
      if (product.differentials?.length) {
        context += `\n✨ Diferenciais: ${product.differentials.join(', ')}`;
      }
    }

    if (sources && sources.length > 0) {
      context += '\n\n📚 BASE DE CONHECIMENTO (USE ESTAS INFORMAÇÕES PARA RESPONDER):';
      const MAX_CHARS = 5000;
      
      for (const source of sources.slice(0, 10)) {
        let content = '';
        
        if (source.source_type === 'faq' && source.question && source.answer) {
          content = `P: ${source.question}\nR: ${source.answer}`;
        } else if (source.source_type === 'youtube' && source.transcript) {
          content = source.transcript.substring(0, MAX_CHARS);
        } else if (source.extracted_content) {
          content = source.extracted_content.substring(0, MAX_CHARS);
        }
        
        if (content) {
          context += `\n\n[${source.title}]:\n${content}`;
        }
      }
    }

    if (objections && objections.length > 0) {
      context += '\n\n🛡️ CONTORNO DE OBJEÇÕES (USE estas respuestas cuando o cliente levantar objeções):';
      for (const obj of objections.slice(0, 12)) {
        context += `\n\n❌ Objeção: "${obj.what_they_say}"`;
        context += `\n✅ Resposta: ${obj.suggested_response}`;
      }
    }

    return context;
  } catch (error) {
    console.error('Error fetching product brain:', error);
    return null;
  }
}

// Fetch sales training materials - SUPPORTS BOTH PRODUCT AND AGENT-SPECIFIC MATERIALS
async function fetchTrainingMaterials(
  supabase: any, 
  productId: string,
  agentId?: string
): Promise<string | null> {
  try {
    // 1. Fetch product-level materials (agent_id is NULL) - used by all agents
    const { data: productMaterials } = await supabase
      .from('agent_training_materials')
      .select('title, category, extracted_content')
      .eq('product_id', productId)
      .is('agent_id', null)
      .eq('is_active', true)
      .eq('processing_status', 'completed')
      .limit(10) as { data: TrainingMaterial[] | null };

    // 2. Fetch agent-specific materials if agentId is provided
    let agentMaterials: TrainingMaterial[] = [];
    if (agentId) {
      const { data } = await supabase
        .from('agent_training_materials')
        .select('title, category, extracted_content')
        .eq('agent_id', agentId)
        .eq('is_active', true)
        .eq('processing_status', 'completed')
        .limit(10) as { data: TrainingMaterial[] | null };
      
      agentMaterials = data || [];
      console.log('[webchat-bot] Agent-specific materials found:', agentMaterials.length);
    }

    // Combine both sources
    const allMaterials = [...(productMaterials || []), ...agentMaterials];
    
    if (allMaterials.length === 0) return null;

    let context = '\n\n=== 📖 BASE DE CONHECIMENTO DO AGENTE (USE ESTAS INFORMAÇÕES NAS RESPOSTAS) ===';
    
    for (const material of allMaterials) {
      if (material.extracted_content) {
        const categoryLabel = getCategoryLabel(material.category);
        context += `\n\n[${categoryLabel}: ${material.title}]:\n${material.extracted_content.substring(0, 6000)}`;
      }
    }

    return context;
  } catch (error) {
    console.error('Error fetching training materials:', error);
    return null;
  }
}

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    'sales_techniques': '🎯 Técnicas de Vendas',
    'communication': '💬 Comunicação',
    'objections': '🛡️ Objeções',
    'closing': '✅ Fechamento',
    'prospectoing': '🔍 Prospecção',
    'negotiation': '🤝 Negociação',
    'general': '📋 Geral'
  };
  return labels[category] || '📋 Geral';
}

// FAQ matching
function findFAQMatch(
  message: string,
  faq: Array<{ question: string; answer: string }> | null
): string | null {
  if (!faq || faq.length === 0) return null;

  const messageLower = message.toLowerCase().trim();
  
  for (const item of faq) {
    const questionLower = item.question.toLowerCase();
    
    if (messageLower === questionLower) {
      return item.answer;
    }
    
    const questionWords = questionLower.split(' ').filter(w => w.length > 3);
    const matchingWords = questionWords.filter(word => messageLower.includes(word));
    
    if (matchingWords.length >= questionWords.length * 0.6) {
      return item.answer;
    }
  }
  
  return null;
}

// Sincroniza variáveis capturadas nel flujo (name, phone, email, etc.) para el lead vinculado.
// Campos conhecidos van direto na coluna del lead; demais entram em custom_fields.
async function syncFlowVarsToLead(
  supabase: any,
  conversationId: string,
  flowVariables: Record<string, string>,
  options?: { onlyKeys?: string[] }
): Promise<void> {
  try {
    const { data: conv } = await supabase
      .from('webchat_conversations')
      .select('lead_id, organization_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv?.lead_id) return;

    const KNOWN: Record<string, string> = {
      name: 'name', nombre: 'name', full_name: 'name',
      email: 'email', 'e-mail': 'email',
      phone: 'phone', teléfono: 'phone', whatsapp: 'phone', celular: 'phone',
      company: 'company', empresa: 'company',
      cpf: 'cpf', cnpj: 'cnpj',
    };

    const update: Record<string, any> = {};
    const customFields: Record<string, any> = {};
    let hasCustom = false;

    const entries = Object.entries(flowVariables).filter(([k, v]) => {
      if (k.startsWith('__')) return false;
      if (v == null || String(v).trim() === '') return false;
      if (options?.onlyKeys && !options.onlyKeys.includes(k)) return false;
      return true;
    });

    for (const [rawKey, rawValue] of entries) {
      const key = rawKey.toLowerCase();
      const value = String(rawValue).trim();
      const mapped = KNOWN[key];
      if (mapped) {
        update[mapped] = value;
        if (mapped === 'phone') update.phone_normalized = value.replace(/\D/g, '');
      } else {
        customFields[rawKey] = value;
        hasCustom = true;
      }
    }

    if (Object.keys(update).length === 0 && !hasCustom) return;

    if (hasCustom) {
      const { data: leadRow } = await supabase
        .from('leads')
        .select('custom_fields')
        .eq('id', conv.lead_id)
        .maybeSingle();
      update.custom_fields = { ...(leadRow?.custom_fields || {}), ...customFields };
    }

    await supabase.from('leads').update(update).eq('id', conv.lead_id);
    console.log('[syncFlowVarsToLead] Lead actualizado:', conv.lead_id, Object.keys(update));
  } catch (e) {
    console.error('[syncFlowVarsToLead] error (no-fatal):', e);
  }
}

// Avalia condicional simples do bloco condition contra flow_variables
function evaluateCondition(
  cond: { variable?: string; operator?: string; value?: any } | undefined,
  vars: Record<string, string>
): boolean {
  if (!cond?.variable || !cond.operator) return false;
  const left = String(vars[cond.variable] ?? '').toLowerCase();
  const right = String(cond.value ?? '').toLowerCase();
  switch (cond.operator) {
    case 'equals': return left === right;
    case 'not_equals': return left !== right;
    case 'contains': return left.includes(right);
    case 'greater_than': return Number(left) > Number(right);
    case 'less_than': return Number(left) < Number(right);
    default: return false;
  }
}

// Execute flow block and determine next action
async function executeFlowBlock(
  supabase: any,
  conversationId: string,
  userMessage: string,
  flowContext: {
    current_flow_id: string | null;
    current_block_id: string | null;
    flow_variables: Record<string, string>;
    flow_completed: boolean;
  },
  productId?: string
): Promise<{
  message?: any;
  flow_update?: {
    current_block_id: string | null;
    flow_variables: Record<string, string>;
    flow_completed: boolean;
  };
  buttons?: any[];
  video_url?: string;
  action?: string;
  action_data?: {
    url?: string;
    open_in_new_tab?: boolean;
    number?: string;
    message?: string;
  };
}> {
  try {
    // Fetch the flow
    const { data: flowData, error: flowError } = await supabase
      .from('chat_flows')
      .select('*')
      .eq('id', flowContext.current_flow_id)
      .single();

    if (flowError || !flowData) {
      console.error('[executeFlowBlock] Flow not found:', flowError);
      return { flow_update: { ...flowContext, flow_completed: true } };
    }

    const flow: ChatFlow = {
      id: flowData.id,
      blocks: flowData.blocks || [],
      start_block_id: flowData.start_block_id,
      collected_variables: flowData.collected_variables || [],
    };

    const currentBlock = flow.blocks.find((b: FlowBlock) => b.id === flowContext.current_block_id);
    
    if (!currentBlock) {
      console.error('[executeFlowBlock] Block not found:', flowContext.current_block_id);
      return { flow_update: { ...flowContext, flow_completed: true } };
    }

    let responseContent = '';
    let nextBlockId: string | null = currentBlock.next_block_id || null;
    let flowVariables = { ...flowContext.flow_variables };
    let flowCompleted = false;
    let responseButtons: any[] | undefined;
    let responseVideoUrl: string | undefined;
    let messageType = 'text';

    switch (currentBlock.type) {
      case 'message':
        responseContent = currentBlock.data.content || '';
        break;

      case 'input':
        // User's message is the input value - save it to flow variables
        if (currentBlock.data.variable_name) {
          flowVariables[currentBlock.data.variable_name] = userMessage;
          console.log('[executeFlowBlock] Saved variable:', currentBlock.data.variable_name, '=', userMessage);
          // Sincroniza imediatamente nel lead vinculado (name/phone/email/...)
          await syncFlowVarsToLead(supabase, conversationId, flowVariables, {
            onlyKeys: [currentBlock.data.variable_name],
          });
        }
        
        // Move to next block - we need to execute it immediately
        if (nextBlockId) {
          const nextBlock = flow.blocks.find((b: FlowBlock) => b.id === nextBlockId);
          if (nextBlock) {
            // Execute next block
            return executeNextBlock(supabase, conversationId, flow, nextBlock, flowVariables);
          }
        }
        break;

      case 'buttons':
        // Check if user clicked a button (message matches button label or ID)
        const clickedButton = currentBlock.data.buttons?.find(
          (btn: FlowBlockButton) => btn.label.toLowerCase() === userMessage.toLowerCase() || btn.id === userMessage
        );
        
        if (clickedButton) {
          // Process button action based on action_type
          const actionType = clickedButton.action_type || 'next_block';
          
          switch (actionType) {
            case 'next_block':
              // User clicked a button, move to the button's target
              nextBlockId = clickedButton.next_block_id;
              if (nextBlockId) {
                const nextBlock = flow.blocks.find((b: FlowBlock) => b.id === nextBlockId);
                if (nextBlock) {
                  return executeNextBlock(supabase, conversationId, flow, nextBlock, flowVariables);
                }
              }
              break;
              
            case 'url':
              // Return action for widget to open URL
              return {
                message: null,
                action: 'open_url',
                action_data: {
                  url: clickedButton.url || '',
                  open_in_new_tab: clickedButton.open_in_new_tab !== false,
                },
                flow_update: {
                  current_block_id: currentBlock.id,
                  flow_variables: flowVariables,
                  flow_completed: false,
                },
              };
              
            case 'whatsapp':
              // Return action for widget to open WhatsApp
              return {
                message: null,
                action: 'open_whatsapp',
                action_data: {
                  number: clickedButton.whatsapp_number || '',
                  message: clickedButton.whatsapp_message || '',
                },
                flow_update: {
                  current_block_id: currentBlock.id,
                  flow_variables: flowVariables,
                  flow_completed: false,
                },
              };
              
            case 'ai_takeover':
              // AI takes over the conversation
              flowCompleted = true;
              
              // Store AI context if provided
              if (clickedButton.ai_context) {
                flowVariables['__ai_context'] = clickedButton.ai_context;
              }
              
              // Update conversation state
              await supabase
                .from('webchat_conversations')
                .update({
                  current_block_id: null,
                  flow_variables: flowVariables,
                  flow_completed: true,
                })
                .eq('id', conversationId);
              
              console.log('[executeFlowBlock] AI takeover via button, context:', clickedButton.ai_context);
              
              return {
                message: null,
                flow_update: {
                  current_block_id: null,
                  flow_variables: flowVariables,
                  flow_completed: true,
                },
              };
              
            case 'handoff':
              // Transfer to human agent
              flowCompleted = true;
              responseContent = 'Vou transferir usted para um agente. Aguarde um momento!';
              
              // Update conversation status — IA larga el lead, va para fila do sector
              await supabase
                .from('webchat_conversations')
                .update({ 
                  status: 'waiting_human',
                  current_block_id: null,
                  flow_completed: true,
                  current_agent_id: null,
                  assigned_user_id: null,
                  needs_human: true,
                })
                .eq('id', conversationId);
              
              // Save message
              const { data: handoffMsg } = await supabase
                .from('webchat_messages')
                .insert({
                  conversation_id: conversationId,
                  direction: 'outbound',
                  sender_type: 'bot',
                  content: responseContent,
                  message_type: 'text',
                })
                .select()
                .single();
              
              return {
                message: handoffMsg,
                flow_update: {
                  current_block_id: null,
                  flow_variables: flowVariables,
                  flow_completed: true,
                },
              };
          }
        } else {
          // Show buttons again
          responseContent = currentBlock.data.content || 'Escolha una opción:';
          messageType = 'buttons';
          responseButtons = currentBlock.data.buttons?.map((btn: FlowBlockButton, index: number) => ({
            id: btn.id,
            label: `${btn.emoji || ''} ${btn.label}`.trim(),
            type: btn.action_type === 'url' ? 'url' : 
                  btn.action_type === 'whatsapp' ? 'whatsapp' : 'flow_button',
            action: btn.action_type === 'url' ? btn.url : 
                    btn.action_type === 'whatsapp' ? btn.whatsapp_number : btn.id,
            style: index === 0 ? 'primary' : 'secondary',
            cta_type: btn.action_type || 'flow',
            action_type: btn.action_type || 'next_block',
            whatsapp_message: btn.whatsapp_message,
            open_in_new_tab: btn.open_in_new_tab,
          }));
        }
        break;

      case 'ai_takeover':
        // AI takes over the conversation
        flowCompleted = true;
        
        // Se o bloco tiene agente específico, usar ele
        if (currentBlock.data.agent_id) {
          await supabase
            .from('webchat_conversations')
            .update({ current_agent_id: currentBlock.data.agent_id })
            .eq('id', conversationId);
          
          flowVariables['__current_agent_id'] = currentBlock.data.agent_id;
          console.log('[executeFlowBlock] AI takeover with agent:', currentBlock.data.agent_id);
        }
        
        // Armazenar overrides de permisos
        if (currentBlock.data.override_can_do?.length) {
          flowVariables['__override_can_do'] = JSON.stringify(currentBlock.data.override_can_do);
        }
        if (currentBlock.data.override_cannot_do?.length) {
          flowVariables['__override_cannot_do'] = JSON.stringify(currentBlock.data.override_cannot_do);
        }
        if (currentBlock.data.override_handoff_triggers?.length) {
          flowVariables['__override_handoff_triggers'] = JSON.stringify(currentBlock.data.override_handoff_triggers);
        }
        
        // Armazenar config de auto-switch
        if (currentBlock.data.auto_switch_enabled && currentBlock.data.auto_switch_agents?.length) {
          flowVariables['__auto_switch_config'] = JSON.stringify(currentBlock.data.auto_switch_agents);
          console.log('[executeFlowBlock] Auto-switch enabled with', currentBlock.data.auto_switch_agents.length, 'agents');
        }
        
        // Contexto adicional
        if (currentBlock.data.ai_context_prompt) {
          flowVariables['__ai_context'] = currentBlock.data.ai_context_prompt;
        }
        
        responseContent = currentBlock.data.ai_context_prompt 
          ? `[Contexto para IA: ${currentBlock.data.ai_context_prompt}]`
          : '';
        console.log('[executeFlowBlock] AI takeover with variables:', Object.keys(flowVariables));
        break;

      case 'handoff':
        // Transfer to human agent
        flowCompleted = true;
        responseContent = currentBlock.data.handoff_message || 'Vou transferir usted para um agente.';
        
        // Update conversation status — IA larga el lead, va para fila do sector
        await supabase
          .from('webchat_conversations')
          .update({
            status: 'waiting_human',
            current_agent_id: null,
            assigned_user_id: null,
            needs_human: true,
          })
          .eq('id', conversationId);
        break;

      case 'tag':
        // Add tag tel lead (implementation would connect tel leads table)
        console.log('[executeFlowBlock] Tag applied:', currentBlock.data.tag_name, '=', currentBlock.data.tag_value);
        
        // Move to next block immediately
        if (nextBlockId) {
          const nextBlock = flow.blocks.find((b: FlowBlock) => b.id === nextBlockId);
          if (nextBlock) {
            return executeNextBlock(supabase, conversationId, flow, nextBlock, flowVariables);
          }
        }
        break;

      case 'video':
        responseContent = currentBlock.data.video_title || 'Assista a este vídeo:';
        responseVideoUrl = currentBlock.data.video_url;
        messageType = 'video';
        break;

      case 'delay':
        // In a real implementation, this would use a job queue
        // For now, we just move to the next block
        if (nextBlockId) {
          const nextBlock = flow.blocks.find((b: FlowBlock) => b.id === nextBlockId);
          if (nextBlock) {
            return executeNextBlock(supabase, conversationId, flow, nextBlock, flowVariables);
          }
        }
        break;
      
      case 'agent_switch':
        // Switch to a different agent
        const newAgentId = currentBlock.data.agent_id;
        
        if (newAgentId) {
          // Update conversation with new agent
          await supabase
            .from('webchat_conversations')
            .update({ current_agent_id: newAgentId })
            .eq('id', conversationId);
          
          flowVariables['__current_agent_id'] = newAgentId;
          console.log('[executeFlowBlock] Switched to agent:', newAgentId);
        }
        
        // Move to next block immediately
        if (nextBlockId) {
          const nextBlock = flow.blocks.find((b: FlowBlock) => b.id === nextBlockId);
          if (nextBlock) {
            return executeNextBlock(supabase, conversationId, flow, nextBlock, flowVariables);
          }
        }
        break;

      case 'create_lead':
      case 'update_lead':
        // Sincroniza todas as variáveis capturadas para el lead vinculado.
        // O lead ya es auto-creado em webchat-api ao iniciar la conversación,
        // entonces tanto 'create_lead' cuánto 'update_lead' acabam fazendo update.
        await syncFlowVarsToLead(supabase, conversationId, flowVariables);
        if (nextBlockId) {
          const nb = flow.blocks.find((b: FlowBlock) => b.id === nextBlockId);
          if (nb) return executeNextBlock(supabase, conversationId, flow, nb, flowVariables);
        }
        break;

      case 'score': {
        const inc = Number(currentBlock.data.score_value || 0);
        if (inc) {
          const { data: convRow } = await supabase
            .from('webchat_conversations')
            .select('lead_id')
            .eq('id', conversationId)
            .maybeSingle();
          if (convRow?.lead_id) {
            const { data: leadRow } = await supabase
              .from('leads')
              .select('score')
              .eq('id', convRow.lead_id)
              .maybeSingle();
            const newScore = Number(leadRow?.score || 0) + inc;
            await supabase.from('leads').update({ score: newScore }).eq('id', convRow.lead_id);
            console.log('[executeFlowBlock] score +', inc, '→', newScore);
          }
        }
        if (nextBlockId) {
          const nb = flow.blocks.find((b: FlowBlock) => b.id === nextBlockId);
          if (nb) return executeNextBlock(supabase, conversationId, flow, nb, flowVariables);
        }
        break;
      }

      case 'tag': {
        const tagsToAdd: string[] = currentBlock.data.apply_tags
          || (currentBlock.data.tag_name ? [currentBlock.data.tag_name] : []);
        if (tagsToAdd.length) {
          const { data: convRow } = await supabase
            .from('webchat_conversations')
            .select('lead_id')
            .eq('id', conversationId)
            .maybeSingle();
          if (convRow?.lead_id) {
            const { data: leadRow } = await supabase
              .from('leads')
              .select('tags')
              .eq('id', convRow.lead_id)
              .maybeSingle();
            const merged = Array.from(new Set([...(leadRow?.tags || []), ...tagsToAdd]));
            await supabase.from('leads').update({ tags: merged }).eq('id', convRow.lead_id);
            console.log('[executeFlowBlock] tags aplicadas:', tagsToAdd);
          }
        }
        if (nextBlockId) {
          const nb = flow.blocks.find((b: FlowBlock) => b.id === nextBlockId);
          if (nb) return executeNextBlock(supabase, conversationId, flow, nb, flowVariables);
        }
        break;
      }

      case 'condition': {
        const branch = evaluateCondition(currentBlock.data.condition, flowVariables);
        const target = branch
          ? currentBlock.data.true_next_block_id
          : currentBlock.data.false_next_block_id;
        console.log('[executeFlowBlock] condition →', branch ? 'true' : 'false', target);
        if (target) {
          const nb = flow.blocks.find((b: FlowBlock) => b.id === target);
          if (nb) return executeNextBlock(supabase, conversationId, flow, nb, flowVariables);
        }
        nextBlockId = target || null;
        break;
      }

      case 'create_task': {
        const cfg = currentBlock.data.task_config;
        const { data: convRow } = await supabase
          .from('webchat_conversations')
          .select('lead_id, organization_id')
          .eq('id', conversationId)
          .maybeSingle();
        if (cfg && convRow?.lead_id) {
          // Substitui {{var}} no template
          const renderTpl = (tpl: string) =>
            Object.entries(flowVariables).reduce(
              (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v ?? '')),
              tpl || ''
            );
          const dueAt = new Date(Date.now() + (cfg.due_in_days || 1) * 86400000).toISOString();
          await supabase.from('tasks').insert({
            organization_id: convRow.organization_id,
            lead_id: convRow.lead_id,
            title: renderTpl(cfg.title_template) || 'Tarea do embudo',
            description: renderTpl(cfg.description_template) || null,
            due_at: dueAt,
            assigned_to: cfg.assign_to === 'specific_user' ? cfg.user_id : null,
            squad_id: cfg.assign_to === 'squad' ? cfg.squad_id : null,
            status: 'pending',
          });
          console.log('[executeFlowBlock] task creada para lead', convRow.lead_id);
        }
        if (nextBlockId) {
          const nb = flow.blocks.find((b: FlowBlock) => b.id === nextBlockId);
          if (nb) return executeNextBlock(supabase, conversationId, flow, nb, flowVariables);
        }
        break;
      }
    }

    // Save bot response message if we have content
    let botMessage = null;
    if (responseContent) {
      const { data: msg, error: msgError } = await supabase
        .from('webchat_messages')
        .insert({
          conversation_id: conversationId,
          direction: 'outbound',
          sender_type: 'bot',
          content: responseContent,
          message_type: messageType,
          buttons: responseButtons || null,
          video_url: responseVideoUrl || null,
        })
        .select()
        .single();

      if (msgError) {
        console.error('[executeFlowBlock] Error saving message:', msgError);
      } else {
        botMessage = msg;
      }
    }

    // Update conversation flow state
    await supabase
      .from('webchat_conversations')
      .update({
        current_block_id: nextBlockId,
        flow_variables: flowVariables,
        flow_completed: flowCompleted,
      })
      .eq('id', conversationId);

    return {
      message: botMessage,
      flow_update: {
        current_block_id: nextBlockId,
        flow_variables: flowVariables,
        flow_completed: flowCompleted,
      },
      buttons: responseButtons,
      video_url: responseVideoUrl,
    };
  } catch (error) {
    console.error('[executeFlowBlock] Error:', error);
    return { flow_update: { ...flowContext, flow_completed: true } };
  }
}

// Helper to execute a block immediately (used for chaining blocks)
async function executeNextBlock(
  supabase: any,
  conversationId: string,
  flow: ChatFlow,
  block: FlowBlock,
  flowVariables: Record<string, string>
): Promise<{
  message?: any;
  flow_update?: {
    current_block_id: string | null;
    flow_variables: Record<string, string>;
    flow_completed: boolean;
  };
  buttons?: any[];
  video_url?: string;
  action?: string;
  action_data?: {
    url?: string;
    open_in_new_tab?: boolean;
    number?: string;
    message?: string;
  };
}> {
  let responseContent = '';
  let messageType = 'text';
  let responseButtons: any[] | undefined;
  let responseVideoUrl: string | undefined;
  let nextBlockId: string | null = block.next_block_id || null;
  let flowCompleted = false;

  switch (block.type) {
    case 'message':
      responseContent = block.data.content || '';
      // Replace variables in content
      Object.entries(flowVariables).forEach(([key, value]) => {
        responseContent = responseContent.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      });
      break;

    case 'input':
      responseContent = block.data.placeholder || 'Digite su respuesta...';
      break;

    case 'buttons':
      responseContent = block.data.content || 'Escolha una opción:';
      // Replace variables in content
      Object.entries(flowVariables).forEach(([key, value]) => {
        responseContent = responseContent.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      });
      messageType = 'buttons';
      responseButtons = block.data.buttons?.map((btn: FlowBlockButton, index: number) => ({
        id: btn.id,
        label: `${btn.emoji || ''} ${btn.label}`.trim(),
        type: btn.action_type === 'url' ? 'url' : 
              btn.action_type === 'whatsapp' ? 'whatsapp' : 'flow_button',
        action: btn.action_type === 'url' ? btn.url : 
                btn.action_type === 'whatsapp' ? btn.whatsapp_number : btn.id,
        style: index === 0 ? 'primary' : 'secondary',
        cta_type: btn.action_type || 'flow',
        action_type: btn.action_type || 'next_block',
        whatsapp_message: btn.whatsapp_message,
        open_in_new_tab: btn.open_in_new_tab,
      }));
      break;

    case 'ai_takeover':
      flowCompleted = true;
      break;

    case 'handoff':
      flowCompleted = true;
      responseContent = block.data.handoff_message || 'Vou transferir usted para um agente.';
      await supabase
        .from('webchat_conversations')
        .update({
          status: 'waiting_human',
          current_agent_id: null,
          assigned_user_id: null,
          needs_human: true,
        })
        .eq('id', conversationId);
      break;

    case 'video':
      responseContent = block.data.video_title || 'Assista a este vídeo:';
      responseVideoUrl = block.data.video_url;
      messageType = 'video';
      break;
    
    case 'agent_switch':
      // Switch agent and continue to next block
      if (block.data.agent_id) {
        await supabase
          .from('webchat_conversations')
          .update({ current_agent_id: block.data.agent_id })
          .eq('id', conversationId);
        
        flowVariables['__current_agent_id'] = block.data.agent_id;
        console.log('[executeNextBlock] Switched to agent:', block.data.agent_id);
      }
      
      // Continue to next block
      if (nextBlockId) {
        const nextBlock = flow.blocks.find((b: FlowBlock) => b.id === nextBlockId);
        if (nextBlock) {
          return executeNextBlock(supabase, conversationId, flow, nextBlock, flowVariables);
        }
      }
      break;

    case 'create_lead':
    case 'update_lead':
      await syncFlowVarsToLead(supabase, conversationId, flowVariables);
      if (nextBlockId) {
        const nb = flow.blocks.find((b: FlowBlock) => b.id === nextBlockId);
        if (nb) return executeNextBlock(supabase, conversationId, flow, nb, flowVariables);
      }
      break;

    case 'score': {
      const inc = Number(block.data.score_value || 0);
      if (inc) {
        const { data: convRow } = await supabase
          .from('webchat_conversations')
          .select('lead_id')
          .eq('id', conversationId)
          .maybeSingle();
        if (convRow?.lead_id) {
          const { data: leadRow } = await supabase
            .from('leads').select('score').eq('id', convRow.lead_id).maybeSingle();
          await supabase.from('leads')
            .update({ score: Number(leadRow?.score || 0) + inc })
            .eq('id', convRow.lead_id);
        }
      }
      if (nextBlockId) {
        const nb = flow.blocks.find((b: FlowBlock) => b.id === nextBlockId);
        if (nb) return executeNextBlock(supabase, conversationId, flow, nb, flowVariables);
      }
      break;
    }

    case 'tag': {
      const tagsToAdd: string[] = block.data.apply_tags
        || (block.data.tag_name ? [block.data.tag_name] : []);
      if (tagsToAdd.length) {
        const { data: convRow } = await supabase
          .from('webchat_conversations').select('lead_id').eq('id', conversationId).maybeSingle();
        if (convRow?.lead_id) {
          const { data: leadRow } = await supabase
            .from('leads').select('tags').eq('id', convRow.lead_id).maybeSingle();
          const merged = Array.from(new Set([...(leadRow?.tags || []), ...tagsToAdd]));
          await supabase.from('leads').update({ tags: merged }).eq('id', convRow.lead_id);
        }
      }
      if (nextBlockId) {
        const nb = flow.blocks.find((b: FlowBlock) => b.id === nextBlockId);
        if (nb) return executeNextBlock(supabase, conversationId, flow, nb, flowVariables);
      }
      break;
    }

    case 'condition': {
      const branch = evaluateCondition(block.data.condition, flowVariables);
      const target = branch ? block.data.true_next_block_id : block.data.false_next_block_id;
      if (target) {
        const nb = flow.blocks.find((b: FlowBlock) => b.id === target);
        if (nb) return executeNextBlock(supabase, conversationId, flow, nb, flowVariables);
      }
      nextBlockId = target || null;
      break;
    }

    default:
      // For unknown/passthrough blocks (delay, etc.), continue to next block
      if (nextBlockId) {
        const nextBlock = flow.blocks.find((b: FlowBlock) => b.id === nextBlockId);
        if (nextBlock) {
          return executeNextBlock(supabase, conversationId, flow, nextBlock, flowVariables);
        }
      }
  }

  // Save message if we have content
  let botMessage = null;
  if (responseContent) {
    const { data: msg } = await supabase
      .from('webchat_messages')
      .insert({
        conversation_id: conversationId,
        direction: 'outbound',
        sender_type: 'bot',
        content: responseContent,
        message_type: messageType,
        buttons: responseButtons || null,
        video_url: responseVideoUrl || null,
      })
      .select()
      .single();
    
    botMessage = msg;
  }

  // Update conversation state
  await supabase
    .from('webchat_conversations')
    .update({
      current_block_id: block.id,
      flow_variables: flowVariables,
      flow_completed: flowCompleted,
    })
    .eq('id', conversationId);

  return {
    message: botMessage,
    flow_update: {
      current_block_id: block.id,
      flow_variables: flowVariables,
      flow_completed: flowCompleted,
    },
    buttons: responseButtons,
    video_url: responseVideoUrl,
  };
}

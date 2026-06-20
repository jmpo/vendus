// Orchestrator: classifies an incoming lead message into product + intent
// and decides whether to route, ask a clarifying question, or hand off to a human.

import { injectPromptVariables } from "./prompt-variables.ts";
import { aiChat } from "./ai-call.ts";
import { recordAIUsage } from "./ai-router.ts";

export type Intent = 'informacao' | 'compra' | 'suporte' | 'financiero' | 'humano' | 'indefinida';

export interface OrchestratorOutput {
  produto_id: string | null;
  produto_nome: string | null;
  intencao: Intent;
  confianca: number;
  contexto_extraido: string;
  respuesta_orquestrador: string;
}

export interface OrchestratorRunInput {
  supabase?: any;
  organizationId?: string | null;
  organizationName: string;
  channel: string;
  channelIdentifier?: string | null;
  products: Array<{ id: string; name: string; description?: string | null }>;
  orchestratorContext: string;
  questionCount: number;
  maxTriageQuestions: number;
  message: string;
  customPrompt?: string | null; // overrides the default prompt template
}

const DEFAULT_ORCHESTRATOR_TEMPLATE = `Sos el orquestador de atención de {{organization_name}}.

Tu ÚNICA función es leer el mensaje recibido, clasificar el producto y la intención,
y devolver un JSON estructurado. No vendés, no explicás productos,
no respondés dudas técnicas. Solo clasificás y derivás.

CANAL DE ENTRADA
Canal: {{channel}}
Conexión: {{channel_identifier}}

PRODUCTOS DISPONIBLES EN ESTA ORGANIZACIÓN
{{products_list}}
La descripción de cada producto incluye los MODELOS que abarca. Si el cliente menciona un modelo (ej.: "C3", "Aircross", "C4 Cactus", "Basalt", "2008", "208", "3008", "5008"), identificá a qué producto pertenece según las descripciones y devolvé ese produto_id con confianza alta.

INTENCIONES QUE DEBÉS IDENTIFICAR
- informacao → el cliente quiere entender el producto o sacarse una duda
- compra     → el cliente quiere comprar, saber precio o condiciones
- suporte    → el cliente ya lo es y tiene un problema técnico
- financiero → pago, reembolso, cobranza, factura
- humano     → el cliente pidió explícitamente hablar con una persona
- indefinida → no se pudo clasificar con confianza

CONTEXTO ACUMULADO
{{orchestrator_context}}
Preguntas ya hechas: {{question_count}}

MENSAJE RECIBIDO
"{{message}}"

REGLAS
1. Si el cliente dice "humano", "agente", "persona", "vendedor" o "hablar con alguien"
   → intencao = "humano" inmediatamente.
2. Si el cliente menciona una MARCA o un MODELO que coincide con un producto (los modelos están en la descripción de cada producto), devolvé ese produto_id con confianza ALTA (0.8 o más). Sé decidido: ante una mención clara de marca o modelo NO pidas aclaración, derivá directamente.
3. Si produto_id es null y todavía hay preguntas disponibles,
   → intencao = "indefinida" y escribí en respuesta_orquestrador UNA pregunta corta y cordial
   para saber qué VEHÍCULO o marca le interesa (ej.: "¿Qué modelo o marca estás buscando, Citroën o Peugeot?").
   NUNCA preguntes sobre procesos, operación, empresa, negocio ni temas que no sean vehículos:
   es una concesionaria que vende AUTOS a personas.
4. Si produto_id sigue siendo null y se alcanzó el límite de preguntas,
   → intencao = "humano" y respuesta_orquestrador = "Te conecto con uno de nuestros asesores ahora mismo."
5. contexto_extraido debe ser una frase objetiva de lo que quiere el cliente.
6. respuesta_orquestrador solo se completa cuando intencao = "indefinida".`;

function buildPrompt(input: OrchestratorRunInput): string {
  const productsList = input.products.length
    ? input.products
        .map((p) => `- ${p.name} (id: ${p.id})${p.description ? ` — ${p.description.slice(0, 300)}` : ''}`)
        .join('\n')
    : '- (ningún producto registrado)';

  const template = (input.customPrompt && input.customPrompt.trim().length > 0)
    ? input.customPrompt
    : DEFAULT_ORCHESTRATOR_TEMPLATE;

  return injectPromptVariables(template, {
    organization: { name: input.organizationName },
    conversation: {
      channel: input.channel,
      channel_identifier: input.channelIdentifier || '',
      orchestrator_context: input.orchestratorContext || '(ningún)',
      question_count: input.questionCount,
    },
    message: input.message,
    products_list: productsList,
  });
}

const VALID_INTENTS: Intent[] = ['informacao', 'compra', 'suporte', 'financiero', 'humano', 'indefinida'];

function safeOutput(partial: Partial<OrchestratorOutput>): OrchestratorOutput {
  const intent = (partial.intencao && VALID_INTENTS.includes(partial.intencao)) ? partial.intencao : 'indefinida';
  return {
    produto_id: partial.produto_id ?? null,
    produto_nome: partial.produto_nome ?? null,
    intencao: intent,
    confianca: typeof partial.confianca === 'number' ? Math.max(0, Math.min(1, partial.confianca)) : 0,
    contexto_extraido: partial.contexto_extraido || '',
    respuesta_orquestrador: partial.respuesta_orquestrador || '',
  };
}

export async function runOrchestrator(input: OrchestratorRunInput): Promise<OrchestratorOutput> {
  const systemPrompt = buildPrompt(input);

  const tool = {
    type: 'function',
    function: {
      name: 'classify_message',
      description: 'Clasifica el mensaje recibido en producto e intención',
      parameters: {
        type: 'object',
        properties: {
          produto_id: { type: ['string', 'null'], description: 'UUID exacto del producto identificado, o null' },
          produto_nome: { type: ['string', 'null'], description: 'Nombre legible del producto, o null' },
          intencao: { type: 'string', enum: VALID_INTENTS },
          confianca: { type: 'number', description: 'Confianza 0-1' },
          contexto_extraido: { type: 'string' },
          respuesta_orquestrador: { type: 'string', description: 'Pregunta corta para el cliente solo si intencao=indefinida' },
        },
        required: ['intencao', 'confianca', 'contexto_extraido', 'respuesta_orquestrador'],
        additionalProperties: false,
      },
    },
  };

  try {
    const { response: resp, config } = await aiChat({
      supabase: input.supabase,
      organizationId: input.organizationId,
      capability: 'agent_chat',
      model: 'google/gemini-2.5-flash',
      label: 'orchestrator',
      body: {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input.message },
        ],
        tools: [tool],
        tool_choice: { type: 'function', function: { name: 'classify_message' } },
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('[orchestrator] provider error:', config.provider, resp.status, text);
      return safeOutput({
        intencao: 'indefinida',
        respuesta_orquestrador: '¿Podés explicar con más detalle lo que necesitás?',
      });
    }

    const data = await resp.json();
    await recordAIUsage(input.supabase, input.organizationId, config, 'agent_chat', data?.usage, 'orchestrator');
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return safeOutput({ intencao: 'indefinida', respuesta_orquestrador: '¿Podés contarme un poco más sobre lo que buscás?' });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (parseErr) {
      console.error('[orchestrator] JSON parse error:', parseErr);
      return safeOutput({ intencao: 'indefinida', respuesta_orquestrador: '¿Podés contarme un poco más sobre lo que necesitás?' });
    }

    return safeOutput(parsed);
  } catch (err) {
    console.error('[orchestrator] unexpected error:', err);
    return safeOutput({
      intencao: 'indefinida',
      respuesta_orquestrador: 'Podés explicar rapidamente o que usted precisa?',
    });
  }
}

export const ORCHESTRATOR_DEFAULT_TEMPLATE = DEFAULT_ORCHESTRATOR_TEMPLATE;

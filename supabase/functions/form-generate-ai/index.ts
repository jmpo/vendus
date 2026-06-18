import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { recordLovableUsage } from '../_shared/ai-router.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateFormRequest {
  product_id: string;
  objective: 'qualification' | 'diagnostic' | 'capture' | 'presale' | 'feedback';
  tone: 'formal' | 'informal' | 'technical';
  num_questions: number;
  form_name?: string;
  // New fields for enhanced generation
  user_context?: string;
  use_brain?: boolean;
  use_objections?: boolean;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('OPENAI_API_KEY');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { 
      product_id, 
      objective, 
      tone, 
      num_questions, 
      form_name,
      user_context = '',
      use_brain = true,
      use_objections = true
    } = await req.json() as GenerateFormRequest;

    console.log('Generating form for product:', product_id, 'objective:', objective, 'with brain:', use_brain, 'with objections:', use_objections);

    // Fetch product details
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', product_id)
      .single();

    if (productError || !product) {
      console.error('Product not found:', productError);
      return new Response(
        JSON.stringify({ error: 'Producto no encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build product context (using REAL columns from public.products)
    const pitch = product.pitch_2min || product.pitch_30s || product.pitch_15s || 'N/A';
    const differentials = Array.isArray(product.differentials)
      ? product.differentials.filter(Boolean).join(', ')
      : (product.differentials || 'N/A');
    const problemsSolved = [product.benefits, product.objections].filter(Boolean).join('\n') || 'N/A';

    let productContext = `
Producto: ${product.name}
Descripción corta: ${product.short_description || 'N/A'}
Descripción: ${product.description || 'N/A'}
Pitch: ${pitch}
ICP (Cliente Ideal): ${product.icp || 'N/A'}
Diferenciais: ${differentials}
Benefícios / Problemas que resolve: ${problemsSolved}
Planos: ${product.plans || 'N/A'}
Garantia: ${product.guarantee || 'N/A'}
`;

    // Fetch knowledge sources for context (if use_brain is true)
    let knowledgeContext = '';
    if (use_brain) {
      const { data: knowledgeSources } = await supabase
        .from('product_knowledge_sources')
        .select('title, source_type, extracted_content, question, answer')
        .eq('product_id', product_id)
        .eq('status', 'processed')
        .eq('is_active', true)
        .limit(10);

      if (knowledgeSources && knowledgeSources.length > 0) {
        knowledgeContext = knowledgeSources.map(ks => {
          if (ks.source_type === 'faq' && ks.question && ks.answer) {
            return `FAQ - ${ks.question}: ${ks.answer}`;
          }
          return `${ks.title} (${ks.source_type}): ${ks.extracted_content?.substring(0, 800) || ''}`;
        }).join('\n\n');
      }

      // Fetch agent training materials
      const { data: trainingMaterials } = await supabase
        .from('agent_training_materials')
        .select('content')
        .eq('product_id', product_id)
        .limit(5);

      if (trainingMaterials && trainingMaterials.length > 0) {
        knowledgeContext += '\n\nMateriais de Treinamento:\n' + 
          trainingMaterials.map(m => m.content?.substring(0, 500)).join('\n');
      }
    }

    // Fetch objections (if use_objections is true)
    let objectionsContext = '';
    if (use_objections) {
      const { data: objections } = await supabase
        .from('objections')
        .select('category, what_they_say, what_they_mean, suggested_response')
        .eq('product_id', product_id)
        .limit(10);

      if (objections && objections.length > 0) {
        objectionsContext = objections.map(obj => 
          `- Categoria: ${obj.category}\n  O que dizem: "${obj.what_they_say}"\n  O que significa: ${obj.what_they_mean || 'N/A'}`
        ).join('\n\n');
      }
    }

    const objectiveDescriptions = {
      qualification: 'Qualificar leads identificando fit con o producto e maturidade de compra. Crea preguntas que identifiquem se el lead es um ICP qualificado.',
      diagnostic: 'Diagnosticar necessidades e dores del lead para personalizar a abordagem comercial. Foque em entender o cenário atual e desafios.',
      capture: 'Captar información básicas de contato de forma rápida e no-invasiva. Mantené o formulário corto e direto.',
      presale: 'Preparar el lead para uma reunión de ventas coletando información detalladas sobre expectativas e orçamento.',
      feedback: 'Coletar feedback sobre o producto ou processo de ventas. Usa escalas e preguntas abiertas.',
    };

    const toneDescriptions = {
      formal: 'Usa lenguaje formal e profissional, adequada para B2B corporativo. Evita modismos e mantené tom respeitoso.',
      informal: 'Usa lenguaje amigable e descontraída, como una conversación casual. Sé cálido e empático.',
      technical: 'Usa termos técnicos relevantes ao sector, assumindo conocimiento prévio. Sé necesito e objetivo.',
    };

    // Build enhanced system prompt
    const systemPrompt = `Vos sos um especialista em creación de formulários de captación de leads para ventas B2B.
Su objetivo es gerar um formulário otimizado para conversión, baseado no contexto completo do producto e da campaña.

CONTEXTO DO PRODUTO:
${productContext}

${knowledgeContext ? `CONHECIMENTO DO CÉREBRO DO PRODUTO (Fontes Processadas):
${knowledgeContext}

` : ''}${objectionsContext ? `OBJEÇÕES COMUNS DOS CLIENTES (Usa para crear preguntas de calificación):
${objectionsContext}

` : ''}${user_context ? `CONTEXTO ESPECÍFICO DA CAMPANHA (Fornecido por el usuario — PRIORIDADE MÁXIMA):
${user_context}

⚠️ ATENÇÃO: As preguntas DEVEM refletir explicitamente o contexto acima. Se o usuario citou nicho, campaña (ex: Black Friday), ICP específico, sector, evento ou objeción concreta, as preguntas precisam abordar eso diretamente. No gere um formulário genérico.

` : ''}OBJETIVO DO FORMULÁRIO: ${objectiveDescriptions[objective]}

TOM DE COMUNICAÇÃO: ${toneDescriptions[tone]}

REGRAS IMPORTANTES:
1. Crea preguntas claras e objetivas que qualifiquem o lead
2. Usa a lenguaje adequada ao tom solicitado
3. ${use_objections && objectionsContext ? 'Usa as objeciones para crear preguntas inteligentes de calificación (ex: se objeción es precio, preguntes sobre orçamento disponible)' : 'Inclua preguntas que ajudem a entender o perfil del lead'}
4. ${use_brain && knowledgeContext ? 'Baseie as preguntas no conocimiento real do producto e sus diferenciais' : 'Foque nas necessidades típicas do ICP descrito'}
5. ${user_context ? 'Personalize as preguntas para el contexto da campaña descrito acima — no ignore esse contexto' : 'Foque em capturar dados que ajudem o time de ventas'}
6. Límite ao número de preguntas solicitado (${num_questions} preguntas + telas de boas-vindas e agradecimento)
7. Retorne SOLO um JSON válido, sin explicaciones ou markdown

TIPOS DE BLOCOS VÁLIDOS (use SOLO estes valores em block_type):
- welcome_screen: Pantalla de bienvenida (SIEMPRE el primer bloque)
- text: Pergunta de texto corto. Para nombre/empresa/cargo, use "text" con maps_to apropiado ("name", "company")
- textarea: Texto largo (descripción, dor, expectativa)
- email: Email (use maps_to: "email")
- phone: Teléfono/WhatsApp (use maps_to: "phone")
- number: Número
- select: Selección única (inclua "options" como array de {label, value})
- multi_select: Selección múltiple (inclua "options" como array de {label, value})
- yes_no: Sí/No
- scale: Escala numérica — IMPORTANTE: coloque a configuración em "options" como objeto {"min":1,"max":10,"min_label":"...","max_label":"..."}
- end_screen: Pantalla final/agradecimiento (SIEMPRE el último bloque)

NO use "name", "company" ou "thank_you_screen" como block_type — esses valores son inválidos.

FORMATO DE RESPOSTA (JSON ARRAY puro, sin markdown):
[
  {"block_type":"welcome_screen","label":"Título cálido","description":"Subtítulo"},
  {"block_type":"text","label":"Qual su nombre?","placeholder":"Su nombre","required":true,"maps_to":"name"},
  {"block_type":"text","label":"Empresa?","required":true,"maps_to":"company"},
  {"block_type":"select","label":"Principal desafio?","options":[{"label":"Opción A","value":"a"},{"label":"Opción B","value":"b"}],"required":true},
  {"block_type":"scale","label":"De 1 a 10, urgência?","options":{"min":1,"max":10,"min_label":"Podés esperar","max_label":"Urgente"},"required":true},
  {"block_type":"email","label":"Su mejor email?","required":true,"maps_to":"email"},
  {"block_type":"end_screen","label":"Gracias!","description":"Entraremos em contato."}
]

IMPORTANTE: O array debe conter exatamente ${num_questions} blocos de pregunta + welcome_screen + end_screen (total: ${num_questions + 2} blocos).`;

    const userPrompt = `Genera o formulário de ${num_questions} preguntas seguindo as instrucciones acima. Retorne SOLO o JSON array, sin explicaciones ou código markdown.`;

    console.log('Calling AI to generate form with enriched context...');

    // Call Lovable AI Gateway
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 3000,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Error ao gerar formulário con IA' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    await recordLovableUsage(supabase, product?.organization_id, 'content_generation', 'gpt-4o-mini', aiData?.usage, 'form-generate-ai');
    const aiContent = aiData.choices?.[0]?.message?.content;

    console.log('AI response received, parsing...');

    // Parse the JSON response (robust)
    let blocks;
    try {
      let cleanContent = (aiContent || '').trim();
      // strip markdown fences
      cleanContent = cleanContent.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      // extract first [ ... last ]
      const start = cleanContent.indexOf('[');
      const end = cleanContent.lastIndexOf(']');
      if (start !== -1 && end !== -1 && end > start) {
        cleanContent = cleanContent.slice(start, end + 1);
      }
      try {
        blocks = JSON.parse(cleanContent);
      } catch {
        // remove trailing commas and retry
        const repaired = cleanContent.replace(/,\s*([}\]])/g, '$1');
        blocks = JSON.parse(repaired);
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiContent);
      return new Response(
        JSON.stringify({ error: 'Error ao processar respuesta da IA', raw: aiContent }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!Array.isArray(blocks) || blocks.length === 0) {
      return new Response(
        JSON.stringify({ error: 'IA no devolvió blocos válidos' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }


    // Normalize/validate blocks — map deprecated AI outputs to valid types.
    const VALID_TYPES = new Set([
      'text','email','phone','number','textarea','select','multi_select','yes_no','scale',
      'conditional','score','tag','hidden_field','ai_question','ai_followup','welcome_screen','end_screen'
    ]);
    const enhancedBlocks = blocks.map((block: any, index: number) => {
      let type = String(block.block_type || 'text');
      let maps_to = block.maps_to || null;

      // Backwards-compat: AI may return name/company/thank_you_screen
      if (type === 'name') { type = 'text'; maps_to = maps_to || 'name'; }
      else if (type === 'company') { type = 'text'; maps_to = maps_to || 'company'; }
      else if (type === 'thank_you_screen' || type === 'thanks' || type === 'end') { type = 'end_screen'; }
      else if (type === 'welcome' || type === 'intro') { type = 'welcome_screen'; }

      if (!VALID_TYPES.has(type)) type = 'text';

      // scale_options -> options (engine reads block.options for scale config)
      let options = block.options ?? null;
      if (type === 'scale' && block.scale_options && !options) {
        options = block.scale_options;
      }

      return {
        id: crypto.randomUUID(),
        form_id: '',
        block_type: type,
        label: block.label || 'Pergunta',
        description: block.description || null,
        placeholder: block.placeholder || null,
        required: block.required !== false,
        options,
        maps_to,
        order_index: index,
        score_value: null,
        logic_rules: null,
        validation: null,
        block_settings: null,
      };
    });

    console.log('Generated', enhancedBlocks.length, 'blocks successfully');

    // Generate suggested form name based on context
    const objectiveNames = {
      qualification: 'Calificación',
      diagnostic: 'Diagnóstico',
      capture: 'Captación',
      presale: 'Pré-venta',
      feedback: 'Feedback',
    };

    const suggestedName = form_name || `${product.name} - ${objectiveNames[objective]}`;

    return new Response(
      JSON.stringify({
        success: true,
        blocks: enhancedBlocks,
        suggested_name: suggestedName,
        product_name: product.name,
        context_used: {
          brain: use_brain && !!knowledgeContext,
          objections: use_objections && !!objectionsContext,
          user_context: !!user_context,
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in form-generate-ai:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error interno';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

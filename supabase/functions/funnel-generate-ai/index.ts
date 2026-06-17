import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { recordLovableUsage } from '../_shared/ai-router.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateFunnelRequest {
  product_id: string;
  prompt: string;
  tone: 'formal' | 'informal' | 'technical';
  use_brain: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('OPENAI_API_KEY');

    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ error: 'OPENAI_API_KEY no configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { product_id, prompt, tone = 'informal', use_brain = true } = await req.json() as GenerateFunnelRequest;

    if (!product_id || !prompt) {
      return new Response(
        JSON.stringify({ error: 'product_id e prompt son obligatorios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating funnel for product:', product_id);

    // Fetch product details
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', product_id)
      .single();

    if (productError || !product) {
      return new Response(
        JSON.stringify({ error: 'Producto no encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build product context
    let productContext = `
Producto: ${product.name}
Descripción: ${product.description || 'N/A'}
Pitch: ${product.pitch || 'N/A'}
ICP (Cliente Ideal): ${product.icp || 'N/A'}
Diferenciais: ${product.differentials || 'N/A'}
Problemas que resolve: ${product.problems_solved || 'N/A'}
`;

    // Fetch knowledge sources if use_brain
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
          return `${ks.title} (${ks.source_type}): ${ks.extracted_content?.substring(0, 500) || ''}`;
        }).join('\n\n');
      }
    }

    const toneDescriptions: Record<string, string> = {
      formal: 'Usá lenguaje formal y profesional. Evitá modismos.',
      informal: 'Usá lenguaje amigable y distendido, como una conversación casual. Los emojis son bienvenidos.',
      technical: 'Usá términos técnicos relevantes. Sé preciso y objetivo.',
    };

    const systemPrompt = `Vos sos um especialista em crear funis de captación de leads de alta conversión.
Su trabajo es transformar a descripción do usuario em um flujo de blocos estruturados que serão renderizados como uma landing page interativa.

CONTEXTO DO PRODUTO:
${productContext}

${knowledgeContext ? `CONHECIMENTO DO PRODUTO (Cérebro):
${knowledgeContext}

` : ''}TOM DE COMUNICAÇÃO: ${toneDescriptions[tone]}

TIPOS DE BLOCOS DISPONÍVEIS:

1. **message** - Exibir texto/contenido para el lead
   Campos: { content: "texto con suporte a markdown" }
   Usa para: boas-vindas, explicaciones, transições entre secciones

2. **input** - Capturar um dado del lead
   Campos: { input_type: "name"|"email"|"phone"|"text"|"number"|"cpf"|"textarea", variable_name: "nome_variavel", placeholder: "texto placeholder", required: true/false }
   Usa para: nombre, email, WhatsApp, empresa, etc.

3. **buttons** - Menu de opciones clicáveis (RAMIFICAÇÃO)
   Campos: { content: "pregunta ou contexto", options: [{ id: "uuid", label: "Texto dla opción", emoji: "🚀", next_block_id: "uuid_do_bloco_destino" }] }
   Usa para: elegís que levam a caminhos diferentes. CADA OPÇÃO DEVE TER next_block_id apontando para o bloco correto.

4. **video** - Exibir vídeo embedado
   Campos: { content: "texto descritivo", video_url: "URL_PLACEHOLDER" }
   Usa para: vídeos explicativos. Usa "URL_PLACEHOLDER" como url — o usuario substituirá después.

5. **end** - Tela final de éxito
   Campos: { success_message: "mensaje final", redirect_url: "" }
   Usa para: finalizar um camino do embudo

6. **score** - Adicionar puntuación al lead (invisível)
   Campos: { score_value: número }

7. **tag** - Aplicar tags al lead (invisível)
   Campos: { apply_tags: ["tag1", "tag2"] }

REGRAS DE CONEXÃO:
- Bloques lineales: usá "next_block_id" en el bloque para apuntar al próximo
- Blocos buttons: cada option tiene su propio "next_block_id" (ramificação)
- Bloques score/tag: son invisibles, conectalos al próximo bloque visible vía next_block_id
- Blocos end: NÃO têm next_block_id (son terminais)
- Genera IDs usando formato UUID v4

REGRAS DE POSIÇÃO (X/Y no canvas):
- Blocos em sequência linear: incrementar Y em 150, manter X constante
- Cuando hay ramificação (buttons con N opciones): 
  - O bloco buttons fica na posición atual
  - Os caminhos ramificam horizontalmente: primero camino em X=100, segundo em X=450, terceiro em X=800
  - Cada camino continua incrementando Y normalmente
- Usa X base = 250 para o flujo principal

FORMATO DE RESPOSTA (JSON):
{
  "suggested_name": "Nombre sugerido para el embudo",
  "start_block_id": "uuid_do_primero_bloco",
  "flow_blocks": [
    {
      "id": "uuid-gerado",
      "type": "message",
      "position": { "x": 250, "y": 50 },
      "data": { "content": "Texto..." },
      "next_block_id": "uuid-proximo"
    }
  ]
}

IMPORTANTE:
- Retorne SOLO JSON válido, sin markdown ou explicaciones
- Todos los IDs devem ser UUIDs v4 únicos
- Todas las conexiones next_block_id devem referenciar IDs existentes
- Cada camino de ramificação DEVE terminar con um bloco "end"
- Usa emojis nos botones para tornar a experiência mais visual
- Creá copys cortos y conversacionales, optimizados para mobile
- Se o usuario mencionar vídeos, use blocos video con video_url: "URL_PLACEHOLDER"
- Se o usuario mencionar planos/precios, crie botones con as opciones e blocos end con redirect_url vacío`;

    const userPrompt = `Crea o embudo de captación seguindo esta descripción:

${prompt}

Retorne SOLO o JSON no formato especificado, sin explicaciones.`;

    console.log('Calling AI to generate funnel...');

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
        max_tokens: 8000,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Límite de solicitudes excedido. Probá novamente em algunos segundos.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Créditos insuficientes. Adicione créditos ao workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'Error ao gerar embudo con IA' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    await recordLovableUsage(supabase, product?.organization_id, 'content_generation', 'gpt-4o-mini', aiData?.usage, 'funnel-generate-ai');
    const aiContent = aiData.choices?.[0]?.message?.content;

    console.log('AI response received, parsing...');

    // Parse JSON response
    let parsed;
    try {
      let cleanContent = aiContent.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```\n?/, '').replace(/\n?```$/, '');
      }
      parsed = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiContent);
      return new Response(
        JSON.stringify({ error: 'Error ao processar respuesta da IA. Probá novamente.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate structure
    if (!parsed.flow_blocks || !Array.isArray(parsed.flow_blocks) || parsed.flow_blocks.length === 0) {
      return new Response(
        JSON.stringify({ error: 'IA no gerou blocos válidos. Probá con uma descripción mais detallada.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Ensure all blocks have required fields
    const validatedBlocks = parsed.flow_blocks.map((block: any) => ({
      id: block.id || crypto.randomUUID(),
      type: block.type || 'message',
      position: block.position || { x: 250, y: 50 },
      data: block.data || {},
      next_block_id: block.next_block_id || null,
    }));

    console.log('Generated', validatedBlocks.length, 'blocks successfully');

    return new Response(
      JSON.stringify({
        success: true,
        flow_blocks: validatedBlocks,
        start_block_id: parsed.start_block_id || validatedBlocks[0]?.id,
        suggested_name: parsed.suggested_name || `Embudo - ${product.name}`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in funnel-generate-ai:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error interno';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

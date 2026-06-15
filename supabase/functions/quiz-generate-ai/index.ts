import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { recordLovableUsage } from '../_shared/ai-router.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateQuizRequest {
  product_id?: string;
  name?: string;
  objective?: string;
  context: string;
  tone?: 'profissional' | 'consultivo' | 'descontraido' | 'direto';
  result_type?: 'classificacao' | 'diagnostico' | 'recomendacao' | 'pontuacao';
  capture_name?: boolean;
  capture_whatsapp?: boolean;
  capture_email?: boolean;
  use_brain?: boolean;
}

const TONE_LABELS: Record<string, string> = {
  profissional: 'Profissional e consultivo, evite gírias e emojis em excesso.',
  consultivo: 'Consultivo, baseado em SPIN selling. Faça preguntas que despertem reflexão.',
  descontraido: 'Descontraído, próximo, puede usar emojis e linguagem casual.',
  direto: 'Direto, sem rodeios, preguntas curtas e objetivas.',
};

const RESULT_LABELS: Record<string, string> = {
  classificacao: 'Clasifica o lead em 3 categorias (frio/morno/quente) com base no score.',
  diagnostico: 'Genera um diagnóstico detalhado com 3 níveis de maturidade.',
  recomendacao: 'Recomende a melhor opción/plano/caminho para el lead.',
  pontuacao: 'Mostre uma pontuação final com mensaje corta.',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY no configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const body = await req.json() as GenerateQuizRequest;
    const {
      product_id, name, objective, context,
      tone = 'profissional', result_type = 'classificacao',
      capture_name = true, capture_whatsapp = true, capture_email = false,
      use_brain = true,
    } = body;

    if (!context || context.trim().length < 20) {
      return new Response(JSON.stringify({ error: 'Contexto do quiz é obligatorio (mínimo 20 caracteres).' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Contexto opcional do producto + cérebro
    let productContext = '';
    let knowledgeContext = '';
    let billingOrgId: string | null = null;
    if (product_id) {
      const { data: product } = await supabase.from('products').select('*').eq('id', product_id).maybeSingle();
      if (product) {
        billingOrgId = product.organization_id ?? null;
        productContext = `
Producto: ${product.name}
Descripción: ${product.description || 'N/A'}
ICP: ${product.icp || 'N/A'}
Diferenciais: ${product.differentials || 'N/A'}
Problemas que resolve: ${product.problems_solved || 'N/A'}
`;
        if (use_brain) {
          const { data: ks } = await supabase
            .from('product_knowledge_sources')
            .select('title, source_type, extracted_content, question, answer')
            .eq('product_id', product_id)
            .eq('status', 'processed')
            .eq('is_active', true)
            .limit(8);
          if (ks?.length) {
            knowledgeContext = ks.map((k: any) =>
              k.source_type === 'faq' && k.question
                ? `FAQ — ${k.question}: ${k.answer}`
                : `${k.title}: ${(k.extracted_content || '').substring(0, 400)}`,
            ).join('\n\n');
          }
        }
      }
    }

    const captureFields: string[] = [];
    if (capture_name) captureFields.push('Nombre (input_type:"text", variable_name:"nombre")');
    if (capture_whatsapp) captureFields.push('WhatsApp (input_type:"phone", variable_name:"whatsapp")');
    if (capture_email) captureFields.push('E-mail (input_type:"email", variable_name:"email")');

    const systemPrompt = `Usted é especialista em crear QUIZZES de qualificação de leads de alta conversão.

${productContext ? `CONTEXTO DO PRODUTO:\n${productContext}\n` : ''}
${knowledgeContext ? `CONHECIMENTO DO PRODUTO (Cérebro):\n${knowledgeContext}\n` : ''}
TOM: ${TONE_LABELS[tone]}
TIPO DE RESULTADO: ${RESULT_LABELS[result_type]}

ESTRUTURA OBRIGATÓRIA (em ordem):
1. Bloco "text" de boas-vindas corto.
2. 3 a 6 blocos "buttons" (preguntas de múltipla escolha), cada um com 3-4 opciones, cada opción com {id, letter (A/B/C/D), label, score (0-35), tag (opcional)}.
3. Blocos "input" para capturar:
${captureFields.map((f) => `   - ${f}`).join('\n') || '   - (ningún)'}
4. Bloco "end" com:
   - content: "Resultado pronto!"
   - result_tiers: array com 3 níveis [{id, label, min, max, color, message}]
   - result_metrics: array opcional [{id, label, value (0-100), display:"percent", color}]

REGRAS:
- Usa linguagem natural, sem clichês.
- Score total possível ~100-150 pontos distribuídos entre as opciones.
- Cada bloco tiene campo "variable_name" único (ex: q1, q2, faturamento, urgencia).
- NÃO inclua next_block_id (o cliente conecta linearmente).
- NÃO inclua "id" nos blocos (o cliente gera).
- NÃO use markdown, retorne APENAS JSON puro.

FORMATO DE RESPOSTA (JSON):
{
  "suggested_name": "Nombre do quiz",
  "suggested_description": "Descripción corta do objetivo",
  "blocks": [
    { "type": "text", "data": { "content": "Boas-vindas..." } },
    { "type": "buttons", "data": { "label": "Pergunta?", "variable_name": "q1",
      "options": [{"id":"1","letter":"A","label":"Opción","score":10,"tag":"opt-tag"}] } },
    { "type": "input", "data": { "label":"Su nombre", "variable_name":"nombre", "input_type":"text", "required":true } },
    { "type": "end", "data": {
        "content": "Resultado!",
        "result_tiers": [
          {"id":"t1","label":"Iniciante","min":0,"max":40,"color":"#f97316","message":"..."},
          {"id":"t2","label":"Intermediário","min":41,"max":80,"color":"#3b82f6","message":"..."},
          {"id":"t3","label":"Avançado","min":81,"max":150,"color":"#10b981","message":"..."}
        ]
    } }
  ],
  "suggested_tags": ["tag1","tag2"]
}`;

    const userPrompt = `Nombre do Quiz: ${name || 'N/A'}
Objetivo: ${objective || 'N/A'}

CONTEXTO DETALHADO:
${context}

Retorne APENAS o JSON.`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${lovableApiKey}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 6000,
      }),
    });

    if (!aiResponse.ok) {
      const text = await aiResponse.text();
      console.error('AI error', aiResponse.status, text);
      if (aiResponse.status === 429) return new Response(JSON.stringify({ error: 'Limite excedido. Aguarde e tente novamente.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (aiResponse.status === 402) return new Response(JSON.stringify({ error: 'Créditos insuficientes. Adicione créditos ao workspace.' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ error: 'Error ao gerar quiz com IA' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const aiData = await aiResponse.json();
    await recordLovableUsage(supabase, billingOrgId, 'content_generation', 'google/gemini-2.5-flash', aiData?.usage, 'quiz-generate-ai');
    const content = aiData.choices?.[0]?.message?.content || '';

    let cleanContent = content.trim();
    if (cleanContent.startsWith('```json')) cleanContent = cleanContent.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    else if (cleanContent.startsWith('```')) cleanContent = cleanContent.replace(/^```\n?/, '').replace(/\n?```$/, '');

    let parsed;
    try { parsed = JSON.parse(cleanContent); }
    catch (e) {
      console.error('Parse fail', content);
      return new Response(JSON.stringify({ error: 'Resposta da IA inválida. Tente novamente.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!parsed.blocks || !Array.isArray(parsed.blocks) || parsed.blocks.length === 0) {
      return new Response(JSON.stringify({ error: 'IA no gerou preguntas válidas.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: true,
      suggested_name: parsed.suggested_name || name || 'Quiz IA',
      suggested_description: parsed.suggested_description || objective || '',
      blocks: parsed.blocks,
      suggested_tags: parsed.suggested_tags || [],
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('quiz-generate-ai error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Error interno' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

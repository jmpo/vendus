// Cria uma oportunidad (deal) no pipeline para el lead atual.
import type { ToolDefinition } from '../types.ts';

export const criarDealTool: ToolDefinition = {
  name: 'criar_deal',
  description:
    'Cria uma oportunidad de venta (deal) no pipeline para el lead atual. Usa quando o lead demonstrar intenção clara de compra ou solicitar uma proposta. No use para preguntas informativas.',
  categories: ['crm'],
  estimated_cost_cents: 0,
  parameters: {
    type: 'object',
    properties: {
      product_id: {
        type: 'string',
        description: 'UUID do producto a ser vinculado ao deal. Obrigatório.',
      },
      deal_value: {
        type: 'number',
        description: 'Valor estimado da oportunidad em reais (ex: 297.00).',
      },
      plan_name: {
        type: 'string',
        description: 'Nombre do plano/oferta escolhido pelo lead, se aplicável.',
      },
      notes: {
        type: 'string',
        description: 'Observación corta sobre o contexto do deal.',
      },
    },
    required: ['product_id', 'deal_value'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    if (!ctx.leadId) {
      return { success: false, error: 'leadId é obligatorio no contexto' };
    }

    // Busca o vendedor responsável pelo lead (se houver)
    const { data: lead } = await ctx.supabase
      .from('leads')
      .select('assigned_to, organization_id')
      .eq('id', ctx.leadId)
      .single();

    if (!lead) {
      return { success: false, error: 'Lead no encontrado' };
    }

    // Se no há vendedor atribuído, usa um placeholder (deal "del agente")
    // — mas a tabela exige seller_id NOT NULL, então usamos o assigned_to del lead.
    const sellerId = lead.assigned_to;
    if (!sellerId) {
      return {
        success: false,
        error: 'Lead ainda no tiene vendedor atribuído. Atribua antes de crear o deal.',
      };
    }

    const { data: deal, error } = await ctx.supabase
      .from('deals')
      .insert({
        lead_id: ctx.leadId,
        product_id: input.product_id,
        seller_id: sellerId,
        organization_id: ctx.organizationId,
        deal_value: input.deal_value,
        plan_name: input.plan_name ?? null,
        notes: input.notes ?? `Criado pelo agente ${ctx.agentName ?? 'IA'}`,
        status: 'open',
      })
      .select()
      .single();

    if (error) return { success: false, error: error.message };

    return {
      success: true,
      data: { deal_id: deal.id, deal_value: deal.deal_value },
      user_message: `Oportunidade registrada no valor de R$ ${Number(deal.deal_value).toFixed(2)}.`,
    };
  },
};

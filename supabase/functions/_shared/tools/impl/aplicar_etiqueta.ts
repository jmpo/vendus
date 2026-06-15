// Aplica uma etiqueta (tag) al lead atual. Podés crear a etiqueta automaticamente se no existir.
import type { ToolDefinition } from '../types.ts';

export const aplicarEtiquetaTool: ToolDefinition = {
  name: 'aplicar_etiqueta',
  description:
    'Aplica uma etiqueta (tag) al lead atual para classificá-lo. Usa para marcar status como "interesado_premium", "objecao_preco", "abandueñou_checkout", "comprou_produto_x" etc. Se a etiqueta no existir, será creada automaticamente.',
  categories: ['crm', 'marketing'],
  estimated_cost_cents: 0,
  parameters: {
    type: 'object',
    properties: {
      tag_name: {
        type: 'string',
        description: 'Nombre da etiqueta (ex: "interesado_premium"). Usa snake_case.',
      },
      color: {
        type: 'string',
        description: 'Cor hex opcional para etiqueta nova (ex: "#3B82F6"). Default: azul.',
      },
    },
    required: ['tag_name'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    if (!ctx.leadId) return { success: false, error: 'leadId obligatorio' };

    const tagName = String(input.tag_name).trim().toLowerCase();
    if (!tagName) return { success: false, error: 'tag_name vazio' };

    // 1) Procura a tag na organización (case-insensitive).
    const { data: existing } = await ctx.supabase
      .from('lead_tags')
      .select('id, name')
      .eq('organization_id', ctx.organizationId)
      .ilike('name', tagName)
      .maybeSingle();

    let tagId = existing?.id;

    // 2) Cria a tag se no existir.
    if (!tagId) {
      const { data: created, error: createErr } = await ctx.supabase
        .from('lead_tags')
        .insert({
          organization_id: ctx.organizationId,
          name: tagName,
          color: input.color ?? '#3B82F6',
          is_automatic: true,
          description: `Criada automaticamente por el agente ${ctx.agentName ?? 'IA'}`,
        })
        .select('id')
        .single();

      if (createErr) return { success: false, error: createErr.message };
      tagId = created.id;
    }

    // 3) Atribui al lead (idempotente — se ya existir, ignora).
    const { error: assignErr } = await ctx.supabase
      .from('lead_tag_assignments')
      .upsert(
        {
          lead_id: ctx.leadId,
          tag_id: tagId,
          applied_by: null,
          source: 'agent_ai',
        },
        { onConflict: 'lead_id,tag_id', ignoreDuplicates: true },
      );

    if (assignErr) return { success: false, error: assignErr.message };

    return {
      success: true,
      data: { tag_id: tagId, tag_name: tagName },
      user_message: `Etiqueta "${tagName}" aplicada al lead.`,
    };
  },
};

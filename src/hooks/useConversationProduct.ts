import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

/**
 * Permite corregir MANUALMENTE el producto/línea de una conversación cuando la IA
 * (orquestador) lo clasificó mal. Al cambiar el producto:
 *  - re-rutea la conversación al closer de ese producto,
 *  - actualiza el producto del lead,
 *  - mapea la etapa del lead a la etapa del MISMO nombre en el nuevo producto
 *    (modelo "etapas estándar compartidas"); si no existe, usa la primera etapa.
 */
export function useConversationProduct(conversationId: string, leadId: string | null | undefined) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const orgId = profile?.organization_id;

  const products = useQuery({
    queryKey: ['conv-product-list', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name')
        .eq('organization_id', orgId!)
        .eq('is_active', true)
        .order('name');
      return data ?? [];
    },
  });

  const current = useQuery({
    queryKey: ['conv-product-current', conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const { data } = await supabase
        .from('webchat_conversations')
        .select('product_id')
        .eq('id', conversationId)
        .maybeSingle();
      return data?.product_id ?? null;
    },
  });

  const reassign = useMutation({
    mutationFn: async (productId: string) => {
      // 1. Closer del nuevo producto (preferí el default)
      const { data: closer } = await supabase
        .from('product_agents')
        .select('id')
        .eq('product_id', productId)
        .eq('agent_type', 'closer')
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .limit(1)
        .maybeSingle();

      // 2. Conversación: producto + closer + estado en atención
      const convUpd: Record<string, any> = { product_id: productId };
      if (closer?.id) { convUpd.current_agent_id = closer.id; convUpd.orchestrator_state = 'em_atendimento'; }
      const { error: convErr } = await supabase.from('webchat_conversations').update(convUpd).eq('id', conversationId);
      if (convErr) throw convErr;

      // 3. Lead: producto + mapear etapa por nombre (o primera etapa del nuevo producto)
      if (leadId) {
        const { data: lead } = await supabase.from('leads').select('current_stage_id').eq('id', leadId).maybeSingle();
        let newStageId: string | null = null;
        const { data: newStages } = await supabase
          .from('pipeline_stages')
          .select('id, name, order_index, is_won, is_lost')
          .eq('product_id', productId)
          .order('order_index', { ascending: true });
        if (newStages && newStages.length) {
          let curName: string | null = null;
          if (lead?.current_stage_id) {
            const { data: curStage } = await supabase.from('pipeline_stages').select('name').eq('id', lead.current_stage_id).maybeSingle();
            curName = curStage?.name ?? null;
          }
          newStageId = (curName && newStages.find((s) => s.name === curName)?.id)
            || newStages.find((s) => !s.is_won && !s.is_lost)?.id
            || newStages[0].id;
        }
        const { error: leadErr } = await supabase.from('leads').update({ product_id: productId, ...(newStageId ? { current_stage_id: newStageId } : {}) }).eq('id', leadId);
        if (leadErr) throw leadErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conv-product-current', conversationId] });
      qc.invalidateQueries({ queryKey: ['lead-booking'] });
      toast.success('Producto reasignado — la conversación pasó al especialista correcto');
    },
    onError: (e: any) => toast.error('No se pudo reasignar el producto', { description: e.message }),
  });

  return { products, current, reassign };
}

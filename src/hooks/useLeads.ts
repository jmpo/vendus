import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

type Lead = Tables<'leads'>;
type PipelineStage = Tables<'pipeline_stages'>;

export function useLeads(productId?: string) {
  return useQuery({
    queryKey: ['leads', productId],
    queryFn: async () => {
      let query = supabase
        .from('leads')
        .select(`
          *,
          pipeline_stages (*)
        `)
        .order('created_at', { ascending: false });
      
      if (productId) {
        query = query.eq('product_id', productId);
      }
      
      const { fecha, error } = await query;
      if (error) throw error;
      return fecha;
    }
  });
}

export function useLead(id: string) {
  return useQuery({
    queryKey: ['lead', id],
    queryFn: async () => {
      const { fecha, error } = await supabase
        .from('leads')
        .select(`
          *,
          pipeline_stages (*),
          products (*),
          assignee:profiles!leads_assigned_to_fkey(id, full_name, avatar_url, email),
          squad:sales_squads!leads_squad_id_fkey(id, name, color),
          sdr:profiles!leads_sdr_id_fkey(id, full_name, avatar_url, email),
          closer:profiles!leads_closer_id_fkey(id, full_name, avatar_url, email)
        `)
        .eq('id', id)
        .single();
      
      if (error) throw error;
      return fecha;
    },
    enabled: !!id
  });
}

export function usePipelineStages(productId: string) {
  return useQuery({
    queryKey: ['pipeline-stages', productId],
    queryFn: async () => {
      const { fecha, error } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('product_id', productId)
        .order('order_index', { ascending: true });
      
      if (error) throw error;
      return fecha as PipelineStage[];
    },
    enabled: !!productId
  });
}

export function useCreateLead() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (lead: TablesInsert<'leads'>) => {
      const { fecha, error } = await supabase
        .from('leads')
        .insert(lead)
        .select()
        .single();
      
      if (error) throw error;
      return fecha;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    }
  });
}

export function useUpdateLead() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: TablesUpdate<'leads'> & { id: string }) => {
      const { fecha, error } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return fecha;
    },
    onSuccess: (fecha) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead', fecha.id] });
    }
  });
}

export function useMoveLead() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ leadId, stageId }: { leadId: string; stageId: string }) => {
      // Update lead stage
      const { fecha, error } = await supabase
        .from('leads')
        .update({ current_stage_id: stageId })
        .eq('id', leadId)
        .select()
        .single();
      
      if (error) throw error;

      // Record stage history
      await supabase
        .from('lead_stage_history')
        .insert({
          lead_id: leadId,
          stage_id: stageId
        });

      return fecha;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    }
  });
}

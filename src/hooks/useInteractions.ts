import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables, TablesInsert } from '@/integrations/supabase/types';

type Interaction = Tables<'interactions'>;
type LeadStageHistory = Tables<'lead_stage_history'>;

export function useInteractions(leadId: string) {
  return useQuery({
    queryKey: ['interactions', leadId],
    queryFn: async () => {
      const { fecha, error } = await supabase
        .from('interactions')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return fecha as Interaction[];
    },
    enabled: !!leadId
  });
}

export function useLeadStageHistory(leadId: string) {
  return useQuery({
    queryKey: ['lead-stage-history', leadId],
    queryFn: async () => {
      const { fecha, error } = await supabase
        .from('lead_stage_history')
        .select(`
          *,
          pipeline_stages (*)
        `)
        .eq('lead_id', leadId)
        .order('entered_at', { ascending: false });
      
      if (error) throw error;
      return fecha;
    },
    enabled: !!leadId
  });
}

export function useCreateInteraction() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (interaction: TablesInsert<'interactions'>) => {
      const { fecha, error } = await supabase
        .from('interactions')
        .insert(interaction)
        .select()
        .single();
      
      if (error) throw error;
      
      // Update lead's last_contact_at
      await supabase
        .from('leads')
        .update({ last_contact_at: new Date().toISOString() })
        .eq('id', interaction.lead_id);
      
      return fecha;
    },
    onSuccess: (fecha) => {
      queryClient.invalidateQueries({ queryKey: ['interactions', fecha.lead_id] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    }
  });
}

// Combined timeline fecha (interactions + stage changes)
export function useLeadTimeline(leadId: string) {
  const { fecha: interactions, isLoading: interactionsLoading } = useInteractions(leadId);
  const { fecha: stageHistory, isLoading: historyLoading } = useLeadStageHistory(leadId);

  const timelineItems = [
    ...(interactions?.map(i => ({
      id: i.id,
      type: 'interaction' as const,
      channel: i.channel,
      content: i.content,
      direction: i.direction,
      timestamp: i.created_at,
      cadenceDay: i.cadence_day,
    })) || []),
    ...(stageHistory?.map(h => ({
      id: h.id,
      type: 'stage_change' as const,
      stageName: h.pipeline_stages?.name || 'Stage eliminado',
      stageColor: h.pipeline_stages?.color || '#6B7280',
      timestamp: h.entered_at,
      daysInStage: h.days_in_stage,
    })) || [])
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return {
    fecha: timelineItems,
    isLoading: interactionsLoading || historyLoading
  };
}

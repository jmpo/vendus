import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface LeadBooking {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  status: string;
  location: string | null;
}

/**
 * Próximas citas agendadas (futuras, no canceladas) de un lead.
 * Se usa en el panel del contacto para mostrar si el cliente ya tiene un agendamiento.
 */
export function useLeadBooking(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ['lead-booking', leadId],
    enabled: !!leadId,
    queryFn: async (): Promise<LeadBooking[]> => {
      if (!leadId) return [];
      const { data, error } = await supabase
        .from('calendar_events')
        .select('id, title, start_time, end_time, status, location')
        .eq('lead_id', leadId)
        .eq('event_type', 'booking')
        .neq('status', 'cancelled')
        .gte('start_time', new Date().toISOString())
        .order('start_time', { ascending: true })
        .limit(3);
      if (error) throw error;
      return (data || []) as LeadBooking[];
    },
    staleTime: 30_000,
  });
}

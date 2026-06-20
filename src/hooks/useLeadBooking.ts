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
 * Próximas citas agendadas (futuras, no canceladas) de un contacto.
 * Busca por lead_id si hay lead vinculado; si no, por el teléfono de WhatsApp
 * (las citas del bot guardan metadata.guest_phone) — así se ven aunque no haya lead.
 * Se usa en el panel del contacto para mostrar si el cliente ya tiene un agendamiento.
 */
export function useLeadBooking(
  leadId: string | null | undefined,
  phone?: string | null,
) {
  const phoneDigits = (phone || '').replace(/\D/g, '');
  return useQuery({
    queryKey: ['lead-booking', leadId, phoneDigits],
    enabled: !!leadId || phoneDigits.length >= 6,
    queryFn: async (): Promise<LeadBooking[]> => {
      const base = () =>
        supabase
          .from('calendar_events')
          .select('id, title, start_time, end_time, status, location')
          .eq('event_type', 'booking')
          .neq('status', 'cancelled')
          .gte('start_time', new Date().toISOString())
          .order('start_time', { ascending: true })
          .limit(5);

      const results = new Map<string, LeadBooking>();

      // 1) Por lead vinculado
      if (leadId) {
        const { data, error } = await base().eq('lead_id', leadId);
        if (error) throw error;
        for (const b of (data || []) as LeadBooking[]) results.set(b.id, b);
      }

      // 2) Por teléfono de WhatsApp (cuando no hay lead o como complemento)
      if (phoneDigits.length >= 6) {
        const { data } = await base().eq('metadata->>guest_phone', phoneDigits);
        for (const b of (data || []) as LeadBooking[]) results.set(b.id, b);
      }

      return Array.from(results.values()).sort(
        (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      );
    },
    staleTime: 30_000,
  });
}

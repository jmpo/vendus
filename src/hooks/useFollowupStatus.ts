import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface FollowupStatus {
  active: boolean;          // hay un seguimiento programado en marcha
  attempt: number;          // número del PRÓXIMO intento (1-based)
  max: number;              // total de intentos configurados
  nextAt: string | null;    // cuándo se dispara el próximo
}

/**
 * Estado del seguimiento automático (IA) para una conversación.
 * Lee ai_outreach_queue: si hay una fila viva (no completada/cancelada) con un
 * próximo envío programado, devuelve en qué intento va y cuándo es el siguiente.
 * Sirve para mostrar el chip "Seguimiento IA X/Y · próximo …" en el chat.
 */
export function useFollowupStatus(conversationId?: string | null) {
  return useQuery<FollowupStatus | null>({
    queryKey: ['followup-status', conversationId],
    enabled: !!conversationId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { data } = await supabase
        .from('ai_outreach_queue')
        .select('followups_sent, max_followups, next_followup_at, status, followup_enabled')
        .eq('conversation_id', conversationId!)
        .not('status', 'in', '("completed","cancelled")')
        .order('next_followup_at', { ascending: true, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (!data || !(data as any).followup_enabled || !(data as any).next_followup_at) return null;

      const sent = Number((data as any).followups_sent ?? 0);
      const max = Number((data as any).max_followups ?? 0) || (sent + 1);
      // Si ya se agotaron los intentos, no hay seguimiento activo
      if (max > 0 && sent >= max) return null;

      return {
        active: true,
        attempt: sent + 1,
        max,
        nextAt: (data as any).next_followup_at,
      };
    },
  });
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Minutos de inactividad antes de que la IA retome la conversación (configurable por org).
 * Default 30 (coincide con DEFAULT_IDLE_MINUTES del human-handback-cron).
 */
export function useHandbackIdleMinutes(): number {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;
  const { data } = useQuery({
    queryKey: ['org-handback-idle', orgId],
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('organizations')
        .select('handback_idle_minutes')
        .eq('id', orgId!)
        .maybeSingle();
      return Number((data as any)?.handback_idle_minutes) || 30;
    },
  });
  return data ?? 30;
}

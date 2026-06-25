import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

// action_types que registran los guardrails (intervenciones del sistema sobre la IA).
export const GUARDRAIL_TYPES = [
  'hallucinated_booking_blocked',
  'scheduling_intent_missed',
  'empty_send_promise_guarded',
  'payment_link_promise_unfulfilled',
] as const;

export interface Intervention {
  id: string;
  action_type: string;
  success: boolean | null;
  error_message: string | null;
  action_data: any;
  result: any;
  conversation_id: string | null;
  created_at: string;
}

/**
 * Intervenciones de los guardrails: cada vez que la IA intentó "prometer sin hacer"
 * (enviar, agendar, pago) y el sistema la corrigió. Termómetro de calidad de la IA.
 * Lee de agent_action_logs (RLS lo limita a la org del usuario).
 */
export function useAgentInterventions(days = 30) {
  const [items, setItems] = useState<Intervention[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await supabase
      .from('agent_action_logs')
      .select('id, action_type, success, error_message, action_data, result, conversation_id, created_at')
      .in('action_type', GUARDRAIL_TYPES as unknown as string[])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);
    setItems((data as Intervention[]) ?? []);
    setLoading(false);
  }, [days]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return { items, loading, refetch: fetchAll };
}

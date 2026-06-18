import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface JourneyEvent {
  id: string;
  type: 'transfer' | 'assignment' | 'agent_switch';
  action: string; // 'assigned' | 'unassigned' | 'transferred' | 'auto_assigned' | 'agent_changed'
  created_at: string;
  from_user?: { id: string; full_name: string; avatar_url: string | null } | null;
  to_user?: { id: string; full_name: string; avatar_url: string | null } | null;
  internal_note?: string | null;
}

/**
 * Unified timeline for a conversation: transfers + assignment events.
 * Ordered by equipo DESC (most recent first).
 */
export function useConversationJourney(conversationId: string | null) {
  return useQuery({
    queryKey: ['conversation-journey', conversationId],
    enabled: !!conversationId,
    queryFn: async (): Promise<JourneyEvent[]> => {
      if (!conversationId) return [];

      const [transfersRes, eventsRes, agentLogsRes] = await Promise.all([
        supabase
          .from('conversation_transfers')
          .select(`
            id, created_at, internal_note,
            from_user:from_user_id(id, full_name, avatar_url),
            to_user:to_user_id(id, full_name, avatar_url)
          `)
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false }),
        supabase
          .from('webchat_assignment_events')
          .select(`
            id, created_at, action,
            from_user:from_user_id(id, full_name, avatar_url),
            to_user:to_user_id(id, full_name, avatar_url)
          `)
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false }),
        // Traspasos entre AGENTES de IA (orquestador → closer, closer → closer)
        supabase
          .from('agent_activation_logs')
          .select(`
            id, created_at, match_type,
            from_agent:from_agent_id(id, name),
            to_agent:to_agent_id(id, name)
          `)
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false }),
      ]);

      const transfers: JourneyEvent[] = (transfersRes.data || []).map((t: any) => ({
        id: `tr-${t.id}`,
        type: 'transfer',
        action: 'transferred',
        created_at: t.created_at,
        from_user: t.from_user,
        to_user: t.to_user,
        internal_note: t.internal_note,
      }));

      const events: JourneyEvent[] = (eventsRes.data || []).map((e: any) => ({
        id: `ev-${e.id}`,
        type: 'assignment',
        action: e.action,
        created_at: e.created_at,
        from_user: e.from_user,
        to_user: e.to_user,
      }));

      const agentSwitches: JourneyEvent[] = (agentLogsRes.data || [])
        .filter((a: any) => a.from_agent?.id && a.to_agent?.id && a.from_agent.id !== a.to_agent.id)
        .map((a: any) => ({
        id: `ag-${a.id}`,
        type: 'agent_switch',
        action: 'agent_changed',
        created_at: a.created_at,
        from_user: a.from_agent ? { id: a.from_agent.id, full_name: a.from_agent.name, avatar_url: null } : null,
        to_user: a.to_agent ? { id: a.to_agent.id, full_name: a.to_agent.name, avatar_url: null } : null,
      }));

      return [...transfers, ...events, ...agentSwitches].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    },
    staleTime: 30_000,
  });
}

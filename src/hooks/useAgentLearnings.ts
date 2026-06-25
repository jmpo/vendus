import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface AgentLearning {
  id: string;
  organization_id: string;
  category: string | null;
  insight: string;
  agent_type: string | null;
  evidence_count: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TrajectoryStats {
  booked: number;
  won: number;
  lost: number;
  total: number;
  lastAt: string | null;
}

const EMPTY_STATS: TrajectoryStats = { booked: 0, won: 0, lost: 0, total: 0, lastAt: null };

/**
 * Aprendizajes del "cerebro que aprende" para la org del usuario actual.
 * Los genera agent-learning-cron a partir de conversaciones que cerraron.
 */
export function useAgentLearnings() {
  const { profile } = useAuth();
  const orgId = (profile as any)?.organization_id ?? null;
  const [learnings, setLearnings] = useState<AgentLearning[]>([]);
  const [stats, setStats] = useState<TrajectoryStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [relearning, setRelearning] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    // RLS limita a la org del usuario.
    const [{ data: ls }, { data: tr }] = await Promise.all([
      supabase.from('agent_learnings').select('*').eq('active', true).order('category', { ascending: true }),
      supabase.from('agent_trajectories').select('outcome, created_at').order('created_at', { ascending: false }).limit(1000),
    ]);
    setLearnings((ls as AgentLearning[]) ?? []);
    const arr = (tr as Array<{ outcome: string; created_at: string }>) ?? [];
    setStats({
      booked: arr.filter((t) => t.outcome === 'booked').length,
      won: arr.filter((t) => t.outcome === 'won').length,
      lost: arr.filter((t) => t.outcome === 'lost').length,
      total: arr.length,
      lastAt: arr[0]?.created_at ?? null,
    });
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Descartar un aprendizaje (curar lo que el agente aprendió).
  const deactivate = useCallback(async (id: string) => {
    setLearnings((prev) => prev.filter((l) => l.id !== id));
    await supabase.from('agent_learnings').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id);
  }, []);

  // Forzar un re-aprendizaje ahora (solo de esta org).
  const relearn = useCallback(async () => {
    if (!orgId) return;
    setRelearning(true);
    try {
      await supabase.functions.invoke('agent-learning-cron', { body: { organization_id: orgId } });
      await fetchAll();
    } finally {
      setRelearning(false);
    }
  }, [orgId, fetchAll]);

  return { learnings, stats, loading, relearning, deactivate, relearn, refetch: fetchAll, orgId };
}

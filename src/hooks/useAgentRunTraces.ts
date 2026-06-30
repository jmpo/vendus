import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface TraceStep {
  seq: number;
  type: string;          // llm | tool | guardrail
  name: string;
  at_ms?: number;
  duration_ms?: number;
  ok?: boolean;
  status?: number;
  model?: string;
  provider?: string;
  item_id?: string;
  delivered?: boolean;
  retried?: boolean;
  error?: string | null;
}

export interface AgentRunTrace {
  id: string;
  conversation_id: string | null;
  product_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  trigger: string | null;
  channel: string | null;
  user_message: string | null;
  response_preview: string | null;
  orchestrator: { routed_agent?: string | null; agent_role?: string | null; [k: string]: any };
  steps: TraceStep[];
  guardrails: Array<{ name: string; action?: string }>;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  llm_ms: number | null;
  total_ms: number | null;
  status: string;        // ok | error | no_response | sin_saldo
  error: string | null;
  created_at: string;
}

export interface TraceFilters {
  days?: number;
  status?: string | null;       // filtra por status
  conversationId?: string | null;
}

/**
 * Traza de ejecución del bot por turno (auditoría tipo Oryntra).
 * Lee agent_run_traces — RLS limita a la org del usuario (o super_admin ve todo).
 */
export function useAgentRunTraces(filters: TraceFilters = {}) {
  const { days = 7, status = null, conversationId = null } = filters;
  const [items, setItems] = useState<AgentRunTrace[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    let q = supabase
      .from('agent_run_traces')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);
    if (status) q = q.eq('status', status);
    if (conversationId) q = q.eq('conversation_id', conversationId);
    const { data } = await q;
    setItems((data as AgentRunTrace[]) ?? []);
    setLoading(false);
  }, [days, status, conversationId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Agregados para las tarjetas de resumen.
  const summary = items.reduce(
    (acc, t) => {
      acc.runs += 1;
      acc.tokens += t.total_tokens || 0;
      acc.cost += Number(t.estimated_cost_usd) || 0;
      if (t.status && t.status !== 'ok') acc.errors += 1;
      if (t.total_ms) { acc.totalMs += t.total_ms; acc.timed += 1; }
      return acc;
    },
    { runs: 0, tokens: 0, cost: 0, errors: 0, totalMs: 0, timed: 0 },
  );
  const avgMs = summary.timed ? Math.round(summary.totalMs / summary.timed) : 0;

  return { items, loading, refetch: fetchAll, summary: { ...summary, avgMs } };
}

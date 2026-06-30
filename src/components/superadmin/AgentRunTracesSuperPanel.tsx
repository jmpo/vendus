import { useEffect, useMemo, useState } from 'react';
import { ListTree, Sparkles, Bot, Clock, DollarSign, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TraceCard } from '@/components/admin/traces/AgentRunTracesPanel';
import type { AgentRunTrace } from '@/hooks/useAgentRunTraces';

function ms(n?: number | null) {
  if (n == null) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`;
}

const FILTERS = [
  { key: null, label: 'Todas' },
  { key: 'error', label: 'Con error' },
  { key: 'sin_saldo', label: 'Sin saldo' },
];

/**
 * Traza de ejecución GLOBAL (super admin): movimientos de todas las empresas.
 * RLS permite a super_admin ver todas las filas de agent_run_traces.
 * El nombre de la empresa se resuelve con un query aparte (no hay FK al schema cache).
 */
export function AgentRunTracesSuperPanel() {
  const [items, setItems] = useState<AgentRunTrace[]>([]);
  const [orgNames, setOrgNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    let q = supabase
      .from('agent_run_traces')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);
    if (status) q = q.eq('status', status);
    const { data } = await q;
    const traces = (data as AgentRunTrace[]) ?? [];
    setItems(traces);

    const orgIds = Array.from(new Set(traces.map((t) => (t as any).organization_id).filter(Boolean)));
    if (orgIds.length) {
      const { data: orgs } = await supabase.from('organizations').select('id, name').in('id', orgIds);
      const map: Record<string, string> = {};
      (orgs ?? []).forEach((o: any) => { map[o.id] = o.name; });
      setOrgNames(map);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  const summary = useMemo(() => {
    const s = items.reduce(
      (acc, t) => {
        acc.runs += 1; acc.tokens += t.total_tokens || 0; acc.cost += Number(t.estimated_cost_usd) || 0;
        if (t.status && t.status !== 'ok') acc.errors += 1;
        if (t.total_ms) { acc.totalMs += t.total_ms; acc.timed += 1; }
        return acc;
      },
      { runs: 0, tokens: 0, cost: 0, errors: 0, totalMs: 0, timed: 0 },
    );
    return { ...s, avgMs: s.timed ? Math.round(s.totalMs / s.timed) : 0, orgs: Object.keys(orgNames).length };
  }, [items, orgNames]);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <ListTree className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Traza de ejecución — Global
            <Badge variant="secondary" className="gap-1"><Sparkles className="h-3 w-3" /> todas las empresas</Badge>
          </h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
            Cada turno del bot en todas las empresas: agente, pasos con latencia, tools, guardrails, modelo,
            tokens, costo y errores. Últimos 7 días.
          </p>
        </div>
      </div>

      {/* Stats globales */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="p-4"><Bot className="h-4 w-4 text-muted-foreground mb-2" /><p className="text-2xl font-bold leading-none">{summary.runs}</p><p className="text-[11px] text-muted-foreground mt-1">ejecuciones</p></Card>
        <Card className="p-4"><p className="text-2xl font-bold leading-none">{summary.orgs}</p><p className="text-[11px] text-muted-foreground mt-1">empresas</p></Card>
        <Card className="p-4"><Clock className="h-4 w-4 text-muted-foreground mb-2" /><p className="text-2xl font-bold leading-none">{ms(summary.avgMs)}</p><p className="text-[11px] text-muted-foreground mt-1">latencia prom.</p></Card>
        <Card className="p-4"><DollarSign className="h-4 w-4 text-muted-foreground mb-2" /><p className="text-2xl font-bold leading-none">${summary.cost.toFixed(2)}</p><p className="text-[11px] text-muted-foreground mt-1">{summary.tokens.toLocaleString()} tok</p></Card>
        <Card className="p-4"><AlertTriangle className={`h-4 w-4 mb-2 ${summary.errors ? 'text-rose-500' : 'text-muted-foreground'}`} /><p className="text-2xl font-bold leading-none">{summary.errors}</p><p className="text-[11px] text-muted-foreground mt-1">con error</p></Card>
      </div>

      {/* Filtros */}
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Button key={f.label} size="sm" variant={status === f.key ? 'default' : 'outline'} onClick={() => setStatus(f.key)}>
            {f.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center">
          <ListTree className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="font-medium">Sin ejecuciones en el período</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((t) => (
            <TraceCard key={t.id} t={t} orgName={orgNames[(t as any).organization_id] ?? undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

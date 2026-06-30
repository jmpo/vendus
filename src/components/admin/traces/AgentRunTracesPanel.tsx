import { useState } from 'react';
import {
  ListTree, RefreshCw, Bot, Zap, DollarSign, Clock, AlertTriangle,
  ChevronDown, ChevronRight, Cpu, Wrench, ShieldCheck, MessageSquare, Building2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAgentRunTraces, type AgentRunTrace, type TraceStep } from '@/hooks/useAgentRunTraces';

const STATUS_META: Record<string, { label: string; tone: string }> = {
  ok: { label: 'OK', tone: 'bg-emerald-500/15 text-emerald-600' },
  error: { label: 'Error', tone: 'bg-rose-500/15 text-rose-600' },
  sin_saldo: { label: 'Sin saldo', tone: 'bg-rose-500/15 text-rose-600' },
  no_response: { label: 'Sin respuesta', tone: 'bg-amber-500/15 text-amber-600' },
};

const STEP_ICON: Record<string, any> = { llm: Cpu, tool: Wrench, guardrail: ShieldCheck };

function ms(n?: number | null) {
  if (n == null) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`;
}

function StepRow({ s }: { s: TraceStep }) {
  const Icon = STEP_ICON[s.type] ?? MessageSquare;
  const bad = s.ok === false || s.error;
  return (
    <div className="flex items-center gap-2 text-xs py-1">
      <div className={`h-6 w-6 rounded flex items-center justify-center shrink-0 ${bad ? 'bg-rose-500/15 text-rose-600' : 'bg-muted text-muted-foreground'}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <span className="font-mono text-[11px] text-muted-foreground w-12 shrink-0">+{ms(s.at_ms)}</span>
      <span className="font-medium">{s.name}</span>
      {s.duration_ms != null && <Badge variant="secondary" className="text-[10px]">{ms(s.duration_ms)}</Badge>}
      {s.type === 'tool' && (
        <Badge variant="secondary" className={`text-[10px] ${s.delivered ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-600'}`}>
          {s.delivered ? 'entregado' : 'falló'}{s.retried ? ' · reintentó' : ''}
        </Badge>
      )}
      {s.status != null && <span className="text-[10px] text-muted-foreground">HTTP {s.status}</span>}
      {bad && s.error && <span className="text-[10px] text-rose-600 truncate">{s.error}</span>}
    </div>
  );
}

export function TraceCard({ t, orgName }: { t: AgentRunTrace; orgName?: string }) {
  const [open, setOpen] = useState(false);
  const st = STATUS_META[t.status] ?? STATUS_META.ok;
  const slow = (t.total_ms ?? 0) > 8000;
  return (
    <Card className="p-3">
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left flex items-start gap-3">
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {orgName && <Badge variant="outline" className="text-[10px] gap-1"><Building2 className="h-3 w-3" />{orgName}</Badge>}
            <Bot className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">{t.agent_name || 'Agente'}</span>
            <Badge variant="secondary" className={`text-[10px] ${st.tone}`}>{st.label}</Badge>
            <span className="text-[11px] text-muted-foreground">{formatDistanceToNow(new Date(t.created_at), { addSuffix: true, locale: es })}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 truncate">
            <span className="text-foreground">"{t.user_message || '—'}"</span> → {t.response_preview || '—'}
          </p>
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
            <span className="inline-flex items-center gap-1"><Clock className={`h-3 w-3 ${slow ? 'text-rose-500' : ''}`} /> total {ms(t.total_ms)} <span className="opacity-60">(LLM {ms(t.llm_ms)})</span></span>
            <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3" /> {t.total_tokens.toLocaleString()} tok</span>
            <span className="inline-flex items-center gap-1"><DollarSign className="h-3 w-3" /> ${Number(t.estimated_cost_usd).toFixed(4)}</span>
            <span className="opacity-60">{t.model}</span>
            {t.guardrails?.length > 0 && <span className="inline-flex items-center gap-1 text-amber-600"><ShieldCheck className="h-3 w-3" /> {t.guardrails.length} guardrail(s)</span>}
          </div>
        </div>
      </button>

      {open && (
        <div className="mt-3 pl-11 space-y-0.5 border-t pt-3">
          {(t.steps || []).length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin pasos registrados.</p>
          ) : (
            (t.steps || []).map((s, i) => <StepRow key={i} s={s} />)
          )}
          {t.guardrails?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {t.guardrails.map((g, i) => (
                <Badge key={i} variant="secondary" className="text-[10px] bg-amber-500/15 text-amber-600">
                  🛡️ {g.name}{g.action ? ` · ${g.action}` : ''}
                </Badge>
              ))}
            </div>
          )}
          {t.error && <p className="text-[11px] text-rose-600 mt-2">⛔ {t.error}</p>}
          {t.conversation_id && (
            <p className="text-[10px] text-muted-foreground mt-2 font-mono">conv: {t.conversation_id}</p>
          )}
        </div>
      )}
    </Card>
  );
}

const FILTERS = [
  { key: null, label: 'Todas' },
  { key: 'error', label: 'Con error' },
  { key: 'sin_saldo', label: 'Sin saldo' },
];

export function AgentRunTracesPanel() {
  const [status, setStatus] = useState<string | null>(null);
  const { items, loading, refetch, summary } = useAgentRunTraces({ days: 7, status });

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <ListTree className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Traza de ejecución</h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
              Qué hizo la IA en <strong>cada turno</strong>: agente, pasos con <strong>latencia</strong>, tools,
              guardrails, modelo, tokens y costo. Para análisis y debug (ej: si el total tarda mucho pero el LLM
              fue rápido, el cuello está en otro paso). Últimos 7 días.
            </p>
          </div>
        </div>
        <Button onClick={refetch} variant="outline" size="sm" className="gap-2">
          <RefreshCw className="h-4 w-4" /> Actualizar
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4">
          <Bot className="h-4 w-4 text-muted-foreground mb-2" />
          <p className="text-2xl font-bold leading-none">{summary.runs}</p>
          <p className="text-[11px] text-muted-foreground mt-1">ejecuciones</p>
        </Card>
        <Card className="p-4">
          <Clock className="h-4 w-4 text-muted-foreground mb-2" />
          <p className="text-2xl font-bold leading-none">{ms(summary.avgMs)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">latencia promedio</p>
        </Card>
        <Card className="p-4">
          <DollarSign className="h-4 w-4 text-muted-foreground mb-2" />
          <p className="text-2xl font-bold leading-none">${summary.cost.toFixed(2)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{summary.tokens.toLocaleString()} tokens</p>
        </Card>
        <Card className="p-4">
          <AlertTriangle className={`h-4 w-4 mb-2 ${summary.errors ? 'text-rose-500' : 'text-muted-foreground'}`} />
          <p className="text-2xl font-bold leading-none">{summary.errors}</p>
          <p className="text-[11px] text-muted-foreground mt-1">con error</p>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.label}
            size="sm"
            variant={status === f.key ? 'default' : 'outline'}
            onClick={() => setStatus(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center">
          <ListTree className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="font-medium">Sin ejecuciones en el período</p>
          <p className="text-sm text-muted-foreground mt-1">Cuando la IA responda, vas a ver acá la traza completa de cada turno.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((t) => <TraceCard key={t.id} t={t} />)}
        </div>
      )}
    </div>
  );
}

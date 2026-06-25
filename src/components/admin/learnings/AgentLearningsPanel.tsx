import { Brain, RefreshCw, X, CalendarCheck, Trophy, TrendingDown, Lightbulb, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAgentLearnings, type AgentLearning } from '@/hooks/useAgentLearnings';

const CAT: Record<string, { label: string; cls: string }> = {
  objecion: { label: 'Objeciones', cls: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  cierre: { label: 'Cierre', cls: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  agendamiento: { label: 'Agendamiento', cls: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  general: { label: 'General', cls: 'bg-muted text-muted-foreground border-border' },
};

function StatCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${tone}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </div>
    </Card>
  );
}

export function AgentLearningsPanel() {
  const { learnings, stats, loading, relearning, deactivate, relearn } = useAgentLearnings();

  const grouped = learnings.reduce<Record<string, AgentLearning[]>>((acc, l) => {
    const k = l.category && CAT[l.category] ? l.category : 'general';
    (acc[k] ??= []).push(l);
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Brain className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              Aprendizajes de la IA
              <Badge variant="secondary" className="gap-1"><Sparkles className="h-3 w-3" /> auto</Badge>
            </h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-xl">
              Tu agente aprende solo de las conversaciones que <strong>cierran</strong> (test drive agendado o venta ganada)
              y aplica estos aprendizajes en las próximas charlas. Se actualizan cada noche.
            </p>
          </div>
        </div>
        <Button onClick={relearn} disabled={relearning} variant="outline" className="gap-2">
          <RefreshCw className={`h-4 w-4 ${relearning ? 'animate-spin' : ''}`} />
          {relearning ? 'Aprendiendo…' : 'Re-aprender ahora'}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard icon={CalendarCheck} label="Test drives agendados" value={stats.booked} tone="bg-blue-500/15 text-blue-600" />
        <StatCard icon={Trophy} label="Ventas ganadas" value={stats.won} tone="bg-emerald-500/15 text-emerald-600" />
        <StatCard icon={TrendingDown} label="Perdidas (contraste)" value={stats.lost} tone="bg-rose-500/15 text-rose-600" />
      </div>

      {/* Learnings */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : learnings.length === 0 ? (
        <Card className="p-8 text-center">
          <Lightbulb className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="font-medium">Todavía no hay aprendizajes</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Se generan automáticamente cuando se agenden test drives o se cierren ventas. Cuanto más venda tu agente, más aprende.
          </p>
        </Card>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <Badge variant="outline" className={`mb-2 ${CAT[cat]?.cls ?? CAT.general.cls}`}>
                {CAT[cat]?.label ?? 'General'}
              </Badge>
              <div className="space-y-2">
                {items.map((l) => (
                  <Card key={l.id} className="p-3 flex items-start gap-3 group">
                    <Lightbulb className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <p className="text-sm flex-1">{l.insight}</p>
                    {l.evidence_count > 1 && (
                      <Badge variant="secondary" className="text-[10px] shrink-0">{l.evidence_count} casos</Badge>
                    )}
                    <button
                      onClick={() => deactivate(l.id)}
                      title="Descartar este aprendizaje"
                      className="opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

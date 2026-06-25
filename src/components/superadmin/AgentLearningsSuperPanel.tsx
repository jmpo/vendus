import { useEffect, useState } from 'react';
import { Brain, Building2, Lightbulb, CalendarCheck, Trophy, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface LearningRow {
  id: string;
  insight: string;
  category: string | null;
  evidence_count: number;
  organization_id: string;
  organizations: { name: string } | null;
}
interface TrajRow { outcome: string; organization_id: string }

const CAT_CLS: Record<string, string> = {
  objecion: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  cierre: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  agendamiento: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
  general: 'bg-muted text-muted-foreground border-border',
};

export function AgentLearningsSuperPanel() {
  const [learnings, setLearnings] = useState<LearningRow[]>([]);
  const [traj, setTraj] = useState<TrajRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: ls }, { data: tr }] = await Promise.all([
        supabase.from('agent_learnings')
          .select('id, insight, category, evidence_count, organization_id, organizations(name)')
          .eq('active', true).order('organization_id', { ascending: true }),
        supabase.from('agent_trajectories').select('outcome, organization_id').limit(5000),
      ]);
      setLearnings((ls as any) ?? []);
      setTraj((tr as any) ?? []);
      setLoading(false);
    })();
  }, []);

  // Agrupar por org
  const byOrg = learnings.reduce<Record<string, { name: string; items: LearningRow[] }>>((acc, l) => {
    const key = l.organization_id;
    acc[key] ??= { name: l.organizations?.name ?? 'Empresa', items: [] };
    acc[key].items.push(l);
    return acc;
  }, {});

  const trajOf = (orgId: string, outcome: string) => traj.filter((t) => t.organization_id === orgId && t.outcome === outcome).length;

  const globalBooked = traj.filter((t) => t.outcome === 'booked').length;
  const globalWon = traj.filter((t) => t.outcome === 'won').length;
  const orgCount = Object.keys(byOrg).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Brain className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Aprendizajes de IA — Global
            <Badge variant="secondary" className="gap-1"><Sparkles className="h-3 w-3" /> todas las empresas</Badge>
          </h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
            Lo que los agentes de IA están aprendiendo en cada empresa, a partir de conversaciones que cerraron.
            Te sirve para detectar patrones que funcionan y mejorar la plataforma para todos.
          </p>
        </div>
      </div>

      {/* Stats globales */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4"><p className="text-2xl font-bold">{learnings.length}</p><p className="text-xs text-muted-foreground mt-1">Aprendizajes activos</p></Card>
        <Card className="p-4"><p className="text-2xl font-bold">{orgCount}</p><p className="text-xs text-muted-foreground mt-1">Empresas aprendiendo</p></Card>
        <Card className="p-4 flex items-center gap-2"><CalendarCheck className="h-5 w-5 text-blue-600" /><div><p className="text-2xl font-bold leading-none">{globalBooked}</p><p className="text-xs text-muted-foreground mt-1">Test drives</p></div></Card>
        <Card className="p-4 flex items-center gap-2"><Trophy className="h-5 w-5 text-emerald-600" /><div><p className="text-2xl font-bold leading-none">{globalWon}</p><p className="text-xs text-muted-foreground mt-1">Ventas</p></div></Card>
      </div>

      {/* Por empresa */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : orgCount === 0 ? (
        <Card className="p-8 text-center">
          <Lightbulb className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="font-medium">Todavía no hay aprendizajes en ninguna empresa</p>
          <p className="text-sm text-muted-foreground mt-1">Se generan cuando los agentes agenden test drives o cierren ventas.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(byOrg).map(([orgId, { name, items }]) => (
            <Card key={orgId} className="p-4">
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-2 font-semibold">
                  <Building2 className="h-4 w-4 text-primary" /> {name}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><CalendarCheck className="h-3.5 w-3.5 text-blue-600" /> {trajOf(orgId, 'booked')}</span>
                  <span className="flex items-center gap-1"><Trophy className="h-3.5 w-3.5 text-emerald-600" /> {trajOf(orgId, 'won')}</span>
                  <Badge variant="secondary">{items.length} aprendizajes</Badge>
                </div>
              </div>
              <div className="space-y-2">
                {items.map((l) => (
                  <div key={l.id} className="flex items-start gap-2 text-sm">
                    <Badge variant="outline" className={`shrink-0 text-[10px] ${CAT_CLS[l.category ?? 'general'] ?? CAT_CLS.general}`}>
                      {l.category ?? 'general'}
                    </Badge>
                    <span className="flex-1">{l.insight}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

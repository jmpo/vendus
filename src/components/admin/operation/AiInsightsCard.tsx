import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, TrendingUp, Target, Users } from 'lucide-react';
import type { OperationKpis, OperationPriorities } from '@/hooks/useOperationCenter';

interface Props {
  kpis?: OperationKpis;
  priorities?: OperationPriorities;
}

export function AiInsightsCard({ kpis, priorities }: Props) {
  const insights: { icon: React.ComponentType<{ className?: string }>; title: string; body: string }[] = [];

  insights.push({
    icon: TrendingUp,
    title: 'Conversaciones respondidas en hasta 5 min',
    body: 'tienen 3 veces más posibilidades de cierre.',
  });

  if ((kpis?.hotLeadsNeedingAction ?? 0) > 0) {
    insights.push({
      icon: Target,
      title: `${kpis!.hotLeadsNeedingAction} leads están comprometidos`,
      body: 'y aún sin acción. Aproveche el timing.',
    });
  }

  if ((priorities?.overdueTasks ?? 0) === 0) {
    insights.push({
      icon: Users,
      title: 'Su equipo está al día con las tareas',
      body: 'Sin pendientes atrasados. ¡Excelente ritmo!',
    });
  } else {
    insights.push({
      icon: Users,
      title: `${priorities!.overdueTasks} tareas atrasadas`,
      body: 'Priorice estas para mantener el pipeline saludable.',
    });
  }

  const hasData = (kpis?.newLeadsToday ?? 0) > 0 || (kpis?.openConversations ?? 0) > 0;

  return (
    <Card className="border-border h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Insights rápidos de la IA
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasData ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            La IA comenzará a generar insights cuando haya más interacciones en la operación.
          </p>
        ) : (
          insights.slice(0, 3).map((ins, i) => {
            const Icon = ins.icon;
            return (
              <div key={i} className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{ins.title}</p>
                  <p className="text-xs text-muted-foreground">{ins.body}</p>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

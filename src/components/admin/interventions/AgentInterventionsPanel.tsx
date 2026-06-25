import { ShieldCheck, RefreshCw, CalendarX, Send, CreditCard, Info } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAgentInterventions, type Intervention } from '@/hooks/useAgentInterventions';

const TYPE_META: Record<string, { label: string; icon: any; tone: string }> = {
  hallucinated_booking_blocked: { label: 'Agendamiento falso bloqueado', icon: CalendarX, tone: 'text-amber-600 bg-amber-500/15' },
  scheduling_intent_missed: { label: 'Confirmó horario pero no agendó', icon: CalendarX, tone: 'text-amber-600 bg-amber-500/15' },
  empty_send_promise_guarded: { label: 'Prometió enviar — corregido', icon: Send, tone: 'text-blue-600 bg-blue-500/15' },
  payment_link_promise_unfulfilled: { label: 'Prometió link de pago sin generarlo', icon: CreditCard, tone: 'text-rose-600 bg-rose-500/15' },
};

function metaOf(t: string) {
  return TYPE_META[t] ?? { label: t, icon: Info, tone: 'text-muted-foreground bg-muted' };
}

function whatTried(it: Intervention): string {
  return (
    it.action_data?.user_message ||
    it.result?.original_content ||
    it.error_message ||
    '—'
  );
}

export function AgentInterventionsPanel() {
  const { items, loading, refetch } = useAgentInterventions(30);

  const counts = items.reduce<Record<string, number>>((acc, it) => {
    acc[it.action_type] = (acc[it.action_type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Intervenciones de IA</h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
              Cada vez que la IA intentó <strong>prometer sin hacer</strong> (enviar info, agendar, pago) y el
              sistema la <strong>corrigió automáticamente</strong>. Es tu termómetro de calidad: si esto sube,
              algo en el prompt o el flujo necesita ajuste. Últimos 30 días.
            </p>
          </div>
        </div>
        <Button onClick={refetch} variant="outline" size="sm" className="gap-2">
          <RefreshCw className="h-4 w-4" /> Actualizar
        </Button>
      </div>

      {/* Stats por tipo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.keys(TYPE_META).map((t) => {
          const m = metaOf(t);
          const Icon = m.icon;
          return (
            <Card key={t} className="p-4">
              <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${m.tone} mb-2`}>
                <Icon className="h-4 w-4" />
              </div>
              <p className="text-2xl font-bold leading-none">{counts[t] ?? 0}</p>
              <p className="text-[11px] text-muted-foreground mt-1 leading-tight">{m.label}</p>
            </Card>
          );
        })}
      </div>

      {/* Lista reciente */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center">
          <ShieldCheck className="h-10 w-10 text-emerald-500/50 mx-auto mb-3" />
          <p className="font-medium">Sin intervenciones en los últimos 30 días 🎉</p>
          <p className="text-sm text-muted-foreground mt-1">
            La IA está cumpliendo lo que dice. Cuando intente prometer-sin-hacer, vas a verlo acá.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const m = metaOf(it.action_type);
            const Icon = m.icon;
            return (
              <Card key={it.id} className="p-3 flex items-start gap-3">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${m.tone}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{m.label}</span>
                    {it.success ? (
                      <Badge variant="secondary" className="text-[10px] bg-emerald-500/15 text-emerald-600">forzado/resuelto</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">corregido</Badge>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {formatDistanceToNow(new Date(it.created_at), { addSuffix: true, locale: es })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    El cliente dijo: <span className="text-foreground">"{whatTried(it)}"</span>
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

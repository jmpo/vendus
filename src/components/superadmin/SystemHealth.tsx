import { useState } from 'react';
import { Activity, CheckCircle, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface Issue { severity: 'critical' | 'warning'; key: string; title: string; detail: string; }
interface HealthResult { ok: boolean; issues: Issue[]; checked_at: string; error?: string; }

const CHECK_LABELS: { key: string; label: string }[] = [
  { key: 'cron', label: 'Crons / tareas programadas' },
  { key: 'outreach', label: 'Follow-ups (cola de envíos)' },
  { key: 'http', label: 'Funciones internas (errores 5xx)' },
  { key: 'conv', label: 'Conversaciones → lead' },
  { key: 'ai', label: 'Inteligencia Artificial (key)' },
];

export function SystemHealth() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['system-health'],
    queryFn: async (): Promise<HealthResult> => {
      const { data, error } = await supabase.functions.invoke('system-health-check', { body: {} });
      if (error) throw error;
      return data as HealthResult;
    },
    refetchInterval: 60_000, // refresca solo cada 1 min
  });

  const issues = data?.issues ?? [];
  const allOk = !!data?.ok && issues.length === 0;
  const hasCritical = issues.some((i) => i.severity === 'critical');

  const issueForCheck = (key: string) => issues.find((i) => i.key.startsWith(key));

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Salud del Sistema</h1>
          <p className="text-muted-foreground">
            Estado real de la plataforma · chequeo automático cada 30 min
            {dataUpdatedAt ? ` · visto ${formatDistanceToNow(new Date(dataUpdatedAt), { addSuffix: true, locale: es })}` : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing || isLoading ? 'animate-spin' : ''}`} />
          Verificar ahora
        </Button>
      </div>

      {/* Estado general */}
      <Card className={allOk ? 'border-emerald-500/50' : hasCritical ? 'border-red-500/50' : 'border-amber-500/50'}>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
              allOk ? 'bg-emerald-500/10' : hasCritical ? 'bg-red-500/10' : 'bg-amber-500/10'
            }`}>
              {allOk ? <CheckCircle className="h-8 w-8 text-emerald-500" />
                : hasCritical ? <XCircle className="h-8 w-8 text-red-500" />
                : <AlertTriangle className="h-8 w-8 text-amber-500" />}
            </div>
            <div>
              <h2 className={`text-2xl font-bold ${allOk ? 'text-emerald-500' : hasCritical ? 'text-red-500' : 'text-amber-500'}`}>
                {isLoading ? 'Verificando…' : allOk ? 'Todos los sistemas operativos' : `${issues.length} problema(s) detectado(s)`}
              </h2>
              <p className="text-muted-foreground">
                {allOk ? 'No se detectaron problemas en este momento.' : 'Revisá los detalles abajo. Los admins ya fueron notificados.'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Checks individuales */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CHECK_LABELS.map((c) => {
          const iss = issueForCheck(c.key);
          return (
            <Card key={c.key}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{c.label}</CardTitle>
                  {!iss ? (
                    <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                      <CheckCircle className="h-3 w-3 mr-1" /> OK
                    </Badge>
                  ) : iss.severity === 'critical' ? (
                    <Badge className="bg-red-500/10 text-red-500 border-red-500/20">
                      <XCircle className="h-3 w-3 mr-1" /> Crítico
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20">
                      <AlertTriangle className="h-3 w-3 mr-1" /> Atención
                    </Badge>
                  )}
                </div>
              </CardHeader>
              {iss && (
                <CardContent>
                  <p className="text-sm font-medium">{iss.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 break-words">{iss.detail}</p>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {data?.error && (
        <Card className="border-red-500/50">
          <CardContent className="pt-6 text-sm text-red-500">No se pudo correr el chequeo: {data.error}</CardContent>
        </Card>
      )}
    </div>
  );
}

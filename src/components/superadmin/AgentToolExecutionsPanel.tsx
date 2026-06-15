import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  useAgentToolExecutions,
  useToolExecutionStats,
  type AgentToolExecution,
} from '@/hooks/useAgentToolExecutions';
import { Activity, AlertTriangle, CheckCircle2, Clock, Wrench } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

export function AgentToolExecutionsPanel() {
  const [filter, setFilter] = useState<'all' | 'success' | 'error'>('all');
  const [selected, setSelected] = useState<AgentToolExecution | null>(null);

  const { fecha: executions, isLoading } = useAgentToolExecutions({
    successOnly: filter === 'success',
    errorsOnly: filter === 'error',
    limit: 200,
  });
  const { fecha: stats } = useToolExecutionStats();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Ejecuciones de Herramientas (IA)</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Auditoría de todas las acciones que los agentes ejecutaron en los últimos 7 días.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Ejecuciones (7d)"
          value={stats?.total ?? 0}
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          label="Éxito"
          value={stats?.successes ?? 0}
          accent="text-emerald-500"
        />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
          label="Errorres"
          value={stats?.errors ?? 0}
          accent="text-destructive"
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="Tiempo promedio"
          value={`${Math.round(stats?.avgDuration ?? 0)}ms`}
        />
      </div>

      {/* Por ferramenta */}
      {stats?.byTool && Object.keys(stats.byTool).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Wrench className="h-4 w-4" /> Uso por herramienta (7d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.byTool).map(([name, s]) => (
                <Badge key={name} variant="secondary" className="text-xs">
                  {name}: {s.count}
                  {s.errors > 0 && <span className="ml-1 text-destructive">({s.errors} erros)</span>}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
        <TabsList>
          <TabsTrigger value="all">Todas</TabsTrigger>
          <TabsTrigger value="success">Éxitos</TabsTrigger>
          <TabsTrigger value="error">Errorres</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuándo</TableHead>
                <TableHead>Herramienta</TableHead>
                <TableHead>Agente</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Duración</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Cargando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && (executions?.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Ninguna ejecución registrada aún.
                  </TableCell>
                </TableRow>
              )}
              {executions?.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(e.created_at), {
                      addSuffix: true,
                      locale: es,
                    })}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{e.tool_name}</code>
                  </TableCell>
                  <TableCell className="text-sm">{e.agent_name ?? '—'}</TableCell>
                  <TableCell className="text-sm">{e.channel ?? '—'}</TableCell>
                  <TableCell>
                    {e.success ? (
                      <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600">
                        OK
                      </Badge>
                    ) : (
                      <Badge variant="destructive">Error</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.duration_ms ?? 0}ms</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => setSelected(e)}>
                      Ver
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <code className="text-sm">{selected?.tool_name}</code>
              {selected?.success ? (
                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600">
                  Éxito
                </Badge>
              ) : (
                <Badge variant="destructive">Error</Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 text-sm">
              {selected?.error_message && (
                <div>
                  <p className="font-semibold text-destructive mb-1">Error</p>
                  <pre className="bg-destructive/10 text-destructive text-xs p-3 rounded whitespace-pre-wrap">
                    {selected.error_message}
                  </pre>
                </div>
              )}
              <div>
                <p className="font-semibold mb-1">Entrada</p>
                <pre className="bg-muted text-xs p-3 rounded whitespace-pre-wrap break-all">
                  {JSON.stringify(selected?.input, null, 2)}
                </pre>
              </div>
              {selected?.output != null && (
                <div>
                  <p className="font-semibold mb-1">Salida</p>
                  <pre className="bg-muted text-xs p-3 rounded whitespace-pre-wrap break-all">
                    {JSON.stringify(selected.output, null, 2)}
                  </pre>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                <div>Agente: {selected?.agent_name ?? '—'}</div>
                <div>Canal: {selected?.channel ?? '—'}</div>
                <div>Lead: {selected?.lead_id ?? '—'}</div>
                <div>Conversación: {selected?.conversation_id ?? '—'}</div>
                <div>Duración: {selected?.duration_ms}ms</div>
                <div>Costo est.: {(selected?.estimated_cost_cents ?? 0) / 100} BRL</div>
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          {icon}
          <span>{label}</span>
        </div>
        <p className={`text-2xl font-bold mt-2 ${accent ?? 'text-foreground'}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

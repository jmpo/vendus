import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Edit, Pause, Play, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useCampaignTargets } from '@/hooks/useCampaigns';
import { AICampaignAssistant } from './AICampaignAssistant';

// Traduce el motivo crudo guardado en el target a un texto claro para el usuario.
function reasonLabel(raw?: string | null): string | null {
  if (!raw) return null;
  const e = raw.toLowerCase();
  if (e.includes('outreach ativo recente') || e.includes('conversación activa')) return 'El lead ya está en una conversación activa (no se re-contacta para no spamear)';
  if (e.includes('no phone') || e.includes('sem telefone')) return 'El lead no tiene teléfono cargado';
  if (e.includes('opt')) return 'El lead se dio de baja de WhatsApp (opt-out)';
  if (e.includes('out_of_window') || e.includes('janela 24h') || e.includes('24h')) return 'Fuera de la ventana de 24h y sin plantilla aprobada';
  if (e.includes('human_active') || e.includes('waiting_human') || e.includes('conversation in')) return 'La conversación está en atención humana';
  if (e.includes('no_connection') || e.includes('sem conexão')) return 'Sin conexión de WhatsApp vinculada';
  if (e.includes('campanha cancelada') || e.includes('cancelada')) return 'Campaña cancelada';
  return raw; // si no hay mapeo, muestra el error tal cual
}

export function CampaignDetail({
  campaignId,
  onBack,
  onEdit,
}: {
  campaignId: string;
  onBack: () => void;
  onEdit: () => void;
}) {
  const [campaign, setCampaign] = useState<any>(null);
  const { counts, targets } = useCampaignTargets(campaignId);

  useEffect(() => {
    supabase.from('campaigns').select('*').eq('id', campaignId).maybeSingle()
      .then(({ data }) => setCampaign(data));
  }, [campaignId, counts]);

  const togglePause = async () => {
    if (!campaign) return;
    const next = campaign.status === 'paused' ? 'active' : 'paused';
    const { error } = await supabase.from('campaigns').update({ status: next }).eq('id', campaignId);
    if (error) toast.error(error.message);
    else { setCampaign({ ...campaign, status: next }); toast.success(next === 'active' ? 'Reanudada' : 'Pausada'); }
  };

  if (!campaign) return <div className="p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>;

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const done = counts.sent + counts.responded + counts.failed + counts.skipped + counts.cancelled;
  const progress = total ? Math.round((done / total) * 100) : 0;

  const statusLabel: Record<string, string> = {
    draft: 'Borrador',
    active: 'Activa',
    paused: 'Pausada',
    completed: 'Completada',
    cancelled: 'Cancelada',
  };
  const countLabel: Record<string, string> = {
    queued: 'En fila',
    sending: 'Enviando',
    sent: 'Enviadas',
    responded: 'Respondidas',
    failed: 'Fallaron',
    skipped: 'Omitidas',
    cancelled: 'Canceladas',
  };
  const targetStatusLabel: Record<string, string> = {
    queued: 'En fila',
    sending: 'Enviando',
    sent: 'Enviado',
    responded: 'Respondió',
    failed: 'Falló',
    skipped: 'Omitida',
    cancelled: 'Cancelada',
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-2" />Volver</Button>
        <h1 className="flex-1 font-semibold truncate">{campaign.name}</h1>
        <Badge>{statusLabel[campaign.status] ?? campaign.status}</Badge>
        {(campaign.status === 'active' || campaign.status === 'paused') && (
          <Button variant="outline" size="sm" onClick={togglePause}>
            {campaign.status === 'paused' ? <><Play className="h-4 w-4 mr-2" />Retomar</> : <><Pause className="h-4 w-4 mr-2" />Pausar</>}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onEdit}><Edit className="h-4 w-4 mr-2" />Editar</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Progreso</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="h-2 bg-muted rounded overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="grid grid-cols-3 md:grid-cols-7 gap-2 text-center text-xs">
            {(['queued','sending','sent','responded','failed','skipped','cancelled'] as const).map((k) => (
              <div key={k} className="p-2 rounded border">
                <p className="text-muted-foreground">{countLabel[k]}</p>
                <p className="text-lg font-semibold">{counts[k]}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <AICampaignAssistant campaignId={campaignId} />

      <Card>
        <CardHeader><CardTitle className="text-base">Últimos envíos</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1 max-h-[400px] overflow-auto text-sm">
            {targets.slice(0, 100).map((t) => {
              const reason = (t.status === 'skipped' || t.status === 'failed' || t.status === 'cancelled')
                ? reasonLabel(t.error) : null;
              return (
                <div key={t.id} className="py-1.5 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-xs w-20 justify-center">{targetStatusLabel[t.status] ?? t.status}</Badge>
                    <span className="text-xs text-muted-foreground font-mono truncate flex-1">{t.lead_id}</span>
                    <span className="text-xs text-muted-foreground">
                      {t.sent_at ? new Date(t.sent_at).toLocaleString('es-PY') : new Date(t.scheduled_for).toLocaleString('es-PY')}
                    </span>
                  </div>
                  {reason && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 pl-[5.5rem] mt-0.5">{reason}</p>
                  )}
                </div>
              );
            })}
            {!targets.length && <p className="text-xs text-muted-foreground text-center py-4">Ningún envío aún.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

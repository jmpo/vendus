import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Globe, Loader2, Trash2, CheckCircle2, Copy, AlertTriangle, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { ZernioTemplatesDialog } from './ZernioTemplatesDialog';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const copy = (label: string, value: string) => {
  navigator.clipboard.writeText(value);
  toast.success(`${label} copiado`);
};

interface Props {
  hideHeader?: boolean;
  openWizard: boolean;
  onCloseWizard: () => void;
}

interface ZernioConn {
  id: string;
  display_name: string | null;
  phone_number: string | null;
  status: string;
  webhook_subscribed_at: string | null;
  webhook_secret: string | null;
}

export function ZernioConnectionsPanel({ hideHeader, openWizard, onCloseWizard }: Props) {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [templatesFor, setTemplatesFor] = useState<string | null>(null);
  // Paso 2: instrucciones del webhook tras conectar.
  const [setupInfo, setSetupInfo] = useState<{ webhookUrl: string; webhookSecret: string; phone: string } | null>(null);

  const ZERNIO_EVENTS = ['message.received', 'message.delivered', 'message.read', 'message.failed', 'whatsapp.template.status_updated'];

  const closeWizard = () => { setSetupInfo(null); setApiKey(''); onCloseWizard(); };

  const { data: conns } = useQuery({
    queryKey: ['zernio-connections', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<ZernioConn[]> => {
      const { data, error } = await supabase
        .from('zernio_connections')
        .select('id, display_name, phone_number, status, webhook_subscribed_at, webhook_secret')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ZernioConn[];
    },
  });

  const handleConnect = async () => {
    if (!apiKey.trim() || !orgId) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('zernio-connect', {
        body: { organization_id: orgId, api_key: apiKey.trim() },
      });
      if (error) {
        // invoke convierte cualquier non-2xx en un error genérico; leemos el cuerpo real.
        let msg = 'No se pudo conectar Zernio';
        try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* noop */ }
        throw new Error(msg);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      const d = data as any;
      toast.success(`Zernio conectado: ${d?.phone_number ?? 'número'}`);
      queryClient.invalidateQueries({ queryKey: ['zernio-connections', orgId] });
      if (d?.webhook_subscribed) {
        // Caso raro: la key es de owner y el webhook quedó auto-registrado.
        closeWizard();
      } else {
        // Paso 2: mostrar las instrucciones del webhook (registro manual en Zernio).
        setApiKey('');
        setSetupInfo({ webhookUrl: d?.webhook_url ?? '', webhookSecret: d?.webhook_secret ?? '', phone: d?.phone_number ?? '' });
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo conectar Zernio');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('zernio_connections').delete().eq('id', id);
    if (error) { toast.error('No se pudo eliminar'); return; }
    toast.success('Conexión eliminada');
    queryClient.invalidateQueries({ queryKey: ['zernio-connections', orgId] });
  };

  return (
    <div className="space-y-3">
      {!hideHeader && <h3 className="text-lg font-semibold">Zernio (WhatsApp Oficial)</h3>}

      {(conns ?? []).map((c) => {
        const webhookUrl = `${SUPABASE_URL}/functions/v1/zernio-webhook/${c.id}`;
        return (
        <div key={c.id} className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-sky-500/10 flex items-center justify-center shrink-0">
              <Globe className="h-5 w-5 text-sky-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium truncate">{c.display_name || 'Zernio WhatsApp'}</p>
                <Badge variant={c.status === 'active' ? 'default' : 'outline'} className="text-[10px]">
                  {c.status === 'active' ? 'Conectado' : 'Desconectado'}
                </Badge>
                {c.webhook_subscribed_at && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" /> webhook OK
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{c.phone_number || 'Número virtual'}</p>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setTemplatesFor(c.id)}>
              <FileText className="h-4 w-4" /> Plantillas
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(c.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          {!c.webhook_subscribed_at && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs space-y-2">
              <p className="flex items-center gap-1.5 font-medium text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" /> Falta activar el webhook en Zernio
              </p>
              <p className="text-muted-foreground">
                En Zernio → <strong>Webhooks</strong> → crear webhook, pegá esta URL y este secret, y suscribí el evento <code>message.received</code> (y delivered/read/failed). Sin esto, los mensajes no llegan a Vendus.
              </p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-12 shrink-0">URL</span>
                  <code className="flex-1 truncate bg-background/70 rounded px-2 py-1">{webhookUrl}</code>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy('URL', webhookUrl)}><Copy className="h-3.5 w-3.5" /></Button>
                </div>
                {c.webhook_secret && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-12 shrink-0">Secret</span>
                    <code className="flex-1 truncate bg-background/70 rounded px-2 py-1">{c.webhook_secret}</code>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy('Secret', c.webhook_secret!)}><Copy className="h-3.5 w-3.5" /></Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        );
      })}

      <Dialog open={openWizard} onOpenChange={(o) => !o && closeWizard()}>
        <DialogContent className="max-w-lg">
          {!setupInfo ? (
            <>
              <DialogHeader>
                <DialogTitle>Conectar WhatsApp vía Zernio — Paso 1 de 2</DialogTitle>
                <DialogDescription>
                  Pegá tu API key de Zernio (zernio.com → Dashboard → API Keys). Se guarda cifrada y detectamos tu número automáticamente.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 pt-2">
                <Label htmlFor="zernio-key">API Key</Label>
                <Input id="zernio-key" type="password" placeholder="sk_..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeWizard} disabled={saving}>Cancelar</Button>
                <Button onClick={handleConnect} disabled={saving || !apiKey.trim()}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Conectar
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Conectar WhatsApp vía Zernio — Paso 2 de 2</DialogTitle>
                <DialogDescription>Último paso para que entren los mensajes al CRM.</DialogDescription>
              </DialogHeader>

              {/* Banner de éxito de la conexión */}
              <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-emerald-700 leading-tight">Número conectado</p>
                  <p className="text-xs text-muted-foreground truncate">{setupInfo.phone || 'WhatsApp Zernio'}</p>
                </div>
              </div>

              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Activá el webhook en Zernio para recibir mensajes. La API key no puede crearlo sola (es acción del dueño de la cuenta), así que se hace una vez a mano:
                </p>

                {/* Paso 1 */}
                <div className="flex gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">1</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">Entrá a <a href="https://zernio.com/dashboard/webhooks" target="_blank" rel="noreferrer" className="text-primary hover:underline">Zernio → Webhooks → Create Webhook</a></p>
                  </div>
                </div>

                {/* Paso 2: URL */}
                <div className="flex gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">2</span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium">Pegá la URL del webhook</p>
                    <div className="flex items-center gap-1.5">
                      <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{setupInfo.webhookUrl}</code>
                      <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => copy('URL', setupInfo.webhookUrl)}><Copy className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </div>

                {/* Paso 3: Secret */}
                <div className="flex gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">3</span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium">Pegá el Secret (firma)</p>
                    <div className="flex items-center gap-1.5">
                      <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{setupInfo.webhookSecret}</code>
                      <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => copy('Secret', setupInfo.webhookSecret)}><Copy className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </div>

                {/* Paso 4: Eventos */}
                <div className="flex gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">4</span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="font-medium">Tildá estos eventos y guardá</p>
                    <div className="flex flex-wrap gap-1">
                      {ZERNIO_EVENTS.map((e) => (<Badge key={e} variant="secondary" className="text-[10px] font-mono">{e}</Badge>))}
                    </div>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button onClick={closeWizard} className="gap-1.5"><CheckCircle2 className="h-4 w-4" /> Listo, ya activé el webhook</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {templatesFor && (
        <ZernioTemplatesDialog
          open={!!templatesFor}
          onClose={() => setTemplatesFor(null)}
          connectionId={templatesFor}
        />
      )}
    </div>
  );
}

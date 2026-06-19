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
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const num = (data as any)?.phone_number ?? 'número';
      toast.success(`Zernio conectado: ${num}`, {
        description: (data as any)?.webhook_subscribed ? 'Webhook registrado correctamente.' : 'Conectado (el webhook no se registró automáticamente; revisá la API key).',
      });
      setApiKey('');
      onCloseWizard();
      queryClient.invalidateQueries({ queryKey: ['zernio-connections', orgId] });
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

      <Dialog open={openWizard} onOpenChange={(o) => !o && onCloseWizard()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Conectar WhatsApp vía Zernio</DialogTitle>
            <DialogDescription>
              Pegá tu API key de Zernio (la encontrás en zernio.com → Dashboard → API Keys). Se guarda cifrada y registramos el webhook automáticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            <Label htmlFor="zernio-key">API Key</Label>
            <Input
              id="zernio-key"
              type="password"
              placeholder="sk_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Detectamos automáticamente tu número virtual conectado en Zernio.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseWizard} disabled={saving}>Cancelar</Button>
            <Button onClick={handleConnect} disabled={saving || !apiKey.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Conectar
            </Button>
          </DialogFooter>
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

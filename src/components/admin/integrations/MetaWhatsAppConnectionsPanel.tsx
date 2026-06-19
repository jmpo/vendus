import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, RefreshCw, Pencil, Trash2, ShieldCheck, AlertTriangle, FileText, MessageSquare } from 'lucide-react';
import {
  useMetaWAConnections, useTestMetaWAConnection, useSyncMetaWATemplates, useDeleteMetaWAConnection,
  type MetaWAConnection,
} from '@/hooks/useMetaWhatsApp';
import { MetaWhatsAppWizard } from './MetaWhatsAppWizard';
import { MetaWhatsAppTemplatesPanel } from './MetaWhatsAppTemplatesPanel';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function StatusBadge({ c }: { c: MetaWAConnection }) {
  if (c.status === 'active') return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">Ativa</Badge>;
  if (c.status === 'error') return <Badge variant="destructive">Error</Badge>;
  if (c.status === 'revoked') return <Badge variant="outline">Revogada</Badge>;
  if (c.status === 'draft') return <Badge variant="outline" className="border-amber-500/40 text-amber-700">Borrador</Badge>;
  return <Badge variant="secondary">Pendiente</Badge>;
}

interface MetaWhatsAppConnectionsPanelProps {
  hideHeader?: boolean;
  openWizard?: boolean;
  onCloseWizard?: () => void;
}

export function MetaWhatsAppConnectionsPanel({ hideHeader, openWizard, onCloseWizard }: MetaWhatsAppConnectionsPanelProps = {}) {
  const { data: conns = [], isLoading } = useMetaWAConnections();
  const test = useTestMetaWAConnection();
  const sync = useSyncMetaWATemplates();
  const del = useDeleteMetaWAConnection();
  const [wizardInternal, setWizardInternal] = useState(false);
  const wizardOpen = wizardInternal || !!openWizard;
  const closeWizard = () => { setWizardInternal(false); setEditing(null); onCloseWizard?.(); };
  const [editing, setEditing] = useState<MetaWAConnection | null>(null);
  const [toDelete, setToDelete] = useState<MetaWAConnection | null>(null);
  const [templatesFor, setTemplatesFor] = useState<MetaWAConnection | null>(null);

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            <div>
              <h3 className="font-medium">Conexiones oficiais (Meta Cloud API)</h3>
              <p className="text-xs text-muted-foreground">Sus credenciais ficam criptografadas e nunca saem desta empresa.</p>
            </div>
          </div>
          <Button onClick={() => { setEditing(null); setWizardInternal(true); }}>
            <Plus className="h-4 w-4 mr-2" />Nova conexión
          </Button>
        </div>
      )}

      {conns.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Ninguna conexión oficial aún. Hacé clic em "Nova conexión" para configurar.
        </Card>
      ) : (
        <div className="space-y-3">
          {conns.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{c.display_name}</span>
                    <StatusBadge c={c} />
                    {c.quality_rating && <Badge variant="outline" className="text-xs">Qualidade: {c.quality_rating}</Badge>}
                    {c.messaging_limit_tier && <Badge variant="outline" className="text-xs">Tier: {c.messaging_limit_tier}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.phone_number ?? c.phone_number_id} · WABA {c.waba_id}
                    {c.business_account_name && <> · {c.business_account_name}</>}
                  </div>
                  {c.status === 'error' && c.last_error && (
                    <div className="flex items-start gap-1.5 text-xs text-destructive mt-1">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span className="break-all">{c.last_error}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => test.mutate(c.id)} disabled={test.isPending}>
                    {test.isPending && test.variables === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Testar'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => sync.mutate(c.id)} disabled={sync.isPending}>
                    {sync.isPending && sync.variables === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setTemplatesFor(c)}>
                    <FileText className="h-3.5 w-3.5 mr-1" />Templates
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(c); setWizardInternal(true); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setToDelete(c)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <MetaWhatsAppWizard open={wizardOpen} onClose={closeWizard} editing={editing} />

      {templatesFor && (
        <MetaWhatsAppTemplatesPanel
          connection={templatesFor}
          onClose={() => setTemplatesFor(null)}
        />
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover conexión Meta?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción remove "{toDelete?.display_name}" e todos los templates sincronizados. Mensajes ya recebidas continuam preservadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (toDelete) del.mutate(toDelete.id); setToDelete(null); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

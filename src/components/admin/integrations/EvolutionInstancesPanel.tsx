import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Smartphone, Star, Loader2, Info, QrCode, CheckCircle2, Pause, LogOut, Plus, Sparkles, Pencil, Trash2 } from 'lucide-react';
import {
  useEvolutionInstances,
  useSetDefaultEvolutionInstance,
  useConnectEvolutionInstance,
  useDisconnectEvolutionInstance,
  useLogoutEvolutionInstance,
  useCreateEvolutionInstanceSelf,
  useDeleteEvolutionInstanceSelf,
  useRenameEvolutionInstanceSelf,
  type EvolutionInstance,
} from '@/hooks/useEvolutionInstances';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizationEffectivePlan } from '@/hooks/useOrganizationPlan';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { PresenceTestButton } from './PresenceTestButton';


function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    connected: { label: 'Conectado', variant: 'default' },
    qr_pending: { label: 'Aguardando QR', variant: 'secondary' },
    paired: { label: 'Pareado', variant: 'default' },
    disconnected: { label: 'Desconectado', variant: 'outline' },
  };
  const cfg = map[status] || { label: status, variant: 'outline' as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function ConnectDialog({ instance, onClose }: { instance: EvolutionInstance; onClose: () => void }) {
  const connectMut = useConnectEvolutionInstance();
  const [qr, setQr] = useState<string | null>(instance.qr_code);
  const [status, setStatus] = useState(instance.status);
  const [elapsed, setElapsed] = useState(0);

  const triggerConnect = () => {
    setQr(null);
    setElapsed(0);
    connectMut.mutate(instance.id, {
      onSuccess: (data: any) => {
        if (data?.already_connected) {
          setStatus('connected');
          toast.success('Ya conectado!');
          setTimeout(onClose, 1200);
          return;
        }
        if (data?.qr_code) setQr(data.qr_code);
      },
    });
  };

  useEffect(() => {
    triggerConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll DB for QR/status updates pushed by webhook
  useEffect(() => {
    if (status === 'connected') return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('evolution_instances')
        .select('status, qr_code')
        .eq('id', instance.id)
        .maybeSingle();
      if (data) {
        if (data.qr_code && data.qr_code !== qr) setQr(data.qr_code);
        if (data.status !== status) {
          setStatus(data.status);
          if (data.status === 'connected') {
            toast.success('WhatsApp conectado con éxito!');
            setTimeout(onClose, 1500);
          }
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [status, qr, instance.id, onClose]);

  // Elapsed timer (used to decide "loading" vs "error" state)
  useEffect(() => {
    if (qr || status === 'connected') return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [qr, status]);

  const isQrBase64 = qr?.startsWith('data:image') || qr?.startsWith('iVBOR');
  const showError = !qr && status !== 'connected' && elapsed >= 45;
  const showLoading = !qr && status !== 'connected' && !showError;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar {instance.name}</DialogTitle>
          <DialogDescription>
            Abra o WhatsApp no celular → Configuraciones → Aparelhos conectados → Conectar aparelho → escaneie o código abaixo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center py-6 min-h-[280px]">
          {status === 'connected' ? (
            <div className="text-center space-y-3">
              <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
              <p className="font-medium">Conectado!</p>
            </div>
          ) : qr ? (
            <div className="bg-white p-3 rounded-lg">
              <img
                src={isQrBase64 ? (qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`) : `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qr)}`}
                alt="QR Code"
                className="w-60 h-60"
              />
            </div>
          ) : showLoading ? (
            <div className="text-center space-y-3">
              <Loader2 className="h-10 w-10 animate-spin text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                {elapsed < 10 ? 'Gerando QR Code…' : 'Aún aguardando o servidor generar o QR…'}
              </p>
              <p className="text-xs text-muted-foreground">
                Eso puede levar até 45 segundos. Mantenha esta janela aberta.
              </p>
            </div>
          ) : (
            <div className="text-center space-y-3">
              <QrCode className="h-12 w-12 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No fue posible generar o QR Code.</p>
              <Button size="sm" variant="outline" onClick={triggerConnect} disabled={connectMut.isPending}>
                {connectMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Intentar novamente'}
              </Button>
            </div>
          )}
        </div>

        <div className="text-xs text-center text-muted-foreground">
          Status: <StatusBadge status={status} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateInstanceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const createMut = useCreateEvolutionInstanceSelf();

  const sanitized = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  const valid = /^[a-z0-9-]{3,40}$/.test(sanitized);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    createMut.mutate({ name: sanitized }, { onSuccess: () => { setName(''); onClose(); } });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setName(''); onClose(); } }}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Nova conexión de WhatsApp</DialogTitle>
            <DialogDescription>
              Dê um nombre simple para identificar esa conexión (ex: <code>ventas</code>, <code>atención</code>).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-4">
            <Label htmlFor="instance-name">Nombre da conexión</Label>
            <Input
              id="instance-name"
              autoFocus
              placeholder="ex: ventas-01"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={createMut.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Solo letras minúsculas, números e hífens. Mínimo 3 caracteres.
            </p>
            {name && !valid && (
              <p className="text-xs text-destructive">
                Nombre inválido. Usa solo letras minúsculas, números e hífens (3 a 40 caracteres).
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={createMut.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!valid || createMut.isPending}>
              {createMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Crear conexión
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({ instance, onClose }: { instance: EvolutionInstance; onClose: () => void }) {
  const initial = (instance.metadata as any)?.display_name || instance.name;
  const [name, setName] = useState<string>(initial);
  const renameMut = useRenameEvolutionInstanceSelf();

  const valid = name.trim().length >= 2 && name.trim().length <= 60;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    renameMut.mutate({ id: instance.id, name: name.trim() }, { onSuccess: () => onClose() });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Renomear conexión</DialogTitle>
            <DialogDescription>
              Actualizá o nombre de visualización desta conexión. O identificador interno permanece o mismo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="rename-instance">Nombre de visualización</Label>
            <Input
              id="rename-instance"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={renameMut.isPending}
            />
            <p className="text-xs text-muted-foreground">Entre 2 e 60 caracteres.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={renameMut.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!valid || renameMut.isPending}>
              {renameMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface EvolutionInstancesPanelProps {
  /** Esconde o cabeçalho interno (título + botón "Nova conexión"). Cuando true, controle de creación fica externo. */
  hideHeader?: boolean;
  /** Cuando hideHeader=true, controla a abertura do dialog de creación externamente. */
  openCreate?: boolean;
  /** Callback para fechar o dialog de creación cuando controlado externamente. */
  onCloseCreate?: () => void;
}

export function EvolutionInstancesPanel({ hideHeader, openCreate, onCloseCreate }: EvolutionInstancesPanelProps = {}) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { data: instances, isLoading } = useEvolutionInstances();
  const { data: effectivePlan } = useOrganizationEffectivePlan(profile?.organization_id);
  const setDefaultMut = useSetDefaultEvolutionInstance();
  const disconnectMut = useDisconnectEvolutionInstance();
  const logoutMut = useLogoutEvolutionInstance();
  const deleteMut = useDeleteEvolutionInstanceSelf();
  const [connecting, setConnecting] = useState<EvolutionInstance | null>(null);
  const [pausing, setPausing] = useState<EvolutionInstance | null>(null);
  const [unlinking, setUnlinking] = useState<EvolutionInstance | null>(null);
  const [renaming, setRenaming] = useState<EvolutionInstance | null>(null);
  const [deleting, setDeleting] = useState<EvolutionInstance | null>(null);
  const [creatingInternal, setCreatingInternal] = useState(false);
  const creating = hideHeader ? !!openCreate : creatingInternal;
  const closeCreate = () => { if (hideHeader) { onCloseCreate?.(); } else { setCreatingInternal(false); } };

  const displayName = (inst: EvolutionInstance) =>
    (inst.metadata as any)?.display_name || inst.name;

  const isLinked = (s: string) => s === 'connected' || s === 'paired';

  const used = instances?.length ?? 0;
  const limit = effectivePlan?.limits?.max_connections ?? 1;
  const limitReached = used >= limit;

  const handleUpgrade = () => navigate('/admin?tab=plan');

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold">Sus Instâncias de WhatsApp</h3>
            <p className="text-sm text-muted-foreground">
              Conecte sus números de WhatsApp escaneando o QR Code con o aparelho.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={limitReached ? 'destructive' : 'secondary'} className="text-sm">
              {used} / {limit} usadas
            </Badge>
            {limitReached ? (
              <Button onClick={handleUpgrade} className="gap-2">
                <Sparkles className="h-4 w-4" />
                Fazer upgrade
              </Button>
            ) : (
              <Button onClick={() => setCreatingInternal(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Nova conexión
              </Button>
            )}
          </div>
        </div>
      )}

      {limitReached && !hideHeader && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm flex gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
          <p className="text-foreground">
            Usted atingiu o limite de <strong>{limit}</strong> conexión(ões) do su plan. Hacé upgrade para crear mais conexiones de WhatsApp.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !instances?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Smartphone className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">Ninguna conexión creada aún.</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Hacé clic em <strong>Nova conexión</strong> para crear su primera instância de WhatsApp.
            </p>
          </CardContent>
        </Card>

      ) : (
        <div className="grid gap-3">
          {instances.map((inst) => (
            <Card key={inst.id}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                      <Smartphone className="h-5 w-5 text-green-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium truncate">{displayName(inst)}</p>
                        {inst.is_default && (
                          <Badge variant="outline" className="gap-1">
                            <Star className="h-3 w-3" /> Predeterminado
                          </Badge>
                        )}
                        <StatusBadge status={inst.status} />
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {inst.phone_number ? `+${inst.phone_number}` : 'No conectado aún'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {!isLinked(inst.status) && (
                      <Button size="sm" onClick={() => setConnecting(inst)}>
                        <QrCode className="h-4 w-4 mr-2" />
                        Conectar
                      </Button>
                    )}
                    {isLinked(inst.status) && (
                      <>
                        <PresenceTestButton instanceId={inst.id} instanceName={displayName(inst)} />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPausing(inst)}
                          title="Pausar sesión (mantém o número pareado)"
                        >
                          <Pause className="h-4 w-4 mr-2" />
                          Pausar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setUnlinking(inst)}
                          className="text-destructive hover:text-destructive"
                          title="Desvincular número (exige novo QR)"
                        >
                          <LogOut className="h-4 w-4 mr-2" />
                          Desvincular
                        </Button>
                      </>
                    )}
                    {!inst.is_default && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDefaultMut.mutate(inst.id)}
                        disabled={setDefaultMut.isPending}
                        title="Definir como predeterminado"
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRenaming(inst)}
                      title="Editar nombre"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleting(inst)}
                      className="text-destructive hover:text-destructive"
                      title="Eliminar conexión"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {connecting && (
        <ConnectDialog instance={connecting} onClose={() => setConnecting(null)} />
      )}

      {/* Pausar sesión */}
      <AlertDialog open={!!pausing} onOpenChange={(o) => !o && setPausing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pausar a sesión?</AlertDialogTitle>
            <AlertDialogDescription>
              O pareamento con o número{' '}
              <strong>{pausing?.phone_number ? `+${pausing.phone_number}` : 'atual'}</strong>{' '}
              é mantido. Ao clicar em <strong>Conectar</strong> novamente, a sesión volta automaticamente
              sin precisar de novo QR Code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pausing) disconnectMut.mutate(pausing.id);
                setPausing(null);
              }}
              disabled={disconnectMut.isPending}
            >
              {disconnectMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Pausar sesión
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Desvincular número */}
      <AlertDialog open={!!unlinking} onOpenChange={(o) => !o && setUnlinking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desvincular este WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              O número{' '}
              <strong>{unlinking?.phone_number ? `+${unlinking.phone_number}` : 'atual'}</strong>{' '}
              será eliminado desta instância e desaparecerá da lista de "Aparelhos conectados" no celular.
              Para reconectar (este ou otro número) será necesario escanear um novo QR Code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (unlinking) logoutMut.mutate(unlinking.id);
                setUnlinking(null);
              }}
              disabled={logoutMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {logoutMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Desvincular número
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Eliminar conexión (apaga local + Evolution Go) */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar esta conexión?</AlertDialogTitle>
            <AlertDialogDescription>
              A conexión <strong>{deleting ? displayName(deleting) : ''}</strong> será removida
              permanentemente, junto con a instância no servidor Evolution Go. Esta acción no puede ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) deleteMut.mutate(deleting.id);
                setDeleting(null);
              }}
              disabled={deleteMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Eliminar conexión
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {renaming && <RenameDialog instance={renaming} onClose={() => setRenaming(null)} />}

      <CreateInstanceDialog open={creating} onClose={closeCreate} />
    </div>
  );
}

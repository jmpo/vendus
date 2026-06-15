import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useUserSectors } from '@/hooks/useUserSectors';
import { useAcceptConversation } from '@/hooks/useAcceptConversation';
import { useToast } from '@/hooks/use-toast';

interface AcceptTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string | null;
  /** If conversation already has a sector, suggest it. */
  defaultSectorId?: string | null;
  /** Force takeover: admin assuming someone else's conversation. */
  isTakeover?: boolean;
  previousAssigneeName?: string | null;
  onAccepted?: () => void;
}

export function AcceptTicketDialog({
  open,
  onOpenChange,
  conversationId,
  defaultSectorId,
  isTakeover = false,
  previousAssigneeName,
  onAccepted,
}: AcceptTicketDialogProps) {
  const { data: sectors = [], isLoading: loadingSectors } = useUserSectors();
  const acceptMutation = useAcceptConversation();
  const { toast } = useToast();
  const [sectorId, setSectorId] = useState<string>('');

  useEffect(() => {
    if (open) {
      setSectorId(defaultSectorId || '');
    }
  }, [open, defaultSectorId]);

  const handleConfirm = async () => {
    if (!conversationId || !sectorId) return;
    try {
      await acceptMutation.mutateAsync({
        conversation_id: conversationId,
        sector_id: sectorId,
        force: isTakeover,
      });
      toast({
        title: isTakeover ? 'Atención asumida' : 'Atención aceptada',
        description: isTakeover
          ? 'Usted es el agente responsable ahora.'
          : 'La conversación está en su fila.',
      });
      onAccepted?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: 'Error al aceptar',
        description: e?.message || 'Intente nuevamente.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isTakeover ? <ShieldCheck className="h-5 w-5 text-amber-500" /> : null}
            {isTakeover ? 'Asumir atención' : 'Aceptar atención'}
          </DialogTitle>
          <DialogDescription>
            {isTakeover && previousAssigneeName
              ? `Está a punto de asumir una conversación que actualmente está con ${previousAssigneeName}. Seleccione el sector para registrar la atención.`
              : 'Elija el sector responsable de esta atención. Se vinculará a la conversación.'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <label className="text-sm font-medium mb-2 block">Sector</label>
          {loadingSectors ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando sectores...
            </div>
          ) : sectors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No está asociado a ningún sector. Pida a un administrador que lo vincule.
            </p>
          ) : (
            <Select value={sectorId} onValueChange={setSectorId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccione un sector" />
              </SelectTrigger>
              <SelectContent>
                {sectors.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: s.color || 'hsl(var(--primary))' }}
                      />
                      {s.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!sectorId || acceptMutation.isPending || sectors.length === 0}
          >
            {acceptMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isTakeover ? 'Asumir conversación' : 'Aceptar atención'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

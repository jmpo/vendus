import { useState, useEffect, useMemo } from 'react';
import { useCreateDeal } from '@/hooks/useDeals';
import { useAuth } from '@/hooks/useAuth';
import { useProducts } from '@/hooks/useProducts';
import { useProductPipelineStages } from '@/hooks/useProductPipelineStages';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, ChevronDown } from 'lucide-react';

interface DealModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string;
  leadName: string;
  productId: string;
  organizationId: string;
}

/** Solo dígitos, mostrados con separador de miles. El valor es opcional. */
const formatearMonto = (value: string) => {
  const digitos = value.replace(/\D/g, '');
  if (!digitos) return '';
  return Number(digitos).toLocaleString('es-PY');
};

export function DealModal({ isOpen, onClose, leadId, leadName, productId, organizationId }: DealModalProps) {
  const { user } = useAuth();
  const createDeal = useCreateDeal();
  const queryClient = useQueryClient();
  const { data: products = [] } = useProducts();

  const [monto, setMonto] = useState('');
  const [pipelineId, setPipelineId] = useState<string>(productId);
  const [stageId, setStageId] = useState<string>('');
  const [titulo, setTitulo] = useState('');
  const [notas, setNotas] = useState('');
  const [verDetalles, setVerDetalles] = useState(false);

  const { data: stages = [] } = useProductPipelineStages(pipelineId);

  const orgProducts = useMemo(
    () => products.filter((p) => p.organization_id === organizationId),
    [products, organizationId],
  );

  useEffect(() => {
    if (isOpen) {
      setMonto('');
      setPipelineId(productId);
      setStageId('');
      setTitulo('');
      setNotas('');
      setVerDetalles(false);
    }
  }, [isOpen, productId]);

  useEffect(() => {
    if (stages.length > 0 && !stages.some((s) => s.id === stageId)) {
      setStageId(stages[0].id);
    }
  }, [stages, stageId]);

  const handleSubmit = async () => {
    if (!pipelineId) {
      toast.error('Elegí un pipeline');
      return;
    }

    // Todo lo demás es opcional: si no cargan monto ni título usamos valores por defecto.
    const valor = Number(monto.replace(/\D/g, '')) || 0;
    const nombre = titulo.trim() || `Oportunidad · ${leadName}`;

    try {
      await createDeal.mutateAsync({
        lead_id: leadId,
        product_id: pipelineId,
        seller_id: user?.id || '',
        organization_id: organizationId,
        deal_value: valor,
        status: 'open',
        plan_name: nombre,
        notes: notas.trim() || null,
        closed_at: null,
      });

      if (stageId) {
        const { error: stageErr } = await supabase.from('leads').update({ current_stage_id: stageId }).eq('id', leadId);
        if (stageErr) throw stageErr;
        queryClient.invalidateQueries({ queryKey: ['linked-lead'] });
        queryClient.invalidateQueries({ queryKey: ['leads'] });
      }

      toast.success('Oportunidad creada');
      onClose();
    } catch (e: any) {
      // Antes esto era un `catch {}` mudo y escondía la causa real del fallo.
      const detalle = e?.message || e?.error_description || String(e);
      console.error('[DealModal] error al crear la oportunidad:', e);
      toast.error('No se pudo crear la oportunidad', { description: detalle });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            Nueva oportunidad
          </DialogTitle>
        </DialogHeader>

        <div className="text-sm text-muted-foreground">
          Contacto: <span className="text-foreground font-medium">{leadName}</span>
        </div>

        <div className="grid gap-4 py-1">
          {/* Pipeline: solo se muestra si hay más de uno para elegir */}
          {orgProducts.length > 1 && (
            <div className="space-y-2">
              <Label>Pipeline</Label>
              <Select value={pipelineId} onValueChange={setPipelineId}>
                <SelectTrigger>
                  <SelectValue placeholder="Elegí el pipeline" />
                </SelectTrigger>
                <SelectContent>
                  {orgProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Etapa</Label>
            <Select value={stageId} onValueChange={setStageId} disabled={stages.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder={stages.length === 0 ? 'Este pipeline no tiene etapas' : 'Elegí la etapa'} />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="deal-monto">
              Valor estimado <span className="text-muted-foreground font-normal">(opcional)</span>
            </Label>
            <Input
              id="deal-monto"
              inputMode="numeric"
              placeholder="Ej: 150.000"
              value={monto}
              onChange={(e) => setMonto(formatearMonto(e.target.value))}
            />
          </div>

          {!verDetalles ? (
            <button
              type="button"
              onClick={() => setVerDetalles(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground w-fit"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              Agregar título y notas
            </button>
          ) : (
            <div className="grid gap-4 border-t pt-4">
              <div className="space-y-2">
                <Label htmlFor="deal-titulo">Título</Label>
                <Input
                  id="deal-titulo"
                  placeholder={`Oportunidad · ${leadName}`}
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="deal-notas">Notas</Label>
                <Textarea
                  id="deal-notas"
                  rows={3}
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={createDeal.isPending}>
            {createDeal.isPending ? 'Creando…' : 'Crear oportunidad'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

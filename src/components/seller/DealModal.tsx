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
import { Plus } from 'lucide-react';
import { format, addDays } from 'date-fns';

interface DealModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string;
  leadName: string;
  productId: string;
  organizationId: string;
}

const formatCurrency = (value: string) => {
  const numericValue = value.replace(/[^\d]/g, '');
  if (!numericValue) return '';
  const number = parseInt(numericValue) / 100;
  return number.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function DealModal({ isOpen, onClose, leadId, leadName, productId, organizationId }: DealModalProps) {
  const { user } = useAuth();
  const createDeal = useCreateDeal();
  const queryClient = useQueryClient();
  const { data: products = [] } = useProducts();

  const [title, setTitle] = useState('');
  const [dealValue, setDealValue] = useState('');
  const [pipelineId, setPipelineId] = useState<string>(productId);
  const [stageId, setStageId] = useState<string>('');
  const [closeDate, setCloseDate] = useState(format(addDays(new Date(), 30), 'yyyy-MM-dd'));
  const [description, setDescription] = useState('');

  const { data: stages = [] } = useProductPipelineStages(pipelineId);

  const orgProducts = useMemo(
    () => products.filter((p) => p.organization_id === organizationId),
    [products, organizationId],
  );

  useEffect(() => {
    if (isOpen) {
      setTitle(`Oportunidade para ${leadName}`);
      setDealValue('');
      setPipelineId(productId);
      setStageId('');
      setCloseDate(format(addDays(new Date(), 30), 'yyyy-MM-dd'));
      setDescription('');
    }
  }, [isOpen, leadName, productId]);

  useEffect(() => {
    if (stages.length > 0 && !stages.some((s) => s.id === stageId)) {
      setStageId(stages[0].id);
    }
  }, [stages, stageId]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('Informe o título da oportunidade');
      return;
    }
    const normalized = dealValue.replace(/\./g, '').replace(',', '.');
    const value = parseFloat(normalized.replace(/[^\d.-]/g, ''));
    if (!value || value <= 0) {
      toast.error('Digite um valor válido');
      return;
    }
    if (!pipelineId) {
      toast.error('Seleccioná um pipeline');
      return;
    }

    try {
      await createDeal.mutateAsync({
        lead_id: leadId,
        product_id: pipelineId,
        seller_id: user?.id || '',
        organization_id: organizationId,
        deal_value: value,
        status: 'open' as any,
        plan_name: title.trim(),
        notes: description.trim() || null,
        closed_at: closeDate ? new Date(closeDate).toISOString() : null,
      });

      if (stageId) {
        await supabase.from('leads').update({ current_stage_id: stageId }).eq('id', leadId);
        queryClient.invalidateQueries({ queryKey: ['linked-lead'] });
        queryClient.invalidateQueries({ queryKey: ['leads'] });
      }

      toast.success('Oportunidade criada');
      onClose();
    } catch {
      toast.error('Erro ao criar oportunidade');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            Nova Oportunidade
          </DialogTitle>
        </DialogHeader>

        <div className="text-sm text-muted-foreground">Contato: <span className="text-foreground">{leadName}</span></div>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="deal-title">Título da Oportunidade</Label>
              <Input
                id="deal-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deal-value">Valor</Label>
              <Input
                id="deal-value"
                placeholder="R$"
                value={dealValue}
                onChange={(e) => setDealValue(formatCurrency(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Pipeline</Label>
              <Select value={pipelineId} onValueChange={setPipelineId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccioná o pipeline" />
                </SelectTrigger>
                <SelectContent>
                  {orgProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Estágio</Label>
              <Select value={stageId} onValueChange={setStageId} disabled={stages.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder={stages.length === 0 ? 'Sem estágios' : 'Seleccioná o estágio'} />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2 sm:w-1/2">
            <Label htmlFor="deal-close">Data prevista de fechamento</Label>
            <Input
              id="deal-close"
              type="date"
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="deal-desc">Descrição</Label>
            <Textarea
              id="deal-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={createDeal.isPending}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

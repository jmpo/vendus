import { useState, useEffect, useRef } from 'react';
import { Settings2, Plus, Loader2, Save, GripVertical, Check, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { StageCard } from './StageCard';
import { StageEditForm, StageEditFormRef } from './StageEditForm';
import {
  useCreatePipelineStage,
  useUpdatePipelineStage,
  useDeletePipelineStage,
} from '@/hooks/usePipelineMutations';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

const CONVERSION_CURRENCIES = ['USD', 'PYG', 'ARS', 'BRL', 'MXN', 'CLP', 'COP', 'UYU', 'EUR'];

interface Stage {
  id: string;
  name: string;
  color: string | null;
  order_index: number;
  is_won: boolean | null;
  is_lost: boolean | null;
  description?: string | null;
  conversion_event?: string | null;
  conversion_value?: number | null;
}

interface StageManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stages: Stage[];
  productId: string;
  productName?: string;
  onRefresh?: () => void;
}

export function StageManagerDialog({
  open,
  onOpenChange,
  stages,
  productId,
  productName,
  onRefresh,
}: StageManagerDialogProps) {
  const formRef = useRef<StageEditFormRef>(null);
  const [editingStage, setEditingStage] = useState<Stage | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [localStages, setLocalStages] = useState<Stage[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [hasOrderChanges, setHasOrderChanges] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  const createStage = useCreatePipelineStage();
  const updateStage = useUpdatePipelineStage();
  const deleteStage = useDeletePipelineStage();

  // Moneda de conversiones (a nivel organización) — para los eventos Purchase a Meta.
  const { profile } = useAuth();
  const orgId = profile?.organization_id;
  const queryClient = useQueryClient();
  const { data: convCurrency } = useQuery({
    queryKey: ['org-conversion-currency', orgId],
    enabled: !!orgId && open,
    queryFn: async () => {
      const { data } = await supabase.from('organizations').select('conversion_currency').eq('id', orgId).maybeSingle();
      return (data as any)?.conversion_currency ?? 'USD';
    },
  });
  const updateCurrency = async (cur: string) => {
    if (!orgId) return;
    const { error } = await supabase.from('organizations').update({ conversion_currency: cur } as any).eq('id', orgId);
    if (error) { toast.error('No se pudo guardar la moneda'); return; }
    queryClient.setQueryData(['org-conversion-currency', orgId], cur);
    toast.success(`Moneda de conversiones: ${cur}`);
  };

  // Fetch lead counts per stage
  const { data: leadCounts = {} } = useQuery({
    queryKey: ['lead-counts-by-stage', productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('current_stage_id')
        .eq('product_id', productId);

      if (error) throw error;

      const counts: Record<string, number> = {};
      data?.forEach((lead) => {
        if (lead.current_stage_id) {
          counts[lead.current_stage_id] = (counts[lead.current_stage_id] || 0) + 1;
        }
      });
      return counts;
    },
    enabled: open && !!productId,
  });

  // Sync local stages when dialog opens or stages change
  useEffect(() => {
    if (open) {
      const realStages = stages.filter(s => s.id !== 'unassigned');
      const sorted = [...realStages].sort((a, b) => a.order_index - b.order_index);
      setLocalStages(sorted);
      setHasOrderChanges(false);
    }
  }, [open, stages]);

  useEffect(() => {
    if (!open) {
      setEditingStage(null);
      setIsAddingNew(false);
      setDraggedIndex(null);
      setDragOverIndex(null);
      setHasOrderChanges(false);
    }
  }, [open]);

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragEnd = () => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const newStages = [...localStages];
      const [draggedStage] = newStages.splice(draggedIndex, 1);
      newStages.splice(dragOverIndex, 0, draggedStage);
      
      // Update order_index for all stages
      const updatedStages = newStages.map((stage, index) => ({
        ...stage,
        order_index: index + 1,
      }));
      
      setLocalStages(updatedStages);
      setHasOrderChanges(true);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleSaveOrder = async () => {
    setIsSavingOrder(true);
    try {
      await Promise.all(
        localStages.map((stage, index) =>
          updateStage.mutateAsync({
            id: stage.id,
            order_index: index + 1,
          })
        )
      );
      setHasOrderChanges(false);
      toast.success('Ordem das etapas salva!');
      onRefresh?.();
    } catch (error) {
      console.error('Error saving order:', error);
      toast.error('Error ao guardar ordem');
    } finally {
      setIsSavingOrder(false);
    }
  };

  const handleSaveStage = async (data: Partial<Stage> & { id?: string }) => {
    try {
      if (data.id) {
        // Update existing
        await updateStage.mutateAsync({
          id: data.id,
          name: data.name,
          description: data.description,
          color: data.color,
          is_won: data.is_won,
          is_lost: data.is_lost,
          conversion_event: (data as any).conversion_event ?? null,
          conversion_value: (data as any).conversion_value ?? null,
        } as any);
        toast.success('Etapa actualizada!');
      } else {
        // Create new
        await createStage.mutateAsync({
          product_id: productId,
          name: data.name!,
          description: data.description || null,
          color: data.color || '#6b7280',
          order_index: data.order_index || localStages.length + 1,
          is_won: data.is_won || false,
          is_lost: data.is_lost || false,
          conversion_event: (data as any).conversion_event ?? null,
          conversion_value: (data as any).conversion_value ?? null,
        } as any);
        toast.success('Etapa creada!');
      }

      setEditingStage(null);
      setIsAddingNew(false);
      onRefresh?.();
    } catch (error) {
      console.error('Error saving stage:', error);
      toast.error('Error ao guardar etapa');
    }
  };

  const handleDeleteStage = async (stageId: string) => {
    try {
      await deleteStage.mutateAsync({ id: stageId, productId });
      setLocalStages(prev => prev.filter(s => s.id !== stageId));
      onRefresh?.();
    } catch (error) {
      console.error('Error deleting stage:', error);
    }
  };

  const handleSaveFromRef = async () => {
    if (!formRef.current) return;
    if (!formRef.current.isValid()) {
      toast.error('Completá o nombre da etapa');
      return;
    }
    const data = formRef.current.getData();
    await handleSaveStage(data);
  };

  const nextOrderIndex = localStages.length + 1;
  const isSaving = createStage.isPending || updateStage.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] sm:max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Settings2 className="h-5 w-5 text-primary" />
            <span className="truncate">Gestionar Etapas</span>
            {productName && (
              <span className="text-muted-foreground font-normal truncate hidden sm:inline">
                - {productName}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-sm">
            Configurá las etapas de tu embudo de ventas. En cada etapa podés definir el evento de conversión que se envía a Meta Ads.
          </DialogDescription>
          <div className="flex items-center gap-2 pt-1">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Moneda de conversiones:</Label>
            <Select value={convCurrency ?? 'USD'} onValueChange={updateCurrency}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONVERSION_CURRENCIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground hidden sm:inline">(para eventos Purchase enviados a Meta)</span>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-full">
          <div className="space-y-2 py-2">
            {localStages.map((stage, index) => (
              <div
                key={stage.id}
                draggable={!editingStage && !isAddingNew}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                onDragLeave={() => setDragOverIndex(null)}
                className={cn(
                  "transition-all duration-200",
                  draggedIndex === index && "opacity-50 scale-[0.98]",
                  dragOverIndex === index && draggedIndex !== null && draggedIndex !== index && 
                    "border-t-2 border-primary pt-2"
                )}
              >
                {editingStage?.id === stage.id ? (
                  <StageEditForm
                    ref={formRef}
                    stage={{
                      ...stage,
                      description: stage.description ?? null,
                    }}
                    onCancel={() => setEditingStage(null)}
                  />
                ) : (
                  <div className="flex items-start gap-2">
                    <div 
                      className={cn(
                        "flex items-center justify-center w-8 h-8 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors mt-3",
                        (editingStage || isAddingNew) && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <GripVertical className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <StageCard
                        stage={{
                          ...stage,
                          description: stage.description ?? null,
                        }}
                        leadCount={leadCounts[stage.id] || 0}
                        onEdit={setEditingStage}
                        onDelete={handleDeleteStage}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}

            {isAddingNew && (
              <div className="ml-10">
                <StageEditForm
                  ref={formRef}
                  stage={null}
                  isNew
                  onCancel={() => setIsAddingNew(false)}
                  nextOrderIndex={nextOrderIndex}
                />
              </div>
            )}

            {localStages.length === 0 && !isAddingNew && (
              <div className="text-center py-8 text-muted-foreground">
                <p>Ninguna etapa configurada.</p>
                <p className="text-sm">Hacé clic em "Nueva Etapa" para comenzar.</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t shrink-0">
          {(editingStage || isAddingNew) ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setEditingStage(null);
                  setIsAddingNew(false);
                }}
              >
                <X className="h-4 w-4 mr-2" />
                Cancelar
              </Button>
              <Button
                onClick={handleSaveFromRef}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                {isAddingNew ? 'Crear Etapa' : 'Guardar Etapa'}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Fechar
              </Button>

              <div className="flex items-center gap-2">
                {hasOrderChanges && (
                  <Button
                    variant="default"
                    onClick={handleSaveOrder}
                    disabled={isSavingOrder}
                    className="animate-fade-in"
                  >
                    {isSavingOrder ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Guardar Ordem
                  </Button>
                )}

                <Button
                  variant={hasOrderChanges ? "outline" : "default"}
                  onClick={() => {
                    setEditingStage(null);
                    setIsAddingNew(true);
                  }}
                  disabled={isAddingNew || !!editingStage}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nueva Etapa
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

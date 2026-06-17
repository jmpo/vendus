import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Sparkles, 
  Loader2, 
  DollarSign, 
  Clock, 
  Shield, 
  Brain, 
  Users, 
  Swords,
  Save,
  RefreshCw
} from 'lucide-react';
import { useGenerateObjections, useSaveGeneratedObjections } from '@/hooks/useObjectionAI';
import { toast } from 'sonner';

interface GeneratedObjection {
  category: 'price' | 'trust' | 'timing' | 'thinking' | 'partner' | 'competitor';
  what_they_say: string;
  what_they_mean: string;
  suggested_response: string;
  follow_up_question: string;
}

interface ObjectionGeneratorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
}

const categoryConfig: Record<string, { label: string; icon: React.ComponentType<any>; color: string }> = {
  price: { label: 'Precio', icon: DollarSign, color: 'text-green-500 bg-green-500/10' },
  timing: { label: 'Timing', icon: Clock, color: 'text-blue-500 bg-blue-500/10' },
  trust: { label: 'Confianza', icon: Shield, color: 'text-purple-500 bg-purple-500/10' },
  thinking: { label: 'Lo voy a pensar', icon: Brain, color: 'text-amber-500 bg-amber-500/10' },
  partner: { label: 'Socio/Director', icon: Users, color: 'text-cyan-500 bg-cyan-500/10' },
  competitor: { label: 'Competencia', icon: Swords, color: 'text-red-500 bg-red-500/10' },
};

export function ObjectionGeneratorModal({
  open,
  onOpenChange,
  productId,
  productName,
}: ObjectionGeneratorModalProps) {
  const [objections, setObjections] = useState<GeneratedObjection[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  
  const generateObjections = useGenerateObjections();
  const saveObjections = useSaveGeneratedObjections();

  const handleGenerate = async () => {
    try {
      const generated = await generateObjections.mutateAsync(productId);
      setObjections(generated);
      setSelectedIds(new Set(generated.map((_, i) => i)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error ao generar objeciones');
    }
  };

  const toggleSelection = (index: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedIds(newSelected);
  };

  const handleSave = async () => {
    const selectedObjections = objections.filter((_, i) => selectedIds.has(i));
    
    if (selectedObjections.length === 0) {
      toast.error('Seleccione al menos una objeción');
      return;
    }

    try {
      await saveObjections.mutateAsync({
        productId,
        objections: selectedObjections,
      });
      toast.success(`${selectedObjections.length} ¡objeciones guardadas con éxito!`);
      onOpenChange(false);
      setObjections([]);
      setSelectedIds(new Set());
    } catch (error) {
      toast.error('Error al guardar objeciones');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Generar Objeciones con IA
          </DialogTitle>
          <DialogDescription>
            La IA analizará el producto <strong>{productName}</strong> e gerará as objeciones mais 
            prováveis que sus vendedores irão enfrentar, con respuestas estratégicas.
          </DialogDescription>
        </DialogHeader>

        {objections.length === 0 ? (
          <div className="py-8 text-center space-y-4">
            <div className="h-16 w-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">¿Listo para generar objeciones?</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                A IA irá analisar o pitch, ICP, diferenciais e base de conocimiento 
                do producto para crear objeciones realistas.
              </p>
            </div>
            <Button 
              onClick={handleGenerate}
              disabled={generateObjections.isPending}
              size="lg"
            >
              {generateObjections.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analizando producto...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generar Objeciones
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge variant="secondary">
                {objections.length} objeciones generadas
              </Badge>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerate}
                  disabled={generateObjections.isPending}
                >
                  {generateObjections.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (selectedIds.size === objections.length) {
                      setSelectedIds(new Set());
                    } else {
                      setSelectedIds(new Set(objections.map((_, i) => i)));
                    }
                  }}
                >
                  {selectedIds.size === objections.length ? 'Desmarcar Todas' : 'Seleccionar Todas'}
                </Button>
              </div>
            </div>

            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {objections.map((obj, index) => {
                  const config = categoryConfig[obj.category];
                  const Icon = config?.icon || Brain;
                  const isSelected = selectedIds.has(index);

                  return (
                    <div
                      key={index}
                      className={`rounded-lg border p-4 transition-all cursor-pointer ${
                        isSelected ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/30'
                      }`}
                      onClick={() => toggleSelection(index)}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelection(index)}
                          className="mt-1"
                        />
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <div className={`h-6 w-6 rounded flex items-center justify-center ${config?.color || 'bg-muted'}`}>
                              <Icon className="h-3.5 w-3.5" />
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {config?.label || obj.category}
                            </Badge>
                          </div>

                          <div className="space-y-2 text-sm">
                            <div>
                              <span className="font-medium text-foreground">
                                "{obj.what_they_say}"
                              </span>
                            </div>
                            
                            <div className="text-muted-foreground">
                              <span className="text-xs uppercase font-medium text-primary">
                                Significado:
                              </span>{' '}
                              {obj.what_they_mean}
                            </div>

                            <div className="text-muted-foreground">
                              <span className="text-xs uppercase font-medium text-primary">
                                Respuesta:
                              </span>{' '}
                              {obj.suggested_response}
                            </div>

                            <div className="text-muted-foreground">
                              <span className="text-xs uppercase font-medium text-primary">
                                Pregunta:
                              </span>{' '}
                              {obj.follow_up_question}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <div className="flex justify-between items-center pt-2 border-t">
              <span className="text-sm text-muted-foreground">
                {selectedIds.size} de {objections.length} seleccionadas
              </span>
              <Button
                onClick={handleSave}
                disabled={saveObjections.isPending || selectedIds.size === 0}
              >
                {saveObjections.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Guardar Seleccionadas
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

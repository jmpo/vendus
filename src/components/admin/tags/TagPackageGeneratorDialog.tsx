import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, Check, X } from 'lucide-react';
import { useProducts } from '@/hooks/useProducts';
import { useGenerateTagPackage } from '@/hooks/useTagPackage';
import { useTagAutomations } from '@/hooks/useLeadTags';

const PACKAGE_PREVIEW = [
  { name: 'PIX Generado',           color: '#EAB308', removed: true,  desc: 'Aplicada cuando el cliente genera PIX. Eliminada al confirmar el pago.' },
  { name: 'Boleto Generado',        color: '#3B82F6', removed: true,  desc: 'Aplicada cuando genera boleto. Eliminada al confirmar el pago.' },
  { name: 'Esperando Pago', color: '#F97316', removed: true,  desc: 'Aplicada con PIX o Boleto. Eliminada al confirmar.' },
  { name: 'Checkout Abandonado',  color: '#6B7280', removed: true,  desc: 'Aplicada si abandona. Eliminada si vuelve y compra.' },
  { name: 'Cliente',              color: '#22C55E', removed: false, desc: 'Aplicada en la compra. PERMANENTE para el historial.' },
  { name: 'Reembolso',            color: '#EF4444', removed: false, desc: 'Aplicada en reembolso. PERMANENTE para el historial.' },
];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function TagPackageGeneratorDialog({ open, onOpenChange }: Props) {
  const { data: products } = useProducts();
  const { data: automations } = useTagAutomations();
  const generateMut = useGenerateTagPackage();
  const [productId, setProductId] = useState<string>('');

  // Produtos que ya têm pacote gerado
  const productsWithPackage = useMemo(() => {
    const set = new Set<string>();
    automations?.forEach((a) => { if (a.product_id) set.add(a.product_id); });
    return set;
  }, [automations]);

  const selectedProduct = products?.find((p) => p.id === productId);
  const alreadyHasPackage = productId && productsWithPackage.has(productId);

  const handleGenerate = async () => {
    if (!selectedProduct) return;
    try {
      await generateMut.mutateAsync({
        product_id: selectedProduct.id,
        product_label: selectedProduct.name,
      });
      onOpenChange(false);
      setProductId('');
    } catch {}
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Generar paquete de etiquetas para un producto
          </DialogTitle>
          <DialogDescription>
            Cria 6 etiquetas + 6 automatizaciones de uma vez. Cada etiqueta vem prefixada con o nombre do producto,
            evitando que clientes que compram vários productos misturem flujos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Producto</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder="Elige el producto" /></SelectTrigger>
              <SelectContent>
                {products?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex items-center gap-2">
                      {productsWithPackage.has(p.id) && <Check className="h-3 w-3 text-emerald-500" />}
                      {p.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {alreadyHasPackage && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                Este producto ya tiene un paquete generado. Ejecutar de nuevo no duplica nada (solo asegura que esté completo).
              </p>
            )}
          </div>

          {selectedProduct && (
            <div className="space-y-2">
              <Label className="text-xs uppercase text-muted-foreground">Previsualización (se creará)</Label>
              <div className="rounded-lg border border-border divide-y">
                {PACKAGE_PREVIEW.map((tag) => (
                  <div key={tag.name} className="flex items-start gap-3 p-3">
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs shrink-0 mt-0.5"
                      style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                      {tag.name} · {selectedProduct.name}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">{tag.desc}</p>
                    </div>
                    <span className="text-[10px] uppercase font-medium shrink-0 mt-1">
                      {tag.removed ? (
                        <span className="text-orange-600 inline-flex items-center gap-1"><X className="h-3 w-3" /> Transitoria</span>
                      ) : (
                        <span className="text-emerald-600 inline-flex items-center gap-1"><Check className="h-3 w-3" /> Permanente</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleGenerate} disabled={!productId || generateMut.isPending}>
            {generateMut.isPending ? 'Generando...' : 'Generar paquete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { CadenceEditor } from '@/components/cadence/CadenceEditor';
import { useCadence } from '@/hooks/useCadence';
import { useProducts } from '@/hooks/useProducts';
import { Loader2 } from 'lucide-react';

interface CadenceTabProps {
  productId: string;
}

export function CadenceTab({ productId }: CadenceTabProps) {
  const { fecha: cadence, isLoading: cadenceLoading } = useCadence(productId);
  const { fecha: products } = useProducts();
  
  const product = products?.find(p => p.id === productId);
  
  if (cadenceLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <CadenceEditor 
      cadence={cadence || []} 
      productId={productId}
      productName={product?.name || 'Producto'} 
    />
  );
}

import { useState, useEffect } from 'react';
import { useProducts } from '@/hooks/useProducts';
import { ProductBrainHub } from '@/components/brain/ProductBrainHub';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Package } from 'lucide-react';

export function BrainManager() {
  const { data: products, isLoading: productsLoading } = useProducts();
  const [selectedProductId, setSelectedProductId] = useState<string>('');

  // Auto-select first product
  useEffect(() => {
    if (products?.length && !selectedProductId) {
      setSelectedProductId(products[0].id);
    }
  }, [products, selectedProductId]);

  if (productsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!products || products.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Cerebro de la IA</h1>
          <p className="text-muted-foreground">Entrene a la IA con el conocimiento de los productos</p>
        </div>
        
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Ningún producto registrado</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Primero cree un producto para poder entrenar el cerebro de la IA.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Product Brain Hub */}
      {selectedProductId && (
        <ProductBrainHub 
          productId={selectedProductId} 
          onProductChange={setSelectedProductId}
        />
      )}
    </div>
  );
}

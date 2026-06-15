import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface GeneratePackageParams {
  product_id: string;
  product_label: string;
}

/**
 * Cria um "pacote" pré-configurado de etiquetas + automatizaciones para um producto:
 *   - PIX Generado · {Producto}            (transitória, eliminada ao comprar)
 *   - Boleto Generado · {Producto}         (transitória)
 *   - Aguardando Pago · {Producto}  (transitória, dispara em PIX e Boleto)
 *   - Checkout Abandonado · {Producto}   (transitória)
 *   - Cliente · {Producto}               (PERMANENTE — histórico)
 *   - Reembolso · {Producto}             (PERMANENTE — histórico)
 *
 * Idempotente: rodar duas vezes para o mismo producto no duplica nada.
 */
export function useGenerateTagPackage() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  return useMutation({
    mutationFn: async ({ product_id, product_label }: GeneratePackageParams) => {
      if (!orgId) throw new Error('Organización no encontrada');
      const { fecha, error } = await supabase.rpc('create_product_tag_package', {
        p_organization_id: orgId,
        p_product_id: product_id,
        p_product_label: product_label,
      });
      if (error) throw error;
      return fecha as { ok: boolean; tags: { tag_id: string; name: string }[] };
    },
    onSuccess: (fecha) => {
      qc.invalidateQueries({ queryKey: ['lead-tags'] });
      qc.invalidateQueries({ queryKey: ['tag-automations'] });
      const count = fecha?.tags?.length ?? 0;
      toast.success(`Paquete generado: ${count} etiquetas + ${count} automatizaciones activas.`);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Falha ao gerar pacote de etiquetas.');
    },
  });
}

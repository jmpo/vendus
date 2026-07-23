import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

/**
 * Interruptor MAESTRO de la IA (por organización).
 * Con `ai_enabled = false` el bot sale en silencio en TODAS las conversaciones:
 * no responde a nadie y los mensajes quedan en el inbox para atención humana.
 * Es independiente del on/off de cada agente: sirve como "pausa de emergencia".
 */
export function useAiMasterSwitch() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const orgId = profile?.organization_id;

  const query = useQuery({
    queryKey: ['ai-master-switch', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('ai_enabled')
        .eq('id', orgId!)
        .maybeSingle();
      if (error) throw error;
      // Si la columna viniera null, tratamos la IA como ACTIVA (comportamiento por defecto).
      return (data as any)?.ai_enabled !== false;
    },
  });

  const toggle = useMutation({
    mutationFn: async (activar: boolean) => {
      const { error } = await supabase
        .from('organizations')
        .update({ ai_enabled: activar } as any)
        .eq('id', orgId!);
      if (error) throw error;
      return activar;
    },
    onSuccess: (activar) => {
      qc.invalidateQueries({ queryKey: ['ai-master-switch', orgId] });
      toast.success(
        activar
          ? 'IA reactivada — los agentes vuelven a responder'
          : 'IA pausada — ningún agente va a responder. Las conversaciones quedan para atención humana.',
      );
    },
    onError: (e: any) => toast.error('No se pudo cambiar el estado de la IA: ' + (e?.message ?? e)),
  });

  return {
    aiEnabled: query.data ?? true,
    isLoading: query.isLoading,
    setAiEnabled: (v: boolean) => toggle.mutate(v),
    isToggling: toggle.isPending,
  };
}

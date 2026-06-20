import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface ZernioTemplate {
  name: string;
  language: string;
  status: string;
  category?: string;
}

/**
 * Plantillas aprobadas de la conexión Zernio activa de la organización.
 * Se usa para que el admin SELECCIONE la plantilla de reenganche (en vez de tipear el nombre).
 */
export function useZernioTemplates() {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  return useQuery({
    queryKey: ['zernio-templates-approved', orgId],
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ZernioTemplate[]> => {
      // Conexión Zernio activa de la org
      const { data: conn } = await supabase
        .from('zernio_connections')
        .select('id')
        .eq('organization_id', orgId!)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!conn?.id) return [];

      const { data, error } = await supabase.functions.invoke('zernio-templates', {
        body: { organization_id: orgId, connection_id: conn.id, action: 'list' },
      });
      if (error) return [];
      const all = ((data as any)?.templates ?? []) as ZernioTemplate[];
      return all.filter((t) => (t.status || '').toUpperCase() === 'APPROVED');
    },
  });
}

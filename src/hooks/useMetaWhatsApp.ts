import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface MetaWAConnection {
  id: string;
  organization_id: string;
  display_name: string;
  phone_number: string | null;
  phone_number_id: string;
  waba_id: string;
  business_account_name: string | null;
  app_id: string;
  webhook_verify_token: string;
  status: 'pending' | 'active' | 'error' | 'revoked' | 'draft';
  last_error: string | null;
  last_health_check_at: string | null;
  webhook_subscribed_at?: string | null;
  quality_rating: string | null;
  messaging_limit_tier: string | null;
  default_reengagement_template_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MetaWATemplate {
  id: string;
  connection_id: string;
  organization_id: string;
  meta_template_id: string | null;
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  status: string;
  components: any;
  rejected_reason: string | null;
  last_synced_at: string | null;
}

export function useMetaWAConnections() {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;
  return useQuery({
    queryKey: ['meta-wa-connections', orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from('whatsapp_meta_connections' as any)
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as MetaWAConnection[];
    },
    enabled: !!orgId,
  });
}

export function useMetaWATemplates(connectionId: string | null) {
  return useQuery({
    queryKey: ['meta-wa-templates', connectionId],
    queryFn: async () => {
      if (!connectionId) return [];
      const { data, error } = await supabase
        .from('whatsapp_meta_templates' as any)
        .select('*')
        .eq('connection_id', connectionId)
        .order('name');
      if (error) throw error;
      return (data ?? []) as unknown as MetaWATemplate[];
    },
    enabled: !!connectionId,
  });
}

export function useSaveMetaWAConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: any) => {
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-connect', { body: payload });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meta-wa-connections'] });
      toast.success('Conexión guardada');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Error al guardar'),
  });
}

export function useDraftMetaWAConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { organization_id: string; display_name: string; connection_id?: string }) => {
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-draft', { body: payload });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as {
        connection_id: string;
        verify_token: string;
        webhook_url: string;
        webhook_subscribed_at: string | null;
        status: string;
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meta-wa-connections'] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Falha ao iniciar rascunho'),
  });
}

export function useTestMetaWAConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (connection_id: string) => {
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-test', { body: { connection_id } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['meta-wa-connections'] });
      qc.invalidateQueries({ queryKey: ['meta-wa-templates'] });
      if (data?.ok) toast.success('Conexión validada');
      else toast.error(data?.error ?? 'Falha no teste');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Falha no teste'),
  });
}

export function useSyncMetaWATemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (connection_id: string) => {
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-templates-sync', { body: { connection_id } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['meta-wa-templates'] });
      toast.success(`${data?.count ?? 0} templates sincronizados`);
    },
    onError: (e: any) => toast.error(e?.message ?? 'Falha ao sincronizar'),
  });
}

export function useSubmitMetaWATemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { connection_id: string; name: string; language: string; category: string; components: any[] }) => {
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-template-submit', { body: payload });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meta-wa-templates'] });
      toast.success('Plantilla enviada para aprobación');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Falha al enviar template'),
  });
}

export function useDeleteMetaWAConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('whatsapp_meta_connections' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meta-wa-connections'] });
      toast.success('Conexión eliminada');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Falha ao eliminar'),
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface InstagramConnection {
  id: string;
  organization_id: string;
  display_name: string;
  status: 'draft' | 'active' | 'error' | 'revoked';
  app_id: string | null;
  ig_business_account_id: string | null;
  ig_username: string | null;
  fb_page_id: string | null;
  fb_page_name: string | null;
  webhook_verify_token: string;
  webhook_subscribed_at: string | null;
  last_inbound_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DraftInstagramResponse {
  connection_id: string;
  verify_token: string;
  webhook_url: string;
  webhook_subscribed_at: string | null;
  status: string;
}

export function useInstagramConnections() {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;
  return useQuery({
    queryKey: ['instagram-connections', orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from('instagram_connections' as any)
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as InstagramConnection[];
    },
    enabled: !!orgId,
  });
}

export function useDraftInstagramConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { organization_id: string; display_name: string; connection_id?: string }) => {
      const { data, error } = await supabase.functions.invoke('instagram-draft', { body: payload });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as DraftInstagramResponse;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instagram-connections'] }),
    onError: (e: any) => toast.error(e?.message ?? 'Fallo ao crear borrador'),
  });
}

export function useSaveInstagramConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: any) => {
      const { data, error } = await supabase.functions.invoke('instagram-connect', { body: payload });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instagram-connections'] });
      toast.success('Conexión Instagram ativa');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Fallo ao ativar'),
  });
}

export function useTestInstagramConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (connection_id: string) => {
      const { data, error } = await supabase.functions.invoke('instagram-test', { body: { connection_id } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['instagram-connections'] });
      if (data?.ok) toast.success(`Conectado como @${data?.ig?.username ?? 'instagram'}`);
      else toast.error(data?.error ?? 'Fallo no teste');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Fallo no teste'),
  });
}

export function useDeleteInstagramConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('instagram_connections' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instagram-connections'] });
      toast.success('Conexión eliminada');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Fallo ao eliminar'),
  });
}

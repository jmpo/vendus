import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface UserPermissions {
  id: string;
  user_id: string;
  organization_id: string;
  view_queue_conversations: boolean;
  view_other_users_conversations: boolean;
  view_other_queues_conversations: boolean;
  allow_close_pending_tickets: boolean;
  view_all_contacts: boolean;
  allow_pipeline: boolean;
  allow_manage_client_portfolio: boolean;
  view_all_kanban_cards: boolean;
  view_all_schedules: boolean;
  allow_dashboard: boolean;
  allow_inbox_panel: boolean;
  allow_groups: boolean;
  allow_connection_actions: boolean;
  view_unassigned_sector_tickets: boolean;
  view_schedules_mode: 'all' | 'mine_only';
}

export type PermissionKey = keyof Omit<UserPermissions, 'id' | 'user_id' | 'organization_id' | 'view_schedules_mode'>;

export const PERMISSION_LABELS: Record<PermissionKey, { label: string; category: string }> = {
  view_queue_conversations: { label: 'Ver fila de atención (meus setores)', category: 'Atención' },
  view_unassigned_sector_tickets: { label: 'Ver tickets sem sector definido', category: 'Atención' },
  view_other_users_conversations: { label: 'Ver conversaciones de outros vendedores nos meus setores', category: 'Atención' },
  view_other_queues_conversations: { label: 'Ver conversaciones de setores que no participo (supervisor)', category: 'Atención' },
  allow_close_pending_tickets: { label: 'Permitir cerrar tickets pendentes em massa', category: 'Atención' },
  view_all_contacts: { label: 'Ver todos os contactos', category: 'CRM' },
  allow_pipeline: { label: 'Permitir Pipeline', category: 'CRM' },
  allow_manage_client_portfolio: { label: 'Gestionar carteira de clientes', category: 'CRM' },
  view_all_kanban_cards: { label: 'Ver todos os cards do Kanban', category: 'CRM' },
  view_all_schedules: { label: 'Ver todos os reservas', category: 'Calendario' },
  allow_dashboard: { label: 'Ver Dashboard', category: 'Painéis' },
  allow_inbox_panel: { label: 'Ver Painel de Atendimentos', category: 'Painéis' },
  allow_groups: { label: 'Permitir Grupos', category: 'Organización' },
  allow_connection_actions: { label: 'Permitir acciones nas conexões', category: 'Organización' },
};

export function useMyPermissions() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['user-permissions', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('user_permissions')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (error) throw error;
      return data as UserPermissions | null;
    },
    enabled: !!user?.id,
  });
}

export function useUserPermissions(userId: string | undefined) {
  return useQuery({
    queryKey: ['user-permissions', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from('user_permissions')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      
      if (error) throw error;
      return data as UserPermissions | null;
    },
    enabled: !!userId,
  });
}

export function useUpdateUserPermissions() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({ userId, permissions }: { userId: string; permissions: Partial<UserPermissions> }) => {
      const { id, user_id, organization_id, ...updates } = permissions as any;

      // Upsert so it works whether the row exists or not (e.g. legacy users)
      const { data, error } = await supabase
        .from('user_permissions')
        .upsert(
          {
            user_id: userId,
            organization_id: organization_id || profile?.organization_id || null,
            ...updates,
          },
          { onConflict: 'user_id' }
        )
        .select()
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['user-permissions', variables.userId] });
    },
  });
}

export function useInitializePermissions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, organizationId, role }: { userId: string; organizationId: string; role: string }) => {
      const { error } = await supabase.rpc('initialize_user_permissions', {
        p_user_id: userId,
        p_organization_id: organizationId,
        p_role: role,
      });
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['user-permissions', variables.userId] });
    },
  });
}

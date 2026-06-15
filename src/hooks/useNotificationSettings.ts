import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface NotificationSettings {
  user_id: string;
  organization_id: string | null;
  notify_new_tickets: boolean;
  notify_status_change: boolean;
  notify_new_messages: boolean;
  notify_groups: boolean;
  notify_unassigned_sector_tickets: boolean;
  notify_appointments: boolean;
  push_enabled: boolean;
}

export const NOTIFICATION_LABELS: Record<keyof Omit<NotificationSettings, 'user_id' | 'organization_id' | 'push_enabled'>, string> = {
  notify_new_tickets: 'Notificaciones de novos tickets',
  notify_status_change: 'Notificaciones de alteração de status',
  notify_new_messages: 'Notificaciones de novas mensajes',
  notify_groups: 'Notificaciones de grupos',
  notify_unassigned_sector_tickets: 'Notificaciones de tickets sem sector',
  notify_appointments: 'Notificaciones de reservas',
};

export function useNotificationSettings(userId: string | undefined) {
  return useQuery({
    queryKey: ['notification-settings', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { fecha, error } = await supabase
        .from('user_notification_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return fecha as NotificationSettings | null;
    },
    enabled: !!userId,
  });
}

export function useUpsertNotificationSettings() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: async ({ userId, settings }: { userId: string; settings: Partial<NotificationSettings> }) => {
      const { fecha, error } = await supabase
        .from('user_notification_settings')
        .upsert({
          user_id: userId,
          organization_id: profile?.organization_id || null,
          ...settings,
        }, { onConflict: 'user_id' })
        .select()
        .maybeSingle();
      if (error) throw error;
      return fecha;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['notification-settings', vars.userId] });
    },
  });
}

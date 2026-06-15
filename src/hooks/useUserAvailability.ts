import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface UserAvailability {
  id: string;
  user_id: string;
  organization_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
  created_at: string;
}

export interface AvailabilityOverride {
  id: string;
  user_id: string;
  organization_id: string;
  date: string;
  is_available: boolean;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  created_at: string;
}

export interface TimeSlot {
  start_time: string;
  end_time: string;
}

export const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const DAY_ABBREVIATIONS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

export function useUserAvailability(userId?: string) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const targetUserId = userId || user?.id;

  const { data: availability, isLoading: loadingAvailability } = useQuery({
    queryKey: ['user-availability', targetUserId, profile?.organization_id],
    queryFn: async () => {
      if (!targetUserId || !profile?.organization_id) return [];
      
      const { data, error } = await supabase
        .from('user_availability')
        .select('*')
        .eq('user_id', targetUserId)
        .eq('organization_id', profile.organization_id)
        .order('day_of_week')
        .order('start_time');

      if (error) throw error;
      return (data || []) as UserAvailability[];
    },
    enabled: !!targetUserId && !!profile?.organization_id,
  });

  const { data: overrides, isLoading: loadingOverrides } = useQuery({
    queryKey: ['availability-overrides', targetUserId, profile?.organization_id],
    queryFn: async () => {
      if (!targetUserId || !profile?.organization_id) return [];
      
      const { data, error } = await supabase
        .from('availability_overrides')
        .select('*')
        .eq('user_id', targetUserId)
        .eq('organization_id', profile.organization_id)
        .gte('date', new Date().toISOString().split('T')[0])
        .order('date');

      if (error) throw error;
      return (data || []) as AvailabilityOverride[];
    },
    enabled: !!targetUserId && !!profile?.organization_id,
  });

  const addTimeSlot = useMutation({
    mutationFn: async ({ day_of_week, start_time, end_time }: { 
      day_of_week: number; 
      start_time: string; 
      end_time: string;
    }) => {
      if (!user?.id || !profile?.organization_id) {
        throw new Error('User not authenticated');
      }

      const { data, error } = await supabase
        .from('user_availability')
        .insert({
          user_id: user.id,
          organization_id: profile.organization_id,
          day_of_week,
          start_time,
          end_time,
          is_available: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data as UserAvailability;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-availability'] });
      toast.success('¡Horario agregado!');
    },
    onError: (error: Error) => {
      console.error('Error adding equipo slot:', error);
      toast.error('Error al agregar horario');
    },
  });

  const removeTimeSlot = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('user_availability')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-availability'] });
      toast.success('¡Horario eliminado!');
    },
    onError: (error: Error) => {
      console.error('Error removing equipo slot:', error);
      toast.error('Error al eliminar horario');
    },
  });

  const updateTimeSlot = useMutation({
    mutationFn: async ({ id, start_time, end_time }: { 
      id: string; 
      start_time: string; 
      end_time: string;
    }) => {
      const { data, error } = await supabase
        .from('user_availability')
        .update({ start_time, end_time })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as UserAvailability;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-availability'] });
      toast.success('¡Horario actualizado!');
    },
    onError: (error: Error) => {
      console.error('Error updating equipo slot:', error);
      toast.error('Error al actualizar horario');
    },
  });

  const addOverride = useMutation({
    mutationFn: async (override: Omit<AvailabilityOverride, 'id' | 'user_id' | 'organization_id' | 'created_at'>) => {
      if (!user?.id || !profile?.organization_id) {
        throw new Error('User not authenticated');
      }

      const { data, error } = await supabase
        .from('availability_overrides')
        .upsert({
          user_id: user.id,
          organization_id: profile.organization_id,
          ...override,
        }, { onConflict: 'user_id,date' })
        .select()
        .single();

      if (error) throw error;
      return data as AvailabilityOverride;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availability-overrides'] });
      toast.success('¡Excepción guardada!');
    },
    onError: (error: Error) => {
      console.error('Error adding override:', error);
      toast.error('Error al guardar excepción');
    },
  });

  const removeOverride = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('availability_overrides')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availability-overrides'] });
      toast.success('¡Excepción eliminada!');
    },
    onError: (error: Error) => {
      console.error('Error removing override:', error);
      toast.error('Error al eliminar excepción');
    },
  });

  // Agrupar slots por día da semana
  const availabilityByDay = (availability || []).reduce((acc, slot) => {
    if (!acc[slot.day_of_week]) {
      acc[slot.day_of_week] = [];
    }
    acc[slot.day_of_week].push(slot);
    return acc;
  }, {} as Record<number, UserAvailability[]>);

  return {
    availability: availability || [],
    availabilityByDay,
    overrides: overrides || [],
    isLoading: loadingAvailability || loadingOverrides,
    addTimeSlot,
    removeTimeSlot,
    updateTimeSlot,
    addOverride,
    removeOverride,
  };
}

// Copiar slots de um día para otro
export function copyDaySlots(
  fromDay: number,
  toDay: number,
  slots: UserAvailability[]
): { day_of_week: number; start_time: string; end_time: string }[] {
  const fromSlots = slots.filter(s => s.day_of_week === fromDay);
  return fromSlots.map(slot => ({
    day_of_week: toDay,
    start_time: slot.start_time,
    end_time: slot.end_time,
  }));
}

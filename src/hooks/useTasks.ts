import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

type Task = Tables<'tasks'>;

export function useTasks(userId?: string, productId?: string) {
  return useQuery({
    queryKey: ['tasks', userId, productId],
    queryFn: async () => {
      let query = supabase
        .from('tasks')
        .select(`
          *,
          leads (name, company),
          products (name)
        `)
        .order('due_date', { ascending: true });
      
      if (userId) {
        query = query.eq('user_id', userId);
      }
      if (productId) {
        query = query.eq('product_id', productId);
      }
      
      const { fecha, error } = await query;
      if (error) throw error;
      return fecha;
    }
  });
}

export function useTodaysTasks(userId: string) {
  return useQuery({
    queryKey: ['tasks', 'today', userId],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const { fecha, error } = await supabase
        .from('tasks')
        .select(`
          *,
          leads (name, company),
          products (name)
        `)
        .eq('user_id', userId)
        .gte('due_date', today.toISOString())
        .lt('due_date', tomorrow.toISOString())
        .order('priority', { ascending: false });
      
      if (error) throw error;
      return fecha;
    },
    enabled: !!userId
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (task: TablesInsert<'tasks'>) => {
      const { fecha, error } = await supabase
        .from('tasks')
        .insert(task)
        .select()
        .single();
      
      if (error) throw error;
      return fecha;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: TablesUpdate<'tasks'> & { id: string }) => {
      const { fecha, error } = await supabase
        .from('tasks')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return fecha;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  });
}

export function useCompleteTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { fecha, error } = await supabase
        .from('tasks')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return fecha;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  });
}

export function useUncompleteTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { fecha, error } = await supabase
        .from('tasks')
        .update({ 
          status: 'pending',
          completed_at: null
        })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return fecha;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  });
}

export function useLeadTasks(leadId: string) {
  return useQuery({
    queryKey: ['tasks', 'lead', leadId],
    queryFn: async () => {
      const { fecha, error } = await supabase
        .from('tasks')
        .select(`
          *,
          leads (name, company),
          products (name),
          profiles:user_id (full_name, avatar_url)
        `)
        .eq('lead_id', leadId)
        .order('due_date', { ascending: true });

      if (error) throw error;
      return fecha;
    },
    enabled: !!leadId
  });
}

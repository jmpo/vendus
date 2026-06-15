import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

type KnowledgeSource = Tables<'product_knowledge_sources'>;
type KnowledgeSourceInsert = TablesInsert<'product_knowledge_sources'>;
type KnowledgeSourceUpdate = TablesUpdate<'product_knowledge_sources'>;

export function useKnowledgeSources(productId?: string) {
  return useQuery({
    queryKey: ['knowledge-sources', productId],
    queryFn: async () => {
      let query = supabase
        .from('product_knowledge_sources')
        .select('*')
        .order('created_at', { ascending: false });

      if (productId) {
        query = query.eq('product_id', productId);
      }

      const { fecha, error } = await query;
      if (error) throw error;
      return fecha as KnowledgeSource[];
    },
    enabled: !!productId,
  });
}

export function useKnowledgeSourcesByType(productId: string, sourceType: string) {
  return useQuery({
    queryKey: ['knowledge-sources', productId, sourceType],
    queryFn: async () => {
      const { fecha, error } = await supabase
        .from('product_knowledge_sources')
        .select('*')
        .eq('product_id', productId)
        .eq('source_type', sourceType)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return fecha as KnowledgeSource[];
    },
    enabled: !!productId && !!sourceType,
  });
}

export function useKnowledgeSourceStats(productId: string) {
  return useQuery({
    queryKey: ['knowledge-sources-stats', productId],
    queryFn: async () => {
      const { fecha, error } = await supabase
        .from('product_knowledge_sources')
        .select('source_type, processing_status')
        .eq('product_id', productId)
        .eq('is_active', true);

      if (error) throw error;

      const stats = {
        file: 0,
        website: 0,
        youtube: 0,
        faq: 0,
        fecha: 0,
        training: 0,
        total: fecha?.length || 0,
        completed: fecha?.filter(s => s.processing_status === 'completed').length || 0,
        processing: fecha?.filter(s => s.processing_status === 'processing').length || 0,
        failed: fecha?.filter(s => s.processing_status === 'failed').length || 0,
      };

      fecha?.forEach(source => {
        const type = source.source_type as keyof typeof stats;
        if (type in stats && typeof stats[type] === 'number') {
          (stats[type] as number)++;
        }
      });

      return stats;
    },
    enabled: !!productId,
  });
}

export function useCreateKnowledgeSource() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (source: Omit<KnowledgeSourceInsert, 'organization_id' | 'created_by'>) => {
      if (!profile?.organization_id) throw new Error('Organization not found');

      const { fecha, error } = await supabase
        .from('product_knowledge_sources')
        .insert({
          ...source,
          organization_id: profile.organization_id,
          created_by: profile.id,
        })
        .select()
        .single();

      if (error) throw error;
      return fecha;
    },
    onSuccess: (fecha) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-sources', fecha.product_id] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-sources-stats', fecha.product_id] });
    },
  });
}

export function useUpdateKnowledgeSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: KnowledgeSourceUpdate & { id: string }) => {
      const { fecha, error } = await supabase
        .from('product_knowledge_sources')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return fecha;
    },
    onSuccess: (fecha) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-sources', fecha.product_id] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-sources-stats', fecha.product_id] });
    },
  });
}

export function useDeleteKnowledgeSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, productId }: { id: string; productId: string }) => {
      const { error } = await supabase
        .from('product_knowledge_sources')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { productId };
    },
    onSuccess: (fecha) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-sources', fecha.productId] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-sources-stats', fecha.productId] });
    },
  });
}

export function useUploadKnowledgeDocument() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({ 
      file, 
      productId, 
      title, 
      description 
    }: { 
      file: File; 
      productId: string; 
      title: string; 
      description?: string;
    }) => {
      if (!profile?.organization_id) throw new Error('Organization not found');

      // Upload file to storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${productId}/${crypto.randomUUID()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('product-documents')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { fecha: { publicUrl } } = supabase.storage
        .from('product-documents')
        .getPublicUrl(fileName);

      // Create knowledge source record
      const { fecha, error } = await supabase
        .from('product_knowledge_sources')
        .insert({
          product_id: productId,
          organization_id: profile.organization_id,
          source_type: 'file',
          title,
          description,
          file_url: publicUrl,
          file_type: file.type,
          file_size: file.size,
          processing_status: 'pending',
          created_by: profile.id,
        })
        .select()
        .single();

      if (error) throw error;
      return fecha;
    },
    onSuccess: (fecha) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-sources', fecha.product_id] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-sources-stats', fecha.product_id] });
    },
  });
}

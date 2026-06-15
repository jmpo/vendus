import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type HelpCategory = Tables<'help_categories'>;
export type HelpArticle = Tables<'help_articles'>;

export function useHelpCategories(includeInactive = false) {
  return useQuery({
    queryKey: ['help-categories', includeInactive],
    queryFn: async () => {
      let q = supabase.from('help_categories').select('*').order('display_order');
      if (!includeInactive) q = q.eq('is_active', true);
      const { fecha, error } = await q;
      if (error) throw error;
      return fecha as HelpCategory[];
    },
  });
}

export function useHelpArticles(opts?: { categoryId?: string; published?: boolean; search?: string }) {
  return useQuery({
    queryKey: ['help-articles', opts],
    queryFn: async () => {
      let q = supabase.from('help_articles').select('*, help_categories(name, slug, icon, color)').order('display_order').order('published_at', { ascending: false });
      if (opts?.published !== undefined) q = q.eq('is_published', opts.published);
      if (opts?.categoryId) q = q.eq('category_id', opts.categoryId);
      if (opts?.search) q = q.or(`title.ilike.%${opts.search}%,summary.ilike.%${opts.search}%,content_html.ilike.%${opts.search}%`);
      const { fecha, error } = await q;
      if (error) throw error;
      return fecha as any[];
    },
  });
}

export function useHelpArticle(slug: string | undefined) {
  return useQuery({
    queryKey: ['help-article', slug],
    queryFn: async () => {
      if (!slug) return null;
      const { fecha, error } = await supabase
        .from('help_articles')
        .select('*, help_categories(name, slug, icon, color)')
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw error;
      // increment view count fire-and-forget
      if (fecha) {
        supabase.from('help_articles').update({ view_count: (fecha.view_count || 0) + 1 }).eq('id', fecha.id).then(() => {});
      }
      return fecha as any;
    },
    enabled: !!slug,
  });
}

export function useUpsertHelpArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (article: TablesInsert<'help_articles'> & { id?: string }) => {
      if (article.id) {
        const { id, ...updates } = article;
        const { fecha, error } = await supabase.from('help_articles').update(updates as TablesUpdate<'help_articles'>).eq('id', id).select().single();
        if (error) throw error;
        return fecha;
      }
      const { fecha, error } = await supabase.from('help_articles').insert(article).select().single();
      if (error) throw error;
      return fecha;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['help-articles'] }),
  });
}

export function useDeleteHelpArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('help_articles').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['help-articles'] }),
  });
}

export function useUpsertHelpCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cat: TablesInsert<'help_categories'> & { id?: string }) => {
      if (cat.id) {
        const { id, ...updates } = cat;
        const { fecha, error } = await supabase.from('help_categories').update(updates as TablesUpdate<'help_categories'>).eq('id', id).select().single();
        if (error) throw error;
        return fecha;
      }
      const { fecha, error } = await supabase.from('help_categories').insert(cat).select().single();
      if (error) throw error;
      return fecha;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['help-categories'] }),
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export type ConversionTriggerType = 'stage' | 'tag';
export type ConversionEventName =
  | 'LeadSubmitted' | 'Purchase' | 'AddToCart' | 'InitiateCheckout' | 'ViewContent';
export type ConversionValueSource = 'none' | 'deal_value' | 'fixed';

export interface ConversionRule {
  id: string;
  organization_id: string;
  product_id: string | null;
  trigger_type: ConversionTriggerType;
  stage_id: string | null;
  tag_id: string | null;
  event_name: ConversionEventName;
  value_source: ConversionValueSource;
  fixed_value: number | null;
  is_active: boolean;
  created_at: string;
}

export interface NewConversionRule {
  product_id: string | null;
  trigger_type: ConversionTriggerType;
  stage_id: string | null;
  tag_id: string | null;
  event_name: ConversionEventName;
  value_source: ConversionValueSource;
  fixed_value: number | null;
}

export const CONVERSION_EVENTS: { value: ConversionEventName; label: string }[] = [
  { value: 'LeadSubmitted', label: 'Lead enviado (LeadSubmitted)' },
  { value: 'ViewContent', label: 'Vio contenido (ViewContent)' },
  { value: 'AddToCart', label: 'Interés / agregó al carrito (AddToCart)' },
  { value: 'InitiateCheckout', label: 'Inició checkout / agendó (InitiateCheckout)' },
  { value: 'Purchase', label: 'Compra (Purchase)' },
];

export function useConversionRules() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const orgId = profile?.organization_id;

  const rules = useQuery({
    queryKey: ['conversion-rules', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<ConversionRule[]> => {
      const { data, error } = await supabase
        .from('conversion_event_rules')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConversionRule[];
    },
  });

  const create = useMutation({
    mutationFn: async (rule: NewConversionRule) => {
      const { error } = await supabase.from('conversion_event_rules').insert({
        organization_id: orgId!,
        ...rule,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversion-rules', orgId] });
      toast.success('Regla de conversión creada');
    },
    onError: (e: any) => toast.error('Error al crear la regla', { description: e.message }),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...rule }: NewConversionRule & { id: string }) => {
      const { error } = await supabase.from('conversion_event_rules').update(rule).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversion-rules', orgId] });
      toast.success('Regla actualizada');
    },
    onError: (e: any) => toast.error('Error al actualizar la regla', { description: e.message }),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('conversion_event_rules').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversion-rules', orgId] }),
    onError: (e: any) => toast.error('Error al actualizar', { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('conversion_event_rules').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversion-rules', orgId] });
      toast.success('Regla eliminada');
    },
    onError: (e: any) => toast.error('Error al eliminar', { description: e.message }),
  });

  return { rules, create, update, toggle, remove };
}

import { useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Loader2, Plus, Rocket, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { LEAD_ORIGINS, LEAD_CHANNELS } from '@/hooks/useLeadTracking';
import { useContextLibrary } from '@/hooks/useCampaignContexts';
import { useAuth } from '@/hooks/useAuth';
import { useLeadTags } from '@/hooks/useLeadTags';
import { useCustomFields, type CustomField } from '@/hooks/useCustomFields';
import { TagFormDialog } from '@/components/admin/tags/TagFormDialog';
import { CadencePicker } from '@/components/admin/cadences/CadencePicker';
import { type VariableMapping } from '@/components/admin/meta/TemplatePicker';
import { MultiTemplatePicker, type CampaignMetaTemplateConfig } from '@/components/admin/meta/MultiTemplatePicker';
import { ZernioCampaignTemplatePicker } from './ZernioCampaignTemplatePicker';

function normalizeMetaTemplateConfig(raw: any): CampaignMetaTemplateConfig {
  if (!raw || typeof raw !== 'object') {
    return { templates: [], strategy: 'random', button_actions: {} };
  }
  // Legado: { template_id, variable_mapping }
  if (raw.template_id && !Array.isArray(raw.templates)) {
    return {
      templates: [{ template_id: raw.template_id, variable_mapping: raw.variable_mapping ?? {} }],
      strategy: 'random',
      button_actions: raw.button_actions ?? {},
    };
  }
  return {
    templates: Array.isArray(raw.templates) ? raw.templates : [],
    strategy: 'random',
    button_actions: raw.button_actions ?? {},
  };
}


type CustomFieldFilter = { key: string; op: string; value: any };

type Filters = {
  lead_ids?: string[];
  origins?: string[];
  channels?: string[];
  stage_ids?: string[];
  tag_ids?: string[];
  assigned_to?: string[];
  temperature?: string[];
  custom_fields?: CustomFieldFilter[];
  search?: { name?: string; email?: string; phone?: string };
  created_after?: string;
  created_before?: string;
};

const SPEED_PRESETS = [
  { value: 'safe', label: '🐢 Seguro', desc: '2 a 5 minutos entre envios' },
  { value: 'recommended', label: '🟢 Recomendado', desc: '1 a 3 minutos entre envios' },
  { value: 'fast', label: '🚀 Rápido', desc: '30 segundos a 2 minutos' },
  { value: 'aggressive', label: '⚠️ Agressivo', desc: '10 a 45 segundos' },
];

const FULL_OPERATORS = [
  { value: 'eq', label: 'Igual a' },
  { value: 'neq', label: 'Diferente de' },
  { value: 'contains', label: 'Contém' },
  { value: 'gt', label: 'Maior que (>)' },
  { value: 'gte', label: 'Maior ou igual (≥)' },
  { value: 'lt', label: 'Menor que (<)' },
  { value: 'lte', label: 'Menor ou igual (≤)' },
  { value: 'between', label: 'Entre' },
  { value: 'is_empty', label: 'Está vazio' },
  { value: 'is_filled', label: 'Está preenchido' },
];

const OPERATORS_BY_TYPE: Record<string, { value: string; label: string }[]> = {
  text: FULL_OPERATORS,
  number: FULL_OPERATORS,
  date: [
    { value: 'eq', label: 'Igual a' },
    { value: 'neq', label: 'Diferente de' },
    { value: 'gt', label: 'Depois de' },
    { value: 'gte', label: 'A partir de' },
    { value: 'lt', label: 'Antes de' },
    { value: 'lte', label: 'Até' },
    { value: 'between', label: 'Entre' },
    { value: 'is_empty', label: 'Está vazio' },
    { value: 'is_filled', label: 'Está preenchido' },
  ],
  select: FULL_OPERATORS,
  boolean: [
    { value: 'eq', label: 'Igual a' },
    { value: 'neq', label: 'Diferente de' },
    { value: 'is_empty', label: 'Está vazio' },
    { value: 'is_filled', label: 'Está preenchido' },
  ],
};

// Considera uma instância pronta para envio respeitando o vocabulário de cada provedor:
// Evolution usa 'connected'; Meta WhatsApp Cloud usa 'active'.
function isInstanceReady(i: { connection_type?: string; status?: string }) {
  if (!i) return false;
  if (i.connection_type === 'meta_whatsapp' || i.connection_type === 'zernio') return i.status === 'active';
  return i.status === 'connected';
}


export function CampaignWizard({
  orgId,
  campaignId,
  onClose,
}: {
  orgId: string | null;
  campaignId: string | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(!!campaignId);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const { contexts: libraryContexts } = useContextLibrary(orgId);
  const { user, isAdmin, isManager } = useAuth();
  // Vendedor → el selector manual y los envíos se limitan a sus leads asignados.
  const restrictAssignedTo = (isAdmin() || isManager()) ? null : (user?.id ?? null);
  const { data: tags = [] } = useLeadTags();
  const { fields: customFields = [] } = useCustomFields();

  const [agents, setAgents] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [productId, setProductId] = useState<string>('');
  const [stages, setStages] = useState<any[]>([]);
  const [instances, setInstances] = useState<any[]>([]);
  const [preview, setPreview] = useState<{ total: number; will: number; excluded: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  // Modo de destinatarios: por filtros (segmentación) o contactos elegidos a mano.
  const [recipientMode, setRecipientMode] = useState<'filters' | 'manual'>('filters');

  const [form, setForm] = useState({
    name: '',
    description: '',
    status: 'draft',
    agent_id: '',
    audience_filters: {} as Filters,
    exclusion_filters: {} as Filters,
    contexts: [] as Array<{ context_id?: string; inline_text?: string; weight: number }>,
    inline_context: '',
    context_distribution: 'random',
    instance_strategy: 'all',
    instance_distribution: [] as Array<{ instance_id: string; connection_type: 'evolution' | 'meta_whatsapp' | 'zernio'; weight: number }>,
    speed_preset: 'recommended',
    schedule_type: 'now',
    scheduled_at: '',
    recurrence: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
    post_response_actions: {
      stop: true,
      take_over: false,
      stage_id: '',
      temperature: '',
      note: '',
      tags_add: [] as string[],
      tags_remove: [] as string[],
    },
    post_cadence_id: null as string | null,
    meta_template_config: { templates: [], strategy: 'random', button_actions: {} } as CampaignMetaTemplateConfig,
  });

  // Si la campaña cargada ya tiene contactos elegidos a mano, abrir en modo manual.
  useEffect(() => {
    if ((form.audience_filters?.lead_ids?.length ?? 0) > 0) setRecipientMode('manual');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.audience_filters?.lead_ids]);

  // ¿Todas las conexiones elegidas son API oficial (Meta/Zernio)? → envío inmediato.
  const onlyApiConnections = useMemo(() => {
    const types = form.instance_strategy === 'manual'
      ? form.instance_distribution.map((d) => d.connection_type)
      : instances.filter(isInstanceReady).map((i: any) => i.connection_type);
    return types.length > 0 && types.every((t) => t === 'meta_whatsapp' || t === 'zernio');
  }, [form.instance_strategy, form.instance_distribution, instances]);


  // Carregar dados auxiliares (produtos, agentes, instâncias)
  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const sb = supabase as any;
      const [a, p, evo, meta, zernio] = await Promise.all([
        sb.from('product_agents').select('id, name, product_id, is_active').eq('organization_id', orgId).eq('is_active', true),
        sb.from('products').select('id, name, status').eq('organization_id', orgId).order('name'),
        sb.from('evolution_instances').select('id, name, phone_number, status').eq('organization_id', orgId),
        sb.from('whatsapp_meta_connections').select('id, display_name, phone_number, status').eq('organization_id', orgId),
        sb.from('zernio_connections').select('id, display_name, phone_number, status').eq('organization_id', orgId),
      ]);
      setAgents(a.data ?? []);
      setProducts(p.data ?? []);
      const unified = [
        ...((evo.data ?? []) as any[]).map((i) => ({
          id: i.id,
          name: i.name,
          phone_number: i.phone_number,
          status: i.status,
          connection_type: 'evolution' as const,
        })),
        ...((meta.data ?? []) as any[]).map((i) => ({
          id: i.id,
          name: i.display_name,
          phone_number: i.phone_number,
          status: i.status,
          connection_type: 'meta_whatsapp' as const,
        })),
        ...((zernio.data ?? []) as any[]).map((i) => ({
          id: i.id,
          name: i.display_name,
          phone_number: i.phone_number,
          status: i.status,
          connection_type: 'zernio' as const,
        })),
      ];
      setInstances(unified);
      if ((p.data ?? []).length && !productId) {
        setProductId(p.data[0].id);
      }
    })();
  }, [orgId]);

  // Carregar etapas do produto selecionado
  useEffect(() => {
    if (!productId) { setStages([]); return; }
    (async () => {
      const { data } = await (supabase as any)
        .from('pipeline_stages')
        .select('id, name, order_index, product_id')
        .eq('product_id', productId)
        .order('order_index');
      setStages(data ?? []);
    })();
  }, [productId]);

  // Carregar campanha existente
  useEffect(() => {
    if (!campaignId) return;
    supabase.from('campaigns').select('*').eq('id', campaignId).maybeSingle().then(({ data }) => {
      if (data) {
        setForm({
          name: data.name ?? '',
          description: data.description ?? '',
          status: data.status,
          agent_id: data.agent_id ?? '',
          audience_filters: (data.audience_filters as Filters) ?? {},
          exclusion_filters: (data.exclusion_filters as Filters) ?? {},
          contexts: (data.contexts as any) ?? [],
          inline_context: '',
          context_distribution: data.context_distribution,
          instance_strategy: data.instance_strategy,
          instance_distribution: (data.instance_distribution as any) ?? [],
          speed_preset: data.speed_preset,
          schedule_type: data.schedule_type,
          scheduled_at: data.scheduled_at ?? '',
          recurrence: (data.recurrence as any) ?? { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
          post_response_actions: {
            stop: true,
            take_over: false,
            stage_id: '',
            temperature: '',
            note: '',
            tags_add: (data as any).tags_on_response ?? [],
            tags_remove: [],
            ...((data.post_response_actions as any) ?? {}),
          },
          post_cadence_id: (data as any).post_cadence_id ?? null,
          meta_template_config: normalizeMetaTemplateConfig((data as any).meta_template_config),
        });

      }
      setLoading(false);
    });
  }, [campaignId]);

  // Preview de público (debounced)
  useEffect(() => {
    if (!orgId) return;
    setPreviewLoading(true);
    const handle = setTimeout(async () => {
      const { data, error } = await supabase.functions.invoke('campaign-preview', {
        body: {
          organization_id: orgId,
          audience_filters: form.audience_filters,
          exclusion_filters: form.exclusion_filters,
        },
      });
      if (!error && data) {
        setPreview({ total: data.total_audience, will: data.will_receive, excluded: data.excluded });
      }
      setPreviewLoading(false);
    }, 600);
    return () => clearTimeout(handle);
  }, [orgId, form.audience_filters, form.exclusion_filters]);

  const toggleArr = <K extends keyof Filters>(group: 'audience_filters' | 'exclusion_filters', key: K, value: string) => {
    setForm((f) => {
      const arr = (f[group][key] as string[] | undefined) ?? [];
      const next = arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
      return { ...f, [group]: { ...f[group], [key]: next.length ? next : undefined } };
    });
  };

  const setSearchField = (key: 'name' | 'email' | 'phone', value: string) => {
    setForm((f) => ({
      ...f,
      audience_filters: {
        ...f.audience_filters,
        search: { ...(f.audience_filters.search ?? {}), [key]: value || undefined },
      },
    }));
  };

  const setDateField = (key: 'created_after' | 'created_before', value: string) => {
    setForm((f) => ({
      ...f,
      audience_filters: { ...f.audience_filters, [key]: value || undefined },
    }));
  };

  const updateCustomFieldFilters = (
    group: 'audience_filters' | 'exclusion_filters',
    updater: (list: CustomFieldFilter[]) => CustomFieldFilter[],
  ) => {
    setForm((f) => {
      const list = updater(f[group].custom_fields ?? []);
      return { ...f, [group]: { ...f[group], custom_fields: list.length ? list : undefined } };
    });
  };

  const buildPayload = () => {
    if (!orgId) throw new Error('Organización no encontrada');
    const contexts = [...form.contexts];
    if (form.inline_context.trim() && !contexts.some((c) => c.inline_text === form.inline_context)) {
      contexts.push({ inline_text: form.inline_context.trim(), weight: 1 });
    }
    return {
      organization_id: orgId,
      name: form.name,
      description: form.description || null,
      channel: 'whatsapp',
      status: form.status,
      agent_id: form.agent_id || null,
      // Mantemos tags_on_response em sincronia com tags_add (compat com campaign-on-response)
      tags_on_response: form.post_response_actions.tags_add ?? [],
      audience_filters: form.audience_filters,
      exclusion_filters: form.exclusion_filters,
      contexts,
      context_distribution: form.context_distribution,
      instance_strategy: form.instance_strategy,
      instance_distribution: form.instance_distribution,
      speed_preset: form.speed_preset,
      schedule_type: form.schedule_type,
      scheduled_at: form.scheduled_at || null,
      recurrence: form.schedule_type === 'recurring' ? form.recurrence : null,
      post_response_actions: form.post_response_actions,
      post_cadence_id: form.post_cadence_id ?? null,
      // Persiste la config si hay plantillas Meta O una plantilla Zernio (se guarda en .zernio).
      meta_template_config:
        ((form.meta_template_config?.templates?.length ?? 0) > 0 ||
          (form.meta_template_config as any)?.zernio?.zernio_template_name)
          ? form.meta_template_config
          : null,
    };

  };

  const saveDraft = async (): Promise<string | null> => {
    if (!form.name.trim()) { toast.error('El nombre de la campaña es obligatorio'); return null; }
    if (!form.agent_id) { toast.error('Seleccioná un agente'); return null; }
    setSaving(true);
    try {
      const payload = buildPayload();
      const { data, error } = campaignId
        ? await supabase.from('campaigns').update(payload).eq('id', campaignId).select('id').single()
        : await supabase.from('campaigns').insert(payload).select('id').single();
      if (error) { toast.error(error.message); return null; }
      toast.success('Borrador guardado');
      return data?.id ?? null;
    } finally {
      setSaving(false);
    }
  };

  const start = async () => {
    if (!preview?.will) { toast.error('No hay leads en el público para enviar'); return; }
    const ready = instances.filter(isInstanceReady);
    if (!ready.length) { toast.error('No hay ningún número de WhatsApp conectado'); return; }
    const id = await saveDraft();
    if (!id) return;
    setStarting(true);
    const { data, error } = await supabase.functions.invoke('campaign-start', { body: { campaign_id: id } });
    setStarting(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Campaña iniciada · ${data?.scheduled ?? 0} envíos programados`);
    onClose();
  };

  const selectedContexts = useMemo(() => {
    return form.contexts
      .map((c) => c.context_id ? libraryContexts.find((lc) => lc.id === c.context_id) : null)
      .filter(Boolean) as any[];
  }, [form.contexts, libraryContexts]);

  if (loading) {
    return <div className="p-10 text-center text-muted-foreground">Cargando…</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-2 sticky top-0 bg-background/80 backdrop-blur z-10 py-2 -mx-4 px-4 border-b">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="h-4 w-4 mr-2" />Volver
        </Button>
        <h1 className="font-semibold flex-1 truncate">
          {campaignId ? 'Editar campaña' : 'Nueva campaña inteligente'}
        </h1>
        <Button variant="outline" onClick={saveDraft} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Guardar borrador
        </Button>
        <Button onClick={start} disabled={starting || saving}>
          {starting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Rocket className="h-4 w-4 mr-2" />}
          Iniciar campaña
        </Button>
      </div>

      {/* 1. Configuración */}
      <Card>
        <CardHeader><CardTitle className="text-base">1. Configuración</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Nombre de la campaña *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej: Reactivación Live Vendus" />
          </div>
          <div>
            <Label>Descripción</Label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <Label>Producto (define las etapas del pipeline)</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder="Seleccioná un producto" /></SelectTrigger>
              <SelectContent>
                {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 2. Público */}
      <Card>
        <CardHeader><CardTitle className="text-base">2. ¿Quién debe recibir?</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {/* Selector de modo: por filtros (segmento) o contactos elegidos a mano */}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={recipientMode === 'filters' ? 'default' : 'outline'}
              onClick={() => {
                setRecipientMode('filters');
                setForm((f) => ({ ...f, audience_filters: { ...f.audience_filters, lead_ids: undefined } }));
              }}
            >
              Por filtros
            </Button>
            <Button
              type="button"
              size="sm"
              variant={recipientMode === 'manual' ? 'default' : 'outline'}
              onClick={() => setRecipientMode('manual')}
            >
              Elegir contactos
            </Button>
          </div>

          {recipientMode === 'manual' ? (
            <ContactPicker
              orgId={orgId}
              restrictAssignedTo={restrictAssignedTo}
              selected={form.audience_filters.lead_ids ?? []}
              onChange={(ids) => setForm((f) => ({ ...f, audience_filters: { ...f.audience_filters, lead_ids: ids } }))}
            />
          ) : (
            <>
              <FilterBlock
                title="Orígenes"
                options={LEAD_ORIGINS}
                selected={form.audience_filters.origins ?? []}
                onToggle={(v) => toggleArr('audience_filters', 'origins', v)}
              />
              <FilterBlock
                title="Canales"
                options={LEAD_CHANNELS}
                selected={form.audience_filters.channels ?? []}
                onToggle={(v) => toggleArr('audience_filters', 'channels', v)}
              />
              <FilterBlock
                title="Etapas del Pipeline"
                options={stages.map((s) => ({ value: s.id, label: s.name }))}
                selected={form.audience_filters.stage_ids ?? []}
                onToggle={(v) => toggleArr('audience_filters', 'stage_ids', v)}
                emptyHint={productId ? 'Este producto no tiene etapas.' : 'Seleccioná un producto arriba.'}
              />
              <TagFilterBlock
                title="Etiquetas (tiene al menos una)"
                tags={tags}
                selected={form.audience_filters.tag_ids ?? []}
                onToggle={(v) => toggleArr('audience_filters', 'tag_ids', v)}
                onCreateNew={() => setTagDialogOpen(true)}
              />
              <CustomFieldsFilter
                fields={customFields}
                filters={form.audience_filters.custom_fields ?? []}
                onChange={(updater) => updateCustomFieldFilters('audience_filters', updater)}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* 2b. Busca específica */}
      {recipientMode === 'filters' && (
      <Card>
        <CardHeader><CardTitle className="text-base">Buscar leads específicos</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>El nombre contiene</Label>
            <Input
              value={form.audience_filters.search?.name ?? ''}
              onChange={(e) => setSearchField('name', e.target.value)}
              placeholder="Ej: Juan"
            />
          </div>
          <div>
            <Label>El email contiene</Label>
            <Input
              value={form.audience_filters.search?.email ?? ''}
              onChange={(e) => setSearchField('email', e.target.value)}
              placeholder="Ej: @gmail.com"
            />
          </div>
          <div>
            <Label>El teléfono contiene</Label>
            <Input
              value={form.audience_filters.search?.phone ?? ''}
              onChange={(e) => setSearchField('phone', e.target.value)}
              placeholder="Ej: 595"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Inscrito desde</Label>
              <Input
                type="date"
                value={form.audience_filters.created_after?.slice(0, 10) ?? ''}
                onChange={(e) => setDateField('created_after', e.target.value)}
              />
            </div>
            <div>
              <Label>Hasta</Label>
              <Input
                type="date"
                value={form.audience_filters.created_before?.slice(0, 10) ?? ''}
                onChange={(e) => setDateField('created_before', e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* 3. Exclusiones */}
      <Card className="border-destructive/30">
        <CardHeader><CardTitle className="text-base">3. ¿Quién NO debe recibir?</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <TagFilterBlock
            title="Sin las etiquetas"
            tags={tags}
            selected={form.exclusion_filters.tag_ids ?? []}
            onToggle={(v) => toggleArr('exclusion_filters', 'tag_ids', v)}
            onCreateNew={() => setTagDialogOpen(true)}
            destructive
          />
          <FilterBlock
            title="Sin orígenes"
            options={LEAD_ORIGINS}
            selected={form.exclusion_filters.origins ?? []}
            onToggle={(v) => toggleArr('exclusion_filters', 'origins', v)}
            destructive
          />
          <FilterBlock
            title="Sin canales"
            options={LEAD_CHANNELS}
            selected={form.exclusion_filters.channels ?? []}
            onToggle={(v) => toggleArr('exclusion_filters', 'channels', v)}
            destructive
          />
          <CustomFieldsFilter
            fields={customFields}
            filters={form.exclusion_filters.custom_fields ?? []}
            onChange={(updater) => updateCustomFieldFilters('exclusion_filters', updater)}
            destructive
          />
        </CardContent>
      </Card>

      {/* Resumen público */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-4 flex flex-wrap items-center gap-6 text-sm">
          {previewLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          <div><span className="text-muted-foreground">Encontrados:</span> <strong>{preview?.total ?? '—'}</strong></div>
          <div><span className="text-muted-foreground">Recibirán:</span> <strong className="text-primary text-lg">{preview?.will ?? '—'}</strong></div>
          <div><span className="text-muted-foreground">Excluidos:</span> <strong>{preview?.excluded ?? 0}</strong></div>
        </CardContent>
      </Card>

      {/* 4. Agente y Contexto */}
      <Card>
        <CardHeader><CardTitle className="text-base">4. Agente IA y Contexto</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Agente *</Label>
            <Select value={form.agent_id} onValueChange={(v) => setForm({ ...form, agent_id: v })}>
              <SelectTrigger><SelectValue placeholder="Seleccioná un agente" /></SelectTrigger>
              <SelectContent>
                {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Contexto inline (opcional)</Label>
            <Textarea
              rows={5}
              value={form.inline_context}
              onChange={(e) => setForm({ ...form, inline_context: e.target.value })}
              placeholder="Ej: Este lead participó de la clase en vivo. Descubrí cuál fue su principal objeción. No envíes propuesta de inmediato."
            />
          </div>

          {!!libraryContexts.length && (
            <div>
              <Label>O elegí contextos de la biblioteca</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {libraryContexts.map((c) => {
                  const sel = form.contexts.some((x) => x.context_id === c.id);
                  return (
                    <Badge
                      key={c.id}
                      variant={sel ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => setForm((f) => ({
                        ...f,
                        contexts: sel
                          ? f.contexts.filter((x) => x.context_id !== c.id)
                          : [...f.contexts, { context_id: c.id, weight: 1 }],
                      }))}
                    >{c.name}</Badge>
                  );
                })}
              </div>
            </div>
          )}

          {(selectedContexts.length > 0 || form.contexts.length > 1) && (
            <div>
              <Label>Distribución entre contextos</Label>
              <RadioGroup value={form.context_distribution} onValueChange={(v) => setForm({ ...form, context_distribution: v })} className="flex gap-4 mt-1">
                <label className="flex items-center gap-2"><RadioGroupItem value="random" />Aleatorio</label>
                <label className="flex items-center gap-2"><RadioGroupItem value="sequential" />Secuencial</label>
                <label className="flex items-center gap-2"><RadioGroupItem value="weighted" />Por peso</label>
              </RadioGroup>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5. Números */}
      <Card>
        <CardHeader><CardTitle className="text-base">5. Números de envío</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <RadioGroup value={form.instance_strategy} onValueChange={(v) => setForm({ ...form, instance_strategy: v })} className="flex gap-4">
            <label className="flex items-center gap-2"><RadioGroupItem value="all" />Todos los conectados</label>
            <label className="flex items-center gap-2"><RadioGroupItem value="rotation" />Rotación automática</label>
            <label className="flex items-center gap-2"><RadioGroupItem value="manual" />Elección manual</label>
          </RadioGroup>

          <div className="grid gap-2">
            {instances.filter(isInstanceReady).map((i) => {
              const isManual = form.instance_strategy === 'manual';
              const sel = form.instance_distribution.some((x) => x.instance_id === i.id);
              const typeLabel = i.connection_type === 'meta_whatsapp' ? 'API Oficial' : i.connection_type === 'zernio' ? 'Zernio' : 'Evolution';
              return (
                <div key={i.id} className="flex items-center gap-3 p-2 border rounded">
                  {isManual && (
                    <Checkbox
                      checked={sel}
                      onCheckedChange={(c) => setForm((f) => ({
                        ...f,
                        instance_distribution: c
                          ? [...f.instance_distribution, { instance_id: i.id, connection_type: i.connection_type, weight: 1 }]
                          : f.instance_distribution.filter((x) => x.instance_id !== i.id),
                      }))}
                    />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{i.name}</p>
                    <p className="text-xs text-muted-foreground">{i.phone_number ?? '—'}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{typeLabel}</Badge>
                  <Badge variant="default">{i.status}</Badge>
                </div>
              );
            })}
            {!instances.filter(isInstanceReady).length && (
              <p className="text-xs text-muted-foreground">No hay ningún número de WhatsApp activo. Conectá una instancia Evolution o activá una conexión Meta API Oficial.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 5b. Template HSM (Meta API Oficial) */}
      {instances.some((i) => i.connection_type === 'meta_whatsapp' && isInstanceReady(i)) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">5b. Template HSM (API Oficial Meta)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Para enviar por la conexión Meta API Oficial en un primer contacto (fuera de la ventana de 24 h), seleccioná un template aprobado. La IA completa las variables con los datos del lead.
            </p>
            <MultiTemplatePicker
              organizationId={orgId}
              connectionIds={instances.filter((i) => i.connection_type === 'meta_whatsapp').map((i) => i.id)}
              value={form.meta_template_config}
              onChange={(v) => setForm({ ...form, meta_template_config: v })}
            />
          </CardContent>
        </Card>
      )}

      {/* 5c. Plantilla Zernio (WhatsApp Oficial vía Zernio) */}
      {(() => {
        const zConns = instances.filter((i) => i.connection_type === 'zernio' && isInstanceReady(i));
        const selectedZ = form.instance_distribution.find((x) => x.connection_type === 'zernio');
        const zConnId = selectedZ?.instance_id ?? zConns[0]?.id;
        if (zConns.length === 0 || !zConnId) return null;
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">5c. Plantilla (WhatsApp Oficial vía Zernio)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Para un primer contacto por Zernio (fuera de la ventana de 24 h) se requiere una plantilla aprobada. Elegí una:
              </p>
              <ZernioCampaignTemplatePicker
                organizationId={orgId}
                connectionId={zConnId}
                value={(form.meta_template_config as any)?.zernio ?? null}
                onChange={(v) => setForm({ ...form, meta_template_config: { ...form.meta_template_config, zernio: v } as any })}
              />
            </CardContent>
          </Card>
        );
      })()}

      {/* 6. Velocidade */}

      <Card>
        <CardHeader><CardTitle className="text-base">6. Velocidad</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {onlyApiConnections && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400">
              <strong>Envío inmediato (API oficial).</strong> Con plantilla aprobada de Meta/Zernio no hay riesgo de baneo,
              así que los mensajes salen de una. El retardo entre envíos solo aplica a WhatsApp por QR (Evolution).
            </div>
          )}
          <RadioGroup
            value={form.speed_preset}
            onValueChange={(v) => setForm({ ...form, speed_preset: v })}
            className={`grid grid-cols-2 md:grid-cols-4 gap-2 ${onlyApiConnections ? 'opacity-50 pointer-events-none' : ''}`}
          >
            {SPEED_PRESETS.map((p) => (
              <label key={p.value} className={`p-3 border rounded cursor-pointer ${form.speed_preset === p.value ? 'border-primary bg-primary/5' : ''}`}>
                <div className="flex items-center gap-2 mb-1">
                  <RadioGroupItem value={p.value} />
                  <span className="font-medium text-sm">{p.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{p.desc}</p>
              </label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {/* 7. Agenda */}
      <Card>
        <CardHeader><CardTitle className="text-base">7. ¿Cuándo enviar?</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <RadioGroup value={form.schedule_type} onValueChange={(v) => setForm({ ...form, schedule_type: v })} className="flex gap-4">
            <label className="flex items-center gap-2"><RadioGroupItem value="now" />Enviar ahora</label>
            <label className="flex items-center gap-2"><RadioGroupItem value="scheduled" />Agendar</label>
            <label className="flex items-center gap-2"><RadioGroupItem value="recurring" />Recurrente</label>
          </RadioGroup>
          {form.schedule_type === 'scheduled' && (
            <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
          )}
          {form.schedule_type === 'recurring' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Inicio</Label>
                <Input type="time" value={form.recurrence.start} onChange={(e) => setForm({ ...form, recurrence: { ...form.recurrence, start: e.target.value } })} />
              </div>
              <div>
                <Label>Fin</Label>
                <Input type="time" value={form.recurrence.end} onChange={(e) => setForm({ ...form, recurrence: { ...form.recurrence, end: e.target.value } })} />
              </div>
              <div className="col-span-2">
                <Label>Días de la semana</Label>
                <div className="flex gap-1 flex-wrap mt-1">
                  {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((d, idx) => {
                    const sel = form.recurrence.days?.includes(idx);
                    return (
                      <Badge
                        key={idx}
                        variant={sel ? 'default' : 'outline'}
                        className="cursor-pointer"
                        onClick={() => setForm((f) => {
                          const days = f.recurrence.days ?? [];
                          return {
                            ...f,
                            recurrence: {
                              ...f.recurrence,
                              days: days.includes(idx) ? days.filter((x: number) => x !== idx) : [...days, idx],
                            },
                          };
                        })}
                      >{d}</Badge>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 8. Post-respuesta */}
      <Card>
        <CardHeader><CardTitle className="text-base">8. Cuando el lead responda…</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={form.post_response_actions.stop}
              onCheckedChange={(c) => setForm({ ...form, post_response_actions: { ...form.post_response_actions, stop: !!c } })}
            />
            Detener la campaña para este lead
          </label>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={form.post_response_actions.take_over}
              onCheckedChange={(c) => setForm({ ...form, post_response_actions: { ...form.post_response_actions, take_over: !!c } })}
            />
            Asumir la conversación automáticamente (humano)
          </label>
          <Separator />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Mover a la etapa</Label>
              <Select
                value={form.post_response_actions.stage_id || 'none'}
                onValueChange={(v) => setForm({ ...form, post_response_actions: { ...form.post_response_actions, stage_id: v === 'none' ? '' : v } })}
              >
                <SelectTrigger><SelectValue placeholder="Mantener etapa actual" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Mantener actual</SelectItem>
                  {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Definir temperatura</Label>
              <Select
                value={form.post_response_actions.temperature || 'none'}
                onValueChange={(v) => setForm({ ...form, post_response_actions: { ...form.post_response_actions, temperature: v === 'none' ? '' : v } })}
              >
                <SelectTrigger><SelectValue placeholder="Mantener" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Mantener</SelectItem>
                  <SelectItem value="cold">Frío</SelectItem>
                  <SelectItem value="warm">Tibio</SelectItem>
                  <SelectItem value="hot">Caliente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Separator />
          <div>
            <Label>Etiquetas aplicadas al responder</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {tags.map((t) => {
                const sel = form.post_response_actions.tags_add?.includes(t.id);
                return (
                  <Badge
                    key={t.id}
                    variant={sel ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => setForm((f) => ({
                      ...f,
                      post_response_actions: {
                        ...f.post_response_actions,
                        tags_add: sel
                          ? (f.post_response_actions.tags_add ?? []).filter((x: string) => x !== t.id)
                          : [...(f.post_response_actions.tags_add ?? []), t.id],
                      },
                    }))}
                  >{t.name}</Badge>
                );
              })}
              <Badge variant="outline" className="cursor-pointer border-dashed" onClick={() => setTagDialogOpen(true)}>
                <Plus className="h-3 w-3 mr-1" />Nueva etiqueta
              </Badge>
            </div>
          </div>
          <div>
            <Label>Quitar etiquetas al responder</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {tags.map((t) => {
                const sel = form.post_response_actions.tags_remove?.includes(t.id);
                return (
                  <Badge
                    key={t.id}
                    variant={sel ? 'destructive' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => setForm((f) => ({
                      ...f,
                      post_response_actions: {
                        ...f.post_response_actions,
                        tags_remove: sel
                          ? (f.post_response_actions.tags_remove ?? []).filter((x: string) => x !== t.id)
                          : [...(f.post_response_actions.tags_remove ?? []), t.id],
                      },
                    }))}
                  >{t.name}</Badge>
                );
              })}
            </div>
          </div>
          <div>
            <Label>Nota automática en el lead (opcional)</Label>
            <Textarea
              rows={2}
              value={form.post_response_actions.note ?? ''}
              onChange={(e) => setForm({ ...form, post_response_actions: { ...form.post_response_actions, note: e.target.value } })}
              placeholder="Ej: El lead respondió a la campaña de reactivación — verificar contexto."
            />
          </div>
          <Separator />
          <div>
            <Label>Después del envío — inscribir en cadencia</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Cada lead alcanzado por la campaña se inscribe automáticamente en esta cadencia.
            </p>
            <CadencePicker
              value={form.post_cadence_id ?? null}
              onChange={(id) => setForm({ ...form, post_cadence_id: id })}
              placeholder="No inscribir en cadencia"
            />
          </div>
        </CardContent>
      </Card>

      <TagFormDialog open={tagDialogOpen} onOpenChange={setTagDialogOpen} tag={null} />
    </div>
  );
}

function FilterBlock({
  title,
  options,
  selected,
  onToggle,
  destructive,
  emptyHint,
}: {
  title: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (v: string) => void;
  destructive?: boolean;
  emptyHint?: string;
}) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{title}</Label>
      <div className="flex flex-wrap gap-2 mt-1">
        {options.map((o) => {
          const sel = selected.includes(o.value);
          return (
            <Badge
              key={o.value}
              variant={sel ? (destructive ? 'destructive' : 'default') : 'outline'}
              className="cursor-pointer"
              onClick={() => onToggle(o.value)}
            >{o.label}</Badge>
          );
        })}
        {!options.length && <p className="text-xs text-muted-foreground">{emptyHint ?? '—'}</p>}
      </div>
    </div>
  );
}

function TagFilterBlock({
  title,
  tags,
  selected,
  onToggle,
  onCreateNew,
  destructive,
}: {
  title: string;
  tags: any[];
  selected: string[];
  onToggle: (v: string) => void;
  onCreateNew: () => void;
  destructive?: boolean;
}) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{title}</Label>
      <div className="flex flex-wrap gap-2 mt-1">
        {tags.map((t) => {
          const sel = selected.includes(t.id);
          return (
            <Badge
              key={t.id}
              variant={sel ? (destructive ? 'destructive' : 'default') : 'outline'}
              className="cursor-pointer"
              onClick={() => onToggle(t.id)}
            >{t.name}</Badge>
          );
        })}
        <Badge variant="outline" className="cursor-pointer border-dashed" onClick={onCreateNew}>
          <Plus className="h-3 w-3 mr-1" />Nova etiqueta
        </Badge>
      </div>
    </div>
  );
}

function CustomFieldsFilter({
  fields,
  filters,
  onChange,
  destructive,
}: {
  fields: CustomField[];
  filters: CustomFieldFilter[];
  onChange: (updater: (list: CustomFieldFilter[]) => CustomFieldFilter[]) => void;
  destructive?: boolean;
}) {
  const add = () => onChange((list) => [...list, { key: '', op: 'eq', value: '' }]);
  const remove = (i: number) => onChange((list) => list.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<CustomFieldFilter>) =>
    onChange((list) => list.map((f, idx) => idx === i ? { ...f, ...patch } : f));

  return (
    <div>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        Campos personalizados {destructive && '(excluir quando)'}
      </Label>
      <div className="space-y-2 mt-1">
        {filters.map((f, i) => {
          const field = fields.find((cf) => cf.field_key === f.key);
          const operators = OPERATORS_BY_TYPE[field?.field_type ?? 'text'] ?? OPERATORS_BY_TYPE.text;
          const needsValue = !['is_empty', 'is_filled'].includes(f.op);
          const isBetween = f.op === 'between';
          const isSelect = field?.field_type === 'select';
          const isBoolean = field?.field_type === 'boolean';
          const isDate = field?.field_type === 'date';
          const isNumber = field?.field_type === 'number';

          return (
            <div key={i} className="grid grid-cols-12 gap-2 items-end p-2 border rounded">
              <div className="col-span-4">
                <Select value={f.key} onValueChange={(v) => update(i, { key: v, value: '' })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Campo" /></SelectTrigger>
                  <SelectContent>
                    {fields.map((cf) => (
                      <SelectItem key={cf.id} value={cf.field_key}>{cf.name}</SelectItem>
                    ))}
                    {!fields.length && <SelectItem value="__none__" disabled>Ningún campo creado</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3">
                <Select value={f.op} onValueChange={(v) => update(i, { op: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {operators.map((op) => <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-4">
                {needsValue && isSelect && (
                  <Select value={String(f.value ?? '')} onValueChange={(v) => update(i, { value: v })}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Valor" /></SelectTrigger>
                    <SelectContent>
                      {(field?.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {needsValue && isBoolean && (
                  <Select value={String(f.value ?? '')} onValueChange={(v) => update(i, { value: v })}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Valor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Sí</SelectItem>
                      <SelectItem value="false">No</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {needsValue && !isSelect && !isBoolean && !isBetween && (
                  <Input
                    className="h-9"
                    type={isDate ? 'date' : isNumber ? 'number' : 'text'}
                    value={f.value ?? ''}
                    onChange={(e) => update(i, { value: e.target.value })}
                    placeholder="Valor"
                  />
                )}
                {needsValue && isBetween && (
                  <div className="grid grid-cols-2 gap-1">
                    <Input
                      className="h-9"
                      type={isDate ? 'date' : 'number'}
                      value={(f.value?.from ?? '')}
                      onChange={(e) => update(i, { value: { ...(f.value ?? {}), from: e.target.value } })}
                      placeholder="De"
                    />
                    <Input
                      className="h-9"
                      type={isDate ? 'date' : 'number'}
                      value={(f.value?.to ?? '')}
                      onChange={(e) => update(i, { value: { ...(f.value ?? {}), to: e.target.value } })}
                      placeholder="Até"
                    />
                  </div>
                )}
              </div>
              <div className="col-span-1">
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => remove(i)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
        <Button variant="outline" size="sm" onClick={add} disabled={!fields.length}>
          <Plus className="h-3 w-3 mr-1" />
          {fields.length ? 'Agregar filtro por campo' : 'No hay campos personalizados creados'}
        </Button>
      </div>
    </div>
  );
}

// Selector de contactos a mano: lista leads con teléfono, búsqueda + "Seleccionar todos".
function ContactPicker({
  orgId,
  restrictAssignedTo,
  selected,
  onChange,
}: {
  orgId: string | undefined;
  restrictAssignedTo?: string | null;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [leads, setLeads] = useState<Array<{ id: string; name: string | null; phone: string | null }>>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    (async () => {
      let q = supabase
        .from('leads')
        .select('id, name, phone')
        .eq('organization_id', orgId)
        .not('phone', 'is', null);
      // Vendedor: solo sus leads asignados (alineado con la restricción del backend).
      if (restrictAssignedTo) q = q.eq('assigned_to', restrictAssignedTo);
      const { data } = await q.order('created_at', { ascending: false }).limit(1000);
      setLeads((data ?? []) as any[]);
      setLoading(false);
    })();
  }, [orgId, restrictAssignedTo]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) =>
      (l.name ?? '').toLowerCase().includes(q) || (l.phone ?? '').toLowerCase().includes(q),
    );
  }, [leads, search]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((l) => selectedSet.has(l.id));

  const toggle = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(Array.from(next));
  };

  const toggleAllFiltered = () => {
    const next = new Set(selectedSet);
    if (allFilteredSelected) filtered.forEach((l) => next.delete(l.id));
    else filtered.forEach((l) => next.add(l.id));
    onChange(Array.from(next));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o teléfono…"
          className="h-9"
        />
        <Button type="button" variant="outline" size="sm" onClick={toggleAllFiltered} disabled={!filtered.length}>
          {allFilteredSelected ? 'Quitar todos' : 'Seleccionar todos'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{selected.length} contacto(s) seleccionado(s)</p>
      <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
        {loading ? (
          <p className="p-3 text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando contactos…</p>
        ) : filtered.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">{leads.length === 0 ? 'No hay contactos con teléfono.' : 'Sin resultados para la búsqueda.'}</p>
        ) : (
          filtered.map((l) => (
            <label key={l.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 cursor-pointer text-sm">
              <Checkbox checked={selectedSet.has(l.id)} onCheckedChange={() => toggle(l.id)} />
              <span className="flex-1 truncate">{l.name || 'Sin nombre'}</span>
              <span className="text-xs text-muted-foreground">{l.phone}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

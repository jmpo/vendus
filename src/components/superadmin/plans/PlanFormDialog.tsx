import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  PlatformPlan,
  PlatformPlanInput,
  useCreatePlan,
  useUpdatePlan,
} from '@/hooks/usePlatformPlans';
import { usePlatformAIKeys } from '@/hooks/usePlatformAIKeys';


interface PlanFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan?: PlatformPlan | null;
}

const FEATURE_GROUPS: { title: string; items: { key: keyof PlatformPlan; label: string }[] }[] = [
  {
    title: 'Canales',
    items: [
      { key: 'feature_whatsapp', label: 'WhatsApp' },
      { key: 'feature_facebook', label: 'Facebook' },
      { key: 'feature_instagram', label: 'Instagram' },
      { key: 'feature_internal_chat', label: 'Chat interno' },
    ],
  },
  {
    title: 'CRM y Operación',
    items: [
      { key: 'feature_kanban', label: 'Kanban' },
      { key: 'feature_pipeline', label: 'Pipeline' },
      { key: 'feature_scheduling', label: 'Citas' },
      { key: 'feature_campaigns', label: 'Campañas' },
      { key: 'feature_outreach', label: 'Outreach (cadencia)' },
    ],
  },
  {
    title: 'Inteligencia Artificial',
    items: [
      { key: 'feature_ai_agents', label: 'Agentes de IA' },
      { key: 'feature_voice_agents', label: 'Agentes de voz' },
      { key: 'feature_audio_transcription_ai', label: 'Transcripción de audio' },
      { key: 'feature_text_correction_ai', label: 'Corrección de texto con IA' },
    ],
  },
  {
    title: 'Captura',
    items: [
      { key: 'feature_capture_funnels', label: 'Embudos de captura' },
      { key: 'feature_forms', label: 'Formularios' },
    ],
  },
  {
    title: 'Integraciones',
    items: [
      { key: 'feature_external_api', label: 'API externa' },
      { key: 'feature_integrations', label: 'Integraciones nativas' },
      { key: 'feature_webhooks', label: 'Webhooks' },
    ],
  },
];

const emptyPlan: PlatformPlanInput = {
  name: '',
  slug: '',
  description: '',
  is_public: true,
  is_active: true,
  is_default: false,
  display_order: 0,
  price_monthly: 0,
  price_yearly: 0,
  trial_days: 7,
  grace_period_days: 3,
  max_users: 5,
  max_connections: 1,
  max_sectors: 3,
  max_products: 5,
  max_contacts: 1000,
  max_messages_month: 5000,
  max_ai_tokens_month: 100000,
  allow_platform_ai: false,
  included_ai_tokens_month: 0,
  platform_ai_provider: 'lovable',
  platform_ai_strategy: 'random',

  feature_whatsapp: true,
  feature_facebook: false,
  feature_instagram: false,
  feature_campaigns: false,
  feature_scheduling: true,
  feature_internal_chat: true,
  feature_external_api: false,
  feature_kanban: true,
  feature_pipeline: true,
  feature_integrations: false,
  feature_audio_transcription_ai: false,
  feature_text_correction_ai: false,
  feature_ai_agents: false,
  feature_voice_agents: false,
  feature_outreach: false,
  feature_capture_funnels: false,
  feature_forms: true,
  feature_webhooks: false,
  checkout_url: '',
  checkout_url_yearly: '',
  highlight_label: '',
};

interface PlanFormBodyProps {
  plan?: PlatformPlan | null;
  onSaved?: (plan: any) => void;
  onCancel?: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  showCancel?: boolean;
}

export function PlanFormBody({
  plan,
  onSaved,
  onCancel,
  submitLabel,
  cancelLabel = 'Cancelar',
  showCancel = true,
}: PlanFormBodyProps) {
  const [form, setForm] = useState<PlatformPlanInput>(plan ? { ...(plan as any) } : emptyPlan);
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();
  const { fecha: poolKeys = [] } = usePlatformAIKeys();


  useEffect(() => {
    setForm(plan ? { ...(plan as any) } : emptyPlan);
  }, [plan]);

  const set = <K extends keyof PlatformPlanInput>(key: K, value: PlatformPlanInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!form.name?.trim()) {
      toast.error('Ingrese el nombre del plan');
      return;
    }
    if (!form.slug?.trim()) {
      toast.error('Ingrese el slug del plan');
      return;
    }
    try {
      if (plan?.id) {
        await updatePlan.mutateAsync({ id: plan.id, ...form });
        toast.success('Plan actualizado');
      } else {
        await createPlan.mutateAsync(form);
        toast.success('Plan creado');
      }
      onSaved?.(form);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Error al guardar el plan');
    }
  };

  const numberField = (key: keyof PlatformPlanInput, label: string) => (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={0}
        value={(form[key] as number) ?? 0}
        onChange={(e) => set(key, Number(e.target.value) as any)}
      />
    </div>
  );

  return (
    <div>
      <Tabs defaultValue="general" className="mt-2">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="pricing">Precios</TabsTrigger>
          <TabsTrigger value="limits">Límites</TabsTrigger>
          <TabsTrigger value="features">Funcionalidades</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input value={form.name || ''} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Slug *</Label>
              <Input
                value={form.slug || ''}
                onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}
                placeholder="ex: pro"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Descripción</Label>
            <Textarea
              rows={3}
              value={form.description || ''}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Para quién es este plan..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Orden de visualización</Label>
              <Input
                type="number"
                value={form.display_order ?? 0}
                onChange={(e) => set('display_order', Number(e.target.value))}
              />
            </div>
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between">
                <Label className="cursor-pointer">Activo</Label>
                <Switch checked={!!form.is_active} onCheckedChange={(v) => set('is_active', v)} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="cursor-pointer">Público (vitrina)</Label>
                <Switch checked={!!form.is_public} onCheckedChange={(v) => set('is_public', v)} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="cursor-pointer">Plan predeterminado</Label>
                <Switch checked={!!form.is_default} onCheckedChange={(v) => set('is_default', v)} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 pt-2 border-t">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Enlace de contratación — Mensual</Label>
                <Input
                  type="url"
                  value={form.checkout_url || ''}
                  onChange={(e) => set('checkout_url', e.target.value)}
                  placeholder="https://pay.cakto.com.br/..."
                />
                <p className="text-xs text-muted-foreground">
                  Abre cuando o cliente seleciona o plan no ciclo <strong>mensal</strong>.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Enlace de contratación — Anual</Label>
                <Input
                  type="url"
                  value={(form as any).checkout_url_yearly || ''}
                  onChange={(e) => set('checkout_url_yearly' as any, e.target.value as any)}
                  placeholder="https://pay.cakto.com.br/..."
                />
                <p className="text-xs text-muted-foreground">
                  Abre cuando o cliente seleciona o plan no ciclo <strong>anual</strong>.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Etiqueta de destaque (opcional)</Label>
              <Input
                value={form.highlight_label || ''}
                onChange={(e) => set('highlight_label', e.target.value)}
                placeholder='Ej.: "Más Popular"'
                maxLength={30}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="pricing" className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4">
            {numberField('price_monthly', 'Precio mensual (R$)')}
            {numberField('price_yearly', 'Precio anual (R$)')}
            {numberField('trial_days', 'Días de trial')}
            {numberField('grace_period_days', 'Gracia (días)')}
          </div>
        </TabsContent>

        <TabsContent value="limits" className="space-y-4 pt-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {numberField('max_users', 'Usuarios')}
            {numberField('max_connections', 'Conexiones WhatsApp')}
            {numberField('max_sectors', 'Sectores')}
            {numberField('max_products', 'Productos')}
            {numberField('max_contacts', 'Contactos')}
            {numberField('max_messages_month', 'Mensajes/mes')}
          </div>

          <div className="mt-6 p-4 rounded-lg border border-primary/30 bg-primary/5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="font-semibold text-sm">IA de la Plataforma</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Quando <strong>ligado</strong>, as empresas deste plan consomem dos sus tokens Lovable até o limite mensal.
                  Quando <strong>desligado</strong>, cada cliente precisa cadastrar a própria clave (OpenAI/Anthropic/Gemini) em Integraciones.
                </p>
              </div>
              <Switch
                checked={!!form.allow_platform_ai}
                onCheckedChange={(v) => set('allow_platform_ai', v)}
              />
            </div>
            {form.allow_platform_ai && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">Tokens mensuales incluidos</Label>
                    <Input
                      type="number"
                      min={0}
                      value={form.included_ai_tokens_month ?? 0}
                      onChange={(e) => set('included_ai_tokens_month', Number(e.target.value))}
                    />
                    <div className="flex gap-1 flex-wrap">
                      {[100_000, 500_000, 1_000_000, 5_000_000].map((n) => (
                        <Button
                          key={n}
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2"
                          onClick={() => set('included_ai_tokens_month', n)}
                        >
                          {n.toLocaleString( 'es' )}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">Proveedor del pool</Label>
                    <Select
                      value={form.platform_ai_provider ?? 'lovable'}
                      onValueChange={(v) => set('platform_ai_provider', v as any)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(['lovable','openai','anthropic','gemini'] as const).map((p) => {
                          const count = poolKeys.filter((k) => k.provider === p && k.is_active).length;
                          return (
                            <SelectItem key={p} value={p}>
                              <span className="flex items-center gap-2">
                                {p.charAt(0).toUpperCase() + p.slice(1)}
                                <Badge variant={count > 0 ? 'default' : 'destructive'} className="text-[10px] h-4">
                                  {count} clave{count === 1 ? '' : 's'}
                                </Badge>
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {(() => {
                      const p = form.platform_ai_provider ?? 'lovable';
                      const count = poolKeys.filter((k) => k.provider === p && k.is_active).length;
                      if (count === 0) {
                        return (
                          <p className="text-[11px] text-destructive">
                            Nenhuma clave ativa para {p}. Cadastre em Super Admin → IA de la Plataforma.
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Estrategia de distribución</Label>
                    <Select
                      value={form.platform_ai_strategy ?? 'random'}
                      onValueChange={(v) => set('platform_ai_strategy', v as any)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="random">Aleatorio (ponderado por peso)</SelectItem>
                        <SelectItem value="round_robin">Round-robin (menos usada primero)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

          </div>
        </TabsContent>

        <TabsContent value="features" className="space-y-6 pt-4">
          {FEATURE_GROUPS.map((group) => (
            <div key={group.title} className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {group.title}
              </h4>
              <div className="grid grid-cols-2 gap-3">
                {group.items.map((item) => (
                  <div
                    key={String(item.key)}
                    className="flex items-center justify-between p-3 rounded-lg border border-border bg-card"
                  >
                    <Label className="cursor-pointer text-sm">{item.label}</Label>
                    <Switch
                      checked={!!form[item.key]}
                      onCheckedChange={(v) => set(item.key as any, v as any)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2 mt-4">
        {showCancel && onCancel && (
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
        <Button onClick={handleSave} disabled={createPlan.isPending || updatePlan.isPending}>
          {createPlan.isPending || updatePlan.isPending
            ? 'Guardando...'
            : submitLabel ?? (plan ? 'Guardar plan' : 'Crear plan')}
        </Button>
      </div>
    </div>
  );
}

export function PlanFormDialog({ open, onOpenChange, plan }: PlanFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan ? 'Editar plan' : 'Nuevo plan'}</DialogTitle>
          <DialogDescription>
            Defina límites y funcionalidades disponibles para las empresas que se unan a este plan.
          </DialogDescription>
        </DialogHeader>
        <PlanFormBody
          plan={plan}
          onSaved={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

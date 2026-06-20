import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Target, Plus, Trash2, Tag as TagIcon, Route, Pencil, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  useConversionRules, CONVERSION_EVENTS,
  type ConversionTriggerType, type ConversionEventName, type ConversionValueSource,
} from '@/hooks/useConversionRules';

export function ConversionRulesManager() {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;
  const { rules, create, update, toggle, remove } = useConversionRules();

  // Catálogos para los selectores
  const { data: products = [] } = useQuery({
    queryKey: ['cr-products', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from('products').select('id, name').eq('organization_id', orgId!).eq('is_active', true).order('name');
      return data ?? [];
    },
  });
  const { data: stages = [] } = useQuery({
    queryKey: ['cr-stages', orgId, (products as any[]).map((p) => p.id).join(',')],
    enabled: !!orgId && (products as any[]).length > 0,
    queryFn: async () => {
      const ids = (products as any[]).map((p) => p.id);
      const { data } = await supabase.from('pipeline_stages').select('id, name, product_id').in('product_id', ids).order('order_index');
      return data ?? [];
    },
  });
  const { data: tags = [] } = useQuery({
    queryKey: ['cr-tags', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from('lead_tags').select('id, name, color').eq('organization_id', orgId!).order('name');
      return data ?? [];
    },
  });

  const productName = (id: string | null) => id ? ((products as any[]).find((p) => p.id === id)?.name ?? '—') : 'Todos';
  const tagName = (id: string | null) => (tags as any[]).find((t) => t.id === id)?.name ?? '—';
  const eventLabel = (e: string) => CONVERSION_EVENTS.find((x) => x.value === e)?.label ?? e;

  const list = rules.data ?? [];

  // Form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [triggerType, setTriggerType] = useState<ConversionTriggerType>('stage');
  const [productId, setProductId] = useState<string>('all');
  const [selectedStage, setSelectedStage] = useState<string>(''); // nombre de etapa (aplica a todas las líneas)
  const [tagId, setTagId] = useState<string>('');
  const [eventName, setEventName] = useState<ConversionEventName>('Purchase');
  const [valueSource, setValueSource] = useState<ConversionValueSource>('none');
  const [fixedValue, setFixedValue] = useState<string>('');

  // Nombres de etapa ÚNICOS (modelo "etapas estándar compartidas"): una sola "Calificación"
  // que aplica a todas las líneas/productos. Sin duplicados en el dropdown.
  const stageNameOptions = useMemo(
    () => Array.from(new Set((stages as any[]).map((s) => s.name))).sort(),
    [stages],
  );

  // Etapas (por nombre) y etiquetas YA configuradas → no permitir duplicar. Excluye la
  // regla que se está editando, así su propia etapa/etiqueta sigue seleccionable.
  const usedStageNames = useMemo(
    () => new Set(list.filter((r) => r.trigger_type === 'stage' && r.id !== editingId).map((r) => r.stage_name)),
    [list, editingId],
  );
  const usedTagKeys = useMemo(
    () => new Set(list.filter((r) => r.trigger_type === 'tag' && r.id !== editingId).map((r) => `${r.tag_id}|${r.product_id ?? 'all'}`)),
    [list, editingId],
  );

  const resetForm = () => {
    setEditingId(null); setTriggerType('stage'); setProductId('all');
    setSelectedStage(''); setTagId(''); setEventName('Purchase'); setValueSource('none'); setFixedValue('');
  };

  const startEdit = (r: any) => {
    setEditingId(r.id);
    setTriggerType(r.trigger_type);
    setProductId(r.product_id ?? 'all');
    setSelectedStage(r.stage_name ?? '');
    setTagId(r.tag_id ?? '');
    setEventName(r.event_name);
    setValueSource(r.value_source);
    setFixedValue(r.fixed_value != null ? String(r.fixed_value) : '');
  };

  const canSave = triggerType === 'stage' ? !!selectedStage : !!tagId;

  const handleSave = () => {
    if (!canSave) return;
    const payload = {
      // Regla por etapa = por NOMBRE y para TODAS las líneas (product_id null).
      product_id: triggerType === 'stage' ? null : (productId === 'all' ? null : productId),
      trigger_type: triggerType,
      stage_id: null,
      stage_name: triggerType === 'stage' ? selectedStage : null,
      tag_id: triggerType === 'tag' ? tagId : null,
      event_name: eventName,
      value_source: valueSource,
      fixed_value: valueSource === 'fixed' ? Number(fixedValue) || 0 : null,
    };
    if (editingId) {
      update.mutate({ id: editingId, ...payload }, { onSuccess: resetForm });
    } else {
      create.mutate(payload, { onSuccess: () => { setSelectedStage(''); setTagId(''); setFixedValue(''); } });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Target className="h-5 w-5 text-primary" />
          Eventos de conversión (Pixel / Ads)
        </CardTitle>
        <CardDescription>
          Definí qué evento de conversión se envía a Meta/Zernio y cuándo. Cada cliente arma su
          embudo distinto: elegí disparar por <strong>etapa del pipeline</strong> o por <strong>etiqueta</strong>.
          La atribución al anuncio (ctwa_clid) la resuelve Zernio/Meta automáticamente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Form de nueva regla */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Disparar cuando…</Label>
              <Select value={triggerType} onValueChange={(v) => setTriggerType(v as ConversionTriggerType)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stage"><span className="flex items-center gap-2"><Route className="h-3.5 w-3.5" /> El lead entra a una etapa</span></SelectItem>
                  <SelectItem value="tag"><span className="flex items-center gap-2"><TagIcon className="h-3.5 w-3.5" /> Se le pone una etiqueta</span></SelectItem>
                </SelectContent>
              </Select>
            </div>

            {triggerType === 'stage' ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Etapa</Label>
                <Select value={selectedStage} onValueChange={setSelectedStage}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Elegí etapa…" /></SelectTrigger>
                  <SelectContent>
                    {stageNameOptions.map((name) => {
                      const used = usedStageNames.has(name);
                      return (
                        <SelectItem key={name} value={name} disabled={used}>
                          {name}{used ? ' — ya configurada' : ''}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">Aplica a esa etapa en TODAS tus líneas/productos. Las ya configuradas aparecen deshabilitadas (evita duplicar).</p>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Producto</Label>
                  <Select value={productId} onValueChange={setProductId}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los productos</SelectItem>
                      {(products as any[]).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Etiqueta</Label>
                  <Select value={tagId} onValueChange={setTagId}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Elegí etiqueta…" /></SelectTrigger>
                    <SelectContent>
                      {(tags as any[]).map((t) => {
                        const used = usedTagKeys.has(`${t.id}|${productId === 'all' ? 'all' : productId}`);
                        return (
                          <SelectItem key={t.id} value={t.id} disabled={used}>
                            {t.name}{used ? ' — ya configurada' : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Evento a enviar</Label>
              <Select value={eventName} onValueChange={(v) => setEventName(v as ConversionEventName)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONVERSION_EVENTS.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Valor</Label>
              <Select value={valueSource} onValueChange={(v) => setValueSource(v as ConversionValueSource)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin valor</SelectItem>
                  <SelectItem value="deal_value">Valor del negocio (deal)</SelectItem>
                  <SelectItem value="fixed">Valor fijo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {valueSource === 'fixed' && (
              <div className="space-y-1.5">
                <Label className="text-xs">Valor fijo</Label>
                <Input type="number" value={fixedValue} onChange={(e) => setFixedValue(e.target.value)} placeholder="0" className="h-9" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSave} disabled={!canSave || create.isPending || update.isPending}>
              <Plus className="h-4 w-4 mr-1.5" /> {editingId ? 'Guardar cambios' : 'Agregar regla'}
            </Button>
            {editingId && (
              <Button size="sm" variant="ghost" onClick={resetForm}>
                <X className="h-4 w-4 mr-1" /> Cancelar
              </Button>
            )}
          </div>
        </div>

        {/* Lista de reglas */}
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Todavía no hay reglas. Creá una arriba para empezar a trackear conversiones.
          </p>
        ) : (
          <div className="space-y-2">
            {list.map((r) => (
              <div key={r.id} className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${editingId === r.id ? 'border-primary ring-1 ring-primary bg-primary/5' : ''}`}>
                <Badge variant="outline" className="gap-1 shrink-0">
                  {r.trigger_type === 'stage' ? <Route className="h-3 w-3" /> : <TagIcon className="h-3 w-3" />}
                  {r.trigger_type === 'stage' ? r.stage_name : tagName(r.tag_id)}
                </Badge>
                <span className="text-muted-foreground">→</span>
                <Badge className="shrink-0">{eventLabel(r.event_name)}</Badge>
                <span className="text-xs text-muted-foreground truncate">
                  {r.trigger_type === 'stage' ? 'todas las líneas' : productName(r.product_id)}
                  {r.value_source !== 'none' ? ` · valor: ${r.value_source === 'fixed' ? r.fixed_value : 'deal'}` : ''}
                </span>
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  <Switch checked={r.is_active} onCheckedChange={(v) => toggle.mutate({ id: r.id, is_active: v })} />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(r)} title="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => remove.mutate(r.id)} title="Eliminar">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ArrowRight, Plus, Trash2, GripVertical, Rocket, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useContextLibrary } from '@/hooks/useCampaignContexts';

interface Props {
  orgId: string | null;
  cadenceId: string | null;
  onClose: () => void;
}

type StepDraft = {
  id?: string;
  order_index: number;
  name: string;
  objective: string;
  execute_immediately: boolean;
  delay_value: number;
  delay_unit: 'minutes' | 'hours' | 'days';
  delay_from: 'previous_step' | 'enrollment';
  context_id: string | null;
  context_inline: string;
  tone: string;
  conditions: {
    only_if_no_response?: boolean;
    only_if_no_purchase?: boolean;
    only_if_not_human?: boolean;
  };
};

const OBJECTIVES = ['Post Live', 'Recuperación', 'Abandono de Checkout', 'Reactivación', 'Post Compra', 'Renovación', 'Personalizado'];
const WEEK_DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Lun' }, { key: 'tue', label: 'Mar' }, { key: 'wed', label: 'Mié' },
  { key: 'thu', label: 'Jue' }, { key: 'fri', label: 'Vie' }, { key: 'sat', label: 'Sáb' }, { key: 'sun', label: 'Dom' },
];
const STOP_OPTIONS: { key: string; label: string }[] = [
  { key: 'responded', label: 'Lead respondió' },
  { key: 'purchased', label: 'Compra realizada' },
  { key: 'tag_buyer', label: 'Tag Comprador' },
  { key: 'tag_dnd', label: 'Tag No Molestar' },
  { key: 'pipeline_closed', label: 'Pipeline Cerrado' },
  { key: 'active_customer', label: 'Cliente Activo' },
  { key: 'meeting_scheduled', label: 'Reunión Programada' },
  { key: 'human_handover', label: 'Atención humana' },
];

const STEPS_LABELS = [
  '1. Configuración', '2. Entrada', '3. Exclusiones', '4. Cronograma',
  '5. Reglas de Ejecución', '6. Horarios', '7. Parada', '8. Acciones', '9. Revisión',
];

export function CadenceWizard({ orgId, cadenceId, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!cadenceId);

  // Core fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [objective, setObjective] = useState('Pós Live');
  const [agentId, setAgentId] = useState<string | null>(null);
  const [status, setEstado] = useState<'draft' | 'active' | 'paused'>('draft');

  // Filters (simplified for v1 — can be extended like CampaignWizard)
  const [entryTags, setEntryTags] = useState<string[]>([]);
  const [exclusionTags, setExclusionTags] = useState<string[]>([]);

  // Steps
  const [steps, setSteps] = useState<StepDraft[]>([]);

  // Execution window
  const [days, setDays] = useState<string[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [randomize, setRandomize] = useState(false);

  // Stop
  const [stopRules, setStopRules] = useState<Record<string, boolean>>({ responded: true, purchased: true });

  // Stop actions
  const [tagsAdd, setTagsAdd] = useState<string[]>([]);
  const [tagsRemove, setTagsRemove] = useState<string[]>([]);
  const [moveStageId, setMoveStageId] = useState<string | null>(null);
  const [internalNote, setInternalNote] = useState('');

  // Helpers
  const [agents, setAgents] = useState<{ id: string; agent_name: string }[]>([]);
  const [tags, setTags] = useState<{ id: string; name: string; color: string }[]>([]);
  const { contexts } = useContextLibrary(orgId);

  useEffect(() => {
    if (!orgId) return;
    supabase.from('webchat_agent_configs').select('id, agent_name').eq('organization_id', orgId).eq('is_active', true)
      .then(({ data }) => setAgents((data as any) ?? []));
    supabase.from('lead_tags').select('id, name, color').eq('organization_id', orgId).order('name')
      .then(({ data }) => setTags((data as any) ?? []));
  }, [orgId]);

  useEffect(() => {
    if (!cadenceId) return;
    setLoading(true);
    (async () => {
      const { data: c } = await supabase.from('cadences' as any).select('*').eq('id', cadenceId).maybeSingle();
      if (c) {
        const cd = c as any;
        setName(cd.name);
        setDescription(cd.description ?? '');
        setObjective(cd.objective ?? 'Pós Live');
        setAgentId(cd.agent_id);
        setEstado(cd.status);
        setEntryTags(cd.entry_filters?.tags ?? []);
        setExclusionTags(cd.exclusion_filters?.tags ?? []);
        const win = cd.execution_window ?? {};
        setDays(win.days ?? ['mon', 'tue', 'wed', 'thu', 'fri']);
        setStartTime(win.start ?? '09:00');
        setEndTime(win.end ?? '18:00');
        setRandomize(!!win.randomize);
        setStopRules(cd.stop_rules ?? {});
        const acts = cd.stop_actions ?? {};
        setTagsAdd(acts.tags_add ?? []);
        setTagsRemove(acts.tags_remove ?? []);
        setMoveStageId(acts.move_stage_id ?? null);
        setInternalNote(acts.internal_note ?? '');
      }
      const { data: st } = await supabase.from('cadence_steps' as any).select('*').eq('cadence_id', cadenceId).order('order_index');
      setSteps(((st as any[]) ?? []).map((s) => ({
        id: s.id, order_index: s.order_index, name: s.name, objective: s.objective ?? '',
        execute_immediately: s.execute_immediately, delay_value: s.delay_value, delay_unit: s.delay_unit,
        delay_from: s.delay_from, context_id: s.context_id, context_inline: s.context_inline ?? '',
        tone: s.tone ?? '', conditions: s.conditions ?? {},
      })));
      setLoading(false);
    })();
  }, [cadenceId]);

  const addStep = () => {
    setSteps((s) => [...s, {
      order_index: s.length,
      name: `Etapa ${s.length + 1}`,
      objective: '',
      execute_immediately: s.length === 0,
      delay_value: s.length === 0 ? 0 : 2,
      delay_unit: 'days',
      delay_from: 'previous_step',
      context_id: null,
      context_inline: '',
      tone: '',
      conditions: { only_if_no_response: s.length > 0 },
    }]);
  };

  const updateStep = (i: number, patch: Partial<StepDraft>) => {
    setSteps((arr) => arr.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  };
  const removeStep = (i: number) => {
    setSteps((arr) => arr.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, order_index: idx })));
  };
  const moveStep = (i: number, dir: -1 | 1) => {
    setSteps((arr) => {
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      const next = [...arr];
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((s, idx) => ({ ...s, order_index: idx }));
    });
  };

  const save = async (activate = false) => {
    if (!orgId) return;
    if (!name.trim()) { toast.error('Informa el nombre de la secuencia'); setStep(0); return; }
    if (steps.length === 0) { toast.error('Añade al menos una etapa'); setStep(3); return; }
    setSaving(true);
    const payload = {
      organization_id: orgId,
      name: name.trim(),
      description: description.trim() || null,
      objective,
      agent_id: agentId,
      status: activate ? 'active' : status,
      entry_filters: { tags: entryTags },
      exclusion_filters: { tags: exclusionTags },
      stop_rules: stopRules,
      stop_actions: { tags_add: tagsAdd, tags_remove: tagsRemove, move_stage_id: moveStageId, internal_note: internalNote || null },
      execution_window: { days, start: startTime, end: endTime, randomize },
      channel: 'whatsapp',
    };

    let id = cadenceId;
    if (id) {
      const { error } = await supabase.from('cadences' as any).update(payload).eq('id', id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      // Replace steps
      await supabase.from('cadence_steps' as any).delete().eq('cadence_id', id);
    } else {
      const { data, error } = await supabase.from('cadences' as any).insert(payload).select('id').single();
      if (error || !data) { toast.error(error?.message ?? 'Error al crear'); setSaving(false); return; }
      id = (data as any).id;
    }

    if (steps.length) {
      const rows = steps.map((s, i) => ({
        cadence_id: id,
        order_index: i,
        name: s.name || `Etapa ${i + 1}`,
        objective: s.objective || null,
        execute_immediately: s.execute_immediately,
        delay_value: s.delay_value,
        delay_unit: s.delay_unit,
        delay_from: s.delay_from,
        context_id: s.context_id,
        context_inline: s.context_inline || null,
        tone: s.tone || null,
        conditions: s.conditions,
      }));
      const { error } = await supabase.from('cadence_steps' as any).insert(rows);
      if (error) { toast.error(error.message); setSaving(false); return; }
    }

    toast.success(activate ? '¡Secuencia activada!' : 'Secuencia guardada');
    setSaving(false);
    onClose();
  };

  if (loading) return <div className="p-6">Cargando…</div>;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onClose}><ArrowLeft className="h-4 w-4 mr-2" /> Voltar</Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => save(false)} disabled={saving}>
            <Save className="h-4 w-4 mr-2" /> Guardar borrador
          </Button>
          {step === STEPS_LABELS.length - 1 && (
            <Button onClick={() => save(true)} disabled={saving}>
              <Rocket className="h-4 w-4 mr-2" /> Activar Secuencia
            </Button>
          )}
        </div>
      </div>

      <header>
        <h1 className="text-xl font-semibold">{cadenceId ? 'Editar secuencia' : 'Nueva secuencia'}</h1>
        <p className="text-sm text-muted-foreground">{STEPS_LABELS[step]}</p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {STEPS_LABELS.map((l, i) => (
          <button key={l} onClick={() => setStep(i)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${i === step ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground hover:bg-muted'}`}>
            {l}
          </button>
        ))}
      </div>

      {step === 0 && (
        <Card><CardContent className="p-5 space-y-4">
          <Field label="Nombre de la secuencia *"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Post Live Replay Mayo" /></Field>
          <Field label="Descripción"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="Objetivo">
            <Select value={objective} onValueChange={setObjective}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{OBJECTIVES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Agente responsable">
            <Select value={agentId ?? ''} onValueChange={(v) => setAgentId(v || null)}>
              <SelectTrigger><SelectValue placeholder="Seleccionar agente" /></SelectTrigger>
              <SelectContent>
                {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.agent_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Estado">
            <Select value={status} onValueChange={(v: any) => setEstado(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Borrador</SelectItem>
                <SelectItem value="active">Activa</SelectItem>
                <SelectItem value="paused">Pausada</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </CardContent></Card>
      )}

      {step === 1 && (
        <Card><CardContent className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">Selecciona etiquetas que filtren quién entra en esta secuencia. Los filtros avanzados (origen, pipeline, campos personalizados) se pueden añadir después desde el editor.</p>
          <TagsPicker label="Entrar si tiene CUALQUIERA de estas etiquetas" tags={tags} selected={entryTags} onChange={setEntryTags} />
        </CardContent></Card>
      )}

      {step === 2 && (
        <Card><CardContent className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">Los leads con cualquiera de estas etiquetas NO entran (o salen) de la secuencia.</p>
          <TagsPicker label="Excluir si tiene CUALQUIERA de estas etiquetas" tags={tags} selected={exclusionTags} onChange={setExclusionTags} />
        </CardContent></Card>
      )}

      {step === 3 && (
        <div className="space-y-3">
          {steps.map((s, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="secondary">Etapa {i + 1}</Badge>
                  <Input value={s.name} onChange={(e) => updateStep(i, { name: e.target.value })} className="flex-1" placeholder="Nombre de la etapa" />
                  <Button size="icon" variant="ghost" onClick={() => moveStep(i, -1)} disabled={i === 0}>↑</Button>
                  <Button size="icon" variant="ghost" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}>↓</Button>
                  <Button size="icon" variant="ghost" onClick={() => removeStep(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
                <Input value={s.objective} onChange={(e) => updateStep(i, { objective: e.target.value })} placeholder="Objetivo (ej: Iniciar conversación)" />

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
                  <div className="col-span-2 flex items-center gap-2">
                    <Switch checked={s.execute_immediately} onCheckedChange={(v) => updateStep(i, { execute_immediately: v })} />
                    <Label className="text-sm">Ejecutar inmediatamente</Label>
                  </div>
                  {!s.execute_immediately && (
                    <>
                      <div>
                        <Label className="text-xs">Después de</Label>
                        <Input type="number" min={1} value={s.delay_value} onChange={(e) => updateStep(i, { delay_value: parseInt(e.target.value) || 1 })} />
                      </div>
                      <div>
                        <Label className="text-xs">Unidad</Label>
                        <Select value={s.delay_unit} onValueChange={(v: any) => updateStep(i, { delay_unit: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="minutes">Minutos</SelectItem>
                            <SelectItem value="hours">Horas</SelectItem>
                            <SelectItem value="days">Días</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs">A partir de</Label>
                        <Select value={s.delay_from} onValueChange={(v: any) => updateStep(i, { delay_from: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="previous_step">Etapa anterior</SelectItem>
                            <SelectItem value="enrollment">Entrada en la secuencia</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}
                </div>

                <div>
                  <Label className="text-xs">Contexto de la biblioteca (opcional)</Label>
                  <Select value={s.context_id ?? '__none'} onValueChange={(v) => updateStep(i, { context_id: v === '__none' ? null : v })}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar contexto" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Ninguno (usar en línea)</SelectItem>
                      {contexts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Contexto en línea (instrucciones para el agente IA)</Label>
                  <Textarea rows={3} value={s.context_inline} onChange={(e) => updateStep(i, { context_inline: e.target.value })}
                    placeholder="Ej: Este lead participó en el live y aún no ha respondido. Inicia una conversación ligera y descubre su principal interés." />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Ejecutar solo si</Label>
                  <div className="flex flex-wrap gap-3">
                    <CheckBoxItem checked={!!s.conditions.only_if_no_response} onChange={(v) => updateStep(i, { conditions: { ...s.conditions, only_if_no_response: v } })} label="No respondió" />
                    <CheckBoxItem checked={!!s.conditions.only_if_no_purchase} onChange={(v) => updateStep(i, { conditions: { ...s.conditions, only_if_no_purchase: v } })} label="No compró" />
                    <CheckBoxItem checked={!!s.conditions.only_if_not_human} onChange={(v) => updateStep(i, { conditions: { ...s.conditions, only_if_not_human: v } })} label="No fue asumido por un humano" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          <Button variant="outline" onClick={addStep} className="w-full"><Plus className="h-4 w-4 mr-2" /> Añadir etapa</Button>
        </div>
      )}

      {step === 4 && (
        <Card><CardContent className="p-5 space-y-2 text-sm text-muted-foreground">
          As regras de execução são configuradas dentro de cada etapa na seção "Cronograma" (etapa 4). Use os checkboxes "Ejecutar solo si" em cada etapa.
        </CardContent></Card>
      )}

      {step === 5 && (
        <Card><CardContent className="p-5 space-y-4">
          <div>
            <Label>Días permitidos</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {WEEK_DAYS.map((d) => (
                <button key={d.key} type="button"
                  onClick={() => setDays((arr) => arr.includes(d.key) ? arr.filter((x) => x !== d.key) : [...arr, d.key])}
                  className={`px-3 py-1.5 rounded-md text-sm border ${days.includes(d.key) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background'}`}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Horario inicial"><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
            <Field label="Horario final"><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={randomize} onCheckedChange={setRandomize} />
            <Label className="text-sm">Aleatorizar horario dentro de la ventana (envío más natural)</Label>
          </div>
        </CardContent></Card>
      )}

      {step === 6 && (
        <Card><CardContent className="p-5 space-y-3">
          <p className="text-sm text-muted-foreground">¿Cuándo interrumpir la secuencia automáticamente?</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {STOP_OPTIONS.map((o) => (
              <CheckBoxItem key={o.key} label={o.label} checked={!!stopRules[o.key]}
                onChange={(v) => setStopRules((r) => ({ ...r, [o.key]: v }))} />
            ))}
          </div>
        </CardContent></Card>
      )}

      {step === 7 && (
        <Card><CardContent className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">Al interrumpir la secuencia:</p>
          <TagsPicker label="Aplicar etiquetas" tags={tags} selected={tagsAdd} onChange={setTagsAdd} />
          <TagsPicker label="Eliminar etiquetas" tags={tags} selected={tagsRemove} onChange={setTagsRemove} />
          <Field label="Nota interna (añadida al lead)">
            <Textarea rows={2} value={internalNote} onChange={(e) => setInternalNote(e.target.value)} placeholder="Ej: Terminó la secuencia post-live" />
          </Field>
        </CardContent></Card>
      )}

      {step === 8 && (
        <Card><CardContent className="p-5 space-y-4">
          <div className="space-y-1">
            <h3 className="font-semibold">Revisão</h3>
            <p className="text-sm text-muted-foreground">Revisa antes de activar.</p>
          </div>
          <Row k="Nombre" v={name || '—'} />
          <Row k="Objetivo" v={objective} />
          <Row k="Agente" v={agents.find((a) => a.id === agentId)?.agent_name ?? '—'} />
          <Row k="Etapas" v={`${steps.length} etapa(s)`} />
          <Row k="Ventana" v={`${days.join(', ').toUpperCase()} · ${startTime}–${endTime}${randomize ? ' (aleatorizado)' : ''}`} />
          <Row k="Parar si" v={Object.entries(stopRules).filter(([, v]) => v).map(([k]) => STOP_OPTIONS.find((o) => o.key === k)?.label ?? k).join(', ') || 'Ninguna regla'} />

          <div className="pt-4">
            <h4 className="text-sm font-medium mb-2">Simulación visual</h4>
            <div className="space-y-1">
              {steps.map((s, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">{i + 1}</div>
                  <div className="flex-1 border rounded p-2">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.execute_immediately ? 'Imediatamente' : `+${s.delay_value} ${s.delay_unit === 'minutes' ? 'min' : s.delay_unit === 'hours' ? 'h' : 'd'} (${s.delay_from === 'enrollment' ? 'de la entrada' : 'de la anterior'})`}
                    </div>
                  </div>
                </div>
              ))}
              <div className="text-sm text-muted-foreground pl-10">↓ Finalizar</div>
            </div>
          </div>
        </CardContent></Card>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Anterior
        </Button>
        <Button onClick={() => setStep((s) => Math.min(STEPS_LABELS.length - 1, s + 1))} disabled={step === STEPS_LABELS.length - 1}>
          Siguiente <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return <div className="space-y-1.5"><Label className="text-sm">{label}</Label>{children}</div>;
}

function CheckBoxItem({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} />
      <span>{label}</span>
    </label>
  );
}

function TagsPicker({ label, tags, selected, onChange }: { label: string; tags: { id: string; name: string; color: string }[]; selected: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 && <span className="text-xs text-muted-foreground">Ninguna etiqueta registrada.</span>}
        {tags.map((t) => {
          const on = selected.includes(t.id);
          return (
            <button key={t.id} type="button"
              onClick={() => onChange(on ? selected.filter((x) => x !== t.id) : [...selected, t.id])}
              className={`px-2.5 py-1 rounded-full text-xs border ${on ? 'border-primary' : 'border-border'}`}
              style={on ? { backgroundColor: t.color + '33', color: t.color } : {}}>
              {t.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return <div className="flex justify-between text-sm border-b pb-1.5"><span className="text-muted-foreground">{k}</span><span className="text-right font-medium">{v}</span></div>;
}

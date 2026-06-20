import { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Repeat, MessageSquare, Clock, Lightbulb } from 'lucide-react';
import { ProductAgent } from '@/types/agents';
import { useZernioTemplates } from '@/hooks/useZernioTemplates';

interface Props {
  formData: Partial<ProductAgent>;
  onChange: (updates: Partial<ProductAgent>) => void;
}

const MAX_ATTEMPTS = 5;
const DEFAULT_INTERVALS = [15, 120, 1440, 2880, 4320]; // min

const TONE_OPTIONS = [
  { value: 'short',        label: 'Corto y directo',           hint: '"¿Seguís ahí? ¿Puedo continuar?"' },
  { value: 'warm',         label: 'Cálido y consultivo',       hint: '"Hola {nome}, ¿todo bien? ¿Te quedó alguna duda?"' },
  { value: 'provocative',  label: 'Provocativo / rompe la objeción', hint: '"Si el precio es el tema, te muestro el ROI rapidito."' },
] as const;

const CHANNELS = [
  { id: 'whatsapp',  label: 'WhatsApp'  },
  { id: 'instagram', label: 'Instagram' },
  { id: 'webchat',   label: 'Webchat'   },
];

function formatInterval(min: number): string {
  if (min < 60)   return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} d`;
}

export function AgentFollowupTab({ formData, onChange }: Props) {
  const { data: zernioTemplates = [], isLoading: tplLoading } = useZernioTemplates();
  const enabled        = !!formData.followup_enabled;
  const maxAttempts    = formData.followup_max_attempts ?? 3;
  const intervals      = useMemo(
    () => formData.followup_intervals_minutes ?? DEFAULT_INTERVALS.slice(0, maxAttempts),
    [formData.followup_intervals_minutes, maxAttempts],
  );
  const tone           = formData.followup_tone ?? 'warm';
  const extra          = formData.followup_extra_instructions ?? '';
  const respectHours   = formData.followup_respect_business_hours ?? true;
  const stopOnHuman    = formData.followup_stop_on_human ?? true;
  const stopOnBooking  = formData.followup_stop_on_booking ?? true;
  const channels       = formData.followup_channels ?? ['whatsapp', 'instagram'];
  const hints: Array<{ attempt: number; hint: string }> =
    Array.isArray(formData.followup_attempt_hints) ? formData.followup_attempt_hints as any : [];

  const getHint = (attempt: number) =>
    hints.find((h) => h.attempt === attempt)?.hint ?? '';

  const setHint = (attempt: number, hint: string) => {
    const next = hints.filter((h) => h.attempt !== attempt);
    if (hint.trim()) next.push({ attempt, hint: hint.trim() });
    next.sort((a, b) => a.attempt - b.attempt);
    onChange({ followup_attempt_hints: next as any });
  };

  const setInterval = (idx: number, value: number) => {
    const next = [...intervals];
    next[idx] = Math.max(1, value);
    onChange({ followup_intervals_minutes: next });
  };

  const setMaxAttempts = (n: number) => {
    const clean = Math.min(MAX_ATTEMPTS, Math.max(1, n));
    const next = [...intervals];
    while (next.length < clean) next.push(DEFAULT_INTERVALS[next.length] ?? 1440);
    onChange({
      followup_max_attempts: clean,
      followup_intervals_minutes: next.slice(0, clean),
    });
  };

  const toggleChannel = (id: string) => {
    const has = channels.includes(id);
    const next = has ? channels.filter((c) => c !== id) : [...channels, id];
    onChange({ followup_channels: next });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 rounded-lg border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2">
            <Repeat className="h-5 w-5 text-primary" />
          </div>
          <div>
            <Label className="text-base">Follow-up automático contextual</Label>
            <p className="text-sm text-muted-foreground mt-1">
              Cuando el lead "desaparece" en medio de la conversación, el agente envía un seguimiento generado por IA
              con el contexto real, citando el nombre y el tema. Tono natural, sin cara de robot.
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => onChange({ followup_enabled: v })}
        />
      </div>

      {enabled && (
        <>
          {/* Intentos + intervalos */}
          <Card className="p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              <Label className="text-sm font-semibold">Intentos e intervalos</Label>
            </div>

            <div className="grid grid-cols-2 gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs">¿Cuántos intentos?</Label>
                <Select
                  value={String(maxAttempts)}
                  onValueChange={(v) => setMaxAttempts(parseInt(v, 10))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} intento{n > 1 ? 's' : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                Al agotarse, el lead sale de la secuencia automática.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">¿Cuánto tiempo después del silencio del lead?</Label>
              {Array.from({ length: maxAttempts }).map((_, i) => (
                <div key={i} className="grid grid-cols-[80px_1fr_90px] gap-2 items-center">
                  <span className="text-sm font-medium">
                    {i + 1}º {i === 0 ? '➜' : '➜'}
                  </span>
                  <Input
                    type="number"
                    min={1}
                    value={intervals[i] ?? DEFAULT_INTERVALS[i] ?? 60}
                    onChange={(e) => setInterval(i, parseInt(e.target.value || '0', 10))}
                  />
                  <span className="text-xs text-muted-foreground">
                    minutos ({formatInterval(intervals[i] ?? DEFAULT_INTERVALS[i] ?? 60)})
                  </span>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">
                Los intervalos cuentan desde el último mensaje del agente sin respuesta.
              </p>
            </div>
          </Card>

          {/* Tono */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <Label className="text-sm font-semibold">Tono del seguimiento</Label>
            </div>
            <div className="grid gap-2">
              {TONE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition ${
                    tone === opt.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/50'
                  }`}
                >
                  <input
                    type="radio"
                    className="mt-1"
                    checked={tone === opt.value}
                    onChange={() => onChange({ followup_tone: opt.value as any })}
                  />
                  <div>
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-xs text-muted-foreground italic mt-0.5">{opt.hint}</div>
                  </div>
                </label>
              ))}
            </div>
          </Card>

          {/* Intención por intento */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-primary" />
              <Label className="text-sm font-semibold">Intención de cada intento (opcional)</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              La IA escribe el mensaje desde cero usando el contexto. Acá solo guiás la intención.
              Ej: "chequear duda residual", "ofrecer prueba social", "ofrecer llamada".
            </p>
            {Array.from({ length: maxAttempts }).map((_, i) => {
              const attempt = i + 1;
              return (
                <div key={attempt} className="grid grid-cols-[60px_1fr] gap-2 items-center">
                  <span className="text-sm font-medium">{attempt}º</span>
                  <Input
                    placeholder="Ej: ofrecer hablar por llamada"
                    value={getHint(attempt)}
                    onChange={(e) => setHint(attempt, e.target.value)}
                  />
                </div>
              );
            })}
          </Card>

          {/* Instrucciones extra */}
          <Card className="p-4 space-y-2">
            <Label className="text-sm font-semibold">Instrucciones extra generales</Label>
            <Textarea
              rows={3}
              placeholder="Ej: en el último intento, ofrecé enviar material en video o agendar una llamada rápida."
              value={extra}
              onChange={(e) => onChange({ followup_extra_instructions: e.target.value })}
            />
          </Card>

          {/* Canales + Guardrails */}
          <Card className="p-4 space-y-4">
            <div>
              <Label className="text-sm font-semibold">Canales permitidos</Label>
              <div className="flex flex-wrap gap-3 mt-2">
                {CHANNELS.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={channels.includes(c.id)}
                      onCheckedChange={() => toggleChannel(c.id)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t">
              <Label className="text-sm font-semibold">Guardrails</Label>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm">Respetar el horario comercial</div>
                  <div className="text-xs text-muted-foreground">Posterga el intento al próximo horario laboral.</div>
                </div>
                <Switch checked={respectHours} onCheckedChange={(v) => onChange({ followup_respect_business_hours: v })} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm">Detener si la conversación pasa a un humano</div>
                  <div className="text-xs text-muted-foreground">Cierra la secuencia cuando un agente asume.</div>
                </div>
                <Switch checked={stopOnHuman} onCheckedChange={(v) => onChange({ followup_stop_on_human: v })} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm">Detener si se agenda una reunión</div>
                  <div className="text-xs text-muted-foreground">Si la IA o el vendedor agendó, no insiste.</div>
                </div>
                <Switch checked={stopOnBooking} onCheckedChange={(v) => onChange({ followup_stop_on_booking: v })} />
              </div>

              <div className="text-xs text-muted-foreground pt-2">
                Siempre se interrumpe cuando el lead responde, marca opt-out, o la conversación se cierra/pierde.
              </div>
            </div>
          </Card>

          {/* Plantilla de reenganche (fuera de 24h) */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Repeat className="h-4 w-4 text-primary" />
              <Label className="text-sm font-semibold">Plantilla de reenganche (fuera de 24h)</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              En WhatsApp <strong>oficial (Zernio/Meta)</strong>, pasadas <strong>24h</strong> sin respuesta del cliente
              ya no se puede mandar texto libre: WhatsApp exige una <strong>plantilla aprobada</strong>. Cargá acá el
              nombre EXACTO de tu plantilla aprobada en Zernio para que el follow-up post-24h salga igual.
              <br />
              <span className="text-muted-foreground/80">
                (En Evolution no hace falta — no tiene límite de 24h. Si lo dejás vacío, el follow-up fuera de 24h en
                Zernio/Meta no se envía y queda registrado el motivo.)
              </span>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Plantilla aprobada</Label>
                {zernioTemplates.length > 0 ? (
                  <Select
                    value={formData.followup_template_name ?? ''}
                    onValueChange={(name) => {
                      const t = zernioTemplates.find((x) => x.name === name);
                      onChange({ followup_template_name: name || null, followup_template_language: t?.language || 'es' });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder={tplLoading ? 'Cargando…' : 'Elegí una plantilla'} /></SelectTrigger>
                    <SelectContent>
                      {zernioTemplates.map((t) => (
                        <SelectItem key={`${t.name}-${t.language}`} value={t.name}>
                          {t.name} <span className="text-muted-foreground">· {t.language}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder={tplLoading ? 'Cargando plantillas…' : 'ej: reenganche_seguimiento'}
                    value={formData.followup_template_name ?? ''}
                    onChange={(e) => onChange({ followup_template_name: e.target.value || null })}
                  />
                )}
                {zernioTemplates.length === 0 && !tplLoading && (
                  <p className="text-[10px] text-muted-foreground">No encontré plantillas aprobadas en Zernio. Podés escribir el nombre exacto a mano.</p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Idioma</Label>
                <Input
                  placeholder="es"
                  value={formData.followup_template_language ?? 'es'}
                  onChange={(e) => onChange({ followup_template_language: e.target.value || 'es' })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Parámetros (opcional, separados por coma — para {'{{1}}'}, {'{{2}}'}…)</Label>
              <Input
                placeholder="ej: {primer_nombre}, Citroën C4 Cactus"
                value={Array.isArray(formData.followup_template_params) ? formData.followup_template_params.join(', ') : ''}
                onChange={(e) =>
                  onChange({
                    followup_template_params: e.target.value
                      ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                      : [],
                  })
                }
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">Insertar dato del lead:</span>
                {[
                  { v: '{primer_nombre}', l: 'Primer nombre' },
                  { v: '{nombre}', l: 'Nombre' },
                  { v: '{telefono}', l: 'Teléfono' },
                  { v: '{email}', l: 'Email' },
                ].map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => {
                      const cur = Array.isArray(formData.followup_template_params) ? formData.followup_template_params : [];
                      onChange({ followup_template_params: [...cur, opt.v] });
                    }}
                    className="px-2 py-0.5 rounded-full border text-[10px] bg-muted/40 hover:bg-muted transition-colors"
                  >
                    + {opt.l}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">Las variables del lead se reemplazan al enviar (ej. {'{primer_nombre}'} → "Marcelo").</p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

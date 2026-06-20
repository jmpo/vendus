import { useEffect, useMemo, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export type ZernioVarSource = 'first_name' | 'full_name' | 'email' | 'phone' | 'static';

export interface ZernioVarMap {
  source: ZernioVarSource;
  static_value?: string;
}

export interface ZernioCampaignTemplate {
  zernio_template_name: string;
  zernio_template_language: string;
  // Mapeo de cada variable {{n}} → campo del lead (o texto fijo). Clave = número de la variable.
  variable_mapping?: Record<string, ZernioVarMap>;
}

interface Tpl { name: string; status?: string; language?: string; category?: string; components?: any[]; body_text?: string }

interface Props {
  organizationId: string | null;
  connectionId: string;
  value?: ZernioCampaignTemplate | null;
  onChange: (v: ZernioCampaignTemplate | null) => void;
}

const FIELD_OPTIONS: { value: ZernioVarSource; label: string }[] = [
  { value: 'first_name', label: 'Primer nombre del lead' },
  { value: 'full_name', label: 'Nombre completo del lead' },
  { value: 'email', label: 'Email del lead' },
  { value: 'phone', label: 'Teléfono del lead' },
  { value: 'static', label: 'Texto fijo…' },
];

// Valores de ejemplo para la vista previa (simulan un lead real).
const SAMPLE_VALUES: Record<ZernioVarSource, string> = {
  first_name: 'Juan',
  full_name: 'Juan Pérez',
  email: 'juan.perez@email.com',
  phone: '+595 981 123 456',
  static: '',
};

function sampleForVar(map?: ZernioVarMap): string {
  if (!map) return SAMPLE_VALUES.first_name;
  if (map.source === 'static') return map.static_value?.trim() || '(texto fijo)';
  return SAMPLE_VALUES[map.source] ?? SAMPLE_VALUES.first_name;
}

// Extrae el texto del cuerpo de una plantilla (formato Zernio/Meta).
function getBodyText(t?: Tpl): string {
  if (!t) return '';
  const comps = t.components ?? [];
  const body = comps.find((c) => String(c?.type ?? '').toLowerCase() === 'body');
  return body?.text ?? t.body_text ?? '';
}

// Números de variable {{n}} únicos y ordenados.
function extractVars(text: string): number[] {
  const nums = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => parseInt(m[1], 10));
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

export function ZernioCampaignTemplatePicker({ organizationId, connectionId, value, onChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<Tpl[]>([]);

  useEffect(() => {
    if (!organizationId || !connectionId) return;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('zernio-templates', {
          body: { organization_id: organizationId, connection_id: connectionId, action: 'list' },
        });
        if (error) throw error;
        setTemplates(((data as any)?.templates ?? []) as Tpl[]);
      } catch {
        setTemplates([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [organizationId, connectionId]);

  const approved = templates.filter((t) => (t.status || '').toUpperCase() === 'APPROVED');

  const selectedTpl = useMemo(
    () => approved.find((t) => t.name === value?.zernio_template_name),
    [approved, value?.zernio_template_name],
  );
  const bodyText = getBodyText(selectedTpl);
  const vars = useMemo(() => extractVars(bodyText), [bodyText]);

  // Cuerpo con las variables reemplazadas por datos de ejemplo (cómo llega el mensaje).
  const previewText = useMemo(() => {
    if (!bodyText) return '';
    return bodyText.replace(/\{\{(\d+)\}\}/g, (_m, n) => sampleForVar(value?.variable_mapping?.[String(n)]));
  }, [bodyText, value?.variable_mapping]);

  const setVarMap = (n: number, patch: Partial<ZernioVarMap>) => {
    if (!value) return;
    const current = value.variable_mapping ?? {};
    const prev = current[String(n)] ?? { source: 'first_name' as ZernioVarSource };
    onChange({ ...value, variable_mapping: { ...current, [String(n)]: { ...prev, ...patch } } });
  };

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando plantillas…</p>
      ) : approved.length === 0 ? (
        <p className="text-xs text-amber-600">
          No hay plantillas <strong>aprobadas</strong> en esta conexión Zernio. Creá y aprobá una en Conexiones → Zernio → Plantillas.
        </p>
      ) : (
        <Select
          value={value?.zernio_template_name ?? ''}
          onValueChange={(name) => {
            const t = approved.find((x) => x.name === name);
            if (!t) { onChange(null); return; }
            // Pre-mapea cada variable al primer nombre por defecto (lo más común).
            const detected = extractVars(getBodyText(t));
            const variable_mapping: Record<string, ZernioVarMap> = {};
            for (const n of detected) variable_mapping[String(n)] = { source: 'first_name' };
            onChange({ zernio_template_name: t.name, zernio_template_language: t.language || 'es', variable_mapping });
          }}
        >
          <SelectTrigger><SelectValue placeholder="Elegí una plantilla aprobada" /></SelectTrigger>
          <SelectContent>
            {approved.map((t) => (
              <SelectItem key={t.name} value={t.name}>
                {t.name} <span className="text-muted-foreground">({t.language})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Vista previa del cuerpo + mapeo de variables */}
      {value?.zernio_template_name && (
        <div className="space-y-3">
          {bodyText && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">{bodyText}</div>
          )}

          {vars.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Completá cada variable con un dato del lead:</p>
              {vars.map((n) => {
                const map = value.variable_mapping?.[String(n)] ?? { source: 'first_name' as ZernioVarSource };
                return (
                  <div key={n} className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono text-[11px] shrink-0">{`{{${n}}}`}</Badge>
                    <Select value={map.source} onValueChange={(v) => setVarMap(n, { source: v as ZernioVarSource })}>
                      <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FIELD_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {map.source === 'static' && (
                      <Input
                        className="h-9 flex-1"
                        placeholder="Texto fijo…"
                        value={map.static_value ?? ''}
                        onChange={(e) => setVarMap(n, { static_value: e.target.value })}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Badge variant="secondary" className="text-[10px]">Sin variables · {value.zernio_template_language}</Badge>
          )}

          {/* Vista previa con datos de ejemplo (cómo llega el mensaje) */}
          {previewText && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Vista previa (ejemplo):</p>
              <div className="flex">
                <div className="max-w-[85%] rounded-lg rounded-tl-sm bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm whitespace-pre-wrap">
                  {previewText}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">Los datos de ejemplo se reemplazan por los reales de cada lead al enviar.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

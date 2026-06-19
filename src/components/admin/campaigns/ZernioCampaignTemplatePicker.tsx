import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export interface ZernioCampaignTemplate {
  zernio_template_name: string;
  zernio_template_language: string;
}

interface Tpl { name: string; status?: string; language?: string; category?: string }

interface Props {
  organizationId: string | null;
  connectionId: string;
  value?: ZernioCampaignTemplate | null;
  onChange: (v: ZernioCampaignTemplate | null) => void;
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

  return (
    <div className="space-y-2">
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
            onChange(t ? { zernio_template_name: t.name, zernio_template_language: t.language || 'es' } : null);
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
      {value?.zernio_template_name && (
        <Badge variant="secondary" className="text-[10px]">Plantilla: {value.zernio_template_name} · {value.zernio_template_language}</Badge>
      )}
    </div>
  );
}

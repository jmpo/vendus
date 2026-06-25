import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Brain } from 'lucide-react';
import { Label } from '@/components/ui/label';

const FACT_LABELS: Record<string, string> = {
  uso: 'Uso',
  ocupantes: 'Ocupantes',
  nuevo_o_usado: '0km/Usado',
  presupuesto: 'Presupuesto',
  financiacion: 'Financiación',
  entrega_usado: 'Entrega usado',
  modelos_interes: 'Le interesa',
  objecion: 'Objeción',
  etapa: 'Etapa',
  otros: 'Otros',
};

interface MemRow {
  summary: string | null;
  facts: Record<string, string> | null;
  updated_at: string;
}

/**
 * Ficha de memoria del cliente (lo que la IA fue aprendiendo de él, sin perderse
 * por el recorte de 40 mensajes). La mantiene la función lead-memory-update.
 */
export function LeadMemoryCard({ leadId }: { leadId: string | null | undefined }) {
  const [mem, setMem] = useState<MemRow | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!leadId) { setMem(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('lead_memory')
        .select('summary, facts, updated_at')
        .eq('lead_id', leadId)
        .maybeSingle();
      if (!cancelled) { setMem(data as MemRow | null); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [leadId]);

  if (!leadId) return null;

  const facts = mem?.facts && typeof mem.facts === 'object' ? mem.facts : {};
  const factEntries = Object.entries(facts).filter(([, v]) => String(v ?? '').trim());
  const hasContent = !!mem && (!!mem.summary || factEntries.length > 0);

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
      <Label className="text-[10px] uppercase tracking-wider text-primary flex items-center gap-1">
        <Brain className="h-3 w-3" /> Ficha del cliente · IA
      </Label>
      {loading ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : !hasContent ? (
        <p className="text-xs text-muted-foreground">
          La IA todavía no juntó datos de este cliente. Se completa sola a medida que conversan.
        </p>
      ) : (
        <div className="space-y-2">
          {mem?.summary && <p className="text-xs leading-relaxed">{mem.summary}</p>}
          {factEntries.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {factEntries.map(([k, v]) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 rounded-md bg-background/70 border border-border px-1.5 py-0.5 text-[10px]"
                >
                  <span className="text-muted-foreground">{FACT_LABELS[k] ?? k}:</span>
                  <span className="font-medium">{String(v)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

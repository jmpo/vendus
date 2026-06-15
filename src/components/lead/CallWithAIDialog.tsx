import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Loader2, Bot, Phone } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useProductAgents, useAllAgents } from '@/hooks/useProductAgents';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface CallWithAIDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: {
    id: string;
    name: string;
    phone?: string | null;
    product_id?: string | null;
  };
  initialExtraContext?: string;
  initialObjective?: string;
}

const OBJECTIVE_PRESETS = [
  { value: 'agendar', label: 'Programar reunión', text: 'Programar una reunión con el lead.' },
  { value: 'retomar', label: 'Retomar conversación', text: 'Retomar la conversación donde se quedó y dar continuidad a la atención.' },
  { value: 'qualificar', label: 'Calificar (BANT)', text: 'Calificar al lead usando BANT (presupuesto, autoridad, necesidad, plazo).' },
  { value: 'oferta', label: 'Presentar oferta', text: 'Presentar la oferta principal y conducir al cierre.' },
  { value: 'recuperar', label: 'Recuperar carrito', text: 'Recuperar carrito abandonado y ayudar a finalizar la compra.' },
  { value: 'custom', label: 'Otro (escribir)', text: '' },
];

export function CallWithAIDialog({ open, onOpenChange, lead, initialExtraContext, initialObjective }: CallWithAIDialogProps) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const productAgentsQuery = useProductAgents(lead.product_id || '');
  const allAgentsQuery = useAllAgents();

  // Se o lead tem produto, usa agentes do produto; senão fallback p/ todos da org.
  const agents = lead.product_id ? productAgentsQuery.data : allAgentsQuery.data;
  const loadingAgents = lead.product_id ? productAgentsQuery.isLoading : allAgentsQuery.isLoading;

  const [agentId, setAgentId] = useState<string>('');
  const [objectivePreset, setObjectivePreset] = useState<string>('retomar');
  const [customObjective, setCustomObjective] = useState(initialObjective || '');
  const [extraContext, setExtraContext] = useState(initialExtraContext || '');
  const [mode, setMode] = useState<'direct' | 'conversational'>('direct');
  const [isSending, setIsSending] = useState(false);

  // Quando reabre com novo contexto inicial, sobrescreve.
  useEffect(() => {
    if (open && initialExtraContext) setExtraContext(initialExtraContext);
    if (open && initialObjective) {
      setObjectivePreset('custom');
      setCustomObjective(initialObjective);
    }
  }, [open, initialExtraContext, initialObjective]);

  // Pré-seleciona agente padrão / primeiro ativo
  useEffect(() => {
    if (!agents?.length) return;
    if (agentId && agents.some((a) => a.id === agentId)) return;
    const def = agents.find((a: any) => a.is_default && a.is_active) || agents.find((a: any) => a.is_active) || agents[0];
    if (def) setAgentId(def.id);
  }, [agents, agentId]);

  const formattedPhone = useMemo(() => {
    if (!lead.phone) return '';
    const digits = lead.phone.replace(/\D/g, '');
    if (digits.length >= 12) {
      return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
    }
    return lead.phone;
  }, [lead.phone]);

  const initials = lead.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  const handleSubmit = async () => {
    if (!profile?.organization_id) {
      toast.error('Sesión inválida.');
      return;
    }
    if (!lead.phone) {
      toast.error('Lead sin teléfono registrado.');
      return;
    }
    if (!agentId) {
      toast.error('Seleccione un agente de IA.');
      return;
    }

    const preset = OBJECTIVE_PRESETS.find((p) => p.value === objectivePreset);
    const objective = objectivePreset === 'custom' ? customObjective.trim() : preset?.text || '';

    if (!objective) {
      toast.error('Defina un objetivo para la IA.');
      return;
    }

    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('manual-outreach', {
        body: {
          lead_ids: [lead.id],
          agent_id: agentId,
          organization_id: profile.organization_id,
          objective,
          extra_context: extraContext.trim() || undefined,
          mode,
        },
      });

      if (error) throw error;

      const result = Array.isArray((data as any)?.results) ? (data as any).results[0] : null;
      if (result?.skipped) {
        toast.info(`La IA no se activó: ${result.reason || 'ya existe un outreach reciente'}`);
      } else if (result?.error) {
        toast.error(`Error: ${result.error}`);
      } else {
        toast.success(`La IA inició contacto con ${lead.name}.`);
      }

      queryClient.invalidateQueries({ queryKey: ['interactions', lead.id] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['lead', lead.id] });
      onOpenChange(false);
    } catch (err: any) {
      console.error('[CallWithAI] erro:', err);
      const msg = err?.message || 'Error al iniciar la atención con IA.';
      if (msg.includes('402')) {
        toast.error('Sin créditos de IA. Agregue créditos en las configuraciones.');
      } else if (msg.includes('429')) {
        toast.error('Demasiadas solicitudes. Intente nuevamente en unos instantes.');
      } else {
        toast.error(msg);
      }
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Llamar con IA
          </DialogTitle>
          <DialogDescription>
            La IA entrará en contacto y conducirá la atención de forma autónoma.
          </DialogDescription>
        </DialogHeader>

        {/* Lead info */}
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{lead.name}</p>
            {formattedPhone && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {formattedPhone}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {/* Agente */}
          <div className="space-y-2">
            <Label>Agente de IA</Label>
            <Select value={agentId} onValueChange={setAgentId} disabled={loadingAgents || !agents?.length}>
              <SelectTrigger>
                <SelectValue placeholder={loadingAgents ? 'Cargando...' : 'Selecione um agente'} />
              </SelectTrigger>
              <SelectContent>
                {agents?.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    <div className="flex items-center gap-2">
                      <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{a.name}</span>
                      {a.agent_type && (
                        <span className="text-xs text-muted-foreground capitalize">· {a.agent_type}</span>
                      )}
                      {a.is_default && (
                        <span className="text-xs text-primary">· padrão</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!loadingAgents && !agents?.length && (
              <p className="text-xs text-destructive">
                Ningún agente de IA configurado{lead.product_id ? ' para este producto' : ''}.
              </p>
            )}
          </div>

          {/* Objetivo */}
          <div className="space-y-2">
            <Label>Objetivo</Label>
            <Select value={objectivePreset} onValueChange={setObjectivePreset}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OBJECTIVE_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {objectivePreset === 'custom' && (
              <Input
                value={customObjective}
                onChange={(e) => setCustomObjective(e.target.value)}
                placeholder="Ej: Invitar al webinar del jueves."
              />
            )}
          </div>

          {/* Contexto */}
          <div className="space-y-2">
            <Label>Contexto adicional (opcional)</Label>
            <Textarea
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
              placeholder="Ej: El lead pidió que se le contacte mañana sobre el plan anual con descuento."
              rows={3}
            />
          </div>

          {/* Modo */}
          <div className="space-y-2">
            <Label>Modo de contacto</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'direct' | 'conversational')} className="grid grid-cols-2 gap-2">
              <label className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${mode === 'direct' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}>
                <RadioGroupItem value="direct" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Directo</p>
                  <p className="text-xs text-muted-foreground">Ya dispara el abordaje inicial.</p>
                </div>
              </label>
              <label className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${mode === 'conversational' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}>
                <RadioGroupItem value="conversational" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Conversacional</p>
                  <p className="text-xs text-muted-foreground">Conduce con preguntas exploratorias.</p>
                </div>
              </label>
            </RadioGroup>
          </div>

          <p className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-3">
            La IA continuará la atención y hará seguimientos automáticos respetando el horario comercial. La conversación aparecerá en el Inbox.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isSending || !agentId || !lead.phone} className="gap-2">
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Iniciar atención con IA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

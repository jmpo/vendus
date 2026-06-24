import { useState } from 'react';
import { Clock, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useZernioTemplates } from '@/hooks/useZernioTemplates';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface Props {
  conversationId: string;
  zernioConnectionId: string | null;
  visitorPhone: string | null;
}

/**
 * Barra que reemplaza al composer cuando la conversación está FUERA de la ventana 24h
 * (WhatsApp oficial). En ese caso solo se puede enviar una PLANTILLA aprobada para reabrir.
 */
export function OutOfWindowTemplateBar({ conversationId, zernioConnectionId, visitorPhone }: Props) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { data: templates = [], isLoading } = useZernioTemplates();
  const [selected, setSelected] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    const tpl = templates.find((t) => t.name === selected);
    if (!tpl || !zernioConnectionId || !visitorPhone) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('zernio-send', {
        body: {
          connection_id: zernioConnectionId,
          organization_id: profile?.organization_id,
          conversation_id: conversationId,
          to: visitorPhone,
          type: 'template',
          template: { name: tpl.name, language: tpl.language },
          record: true,
        },
      });
      if (error) throw error;
      if ((data as any)?.ok === false) throw new Error((data as any)?.message || (data as any)?.error || 'No se pudo enviar');
      toast.success('Plantilla enviada — esperá la respuesta del cliente para reabrir el chat');
      setSelected('');
      queryClient.invalidateQueries({ queryKey: ['webchat-conversation', conversationId] });
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo enviar la plantilla');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 p-3 flex-shrink-0 space-y-2">
      <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
        <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          Pasaron <b>+24h</b> desde el último mensaje del cliente. WhatsApp solo permite enviar una
          {' '}<b>plantilla aprobada</b> para reabrir la conversación.
        </span>
      </p>
      <div className="flex items-center gap-2">
        <Select value={selected} onValueChange={setSelected} disabled={isLoading || templates.length === 0}>
          <SelectTrigger className="h-9 flex-1">
            <SelectValue placeholder={isLoading ? 'Cargando plantillas…' : templates.length === 0 ? 'Sin plantillas aprobadas' : 'Elegí una plantilla'} />
          </SelectTrigger>
          <SelectContent>
            {templates.map((t) => (
              <SelectItem key={`${t.name}-${t.language}`} value={t.name}>
                {t.name} <span className="opacity-60">· {t.language}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" className="h-9" onClick={handleSend} disabled={!selected || sending || !zernioConnectionId || !visitorPhone}>
          {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
          Enviar plantilla
        </Button>
      </div>
      {!isLoading && templates.length === 0 && (
        <p className="text-[11px] text-muted-foreground">No hay plantillas aprobadas en Zernio. Creá una para poder reenganchar.</p>
      )}
    </div>
  );
}

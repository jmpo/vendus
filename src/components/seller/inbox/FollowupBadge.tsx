import { Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isToday, isTomorrow, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useFollowupStatus } from '@/hooks/useFollowupStatus';

/**
 * Chip que hace VISIBLE el seguimiento automático de la IA en la conversación:
 *   "🔄 Seguimiento IA 1/3 · próximo mañana 9:00"
 * Antes el follow-up se configuraba pero no se veía si iba a insistir, cuándo, ni en
 * qué intento. Solo aparece si hay un seguimiento programado en marcha.
 */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diffMin = Math.round((d.getTime() - now) / 60000);
  if (diffMin <= 0) return 'en breve';
  if (diffMin < 60) return `en ${diffMin} min`;
  if (isToday(d)) return `hoy ${format(d, 'HH:mm')}`;
  if (isTomorrow(d)) return `mañana ${format(d, 'HH:mm')}`;
  return format(d, "EEE d 'a las' HH:mm", { locale: es });
}

export function FollowupBadge({ conversationId }: { conversationId?: string | null }) {
  const { data } = useFollowupStatus(conversationId);
  if (!data?.active || !data.nextAt) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap',
        'bg-violet-500/15 text-violet-700 dark:text-violet-300',
      )}
      title={`La IA va a hacer un seguimiento automático (intento ${data.attempt} de ${data.max}) si el cliente no responde. Se interrumpe si responde o si un humano toma la conversación.`}
    >
      <Repeat className="h-3 w-3 shrink-0" />
      Seguimiento IA {data.attempt}/{data.max} · {formatWhen(data.nextAt)}
    </span>
  );
}

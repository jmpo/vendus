import { useEffect, useState } from 'react';
import { Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isToday, isTomorrow, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useFollowupStatus } from '@/hooks/useFollowupStatus';

/**
 * Chip que hace VISIBLE el seguimiento automático de la IA en la conversación:
 *   "🔄 Seguimiento IA 1/3 · en 2h 15m"
 * Con timer EN VIVO (cuenta regresiva que se actualiza sola). Solo aparece si hay
 * un seguimiento programado en marcha. Se interrumpe si el cliente responde,
 * un humano toma la conversación, o se agotan los intentos.
 */
function formatCountdown(iso: string, now: number): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const ms = d - now;
  if (ms <= 0) return 'en instantes';        // vencido: el cron lo dispara en <5 min
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `en ${totalMin} min`;
  // Menos de 12h: cuenta regresiva viva "en Xh Ym"
  if (totalMin < 12 * 60) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `en ${h}h ${String(m).padStart(2, '0')}m`;
  }
  const date = new Date(iso);
  if (isToday(date)) return `hoy ${format(date, 'HH:mm')}`;
  if (isTomorrow(date)) return `mañana ${format(date, 'HH:mm')}`;
  return format(date, "EEE d 'a las' HH:mm", { locale: es });
}

export function FollowupBadge({ conversationId }: { conversationId?: string | null }) {
  const { data } = useFollowupStatus(conversationId);
  // Ticker en vivo: refresca la cuenta regresiva cada 30s sin re-consultar la base.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!data?.active || !data.nextAt) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap',
        'bg-violet-500/15 text-violet-700 dark:text-violet-300',
      )}
      title={`La IA hará un seguimiento automático (intento ${data.attempt} de ${data.max}) si el cliente no responde. Se interrumpe si responde o si un humano toma la conversación.`}
    >
      <Repeat className="h-3 w-3 shrink-0" />
      Seguimiento IA {data.attempt}/{data.max} · {formatCountdown(data.nextAt, now)}
    </span>
  );
}

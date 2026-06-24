import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Chip compacto en el header: cuánto falta para que la IA RETOME la conversación por
 * inactividad del humano. El human-handback-cron devuelve a la IA las conversaciones
 * human_active/waiting_human sin actividad por `idleMinutes` (mide desde last_message_at).
 * Cada mensaje reinicia el timer. `idleMinutes` es configurable por organización.
 */
export function HandbackCountdown({
  lastActivityAt,
  status,
  idleMinutes = 30,
}: {
  lastActivityAt: string | null;
  status: string;
  idleMinutes?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  if (!lastActivityAt) return null;
  if (status !== 'human_active' && status !== 'waiting_human') return null;

  const remaining = new Date(lastActivityAt).getTime() + idleMinutes * 60_000 - now;
  const expired = remaining <= 0;
  const totalMin = Math.max(0, Math.ceil(remaining / 60_000));
  const label = expired ? 'IA retomando…' : totalMin >= 60 ? `IA en ${Math.floor(totalMin / 60)}h ${totalMin % 60}m` : `IA en ${totalMin}m`;
  const urgent = remaining < 10 * 60_000;
  const critical = remaining < 3 * 60_000;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap',
        expired || critical
          ? 'bg-red-500/15 text-red-600 dark:text-red-400'
          : urgent
            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
            : 'bg-muted text-muted-foreground',
      )}
      title={`Si no respondés, la IA retoma la conversación tras ${idleMinutes} min de inactividad`}
    >
      <Bot className="h-3 w-3 shrink-0" />
      {label}
    </span>
  );
}

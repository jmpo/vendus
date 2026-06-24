import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

// ⚠️ DEBE coincidir con IDLE_MINUTES de supabase/functions/human-handback-cron.
const IDLE_MINUTES = 30;

/**
 * Cuenta regresiva: cuánto falta para que la IA RETOME la conversación por inactividad
 * del humano. El cron devuelve a la IA las conversaciones human_active/waiting_human sin
 * actividad por IDLE_MINUTES (mide desde last_message_at). Cada mensaje reinicia el timer.
 */
export function HandbackCountdown({ lastActivityAt, status }: { lastActivityAt: string | null; status: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);

  if (!lastActivityAt) return null;
  if (status !== 'human_active' && status !== 'waiting_human') return null;

  const remaining = new Date(lastActivityAt).getTime() + IDLE_MINUTES * 60_000 - now;
  const expired = remaining <= 0;
  const mins = Math.max(0, Math.ceil(remaining / 60_000));
  const urgent = remaining < 10 * 60_000;
  const critical = remaining < 3 * 60_000;

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-1.5 text-[11px] py-1 border-t flex-shrink-0',
        expired || critical
          ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30'
          : urgent
            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30'
            : 'bg-muted/40 text-muted-foreground border-border',
      )}
      title="Si no respondés, la IA retoma la conversación para no dejar al cliente esperando"
    >
      <Bot className="h-3 w-3 shrink-0" />
      {expired ? (
        <span>La IA está por retomar la conversación…</span>
      ) : (
        <span>La IA retoma en <b>~{mins}m</b> si no respondés</span>
      )}
    </div>
  );
}

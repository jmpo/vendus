import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Cuenta regresiva en vivo de la ventana 24h de WhatsApp oficial.
 * Anclada a `lastInboundAt` (sentAt real del último mensaje del cliente).
 * Verde normal, ámbar < 2h, rojo < 30m. No muestra nada si ya está fuera (lo maneja la barra de plantilla).
 */
export function WindowCountdown({ lastInboundAt }: { lastInboundAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000); // refresca cada 30s
    return () => clearInterval(t);
  }, []);

  if (!lastInboundAt) return null;
  const remaining = new Date(lastInboundAt).getTime() + WINDOW_MS - now;
  if (remaining <= 0) return null;

  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const urgent = remaining < 2 * 3_600_000;
  const critical = remaining < 30 * 60_000;

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-1.5 text-[11px] py-1 border-t flex-shrink-0',
        critical
          ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30'
          : urgent
            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30'
            : 'bg-muted/40 text-muted-foreground border-border',
      )}
      title="Tiempo restante para responder con mensaje libre (sin plantilla)"
    >
      <Clock className="h-3 w-3 shrink-0" />
      <span>
        Ventana 24h: quedan <b>{h}h {String(m).padStart(2, '0')}m</b> para responder gratis
      </span>
    </div>
  );
}

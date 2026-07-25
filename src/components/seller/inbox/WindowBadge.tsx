import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Chip COMPACTO de la ventana 24h para el header del chat.
 * Complementa a WindowCountdown (la barra del composer), que se oculta cuando
 * atiende la IA. Anclado a lastInboundAt (último mensaje real del cliente).
 * Verde normal · ámbar < 2h · rojo cerrada (fuera de ventana → solo plantilla).
 */
export function WindowBadge({ lastInboundAt }: { lastInboundAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!lastInboundAt) return null;
  const remaining = new Date(lastInboundAt).getTime() + WINDOW_MS - now;

  // Fuera de ventana: avisar que solo se puede plantilla (chip rojo)
  if (remaining <= 0) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap bg-red-500/15 text-red-600 dark:text-red-400"
        title="Fuera de la ventana 24h: solo se puede enviar una plantilla aprobada"
      >
        <Clock className="h-3 w-3 shrink-0" />
        24h cerrada · solo plantilla
      </span>
    );
  }

  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const urgent = remaining < 2 * 3_600_000;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap',
        urgent ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'bg-muted text-muted-foreground',
      )}
      title="Tiempo restante de la ventana 24h — dentro de ella se puede mandar texto libre (hoy gratis)"
    >
      <Clock className="h-3 w-3 shrink-0" />
      Ventana 24h: {h}h {String(m).padStart(2, '0')}m
    </span>
  );
}

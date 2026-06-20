import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getImpersonation, stopImpersonation } from '@/hooks/useImpersonation';

/**
 * Banner fijo visible cuando el super admin está "viendo como" un cliente (soporte).
 * Deja claro que es una sesión de soporte y permite volver a Super Admin.
 */
export function ImpersonationBanner() {
  const info = getImpersonation();
  const [loading, setLoading] = useState(false);
  if (!info) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-[200] bg-amber-500 text-black text-xs sm:text-sm flex flex-wrap items-center justify-center gap-2 sm:gap-3 py-1.5 px-3 shadow-md">
      <span className="flex items-center gap-1.5 font-medium">
        <ShieldAlert className="h-4 w-4" />
        Soporte: viendo como <strong>{info.org_name}</strong> — los cambios afectan al cliente
      </span>
      <Button
        size="sm"
        variant="secondary"
        className="h-6 px-2 text-xs"
        disabled={loading}
        onClick={async () => { setLoading(true); try { await stopImpersonation(); } catch { setLoading(false); } }}
      >
        Volver a Super Admin
      </Button>
    </div>
  );
}

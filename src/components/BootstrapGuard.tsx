import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

/**
 * Verifica uma única vez se a plataforma já tem um Super Admin.
 * - Se NÃO tem: fuerza navegación para /setup.
 * - Se TEM e usuario está em /setup: redireciona para /login.
 *
 * Rotas públicas que no deben disparar setup (formularios, agendamento etc.)
 * ficam de fora do redirecionamento.
 */
const PUBLIC_PREFIXES = [
  '/setup',
  '/f/',
  '/c/',
  '/q/',
  '/agendar',
  '/confirmar',
  '/reagendar',
  '/vendas',
  '/unsubscribe',
  '/docs',
  '/install',
];

export function BootstrapGuard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (checked) return;
    let mounted = true;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('super-admin-status');
        if (!mounted) return;
        if (error) return;
        const hasSuperAdmin = !!data?.hasSuperAdmin;
        const path = location.pathname;
        if (!hasSuperAdmin && !path.startsWith('/setup')) {
          const isPublic = PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p));
          if (!isPublic) navigate('/setup', { replace: true });
        } else if (hasSuperAdmin && path.startsWith('/setup')) {
          navigate('/login', { replace: true });
        }
      } catch {
        // silencioso
      } finally {
        if (mounted) setChecked(true);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return null;
}

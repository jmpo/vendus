import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const DEFAULT_EMAILS = ['superadmin@vendus.com.br', 'admin@vendus.com.br'];

/**
 * Detecta se o super admin actual está usando credenciais predeterminado de instalación
 * (email predeterminado OU contraseña aún no trocada). Usado para forçar o modal de
 * primero acesso após o seed inicial em um remix.
 */
export function useSuperAdminFirstAccess() {
  const { user, isSuperAdmin } = useAuth();

  const query = useQuery({
    queryKey: ['platform-settings', 'first-access'],
    enabled: !!user?.id && isSuperAdmin(),
    queryFn: async () => {
      const [settingsRes, orgsRes] = await Promise.all([
        supabase
          .from('platform_settings')
          .select('default_password_changed, remix_setup_completed')
          .maybeSingle(),
        supabase
          .from('organizations')
          .select('*', { count: 'exact', head: true }),
      ]);
      if (settingsRes.error) throw settingsRes.error;
      return {
        settings: settingsRes.data as { default_password_changed?: boolean; remix_setup_completed?: boolean } | null,
        orgCount: orgsRes.count ?? 0,
      };
    },
  });

  const usingDefaultEmail = !!user?.email && DEFAULT_EMAILS.includes(user.email.toLowerCase());
  const settings = query.data?.settings ?? null;
  // Se a query terminou e no há registro em platform_settings, fuerza o wizard
  // (cenário de remix novo dónde a tabela aún está vacía).
  const noSettingsRow = !query.isLoading && !query.isError && settings == null;
  const passwordNotChanged =
    noSettingsRow || settings?.default_password_changed === false;
  const setupNotCompleted =
    noSettingsRow || settings?.remix_setup_completed === false;
  // Disparador extra: sin ninguna organización registrada, a plataforma aún
  // no fue configurada — fuerza o wizard mismo que platform_settings esteja "completo".
  const noOrganizations =
    !query.isLoading && !query.isError && (query.data?.orgCount ?? 0) === 0;

  // Wizard abre mientras a configuración inicial (contraseña + obligatorios) no estiver concluída.
  const shouldForceSetup =
    !!user?.id &&
    isSuperAdmin() &&
    !query.isLoading &&
    (passwordNotChanged || setupNotCompleted || noOrganizations);

  return {
    shouldForceSetup,
    usingDefaultEmail,
    passwordNotChanged,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

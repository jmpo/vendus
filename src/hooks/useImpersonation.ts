import { supabase } from '@/integrations/supabase/client';

const ORIGIN_KEY = 'sa_impersonation_origin';
const FLAG_KEY = 'sa_impersonation';

export interface ImpersonationInfo { org_name: string; at: number; }

export function getImpersonation(): ImpersonationInfo | null {
  try {
    const raw = localStorage.getItem(FLAG_KEY);
    return raw ? (JSON.parse(raw) as ImpersonationInfo) : null;
  } catch {
    return null;
  }
}

/**
 * Inicia impersonación: el super admin pasa a "ver como" el admin de la org.
 * Guarda su sesión original para poder volver.
 */
export async function startImpersonation(organizationId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('No hay sesión activa.');

  // Guardar sesión original (para volver)
  localStorage.setItem(ORIGIN_KEY, JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  }));

  const { data, error } = await supabase.functions.invoke('superadmin-impersonate', {
    body: { organization_id: organizationId },
  });
  if (error || !(data as any)?.token_hash) {
    localStorage.removeItem(ORIGIN_KEY);
    throw new Error((data as any)?.error || error?.message || 'No se pudo iniciar la impersonación.');
  }

  const { error: vErr } = await supabase.auth.verifyOtp({
    token_hash: (data as any).token_hash,
    type: 'magiclink',
  });
  if (vErr) {
    localStorage.removeItem(ORIGIN_KEY);
    throw vErr;
  }

  localStorage.setItem(FLAG_KEY, JSON.stringify({ org_name: (data as any).org_name, at: Date.now() }));
  window.location.href = '/';
}

/** Vuelve a la sesión original del super admin. */
export async function stopImpersonation(): Promise<void> {
  try {
    const raw = localStorage.getItem(ORIGIN_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      await supabase.auth.setSession({ access_token: o.access_token, refresh_token: o.refresh_token });
    }
  } finally {
    localStorage.removeItem(ORIGIN_KEY);
    localStorage.removeItem(FLAG_KEY);
    window.location.href = '/super-admin';
  }
}

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

// Llave PÚBLICA VAPID (la privada vive en secrets del backend).
const VAPID_PUBLIC_KEY = 'BEK_fL1xmr1fOTu8OI1MX8dlrVxQwdR7eL7PfzbhD87tPKqmwnmnwWRiPE3seaSS_jhfKgc5wAnB4SEo8CczQxg';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Notificaciones push del dispositivo (suenan aunque la app esté cerrada).
 * - Android/escritorio: funciona en el navegador y como PWA.
 * - iPhone: requiere la app instalada en la pantalla de inicio (iOS 16.4+).
 * Si el permiso ya fue dado, re-sincroniza la suscripción solo (sin preguntar).
 */
export function usePushNotifications() {
  const { user, profile } = useAuth();
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const syncSubscription = useCallback(async (): Promise<boolean> => {
    if (!supported || !user?.id) return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
      });
    }
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
    const { error } = await (supabase as any).from('push_subscriptions').upsert(
      {
        user_id: user.id,
        organization_id: profile?.organization_id ?? null,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        user_agent: navigator.userAgent.slice(0, 250),
      },
      { onConflict: 'endpoint' },
    );
    if (error) throw error;
    return true;
  }, [supported, user?.id, profile?.organization_id]);

  // Permiso ya otorgado → mantener la suscripción al día sin molestar.
  useEffect(() => {
    if (!supported || !user?.id) return;
    if (Notification.permission === 'granted') {
      syncSubscription().then((ok) => setEnabled(ok)).catch(() => {});
    }
  }, [supported, user?.id, syncSubscription]);

  /** Pide permiso (debe llamarse desde un click del usuario) y suscribe este dispositivo. */
  const enable = useCallback(async () => {
    if (!supported) {
      toast.error('Este navegador no soporta notificaciones push. En iPhone: instalá la app en la pantalla de inicio primero.');
      return false;
    }
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        toast.error('Permiso de notificaciones denegado. Activalo en la configuración del navegador.');
        return false;
      }
      const ok = await syncSubscription();
      setEnabled(ok);
      if (ok) toast.success('🔔 Notificaciones activadas en este dispositivo — te avisamos aunque la app esté cerrada.');
      return ok;
    } catch (e: any) {
      toast.error('No se pudo activar: ' + (e?.message ?? e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported, syncSubscription]);

  return {
    supported,
    enabled,
    busy,
    permission: supported ? Notification.permission : 'unsupported' as const,
    enable,
  };
}

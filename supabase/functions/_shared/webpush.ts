// Web Push compartido: envía notificaciones push a los dispositivos suscriptos
// (PWA instalada en el teléfono / navegador de escritorio) aunque la app esté CERRADA.
// Usa VAPID (secrets: VAPID_KEYS_JSON + VAPID_SUBJECT) vía @negrel/webpush.
// Las suscripciones viven en public.push_subscriptions (una por dispositivo).
import * as webpush from 'jsr:@negrel/webpush@0.3.0';

export interface PushPayload {
  title: string;
  body: string;
  /** Ruta a abrir al tocar la notificación (ej: /?tab=inbox) */
  url?: string;
  tag?: string;
}

let appServerPromise: Promise<webpush.ApplicationServer> | null = null;

function getAppServer(): Promise<webpush.ApplicationServer> {
  if (!appServerPromise) {
    appServerPromise = (async () => {
      const keysJson = Deno.env.get('VAPID_KEYS_JSON');
      if (!keysJson) throw new Error('VAPID_KEYS_JSON no configurado');
      const vapidKeys = await webpush.importVapidKeys(JSON.parse(keysJson), { extractable: false });
      return webpush.ApplicationServer.new({
        contactInformation: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
        vapidKeys,
      });
    })();
  }
  return appServerPromise;
}

/**
 * Envía un push a todos los dispositivos de los usuarios dados.
 * No lanza: los errores se loguean y las suscripciones muertas (410/404) se borran.
 */
export async function sendPushToUsers(
  sb: any,
  userIds: string[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;
  if (!userIds.length) return { sent, failed };
  try {
    const { data: subs } = await sb
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('user_id', userIds);
    if (!subs?.length) return { sent, failed };

    const server = await getAppServer();
    const body = JSON.stringify(payload);

    for (const s of subs as any[]) {
      try {
        const subscriber = server.subscribe({
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        });
        await subscriber.pushTextMessage(body, { ttl: 3600, urgency: webpush.Urgency.High });
        sent++;
        sb.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', s.id).then(() => {});
      } catch (e: any) {
        failed++;
        const msg = String(e?.message ?? e);
        // Suscripción vencida/eliminada por el navegador → limpiar
        if (/\b(404|410)\b/.test(msg) || e?.response?.status === 404 || e?.response?.status === 410) {
          try { await sb.from('push_subscriptions').delete().eq('id', s.id); } catch { /* noop */ }
        } else {
          console.warn('[webpush] envío falló:', msg.slice(0, 200));
        }
      }
    }
  } catch (e) {
    console.warn('[webpush] fallo no crítico:', e);
  }
  return { sent, failed };
}

// Minimal Service Worker — only purpose is to enable PWA installability.
// Does NOT cache anything. We deliberately avoid intercepting fetches so
// the live app is always served from the network and never stuck on an
// old bundle (which previously caused infinite spinners after deploys).

const SW_VERSION = '2026.07.24.1'; // + web push

self.addEventListener('install', (event) => {
  // Take over immediately so users don't have to close/reopen the PWA.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop any caches an older SW might have created.
    if (self.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    await self.clients.claim();
  })());
});

// Empty passthrough fetch handler — required for installability criteria,
// but we never short-circuit responses, so the network is always the source
// of truth.
self.addEventListener('fetch', () => {});

// Allow the page to ask for an immediate update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ── Web Push: notificaciones con la app CERRADA (teléfono y escritorio) ──────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Vendus', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Vendus';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-128x128.png',
      tag: data.tag || undefined,      // agrupa avisos del mismo tema
      renotify: !!data.tag,            // vuelve a sonar aunque reemplace uno anterior
      data: { url: data.url || '/?tab=inbox' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/?tab=inbox';
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Si la app ya está abierta, la enfocamos y navegamos; si no, abrimos ventana nueva.
    for (const c of clientsList) {
      if ('focus' in c) {
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(url); } catch (_) {} }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

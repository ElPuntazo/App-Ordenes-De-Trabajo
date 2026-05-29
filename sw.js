// ── El Puntazo – Service Worker ──────────────────────────────────────────────
// Versión: cambia este string para forzar actualización del caché
const CACHE_VERSION = 'puntazo-v1';

// Assets que se cachean al instalar (app shell)
const PRECACHE_ASSETS = [
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// ── INSTALL: precachear el app shell ────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      // Cachear uno a uno para que un fallo no rompa todo
      return Promise.allSettled(
        PRECACHE_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar cachés viejos ─────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: estrategia por tipo de recurso ───────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firebase y Anthropic API → siempre red (nunca cachear datos dinámicos)
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('anthropic.com') ||
    url.hostname.includes('trello.com') ||
    url.hostname.includes('wa.me')
  ) {
    return; // Deja pasar sin interceptar
  }

  // Fuentes de Google → Cache first (cambian poco)
  if (url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('fonts.googleapis.com')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // CDN scripts (jspdf, etc.) → Cache first
  if (url.hostname.includes('cdnjs.cloudflare.com')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // index.html y assets propios → Network first, caché como fallback offline
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(event.request));
    return;
  }
});

// Network first: intenta red, si falla usa caché
async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Sin red y sin caché: devolver página offline básica
    if (request.mode === 'navigate') {
      return cache.match('/index.html');
    }
    return new Response('Sin conexión', { status: 503 });
  }
}

// Cache first: sirve desde caché, actualiza en background
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) {
    // Actualizar en background sin bloquear
    fetch(request).then(r => { if (r.ok) cache.put(request, r); }).catch(() => {});
    return cached;
  }
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) cache.put(request, networkResponse.clone());
    return networkResponse;
  } catch {
    return new Response('Sin conexión', { status: 503 });
  }
}

// ── NOTIFICACIONES PUSH (preparado para el futuro) ───────────────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'El Puntazo', body: 'Tienes una orden pendiente' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'puntazo-notif',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});

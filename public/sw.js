const CACHE_NAME = 'z7i-runtime-v3';

const shouldCache = (requestUrl, destination) => {
  if (requestUrl.origin !== self.location.origin) return false;

  if (destination === 'image' || destination === 'font' || destination === 'script' || destination === 'style') {
    return true;
  }

  if (requestUrl.pathname.startsWith('/_next/static/')) return true;

  return (
    requestUrl.pathname.endsWith('.ico') ||
    requestUrl.pathname.endsWith('/manifest.webmanifest')
  );
};

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(
        () =>
          new Response(
            '<html><body><h1>Offline</h1><p>Please check your connection.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          )
      )
    );
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (!shouldCache(requestUrl, event.request.destination)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }

          const responseCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseCopy);
          });

          return networkResponse;
        })
        .catch(() => cachedResponse);

      if (cachedResponse) {
        event.waitUntil(networkFetch);
        return cachedResponse;
      }

      return networkFetch;
    })
  );
});

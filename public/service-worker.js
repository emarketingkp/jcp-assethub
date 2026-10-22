const CACHE = 'jcp-assethub-v2.8.0-navigation-1';
const CORE = [
  './','./index.html','./app.css','./store.js','./api-config.js','./api.js','./image.js','./code-scanner.js','./recognition-v27.js','./app.js',
  './manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png',
  './save-queue.js','./photo-picker.js','./input-assist.js','./data/input-knowledge.json','./asset-groups.js','./group-entry.js','./connection-status.js','./assets/connection-check.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('jcp-assethub-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if(event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if(event.data?.type === 'CLEAR_RUNTIME_CACHE') {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k.startsWith('jcp-assethub-')).map(k=>caches.delete(k)))));
  }
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // version.json and the app shell must never be allowed to hide a newer release.
  if(url.pathname.endsWith('/version.json') || url.pathname.endsWith('/service-worker.js')) {
    event.respondWith(fetch(event.request, {cache:'no-store'}));
    return;
  }

  if(event.request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname === '/') {
    event.respondWith(
      fetch(event.request, {cache:'no-cache'})
        .then(response => { const copy=response.clone(); caches.open(CACHE).then(c=>c.put('./index.html',copy)); return response; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Local static files are network-first with an offline fallback. Firebase headers
  // force revalidation, while the service worker keeps the last working build usable.
  event.respondWith(
    fetch(event.request, {cache:'no-cache'})
      .then(response => {
        if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

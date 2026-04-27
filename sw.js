const CACHE_NAME = 'safezone-shell-v6';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './edge-ai.css',
  './app.js',
  './ncrb-data.js',
  './edge-ai.js',
  './manifest.json',
  './icon.svg'
];

const CACHEABLE_PATH_SUFFIXES = new Set([
  '/',
  '/index.html',
  '/style.css',
  '/edge-ai.css',
  '/app.js',
  '/ncrb-data.js',
  '/edge-ai.js',
  '/manifest.json',
  '/icon.svg'
]);

function isSafeCacheableResponse(response) {
  return Boolean(response && response.ok && response.type === 'basic');
}

function isCacheableShellRequest(request, requestUrl) {
  if (!request || !requestUrl) return false;
  if (request.method !== 'GET') return false;
  const workerScope = (typeof globalThis !== 'undefined' && globalThis.self)
    ? globalThis.self
    : (typeof self !== 'undefined' ? self : null);
  const scopeOrigin = (workerScope && workerScope.location && workerScope.location.origin)
    ? workerScope.location.origin
    : '';
  if (scopeOrigin && requestUrl.origin !== scopeOrigin) return false;

  // Prevent caching dynamic URLs with query strings to reduce poisoning/staleness.
  if (requestUrl.search) return false;

  if (request.mode === 'navigate') return true;
  return CACHEABLE_PATH_SUFFIXES.has(requestUrl.pathname);
}

async function cacheShellResponse(requestKey, response) {
  if (!isSafeCacheableResponse(response)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(requestKey, response.clone());
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(
        keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key)))
      ))
    );
    self.clients.claim();
  });

  self.addEventListener('fetch', (event) => {
    const requestUrl = new URL(event.request.url);

    if (!isCacheableShellRequest(event.request, requestUrl)) {
      return;
    }

    const isNavigation = event.request.mode === 'navigate';
    if (isNavigation) {
      event.respondWith(
        fetch(event.request)
          .then(async (networkResponse) => {
            await cacheShellResponse('./index.html', networkResponse);
            return networkResponse;
          })
          .catch(() => caches.match('./index.html'))
      );
      return;
    }

    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
        const networkFetch = fetch(event.request)
          .then(async (networkResponse) => {
            await cacheShellResponse(event.request, networkResponse);
            return networkResponse;
          })
          .catch(() => null);

        return cachedResponse || networkFetch.then((response) => response || caches.match('./index.html'));
      })
    );
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CACHE_NAME,
    isSafeCacheableResponse,
    isCacheableShellRequest
  };
}
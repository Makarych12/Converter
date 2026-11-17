/* Convector service worker: офлайн-оболочка (stale-while-revalidate) + кэш ответов API (network-first). */

const VERSION = 'v1';
const SHELL = `convector-shell-${VERSION}`;
const API = `convector-api-${VERSION}`;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/parser.js',
  './js/currencies.js',
  './js/format.js',
  './js/rates.js',
  './js/history.js',
  './js/charts.js',
  './js/clipboard.js',
  './js/storage.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

const API_HOSTS = ['api.frankfurter.dev', 'cdn.jsdelivr.net', 'currency-api.pages.dev', 'api.coingecko.com'];
const API_CACHE_LIMIT = 150;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('convector-') && ![SHELL, API].includes(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request.mode === 'navigate' ? './' : request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || (request.mode === 'navigate' ? cache.match('./') : Response.error());
}

async function networkFirst(request) {
  const cache = await caches.open(API);
  try {
    const res = await fetch(request);
    if (res.ok) {
      await cache.put(request, res.clone());
      trim(API, API_CACHE_LIMIT);
    }
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
  } else if (API_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) {
    event.respondWith(networkFirst(request));
  }
});

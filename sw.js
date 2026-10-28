/* Service Worker — مصروفاتي B (العمل بدون إنترنت) */
const VERSION = '2026-10-29.7900';
const CACHE_PREFIX = 'masrofati-b-v';
const CACHE = CACHE_PREFIX + VERSION;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'favicon-48.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png'
];
// مصادر خارجية بنخزّنها (خطوط + مكتبات Firebase). أي حاجة تانية (أسعار الذهب، Firestore...) بتعدّي للنت عادي.
const CACHEABLE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // نخزّن كل ملف لوحده عشان فشل ملف واحد ما يوقفش التثبيت كله
    await Promise.all(SHELL.map(async (u) => {
      try { const r = await fetch(new Request(u, { cache: 'reload' })); if (r && r.ok) await cache.put(u, r); } catch (e) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function shellFromCache() {
  const cache = await caches.open(CACHE);
  return (await cache.match('./', { ignoreSearch: true })) ||
         (await cache.match('index.html', { ignoreSearch: true })) ||
         (await caches.match('./', { ignoreSearch: true })) ||
         (await caches.match('index.html', { ignoreSearch: true }));
}

// صفحة التطبيق: نجرّب النت بسرعة (عشان التحديثات توصل)، ولو مفيش نت أو بطيء نفتح من التخزين فورًا
async function handleNavigate(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then(async (res) => {
    if (res && res.ok) { try { await cache.put('./', res.clone()); } catch (e) {} }
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 2500));
  try {
    const first = await Promise.race([network, timeout]);
    if (first && first.ok) return first;
    const cached = await shellFromCache();
    if (cached) { network.catch(() => {}); return cached; }
    return await network;
  } catch (e) {
    const cached = await shellFromCache();
    if (cached) return cached;
    return new Response('<meta charset="utf-8"><body dir="rtl" style="font-family:sans-serif;padding:24px">التطبيق محتاج يتفتح مرة واحدة بالإنترنت عشان يشتغل بدون نت.</body>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
}

// باقي الملفات: من التخزين فورًا وتتحدّث في الخلفية
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const fetching = fetch(request).then(async (res) => {
    if (res && (res.ok || res.type === 'opaque')) { try { await cache.put(request, res.clone()); } catch (e) {} }
    return res;
  }).catch(() => null);
  if (cached) { fetching.catch(() => {}); return cached; }
  const res = await fetching;
  return res || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') { event.respondWith(handleNavigate(req)); return; }
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (CACHEABLE_HOSTS.indexOf(url.hostname) > -1) { event.respondWith(staleWhileRevalidate(req)); }
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

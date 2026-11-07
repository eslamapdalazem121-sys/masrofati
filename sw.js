/* Service Worker — أموالي AtoZ (العمل بدون إنترنت) */
const VERSION = '2026-11-07.8329';
// كاش مستقل لكل نسخة/مجلد (مش بيمسح كاش النسخ التانية)
const SCOPE_ID = ((self.registration && self.registration.scope) || self.location.href).replace(/[^a-z0-9]+/gi, '-');
const CACHE_PREFIX = 'amwali-' + SCOPE_ID + '-';
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
// أقصى وقت نستناه النت لما مفيش نسخة محفوظة (يمنع التعليق لو الواي فاي متصل من غير إنترنت)
const NET_WAIT_MS = 4000;

// رد جه بعد تحويل (redirect) المتصفح بيرفض يرجّعه لصفحة التطبيق من التخزين، فبنخزّن منه نسخة نظيفة
async function cleanCopy(res) {
  if (!res || !res.redirected) return res;
  const body = await res.clone().blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}
function offlineNow() { try { return self.navigator && self.navigator.onLine === false; } catch (e) { return false; } }

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // نخزّن كل ملف لوحده عشان فشل ملف واحد (غير الصفحة نفسها) ما يوقفش التثبيت
    const got = await Promise.all(SHELL.map(async (u) => {
      try { const r = await fetch(new Request(u, { cache: 'reload' })); if (r && r.ok) { await cache.put(u, await cleanCopy(r)); return true; } } catch (e) {}
      return false;
    }));
    // لو صفحة التطبيق نفسها ما اتخزّنتش، نلغي التثبيت: النسخة الشغّالة قبلها (وكاشها) تفضل زي ما هي بدل ما يبقى عندنا كاش فاضي
    if (!got[0] && !got[1]) { await caches.delete(CACHE); throw new Error('shell not cached'); }
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

const OFFLINE_FALLBACK = () => new Response('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body dir="rtl" style="font-family:sans-serif;padding:24px">التطبيق محتاج يتفتح مرة واحدة بالإنترنت عشان يشتغل بدون نت.</body>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });

// صفحة التطبيق: مفيش نت → من التخزين فورًا. فيه نت → نجرّب بسرعة (عشان التحديثات توصل) ولو بطيء أو فشل نفتح من التخزين
async function handleNavigate(request) {
  const cache = await caches.open(CACHE);
  if (offlineNow()) {
    const cachedNow = await shellFromCache();
    if (cachedNow) return cachedNow;
  }
  const network = fetch(request).then(async (res) => {
    if (res && res.ok) { try { await cache.put('./', await cleanCopy(res.clone())); } catch (e) {} }
    return res;
  });
  network.catch(() => {});
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 2500));
  try {
    const first = await Promise.race([network, timeout]);
    if (first && first.ok) return first;
    const cached = await shellFromCache();
    if (cached) return cached;
    return (await network) || OFFLINE_FALLBACK();
  } catch (e) {
    const cached = await shellFromCache();
    return cached || OFFLINE_FALLBACK();
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
  if (cached) { return cached; }
  if (offlineNow()) return new Response('', { status: 504 });
  const waited = await Promise.race([fetching, new Promise((resolve) => setTimeout(() => resolve(null), NET_WAIT_MS))]);
  return waited || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') { event.respondWith(handleNavigate(req)); return; }
    // طلب فحص النسخة الجديدة (index.html?_=رقم) لازم يروح للنت مباشرة: لو رجّعناله النسخة المخزّنة مش هيشوف أي تحديث، ولو خزّناه الكاش هيكبر مع كل فتحة
    if (url.searchParams.has('_')) return;
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (CACHEABLE_HOSTS.indexOf(url.hostname) > -1) { event.respondWith(staleWhileRevalidate(req)); }
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});

// إشعارات السيرفر (FCM) حتى والتطبيق مقفول. لو التطبيق مفتوح قدامك بنسيبه هو اللي ينبّه.
self.addEventListener('push', (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch (e) { try { p = { data: { body: event.data.text() } }; } catch (e2) {} }
  const d = (p && p.data) || p || {};
  const title = d.title || (p.notification && p.notification.title) || 'أموالي AtoZ';
  const body = d.body || (p.notification && p.notification.body) || '';
  if (!body) return;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (list.some((c) => c.visibilityState === 'visible' && c.focused)) return;
    await self.registration.showNotification(title, { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag || d.id || 'push', lang: 'ar', dir: 'rtl', vibrate: [200, 100, 200] });
  })());
});

// لو المتصفح جدّد/غيّر اشتراك الإشعارات، نفتح التطبيق يجدد التصريح تلقائي أول ما يتفتح
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    list.forEach((c) => { try { c.postMessage({ type: 'PUSH_RENEW' }); } catch (e) {} });
  })());
});

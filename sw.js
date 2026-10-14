// مصروفاتي B — Service Worker
// الصفحة نفسها: بتفتح فورًا من الجهاز (حتى لو النت ضعيف أو واقع)، وفي الخلفية بتتحدّث لو فيه نت (التحديث بيظهر في الفتحة اللي بعدها).
// باقي ملفات الموقع (أيقونات...): من التخزين أولًا.
// خطوط جوجل: بتتخزن أول مرة وبعدها بتتفتح من التخزين (عشان الشكل يفضل زي ما هو بدون نت).
const CACHE = 'masrofati-b-v7';
const FONT_CACHE = 'masrofati-b-fonts-v1';
const ASSETS = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './favicon-48.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com']; // الخطوط + مكتبة Firebase (بتتخزن عشان تشتغل بدون نت)

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function fontStrategy(event, req) {
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(req);
  const update = fetch(req).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  });
  if (hit) {
    event.waitUntil(update.catch(() => {})); // نجدّد النسخة المخزّنة في الخلفية
    return hit;
  }
  try {
    return await update;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

// بعض الاستضافات (زي Netlify) بتحوّل /index.html لـ / — والمتصفح بيرفض رد فيه "تحويل" لطلب فتح صفحة.
// عشان كده بنخزّن/نرد الصفحة دايمًا في نسخة نضيفة من غير علامة التحويل.
async function cleanResponse(res) {
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}
// نتأكد إن الرد هو التطبيق فعلًا (مش صفحة دخول شبكة واي فاي ولا صفحة خطأ) قبل ما نخزّنه
async function looksLikeApp(res) {
  try { return (await res.clone().text()).indexOf('id="appRoot"') !== -1; } catch (e) { return false; }
}
async function readShell(cache) {
  const hit = (await cache.match('./')) || (await cache.match('./index.html'));
  return hit ? cleanResponse(hit) : null;
}

async function navigationStrategy(event, req) {
  const cache = await caches.open(CACHE);
  const cached = await readShell(cache);
  const update = fetch(req).then(async (res) => {
    // نخزّن النسخة الجديدة بس لو سليمة (مش صفحة خطأ ولا تحويل)
    if (res && res.ok && res.type === 'basic' && (await looksLikeApp(res))) cache.put('./', await cleanResponse(res.clone()));
    return res;
  });
  if (cached) {
    event.waitUntil(update.catch(() => {})); // نجدّد في الخلفية من غير ما نستنى الشبكة
    return cached;
  }
  try {
    return await update;
  } catch (e) {
    return new Response('<!doctype html><meta charset="utf-8"><h2 style="font-family:sans-serif;text-align:center;margin-top:30vh">افتح التطبيق مرة واحدة وإنت متصل بالنت عشان يشتغل بدون إنترنت</h2>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // فحص النسخة الجديدة (fetch بـ no-store من نفس الموقع) لازم يروح للشبكة مش للتخزين — لكن فتح الصفحة/الريفريش والخطوط بيتعاملوا دايمًا
  if (url.origin === location.origin && req.mode !== 'navigate' && (req.cache === 'no-store' || req.cache === 'reload')) return;

  if (FONT_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(fontStrategy(event, req));
    return;
  }
  if (url.origin !== location.origin) return; // أي موقع تاني يعدّي عادي

  if (req.mode === 'navigate') {
    event.respondWith(navigationStrategy(event, req));
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }))
  );
});

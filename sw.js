// مصروفاتي B — Service Worker (عمل بدون إنترنت + تحديث تلقائي للصفحة)
const CACHE = 'masrofati-b-v22';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-48.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf('masrofati-b-v') === 0 && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // الصفحة نفسها: الأحدث من النت لو متاح، وإلا النسخة المخزنة
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); }
        return res;
      }).catch(() => caches.match('./').then((r) => r || caches.match('index.html')))
    );
    return;
  }

  // الخطوط ومكتبات Firebase: من الجهاز أولًا ثم تتحدّث
  const isStatic = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'www.gstatic.com';
  if (isStatic || url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
});

// الضغط على إشعار العملية يفتح التطبيق
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow('./');
    })
  );
});

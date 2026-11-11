// Service worker for the installable app.
// "Network first": always load the newest files from the internet, and only use
// the saved copy when the phone is offline. Firebase / CDN requests are untouched.
const CACHE = 'rsjjyc-v20';
const CORE = ['index.html', 'member.html', 'admin.html', 'verify.html', 'pay-soon.html', 'install.html', 'style.css', 'logo.png', 'icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined))),
  );
});

// ---------------------------------------------------------------------------
// Payment reminders (7, 5, 3 days before the due date, then daily while overdue)
// The member dashboard saves the next due date in the 'rsjjyc-reminders' cache.
// ---------------------------------------------------------------------------
const RC = 'rsjjyc-reminders';
async function rjson(key, value) {
  const c = await caches.open(RC);
  if (value === undefined) { const r = await c.match(key); return r ? r.json() : null; }
  await c.put(key, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
}
async function dueCheck() {
  const info = await rjson('due-info');
  if (!info || info.none || !info.due) return;
  const [y, m, d] = info.due.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((new Date(y, m - 1, d) - today) / 86400000);
  const ms = days < 0 ? 'overdue' : days <= 3 ? 3 : days <= 5 ? 5 : days <= 7 ? 7 : null;
  if (!ms) return;
  const key = ms === 'overdue' ? `${info.month}-overdue-${today.toISOString().slice(0, 10)}` : `${info.month}-${ms}`;
  const sent = (await rjson('sent')) || {};
  if (sent[key]) return;
  const amt = 'NPR ' + Number(info.amount || 0).toLocaleString('en-IN');
  const body = days < 0
    ? `Your ${amt} contribution (${info.label}) is overdue. Please pay and upload the receipt.`
    : days === 0 ? `Your ${amt} contribution (${info.label}) is due today.` : `Your ${amt} contribution (${info.label}) is due in ${days} day(s).`;
  await self.registration.showNotification(days < 0 ? '⚠ RSJJYC payment overdue' : '🔔 RSJJYC payment reminder',
    { body: body + ' Tap to pay.', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'rsjjyc-due', data: { url: 'member.html' } });
  sent[key] = Date.now();
  await rjson('sent', sent);
}
self.addEventListener('periodicsync', (e) => { if (e.tag === 'rsjjyc-due-check') e.waitUntil(dueCheck()); });
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || 'member.html', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => c.url.startsWith(self.registration.scope));
    return w ? w.navigate(url).then((c) => c && c.focus()) : self.clients.openWindow(url);
  }));
});

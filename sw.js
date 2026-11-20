/* DiaMetric service worker — offline-schil, privacyvriendelijk.
   Cachet alleen de eigen app-bestanden (schil). Verzoeken naar je Nightscout
   (cross-origin) worden NOOIT onderschept of bewaard: die gaan altijd live en
   blijven buiten deze cache. Data zelf leeft in IndexedDB, niet hier. */
const VERSION = 'v44';
const CACHE = 'diametric-shell-' + VERSION;
const SHELL = ['./', './index.html', './css/ida4.css', './fonts/Geist-Variable.woff2', './fonts/GeistMono-Variable.woff2', './js/core.js', './js/ida.js', './js/ida2.js', './js/ida3.js', './js/ida4.js', './js/ida5.js', './js/moments.js', './js/push.js', './js/state.js', './manifest.json', './icon.svg', './icon-180.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Alleen onze eigen oorsprong. Nightscout e.d. laten we volledig met rust.
  if (url.origin !== self.location.origin) return;

  // Navigatie (de app openen): eerst het net proberen zodat updates binnenkomen,
  // bij geen verbinding terugvallen op de gecachte schil.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          caches.open(CACHE).then((c) => c.put('./index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Overige eigen bestanden (icoon, manifest): meteen uit cache, op de
  // achtergrond verversen (stale-while-revalidate).
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Meldingen van een meldingenserver (Web Push). De server stuurt { title, body, tag, url, rise? }.
// Bij "stijging zonder eten" komen er knoppen bij: eten vastleggen in één tik.
function _idaOpts(d) {
  const o = { body: d.body || '', tag: d.tag || 'ida', icon: 'icon-180.png', badge: 'icon-180.png', data: { url: d.url || './', rise: d.rise || null } };
  if (d.rise) o.actions = [d.rise.grams ? { action: 'g', title: `Ja, ~${d.rise.grams} g` } : { action: 'open', title: 'Ja, invullen' }, { action: 'nee', title: 'Nee' }];
  return o;
}
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'IDA', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'IDA', _idaOpts(d)));
});

// Tik op een melding (of een knop): open IDA en geef het antwoord door
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {}, r = data.rise;
  let url = new URL(data.url || './', self.registration.scope);
  let msg = null;
  if (r && (e.action === 'g' || e.action === 'nee')) { msg = { type: 'ida-rise', t0: r.t0, g: e.action === 'nee' ? 0 : r.grams }; url.searchParams.set('rise', r.t0); url.searchParams.set('g', msg.g); }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.startsWith(self.registration.scope) && 'focus' in c) { if (msg) c.postMessage(msg); return c.focus(); } }
    return self.clients.openWindow(url.href);
  }));
});

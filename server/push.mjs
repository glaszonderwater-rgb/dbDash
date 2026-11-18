// IDA meldingenserver — leest Nightscout en stuurt een melding vóór het moment.
// Gebruikt exact dezelfde regels als de app (js/moments.js). Schrijft nooit iets naar Nightscout.
//
// Twee manieren om te draaien:
//   node server/push.mjs           → één controle (voor GitHub Actions of cron; geen geheugen nodig)
//   node server/push.mjs --serve   → eigen server: controleert elke 5 min en neemt aanmeldingen aan op /subscribe
//
// Instellingen via omgevingsvariabelen (nooit in code of chat):
//   NS_URL            adres van je Nightscout, bv. https://jouw-ns.example
//   NS_TOKEN          Nightscout-token met alleen leesrechten (readable)
//   VAPID_PUBLIC      publieke sleutel  (maak met: npx web-push generate-vapid-keys)
//   VAPID_PRIVATE     geheime sleutel
//   VAPID_SUBJECT     mailto:jouw@adres
//   PUSH_SUBSCRIPTIONS  JSON-lijst met aanmeldingen (uit IDA › Instellingen › "Aanmelden en kopiëren")
//   TZ_OFFSET_MIN     optioneel: vaste tijdzone in minuten (bv. 60); anders wordt de offset uit Nightscout gelezen
//   INTERVAL_MIN      hoe vaak er gecontroleerd wordt (standaard 10; zelfde als je cron)
//   PORT, SUBS_FILE   alleen voor --serve
//   SUBSCRIBE_PATH    alleen voor --serve, verplicht: een lang willekeurig woord. In IDA vul je als server
//                     https://jouw-server/<SUBSCRIBE_PATH> in. Zo kan niet iedereen zich aanmelden voor jouw meldingen.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
const require = createRequire(import.meta.url);
const { idaMoments, newMoments } = require('../js/moments.js');

const env = process.env, MIN = 60e3, DAY = 864e5;
const MG = 18.0182;

async function ns(path, params) {
  const u = new URL(env.NS_URL.replace(/\/+$/, '') + path);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  if (env.NS_TOKEN) u.searchParams.set('token', env.NS_TOKEN);
  const r = await fetch(u, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`Nightscout ${path}: ${r.status}`);
  return r.json();
}

async function loadData(now) {
  const from = now - 30 * DAY;
  const [entries, treatments] = await Promise.all([
    ns('/api/v1/entries/sgv.json', { 'find[date][$gte]': from, count: 12000 }),
    ns('/api/v1/treatments.json', { 'find[created_at][$gte]': new Date(from).toISOString(), count: 8000 }),
  ]);
  const glucose = entries.filter(e => e.sgv > 20).map(e => ({ ts: e.date, bg: e.sgv / MG })).sort((a, b) => a.ts - b.ts);
  const tr = treatments.map(t => ({
    ts: Date.parse(t.created_at), carbs: +t.carbs || 0, insulin: +t.insulin || 0,
    isSMB: !!t.isSMB || t.type === 'SMB', notes: t.notes || '', utcOffset: t.utcOffset,
  })).filter(t => isFinite(t.ts)).sort((a, b) => a.ts - b.ts);
  const lastOff = [...tr].reverse().find(t => typeof t.utcOffset === 'number');
  const off = env.TZ_OFFSET_MIN != null ? +env.TZ_OFFSET_MIN : (lastOff ? lastOff.utcOffset : 0);
  return { glucose, treatments: tr, off };
}

function subs(file) {
  let list = [];
  try { list = JSON.parse(env.PUSH_SUBSCRIPTIONS || '[]'); if (!Array.isArray(list)) list = [list]; } catch (_) { }
  if (file && existsSync(file)) try { list = list.concat(JSON.parse(readFileSync(file, 'utf8'))); } catch (_) { }
  const seen = new Set(); return list.filter(s => s && s.endpoint && !seen.has(s.endpoint) && seen.add(s.endpoint));
}

async function check({ stateless, sent, file }) {
  const now = Date.now();
  const { glucose, treatments, off } = await loadData(now);
  const opts = { now, tzOffsetMin: off };
  const iv = (+env.INTERVAL_MIN || 10) * MIN;
  const list = stateless ? newMoments(glucose, treatments, opts, iv) : idaMoments(glucose, treatments, opts).filter(m => !sent.has(m.key));
  if (!list.length) { console.log('Geen nieuw moment.'); return; }
  const webpush = (await import('web-push')).default;
  webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:ida@example.invalid', env.VAPID_PUBLIC, env.VAPID_PRIVATE);
  for (const m of list) {
    for (const s of subs(file)) {
      try { await webpush.sendNotification(s, JSON.stringify({ title: m.title, body: m.body, tag: m.key, url: './' }), { TTL: 1800, urgency: 'high' }); }
      catch (e) { console.error('Melding mislukt:', e.statusCode || e.message); }
    }
    sent && sent.add(m.key); console.log('Verstuurd:', m.key);
  }
}

const missing = ['NS_URL', 'VAPID_PUBLIC', 'VAPID_PRIVATE'].filter(k => !env[k]);
if (missing.length) { console.log('Meldingenserver niet ingesteld (ontbreekt: ' + missing.join(', ') + '). Niets te doen.'); process.exit(0); }

if (process.argv.includes('--serve')) {
  if (!env.SUBSCRIBE_PATH || env.SUBSCRIBE_PATH.length < 16) { console.error('Zet SUBSCRIBE_PATH (minstens 16 tekens).'); process.exit(1); }
  const file = env.SUBS_FILE || 'subscriptions.json', sent = new Set();
  const save = s => { const l = subs(file).filter(x => x.endpoint !== s.endpoint); l.push(s); writeFileSync(file, JSON.stringify(l.filter(x => !(env.PUSH_SUBSCRIPTIONS || '').includes(x.endpoint)), null, 1)); };
  createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method === 'POST' && req.url === `/${env.SUBSCRIBE_PATH}/subscribe`) {
      let b = ''; req.on('data', c => { b += c; if (b.length > 1e4) req.destroy(); });
      req.on('end', () => { try { const s = JSON.parse(b); if (!s.endpoint || !/^https:\/\//.test(s.endpoint)) throw 0; save(s); res.writeHead(201, cors); res.end('ok'); } catch (_) { res.writeHead(400, cors); res.end('ongeldig'); } });
      return;
    }
    res.writeHead(200, { ...cors, 'content-type': 'text/plain' }); res.end('IDA meldingenserver');
  }).listen(+env.PORT || 8787, () => console.log('Luistert op poort', +env.PORT || 8787));
  const tick = () => check({ stateless: false, sent, file }).catch(e => console.error(e.message));
  tick(); setInterval(tick, 5 * MIN);
  setInterval(() => sent.clear(), DAY);
} else {
  await check({ stateless: true }).catch(e => { console.error(e.message); process.exit(1); });
}

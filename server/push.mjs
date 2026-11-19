// IDA meldingenserver — leest Nightscout en stuurt een melding vóór het moment.
// Gebruikt exact dezelfde regels als de app: server/moments.cjs is een kopie van js/moments.js (test/momentcheck.mjs bewaakt dat). Schrijft nooit iets naar Nightscout.
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
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  optioneel: aanmeldingen en verstuurde meldingen bewaren in Supabase
//                     (tabellen: zie server/supabase.sql). Aanrader op Railway: daar verdwijnen lokale bestanden bij elke herstart.
//   PORT, SUBS_FILE   alleen voor --serve
//   SUBSCRIBE_PATH    alleen voor --serve, verplicht: een lang willekeurig woord. In IDA vul je als server
//                     https://jouw-server/<SUBSCRIBE_PATH> in. Zo kan niet iedereen zich aanmelden voor jouw meldingen.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
const require = createRequire(import.meta.url);
const { idaMoments, newMoments } = require('./moments.cjs');

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

// ── Opslag: Supabase (blijft bewaard bij herstart op Railway) of een lokaal bestand ──
const SB = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1' : null;
async function sb(path, init) {
  const r = await fetch(SB + path, { ...init, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, ...(env.SUPABASE_SERVICE_ROLE_KEY.startsWith('eyJ') ? { authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY } : {}), 'content-type': 'application/json', ...(init && init.headers) } });
  if (!r.ok) throw new Error(`Supabase ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}
const store = {
  async subs(file) {
    let list = [];
    try { list = JSON.parse(env.PUSH_SUBSCRIPTIONS || '[]'); if (!Array.isArray(list)) list = [list]; } catch (_) { }
    if (SB) { try { list = list.concat((await sb('/ida_push_subscriptions?select=sub')).map(r => r.sub)); } catch (e) { console.error(e.message); } }
    else if (file && existsSync(file)) try { list = list.concat(JSON.parse(readFileSync(file, 'utf8'))); } catch (_) { }
    const seen = new Set(); return list.filter(s => s && s.endpoint && !seen.has(s.endpoint) && seen.add(s.endpoint));
  },
  async addSub(s, file) {
    if (SB) return sb('/ida_push_subscriptions?on_conflict=endpoint', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ endpoint: s.endpoint, sub: s }) });
    const l = (await this.subs(file)).filter(x => x.endpoint !== s.endpoint && !(env.PUSH_SUBSCRIPTIONS || '').includes(x.endpoint)); l.push(s);
    writeFileSync(file, JSON.stringify(l, null, 1));
  },
  async dropSub(endpoint, file) {
    if (SB) return sb('/ida_push_subscriptions?endpoint=eq.' + encodeURIComponent(endpoint), { method: 'DELETE' });
    if (file && existsSync(file)) try { writeFileSync(file, JSON.stringify(JSON.parse(readFileSync(file, 'utf8')).filter(x => x.endpoint !== endpoint), null, 1)); } catch (_) { }
  },
  // Back-up van de app (instellingen + logboek): één document
  async getState(file) {
    if (SB) { const r = await sb('/ida_state?select=data,updated_at&id=eq.main'); return r && r[0] ? { ...r[0].data, serverAt: r[0].updated_at } : null; }
    const f = (file || 'subscriptions.json').replace(/[^/]+$/, 'state.json');
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  },
  async putState(data, file) {
    if (SB) return sb('/ida_state?on_conflict=id', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ id: 'main', data, updated_at: new Date().toISOString() }) });
    writeFileSync((file || 'subscriptions.json').replace(/[^/]+$/, 'state.json'), JSON.stringify(data));
  },
  async wasSent(key, mem) {
    if (mem.has(key)) return true;
    if (SB) { try { const r = await sb('/ida_push_sent?select=key&key=eq.' + encodeURIComponent(key)); if (r && r.length) { mem.add(key); return true; } } catch (e) { console.error(e.message); } }
    return false;
  },
  async markSent(key, mem) {
    mem.add(key);
    if (SB) try { await sb('/ida_push_sent', { method: 'POST', headers: { prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ key }) }); } catch (e) { console.error(e.message); }
  },
};

const status = { started: new Date().toISOString(), lastCheck: null, lastError: null, lastSent: null, checks: 0 };
async function check({ stateless, sent, file }) {
  const now = Date.now(); status.checks++;
  const { glucose, treatments, off } = await loadData(now);
  status.lastCheck = new Date(now).toISOString(); status.lastGlucose = glucose.length ? new Date(glucose[glucose.length - 1].ts).toISOString() : null; status.lastError = null;
  // logboek en uitgezette meldingen uit de back-up van de app; actieve insuline uit de laatste loopstatus
  let anns = [], mute = [], iob = null;
  try { const st = await store.getState(file); if (st) { anns = st.annotations || []; mute = (st.cfg && st.cfg.mute5) || []; } } catch (e) { console.error(e.message); }
  try { const ds = await ns('/api/v1/devicestatus.json', { count: 3 }); for (const d of ds) { const oa = d.openaps || {}, io = Array.isArray(oa.iob) ? oa.iob[0] : oa.iob; const v = io && +io.iob; if (isFinite(v) && Date.parse(d.created_at) > now - 15 * MIN) { iob = v; break; } } } catch (e) { console.error(e.message); }
  const opts = { now, tzOffsetMin: off, anns, mute, iob };
  const iv = (+env.INTERVAL_MIN || 10) * MIN;
  let list = stateless ? newMoments(glucose, treatments, opts, iv) : idaMoments(glucose, treatments, opts);
  if (!stateless) { const keep = []; for (const m of list) if (!(await store.wasSent(m.key, sent))) keep.push(m); list = keep; }
  if (!list.length) { console.log('Geen nieuw moment.'); return; }
  const webpush = (await import('web-push')).default;
  webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:ida@example.invalid', env.VAPID_PUBLIC, env.VAPID_PRIVATE);
  const targets = await store.subs(file);
  for (const m of list) {
    let ok = 0;
    for (const s of targets) {
      try { await webpush.sendNotification(s, JSON.stringify({ title: m.title, body: m.body, tag: m.key, url: './' }), { TTL: 1800, urgency: 'high' }); ok++; }
      catch (e) { console.error('Melding mislukt:', e.statusCode || e.message); if (e.statusCode === 404 || e.statusCode === 410) await store.dropSub(s.endpoint, file); }
    }
    if (sent) await store.markSent(m.key, sent);
    status.lastSent = { key: m.key, at: new Date().toISOString(), ok, of: targets.length };
    console.log(`Verstuurd: ${m.key} (${ok}/${targets.length})`);
  }
}

const missing = ['NS_URL', 'VAPID_PUBLIC', 'VAPID_PRIVATE'].filter(k => !env[k]);
if (missing.length) { console.log('Meldingenserver niet ingesteld (ontbreekt: ' + missing.join(', ') + '). Niets te doen.'); process.exit(0); }

if (process.argv.includes('--serve')) {
  if (!env.SUBSCRIBE_PATH || env.SUBSCRIBE_PATH.length < 16) { console.error('Zet SUBSCRIBE_PATH (minstens 16 tekens).'); process.exit(1); }
  const file = env.SUBS_FILE || 'subscriptions.json', sent = new Set();
  console.log('Opslag:', SB ? 'Supabase' : 'bestand ' + file);
  createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, PUT, POST, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method === 'POST' && req.url === `/${env.SUBSCRIBE_PATH}/subscribe`) {
      let b = ''; req.on('data', c => { b += c; if (b.length > 1e4) req.destroy(); });
      req.on('end', async () => {
        let s; try { s = JSON.parse(b); if (!s.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys) throw 0; } catch (_) { res.writeHead(400, cors); return res.end('ongeldig'); }
        try { await store.addSub(s, file); res.writeHead(201, cors); res.end('ok'); } catch (e) { console.error(e.message); res.writeHead(500, cors); res.end('opslaan mislukt'); }
      });
      return;
    }
    if (req.url === `/${env.SUBSCRIBE_PATH}/state` && (req.method === 'GET' || req.method === 'PUT')) {
      if (req.method === 'GET') {
        store.getState(file).then(d => { res.writeHead(200, { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(d || {})); })
          .catch(e => { console.error(e.message); res.writeHead(500, cors); res.end('lezen mislukt'); });
        return;
      }
      let b = ''; req.on('data', c => { b += c; if (b.length > 5e6) req.destroy(); });
      req.on('end', async () => {
        let d; try { d = JSON.parse(b); if (!d || typeof d !== 'object' || d.app !== 'IDA') throw 0; } catch (_) { res.writeHead(400, cors); return res.end('ongeldig'); }
        try { await store.putState(d, file); res.writeHead(200, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true })); }
        catch (e) { console.error(e.message); res.writeHead(500, cors); res.end('opslaan mislukt'); }
      });
      return;
    }
    if (req.method === 'POST' && req.url === `/${env.SUBSCRIBE_PATH}/test`) {
      (async () => {
        const webpush = (await import('web-push')).default;
        webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:ida@example.invalid', env.VAPID_PUBLIC, env.VAPID_PRIVATE);
        const targets = await store.subs(file); let ok = 0;
        for (const s of targets) { try { await webpush.sendNotification(s, JSON.stringify({ title: 'IDA', body: 'Testmelding: meldingen werken.', tag: 'ida-test', url: './' }), { TTL: 600 }); ok++; } catch (e) { console.error('Test mislukt:', e.statusCode || e.message); } }
        res.writeHead(200, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify({ ok, of: targets.length }));
      })().catch(e => { res.writeHead(500, cors); res.end(e.message); });
      return;
    }
    if (req.method === 'GET' && req.url === '/status') {
      (async () => { let subsN = null; try { subsN = (await store.subs(file)).length; } catch (_) { }
        res.writeHead(200, { ...cors, 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: !status.lastError, storage: SB ? 'supabase' : 'bestand', subscriptions: subsN, intervalMin: +env.INTERVAL_MIN || 5, ...status }, null, 1)); })();
      return;
    }
    res.writeHead(200, { ...cors, 'content-type': 'text/plain' }); res.end('IDA meldingenserver');
  }).listen(+env.PORT || 8787, () => console.log('Luistert op poort', +env.PORT || 8787));
  const tick = () => check({ stateless: false, sent, file }).catch(e => { status.lastError = e.message; console.error(e.message); });
  tick(); setInterval(tick, (+env.INTERVAL_MIN || 5) * MIN);
  setInterval(() => sent.clear(), DAY);
} else {
  await check({ stateless: true }).catch(e => { console.error(e.message); process.exit(1); });
}

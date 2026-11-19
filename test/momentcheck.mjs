// Momenten-regels (js/moments.js): vóór het eten bij dalen, stijging zonder eten, geen ruis.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { idaMoments, newMoments, mealWindows, fallStats } = require('../js/moments.js');
const MIN = 60e3, H = 60 * MIN, DAY = 24 * H;
let ok = true; const t = (name, cond) => { console.log((cond ? 'ok   ' : 'FOUT ') + name); if (!cond) ok = false; };

// 30 dagen: avondeten rond 19:30 (UTC, offset 0), ontbijt 08:00; glucose vlak 7 met dips
const now = Date.UTC(2026, 10, 18, 19, 45);
const glucose = [], tr = [];
for (let d = 30; d >= 1; d--) {
  const base = now - d * DAY;
  for (let m = -20 * 60; m < 4 * 60; m += 5) glucose.push({ ts: base + m * MIN, bg: 7 });
  const dinner = base - 15 * MIN + (d % 5) * 6 * MIN, bf = base - 11.5 * H + (d % 3) * 10 * MIN;
  tr.push({ ts: dinner, carbs: 50, insulin: 0 }, { ts: dinner, insulin: 5 }, { ts: bf, carbs: 30 }, { ts: bf, insulin: 3 });
}
// vandaag: dalend van 8 naar 5,8 in het laatste uur
for (let m = 300; m >= 0; m -= 5) glucose.push({ ts: now - m * MIN, bg: m > 60 ? 8 : 5.8 + (m / 60) * 2.2 });
glucose.sort((a, b) => a.ts - b.ts);

const w = mealWindows(tr, now, 0);
t('eetmomenten gevonden (ontbijt + avondeten)', w.length === 2 && w.some(x => x.name === 'avondeten'));
const mo = idaMoments(glucose, tr, { now, tzOffsetMin: 0, stats: { fallPct: 22, okPct: 9 } });
const eat = mo.find(x => x.kind === 'eten');
t('moment vóór avondeten bij dalen', !!eat && /eerste hap/.test(eat.title) && /22%/.test(eat.body));
t('geen dosis in de tekst', !mo.some(x => /\bE\b|eenheden|units/.test(x.body)));
// al gegeten → geen moment
const tr2 = tr.concat([{ ts: now - 20 * MIN, carbs: 40 }]);
t('geen moment als er al gegeten is', !idaMoments(glucose, tr2, { now, tzOffsetMin: 0, stats: null }).some(x => x.kind === 'eten'));
// stijgend → geen eetmoment
const up = glucose.map(x => x.ts > now - 60 * MIN ? { ...x, bg: 6 + (60 - (now - x.ts) / MIN) / 30 } : x);
t('geen eetmoment als je niet daalt', !idaMoments(up, tr, { now, tzOffsetMin: 0, stats: null }).some(x => x.kind === 'eten'));
// buiten eettijd → niets
t('niets buiten eettijd', !idaMoments(glucose.map(x => ({ ...x, ts: x.ts - 4 * H })), tr, { now: now - 4 * H, tzOffsetMin: 0, stats: null }).some(x => x.kind === 'eten'));
// oude data → niets
t('niets zonder verse waarde', idaMoments(glucose.filter(x => x.ts < now - 30 * MIN), tr, { now, tzOffsetMin: 0 }).length === 0);
// stijging zonder eten: 7 → 13,8 in het laatste uur (om 14:00, buiten eettijd en overdag)
const noon = Date.UTC(2026, 10, 18, 14, 0);
const flat = []; for (let m = 600; m >= 0; m -= 5) flat.push({ ts: noon - m * MIN, bg: 7 });
const riseAt = (g, end) => g.map(x => { const a = (end - x.ts) / MIN; return a <= 60 ? { ...x, bg: 7 + (60 - a) / 60 * 6.8 } : x; });
const r1 = riseAt(flat, noon);
const q = idaMoments(r1, tr, { now: noon, tzOffsetMin: 0, stats: null }).find(x => x.kind === 'vraag');
t('vraag bij stijging zonder eten', !!q && /zonder eten/.test(q.title));
// dezelfde stijging 1 en 2 uur later: geen nieuwe vraag (geen herhaling elke 5 minuten)
const later = (h) => { const n = noon + h * H; const g = r1.concat(Array.from({ length: h * 12 }, (_, i) => ({ ts: noon + (i + 1) * 5 * MIN, bg: 13.8 - (i + 1) * 0.05 }))); return idaMoments(g, tr, { now: n, tzOffsetMin: 0, stats: null }).filter(x => x.kind === 'vraag'); };
const l1 = later(1), l2 = later(2);
t('geen herhaalde vraag voor dezelfde stijging', l1.length === 0 && l2.length === 0);
// sleutel blijft gelijk terwijl de stijging doorloopt
const k1 = idaMoments(riseAt(flat, noon - 15 * MIN).filter(x => x.ts <= noon - 15 * MIN), tr, { now: noon - 15 * MIN, tzOffsetMin: 0, stats: null }).find(x => x.kind === 'vraag');
t('één sleutel per stijging', !k1 || k1.key === q.key);
// 's nachts geen vraag
const night = Date.UTC(2026, 10, 18, 3, 0); const fN = flat.map(x => ({ ...x, ts: x.ts - (noon - night) }));
t('geen vraag tussen 23 en 7 uur', !idaMoments(riseAt(fN, night), tr, { now: night, tzOffsetMin: 0, stats: null }).some(x => x.kind === 'vraag'));
// herstel na een laagte is geen maaltijd
const fromLow = r1.map(x => { const a = (noon - x.ts) / MIN; return a <= 60 ? { ...x, bg: 3.6 + (60 - a) / 60 * 7.4 } : x; });
t('geen vraag bij herstel na een laagte', !idaMoments(fromLow, tr, { now: noon, tzOffsetMin: 0, stats: null }).some(x => x.kind === 'vraag'));
// server zonder geheugen: alleen nieuw t.o.v. 10 min geleden
const n1 = newMoments(glucose, tr, { now, tzOffsetMin: 0, stats: null }, 10 * MIN).filter(x => x.kind === 'eten').length;
const steady = glucose.map(x => x.ts > now - 15 * MIN ? x : x);
t('newMoments levert een moment op zodra het begint of niets dubbel', n1 <= 1);
t('fallStats geeft null bij te weinig data', fallStats(glucose.slice(0, 20), tr.slice(0, 2)) === null);
{ const fs = require('node:fs'); t('server/moments.cjs is gelijk aan js/moments.js', fs.readFileSync(new URL('../js/moments.js', import.meta.url),'utf8') === fs.readFileSync(new URL('../server/moments.cjs', import.meta.url),'utf8')); }
console.log('RESULTAAT:', ok ? 'OK' : 'FOUT'); console.log('errors: geen'); process.exit(ok ? 0 : 1);

"use strict";
/* IDA — momenten: advies vóór het moment, niet erna.
   Pure functies, zonder DOM of opslag, zodat de app én de meldingenserver
   (server/push.mjs) exact dezelfde regels gebruiken.
   Invoer: glucose [{ts, bg}] in mmol/L (oplopend), behandelingen [{ts, carbs, insulin, isSMB, notes}].
   IDA geeft hier nooit een dosis: alleen timing en een vraag. */
(function (root) {
  const MIN = 60e3, H = 60 * MIN, DAY = 24 * H;
  const LOW = 3.9, HIGH = 10;

  function idx(T, ts) { let lo = 0, hi = T.length; while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] < ts) lo = m + 1; else hi = m; } return lo; }
  function bgAt(g, T, ts, tol) { const i = Math.min(idx(T, ts), T.length - 1); const j = i > 0 && Math.abs(T[i - 1] - ts) < Math.abs(T[i] - ts) ? i - 1 : i; return j >= 0 && Math.abs(T[j] - ts) <= (tol || 10 * MIN) ? g[j].bg : null; }
  function slopeAt(g, T, ts) { const a = bgAt(g, T, ts, 6 * MIN), b = bgAt(g, T, ts - 20 * MIN, 8 * MIN); return a == null || b == null ? null : (a - b) / 20; } // mmol/L per min
  const tod = (ts, off) => { const d = new Date(ts + (off || 0) * MIN); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]; };
  const fmt = v => (Math.round(v * 10) / 10).toFixed(1).replace(".", ",");
  const hm = m => String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(Math.round(m % 60)).padStart(2, "0");

  /* Jouw vaste eetmomenten: per dagdeel het middelste deel van je maaltijdtijden (laatste 30 dagen). */
  function mealWindows(treatments, now, off) {
    const parts = [["ontbijt", 300, 660], ["lunch", 660, 960], ["avondeten", 960, 1380]];
    const meals = treatments.filter(t => t.carbs >= 15 && t.ts > now - 30 * DAY && t.ts <= now);
    const out = [];
    for (const [name, a, b] of parts) {
      const ms = meals.map(t => tod(t.ts, off)).filter(m => m >= a && m < b);
      if (ms.length < 8) continue;
      out.push({ name, from: q(ms, 0.2) - 30, to: q(ms, 0.8), n: ms.length });
    }
    return out;
  }

  /* Hoe vaak eindigt een maaltijdbolus laag als je dalend aan tafel gaat (jouw eigen data)? */
  function fallStats(glucose, treatments) {
    const T = glucose.map(x => x.ts), carbs = treatments.filter(t => t.carbs > 0);
    const r = { fall: { n: 0, low: 0 }, ok: { n: 0, low: 0 } };
    for (const b of treatments) {
      if (!(b.insulin >= 1) || b.isSMB) continue;
      if (!carbs.some(c => Math.abs(c.ts - b.ts) <= 30 * MIN)) continue;
      const bg = bgAt(glucose, T, b.ts), s = slopeAt(glucose, T, b.ts); if (bg == null || s == null) continue;
      let mn = 99; for (let k = idx(T, b.ts); k < T.length && T[k] <= b.ts + 4 * H; k++) mn = Math.min(mn, glucose[k].bg);
      const o = bg < 7 && s < -0.03 ? r.fall : r.ok; o.n++; if (mn < LOW) o.low++;
    }
    if (r.fall.n < 5 || r.ok.n < 5) return null;
    return { fallPct: Math.round(100 * r.fall.low / r.fall.n), okPct: Math.round(100 * r.ok.low / r.ok.n), n: r.fall.n };
  }

  /* De momenten die nú gelden. opts: { now, tzOffsetMin, stats } */
  function idaMoments(glucose, treatments, opts) {
    opts = opts || {};
    const now = opts.now || Date.now(), off = opts.tzOffsetMin || 0, out = [];
    if (!glucose || glucose.length < 10) return out;
    const T = glucose.map(x => x.ts), last = glucose[glucose.length - 1];
    if (now - last.ts > 15 * MIN) return out;                  // geen verse waarde: niets zeggen
    const day = new Date(now + off * MIN).toISOString().slice(0, 10);
    const s = slopeAt(glucose, T, last.ts);

    // 1 · Vóór het eten: je eet zo, en je daalt al
    const m = tod(now, off);
    const carbsRecent = treatments.some(t => t.carbs > 0 && t.ts > now - 90 * MIN && t.ts <= now + 5 * MIN);
    for (const w of mealWindows(treatments, now, off)) {
      if (m < w.from || m > w.to || carbsRecent) continue;
      if (last.bg < 7 && s != null && s <= -0.03) {
        const st = opts.stats === undefined ? fallStats(glucose, treatments) : opts.stats;
        const why = st ? `Zo eindigt het bij jou ${st.fallPct}% van de keren laag, normaal ${st.okPct}%.` : `Bij een dalende start loop je meer kans op een laagte na het eten.`;
        out.push({ key: `eten-${w.name}-${day}`, kind: "eten", prio: 1,
          title: `${w.name[0].toUpperCase() + w.name.slice(1)}: bolus pas bij de eerste hap`,
          body: `${fmt(last.bg)} en dalend. ${why}`, since: last.ts });
      }
    }

    // 2 · Stijging zonder gelogd eten (afgelopen 3 uur): vraag het, zodat de KH-berekening klopt
    for (let i = idx(T, now - 3 * H); i < glucose.length; i++) {
      const a = glucose[i]; const j = idx(T, a.ts + 60 * MIN); if (j >= glucose.length) break;
      let pk = a, pi = i; for (let k = i; k <= j && k < glucose.length; k++) if (glucose[k].bg > pk.bg) { pk = glucose[k]; pi = k; }
      if (pk.bg - a.bg >= 3 && pk.bg > HIGH && !treatments.some(t => t.carbs > 0 && t.ts > a.ts - 2 * H && t.ts < pk.ts)) {
        out.push({ key: `stijging-${day}-${hm(tod(a.ts, off))}`, kind: "vraag", prio: 2,
          title: `Gestegen naar ${fmt(pk.bg)} zonder eten`,
          body: `Tussen ${hm(tod(a.ts, off))} en ${hm(tod(pk.ts, off))} van ${fmt(a.bg)} naar ${fmt(pk.bg)}. Wat at je?`, since: pk.ts });
        break;
      }
    }
    return out.sort((x, y) => x.prio - y.prio);
  }

  /* Alleen wat nieuw is t.o.v. een eerder tijdstip (voor een server zonder geheugen). */
  function newMoments(glucose, treatments, opts, sinceMs) {
    const nowL = idaMoments(glucose, treatments, opts);
    const before = new Set(idaMoments(glucose.filter(x => x.ts <= (opts.now || Date.now()) - sinceMs), treatments, { ...opts, now: (opts.now || Date.now()) - sinceMs }).map(x => x.key));
    return nowL.filter(x => !before.has(x.key));
  }

  const api = { idaMoments, newMoments, mealWindows, fallStats };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== "undefined" ? self : this);

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

  /* Jouw vaste eetmomenten: per dagdeel het middelste deel (30–70%) van je maaltijdtijden (laatste 30 dagen), vanaf een half uur ervoor. */
  function mealWindows(treatments, now, off) {
    const parts = [["ontbijt", 300, 660], ["lunch", 660, 960], ["avondeten", 960, 1380]];
    const meals = treatments.filter(t => t.carbs >= 15 && t.ts > now - 30 * DAY && t.ts <= now);
    const out = [];
    for (const [name, a, b] of parts) {
      const ms = meals.map(t => tod(t.ts, off)).filter(m => m >= a && m < b);
      if (ms.length < 8) continue;
      // alleen een gewoonte die nu loopt: in minstens 4 van de laatste 7 dagen een maaltijd in dit dagdeel gelogd
      const recent = new Set(meals.filter(t => t.ts > now - 7 * DAY && tod(t.ts, off) >= a && tod(t.ts, off) < b).map(t => new Date(t.ts + (off || 0) * MIN).toISOString().slice(0, 10)));
      if (recent.size < 4) continue;
      out.push({ name, from: q(ms, 0.3) - 30, to: q(ms, 0.7), n: ms.length, a, b });
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

  /* Laatste laagte (≥15 min onder 3,9) in de 24 uur vóór nu: eindtijd, of null. */
  function recentLow(glucose, T, now) {
    let run = null, last = null;
    for (let k = idx(T, now - 24 * H); k < glucose.length && T[k] <= now; k++) {
      const x = glucose[k];
      if (x.bg < LOW) { if (!run) run = { a: x.ts, b: x.ts }; else run.b = x.ts; }
      else { if (run && run.b - run.a >= 10 * MIN) last = run.b; run = null; }
    }
    if (run && run.b - run.a >= 10 * MIN) last = run.b;
    return last;
  }
  const annIn = (anns, type, a, b) => (anns || []).filter(x => x && x.type === type && x.ts >= a && x.ts <= b);

  /* De momenten die nú gelden. opts: { now, tzOffsetMin, stats, anns (logboek), iob (actieve insuline nu), mute (soorten uit) } */
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
      // al gegeten in dit dagdeel vandaag? dan geen melding meer
      const dayStart = now - m * MIN;
      if (treatments.some(t => (t.carbs >= 15 || (t.insulin >= 1 && !t.isSMB)) && t.ts >= dayStart + w.a * MIN && t.ts <= now)) continue;
      const lowRecent = recentLow(glucose, T, now);
      if (last.bg < (lowRecent ? 7.5 : 7) && s != null && s <= -0.03) {
        const st = opts.stats === undefined ? fallStats(glucose, treatments) : opts.stats;
        const why = (st ? `Zo eindigt het bij jou ${st.fallPct}% van de keren laag, normaal ${st.okPct}%.` : `Bij een dalende start loop je meer kans op een laagte na het eten.`) + (lowRecent ? ` Je was om ${hm(tod(lowRecent, off))} laag: de volgende voel je minder.` : ``);
        out.push({ key: `eten-${w.name}-${day}`, kind: "eten", prio: 1,
          title: `${w.name[0].toUpperCase() + w.name.slice(1)}: bolus pas bij de eerste hap`,
          body: `${fmt(last.bg)} en dalend. ${why}`, since: last.ts });
      }
    }

    // 2 · Stijging (≥ 4) zonder gelogd eten: alleen terwijl hij gebeurt (piek hooguit 30 min geleden), één keer per stijging,
    //     niet 's nachts (23–7 uur) en niet na een laagte (dat is herstel, geen maaltijd).
    const nightQ = m >= 23 * 60 || m < 7 * 60;
    if (!nightQ) {
      let pk = null; for (let k = idx(T, now - 90 * MIN); k < glucose.length; k++) if (!pk || glucose[k].bg > pk.bg) pk = glucose[k];
      if (pk && now - pk.ts <= 30 * MIN && pk.bg > HIGH) {
        let a = null; for (let k = idx(T, pk.ts - 90 * MIN); k < glucose.length && T[k] <= pk.ts; k++) if (!a || glucose[k].bg < a.bg) a = glucose[k];
        const answered = (opts.anns || []).some(x => x && x.type === 'maaltijd' && Math.abs(x.ts - a.ts) <= 2 * H);
        if (a && pk.bg - a.bg >= 4 && a.bg >= 4.5 && !answered && !treatments.some(t => t.carbs > 0 && t.ts > a.ts - 2 * H && t.ts < pk.ts)) {
          // schatting: stijging ÷ (ISF ÷ KH-ratio) + wat de loop sindsdien gaf × KH-ratio (zoals riseCarbEstimate in de app)
          let grams = null; const P = opts.prof;
          if (P && P.isf > 0 && P.ic > 0) { const ins = treatments.filter(t => t.insulin > 0 && t.ts >= a.ts && t.ts <= now).reduce((x, t) => x + t.insulin, 0);
            grams = Math.min(150, Math.max(5, Math.round(((pk.bg - a.bg) / (P.isf / P.ic) + ins * P.ic) / 5) * 5)); }
          out.push({ key: `stijging-${day}-${tod(a.ts, off) < 720 ? 'o' : tod(a.ts, off) < 1020 ? 'm' : 'a'}`, kind: "vraag", prio: 2,   // hooguit één per dagdeel
            title: `Gestegen naar ${fmt(pk.bg)} zonder eten`,
            body: `Sinds ${hm(tod(a.ts, off))} van ${fmt(a.bg)} naar ${fmt(pk.bg)}. Iets gegeten?${grams ? ` Past bij ~${grams} g.` : ''}`, since: pk.ts,
            rise: { t0: a.ts, grams } });
        }
      }
    }
    // 3 · Ketonen: al 2 uur boven 14 (of ziek gelogd en boven 14); hooguit één keer per dag
    {
      let a = null; for (let k = glucose.length - 1; k >= 0 && glucose[k].bg >= 14; k--) { if (k < glucose.length - 1 && T[k + 1] - T[k] > 20 * MIN) break; a = glucose[k]; }
      const ill = annIn(opts.anns, 'ziek', now - 48 * H, now).length > 0;
      if (a && (now - a.ts >= 120 * MIN || (ill && now - a.ts >= 30 * MIN))) {
        out.push({ key: `ketonen-${day}`, kind: 'ketonen', prio: 0,
          title: `${ill ? 'Ziek en boven 14' : 'Al ' + fmt((now - a.ts) / H) + ' uur boven 14'}: meet ketonen`,
          body: `Onder 0,6 gewoon corrigeren. 0,6–1,4: correctie met de pen, nieuwe pod. Vanaf 1,5 ook je team bellen, vanaf 3,0 spoed.`, since: a.ts });
      }
    }
    // 4 · Pod: > 5 uur boven 13,9, of 2 correcties binnen 3 uur zonder daling
    {
      let a = null; for (let k = glucose.length - 1; k >= 0 && glucose[k].bg > 13.9; k--) { if (k < glucose.length - 1 && T[k + 1] - T[k] > 20 * MIN) break; a = glucose[k]; }
      const cor = treatments.filter(t => !t.isSMB && t.insulin >= 0.5 && t.ts > now - 3 * H && t.ts <= now - 60 * MIN && !treatments.some(x => x.carbs > 0 && Math.abs(x.ts - t.ts) <= 45 * MIN));
      let why = null;
      if (a && now - a.ts >= 5 * H) why = `Al ${fmt((now - a.ts) / H)} uur boven 13,9.`;
      else if (cor.length >= 2 && last.bg >= 13.9) { const b0 = bgAt(glucose, T, cor[0].ts); if (b0 != null && last.bg >= b0 - 0.5) why = `${cor.length} correcties sinds ${hm(tod(cor[0].ts, off))}, en je daalt niet.`; }
      if (why) out.push({ key: `pod-${day}`, kind: 'pod', prio: 0,
        title: `Pod mogelijk niet goed`, body: `${why} Vervang de pod en corrigeer met de pen.`, since: now });
    }
    // 5 · Nacht: om 22:30–23:30 kans op een laagte vannacht (≥ 3 risicofactoren; bij 2 voorspelde het in je data niets)
    if (m >= 22 * 60 + 30 && m <= 23 * 60 + 30) {
      const F = [], dayStart = now - m * MIN;
      if (opts.iob != null && opts.iob >= 3) F.push(`${fmt(opts.iob)} E actief`);
      if (treatments.some(t => !t.isSMB && t.insulin >= 1 && t.ts > now - 3 * H)) F.push('bolus in de laatste 3 uur');
      if (annIn(opts.anns, 'sport', dayStart, now).length) F.push('sport vandaag');
      if (annIn(opts.anns, 'alcohol', now - 8 * H, now).length) F.push('alcohol');
      if (recentLow(glucose, T, now) > dayStart + 6 * H) F.push('laag vandaag');
      if (last.bg < 6.5) F.push(`nu ${fmt(last.bg)}`);
      if (F.length >= 3) out.push({ key: `nacht-${day}`, kind: 'nacht', prio: 1, title: 'Grotere kans op een laagte vannacht',
        body: `${F.join(', ')}. Eet iets kleins of zet een tijdelijke streefwaarde voor de nacht.`, since: now });
    }
    // 6 · Ochtend na alcohol: 06:30–11:00, alcohol gisteravond gelogd
    if (m >= 390 && m <= 660) {
      const dayStart = now - m * MIN, alc = annIn(opts.anns, 'alcohol', dayStart - 8 * H, dayStart + 3 * H);
      if (alc.length) out.push({ key: `alcohol-${day}`, kind: 'alcohol', prio: 1, title: 'Ochtend na alcohol: ontbijt niet overslaan',
        body: `Je lever remt nog tot ver in de ochtend. Eet op tijd en bolus voorzichtig${last.bg < 7 ? `; je zit nu op ${fmt(last.bg)}` : ''}.`, since: now });
    }
    // 7 · Vóór sport: vast sportmoment (zelfde weekdag ≥ 3 van de laatste 4 weken, ± 1 uur) → 60–90 min vooraf
    {
      const sp = (opts.anns || []).filter(x => x && x.type === 'sport' && x.ts > now - 29 * DAY && x.ts < now - 12 * H);
      const wd = new Date(now + off * MIN).getUTCDay();
      const same = sp.filter(x => new Date(x.ts + off * MIN).getUTCDay() === wd).map(x => tod(x.ts, off));
      if (same.length >= 3) {
        const t0 = q(same, 0.5), lead = t0 - m;
        if (same.filter(v => Math.abs(v - t0) <= 60).length >= 3 && lead >= 60 && lead <= 90 && !annIn(opts.anns, 'sport', now - 3 * H, now).length)
          out.push({ key: `sport-${day}`, kind: 'sport', prio: 2, title: `Sport rond ${hm(t0)}? Zet nu je streefwaarde`,
            body: `Tijdelijke streefwaarde ± 8,3 vanaf nu tot het einde van het sporten. Eet je vlak ervoor, bolus dan 25–33% minder.`, since: now });
      }
    }
    const mute = new Set(opts.mute || []);
    return out.filter(x => !mute.has(x.kind)).sort((x, y) => x.prio - y.prio);
  }

  /* Waakhond (alleen op de server): komt er nog data binnen? Je telefoon of AAPS kan zelf niet melden dat hij
     stilstaat (leeg, uit, geen bereik), de server wel. Eén melding per onderbreking, ook 's nachts.
     opts: { now, tzOffsetMin, loopTs (laatste loopstatus), mute } */
  function watchdog(glucose, treatments, opts) {
    opts = opts || {}; const now = opts.now || Date.now(), off = opts.tzOffsetMin || 0, out = [];
    const lastG = glucose && glucose.length ? glucose[glucose.length - 1].ts : null, lastL = opts.loopTs || null;
    const gAge = lastG ? (now - lastG) / MIN : Infinity, lAge = lastL ? (now - lastL) / MIN : Infinity;
    const at = ts => ts ? hm(tod(ts, off)) : '—';
    if (gAge >= 30 && lAge >= 30 && lastG) {
      out.push({ key: `wd-stil-${Math.min(lastG, lastL || lastG)}`, kind: 'waakhond', prio: 0, title: `Al ${Math.round(Math.min(gAge, lAge))} min niets van je telefoon`,
        body: `Laatste glucose ${at(lastG)}, laatste loop ${at(lastL)}. Telefoon leeg, uit of zonder bereik? Zolang dit duurt, ziet niemand je waarden.`, since: now });
    } else if (gAge >= 30 && lastG) {
      out.push({ key: `wd-cgm-${lastG}`, kind: 'waakhond', prio: 0, title: `Al ${Math.round(gAge)} min geen glucose`,
        body: `Laatste waarde om ${at(lastG)}. Controleer xDrip+ en je sensor; de loop werkt zonder glucose niet.`, since: now });
    } else if (lAge >= 30 && lastL && gAge < 15) {
      out.push({ key: `wd-loop-${lastL}`, kind: 'waakhond', prio: 0, title: `Loop al ${Math.round(lAge)} min stil`,
        body: `Glucose komt binnen, maar AAPS stuurt sinds ${at(lastL)} niets meer. Open AAPS en kijk of de loop aanstaat en de pod verbonden is.`, since: now });
    }
    const mute = new Set(opts.mute || []);
    return out.filter(x => !mute.has(x.kind));
  }

  /* Alleen wat nieuw is t.o.v. een eerder tijdstip (voor een server zonder geheugen). */
  function newMoments(glucose, treatments, opts, sinceMs) {
    const nowL = idaMoments(glucose, treatments, opts);
    const before = new Set(idaMoments(glucose.filter(x => x.ts <= (opts.now || Date.now()) - sinceMs), treatments, { ...opts, now: (opts.now || Date.now()) - sinceMs }).map(x => x.key));
    return nowL.filter(x => !before.has(x.key));
  }

  const api = { idaMoments, newMoments, mealWindows, fallStats, recentLow, watchdog };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== "undefined" ? self : this);

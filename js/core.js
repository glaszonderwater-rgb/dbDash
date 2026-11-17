"use strict";
/* DiaMetric rekenkern: eenheden, opslag, sync, metrics, maaltijd-/loop-analyse, voorstellen. Klassiek script (geen module) zodat file:// blijft werken. */
/* ── Eenheden + banden ──────────────────────────────────────────────────────
   Nightscout slaat glucose ALTIJD op in mg/dL. Conversie op precies één plek. */
const MGDL = 18.0182, DAY = 864e5;
const mmol = v => v / MGDL, toMgdl = v => v * MGDL;
const BANDS = [
  { id:"veryLow",  lo:-Infinity, hi:3.0,      label:"< 3,0",       css:"--veryLow"  },
  { id:"low",      lo:3.0,       hi:3.9,      label:"3,0 – 3,9",   css:"--low"      },
  { id:"inRange",  lo:3.9,       hi:10.0,     label:"3,9 – 10,0",  css:"--inRange"  },
  { id:"high",     lo:10.0,      hi:13.9,     label:"10,0 – 13,9", css:"--high"     },
  { id:"veryHigh", lo:13.9,      hi:Infinity, label:"> 13,9",      css:"--veryHigh" },
];
const bandOf = bg => BANDS.find(b => bg >= b.lo && bg < b.hi) || BANDS[4];
// Bandgrens-label met locale-decimaal (herberekend bij taalwissel).
const bandLabel = b => !isFinite(b.lo) ? "< "+num(b.hi) : !isFinite(b.hi) ? "> "+num(b.lo) : num(b.lo)+" – "+num(b.hi);
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const colorOf = bg => cssVar(bandOf(bg).css);
const nl1 = v => (v==null||!isFinite(v)) ? "—" : v.toFixed(1).replace(".", DECSEP());
const nl2 = v => (v==null||!isFinite(v)) ? "—" : v.toFixed(2).replace(".", DECSEP());
const pct0 = v => Math.round(v*100) + "%";
// Getal met locale-decimaal (voor vaste labels als bandgrenzen).
const num = (v,dec=1) => (v==null||!isFinite(v)) ? "—" : v.toFixed(dec).replace(".", DECSEP());
const TZ = "Europe/Amsterdam";
// Tijdzone-afhankelijke afleidingen (dag-sleutel, minuut-van-de-dag) zijn duur
// (Intl), en dezelfde meting wordt per render meermaals opgevraagd. Daarom via een
// vaste formatter + memoisatie op timestamp — scheelt seconden op lange historie.
const todFmt = new Intl.DateTimeFormat("en-GB", { timeZone:TZ, hour:"2-digit", minute:"2-digit", hour12:false });
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone:TZ, year:"numeric", month:"2-digit", day:"2-digit" });
const _todCache = new Map(), _dayCache = new Map();
const todMin = ts => { let v=_todCache.get(ts); if(v!==undefined) return v;
  const [h,m]=todFmt.format(ts).split(":"); v=(+h%24)*60 + +m; _todCache.set(ts,v); return v; };
const fmtMin = m => `${String(Math.floor(m/60)%24).padStart(2,"0")}:${String(Math.round(m)%60).padStart(2,"0")}`;
function localDayKey(ts){ let v=_dayCache.get(ts); if(v!==undefined) return v;
  v=dayFmt.format(ts); _dayCache.set(ts,v); return v; }   // en-CA → "JJJJ-MM-DD"

/* ── Nightscout (read-only, met time-out) ──────────────────────────────────── */
const NS = {
  TIMEOUT: 30000, COUNT: 50000, OVERLAP: 10*60e3,
  async get(path, params={}){
    const u = new URL(cfg.url.replace(/\/+$/,"") + path);
    for (const [k,v] of Object.entries(params)) u.searchParams.set(k, v);
    if (cfg.token) u.searchParams.set("token", cfg.token);
    const ac = new AbortController(), timer = setTimeout(()=>ac.abort(), this.TIMEOUT);
    let r;
    try { r = await fetch(u.toString(), { method:"GET", cache:"no-store", signal:ac.signal }); }
    catch(e){
      if (e.name==="AbortError") throw new Error(TL(`Nightscout antwoordde niet binnen ${this.TIMEOUT/1000}s.\nGratis hosting slaapt vaak in — probeer nog eens, of open je adres eerst los in een tabblad.`,`Nightscout didn't respond within ${this.TIMEOUT/1000}s.\nFree hosting often sleeps — try again, or open your address in a separate tab first.`,`O Nightscout não respondeu em ${this.TIMEOUT/1000}s.\nO alojamento gratuito adormece muitas vezes — tente de novo, ou abra primeiro o seu endereço num separador.`));
      throw new Error(TL("Geen verbinding met ","No connection to ","Sem ligação a ")+cfg.url+TL(".\nMeestal een typefout in het adres, of je Nightscout staat uit.",".\nUsually a typo in the address, or your Nightscout is off.",".\nNormalmente um erro no endereço, ou o seu Nightscout está desligado."));
    } finally { clearTimeout(timer); }
    if (r.status===401 || r.status===403) throw new Error(TL("Nightscout weigert het token (","Nightscout rejects the token (","O Nightscout recusa o token (")+r.status+TL(").\nControleer of het subject de rol 'readable' heeft.",").\nCheck that the subject has the 'readable' role.",").\nVerifique se o subject tem o papel 'readable'."));
    if (!r.ok) throw new Error("Nightscout HTTP "+r.status+" — "+path);
    return r.json();
  },
  *chunks(from, to, days){ for (let a=from; a<to; a+=days*DAY) yield [a-this.OVERLAP, Math.min(a+days*DAY, to)]; },
  async entries(from, to, onChunk){
    const out=[];
    for (const [a,b] of this.chunks(from, to, 14)){
      const rows = await this.get("/api/v1/entries.json",
        { "find[date][$gte]":a, "find[date][$lt]":b, "find[type]":"sgv", count:this.COUNT });
      out.push(...rows); onChunk?.(out.length, a);
    }
    return out;
  },
  async treatments(from, to, onChunk){
    const iso=t=>new Date(t).toISOString(), out=[];
    for (const [a,b] of this.chunks(from, to, 30)){
      const rows = await this.get("/api/v1/treatments.json",
        { "find[created_at][$gte]":iso(a), "find[created_at][$lt]":iso(b), count:this.COUNT });
      out.push(...rows); onChunk?.(out.length, a);
    }
    return out;
  },
  profiles(){ return this.get("/api/v1/profile.json", { count:1000 }); },
  async devicestatus(from, to, onChunk){
    const iso=t=>new Date(t).toISOString(), out=[];
    for (const [a,b] of this.chunks(from, to, 7)){
      const rows = await this.get("/api/v1/devicestatus.json",
        { "find[created_at][$gte]":iso(a), "find[created_at][$lt]":iso(b), count:this.COUNT });
      out.push(...rows); onChunk?.(out.length, a);
    }
    return out;
  },
};

/* ── Cache (IndexedDB) ──────────────────────────────────────────────────────
   Sleutel is het Nightscout _id. Idempotent: twee keer syncen verandert niets. */
const DB = {
  h:null,
  open(){ if (this.h) return Promise.resolve(this.h);
    return new Promise((res,rej)=>{ const rq=indexedDB.open("dbdash2",3);
      rq.onupgradeneeded=()=>{ const db=rq.result;
        for (const s of ["entries","treatments","devicestatus"])
          if(!db.objectStoreNames.contains(s)) db.createObjectStore(s,{keyPath:"_id"}).createIndex("ts","ts");
        if(!db.objectStoreNames.contains("profiles")) db.createObjectStore("profiles",{keyPath:"_id"});
        if(!db.objectStoreNames.contains("meta")) db.createObjectStore("meta",{keyPath:"k"});
        // Persoonlijke annotaties (wijzigingen, ziekte, cyclus, notities) — jouw geheugenlaag.
        if(!db.objectStoreNames.contains("annotations")) db.createObjectStore("annotations",{keyPath:"id"}).createIndex("ts","ts"); };
      rq.onsuccess=()=>res(this.h=rq.result);
      rq.onerror=()=>rej(new Error("IndexedDB niet beschikbaar. In privémodus of een preview-iframe werkt de cache niet — open het bestand normaal.")); }); },
  async putMany(store, rows){ if(!rows.length) return 0; const db=await this.open();
    await new Promise((res,rej)=>{ const t=db.transaction(store,"readwrite"), os=t.objectStore(store);
      for (const r of rows) os.put(r); t.oncomplete=res; t.onerror=()=>rej(t.error); }); return rows.length; },
  async range(store, from, to){ const db=await this.open();
    return new Promise((res,rej)=>{ const rq=db.transaction(store,"readonly").objectStore(store).index("ts").getAll(IDBKeyRange.bound(from,to));
      rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); }); },
  async count(store){ const db=await this.open();
    return new Promise((res)=>{ const rq=db.transaction(store,"readonly").objectStore(store).count(); rq.onsuccess=()=>res(rq.result); rq.onerror=()=>res(0); }); },
  async all(store){ const db=await this.open();
    return new Promise((res,rej)=>{ const rq=db.transaction(store,"readonly").objectStore(store).getAll(); rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); }); },
  async meta(k,v){ const db=await this.open();
    if (v===undefined) return new Promise(res=>{ const rq=db.transaction("meta","readonly").objectStore("meta").get(k);
      rq.onsuccess=()=>res(rq.result?.v ?? null); rq.onerror=()=>res(null); });
    return this.putMany("meta",[{k,v}]); },
  async delRow(store, key){ const db=await this.open();
    return new Promise((res,rej)=>{ const t=db.transaction(store,"readwrite"); t.objectStore(store).delete(key); t.oncomplete=res; t.onerror=()=>rej(t.error); }); },
  async wipe(){ if(this.h){this.h.close();this.h=null;}
    await new Promise(res=>{ const rq=indexedDB.deleteDatabase("dbdash2"); rq.onsuccess=rq.onerror=res; }); },
};

/* ── Sync (incrementeel) ─────────────────────────────────────────────────── */
const REFETCH = 24*36e5;
const parseTs = v => { if(v==null) return null; const t = typeof v==="number"?v:Date.parse(v); return isFinite(t)?t:null; };
async function startFrom(store, days, refetch){
  const floor = Date.now() - days*DAY;
  const last = await DB.meta("sync."+store);
  return last ? Math.max(floor, last - refetch) : floor;
}
async function syncAll(onProgress, daysOverride){
  const now = Date.now(), DAYS = daysOverride || cfg.days;
  const say = (s,n,at)=>onProgress?.(`${s} · ${n.toLocaleString(LOCALE())} · ${new Date(at).toLocaleDateString(LOCALE(),{day:"2-digit",month:"short"})}`);

  // metingen (kern)
  let rows = await NS.entries(await startFrom("entries", DAYS, 24*36e5), now, (n,at)=>say(TL("metingen","readings","leituras"),n,at));
  const E = rows.map(e=>({ _id:String(e._id), ts:parseTs(e.date)??parseTs(e.dateString), sgv:e.sgv, direction:e.direction }))
    .filter(e=>e.ts!=null && e.sgv>0);
  await DB.putMany("entries", E);
  if (E.length) await DB.meta("sync.entries", Math.max(...E.map(e=>e.ts)));

  // behandelingen (voor de verdieping) — volledig document bewaren
  rows = await NS.treatments(await startFrom("treatments", DAYS, 72*36e5), now, (n,at)=>say(TL("behandelingen","treatments","tratamentos"),n,at));
  const T = rows.map(t=>({ ...t, _id:String(t._id), ts:parseTs(t.created_at)??parseTs(t.mills) })).filter(t=>t.ts!=null);
  await DB.putMany("treatments", T);
  if (T.length) await DB.meta("sync.treatments", Math.max(...T.map(t=>t.ts)));

  // profielen
  try {
    const P = (await NS.profiles()).map(p=>({ ...p, _id:String(p._id), ts:parseTs(p.mills)??parseTs(p.startDate)??0 }));
    await DB.putMany("profiles", P);
  } catch(_){ /* profielen zijn optioneel */ }

  // devicestatus (loop-IOB/COB voor "nu") — alleen recent nodig; minimaal opgeslagen
  try {
    const dsRows = await NS.devicestatus(now - 2*DAY, now);
    const DS = dsRows.map(d=>{ const x=dsExtract(d);
      return { _id:String(d._id), ts:parseTs(d.created_at)??parseTs(d.mills)??0, iob:x.iob, cob:x.cob }; })
      .filter(d=>d.ts>0 && (d.iob!=null || d.cob!=null));
    if (DS.length) await DB.putMany("devicestatus", DS);
  } catch(_){ /* devicestatus is optioneel */ }

  await DB.meta("sync.at", now);
}
async function loadDeviceStatus(){
  const rows = await DB.range("devicestatus", Date.now()-6*3600e3, Date.now()+6e4);
  rows.sort((a,b)=>a.ts-b.ts);
  return rows;
}

/* ── Loader — de conversiegrens mg/dL → mmol/L ─────────────────────────────── */
async function loadGlucose(days){
  const rows = await DB.range("entries", Date.now()-days*DAY, Date.now()+6e4);
  rows.sort((a,b)=>a.ts-b.ts);
  const seen = new Map();                         // ontdubbelen op de minuut
  for (const r of rows) seen.set(Math.floor(r.ts/6e4), r);
  // Sommige bronnen (xDrip+ met Libre) leveren elke minuut een waarde. De hele app
  // rekent met 5-minutenslots (288 per dag), dus dichtere data middelen we per slot.
  const slot = new Map();
  for (const r of seen.values()){
    const k = Math.floor(r.ts/300e3), o = slot.get(k);
    if (!o) slot.set(k, { ts:r.ts, sgv:r.sgv, n:1, dir:r.direction });
    else { o.ts=(o.ts*o.n+r.ts)/(o.n+1); o.sgv=(o.sgv*o.n+r.sgv)/(o.n+1); o.n++; o.dir=r.direction; }
  }
  return [...slot.values()].map(o=>({ ts:Math.round(o.ts), bg:mmol(o.sgv), dir:o.dir }));
}

async function loadTreatments(days){
  const rows = await DB.range("treatments", Date.now()-days*DAY, Date.now()+6e4);
  rows.sort((a,b)=>a.ts-b.ts);
  return rows.map(t=>({ ts:t.ts, type:t.eventType, carbs:+t.carbs||0, insulin:+t.insulin||0,
    duration:+t.duration||0, isSMB:detectSMB(t), notes:t.notes||"", raw:t }));
}
// SMB-herkenning uit een Nightscout-behandeling. Verschillende AAPS-versies/sync-paden
// labelen het anders — dek de bekende varianten af (bool of string isSMB, eventType,
// notes/enteredBy die "SMB" zegt). Ontbreekt élk signaal, dan valt een SMB terug op
// "handmatig" — de diagnose in de Insuline-sectie laat zien wat jouw data meestuurt.
function detectSMB(t){
  if(t.type==="SMB") return true;                              // AAPS: bolus-type NORMAL vs SMB
  if(t.isSMB===true||t.isSMB==="true"||t.isSMB===1) return true;
  if(t.eventType==="SMB"||t.eventType==="SMB Bolus") return true;
  const s=`${t.enteredBy||""} ${t.notes||""}`;
  return /\bSMB\b/i.test(s);
}

/* ── Insulinemodel (oref exponentieel) — nagekeken tegen de oref-referentie ── */
function insulinModel(peakMin, diaMin){
  const td=Math.max(300,diaMin), tp=peakMin, tau=tp*(1-tp/td)/(1-2*tp/td), a=2*tau/td, S=1/(1-a+(1+a)*Math.exp(-td/tau));
  return { td,tp,
    activity(t){ if(t<=0||t>=td) return 0; return (S/(tau*tau))*t*(1-t/td)*Math.exp(-t/tau); },
    iob(t){ if(t<=0) return 1; if(t>=td) return 0; return 1 - S*(1-a)*((t*t/(tau*td*(1-a))-t/tau-1)*Math.exp(-t/tau)+1); } };
}
function reconstructIOB(treatments, ts, peakMin, timeline){
  let iob=0;
  for (const t of treatments){ if(t.insulin<=0) continue;
    const dtMin=(ts-t.ts)/60000; if(dtMin<0||dtMin>24*60) continue;
    const dia=(timeline?profileAt(timeline,t.ts).dia:6)*60; if(dtMin>dia) continue;
    iob += t.insulin*insulinModel(peakMin,dia).iob(dtMin); }
  return iob;
}
// Koolhydraten-on-board: eenvoudige lineaire afbraak over ~3 uur (indicatief).
function carbsOnBoard(treatments, ts){
  const ABS=180; let cob=0;
  for (const t of treatments){ if(!(t.carbs>0)) continue;
    const dt=(ts-t.ts)/60000; if(dt<0||dt>=ABS) continue; cob += t.carbs*(1-dt/ABS); }
  return cob;
}
// IOB/COB uit een devicestatus-document (loop) — defensief over bekende
// veldpaden (AAPS/oref/loop-varianten), want de structuur verschilt per versie.
function dsExtract(d){
  const num=v=>(typeof v==="number"&&isFinite(v))?v:null;
  const oa=d.openaps||{}, lp=d.loop||{};
  const iobObj = (Array.isArray(oa.iob)?oa.iob[0]:oa.iob) || lp.iob || d.iob || {};
  const iob = num(iobObj.iob) ?? num(d.iob&&d.iob.iob);
  const cob = num(oa.suggested&&oa.suggested.COB) ?? num(oa.enacted&&oa.enacted.COB)
    ?? num(lp.cob&&lp.cob.cob) ?? num(d.cob&&d.cob.cob);
  return { iob, cob };
}

/* ── Profielen (ISF/IC/basaal per moment, alles in mmol/L) ──────────────────── */
async function loadProfiles(days){
  const docs = (await DB.all("profiles")).sort((a,b)=>a.ts-b.ts);
  const switches = (await DB.range("treatments", Date.now()-days*DAY, Date.now()+6e4))
    .filter(t=>t.eventType==="Profile Switch").sort((a,b)=>a.ts-b.ts);
  return { docs, switches };
}
function defaultStoreOf(doc){ const name=doc.defaultProfile||Object.keys(doc.store||{})[0]; return doc.store?doc.store[name]:null; }
function hhmmToMin(s){ const [h,m]=String(s).split(":").map(Number); return h*60+(m||0); }
function lookupTimeSeries(series, todMinV){
  if(!series||!series.length) return null;
  const wm=series.map(e=>({min:e.timeAsSeconds!=null?e.timeAsSeconds/60:hhmmToMin(e.time), value:+e.value})).sort((a,b)=>a.min-b.min);
  let best=wm[wm.length-1]; for(const e of wm) if(e.min<=todMinV) best=e; return best.value;
}
let PEAK_MIN = cfg.peak || 75;   // insuline-piektijd (min); instelbaar per insulinetype
function profileAt(timeline, ts){
  const { docs, switches } = timeline;
  let store=null, dia=6, units="mmol";
  const sw=[...switches].reverse().find(s=>s.ts<=ts);
  if(sw && sw.profileJson){ try{ const emb=JSON.parse(sw.profileJson); store=emb; dia=+emb.dia||dia; units=emb.units||units; }catch(_){} }
  if(!store){ const doc=[...docs].reverse().find(d=>d.ts<=ts)||docs[docs.length-1];
    if(doc){ store=defaultStoreOf(doc); if(store){ dia=+store.dia||dia; units=store.units||units; } } }
  if(!store) return { basal:null, isf:null, ic:null, dia:6, source:"geen" };
  const ld=new Date(new Date(ts).toLocaleString("en-US",{timeZone:TZ}));
  let tod=ld.getHours()*60+ld.getMinutes();
  const pct=sw?(sw.percentage??100):100, shift=sw?(sw.timeshift??0)*60:0, f=pct/100;
  tod=((tod+shift)%1440+1440)%1440;
  const toM=v=>v==null?null:units.toLowerCase().startsWith("mg")?mmol(v):v;
  return { basal:lookupTimeSeries(store.basal,tod)*f, isf:toM(lookupTimeSeries(store.sens,tod))/f,
    ic:lookupTimeSeries(store.carbratio,tod)/f, dia:Math.max(5,dia), source:sw&&sw.profileJson?"switch":"profiel" };
}
// Het volledige actieve profiel als leesbare dagschema's (basaal E/u, ISF, KH-ratio),
// inclusief eenheids-normalisatie en een eventueel actief percentage. Timeshift is
// zeldzaam en wordt hier niet in de tijdstippen verwerkt (wel gemeld).
function profileInfo(timeline, ts){
  if(!timeline) return null;
  const { docs, switches } = timeline;
  let store=null, dia=6, units="mmol", name=null;
  const sw=[...switches].reverse().find(s=>s.ts<=ts);
  if(sw && sw.profileJson){ try{ const emb=JSON.parse(sw.profileJson); store=emb; dia=+emb.dia||dia; units=emb.units||units; name=sw.profile||emb.name||null; }catch(_){} }
  if(!store){ const doc=[...docs].reverse().find(d=>d.ts<=ts)||docs[docs.length-1];
    if(doc){ name=doc.defaultProfile||Object.keys(doc.store||{})[0]; store=defaultStoreOf(doc); if(store){ dia=+store.dia||dia; units=store.units||units; } } }
  if(!store) return null;
  const pct=sw?(sw.percentage??100):100, shift=sw?(sw.timeshift??0):0, f=pct/100;
  const mg=units.toLowerCase().startsWith("mg");
  const blocks=series=>{ if(!series||!series.length) return [];
    const wm=series.map(e=>({min:e.timeAsSeconds!=null?e.timeAsSeconds/60:hhmmToMin(e.time), value:+e.value})).sort((a,b)=>a.min-b.min);
    return wm.map((e,i)=>({from:e.min, to:i+1<wm.length?wm[i+1].min:1440, raw:e.value})); };
  const basal=blocks(store.basal).map(b=>({...b, value:b.raw*f}));
  const isf=blocks(store.sens).map(b=>({...b, value:(mg?mmol(b.raw):b.raw)/f}));
  const ic=blocks(store.carbratio).map(b=>({...b, value:b.raw/f}));
  const basalDaily=basal.reduce((s,b)=>s+b.value*(b.to-b.from)/60,0);
  return { name, dia, pct, shift, basal, isf, ic, basalDaily,
    source: sw&&sw.profileJson?"switch":"profiel", switchTs: sw?sw.ts:null };
}
// Dagdelen — je gevoeligheid verschilt over de dag (dawn-fenomeen: 's ochtends
// vaak minder gevoelig). Gebruikt om ISF/basaal per venster te bespreken.
const DAYPARTS=[
  {key:"nacht",  lo:0,   hi:360,  label:"nacht 00–06",   mid:180},
  {key:"ochtend",lo:360, hi:720,  label:"ochtend 06–12", mid:540},
  {key:"middag", lo:720, hi:1080, label:"middag 12–18",  mid:900},
  {key:"avond",  lo:1080,hi:1440, label:"avond 18–24",   mid:1260},
];
const daypartOf=min=>DAYPARTS.find(d=>min>=d.lo&&min<d.hi)||DAYPARTS[0];
// Dagdeel-namen drietalig (gedeeld door veel teksten). key → naam / label met uren.
const _DPN={ nacht:["nacht","night","noite"], ochtend:["ochtend","morning","manhã"], middag:["middag","afternoon","tarde"], avond:["avond","evening","noite"] };
const dpName = k => { const a=_DPN[k]; return a?TL(a[0],a[1],a[2]):k; };
const _DPL={ nacht:["nacht 00–06","night 00–06","noite 00–06"], ochtend:["ochtend 06–12","morning 06–12","manhã 06–12"], middag:["middag 12–18","afternoon 12–18","tarde 12–18"], avond:["avond 18–24","evening 18–24","noite 18–24"] };
const dpLabel = k => { const a=_DPL[k]; return a?TL(a[0],a[1],a[2]):k; };
// Maaltijd-dagdelen (ontbijt/lunch/diner) drietalig.
const _MEALN={ ontbijt:["ontbijt","breakfast","pequeno-almoço"], lunch:["lunch","lunch","almoço"], diner:["diner","dinner","jantar"] };
const mealName = k => { const a=_MEALN[k]; return a?TL(a[0],a[1],a[2]):k; };
// Waargenomen ISF uit geïsoleerde correctiebolussen: hoeveel liet 1 E je glucose
// werkelijk dalen? Streng gefilterd (geen koolhydraten, nauwelijks andere insuline,
// verhoogde start) en uitdrukkelijk indicatief — basaaldrift en resterend eten storen.
// Closed loop: ISF uit SMB-respons. Alleen indicatief: de loop past óók temp-basaal aan, dus dit meet de respons
// op "extra" insuline (SMB's) in koolhydraatvrije vensters, niet een zuivere ISF. Bespreekmateriaal voor je team.
function smbISF(glucose, treatments, timeline, q){
  const WIN=3*3600e3, PRE=2*3600e3, MIN_BG=8, MIN_U=0.4, MIN_EV=12;
  const carbTs=treatments.filter(t=>t.carbs>0).map(t=>t.ts).sort((a,b)=>a-b);
  const nearCarb=(a,b)=>{ let lo=0,hi=carbTs.length; while(lo<hi){const m=(lo+hi)>>1; if(carbTs[m]<a)lo=m+1;else hi=m;} return lo<carbTs.length&&carbTs[lo]<=b; };
  const smb=treatments.filter(t=>t.isSMB&&t.insulin>0).sort((a,b)=>a.ts-b.ts);
  const bolus=treatments.filter(t=>t.insulin>0&&!t.isSMB&&!(t.carbs>0));
  const T=glucose.map(g=>g.ts); const lb=ts=>{let lo=0,hi=T.length;while(lo<hi){const m=(lo+hi)>>1;if(T[m]<ts)lo=m+1;else hi=m;}return lo;};
  const okDay=ts=>!q||!q.usableKeys||q.usableKeys.has(localDayKey(ts));
  const ev=[]; let i=0;
  while(i<smb.length){
    const s0=smb[i]; i++;
    if(!okDay(s0.ts)||nearCarb(s0.ts-PRE,s0.ts+WIN)) continue;
    let u=s0.insulin; while(i<smb.length&&smb[i].ts<s0.ts+WIN){ u+=smb[i].insulin; i++; }
    if(u<MIN_U) continue;
    if(bolus.some(b=>b.ts>s0.ts-3600e3&&b.ts<s0.ts+WIN)) continue;            // geen handmatige bolus in het venster
    const k=lb(s0.ts); if(k>=T.length||T[k]-s0.ts>10*60e3) continue;
    const win=[]; for(let j=k;j<T.length&&T[j]<=s0.ts+WIN;j++) win.push(glucose[j]);
    if(win.length<24) continue;
    const bg0=win[0].bg; if(bg0<MIN_BG) continue;
    const tail=win.slice(-3), bgEnd=tail.reduce((a,x)=>a+x.bg,0)/3;
    const p=timeline&&profileAt(timeline,s0.ts), dia=Math.max(300,((p&&p.dia)||6)*60), frac=1-insulinModel(PEAK_MIN,dia).iob(WIN/60000);
    if(frac<0.4) continue;
    ev.push({ts:s0.ts, isf:(bg0-bgEnd)/(u*frac), u, isfP:(p&&p.isf)||null});
  }
  if(ev.length<MIN_EV) return { n:ev.length };
  const s=ev.map(e=>e.isf).sort((a,b)=>a-b), med=s[Math.floor(s.length/2)], q1=s[Math.floor(s.length*.25)], q3=s[Math.floor(s.length*.75)];
  const pr=ev.map(e=>e.isfP).filter(Boolean).sort((a,b)=>a-b);
  return { n:ev.length, med, q1, q3, prof:pr.length?pr[Math.floor(pr.length/2)]:null };
}
function observedISF(glucose, treatments, timeline){
  const WIN=3*3600e3, CLEAN=60*60e3, MIN_EV=8, MIN_BG=8, MIN_U=0.5;
  const carbTs=treatments.filter(t=>t.carbs>0).map(t=>t.ts).sort((a,b)=>a-b);
  const bol=treatments.filter(t=>t.insulin>0).sort((a,b)=>a.ts-b.ts);
  const corr=bol.filter(t=>t.insulin>=MIN_U && !(t.carbs>0) && !t.isSMB);
  const T=glucose.map(g=>g.ts); const lb=ts=>{let lo=0,hi=T.length;while(lo<hi){const m=(lo+hi)>>1;if(T[m]<ts)lo=m+1;else hi=m;}return lo;};
  const ratios=[]; const isfProf=[]; const evRaw=[];
  for(const c of corr){
    if(carbTs.some(ct=>ct>c.ts-CLEAN && ct<c.ts+WIN)) continue;
    const others=bol.filter(b=>b!==c && b.ts>c.ts-CLEAN && b.ts<c.ts+WIN);
    const otherU=others.reduce((s,b)=>s+b.insulin,0);
    if(otherU>0.3*c.insulin) continue;                       // deze correctie moet dominant zijn
    const win=[]; for(let i=lb(c.ts);i<T.length&&T[i]<=c.ts+WIN;i++)win.push(glucose[i]);
    if(win.length<24 || win[0].ts-c.ts>10*60e3) continue;    // ~ dekkend venster, start bij bolus
    const bg0=win[0].bg; if(bg0<MIN_BG) continue;
    const tail=win.slice(-3); const bgEnd=tail.reduce((s,x)=>s+x.bg,0)/tail.length;
    // Óók niet-gedaalde correcties tellen mee (resistentie, niet-gelogd eten):
    // alleen successen middelen zou de gevoeligheid systematisch overschatten.
    const drop=bg0-bgEnd;
    const p=timeline&&profileAt(timeline,c.ts);
    // Corrigeer voor de fractie insuline die binnen het venster is opgenomen (venster < DIA),
    // anders onderschat je de ISF stelselmatig.
    const dia=Math.max(300,((p&&p.dia)||6)*60), frac=1-insulinModel(PEAK_MIN,dia).iob(WIN/60000);
    if(frac<0.4) continue;
    ratios.push(drop/((c.insulin+otherU)*frac));
    if(p&&p.isf) isfProf.push(p.isf);
    evRaw.push({ ts:c.ts, u:c.insulin+otherU, dia, win, isfP:(p&&p.isf)?p.isf:null });   // ruwe data voor de correctie-simulatie
  }
  if(ratios.length<MIN_EV) return { n:ratios.length };
  const s=[...ratios].sort((x,y)=>x-y), qf=p=>s[Math.min(s.length-1,Math.floor(p*s.length))];
  const med=a=>{const t=[...a].sort((x,y)=>x-y);return t[Math.floor(t.length/2)];};
  // Per dagdeel: dezelfde ratio's, gesplitst op tijd-van-de-dag.
  const byDP={};
  for(const d of DAYPARTS){ const idx=[]; for(let i=0;i<ratios.length;i++){ if(daypartOf(todMin(evRaw[i].ts)).key===d.key) idx.push(i); }
    if(idx.length<5){ byDP[d.key]={n:idx.length}; continue; }
    const rr=idx.map(i=>ratios[i]).sort((x,y)=>x-y), q=p=>rr[Math.min(rr.length-1,Math.floor(p*rr.length))];
    const pr=idx.map(i=>evRaw[i].isfP).filter(v=>v!=null);
    byDP[d.key]={ n:idx.length, obs:q(.5), q25:q(.25), q75:q(.75), prof:pr.length?med(pr):null, evRaw:idx.map(i=>evRaw[i]) }; }
  return { n:ratios.length, obs:qf(.5), q25:qf(.25), q75:qf(.75),
    prof:isfProf.length?med(isfProf):null, evRaw, byDP };
}
// Gemeten piektijd: na een schone correctie daalt je glucose het snelst rond het
// moment dat de insuline piekt. Uit de correctiecurves (dezelfde evRaw als de gemeten
// ISF) halen we het tijdstip van de steilste daling — een indicatie van je werkelijke
// piektijd naast de ingestelde. Tegenregulatie kan de gemeten piek iets naar voren
// halen; het is een bespreekpunt, geen exacte meting.
function observedPeak(oi){
  if(!oi || !oi.evRaw) return { n:0 };
  const peaks=[];
  for(const e of oi.evRaw){ const w=e.win; if(!w || w.length<16) continue;
    // Licht (3-punts) gladgestreken curve tegen sensorruis, dan de kortste helling —
    // een breed gemiddelde zou de piek stelselmatig naar voren trekken.
    const sm=w.map((p,i)=>{ const lo=Math.max(0,i-1),hi=Math.min(w.length-1,i+1); let s=0,c=0;
      for(let j=lo;j<=hi;j++){ s+=w[j].bg; c++; } return { ts:p.ts, bg:s/c }; });
    let best=null;
    for(let i=1;i<sm.length;i++){ const dt=(sm[i].ts-sm[i-1].ts)/60000; if(dt<=0||dt>10) continue;
      const slope=(sm[i].bg-sm[i-1].bg)/dt;                   // mmol/L per min
      const tmid=((sm[i].ts+sm[i-1].ts)/2-e.ts)/60000;
      if(tmid<15 || tmid>150) continue;                       // plausibel piekvenster
      if(best===null || slope<best.slope) best={t:tmid, slope}; }
    if(best && best.slope<-0.01) peaks.push(best.t);          // echte daling (< −0,6 /u)
  }
  if(peaks.length<8) return { n:peaks.length, few:true };
  const s=[...peaks].sort((x,y)=>x-y), q=p=>s[Math.min(s.length-1,Math.floor(p*s.length))];
  return { n:peaks.length, obs:Math.round(q(.5)), q25:Math.round(q(.25)), q75:Math.round(q(.75)) };
}
// De "Profiel"-sectie: het actieve basaal/ISF/KH-schema plus een koppeling naar
// wat de data laat zien (basaalaandeel, waargenomen ISF, koolhydraatschatting).
function profileHtml(pi, oi, ins, MR){
  const nl2=v=>v==null?"—":v.toFixed(2).replace(".",","), icf=v=>{const r=Math.round(v*10)/10; return (r%1===0?String(r):r.toFixed(1)).replace(".",",");};
  const range=(arr,fmt)=>{ if(!arr.length) return "—"; const vs=arr.map(b=>b.value), mn=Math.min(...vs), mx=Math.max(...vs);
    return Math.abs(mx-mn)<1e-9?fmt(mn):`${fmt(mn)}–${fmt(mx)}`; };
  const col=(title,rows,unit,fmt)=> `<div class="pcol"><div class="ph">${title}</div>`+
    (rows.length?rows.map(b=>`<div class="prow"><span>${fmtMin(b.from)}</span><b>${fmt(b.value)}</b></div>`).join(""):`<div class="prow"><span>—</span><b>—</b></div>`)+
    `<div class="pu">${unit}</div></div>`;
  const kpis=[
    [TL("Basaal / dag","Basal / day","Basal / dia"), nl2(pi.basalDaily)+" "+TL("E","U","U"), TL(`${pi.basal.length} blok${pi.basal.length===1?"":"ken"}`,`${pi.basal.length} block${pi.basal.length===1?"":"s"}`,`${pi.basal.length} bloco${pi.basal.length===1?"":"s"}`)],
    ["ISF", range(pi.isf,nl1), TL("mmol/L per E","mmol/L per U","mmol/L por U")],
    [TL("KH-ratio","Carb ratio","Rácio hidr."), range(pi.ic,icf), TL("g per E","g per U","g por U")],
  ].map(([k,v,s])=>`<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");

  // Koppeling profiel ↔ data
  const obs=[];
  if(ins&&ins.basalPct!=null) obs.push(TL(`Je basaal telt op tot <b>${nl2(pi.basalDaily)} E/dag</b> — ${Math.round(ins.basalPct*100)}% van je totale dosis. Voor pomptherapie ligt basaal vaak rond 40–50%.`,`Your basal totals <b>${nl2(pi.basalDaily)} U/day</b> — ${Math.round(ins.basalPct*100)}% of your total dose. For pump therapy basal is often around 40–50%.`,`A sua basal soma <b>${nl2(pi.basalDaily)} U/dia</b> — ${Math.round(ins.basalPct*100)}% da dose total. Na terapia com bomba a basal ronda muitas vezes 40–50%.`));
  // Piektijd: gemeten steilste-daling-moment naast de ingestelde piektijd van het model.
  { const pk=observedPeak(oi);
    if(pk.obs!=null){ const d=pk.obs-PEAK_MIN;   // meet stelselmatig ~10–15 min vroeg → asymmetrische band
      const judge = (d>=-30 && d<=20) ? TL(`sluit aan bij je ingestelde <b>${PEAK_MIN} min</b>.`,`aligns with your set <b>${PEAK_MIN} min</b>.`,`alinha com os seus <b>${PEAK_MIN} min</b> definidos.`)
        : d<-30 ? TL(`duidelijk eerder dan je ingestelde <b>${PEAK_MIN} min</b> — je insuline lijkt sneller (Fiasp/Lyumjev pieken eerder); check je insulinesoort-instelling.`,`clearly earlier than your set <b>${PEAK_MIN} min</b> — your insulin seems faster (Fiasp/Lyumjev peak earlier); check your insulin-type setting.`,`claramente mais cedo que os seus <b>${PEAK_MIN} min</b> definidos — a sua insulina parece mais rápida (Fiasp/Lyumjev picam mais cedo); verifique a definição do tipo de insulina.`)
        : TL(`later dan je ingestelde <b>${PEAK_MIN} min</b> — je insuline lijkt trager. Bespreekpunt.`,`later than your set <b>${PEAK_MIN} min</b> — your insulin seems slower. Discussion point.`,`mais tarde que os seus <b>${PEAK_MIN} min</b> definidos — a sua insulina parece mais lenta. Ponto de discussão.`);
      obs.push(TL(`Piektijd: steilste daling mediaan rond <b>${pk.obs} min</b> (n=${pk.n}) — ${judge} Vormt je IOB-curve, waar je loop op stuurt. Leest ~10–15 min vroeg; indicatie, geen exacte meting.`,`Peak time: steepest fall median around <b>${pk.obs} min</b> (n=${pk.n}) — ${judge} It shapes your IOB curve, which your loop steers on. Reads ~10–15 min early; an indication, not an exact measurement.`,`Tempo de pico: descida mais acentuada mediana por volta de <b>${pk.obs} min</b> (n=${pk.n}) — ${judge} Molda a sua curva de IOB, que o loop controla. Lê ~10–15 min mais cedo; uma indicação, não uma medição exata.`)); } }
  // Gemeten ISF/basaal naast je instelling staat op Overzicht (samenvatting) en in
  // Bespreekwaarden (per dagdeel) — hier alleen je ingestelde schema.
  if(MR&&MR.results.length>=MEAL_MIN){ const fr=MR.mfrac;
    obs.push(TL(`Van je ingevoerde koolhydraten zie ik mediaan <b>${pct0(fr)}</b> terug. Let op: deze maat telt alleen posítieve afwijkingen en valt daardoor structureel te hoog uit — alleen als context, nooit als bewijs van onderschatten.`,`Of your entered carbs I see a median of <b>${pct0(fr)}</b> back. Note: this measure only counts positive deviations and therefore runs structurally high — context only, never proof of underestimating.`,`Dos hidratos introduzidos vejo uma mediana de <b>${pct0(fr)}</b> de volta. Nota: esta medida só conta desvios positivos e por isso sai estruturalmente alta — apenas contexto, nunca prova de subestimação.`)); }

  const meta=[]; if(pi.name) meta.push(TL(`profiel <b>${esc(pi.name)}</b>`,`profile <b>${esc(pi.name)}</b>`,`perfil <b>${esc(pi.name)}</b>`));
  meta.push(`DIA ${nl1(pi.dia)} ${TL("u","h","h")}`);
  if(pi.source==="switch"&&pi.switchTs) meta.push(TL(`profielwissel actief sinds ${new Date(pi.switchTs).toLocaleDateString(LOCALE(),{day:"2-digit",month:"short"})}`,`profile switch active since ${new Date(pi.switchTs).toLocaleDateString(LOCALE(),{day:"2-digit",month:"short"})}`,`troca de perfil ativa desde ${new Date(pi.switchTs).toLocaleDateString(LOCALE(),{day:"2-digit",month:"short"})}`));
  if(pi.pct!==100) meta.push(TL(`<b>${pi.pct}%</b> ingesteld`,`<b>${pi.pct}%</b> set`,`<b>${pi.pct}%</b> definido`));
  if(pi.shift) meta.push(TL(`tijdverschuiving ${pi.shift} u (niet in tijden verwerkt)`,`time shift ${pi.shift} h (not applied to times)`,`desvio de tempo ${pi.shift} h (não aplicado aos horários)`));

  return `<div class="kpis">${kpis}</div>`+
    `<div class="prof3">${col(TL("Basaal","Basal","Basal"),pi.basal,TL("E/u","U/h","U/h"),nl2)}${col("ISF",pi.isf,"mmol/L·"+TL("E","U","U"),nl1)}${col(TL("KH-ratio","Carb ratio","Rácio hidr."),pi.ic,"g/"+TL("E","U","U"),icf)}</div>`+
    `<div class="obs">${obs.join(" ")}</div>`+
    `<div class="muted" style="margin-top:.5rem">${meta.join(" · ")}. ${TL("Je ingestelde profiel uit Nightscout.","Your configured profile from Nightscout.","O seu perfil configurado do Nightscout.")}</div>`;
}
// Fine-tune-paneel: per hefboom (basaal → ISF → KH-ratio → prebolus) een lezing —
// "klopt", "mogelijk bijstellen + richting", of "te weinig data" — met het bewijs.
// De volgorde is de testvolgorde: eerst de laag eronder, dan de laag erboven.
function fineTuneData(drift, oi, MR, stack, pi){
  const rows=[]; const mealsOk = MR && MR.results.length>=MEAL_MIN;
  const nMeals = MR?MR.results.length:0;
  const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:null;};
  const isfRef = (oi&&oi.obs>0.5)?oi.obs : (pi&&pi.isf&&pi.isf.length?med(pi.isf.map(b=>b.value)):null);

  // 1 — Basaal
  { let st="na", read, dir=null, ev;
    if(!drift||!drift.stat){ read=TL("Te weinig nuchtere vensters om basaaldrift te meten. Bij een closed loop maskeert temp-basaal de drift — zie <b>Loop-basaal</b> voor de betere ingang.","Too few fasting windows to measure basal drift. With a closed loop, temp basal masks the drift — see <b>Loop basal</b> for the better entry point.","Poucas janelas em jejum para medir a deriva basal. Num closed loop a basal temporária mascara a deriva — veja <b>Basal do loop</b> para a melhor entrada."); ev=TL("drempel 0,3 mmol/L/u","threshold 0.3 mmol/L/h","limiar 0,3 mmol/L/h"); }
    else if(!drift.up.length && !drift.down.length){ st="ok"; read=TL("In stille vensters drijf je nergens structureel weg — je basaal lijkt over de dag in balans.","In quiet windows you don't drift structurally anywhere — your basal seems balanced across the day.","Em janelas calmas não deriva estruturalmente em lado nenhum — a sua basal parece equilibrada ao longo do dia."); ev=TL(`n = ${drift.total.toLocaleString(LOCALE())} driftmetingen`,`n = ${drift.total.toLocaleString(LOCALE())} drift readings`,`n = ${drift.total.toLocaleString(LOCALE())} medições de deriva`); }
    else { st="warn"; const parts=[], dirs=[];
      const eq = v => isfRef ? TL(` ≈ <b>${nl1(Math.abs(v)/isfRef)} E/u</b> verschil`,` ≈ <b>${nl1(Math.abs(v)/isfRef)} U/h</b> difference`,` ≈ <b>${nl1(Math.abs(v)/isfRef)} U/h</b> de diferença`) : "";
      if(drift.up.length){ parts.push(TL(`stijg je nuchter rond <b>${joinHrs(drift.up.map(s=>s.h)).join(", ")}</b> (tot ${nl1(drift.peakUp)} mmol/L/u${eq(drift.peakUp)})`,`you rise when fasting around <b>${joinHrs(drift.up.map(s=>s.h)).join(", ")}</b> (up to ${nl1(drift.peakUp)} mmol/L/h${eq(drift.peakUp)})`,`sobe em jejum por volta de <b>${joinHrs(drift.up.map(s=>s.h)).join(", ")}</b> (até ${nl1(drift.peakUp)} mmol/L/h${eq(drift.peakUp)})`)); dirs.push(TL(`iets hóger basaal rond ${joinHrs(drift.up.map(s=>s.h)).join(", ")}`,`slightly higher basal around ${joinHrs(drift.up.map(s=>s.h)).join(", ")}`,`basal ligeiramente mais alta por volta de ${joinHrs(drift.up.map(s=>s.h)).join(", ")}`)); }
      if(drift.down.length){ parts.push(TL(`zak je nuchter rond <b>${joinHrs(drift.down.map(s=>s.h)).join(", ")}</b> (tot ${nl1(drift.peakDown)} mmol/L/u${eq(drift.peakDown)})`,`you fall when fasting around <b>${joinHrs(drift.down.map(s=>s.h)).join(", ")}</b> (up to ${nl1(drift.peakDown)} mmol/L/h${eq(drift.peakDown)})`,`desce em jejum por volta de <b>${joinHrs(drift.down.map(s=>s.h)).join(", ")}</b> (até ${nl1(drift.peakDown)} mmol/L/h${eq(drift.peakDown)})`)); dirs.push(TL(`iets láger basaal rond ${joinHrs(drift.down.map(s=>s.h)).join(", ")}`,`slightly lower basal around ${joinHrs(drift.down.map(s=>s.h)).join(", ")}`,`basal ligeiramente mais baixa por volta de ${joinHrs(drift.down.map(s=>s.h)).join(", ")}`)); }
      read=parts.join(TL(" en "," and "," e "))+`.${isfRef?TL(" Het E/u-getal is de gemeten omvang van de drift."," The U/h figure is the measured size of the drift."," O valor U/h é a dimensão medida da deriva."):""}`;
      dir=dirs.join("; ")+TL(" — in AAPS pas je een blok ~1–2 u vóór het effect aan"," — in AAPS you adjust a block ~1–2 h before the effect"," — no AAPS ajusta um bloco ~1–2 h antes do efeito"); ev=TL(`n = ${drift.total.toLocaleString(LOCALE())} driftmetingen · omvang via ${oi&&oi.obs>0.5?"gemeten":"profiel-"}ISF`,`n = ${drift.total.toLocaleString(LOCALE())} drift readings · size via ${oi&&oi.obs>0.5?"measured":"profile"} ISF`,`n = ${drift.total.toLocaleString(LOCALE())} medições de deriva · dimensão via ISF ${oi&&oi.obs>0.5?"medido":"do perfil"}`); }
    rows.push({n:1,title:TL("Basaal","Basal","Basal"),st,read,dir,ev}); }

  // 2 — ISF (correctiefactor)
  { let st="na", read, dir=null, ev=`n = ${oi?oi.n:0}`;
    if(!oi||oi.obs==null){ read=TL(`Te weinig schone <b>handmatige</b> correcties (${oi?oi.n:0}/8) om je ISF te meten. Bij een closed loop corrigeer je meestal via SMB's.`,`Too few clean <b>manual</b> corrections (${oi?oi.n:0}/8) to measure your ISF. With a closed loop you usually correct via SMBs.`,`Poucas correções <b>manuais</b> limpas (${oi?oi.n:0}/8) para medir o seu ISF. Num closed loop corrige normalmente via SMB.`); }
    else if(oi.prof==null){ read=TL(`Gemeten daling ~${nl1(oi.obs)} mmol/L per E (IQR ${nl1(oi.q25)}–${nl1(oi.q75)}), maar geen profiel-ISF om naast te leggen.`,`Measured fall ~${nl1(oi.obs)} mmol/L per U (IQR ${nl1(oi.q25)}–${nl1(oi.q75)}), but no profile ISF to compare against.`,`Descida medida ~${nl1(oi.obs)} mmol/L por U (IQR ${nl1(oi.q25)}–${nl1(oi.q75)}), mas sem ISF de perfil para comparar.`); ev=`n = ${oi.n}`; }
    else { const r=oi.obs/oi.prof; ev=TL(`n = ${oi.n} correcties · IQR ${nl1(oi.q25)}–${nl1(oi.q75)}`,`n = ${oi.n} corrections · IQR ${nl1(oi.q25)}–${nl1(oi.q75)}`,`n = ${oi.n} correções · IQR ${nl1(oi.q25)}–${nl1(oi.q75)}`);
      if(r>=0.8 && r<=1.25){ st="ok"; read=TL(`Gemeten <b>${nl1(oi.obs)}</b> mmol/L per E naast ingesteld <b>${nl1(oi.prof)}</b> — die sluiten op elkaar aan.`,`Measured <b>${nl1(oi.obs)}</b> mmol/L per U next to set <b>${nl1(oi.prof)}</b> — these align.`,`Medido <b>${nl1(oi.obs)}</b> mmol/L por U face ao definido <b>${nl1(oi.prof)}</b> — alinham.`); }
      else if(r>1.25){ st="warn"; read=TL(`Gemeten <b>${nl1(oi.obs)}</b> mmol/L per E naast ingesteld <b>${nl1(oi.prof)}</b> — je bent gevoeliger dan je profiel aanneemt; correcties kunnen doorschieten naar een low${stack&&stack.elevated?`, en gestapelde correcties gingen inderdaad vaak vóór je hypo's`:``}.`,`Measured <b>${nl1(oi.obs)}</b> mmol/L per U next to set <b>${nl1(oi.prof)}</b> — you're more sensitive than your profile assumes; corrections may overshoot into a low${stack&&stack.elevated?`, and stacked corrections did indeed often precede your lows`:``}.`,`Medido <b>${nl1(oi.obs)}</b> mmol/L por U face ao definido <b>${nl1(oi.prof)}</b> — é mais sensível do que o perfil assume; as correções podem exceder para uma hipo${stack&&stack.elevated?`, e correções acumuladas precederam de facto muitas das suas hipos`:``}.`); dir=TL(`een concreet getal — per dagdeel — staat bij Bespreekwaarden`,`a concrete number — per part of day — is in Discussion values`,`um número concreto — por período do dia — está em Valores para discussão`); }
      else { st="warn"; read=TL(`Gemeten <b>${nl1(oi.obs)}</b> mmol/L per E naast ingesteld <b>${nl1(oi.prof)}</b> — correcties doen minder dan je profiel aanneemt.`,`Measured <b>${nl1(oi.obs)}</b> mmol/L per U next to set <b>${nl1(oi.prof)}</b> — corrections do less than your profile assumes.`,`Medido <b>${nl1(oi.obs)}</b> mmol/L por U face ao definido <b>${nl1(oi.prof)}</b> — as correções fazem menos do que o perfil assume.`); dir=TL(`een concreet getal — per dagdeel — staat bij Bespreekwaarden`,`a concrete number — per part of day — is in Discussion values`,`um número concreto — por período do dia — está em Valores para discussão`); } }
    rows.push({n:2,title:TL("ISF · correctiefactor","ISF · correction factor","ISF · fator de correção"),st,read,dir,ev}); }

  // 3 — KH-ratio (oordeel op de píék — de koolhydraatfractie is structureel geïnflateerd
  // door de alleen-positieve-deviaties-methode en telt daarom niet mee als criterium)
  { let st="na", read, dir=null, ev=TL(`n = ${nMeals} maaltijden`,`n = ${nMeals} meals`,`n = ${nMeals} refeições`);
    if(!mealsOk){ read=TL("Nog te weinig geïsoleerde maaltijden (met profieldata) om je KH-ratio te toetsen.","Still too few isolated meals (with profile data) to test your carb ratio.","Ainda poucas refeições isoladas (com dados de perfil) para testar o seu rácio de hidratos."); }
    else { const rise=MR.mrise; ev=TL(`n = ${nMeals} maaltijden · oordeel op piek; KH-fractie alleen context`,`n = ${nMeals} meals · judged on peak; carb fraction context only`,`n = ${nMeals} refeições · avaliado no pico; fração de hidratos só contexto`);
      if(rise<2.5){ st="ok"; read=TL(`Je maaltijdpieken blijven beperkt (mediaan +${nl1(rise)} mmol/L) — eten en insuline sluiten goed aan.`,`Your meal peaks stay limited (median +${nl1(rise)} mmol/L) — food and insulin align well.`,`Os seus picos de refeição mantêm-se limitados (mediana +${nl1(rise)} mmol/L) — comida e insulina alinham bem.`); }
      else if(rise>=4){ st="warn"; read=TL(`Grote maaltijdpiek (mediaan +${nl1(rise)} mmol/L, tot ~${nl1(MR.mpeak)}) — de maaltijddekking schiet tekort of komt te laat.`,`Large meal peak (median +${nl1(rise)} mmol/L, up to ~${nl1(MR.mpeak)}) — meal coverage falls short or comes too late.`,`Pico de refeição grande (mediana +${nl1(rise)} mmol/L, até ~${nl1(MR.mpeak)}) — a cobertura da refeição é insuficiente ou tardia.`); dir=TL("KH-ratio mogelijk te zwak (minder g per E) — óf de bolus komt te laat (zie timing hieronder)","carb ratio possibly too weak (fewer g per U) — or the bolus comes too late (see timing below)","rácio de hidratos possivelmente fraco (menos g por U) — ou o bólus chega tarde (ver timing abaixo)"); }
      else { st="warn"; read=TL(`Matige maaltijdpiek (mediaan +${nl1(rise)} mmol/L). Deels een dekkings-, deels een timingkwestie.`,`Moderate meal peak (median +${nl1(rise)} mmol/L). Partly a coverage, partly a timing issue.`,`Pico de refeição moderado (mediana +${nl1(rise)} mmol/L). Parte cobertura, parte timing.`); dir=TL("een iets sterkere KH-ratio óf eerdere prebolus — timing eerst (zie hieronder)","a slightly stronger carb ratio or an earlier prebolus — timing first (see below)","um rácio de hidratos ligeiramente mais forte ou um prebólus mais cedo — timing primeiro (ver abaixo)"); } }
    rows.push({n:3,title:TL("KH-ratio","Carb ratio","Rácio de hidratos"),st,read,dir,ev}); }

  // 4 — Prebolus / timing
  { let st="na", read, dir=null, ev=TL(`n = ${nMeals} maaltijden`,`n = ${nMeals} meals`,`n = ${nMeals} refeições`);
    if(!mealsOk || MR.moffset==null){ read=TL("Nog te weinig maaltijden met bolus-timing om je prebolus te beoordelen.","Still too few meals with bolus timing to assess your prebolus.","Ainda poucas refeições com timing de bólus para avaliar o seu prebólus."); }
    else { const off=MR.moffset, rise=MR.mrise; const nT=MR.results.filter(r=>r.bolusOffset!=null).length; ev=TL(`n = ${nT} maaltijden · handmatige bolus t.o.v. je koolhydraat-invoer (= je bolusmoment als je met de wizard logt), SMB's tellen niet mee`,`n = ${nT} meals · manual bolus relative to your carb entry (= your bolus moment when you log with the wizard), SMBs don't count`,`n = ${nT} refeições · bólus manual face à entrada de hidratos (= o momento do bólus quando regista com o assistente), os SMB não contam`);
      if(off<-5){ st="ok"; read=TL(`Je bolust gemiddeld ${Math.round(-off)} min vóór het eten — een goede prebolus.`,`You bolus on average ${Math.round(-off)} min before eating — a good prebolus.`,`Bolusa em média ${Math.round(-off)} min antes de comer — um bom prebólus.`); }
      else if(rise>=3){ st="warn"; read=TL(`Je bolust ${off>5?`gemiddeld ${Math.round(off)} min ná`:"rond het moment van"} eten en piekt +${nl1(rise)} mmol/L.`,`You bolus ${off>5?`on average ${Math.round(off)} min after`:"around the moment of"} eating and peak +${nl1(rise)} mmol/L.`,`Bolusa ${off>5?`em média ${Math.round(off)} min após`:"por volta do momento de"} comer e o pico é +${nl1(rise)} mmol/L.`); dir=TL("bolus 10–15 min eerder — dat dempt de piek zónder meer insuline","bolus 10–15 min earlier — that dampens the peak without more insulin","bólus 10–15 min mais cedo — isso reduz o pico sem mais insulina"); }
      else { st="ok"; read=TL(`Je bolust ${off>5?`${Math.round(off)} min ná`:"rond"} het eten, maar je piek blijft beperkt — timing is hier geen knelpunt.`,`You bolus ${off>5?`${Math.round(off)} min after`:"around"} eating, but your peak stays limited — timing isn't a bottleneck here.`,`Bolusa ${off>5?`${Math.round(off)} min após`:"por volta de"} comer, mas o pico mantém-se limitado — o timing não é aqui um problema.`); } }
    rows.push({n:4,title:TL("Prebolus · timing","Prebolus · timing","Prebólus · timing"),st,read,dir,ev}); }

  return rows;
}
function fineTune(drift, oi, MR, stack, pi){
  const rows=fineTuneData(drift, oi, MR, stack, pi);
  const mealsOk=MR&&MR.results.length>=MEAL_MIN;
  const stTd=r=> r.st==="ok"?'<td class="st okd">✓</td>' : r.st==="warn"?'<td class="st wad">▲</td>' : '<td class="st" style="color:var(--dim)">·</td>';
  const driftPeak = drift&&drift.stat&&(drift.up.length||drift.down.length)
    ? nl1(Math.max(drift.peakUp||0,Math.abs(drift.peakDown||0)))+" /"+TL("u","h","h") : (drift&&drift.stat?num(0)+" /"+TL("u","h","h"):"—");
  const line=(label,gem,set2,r)=>`<tr><td>${label}</td><td>${gem}</td><td>${set2}</td>${stTd(r)}</tr>`;
  const table=`<table class="mvs">`+
    line("ISF", oi&&oi.obs!=null?nl1(oi.obs):"—", oi&&oi.prof!=null?nl1(oi.prof):"—", rows[1])+
    line(TL("Basaaldrift","Basal drift","Deriva basal"), driftPeak, "—", rows[0])+
    line(TL("Maaltijdpiek","Meal peak","Pico refeição"), mealsOk?"+"+nl1(MR.mrise):"—", "&lt;"+num(2.5), rows[2])+
    line(TL("Prebolus","Prebolus","Prebólus"), mealsOk&&MR.moffset!=null?Math.round(MR.moffset)+" m":"—", "—", rows[3])+
    `</table>`;
  const chains=rows.map((r,i)=>`<div class="step"><span class="no">${i+1}</span><span><b>${r.title}.</b> ${r.read}${r.dir?`<br><span style="color:var(--ink)">→ ${r.dir}.</span>`:""}<br><span class="ffine" style="margin:0">${r.ev}</span></span></div>`).join("");
  const warns=rows.filter(r=>r.st==="warn").length;
  return table+
    `<details style="margin-top:.6rem"><summary style="list-style:none;cursor:pointer;font-size:.76rem;font-weight:650;color:var(--t-accent)">${warns?TL(`wat betekent ▲ (${warns})`,`what does ▲ mean (${warns})`,`o que significa ▲ (${warns})`):TL("uitleg per regel","explanation per line","explicação por linha")} ↓</summary>`+
    `<div class="chain" style="margin-top:.5rem">${chains}</div>`+
    `<div class="ffine" style="margin-left:0">${TL("meetwaarden, geen voorschriften · één ding tegelijk aanpassen, met je team","measured values, not prescriptions · change one thing at a time, with your team","valores medidos, não prescrições · altere uma coisa de cada vez, com a sua equipa")}</div></details>`;
}

/* ── Dekking ────────────────────────────────────────────────────────────── */
const EXPECTED_PER_DAY = 288, MIN_COVERAGE = 0.70;
// Closed loop: dagen waarop de loop nauwelijks actief was (telefoon/AAPS uit, geen upload)
// geven een vertekend beeld van je instellingen. Alleen voor gebruikers met veel
// loop-activiteit (mediaan >= 40 temp-basalen/SMB's per dag); drempel 30% van de mediaan.
function loopGapDays(treatments, dayKeys){
  const per = new Map();
  for (const t of treatments){ if (/temp basal/i.test(t.type||"") || t.isSMB){ const k=localDayKey(t.ts); per.set(k,(per.get(k)||0)+1); } }
  const vals = [...per.values()].sort((a,b)=>a-b);
  if (vals.length<7) return new Set();
  const med = vals[vals.length>>1]; if (med<40) return new Set();
  const th = Math.max(15, med*0.3);
  return new Set(dayKeys.filter(k=>(per.get(k)||0)<th));
}
function quality(glucose, treatments){
  const perDay = new Map();
  for (const g of glucose){ const k=localDayKey(g.ts); perDay.set(k,(perDay.get(k)||0)+1); }
  const days = [...perDay.entries()].map(([day,n])=>({day,n,coverage:n/EXPECTED_PER_DAY})).sort((a,b)=>a.day.localeCompare(b.day));
  let usable = days.filter(d=>d.coverage>=MIN_COVERAGE);
  let loopGaps = new Set();
  if (cfg.loopgap!==false && treatments && treatments.length){
    loopGaps = loopGapDays(treatments, usable.map(d=>d.day));
    if (loopGaps.size) usable = usable.filter(d=>!loopGaps.has(d.day));
  }
  let gaps=0; for (let i=1;i<glucose.length;i++) if (glucose[i].ts-glucose[i-1].ts>30*60e3) gaps++;
  return { days, usable, loopGaps:[...loopGaps].sort(), usableKeys:new Set(usable.map(d=>d.day)),
    coverage: days.length ? days.reduce((s,d)=>s+Math.min(d.coverage,1),0)/days.length : 0,
    gaps, from: glucose.length?glucose[0].ts:null, to: glucose.length?glucose[glucose.length-1].ts:null };
}

/* ══ BEREKENINGEN ══════════════════════════════════════════════════════════ */
function metrics(g){
  const counts = Object.fromEntries(BANDS.map(b=>[b.id,0]));
  for (const x of g) counts[bandOf(x.bg).id]++;
  const share = id => counts[id]/g.length;
  const mean = g.reduce((s,x)=>s+x.bg,0)/g.length;
  const titr = g.filter(x=>x.bg>=3.9 && x.bg<=7.8).length/g.length;
  const sd = Math.sqrt(g.reduce((s,x)=>s+(x.bg-mean)**2,0)/g.length);
  return { n:g.length, mean, titr, cv:sd/mean, gmi:3.31+0.02392*toMgdl(mean),
    tir:share("inRange"), tbr:share("low")+share("veryLow"), veryLow:share("veryLow"),
    tar:share("high")+share("veryHigh"), veryHigh:share("veryHigh"),
    share };
}
// AGP: 48 half-uur-bins, percentielen
function agp(g){
  const bins = Array.from({length:48},()=>[]);
  for (const x of g) bins[Math.floor(todMin(x.ts)/30)%48].push(x.bg);
  const pct=(s,p)=>s[Math.min(s.length-1,Math.floor(p*s.length))];
  const out=[];
  for (let b=0;b<48;b++){ if(bins[b].length<5) continue; const s=bins[b].sort((a,b)=>a-b);
    out.push({ b, min:b*30+15, p10:pct(s,.1), p25:pct(s,.25), p50:pct(s,.5), p75:pct(s,.75), p90:pct(s,.9) }); }
  return out;
}
function joinBins(bins){ const s=[...bins].sort((a,b)=>a-b), out=[];
  for (let i=0;i<s.length;i++){ let j=i; while(j+1<s.length && s[j+1]===s[j]+1) j++;
    out.push(`${fmtMin(s[i]*30)}–${fmtMin((s[j]+1)*30)}`); i=j; } return out; }
// Hypo's: episodes + verdeling over 6 dagdelen
function hypoStats(g){
  // Runs van lage metingen (gat ≤45 min telt als dezelfde gebeurtenis), mét indexen
  // zodat we in-/uitgangssnelheid kunnen beoordelen (sensordruk-patroon).
  const runs=[]; let cur=null;
  for (let i=0;i<g.length;i++){ const x=g[i];
    if (x.bg>=3.9) continue;
    if (cur && x.ts-cur.end<=45*60e3){ cur.end=x.ts; cur.endIdx=i; cur.min=Math.min(cur.min,x.bg); }
    else { cur={start:x.ts,end:x.ts,min:x.bg,startIdx:i,endIdx:i}; runs.push(cur); } }
  const parts = new Array(4).fill(0);   // nacht 0-6, ochtend 6-12, middag 12-18, avond 18-24
  const label = [`${dpName("nacht")} (00–06)`,`${dpName("ochtend")} (06–12)`,`${dpName("middag")} (12–18)`,`${dpName("avond")} (18–24)`];
  const eps=[]; let dips=0, level2=0, nocturnal=0, suspect=0;
  for (const e of runs){ e.dur=(e.end-e.start)/60000+5;    // +5 min voor het meetinterval
    // Sensordruk-patroon: zeer snelle duik én zeer snel herstel rond een korte low —
    // klassiek voor liggen op de sensor. Markering, geen uitsluiting.
    const pre=g[e.startIdx-2], post=g[e.endIdx+2];
    e.suspect = !!(e.dur<=30
      && pre  && (e.start-pre.ts)<=12*60e3 && (pre.bg - g[e.startIdx].bg)>=2.0
      && post && (post.ts-e.end)<=12*60e3 && (post.bg - g[e.endIdx].bg)>=2.0);
    if (e.suspect) suspect++;
    if (e.dur<15){ dips++; continue; }                     // korte dip — geen consensus-episode
    eps.push(e);
    parts[Math.floor(todMin(e.start)/360)%4]++;
    if (e.min<3.0) level2++;
    if (todMin(e.start)<360) nocturnal++; }
  return { episodes:eps.length, eps, dips, allLows:runs, parts, label, level2, nocturnal, suspect,
    worst: parts.some(x=>x>0) ? label[parts.indexOf(Math.max(...parts))] : null };
}
/* ── "Waarom"-motor — reconstrueert de waarschijnlijke oorzaak van één low uit je
   eigen data: actieve insuline (gesplitst naar SMB / correctie / maaltijd),
   koolhydraten, de daalsnelheid ervoor en de basaalcontext. Geen doseeradvies —
   een onderbouwd bespreekpunt met bewijs en een eerlijke zekerheid. ────────── */
function explainHypo(e, glucose, treatments, timeline){
  const t0=e.start;
  const prof=timeline?profileAt(timeline,t0):null;
  const dia=Math.max(300,(prof&&prof.dia?prof.dia:6)*60);   // min
  const basalHr=prof&&isFinite(prof.basal)?prof.basal:null; // E/u profiel op dat uur
  const mdl=insulinModel(PEAK_MIN,dia);
  // Actieve insuline op het moment van de low, per bron.
  let iobSMB=0,iobMeal=0,iobMan=0,nSMB=0,biggest=null;
  for(const t of treatments){ if(!(t.insulin>0)) continue;
    const dt=(t0-t.ts)/60000; if(dt<0||dt>dia) continue;
    const c=t.insulin*mdl.iob(dt); if(c<=0) continue;
    if(detectSMB(t)){ iobSMB+=c; nSMB++; }
    else if(t.carbs>0){ iobMeal+=c; }
    else { iobMan+=c; }
    if(!biggest||t.insulin>biggest.insulin) biggest=t; }
  const iob=iobSMB+iobMeal+iobMan;
  const cob=carbsOnBoard(treatments,t0);
  const rescue=treatments.filter(t=>t.carbs>0 && !(t.insulin>0) && t.ts>t0-90*60e3 && t.ts<=t0+10*60e3);
  // Daalsnelheid ervoor: glucose ~45 min vóór de low t.o.v. bij het inzakken.
  const bgAt=ts=>{ let lo=0,hi=glucose.length-1,best=null,bd=Infinity;
    while(lo<=hi){const m=(lo+hi)>>1,d=glucose[m].ts-ts; if(Math.abs(d)<bd){bd=Math.abs(d);best=glucose[m];} if(d<0)lo=m+1;else hi=m-1;}
    return best&&bd<=15*60e3?best.bg:null; };
  const bgBefore=bgAt(t0-45*60e3), bgOnset=bgAt(t0);   // tijd-gebaseerd: onafhankelijk van welke array de low uit komt
  const drop=(bgBefore!=null&&bgOnset!=null)?bgBefore-bgOnset:null;
  const fast=drop!=null && drop>=2.5;                        // ≥2,5 mmol/L in 45 min
  const THR=Math.max(0.4, basalHr!=null?basalHr*0.75:0.4);   // "noemenswaardige" IOB
  const u=v=>nl2(v)+" "+TL("E","U","U"), part=[];
  if(iobSMB>=0.15) part.push(TL(`${u(iobSMB)} uit ${nSMB} loop-correctie${nSMB===1?"":"s"} (SMB)`,`${u(iobSMB)} from ${nSMB} loop correction${nSMB===1?"":"s"} (SMB)`,`${u(iobSMB)} de ${nSMB} correção${nSMB===1?"":"ões"} do loop (SMB)`));
  if(iobMeal>=0.15) part.push(TL(`${u(iobMeal)} uit een maaltijdbolus`,`${u(iobMeal)} from a meal bolus`,`${u(iobMeal)} de um bólus de refeição`));
  if(iobMan>=0.15) part.push(TL(`${u(iobMan)} uit een handmatige correctie`,`${u(iobMan)} from a manual correction`,`${u(iobMan)} de uma correção manual`));
  const iobLine=TL(`Actieve insuline toen je onder 3,9 zakte: <b>${u(iob)}</b>${part.length?` (${part.join(", ")})`:""}.`,`Active insulin when you dropped below 3.9: <b>${u(iob)}</b>${part.length?` (${part.join(", ")})`:""}.`,`Insulina ativa quando desceu abaixo de 3,9: <b>${u(iob)}</b>${part.length?` (${part.join(", ")})`:""}.`);
  const dropLine=drop!=null?TL(`Je zakte ${nl1(drop)} mmol/L in ~45 min${fast?" — snel, dat past bij een insuline-effect":" — geleidelijk"}.`,`You dropped ${nl1(drop)} mmol/L in ~45 min${fast?" — fast, that fits an insulin effect":" — gradually"}.`,`Desceu ${nl1(drop)} mmol/L em ~45 min${fast?" — rápido, encaixa num efeito de insulina":" — gradualmente"}.`):null;

  // Classificatie — eerste die past wint.
  let cause,label,conf;
  if(e.suspect){ cause="sensordruk"; label=TL("sensordruk — mogelijk geen echte hypo","sensor pressure — possibly not a real low","pressão no sensor — possivelmente não é hipo real"); conf=TL("matig","medium","média");
    return { cause,label,conf, steps:[TL(`Snelle duik én snel herstel rond een korte low — het patroon van op de sensor liggen.`,`Fast dive and fast recovery around a short low — the lying-on-the-sensor pattern.`,`Mergulho e recuperação rápidos em torno de uma hipo curta — o padrão de deitar sobre o sensor.`),TL(`Een artefact telt niet als echte hypo; check de plek van je sensor.`,`An artifact doesn't count as a real low; check your sensor placement.`,`Um artefacto não conta como hipo real; verifique a posição do sensor.`)] }; }
  const dom=Math.max(iobSMB,iobMeal,iobMan);
  if(iob>=THR && dom>=0.15){
    const steps=[iobLine]; if(dropLine)steps.push(dropLine);
    if(dom===iobSMB){ cause="smb-stapeling"; label=TL("loop-correcties werkten door","loop corrections kept acting","correções do loop continuaram a atuar");
      steps.push(TL(`De loop stapelde ${nSMB} SMB'${nSMB===1?"s":"s"} tegen een stijging; die insuline werkte door tot ná de piek.`,`The loop stacked ${nSMB} SMB${nSMB===1?"":"s"} against a rise; that insulin kept acting past the peak.`,`O loop acumulou ${nSMB} SMB contra uma subida; essa insulina continuou a atuar após o pico.`)); }
    else if(dom===iobMeal && cob<10){ cause="maaltijd-nawerking"; label=TL("maaltijdbolus werkte na de koolhydraten door","meal bolus kept acting after the carbs","bólus de refeição continuou a atuar após os hidratos");
      steps.push(TL(`De koolhydraten waren vermoedelijk eerder op dan de insuline (nog ${nl1(cob)} g actief) — de staart van de bolus duwde je omlaag.`,`The carbs were probably gone before the insulin (still ${nl1(cob)} g active) — the tail of the bolus pushed you down.`,`Os hidratos acabaram provavelmente antes da insulina (ainda ${nl1(cob)} g ativos) — a cauda do bólus empurrou-o para baixo.`)); }
    else { cause="correctie-nawerking"; label=TL("een correctiebolus werkte door","a correction bolus kept acting","um bólus de correção continuou a atuar");
      steps.push(TL(`De correctie bracht je verder omlaag dan nodig — mogelijk te vroeg gestapeld op nog actieve insuline.`,`The correction brought you further down than needed — possibly stacked too soon on still-active insulin.`,`A correção baixou-o mais do que o necessário — possivelmente acumulada cedo demais sobre insulina ainda ativa.`)); }
    conf = dom>=0.6*iob && iob>=THR ? TL("hoog","high","alta") : TL("matig","medium","média");
    if(rescue.length) steps.push(TL(`Je vulde ${nl1(rescue.reduce((s,t)=>s+t.carbs,0))} g koolhydraten bij — reddingskoolhydraten, geen maaltijd.`,`You took ${nl1(rescue.reduce((s,t)=>s+t.carbs,0))} g of carbs — rescue carbs, not a meal.`,`Tomou ${nl1(rescue.reduce((s,t)=>s+t.carbs,0))} g de hidratos — hidratos de resgate, não uma refeição.`));
    return { cause,label,conf,steps };
  }
  if(iob<THR && cob<10 && !rescue.length){
    cause="basaal"; label=TL("geen actieve bolus — dit venster leunt op je basaal","no active bolus — this window leans on your basal","sem bólus ativo — esta janela apoia-se na sua basal"); conf = (drop!=null&&!fast)?TL("matig","medium","média"):TL("laag","low","baixa");
    const steps=[TL(`Nauwelijks actieve insuline (${u(iob)}) en geen recente koolhydraten toen je wegzakte.`,`Hardly any active insulin (${u(iob)}) and no recent carbs when you dropped.`,`Quase nenhuma insulina ativa (${u(iob)}) e sem hidratos recentes quando desceu.`)];
    if(dropLine)steps.push(dropLine);
    steps.push(basalHr!=null?TL(`Zonder bolus als verklaring lijkt de basaal van ~${nl2(basalHr)} E/u hier aan de hoge kant — een bespreekpunt, geen instelopdracht.`,`Without a bolus as explanation the basal of ~${nl2(basalHr)} U/h here seems on the high side — a discussion point, not a setting instruction.`,`Sem um bólus como explicação, a basal de ~${nl2(basalHr)} U/h aqui parece alta — um ponto de discussão, não uma instrução.`):TL(`Zonder bolus als verklaring wijst dit richting je basaal in dit venster.`,`Without a bolus as explanation this points to your basal in this window.`,`Sem um bólus como explicação, isto aponta para a sua basal nesta janela.`));
    if(rescue.length) steps.push(TL(`Je vulde koolhydraten bij (redding).`,`You took rescue carbs.`,`Tomou hidratos de resgate.`));
    return { cause,label,conf,steps };
  }
  cause="onverklaard"; label=TL("geen duidelijke oorzaak in de data","no clear cause in the data","sem causa clara nos dados"); conf=TL("laag","low","baixa");
  const steps=[iobLine]; if(dropLine)steps.push(dropLine);
  steps.push(TL(`Te weinig aanknopingspunten (insuline én koolhydraten laag) — mogelijk beweging, alcohol of een meetartefact.`,`Too few clues (both insulin and carbs low) — possibly exercise, alcohol or a measurement artifact.`,`Poucas pistas (insulina e hidratos baixos) — possivelmente exercício, álcool ou um artefacto de medição.`));
  return { cause,label,conf,steps };
}
/* ── "Waarom"-motor voor post-maaltijd-pieken — verklaart één maaltijdpiek uit de
   al berekende maaltijddata (bolus-timing, dekking, opnamesnelheid). Werkt op je
   automatische Nightscout-maaltijden; geen invoer nodig, geen dosisopdracht. ── */
function explainSpike(r){
  const rise=r.peakRise, off=r.bolusOffset, frac=r.frac, t50=r.t50, tpk=r.tPeak;
  const steps=[TL(`Piek +${nl1(rise)} mmol/L, ${Math.round(tpk)} min na de maaltijd (${r.carbs} g koolhydraten).`,`Peak +${nl1(rise)} mmol/L, ${Math.round(tpk)} min after the meal (${r.carbs} g carbs).`,`Pico +${nl1(rise)} mmol/L, ${Math.round(tpk)} min após a refeição (${r.carbs} g de hidratos).`)];
  let cause,label,conf=TL("matig","medium","média");
  if(off!=null && off>10){ cause="prebolus"; label=TL("je boluste laat — de insuline liep achter de koolhydraten aan","you bolused late — the insulin lagged behind the carbs","bolusou tarde — a insulina ficou atrás dos hidratos");
    steps.push(TL(`Je bolus kwam ${Math.round(off)} min ná je koolhydraat-invoer; zonder voorsprong piekt je glucose hoger.`,`Your bolus came ${Math.round(off)} min after your carb entry; without a head start your glucose peaks higher.`,`O seu bólus veio ${Math.round(off)} min após a entrada de hidratos; sem avanço a glicose atinge um pico mais alto.`));
    steps.push(TL(`Een prebolus (~15 min vóór het eten) verlaagt juist die piek — een bespreekpunt over timing, geen instelopdracht.`,`A prebolus (~15 min before eating) lowers exactly that peak — a discussion point about timing, not a setting instruction.`,`Um prebólus (~15 min antes de comer) baixa precisamente esse pico — um ponto de discussão sobre timing, não uma instrução.`)); conf=TL("hoog","high","alta"); }
  else if(frac>=1.25){ cause="kh-onderschat"; label=TL("meer stijging dan bij je ingevoerde koolhydraten past","more rise than fits your entered carbs","mais subida do que os hidratos introduzidos justificam");
    steps.push(TL(`Je zag ~${pct0(frac)} van de ingevoerde koolhydraten terug in je glucose — mogelijk ondergeschat, of de bolus dekte niet volledig.`,`You saw ~${pct0(frac)} of the entered carbs back in your glucose — possibly underestimated, or the bolus didn't fully cover.`,`Viu ~${pct0(frac)} dos hidratos introduzidos de volta na glicose — possivelmente subestimados, ou o bólus não cobriu totalmente.`)); }
  else if(t50!=null && t50>70){ cause="traag"; label=TL("trage opname — grote of vette maaltijd","slow absorption — large or fatty meal","absorção lenta — refeição grande ou gorda");
    steps.push(TL(`Half opgenomen na ${Math.round(t50)} min: de koolhydraten kwamen traag los (vet/eiwit vertraagt), terwijl de bolus al werkte.`,`Half absorbed after ${Math.round(t50)} min: the carbs came slowly (fat/protein delays), while the bolus was already working.`,`Metade absorvida após ${Math.round(t50)} min: os hidratos vieram devagar (gordura/proteína atrasam), enquanto o bólus já atuava.`));
    steps.push(TL(`Bij zulke maaltijden hoort een latere piek; een verdeelde of latere bolus is een bespreekpunt.`,`Such meals come with a later peak; a split or later bolus is a discussion point.`,`Essas refeições trazem um pico mais tardio; um bólus dividido ou mais tarde é um ponto de discussão.`)); }
  else { cause="verwacht"; label=TL("binnen verwachting voor deze maaltijd","within expectation for this meal","dentro do esperado para esta refeição"); conf=TL("laag","low","baixa");
    steps.push(TL(`Timing en dekking ogen normaal; een piek van deze grootte hoort bij een maaltijd van ${r.carbs} g.`,`Timing and coverage look normal; a peak of this size fits a meal of ${r.carbs} g.`,`O timing e a cobertura parecem normais; um pico deste tamanho encaixa numa refeição de ${r.carbs} g.`)); }
  return { cause,label,conf,steps,rise };
}
// Correctie-stapeling vóór hypo's (case-control, gematcht op tijd-van-de-dag, begrensd)
function hypoStacking(glucose, treatments, q){
  const CASE=3*3600e3, TOL=20*60e3, MIN_EP=6, DAYMS=864e5;
  const g=glucose.filter(x=>q.usableKeys.has(localDayKey(x.ts)));
  const below=g.filter(x=>x.bg<3.9);
  const epsAll=[]; for(const p of below){ const l=epsAll[epsAll.length-1]; if(l&&p.ts-l.end<=45*60e3)l.end=p.ts; else epsAll.push({start:p.ts,end:p.ts}); }
  const episodes=[]; for(const e of epsAll){ if(episodes.length&&e.start-episodes[episodes.length-1].start<CASE)continue; if(e.start-g[0].ts<CASE)continue; episodes.push(e); }
  if(episodes.length<MIN_EP) return { few:episodes.length };
  const corr=treatments.filter(t=>t.insulin>0&&t.carbs===0&&!t.isSMB).map(t=>t.ts).sort((a,b)=>a-b);
  const inWin=(arr,from,to)=>{ let lo=0,hi=arr.length; while(lo<hi){const m=(lo+hi)>>1; if(arr[m]<from)lo=m+1; else hi=m;} let n=0; for(let i=lo;i<arr.length&&arr[i]<to;i++)n++; return n; };
  const stackAt=end=>inWin(corr,end-CASE,end)>=2;
  const cases=episodes.map(e=>stackAt(e.start));
  const byDay=new Map(); for(const x of g){const k=localDayKey(x.ts); if(!byDay.has(k))byDay.set(k,[]); byDay.get(k).push(x);}
  const hypoWin=epsAll.map(e=>({from:e.start-CASE,to:e.end+45*60e3}));
  const controls=[]; const MAX=Math.max(60,episodes.length*15);
  outer: for(const e of episodes){ const tod=todMin(e.start)*60e3;
    for(const pts of byDay.values()){ if(controls.length>=MAX)break outer;
      let best=null,bd=Infinity; for(const p of pts){ const d=Math.abs(todMin(p.ts)*60e3-tod); const dd=Math.min(d,DAYMS-d); if(dd<bd){bd=dd;best=p;} }
      if(!best||bd>TOL)continue; const end=best.ts;
      if(hypoWin.some(w=>end>=w.from&&end<=w.to))continue; if(end-g[0].ts<CASE)continue;
      controls.push(stackAt(end)); } }
  if(controls.length<episodes.length*3) return { few:episodes.length, thin:true };
  const cR=cases.filter(Boolean).length/cases.length, kR=controls.filter(Boolean).length/controls.length;
  return { cases:episodes.length, controls:controls.length, caseRate:cR, ctrlRate:kR,
    elevated: cR-kR>=0.15 && (kR===0?cR>0:cR/kR>=1.4) };
}
// Volledige 5-banden-balk (de standaard AGP-doelbalk), met ✓/✗ op de banden die
// een streefwaarde hebben, en een aparte hypo-veiligheidsregel eronder.
function bandBarHtml(m){
  const top=[...BANDS].reverse();
  const badge=id=> id==="inRange"?tick(m.tir>=0.70) : id==="veryHigh"?tick(m.veryHigh<0.05) : id==="veryLow"?tick(m.veryLow<0.01) : "";
  const bar=top.map(b=>`<span style="flex:${(m.share(b.id)*1000).toFixed(0)} 0 auto;background:var(${b.css})"></span>`).join("");
  const rows=top.map(b=>`<div class="trow"><i class="sw" style="background:var(${b.css})"></i><span class="lbl">${bandLabel(b)}</span><b>${pct0(m.share(b.id))}</b>${badge(b.id)}</div>`).join("");
  return `<div class="tirbar">${bar}</div><div class="tirrows">${rows}</div>`+
    `<div class="hypoline">Hypo-tijd (&lt;3,9): <b>${pct0(m.tbr)}</b> · streef &lt;4% ${tick(m.tbr<0.04)}</div>`;
}
// Insuline & koolhydraten over de periode
function insulinCarbs(treatments, timeline, q){
  const from=q.from||0, to=q.to||Date.now();
  const nDays=Math.max(1, q.days.length || Math.round((to-from)/DAY) || 1);
  let bolus=0, smb=0, carbs=0, nB=0, nS=0;
  for(const t of treatments){ if(t.ts<from)continue;
    if(t.insulin>0){ if(t.isSMB){smb+=t.insulin;nS++;} else {bolus+=t.insulin;nB++;} }
    if(t.carbs>0) carbs+=t.carbs; }
  const bolusDay=(bolus+smb)/nDays;
  let basalDay=null;
  const prof0=timeline&&profileAt(timeline,to);
  if(prof0&&prof0.source!=="geen"&&prof0.basal!=null){ basalDay=0;
    for(let h=0;h<24;h++){ const p=profileAt(timeline,to-((23-h)*3600e3)); basalDay+=(p.basal||0); } }
  const tdd=basalDay!=null?basalDay+bolusDay:null;
  return { bolusDay, carbsDay:carbs/nDays, nBolusDay:nB/nDays, nSmbDay:nS/nDays,
    basalDay, tdd, basalPct:tdd?basalDay/tdd:null, bolusPct:tdd?bolusDay/tdd:null, nDays };
}

// Weektrend: kernmaten per 7-daagse blok, oud → nieuw (alleen weken met genoeg data)
function weeklyTrend(glucose, q){
  const to = q.to || Date.now();
  const nWeeks = Math.min(8, Math.ceil(cfg.days/7));
  const weeks = [];
  for (let w=0; w<nWeeks; w++){
    const hi = to - w*7*DAY, lo = hi - 7*DAY;
    const gw = glucose.filter(x => x.ts>lo && x.ts<=hi && q.usableKeys.has(localDayKey(x.ts)));
    const days = new Set(gw.map(x=>localDayKey(x.ts))).size;
    if (gw.length<500 || days<3) continue;      // te dun voor een betrouwbare week
    const m = metrics(gw);
    weeks.push({ end:hi, days, tir:m.tir, tbr:m.tbr, cv:m.cv });
  }
  return weeks.reverse();
}
function trendSvg(weeks){
  const W=320, H=140, PB=30, PL=24, PT=10, n=weeks.length, gap=8;
  const bw=(W-PL-6-(n-1)*gap)/n, base=H-PB, Y=p=>PT+(1-p)*(base-PT);
  let s=`<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  for (const p of [0,0.5,0.7,1]){ const y=Y(p), tgt=p===0.7;
    s+=`<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}" stroke="${tgt?"var(--accent)":"var(--line)"}" stroke-width="1"${tgt?' stroke-dasharray="3 3"':''}/>`+
      `<text x="${PL-3}" y="${(y+3).toFixed(1)}" font-size="8" fill="var(--muted)" text-anchor="end">${Math.round(p*100)}</text>`; }
  weeks.forEach((w,i)=>{ const x=PL+3+i*(bw+gap), y=Y(w.tir), h=base-y;
    const col = w.tir>=0.70?"var(--inRange)":w.tir>=0.5?"var(--high)":"var(--low)";
    s+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,h).toFixed(1)}" rx="3" fill="${col}"/>`+
      `<text x="${(x+bw/2).toFixed(1)}" y="${(y-3).toFixed(1)}" font-size="9" fill="var(--ink)" text-anchor="middle" font-weight="600">${pct0(w.tir)}</text>`+
      `<text x="${(x+bw/2).toFixed(1)}" y="${H-16}" font-size="7.5" fill="var(--muted)" text-anchor="middle">${new Date(w.end).toLocaleDateString(LOCALE(),{day:"2-digit",month:"2-digit"})}</text>`; }
  );
  s+=`<text x="${PL}" y="${H-4}" font-size="7.5" fill="var(--dim)">${TL("balken = tijd in bereik per week · stippellijn = streef 70%","bars = time in range per week · dashed line = target 70%","barras = tempo no alvo por semana · linha tracejada = meta 70%")}</text>`;
  return s+"</svg>";
}

// Watch-list — vergelijkt de laatste 14 dagen met de 14 dagen daarvóór en meldt
// wat er verslechtert (hypo's, nachtelijke hypo's, tijd in bereik, variabiliteit).
// Proactief: signaleert een oplopende trend vóórdat hij een probleem wordt.
function watchList(glucose, q){
  const usable = ts => q.usableKeys.has(localDayKey(ts));
  const to = q.to || Date.now();
  const g = glucose.filter(x=>usable(x.ts));
  const recent = g.filter(x=>x.ts> to-14*DAY);
  const prior  = g.filter(x=>x.ts<=to-14*DAY && x.ts> to-28*DAY);
  const nDays=arr=>new Set(arr.map(x=>localDayKey(x.ts))).size;
  const rD=nDays(recent), pD=nDays(prior);
  if(rD<5 || pD<5) return { few:true };
  const mR=metrics(recent), mP=metrics(prior), hR=hypoStats(recent), hP=hypoStats(prior);
  const a=[];
  if(hR.nocturnal-hP.nocturnal>=2)
    a.push({w:4,title:TL("Meer nachtelijke hypo's","More nocturnal lows","Mais hipos noturnas"),detail:TL(`${hP.nocturnal} → <b>${hR.nocturnal}</b> in 00–06 u — het gevaarlijkst omdat je slaapt.`,`${hP.nocturnal} → <b>${hR.nocturnal}</b> in 00–06 h — most dangerous because you're asleep.`,`${hP.nocturnal} → <b>${hR.nocturnal}</b> em 00–06 h — o mais perigoso porque está a dormir.`)});
  if(mR.tbr-mP.tbr>=0.015 && mR.tbr>=0.04)
    a.push({w:3,title:TL("Hypo-tijd loopt op","Low time rising","Tempo em hipo a subir"),detail:TL(`van ${pct0(mP.tbr)} naar <b>${pct0(mR.tbr)}</b> (streef <4%).`,`from ${pct0(mP.tbr)} to <b>${pct0(mR.tbr)}</b> (aim <4%).`,`de ${pct0(mP.tbr)} para <b>${pct0(mR.tbr)}</b> (meta <4%).`)});
  if(mP.tir-mR.tir>=0.06)
    a.push({w:2,title:TL("Tijd in bereik zakt","Time in range dropping","Tempo no alvo a descer"),detail:TL(`van ${pct0(mP.tir)} naar <b>${pct0(mR.tir)}</b>.`,`from ${pct0(mP.tir)} to <b>${pct0(mR.tir)}</b>.`,`de ${pct0(mP.tir)} para <b>${pct0(mR.tir)}</b>.`)});
  if(mR.cv-mP.cv>=0.03 && mR.cv>0.36)
    a.push({w:1,title:TL("Variabiliteit neemt toe","Variability increasing","Variabilidade a aumentar"),detail:TL(`CV van ${pct0(mP.cv)} naar <b>${pct0(mR.cv)}</b> (streef ≤36%).`,`CV from ${pct0(mP.cv)} to <b>${pct0(mR.cv)}</b> (aim ≤36%).`,`CV de ${pct0(mP.cv)} para <b>${pct0(mR.cv)}</b> (meta ≤36%).`),info:true});
  a.sort((x,y)=>y.w-x.w);
  return { alerts:a, rD, pD };
}
function watchHtml(w){
  if(w.alerts.length===0)
    return `<div class="obs" style="margin:0">${TL("Niets dat oploopt: je hypo-tijd, tijd in bereik en variabiliteit zijn de laatste 2 weken stabiel of beter dan de 2 weken daarvoor.","Nothing rising: your low time, time in range and variability are stable or better over the last 2 weeks than the 2 weeks before.","Nada a subir: o seu tempo em hipo, tempo no alvo e variabilidade estão estáveis ou melhores nas últimas 2 semanas face às 2 anteriores.")}</div>`;
  return w.alerts.map(x=>`<div class="watch${x.info?" info":""}"><div class="wt">${x.title}</div><div class="wd">${x.detail}</div></div>`).join("")+
    `<div class="muted" style="margin-top:.5rem">${TL("Vergelijking: de laatste 2 weken vs de 2 weken daarvoor (alleen dagen met ≥70% dekking). Een vroeg signaal, geen alarm.","Comparison: the last 2 weeks vs the 2 weeks before (only days with ≥70% coverage). An early signal, not an alarm.","Comparação: as últimas 2 semanas vs as 2 anteriores (só dias com ≥70% cobertura). Um sinal precoce, não um alarme.")}</div>`;
}

// Grootste kans — veiligheid eerst
function opportunity(m, ag, hy, trend){
  // Trend-signaal: verslechtert de veiligheid of het bereik zichtbaar?
  if (trend && trend.length>=2){
    const f=trend[0], l=trend[trend.length-1];
    if (l.tbr-f.tbr>=0.02 && l.tbr>=0.03)
      return { risk:true, msg:TL(`<b>Let op — hypo's nemen toe.</b> Je tijd onder 3,9 liep op van ${pct0(f.tbr)} naar ${pct0(l.tbr)} over de weken. Dit is nu je belangrijkste aandachtspunt.`,`<b>Note — lows are increasing.</b> Your time below 3.9 rose from ${pct0(f.tbr)} to ${pct0(l.tbr)} over the weeks. This is now your main point of attention.`,`<b>Atenção — as hipos aumentam.</b> O seu tempo abaixo de 3,9 subiu de ${pct0(f.tbr)} para ${pct0(l.tbr)} ao longo das semanas. Este é agora o seu ponto de atenção principal.`) };
  }
  const highWin = joinBins(ag.filter(x=>x.p50>=10).map(x=>x.b));
  const lowWin  = joinBins(ag.filter(x=>x.p10<3.9).map(x=>x.b));
  if (m.veryLow>=0.01 || m.tbr>=0.04)
    return { risk:true, msg:TL(`<b>Hypo-veiligheid.</b> Je zit ${pct0(m.tbr)} van de tijd onder 3,9 (streef &lt;4%)${lowWin.length?`, vooral rond <b>${lowWin.join(", ")}</b>`:""}. Dit is je belangrijkste aandachtspunt.`,`<b>Low safety.</b> You're below 3.9 ${pct0(m.tbr)} of the time (aim &lt;4%)${lowWin.length?`, mostly around <b>${lowWin.join(", ")}</b>`:""}. This is your main point of attention.`,`<b>Segurança de hipo.</b> Está abaixo de 3,9 ${pct0(m.tbr)} do tempo (meta &lt;4%)${lowWin.length?`, sobretudo por volta de <b>${lowWin.join(", ")}</b>`:""}. Este é o seu ponto de atenção principal.`) };
  if (m.cv>0.36)
    return { risk:false, msg:TL(`<b>Schommelingen.</b> Je variatie (CV ${pct0(m.cv)}) ligt boven het streven van 36% — je waarden lopen sterk uiteen. Dat is meestal de grootste winst.`,`<b>Swings.</b> Your variability (CV ${pct0(m.cv)}) is above the 36% target — your values vary widely. That's usually the biggest gain.`,`<b>Oscilações.</b> A sua variabilidade (CV ${pct0(m.cv)}) está acima da meta de 36% — os seus valores variam muito. Esse é normalmente o maior ganho.`) };
  if (m.tir<0.70)
    return { risk:false, msg:TL(`<b>Tijd te hoog.</b> Je tijd in bereik is ${pct0(m.tir)} (streef &gt;70%)${highWin.length?`; je zit vooral hoog rond <b>${highWin.join(", ")}</b>`:""}.`,`<b>Time high.</b> Your time in range is ${pct0(m.tir)} (aim &gt;70%)${highWin.length?`; you're mostly high around <b>${highWin.join(", ")}</b>`:""}.`,`<b>Tempo alto.</b> O seu tempo no alvo é ${pct0(m.tir)} (meta &gt;70%)${highWin.length?`; está sobretudo alto por volta de <b>${highWin.join(", ")}</b>`:""}.`) };
  return { risk:false, msg:TL(`<b>Mooi in balans.</b> TIR ${pct0(m.tir)}, hypo-tijd ${pct0(m.tbr)} en CV ${pct0(m.cv)} zitten alle binnen de streefwaarden.`,`<b>Nicely balanced.</b> TIR ${pct0(m.tir)}, low time ${pct0(m.tbr)} and CV ${pct0(m.cv)} are all within target.`,`<b>Bem equilibrado.</b> TIR ${pct0(m.tir)}, tempo em hipo ${pct0(m.tbr)} e CV ${pct0(m.cv)} estão todos dentro das metas.`) };
}

/* ══ SVG-GRAFIEKEN (schaalbaar, geen bibliotheek) ══════════════════════════ */
function agpSvg(ag){
  if (ag.length<12) return `<div class="muted">Nog te weinig gespreide data voor een dagprofiel.</div>`;
  const W=320, H=170, PB=18, PL=22;                 // padding onder/links voor labels
  const lo=Math.min(3, ...ag.map(a=>a.p10))-.5, hi=Math.max(14, ...ag.map(a=>a.p90))+.5;
  const X=min=>PL+(min/1440)*(W-PL), Y=b=>(H-PB)-(b-lo)/(hi-lo)*(H-PB);
  const line=(k)=>ag.map((a,i)=>(i?"L":"M")+X(a.min).toFixed(1)+" "+Y(a[k]).toFixed(1)).join(" ");
  const area=(hiK,loK)=>ag.map((a,i)=>(i?"L":"M")+X(a.min).toFixed(1)+" "+Y(a[hiK]).toFixed(1)).join(" ")
    +" "+[...ag].reverse().map(a=>"L"+X(a.min).toFixed(1)+" "+Y(a[loK]).toFixed(1)).join(" ")+" Z";
  let ax="";
  for (const h of [0,6,12,18,24]){ const x=X(h*60); ax+=`<line x1="${x}" y1="0" x2="${x}" y2="${H-PB}" stroke="var(--line)" stroke-width="1"/>`+
    `<text x="${x}" y="${H-4}" font-size="9" fill="var(--muted)" text-anchor="middle">${h}${TL("u","h","h")}</text>`; }
  for (const b of [4,10,14]){ if(b<lo||b>hi) continue; const y=Y(b);
    ax+=`<line x1="${PL}" y1="${y}" x2="${W}" y2="${y}" stroke="var(--line)" stroke-width="1"/>`+
    `<text x="${PL-3}" y="${(y+3).toFixed(1)}" font-size="9" fill="var(--muted)" text-anchor="end">${b}</text>`; }
  const yz1=Y(10), yz2=Y(3.9);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">`+
    `<rect x="${PL}" y="${yz1.toFixed(1)}" width="${W-PL}" height="${(yz2-yz1).toFixed(1)}" fill="var(--inRange)" opacity=".08"/>`+
    ax+
    `<path d="${area("p90","p10")}" fill="var(--inRange)" opacity=".13"/>`+
    `<path d="${area("p75","p25")}" fill="var(--inRange)" opacity=".28"/>`+
    `<path d="${line("p50")}" fill="none" stroke="var(--ink)" stroke-width="2" vector-effect="non-scaling-stroke"/>`+
    `</svg>`;
}
// Dag-detail: één dag (00:00–24:00) met de glucosecurve, hypo's rood, en
// markers voor maaltijden (koolhydraten) en bolussen — forensica per dag.
function dayChartSvg(readings, events, win){
  if(readings.length<3) return `<div class="muted">${TL("Te weinig metingen.","Too few readings.","Poucas leituras.")}</div>`;
  const W=320,H=175,PB=18,PL=22,PT=12;
  const lo=Math.min(3,...readings.map(r=>r.bg))-.5, hi=Math.max(13,...readings.map(r=>r.bg))+.5;
  // win = {from,to}: doorlopend venster (bv. laatste 24 u); anders een kalenderdag.
  const pos = win ? (ts=>(ts-win.from)/60000) : (ts=>todMin(ts)), span = win ? (win.to-win.from)/60000 : 1440;
  const X=min=>PL+(min/span)*(W-PL), Y=b=>(H-PB)-(b-lo)/(hi-lo)*(H-PB-PT);
  let ax="";
  const ticks = win ? (()=>{ const out=[]; const first=win.from+((360-(todMin(win.from)%360))%360)*60000;
      for(let t=first;t<=win.to;t+=6*36e5) out.push({m:(t-win.from)/60000, lab:Math.round(todMin(t)/60)%24}); return out; })()
    : [0,6,12,18,24].map(h=>({m:h*60, lab:h}));
  for(const tk of ticks){ const x=X(tk.m);
    ax+=`<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${H-PB}" stroke="var(--line)" stroke-width="1"/>`+
        `<text x="${x.toFixed(1)}" y="${H-5}" font-size="9" fill="var(--muted)" text-anchor="middle">${tk.lab}${TL("u","h","h")}</text>`; }
  for(const b of [4,10,14]){ if(b<lo||b>hi)continue; const y=Y(b);
    ax+=`<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`+
        `<text x="${PL-3}" y="${(y+3).toFixed(1)}" font-size="9" fill="var(--muted)" text-anchor="end">${b}</text>`; }
  const band=`<rect x="${PL}" y="${Y(10).toFixed(1)}" width="${W-PL}" height="${(Y(3.9)-Y(10)).toFixed(1)}" fill="var(--inRange)" opacity=".08"/>`;
  const pts=readings.map(r=>({x:X(pos(r.ts)),y:Y(r.bg),bg:r.bg}));
  let d=""; pts.forEach((p,i)=>{ d+=(i?"L":"M")+p.x.toFixed(1)+" "+p.y.toFixed(1); });
  let red=""; for(let i=1;i<pts.length;i++){ if(readings[i].bg<3.9 || readings[i-1].bg<3.9)
    red+=`<line x1="${pts[i-1].x.toFixed(1)}" y1="${pts[i-1].y.toFixed(1)}" x2="${pts[i].x.toFixed(1)}" y2="${pts[i].y.toFixed(1)}" stroke="var(--low)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`; }
  let mk=""; for(const e of events){ const x=X(pos(e.ts));
    if(e.carbs>0){ mk+=`<circle cx="${x.toFixed(1)}" cy="${PT}" r="3" fill="var(--carb)"/>`;
      if(e.carbs>=10) mk+=`<text x="${x.toFixed(1)}" y="${(PT+12)}" font-size="8" fill="var(--muted)" text-anchor="middle">${Math.round(e.carbs)}g</text>`; }
    if(e.insulin>0 && !e.isSMB) mk+=`<line x1="${x.toFixed(1)}" y1="${H-PB}" x2="${x.toFixed(1)}" y2="${H-PB-9}" stroke="var(--accent)" stroke-width="2"/>`; }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${band}${ax}<path d="${d}" fill="none" stroke="var(--ink)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>${red}${mk}</svg>`;
}
// Overzicht: doorlopend venster van de laatste 24 uur (eindigt bij de laatste meting).
function renderLast24(){
  const host=document.getElementById("last24"); if(!host||!_ctx) return;
  const g=_ctx.glucose; if(!g.length){ host.innerHTML=""; return; }
  const to=Math.max(g[g.length-1].ts, Date.now()-5*60e3), from=to-24*36e5;
  const rd=g.filter(x=>x.ts>=from&&x.ts<=to), ev=(_ctx.treatments||[]).filter(t=>t.ts>=from&&t.ts<=to);
  host.innerHTML=dayChartSvg(rd,ev,{from,to});
  const sub=document.getElementById("l24sub");
  if(sub){ const n=rd.length; sub.textContent = n>=3 ? TL(`${pct0(rd.filter(x=>x.bg>=3.9&&x.bg<10).length/n)} in bereik`,`${pct0(rd.filter(x=>x.bg>=3.9&&x.bg<10).length/n)} in range`,`${pct0(rd.filter(x=>x.bg>=3.9&&x.bg<10).length/n)} no alvo`) : ""; }
}
function dayNarrative(readings, events){
  const n=readings.length; let inR=0,maxB=-Infinity,maxT=0,minB=Infinity,minT=0;
  for(const r of readings){ if(r.bg>=3.9&&r.bg<10)inR++; if(r.bg>maxB){maxB=r.bg;maxT=r.ts;} if(r.bg<minB){minB=r.bg;minT=r.ts;} }
  const below=readings.filter(r=>r.bg<3.9); let eps=0,last=-1e15;
  for(const r of below){ if(r.ts-last>45*60e3)eps++; last=r.ts; }
  const carbs=events.filter(e=>e.carbs>0).reduce((s,e)=>s+e.carbs,0);
  const bolus=events.filter(e=>e.insulin>0).reduce((s,e)=>s+e.insulin,0);
  const hm=ts=>fmtMin(todMin(ts));
  const parts=[`TIR <b>${pct0(inR/n)}</b>`];
  parts.push(eps ? TL(`${eps} hypo${eps>1?"'s":""} (laagste ${nl1(minB)} om ${hm(minT)}${todMin(minT)<360?", 's nachts":""})`,`${eps} low${eps>1?"s":""} (lowest ${nl1(minB)} at ${hm(minT)}${todMin(minT)<360?", at night":""})`,`${eps} hipo${eps>1?"s":""} (mínimo ${nl1(minB)} às ${hm(minT)}${todMin(minT)<360?", de noite":""})`) : TL(`geen hypo's (laagste ${nl1(minB)})`,`no lows (lowest ${nl1(minB)})`,`sem hipos (mínimo ${nl1(minB)})`));
  parts.push(TL(`hoogste ${nl1(maxB)} om ${hm(maxT)}`,`highest ${nl1(maxB)} at ${hm(maxT)}`,`máximo ${nl1(maxB)} às ${hm(maxT)}`));
  if(carbs||bolus) parts.push(`${Math.round(carbs)} g ${TL("kh","carbs","hidr.")} · ${nl1(bolus)} ${TL("E","U","U")}`);
  return parts.join(" · ")+".";
}
function hypoBarsSvg(hy){
  const W=320, H=96, PB=26, PT=16, max=Math.max(1,...hy.parts), n=hy.parts.length, bw=(W-20)/n;
  let s=`<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  hy.parts.forEach((v,i)=>{ const x=10+i*bw+bw*0.15, w=bw*0.7, h=(v/max)*(H-PB-PT), y=H-PB-h;
    s+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${v?"var(--low)":"var(--line-2)"}"/>`+
      `<text x="${(x+w/2).toFixed(1)}" y="${(y-4).toFixed(1)}" font-size="10" fill="var(--ink)" text-anchor="middle" font-weight="600">${v||""}</text>`+
      `<text x="${(x+w/2).toFixed(1)}" y="${H-14}" font-size="8" fill="var(--muted)" text-anchor="middle">${dpName(["nacht","ochtend","middag","avond"][i])}</text>`+
      `<text x="${(x+w/2).toFixed(1)}" y="${H-4}" font-size="7.5" fill="var(--dim)" text-anchor="middle">${["00–06","06–12","12–18","18–24"][i]}</text>`; });
  return s+"</svg>";
}

/* ══ RENDER ════════════════════════════════════════════════════════════════ */
const ARROWS = { DoubleUp:"⇈",SingleUp:"↑",FortyFiveUp:"↗",Flat:"→",FortyFiveDown:"↘",SingleDown:"↓",DoubleDown:"⇊" };
function tick(ok){ return ok ? `<span class="badge ok">✓</span>` : `<span class="badge no">✗</span>`; }

function render(glucose, treatments, timeline){
  treatments = treatments||[]; timeline = timeline||null;
  const has = glucose.length>0;
  document.getElementById("empty").hidden = has;
  document.getElementById("secNow").hidden = !has;
  document.getElementById("tl").hidden = !has;
  document.getElementById("tabbar").hidden = !has;
  if (!has) return;

  // ── NU-strip ──
  const last = glucose[glucose.length-1];
  const ageMin = Math.round((Date.now()-last.ts)/6e4);
  const nv=document.getElementById("nowVal"); nv.textContent=nl1(last.bg); nv.style.color=colorOf(last.bg);
  document.getElementById("nowArrow").textContent = ARROWS[last.dir]||"";
  const age=document.getElementById("nowAge"); age.textContent = ageMin<90?`${ageMin} min`:`${Math.round(ageMin/60)} ${TL("u","h","h")}`;
  age.classList.toggle("stale", ageMin>20);
  const ob = document.getElementById("onboard");
  if (treatments.length || _dsRecent.length){
    const dsLast = _dsRecent.length ? _dsRecent[_dsRecent.length-1] : null;
    const dsFresh = dsLast && (Date.now()-dsLast.ts) < 15*60e3;
    const iobNow = (dsFresh && dsLast.iob!=null) ? dsLast.iob : reconstructIOB(treatments, Date.now(), PEAK_MIN, timeline);
    const cobNow = (dsFresh && dsLast.cob!=null) ? dsLast.cob : carbsOnBoard(treatments, Date.now());
    const viaLoop = dsFresh && dsLast.iob!=null;
    const fresh = ageMin<=20;
    const hint = fresh && iobNow>=1 && last.dir && /Down/i.test(last.dir) && last.bg<8
      ? ` <span class="ob-hint">${TL("· let op dalen","· watch, dropping","· atenção, a descer")}</span>` : "";
    ob.innerHTML = `IOB <b>${nl1(iobNow)}</b> · COB <b>${Math.round(cobNow)}</b> g <span style="opacity:.7">${viaLoop?TL("· via loop","· via loop","· via loop"):TL("· geschat","· estimated","· estimado")}</span>${hint}`;
    ob.hidden = false;
  } else ob.hidden = true;

  // ── kwaliteit / periode ──
  const q = quality(glucose, treatments);
  const g = glucose.filter(x=>q.usableKeys.has(localDayKey(x.ts)));
  const lowCov = q.coverage>0 && q.coverage<MIN_COVERAGE+.05;
  document.getElementById("scope").innerHTML =
    `<span><i>${TL("periode","period","período")}</i> <b>${q.from?new Date(q.from).toLocaleDateString(LOCALE(),{day:"2-digit",month:"short"}):"—"} – ${q.to?new Date(q.to).toLocaleDateString(LOCALE(),{day:"2-digit",month:"short"}):"—"}</b></span>`+
    `<span class="${lowCov?"warn":""}"><i>${TL("dekking","coverage","cobertura")}</i> <b>${q.days.length?pct0(q.coverage):"—"}</b></span>`+
    `<span><i>${TL("dagen","days","dias")}</i> <b>${q.usable.length}/${q.days.length}</b></span>`+
    (q.loopGaps.length?`<span class="warn" title="${esc(q.loopGaps.join(", "))}"><i>${TL("loop uit","loop off","loop off")}</i> <b>${q.loopGaps.length} d</b></span>`:"");
  document.getElementById("monthSub").textContent = `${q.usable.length} ${TL("dagen","days","dias")} · ${pct0(q.coverage)} ${TL("dekking","coverage","cobertura")}`;

  if (!g.length){
    document.getElementById("findToday").innerHTML =
      `<div class="f"><div class="fh"><span class="fdot n"></span><span class="ftxt">${TL("Nog te weinig dagen met voldoende sensordekking (≥70%) voor betrouwbare cijfers. Synchroniseer meer historie.","Still too few days with enough sensor coverage (≥70%) for reliable figures. Sync more history.","Ainda poucos dias com cobertura de sensor suficiente (≥70%) para números fiáveis. Sincronize mais histórico.")}</span></div></div>`;
    for (const id of ["secDay","secAware","secTrend","secLog","secWatch","mvsCard","secAgp","secSafety","secInsulin","secProfile","askBox"]) document.getElementById(id).hidden = true;
    document.getElementById("kpis").innerHTML = "";
    return;
  }

  _ctx = { glucose, q, treatments, timeline };
  renderAskExamples();   // "Vraag het je data" — zoekbalk + voorbeeldvragen
  document.querySelectorAll("details.deep").forEach(d=>{ d.open=false; delete d.dataset.done;
    d.querySelector(".body").innerHTML = '<div class="loading">'+t("loading")+'</div>'; });

  const m = metrics(g), ag = agp(g), hy = hypoStats(g), tr = weeklyTrend(glucose, q);
  _ctx.hy = hy;

  // ── VANDAAG ──
  const dayStats=new Map();
  for(const x of glucose){ const k=localDayKey(x.ts); let s=dayStats.get(k);
    if(!s){ s={min:Infinity,max:-Infinity,inr:0,n:0}; dayStats.set(k,s); }
    s.n++; if(x.bg<s.min)s.min=x.bg; if(x.bg>s.max)s.max=x.bg; if(x.bg>=3.9&&x.bg<10)s.inr++; }
  _dayKeys = [...dayStats.keys()].sort();
  let worst=null, high=null, best=null;
  for(const [k,s2] of dayStats){ if(s2.n<50) continue;
    if(s2.min<3.9 && (!worst||s2.min<worst.v)) worst={k,v:s2.min};
    if(s2.max>10 && (!high ||s2.max>high.v )) high ={k,v:s2.max};
    const tir=s2.inr/s2.n; if(!best||tir>best.v) best={k,v:tir}; }
  _notable = {worst,high,best};
  _dayIdx = _dayKeys.length-1;
  document.getElementById("secDay").hidden = !_dayKeys.length;
  renderDay();
  renderLast24();
  const tk=_dayKeys[_dayKeys.length-1], ts2=dayStats.get(tk);
  document.getElementById("todaySub").textContent = ts2 ? `${pct0(ts2.inr/ts2.n)} ${TL("in bereik tot nu","in range so far","no alvo até agora")}` : "";
  document.getElementById("secAware").hidden = false;

  // ── Companion-home: begroeting, status-ring, snelacties ──
  { const hr=new Date().getHours();
    const hi = hr<6?TL("Goedenacht","Good night","Boa noite"):hr<12?TL("Goedemorgen","Good morning","Bom dia"):hr<18?TL("Goedemiddag","Good afternoon","Boa tarde"):TL("Goedenavond","Good evening","Boa noite");
    const low=last.bg<3.9, high=last.bg>10;
    document.getElementById("greetHi").textContent = hi;
    const ageMin=Math.round((Date.now()-last.ts)/60000);
    document.getElementById("greetSub").textContent =
      ageMin>20 ? TL(`Laatste meting is ${ageMin} min oud — druk op Sync voor je actuele waarde.`,`Last reading is ${ageMin} min old — tap Sync for the current value.`,`Última leitura há ${ageMin} min — toque em Sync.`)
      : low  ? TL("Je zit nu onder bereik — houd het in de gaten.","You're below range right now — keep an eye on it.","Está abaixo do alvo agora — fique atento.")
      : high ? TL("Je zit nu boven bereik.","You're above range right now.","Está acima do alvo agora.")
      : TL("Het gaat goed — je zit nu mooi in bereik.","Looking good — you're nicely in range right now.","Está a correr bem — está bem no alvo agora.");
    document.getElementById("homeGreet").hidden=false;
    // horizontale waarde-kaart
    const rv=document.getElementById("ringVal"); rv.textContent=nl1(last.bg); rv.style.color=colorOf(last.bg);
    document.getElementById("heroArrow").textContent = ARROWS[last.dir]||"→";
    let iobR=0,cobR=0; const hasTx=treatments.length||_dsRecent.length;
    if(hasTx){ const dsL=_dsRecent.length?_dsRecent[_dsRecent.length-1]:null;
      const dsF=dsL&&(Date.now()-dsL.ts)<15*60e3;
      iobR=(dsF&&dsL.iob!=null)?dsL.iob:reconstructIOB(treatments,Date.now(),PEAK_MIN,timeline);
      cobR=(dsF&&dsL.cob!=null)?dsL.cob:carbsOnBoard(treatments,Date.now()); }
    document.getElementById("ringMeta").innerHTML =
      (hasTx?`IOB <b>${nl1(iobR)}</b> · COB <b>${Math.round(cobR)}</b> g<br>`:"")+
      `<span class="dim">${TL("bijgewerkt","updated","atualizado")} ${ageMin<90?ageMin+" min":Math.round(ageMin/60)+" "+TL("u","h","h")} ${TL("geleden","ago","atrás")}</span>`;
    document.getElementById("homeHero").hidden=false;
    const nu=document.getElementById("secNow");
    nu.classList.toggle("hideOnHome", (document.querySelector('#tabbar .tab.on')?.dataset.tab||"overzicht")==="overzicht");
  }

  // ── WEEK ──
  document.getElementById("weekSub").textContent = TL("afgelopen 7 dagen","last 7 days","últimos 7 dias");
  if (tr.length<2){ document.getElementById("secTrend").hidden = true; }
  else {
    document.getElementById("secTrend").hidden = false;
    document.getElementById("trend").innerHTML = trendSvg(tr);
    const f=tr[0], l=tr[tr.length-1], dTir=l.tir-f.tir, dTbr=l.tbr-f.tbr;
    const dir = dTir>0.05 ? "<b>"+TL("omhoog","up","a subir")+"</b>" : dTir<-0.05 ? "<b>"+TL("omlaag","down","a descer")+"</b>" : "<b>"+TL("stabiel","stable","estável")+"</b>";
    document.getElementById("trendObs").innerHTML =
      TL(`Over ${tr.length} weken beweegt je tijd in bereik ${dir} (${pct0(f.tir)} → ${pct0(l.tir)}).`,`Over ${tr.length} weeks your time in range moves ${dir} (${pct0(f.tir)} → ${pct0(l.tir)}).`,`Ao longo de ${tr.length} semanas o seu tempo no alvo move-se ${dir} (${pct0(f.tir)} → ${pct0(l.tir)}).`)+
      (Math.abs(dTbr)>=0.01?TL(` Hypo-tijd: ${pct0(f.tbr)} → ${pct0(l.tbr)}.`,` Low time: ${pct0(f.tbr)} → ${pct0(l.tbr)}.`,` Tempo em hipo: ${pct0(f.tbr)} → ${pct0(l.tbr)}.`):"");
    document.getElementById("trendTable").innerHTML =
      `<div style="display:grid;grid-template-columns:auto 1fr 1fr 1fr;gap:.15rem .8rem;font-variant-numeric:tabular-nums">`+
      `<b style="color:var(--muted)">${TL("week","week","semana")}</b><b style="color:var(--muted)">TIR</b><b style="color:var(--muted)">${TL("hypo","low","hipo")}</b><b style="color:var(--muted)">CV</b>`+
      tr.map(w=>`<span>${new Date(w.end).toLocaleDateString(LOCALE(),{day:"2-digit",month:"2-digit"})}</span><span>${pct0(w.tir)}</span><span>${pct0(w.tbr)}</span><span>${pct0(w.cv)}</span>`).join("")+`</div>`;
  }
  document.getElementById("secLog").hidden = false;

  // ── MAAND ──
  const enough = q.usable.length>=14;
  document.getElementById("kpis").innerHTML = [
    [TL("In bereik","In range","No alvo"), pct0(m.tir), TL("streef >70%","aim >70%","meta >70%"), tick(m.tir>=0.70)],
    [TL("Hypo","Low","Hipo"), pct0(m.tbr), TL("streef <4%","aim <4%","meta <4%"), tick(m.tbr<0.04)],
    [TL("Variatie (CV)","Variability (CV)","Variabilidade (CV)"), pct0(m.cv), TL("streef ≤36%","aim ≤36%","meta ≤36%"), tick(m.cv<=0.36)],
    [TL("Strak 3,9–7,8","Tight 3.9–7.8","Estrito 3,9–7,8"), pct0(m.titr), TL("tweede maat","secondary","segunda medida"), ""],
  ].map(([k,v,s3,b])=>`<div class="kpi"><div class="k">${k} ${b}</div><div class="v">${v}</div><div class="s">${s3}</div></div>`).join("")+
    `<div class="kpi kwide"><span class="k">GMI</span><span class="v2">${nl1(m.gmi)}%</span><span class="s">${TL("geschat HbA1c","estimated HbA1c","HbA1c estimada")}</span></div>`;
  document.getElementById("bandBar").innerHTML = bandBarHtml(m);

  const watch = watchList(glucose, q);
  if (watch.few){ document.getElementById("secWatch").hidden = true; }
  else { document.getElementById("secWatch").hidden = !watch.alerts.length; document.getElementById("watch").innerHTML = watchHtml(watch); }

  document.getElementById("secAgp").hidden = false;
  document.getElementById("agp").innerHTML = agpSvg(ag);
  const highWin = joinBins(ag.filter(x=>x.p50>=10).map(x=>x.b));
  const lowWin  = joinBins(ag.filter(x=>x.p10<3.9).map(x=>x.b));
  const parts=[];
  if (highWin.length) parts.push(TL(`ligt je mediaan boven 10 rond <b>${highWin.join(", ")}</b>`,`your median is above 10 around <b>${highWin.join(", ")}</b>`,`a sua mediana está acima de 10 por volta de <b>${highWin.join(", ")}</b>`));
  if (lowWin.length)  parts.push(TL(`zakt de onderste band onder 3,9 rond <b>${lowWin.join(", ")}</b>`,`the lower band drops below 3.9 around <b>${lowWin.join(", ")}</b>`,`a faixa inferior desce abaixo de 3,9 por volta de <b>${lowWin.join(", ")}</b>`));
  document.getElementById("agpObs").innerHTML = parts.length
    ? TL("Over de dag ","Over the day ","Ao longo do dia ")+parts.join(TL("; en ","; and ","; e "))+"."
    : TL("Je mediaan blijft de hele dag binnen bereik — een voorspelbaar dagprofiel.","Your median stays in range all day — a predictable daily profile.","A sua mediana mantém-se no alvo o dia todo — um perfil diário previsível.");

  document.getElementById("secSafety").hidden = false;
  document.getElementById("hypoKpis").innerHTML = [
    [TL("Hypo-episodes","Low episodes","Episódios de hipo"), String(hy.episodes), TL("≥15 min onder 3,9","≥15 min below 3.9","≥15 min abaixo de 3,9"), false],
    [TL("Ernstig (<3,0)","Severe (<3.0)","Grave (<3,0)"), String(hy.level2), TL("niveau-2","level 2","nível 2"), true],
    [TL("Korte dips","Short dips","Quedas curtas"), String(hy.dips), TL("< 15 min","< 15 min","< 15 min"), false],
    [TL("'s Nachts","At night","À noite"), String(hy.nocturnal), TL("00–06 u","00–06 h","00–06 h"), hy.nocturnal>0],
  ].map(([k,v,s3,warn])=>`<div class="kpi${warn?" safety":""}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s3}</div></div>`).join("");
  document.getElementById("hypoBars").innerHTML = hypoBarsSvg(hy);
  document.getElementById("safetyObs").innerHTML = (hy.episodes===0 && hy.dips===0
    ? TL("Geen waarden onder 3,9 in deze periode — mooi.","No values below 3.9 in this period — nice.","Sem valores abaixo de 3,9 neste período — ótimo.")
    : hy.episodes===0
    ? TL(`Geen hypo-episodes van ≥15 min; wel <b>${hy.dips}</b> korte dip${hy.dips===1?"":"s"} onder 3,9 (${pct0(m.tbr)} van je tijd).`,`No lows of ≥15 min; but <b>${hy.dips}</b> short dip${hy.dips===1?"":"s"} below 3.9 (${pct0(m.tbr)} of your time).`,`Sem hipos de ≥15 min; mas <b>${hy.dips}</b> queda${hy.dips===1?"":"s"} curta${hy.dips===1?"":"s"} abaixo de 3,9 (${pct0(m.tbr)} do seu tempo).`)
    : TL(`<b>${hy.episodes}</b> hypo-episode${hy.episodes===1?"":"s"} van ≥15 min onder 3,9 (${pct0(m.tbr)} van je tijd, streef &lt;4%)`,`<b>${hy.episodes}</b> low episode${hy.episodes===1?"":"s"} of ≥15 min below 3.9 (${pct0(m.tbr)} of your time, aim &lt;4%)`,`<b>${hy.episodes}</b> episódio${hy.episodes===1?"":"s"} de hipo de ≥15 min abaixo de 3,9 (${pct0(m.tbr)} do seu tempo, meta &lt;4%)`)+
      `${hy.level2?TL(`, waarvan <b>${hy.level2}</b> ernstig (<3,0)`,`, of which <b>${hy.level2}</b> severe (<3.0)`,`, dos quais <b>${hy.level2}</b> graves (<3,0)`):""}`+
      `${hy.nocturnal?TL(`; <b>${hy.nocturnal}</b> 's nachts (00–06 u)`,`; <b>${hy.nocturnal}</b> at night (00–06 h)`,`; <b>${hy.nocturnal}</b> à noite (00–06 h)`):hy.worst?TL(`, het vaakst in de ${hy.worst}`,`, most often in the ${hy.worst}`,`, mais frequente ${hy.worst}`):""}`+
      `${hy.dips?TL(`; plus ${hy.dips} korte dip${hy.dips===1?"":"s"}`,`; plus ${hy.dips} short dip${hy.dips===1?"":"s"}`,`; mais ${hy.dips} queda${hy.dips===1?"":"s"} curta${hy.dips===1?"":"s"}`):""}.`)
    + (hy.suspect?` <span class="muted">${TL(`Bij ${hy.suspect} low${hy.suspect===1?"":"s"} past het patroon van <b>sensordruk</b> — mogelijk niet echt.`,`For ${hy.suspect} low${hy.suspect===1?"":"s"} the <b>sensor-pressure</b> pattern fits — possibly not real.`,`Em ${hy.suspect} hipo${hy.suspect===1?"":"s"} encaixa o padrão de <b>pressão no sensor</b> — possivelmente não reais.`)}</span>`:"");
  document.getElementById("safetyEv").textContent =
    `n = ${m.n.toLocaleString(LOCALE())} ${TL("metingen over","readings over","leituras em")} ${q.usable.length} ${TL("dagen","days","dias")}` + (enough?"":TL(" · ≥14 dagen aanbevolen"," · ≥14 days recommended"," · ≥14 dias recomendado"));

  const ins = insulinCarbs(treatments, timeline, q);
  if (!treatments.length){ document.getElementById("secInsulin").hidden = true; }
  else {
    document.getElementById("secInsulin").hidden = false;
    document.getElementById("insKpis").innerHTML = [
      ins.tdd!=null ? [TL("Totale dagdosis","Total daily dose","Dose diária total"), nl1(ins.tdd), TL("E/dag (schatting)","U/day (estimate)","U/dia (estimativa)")] : null,
      ins.basalPct!=null ? [TL("Basaal / bolus","Basal / bolus","Basal / bólus"), `${Math.round(ins.basalPct*100)}/${Math.round(ins.bolusPct*100)}`, TL("% verhouding","% ratio","% rácio")] : null,
      [TL("Bolus + SMB","Bolus + SMB","Bólus + SMB"), nl1(ins.bolusDay), TL("E/dag","U/day","U/dia")],
      [TL("Koolhydraten","Carbs","Hidratos"), Math.round(ins.carbsDay)+" g", TL("per dag","per day","por dia")],
      [TL("Bolussen","Boluses","Bólus"), nl1(ins.nBolusDay), TL("handmatig/dag","manual/day","manual/dia")],
      ins.nSmbDay>0 ? [TL("SMB's","SMBs","SMB"), Math.round(ins.nSmbDay), TL("auto/dag","auto/day","auto/dia")] : null,
    ].filter(Boolean).map(([k,v,s3])=>`<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s3}</div></div>`).join("");
    document.getElementById("insObs").innerHTML = (ins.tdd!=null
      ? TL(`Basaal is een schatting uit je profielschema (temp-basaal niet meegerekend). Bolus en koolhydraten zijn exact.`,`Basal is an estimate from your profile schedule (temp basal not included). Bolus and carbs are exact.`,`A basal é uma estimativa do seu esquema de perfil (basal temporária não incluída). Bólus e hidratos são exatos.`)
      : TL(`Bolus en koolhydraten zijn exact. Basaal/bolus-verhouding ontbreekt (geen profiel met basaalschema gevonden).`,`Bolus and carbs are exact. Basal/bolus ratio is missing (no profile with a basal schedule found).`,`Bólus e hidratos são exatos. Falta o rácio basal/bólus (nenhum perfil com esquema basal encontrado).`))
      + (ins.nSmbDay>0
        ? TL(` SMB's (automatische micro-bolus) worden apart geteld en tellen níét mee als handmatige correctie — zo blijven gemeten ISF en de patronen op jóuw bolussen gebaseerd.`,` SMBs (automatic micro-bolus) are counted separately and do not count as a manual correction — so measured ISF and the patterns stay based on your boluses.`,` Os SMB (micro-bólus automático) são contados à parte e não contam como correção manual — assim o ISF medido e os padrões continuam baseados nos seus bólus.`)
        : TL(` Geen SMB's herkend — je gebruikt waarschijnlijk geen SMB's, of je Nightscout labelt ze anders dan bekend.`,` No SMBs recognized — you probably don't use SMBs, or your Nightscout labels them differently than expected.`,` Nenhum SMB reconhecido — provavelmente não usa SMB, ou o seu Nightscout rotula-os de forma diferente.`));
  }

  const pi = timeline ? profileInfo(timeline, q.to || Date.now()) : null;
  const oi = observedISF(glucose, treatments, timeline);
  const MR = mealResults(glucose, treatments, timeline);
  _MR = MR; renderEtenInsight();   // deel de gemeten respons met de Eten-tab
  const drift = basalDrift(glucose, treatments, q);
  const stack = hypoStacking(glucose, treatments, q);
  if (!pi){ document.getElementById("secProfile").hidden = true; }
  else { document.getElementById("secProfile").hidden = false;
    document.getElementById("profile").innerHTML = profileHtml(pi, oi, ins, MR); }
  if (!treatments.length){ document.getElementById("mvsCard").hidden = true; }
  else { document.getElementById("mvsCard").hidden = false;
    document.getElementById("tune").innerHTML = fineTune(drift, oi, MR, stack, pi); }
  { const sp=document.getElementById("secProposals");
    if(!pi || !treatments.length){ if(sp) sp.hidden = true; }
    else { sp.hidden = false;
      document.getElementById("proposals").innerHTML = proposalsHtml(drift, oi, MR, pi, glucose, treatments, q, timeline); decorateProposals(); } }
  document.getElementById("epMaand").classList.toggle("warned",
    (!watch.few && watch.alerts.length>0) || !!document.querySelector("#tune .wad"));

  // ── samenvatting (delen) ──
  const opp = opportunity(m, ag, hy, tr);
  const fd = t => t?new Date(t).toLocaleDateString(LOCALE(),{day:"2-digit",month:"short",year:"numeric"}):"—";
  const yn = ok => ok?"✓":"✗";
  const U=TL("E","U","U"), opMsg=opp.msg.replace(/<[^>]+>/g,"");
  const tdLine = ins.tdd!=null?TL(`Totale dagdosis: ~${nl1(ins.tdd)} E/dag (basaal/bolus ${Math.round(ins.basalPct*100)}/${Math.round(ins.bolusPct*100)}%)\n`,`Total daily dose: ~${nl1(ins.tdd)} U/day (basal/bolus ${Math.round(ins.basalPct*100)}/${Math.round(ins.bolusPct*100)}%)\n`,`Dose diária total: ~${nl1(ins.tdd)} U/dia (basal/bólus ${Math.round(ins.basalPct*100)}/${Math.round(ins.bolusPct*100)}%)\n`):``;
  const prLine = pi?TL(`Profiel: basaal ~${nl2(pi.basalDaily)} E/dag`,`Profile: basal ~${nl2(pi.basalDaily)} U/day`,`Perfil: basal ~${nl2(pi.basalDaily)} U/dia`)+(oi.obs!=null?TL(`, gemeten ISF ~${nl1(oi.obs)} mmol/L per E (meetwaarde)`,`, measured ISF ~${nl1(oi.obs)} mmol/L per U (measured)`,`, ISF medido ~${nl1(oi.obs)} mmol/L por U (medido)`):``)+`\n`:``;
  _summary =
    TL(`IDM — samenvatting\n`,`IDM — summary\n`,`IDM — resumo\n`)+
    TL(`Periode: ${fd(q.from)} – ${fd(q.to)} (${q.usable.length}/${q.days.length} dagen, ${pct0(q.coverage)} dekking)\n\n`,`Period: ${fd(q.from)} – ${fd(q.to)} (${q.usable.length}/${q.days.length} days, ${pct0(q.coverage)} coverage)\n\n`,`Período: ${fd(q.from)} – ${fd(q.to)} (${q.usable.length}/${q.days.length} dias, ${pct0(q.coverage)} cobertura)\n\n`)+
    TL(`Tijd in bereik 3,9–10,0 : ${pct0(m.tir)}  (streef >70%) ${yn(m.tir>=0.70)}\n`,`Time in range 3.9–10.0  : ${pct0(m.tir)}  (aim >70%) ${yn(m.tir>=0.70)}\n`,`Tempo no alvo 3,9–10,0  : ${pct0(m.tir)}  (meta >70%) ${yn(m.tir>=0.70)}\n`)+
    TL(`Tijd < 3,9 (hypo)       : ${pct0(m.tbr)}  (streef <4%)  ${yn(m.tbr<0.04)}\n`,`Time < 3.9 (low)        : ${pct0(m.tbr)}  (aim <4%)  ${yn(m.tbr<0.04)}\n`,`Tempo < 3,9 (hipo)      : ${pct0(m.tbr)}  (meta <4%)  ${yn(m.tbr<0.04)}\n`)+
    TL(`Tijd < 3,0              : ${pct0(m.veryLow)}  (streef <1%)  ${yn(m.veryLow<0.01)}\n`,`Time < 3.0              : ${pct0(m.veryLow)}  (aim <1%)  ${yn(m.veryLow<0.01)}\n`,`Tempo < 3,0             : ${pct0(m.veryLow)}  (meta <1%)  ${yn(m.veryLow<0.01)}\n`)+
    TL(`Tijd > 10,0             : ${pct0(m.tar)}\n`,`Time > 10.0             : ${pct0(m.tar)}\n`,`Tempo > 10,0            : ${pct0(m.tar)}\n`)+
    TL(`Tijd > 13,9             : ${pct0(m.veryHigh)}  (streef <5%)  ${yn(m.veryHigh<0.05)}\n`,`Time > 13.9             : ${pct0(m.veryHigh)}  (aim <5%)  ${yn(m.veryHigh<0.05)}\n`,`Tempo > 13,9            : ${pct0(m.veryHigh)}  (meta <5%)  ${yn(m.veryHigh<0.05)}\n`)+
    TL(`Variatie (CV)           : ${pct0(m.cv)}  (streef ≤36%) ${yn(m.cv<=0.36)}\n`,`Variability (CV)        : ${pct0(m.cv)}  (aim ≤36%) ${yn(m.cv<=0.36)}\n`,`Variabilidade (CV)      : ${pct0(m.cv)}  (meta ≤36%) ${yn(m.cv<=0.36)}\n`)+
    TL(`GMI (gesch. HbA1c)      : ${nl1(m.gmi)}%\n`,`GMI (est. HbA1c)        : ${nl1(m.gmi)}%\n`,`GMI (HbA1c est.)        : ${nl1(m.gmi)}%\n`)+
    TL(`Gemiddelde glucose      : ${nl1(m.mean)} mmol/L\n`,`Mean glucose            : ${nl1(m.mean)} mmol/L\n`,`Glicose média           : ${nl1(m.mean)} mmol/L\n`)+
    TL(`Hypo-episodes (≥15 min): ${hy.episodes} (waarvan ${hy.level2} ernstig <3,0, ${hy.nocturnal} 's nachts) · korte dips: ${hy.dips}\n\n`,`Low episodes (≥15 min): ${hy.episodes} (of which ${hy.level2} severe <3.0, ${hy.nocturnal} at night) · short dips: ${hy.dips}\n\n`,`Episódios de hipo (≥15 min): ${hy.episodes} (dos quais ${hy.level2} graves <3,0, ${hy.nocturnal} à noite) · quedas curtas: ${hy.dips}\n\n`)+
    TL(`Aandachtspunt: ${opMsg}\n`,`Point of attention: ${opMsg}\n`,`Ponto de atenção: ${opMsg}\n`)+
    tdLine+prLine;

  // ── bevindingen + consultlijst (async, buiten de renderflow) ──
  renderFindings({ glucose, q, m, hy, tr, drift, oi, MR, stack, treatments, timeline });
  renderLog(); renderAware(); renderConsult(); renderEffects(); renderBackupNote();
}

/* ── Bevindingen-engine — de app vertelt wat er toe doet ─────────────────── */
function fmtHM(ts){ return fmtMin(todMin(ts)); }

// Overzicht: toon de eerste N aandachtspunten; de rest achter één knop.
function limitFindings(n){
  const cards=[...document.querySelectorAll("#findToday .f, #findWeek .f")];
  document.getElementById("fmore")?.remove();
  cards.forEach((c,i)=>{ c.hidden=false; });
  if(cards.length<=n) return;
  cards.slice(n).forEach(c=>{ c.hidden=true; });
  const b=document.createElement("button"); b.id="fmore"; b.className="ghost fmore";
  b.textContent=TL(`Toon alle ${cards.length} aandachtspunten`,`Show all ${cards.length} points`,`Mostrar todos os ${cards.length} pontos`);
  b.onclick=()=>{ cards.forEach(c=>{c.hidden=false;}); b.remove(); };
  document.getElementById("findWeek").after(b);
}
function findingCard(f, st){
  const seen = st && st.seen && f.seenable;
  const cls = "f"+(seen?" read":(f.sev==="w"?" unread":f.pos?" unread pos":""));
  const dot = f.sev==="w"?"w":(f.pos?"g":"n");
  let html = `<div class="${cls}" data-fid="${f.id}"><div class="fh"><span class="fdot ${dot}"></span>`+
    `<span class="ftxt">${f.title}</span>${f.when?`<span class="fwhen">${f.when}</span>`:""}</div>`;
  let more="";
  if (!seen && f.steps && f.steps.length){
    more += `<div class="chain">`+
      f.steps.map((sTxt,i)=>`<div class="step"><span class="no">${i+1}</span><span>${sTxt}</span></div>`).join("")+
      `</div>${f.fine?`<div class="ffine">${f.fine}</div>`:""}`;
  }
  const acts=[];
  if (!seen && f.dayKey) acts.push(`<button class="act" data-goday="${f.dayKey}">${TL("Bekijk de dag","View the day","Ver o dia")}</button>`);
  if (f.consultable){ acts.push(st&&st.onList
    ? `<button class="act done">${TL("✓ op consultlijst","✓ on consult list","✓ na lista de consulta")}</button>`
    : `<button class="act ghost" data-consult="${f.id}">${TL("→ consultlijst","→ consult list","→ lista de consulta")}</button>`); }
  if (f.seenable && !seen) acts.push(`<button class="act ghost" data-seen="${f.id}">${TL("✓ gezien","✓ seen","✓ visto")}</button>`);
  if (acts.length) more += `<div class="acts">${acts.join("")}</div>`;
  if (more) html += `<details class="fmore-d"><summary aria-label="${TL("details","details","detalhes")}">${TL("details","details","detalhes")}</summary>${more}</details>`;
  return html+`</div>`;
}
let _fctx=null;
async function renderFindings(ctx){
  _fctx=ctx;
  const { MR, drift, q, glucose, treatments, timeline } = ctx;
  let fs={}, cl=[];
  try{ fs=(await DB.meta("fstate"))||{}; cl=(await DB.meta("consultlist"))||[]; }catch(_){}
  const onList=id=>cl.some(x=>x.id===id);
  const today=[], week=[];
  const lastKey=_dayKeys[_dayKeys.length-1];

  // vannacht — lows uit de rúwe data van de laatste dag (ook als die dag nog
  // te weinig dekking heeft voor de maandstatistiek)
  const dayG=glucose.filter(x=>localDayKey(x.ts)===lastKey);
  const hyDay=hypoStats(dayG);
  const nacht=(hyDay.allLows||[]).filter(e=>todMin(e.start)<360);
  if (nacht.length){
    const e=nacht[0], sus=nacht.filter(x=>x.suspect).length, isEp=e.dur>=15;
    // "Waarom"-motor: reconstrueer de oorzaak van deze low (alleen zinvol bij een
    // echte hypo, niet bij een sensordruk-artefact).
    let why=null; try{ if(!sus && treatments) why=explainHypo(e, glucose, treatments, timeline); }catch(_){}
    const steps=[ TL(`${nacht.length}× onder 3,9 tussen 00–06 u; laagste <b>${nl1(Math.min(...nacht.map(x=>x.min)))}</b>.`,`${nacht.length}× below 3.9 between 00–06 h; lowest <b>${nl1(Math.min(...nacht.map(x=>x.min)))}</b>.`,`${nacht.length}× abaixo de 3,9 entre 00–06 h; mínimo <b>${nl1(Math.min(...nacht.map(x=>x.min)))}</b>.`) ];
    if (why){ steps.push(TL(`<b>Waarom (zekerheid: ${why.conf})</b> — ${why.label}.`,`<b>Why (confidence: ${why.conf})</b> — ${why.label}.`,`<b>Porquê (confiança: ${why.conf})</b> — ${why.label}.`)); for(const s of why.steps) steps.push(s); }
    else steps.push(sus?TL(`Bij ${sus}: snelle duik én snel herstel — <b>te snel voor insuline</b>, het patroon van liggen op de sensor.`,`For ${sus}: fast dive and fast recovery — <b>too fast for insulin</b>, the lying-on-the-sensor pattern.`,`Em ${sus}: mergulho e recuperação rápidos — <b>rápido demais para insulina</b>, o padrão de deitar sobre o sensor.`):TL(`Duur ${Math.round(e.dur)} min.`,`Duration ${Math.round(e.dur)} min.`,`Duração ${Math.round(e.dur)} min.`));
    steps.push(isEp?TL(`Echte hypo (≥15 min) — telt mee in je maandcijfers.`,`Real low (≥15 min) — counts in your monthly figures.`,`Hipo real (≥15 min) — conta nos seus números mensais.`):TL(`Korte dip (&lt;15 min) — nog geen echte hypo.`,`Short dip (&lt;15 min) — not a real low yet.`,`Queda curta (&lt;15 min) — ainda não é uma hipo real.`));
    today.push({ id:`nacht-${lastKey}`, sev:"w", when:TL("vannacht","last night","esta noite"), seenable:true, consultable:true, dayKey:lastKey,
      title:TL(`<b>${isEp?"Hypo":"Dip"} om ${fmtHM(e.start)}</b>${sus?` — past bij sensordruk${nacht.length>1?`, ${nacht.length}× vannacht`:""}`:why?` — ${why.label}`:` — laagste ${nl1(e.min)}`}.`,`<b>${isEp?"Low":"Dip"} at ${fmtHM(e.start)}</b>${sus?` — fits sensor pressure${nacht.length>1?`, ${nacht.length}× last night`:""}`:why?` — ${why.label}`:` — lowest ${nl1(e.min)}`}.`,`<b>${isEp?"Hipo":"Queda"} às ${fmtHM(e.start)}</b>${sus?` — encaixa pressão no sensor${nacht.length>1?`, ${nacht.length}× esta noite`:""}`:why?` — ${why.label}`:` — mínimo ${nl1(e.min)}`}.`),
      steps, fine:TL("vroeg signaal, geen alarm","early signal, no alarm","sinal precoce, sem alarme") });
  } else {
    today.push({ id:`nacht-${lastKey}`, sev:"g", pos:true, when:TL("vannacht","last night","esta noite"), seenable:false,
      title:TL(`<b>Rustige nacht</b> — geen waarden onder 3,9.`,`<b>Quiet night</b> — no values below 3.9.`,`<b>Noite tranquila</b> — sem valores abaixo de 3,9.`) });
  }

  // week — drie zinnen
  const med=a=>{const s2=[...a].sort((x,y)=>x-y);return s2.length?s2[Math.floor(s2.length/2)]:null;};

  // "Waarom"-patroon over de hele periode: verklaar élke echte hypo en tel de
  // oorzaken op. Zo zie je niet alleen hóéveel lows je had, maar wáárom.
  const eps=(ctx.hy&&ctx.hy.eps)||[];
  if (eps.length>=3 && treatments){
    const LBL={ "smb-stapeling":TL("loop-correcties (SMB's) werkten door","loop corrections (SMBs) kept acting","correções do loop (SMB) continuaram a atuar"),
      "correctie-nawerking":TL("correctiebolus werkte door","correction bolus kept acting","bólus de correção continuou a atuar"), "maaltijd-nawerking":TL("maaltijdbolus werkte door","meal bolus kept acting","bólus de refeição continuou a atuar"),
      "basaal":TL("basaal aan de hoge kant in dat venster","basal on the high side in that window","basal alta nessa janela"), "sensordruk":TL("sensordruk (mogelijk artefact)","sensor pressure (possible artifact)","pressão no sensor (possível artefacto)"),
      "onverklaard":TL("geen duidelijke oorzaak","no clear cause","sem causa clara") };
    const tally={}; let done=0;
    for(const e of eps){ let w=null; try{ w=explainHypo(e, glucose, treatments, timeline); }catch(_){}
      if(!w) continue; tally[w.cause]=(tally[w.cause]||0)+1; done++; }
    const ranked=Object.entries(tally).sort((a,b)=>b[1]-a[1]);
    if (done>=3 && ranked.length){
      const [topCause,topN]=ranked[0];
      const rest=ranked.slice(1).filter(([c])=>c!=="sensordruk"||true);
      const breakdown=ranked.map(([c,n])=>`${n}× ${LBL[c]||c}`).join(" · ");
      const insulinCauses=(tally["smb-stapeling"]||0)+(tally["correctie-nawerking"]||0)+(tally["maaltijd-nawerking"]||0);
      week.push({ id:"waarom-patroon", sev: topCause==="sensordruk"?"n":"w", seenable:false, consultable:true,
        title:TL(`Van je <b>${done}</b> hypo's paste bij <b>${topN}</b> het vaakst: ${LBL[topCause]||topCause}.`,`Of your <b>${done}</b> lows, <b>${topN}</b> most often fit: ${LBL[topCause]||topCause}.`,`Das suas <b>${done}</b> hipos, <b>${topN}</b> encaixaram mais vezes: ${LBL[topCause]||topCause}.`),
        steps:[ TL(`Verdeling: ${breakdown}.`,`Breakdown: ${breakdown}.`,`Distribuição: ${breakdown}.`),
          insulinCauses>=Math.ceil(done/2)
            ? TL(`Meer dan de helft draait om <b>actieve insuline die doorwerkte</b> — kijk naar bolus-timing en het stapelen van correcties, samen met je team.`,`More than half is about <b>active insulin that kept working</b> — look at bolus timing and stacking corrections, together with your team.`,`Mais de metade tem a ver com <b>insulina ativa que continuou a atuar</b> — veja o timing do bólus e a acumulação de correções, com a sua equipa.`)
            : (tally["basaal"]>=Math.ceil(done/2)
                ? TL(`Vooral <b>basaal-gedreven</b> lows in stille vensters — een bespreekpunt voor je basaalprofiel, geen instelopdracht.`,`Mostly <b>basal-driven</b> lows in quiet windows — a discussion point for your basal profile, not a setting instruction.`,`Sobretudo hipos <b>de origem basal</b> em janelas calmas — um ponto de discussão para o seu perfil basal, não uma instrução.`)
                : TL(`Gemengd beeld — open een hypo hierboven voor de reconstructie per keer.`,`Mixed picture — open a low above for the per-case reconstruction.`,`Quadro misto — abra uma hipo acima para a reconstrução caso a caso.`)),
          TL(`Elke hypo is los doorgerekend uit je insuline, koolhydraten en daalsnelheid; open "vannacht" voor het bewijs per keer.`,`Each low is computed separately from your insulin, carbs and fall rate; open "last night" for the per-case evidence.`,`Cada hipo é calculada em separado a partir da sua insulina, hidratos e taxa de descida; abra "esta noite" para a evidência caso a caso.`) ],
        fine:TL(`n = ${done} doorgerekende hypo's`,`n = ${done} computed lows`,`n = ${done} hipos calculadas`) });
    }
  }

  // "Waarom"-patroon voor pieken: verklaar elke forse maaltijdpiek uit je
  // automatische Nightscout-maaltijden en tel de oorzaken op.
  if (MR && MR.results && MR.results.length){
    const notable=MR.results.filter(r=>r.peakRise>=3.0);
    if (notable.length>=3){
      const SL={ prebolus:TL("een te late bolus (geen prebolus)","a late bolus (no prebolus)","um bólus tardio (sem prebólus)"), "kh-onderschat":TL("onderschatte koolhydraten of dekking","underestimated carbs or coverage","hidratos ou cobertura subestimados"),
        traag:TL("een trage of vette maaltijd","a slow or fatty meal","uma refeição lenta ou gorda"), verwacht:TL("binnen verwachting","as expected","dentro do esperado") };
      const tally={}; for(const r of notable){ const w=explainSpike(r); tally[w.cause]=(tally[w.cause]||0)+1; }
      const ranked=Object.entries(tally).sort((a,b)=>b[1]-a[1]).filter(([c])=>c!=="verwacht");
      if (ranked.length){
        const [top,topN]=ranked[0];
        const biggest=notable.reduce((a,b)=>b.peakRise>a.peakRise?b:a);
        const bw=explainSpike(biggest);
        const breakdown=Object.entries(tally).map(([c,n])=>`${n}× ${SL[c]||c}`).join(" · ");
        week.push({ id:"waarom-pieken", sev:"n", seenable:false, consultable:true,
          title:TL(`Je hoogste pieken komen het vaakst door <b>${SL[top]}</b> (${topN}×).`,`Your highest peaks most often come from <b>${SL[top]}</b> (${topN}×).`,`Os seus picos mais altos vêm mais vezes de <b>${SL[top]}</b> (${topN}×).`),
          steps:[ TL(`Over ${notable.length} maaltijden met een piek ≥ 3,0 mmol/L: ${breakdown}.`,`Over ${notable.length} meals with a peak ≥ 3.0 mmol/L: ${breakdown}.`,`Em ${notable.length} refeições com pico ≥ 3,0 mmol/L: ${breakdown}.`),
            TL(`Grootste piek — ${bw.steps[0]} ${bw.label}.`,`Largest peak — ${bw.steps[0]} ${bw.label}.`,`Maior pico — ${bw.steps[0]} ${bw.label}.`),
            TL(`Elke piek is doorgerekend met je eigen ISF en KH-ratio en je bolus-timing; een bespreekpunt, geen dosisopdracht.`,`Each peak is computed with your own ISF, carb ratio and bolus timing; a discussion point, not a dosing instruction.`,`Cada pico é calculado com o seu próprio ISF, rácio de hidratos e timing de bólus; um ponto de discussão, não uma instrução de dose.`) ],
          fine:TL(`n = ${notable.length} maaltijden met piek ≥ 3,0`,`n = ${notable.length} meals with peak ≥ 3.0`,`n = ${notable.length} refeições com pico ≥ 3,0`) });
      }
    }
  }

  if (MR && MR.results.length>=MEAL_MIN){
    const dp=[["ontbijt",240,660],["lunch",660,900],["diner",900,1320]]
      .map(([id,lo,hi])=>{const rs=MR.results.filter(r=>r.ts!=null&&todMin(r.ts)>=lo&&todMin(r.ts)<hi);
        return {id,n:rs.length,rise:med(rs.map(r=>r.peakRise))};}).filter(r=>r.n>=3&&r.rise!=null);
    if (dp.length>=2){ const top=[...dp].sort((a,b)=>b.rise-a.rise)[0], lo2=[...dp].sort((a,b)=>a.rise-b.rise)[0];
      if (top.rise-lo2.rise>=1.0)
        week.push({ id:"dagdeel", sev:"n", seenable:false, consultable:true,
          title:TL(`Je <b>${mealName(top.id)}</b> piekt het hoogst: +${nl1(top.rise)} tegen +${nl1(lo2.rise)} bij ${mealName(lo2.id)}.`,`Your <b>${mealName(top.id)}</b> peaks highest: +${nl1(top.rise)} vs +${nl1(lo2.rise)} at ${mealName(lo2.id)}.`,`O seu <b>${mealName(top.id)}</b> tem o pico mais alto: +${nl1(top.rise)} contra +${nl1(lo2.rise)} no ${mealName(lo2.id)}.`),
          steps:[TL(`Mediaan over ${top.n} ${mealName(top.id)} vs ${lo2.n} ${mealName(lo2.id)}.`,`Median over ${top.n} ${mealName(top.id)} vs ${lo2.n} ${mealName(lo2.id)}.`,`Mediana em ${top.n} ${mealName(top.id)} vs ${lo2.n} ${mealName(lo2.id)}.`),
            top.id==="ontbijt"?TL(`Klassiek voor ochtendresistentie.`,`Classic for morning resistance.`,`Clássico da resistência matinal.`):TL(`Patroon per dagdeel.`,`Pattern by part of day.`,`Padrão por período do dia.`),
            MR.moffset!=null&&MR.moffset<0?TL(`Prebolus mediaan ${Math.round(-MR.moffset)} min vóór het eten — timing is het niet.`,`Prebolus median ${Math.round(-MR.moffset)} min before eating — timing isn't the issue.`,`Prebólus mediano ${Math.round(-MR.moffset)} min antes de comer — o timing não é o problema.`):TL(`Bekijk ook je bolus-timing.`,`Also check your bolus timing.`,`Verifique também o timing do bólus.`)],
          fine:TL(`n = ${MR.results.length} maaltijden`,`n = ${MR.results.length} meals`,`n = ${MR.results.length} refeições`) }); }
  }
  if (drift && drift.stat){
    if (!drift.up.length && !drift.down.length)
      week.push({ id:"drift-ok", sev:"g", pos:true, seenable:false,
        title:TL(`Je <b>basaal</b> hield je nuchtere uren vlak — geen drift.`,`Your <b>basal</b> kept your fasting hours flat — no drift.`,`A sua <b>basal</b> manteve as horas de jejum planas — sem deriva.`),
        steps:[TL(`Geen enkel uur met structurele stijging of daling in maaltijd- en bolusvrije vensters.`,`Not a single hour with structural rise or fall in meal- and bolus-free windows.`,`Nenhuma hora com subida ou descida estrutural em janelas sem refeição e sem bólus.`)],
        fine:TL(`n = ${drift.total.toLocaleString(LOCALE())} driftmetingen`,`n = ${drift.total.toLocaleString(LOCALE())} drift readings`,`n = ${drift.total.toLocaleString(LOCALE())} medições de deriva`) });
    else week.push({ id:"drift", sev:"w", seenable:false, consultable:true,
        title:TL(`Nuchter ${drift.up.length?`stijg je rond <b>${joinHrs(drift.up.map(x=>x.h)).join(", ")}</b>`:""}${drift.up.length&&drift.down.length?" en ":""}${drift.down.length?`zak je rond <b>${joinHrs(drift.down.map(x=>x.h)).join(", ")}</b>`:""}.`,`When fasting you ${drift.up.length?`rise around <b>${joinHrs(drift.up.map(x=>x.h)).join(", ")}</b>`:""}${drift.up.length&&drift.down.length?" and ":""}${drift.down.length?`fall around <b>${joinHrs(drift.down.map(x=>x.h)).join(", ")}</b>`:""}.`,`Em jejum ${drift.up.length?`sobe por volta de <b>${joinHrs(drift.up.map(x=>x.h)).join(", ")}</b>`:""}${drift.up.length&&drift.down.length?" e ":""}${drift.down.length?`desce por volta de <b>${joinHrs(drift.down.map(x=>x.h)).join(", ")}</b>`:""}.`),
        steps:[TL(`Drift tot ${nl1(Math.max(drift.peakUp||0,Math.abs(drift.peakDown||0)))} mmol/L per uur in stille vensters.`,`Drift up to ${nl1(Math.max(drift.peakUp||0,Math.abs(drift.peakDown||0)))} mmol/L per hour in quiet windows.`,`Deriva até ${nl1(Math.max(drift.peakUp||0,Math.abs(drift.peakDown||0)))} mmol/L por hora em janelas calmas.`),
          TL(`In AAPS pas je een basaalblok ~1–2 u vóór het effect aan — bespreek met je team.`,`In AAPS you adjust a basal block ~1–2 h before the effect — discuss with your team.`,`No AAPS ajusta um bloco basal ~1–2 h antes do efeito — discuta com a sua equipa.`)],
        fine:TL(`n = ${drift.total.toLocaleString(LOCALE())} driftmetingen`,`n = ${drift.total.toLocaleString(LOCALE())} drift readings`,`n = ${drift.total.toLocaleString(LOCALE())} medições de deriva`) });
  }
  // Dawn-fenomeen — nuchtere ochtendstijging (referentie §4)
  { const dp=drift && drift.stat ? dawnPattern(drift) : null;
    if(dp) week.push({ id:"dawn", sev:"n", seenable:false, consultable:true,
      title:TL(`Dawn-fenomeen: je stijgt nuchter in de vroege ochtend (rond <b>${joinHrs(dp.hours).join(", ")}</b>).`,`Dawn phenomenon: you rise when fasting in the early morning (around <b>${joinHrs(dp.hours).join(", ")}</b>).`,`Fenómeno do amanhecer: sobe em jejum de madrugada (por volta de <b>${joinHrs(dp.hours).join(", ")}</b>).`),
      steps:[TL(`Terwijl de nacht ervoor vlak bleef, loopt je glucose op met ~${nl1(dp.rise)} mmol/L per uur — het klassieke groeihormoon-patroon.`,`While the earlier night stayed flat, your glucose rises ~${nl1(dp.rise)} mmol/L per hour — the classic growth-hormone pattern.`,`Enquanto a noite anterior se manteve plana, a glicose sobe ~${nl1(dp.rise)} mmol/L por hora — o padrão clássico da hormona de crescimento.`),
        TL(`Een iets hóger basaal in de vroege ochtend is hiervoor de gebruikelijke ingang — een bespreekpunt voor je team, geen instelopdracht.`,`A slightly higher basal in the early morning is the usual lever for this — a discussion point for your team, not a setting instruction.`,`Uma basal ligeiramente mais alta de madrugada é a alavanca habitual — um ponto de discussão para a sua equipa, não uma instrução.`)],
      fine:TL(`n = ${dp.n.toLocaleString(LOCALE())} driftmetingen in stille vensters · bij een closed loop maskeert temp-basaal dit vaak`,`n = ${dp.n.toLocaleString(LOCALE())} drift readings in quiet windows · with a closed loop temp basal often masks this`,`n = ${dp.n.toLocaleString(LOCALE())} medições de deriva em janelas calmas · num closed loop a basal temporária mascara isto muitas vezes`) }); }
  // Somogyi-rebound — nachtelijke laagte → ochtendhyper (referentie §4, omstreden)
  { const sg=somogyiPattern(glucose, q);
    if(sg) week.push({ id:"somogyi", sev:"w", seenable:false, consultable:true,
      title:TL(`<b>${sg.rebounds}</b> van je <b>${sg.nights}</b> nachten met een laagte werden gevolgd door een ochtendhyper.`,`<b>${sg.rebounds}</b> of your <b>${sg.nights}</b> nights with a low were followed by a morning high.`,`<b>${sg.rebounds}</b> das suas <b>${sg.nights}</b> noites com uma hipo foram seguidas de uma hiperglicemia matinal.`),
      steps:[TL(`Een nachtelijke laagte (onder 3,9 tussen 00–06 u) ging vooraf aan een hoge waarde (boven 10) tussen 06–10 u.`,`A nocturnal low (below 3.9 between 00–06 h) preceded a high value (above 10) between 06–10 h.`,`Uma hipo noturna (abaixo de 3,9 entre 00–06 h) precedeu um valor alto (acima de 10) entre 06–10 h.`),
        TL(`Dit kán een Somogyi-rebound zijn (tegenregulatie na een laagte), maar net zo goed het dawn-fenomeen of je ontbijt. Minder insuline vóór de nacht is de klassieke gedachte — bespreek het, verander niets op eigen houtje.`,`This could be a Somogyi rebound (counter-regulation after a low), but just as easily the dawn phenomenon or your breakfast. Less insulin before the night is the classic idea — discuss it, don't change anything on your own.`,`Isto pode ser um efeito Somogyi (contrarregulação após uma hipo), mas tão facilmente o fenómeno do amanhecer ou o pequeno-almoço. Menos insulina antes da noite é a ideia clássica — discuta, não altere nada por si.`)],
      fine:TL(`n = ${sg.nights} nachten met een laagte · omstreden fenomeen, alleen als observatie`,`n = ${sg.nights} nights with a low · a debated phenomenon, observation only`,`n = ${sg.nights} noites com uma hipo · fenómeno debatido, apenas observação`) }); }
  // Verlate hypo na inspanning (referentie §5) — leunt op "sport"-markeringen
  try{ const sportAnns=await DB.all("annotations"); const ex=exerciseLatePattern(glucose, q, sportAnns);
    if(ex) week.push({ id:"exercise-late", sev:"w", seenable:false, consultable:true,
      title:TL(`Ná je <b>sport</b>-momenten zie ik meer laagtes in de uren erna.`,`After your <b>exercise</b> markers I see more lows in the hours that follow.`,`Após os seus momentos de <b>exercício</b> vejo mais hipos nas horas seguintes.`),
      steps:[TL(`In het venster 4–12 u ná inspanning zat je <b>${pct0(ex.wRate)}</b> van de tijd onder 3,9, tegen <b>${pct0(ex.bRate)}</b> normaal — passend bij verlate hypo doordat je spieren later glucose aanvullen.`,`In the 4–12 h window after exercise you were below 3.9 <b>${pct0(ex.wRate)}</b> of the time, vs <b>${pct0(ex.bRate)}</b> normally — fitting delayed-onset lows as your muscles replenish glucose later.`,`Na janela de 4–12 h após o exercício esteve abaixo de 3,9 <b>${pct0(ex.wRate)}</b> do tempo, contra <b>${pct0(ex.bRate)}</b> normalmente — compatível com hipos tardias enquanto os músculos repõem glicose mais tarde.`),
        TL(`Een lager nachtbasaal of langzame koolhydraten ná het sporten zijn de gebruikelijke ingangen — een bespreekpunt, geen instelopdracht.`,`A lower overnight basal or slow carbs after exercise are the usual levers — a discussion point, not a setting instruction.`,`Uma basal noturna mais baixa ou hidratos lentos após o exercício são as alavancas habituais — um ponto de discussão, não uma instrução.`)],
      fine:TL(`n = ${ex.events} sport-markeringen · leunt op je logboek`,`n = ${ex.events} exercise markers · relies on your logbook`,`n = ${ex.events} marcas de exercício · depende do seu diário`) }); }catch(_){}
  try{
    const anns=(await DB.all("annotations")).filter(a=>a.type==="wijziging" && a.ts>Date.now()-21*DAY).sort((a,b)=>b.ts-a.ts);
    if (anns.length){ const c=anns[0]; const ba=beforeAfter(glucose,q,c.ts,14);
      if (ba.before.ok && ba.after.ok){ const b=ba.before.m, a2=ba.after.m; const up=a2.tir-b.tir>=0.03 && a2.tbr-b.tbr<=0.01;
        week.push({ id:`wijz-${c.ts}`, sev: up?"g":"n", pos:up, seenable:true, consultable:true,
          title:TL(`Je wijziging van <b>${new Date(c.ts).toLocaleDateString(LOCALE(),{day:"numeric",month:"long"})}</b>${up?" hield stand":""}: ${pct0(b.tir)} → ${pct0(a2.tir)} in bereik.`,`Your change of <b>${new Date(c.ts).toLocaleDateString(LOCALE(),{day:"numeric",month:"long"})}</b>${up?" held up":""}: ${pct0(b.tir)} → ${pct0(a2.tir)} in range.`,`A sua alteração de <b>${new Date(c.ts).toLocaleDateString(LOCALE(),{day:"numeric",month:"long"})}</b>${up?" manteve-se":""}: ${pct0(b.tir)} → ${pct0(a2.tir)} no alvo.`),
          steps:[TL(`Hypo-tijd ${pct0(b.tbr)} → ${pct0(a2.tbr)}.`,`Low time ${pct0(b.tbr)} → ${pct0(a2.tbr)}.`,`Tempo em hipo ${pct0(b.tbr)} → ${pct0(a2.tbr)}.`),
            ba.dip?TL(`⚠ De periode vóór de wijziging was zelf een dip — winst kan deels terugveer zijn.`,`⚠ The period before the change was itself a dip — some gain may be regression to the mean.`,`⚠ O período antes da alteração foi ele próprio uma queda — parte do ganho pode ser regressão à média.`):TL(`Kanttekening: winst na een mindere periode kan deels terugveer zijn.`,`Note: gains after a poorer period may partly be regression to the mean.`,`Nota: ganhos após um período pior podem ser em parte regressão à média.`),
            TL(`De komende weken maken het beeld hard.`,`The coming weeks will firm up the picture.`,`As próximas semanas confirmarão o quadro.`)],
          fine:TL(`14 d vóór vs ná · ≥70% dekking${c.note?` · "${esc(c.note)}"`:""}`,`14 d before vs after · ≥70% coverage${c.note?` · "${esc(c.note)}"`:""}`,`14 d antes vs depois · ≥70% cobertura${c.note?` · "${esc(c.note)}"`:""}`) }); } }
  }catch(_){}

  // Val nooit leeg terug: als geen enkel week-patroon vuurt (vaak bij een closed
  // loop — SMB's breken de schone nuchtere vensters), toon dan je week-beeld.
  if (week.length===0){
    const to=q.to||Date.now(), wk=glucose.filter(x=>x.ts>to-7*DAY);
    if (wk.length>=100){
      const inR=wk.filter(x=>x.bg>=3.9&&x.bg<=10).length/wk.length, lo=wk.filter(x=>x.bg<3.9).length/wk.length;
      week.push({ id:"week-sum", sev:"n", seenable:false,
        title:TL(`Deze week <b>${pct0(inR)}</b> in bereik${lo>=0.005?`, ${pct0(lo)} onder 3,9`:", nauwelijks hypo's"}.`,`This week <b>${pct0(inR)}</b> in range${lo>=0.005?`, ${pct0(lo)} below 3.9`:", hardly any lows"}.`,`Esta semana <b>${pct0(inR)}</b> no alvo${lo>=0.005?`, ${pct0(lo)} abaixo de 3,9`:", quase sem hipos"}.`),
        steps:[TL(`Nog geen uitgesproken week-patroon om apart te melden.`,`No pronounced weekly pattern to report separately yet.`,`Ainda sem um padrão semanal marcado para relatar à parte.`),
          TL(`Bij een closed loop maskeren SMB's en temp-basaal vaak de basaaldrift; maaltijdpatronen komen pas met genoeg geïsoleerde, geboluste maaltijden.`,`With a closed loop, SMBs and temp basal often mask basal drift; meal patterns only appear with enough isolated, bolused meals.`,`Num closed loop, os SMB e a basal temporária mascaram muitas vezes a deriva basal; os padrões de refeição só surgem com refeições isoladas e com bólus suficientes.`)],
        fine:TL(`laatste 7 dagen · n = ${wk.length.toLocaleString(LOCALE())}`,`last 7 days · n = ${wk.length.toLocaleString(LOCALE())}`,`últimos 7 dias · n = ${wk.length.toLocaleString(LOCALE())}`) });
    } else {
      week.push({ id:"week-none", sev:"n", seenable:false,
        title:TL(`Nog te weinig data deze week voor patronen.`,`Still too little data this week for patterns.`,`Ainda poucos dados esta semana para padrões.`),
        steps:[TL(`Met meer synchronisatie of historie verschijnt hier je week-beeld.`,`With more syncing or history your weekly picture will appear here.`,`Com mais sincronização ou histórico, o seu quadro semanal aparecerá aqui.`)] });
    }
  }

  const paint=(el,list)=>{ el.innerHTML=list.map(f2=>findingCard(f2,{seen:fs[f2.id]&&fs[f2.id].seen,onList:onList(f2.id)})).join(""); };
  paint(document.getElementById("findToday"), today);
  paint(document.getElementById("findWeek"), week);
  limitFindings(2);
  const warned=list=>list.some(f2=>f2.sev==="w" && !(fs[f2.id]&&fs[f2.id].seen));
  document.getElementById("epVandaag").classList.toggle("warned", warned(today));
  document.getElementById("epWeek").classList.toggle("warned", warned(week));
  const all=[...today,...week];
  document.querySelectorAll("[data-seen]").forEach(b2=>b2.onclick=async()=>{
    const st2=(await DB.meta("fstate"))||{}; st2[b2.dataset.seen]={...(st2[b2.dataset.seen]||{}),seen:1};
    await DB.meta("fstate",st2); renderFindings(ctx); });
  document.querySelectorAll("[data-consult]").forEach(b2=>b2.onclick=async()=>{
    const f2=all.find(x=>x.id===b2.dataset.consult); if(!f2) return;
    const l2=(await DB.meta("consultlist"))||[];
    if(!l2.some(x=>x.id===f2.id)) l2.push({id:f2.id, title:f2.title.replace(/<[^>]+>/g,""), ts:Date.now()});
    await DB.meta("consultlist",l2); toast(TL("Op je consultlijst gezet.","Added to your consult list.","Adicionado à sua lista de consulta.")); renderFindings(ctx); renderConsult(); });
  document.querySelectorAll("[data-goday]").forEach(b2=>b2.onclick=()=>{
    const i=_dayKeys.indexOf(b2.dataset.goday); if(i>=0){ _dayIdx=i; renderDay(); }
    if(typeof showTab==="function") showTab("analyses"); const sd=document.getElementById("secDay"); sd.open=true;
    sd.scrollIntoView({behavior:"smooth",block:"center"}); });
}

/* ── Consultlijst — verzamelt bespreekpunten richting je afspraak ────────── */
/* ── "Vraag het je data" — lokale, deterministische vraag-router ─────────────
   Geen extern model: je vraag wordt lokaal op intentie gematcht en beantwoord
   met dezelfde transparante analyses (mét bewijs). Privé, offline, geen dosis. */
const _askNorm = s => (s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
function _askDaypart(q){
  if(/\bnacht|night|noite|vannacht|last night\b/.test(q)) return "nacht";
  if(/\bontbijt|breakfast|ochtend|morning|manha\b/.test(q)) return "ochtend";
  if(/\blunch|middag|afternoon|tarde\b/.test(q)) return "middag";
  if(/\bdiner|dinner|avond|evening|jantar\b/.test(q)) return "avond";
  return null;
}
// Voorbeeld-/startvragen (chips + terugval).
function _askExamples(){ return [
  TL("Hoe ging mijn nacht?","How was my night?","Como foi a minha noite?"),
  TL("Waarom zak ik 's nachts?","Why do I go low at night?","Porque desço à noite?"),
  TL("Tel ik mijn koolhydraten goed?","Am I counting carbs well?","Conto bem os hidratos?"),
  TL("Wanneer moet ik prebolussen?","When should I prebolus?","Quando devo fazer prebólus?"),
  TL("Klopt mijn correctiefactor?","Is my correction factor right?","O meu fator de correção está certo?"),
  TL("Heb ik een dawn-fenomeen?","Do I have a dawn phenomenon?","Tenho fenómeno do amanhecer?"),
  TL("Hoe is mijn tijd in bereik?","How's my time in range?","Como está o meu tempo no alvo?"),
  TL("Wat bespreek ik met mijn arts?","What should I discuss with my doctor?","O que discuto com o médico?"),
]; }
// Oorzaak-etiketten (voor de waarom-antwoorden).
function _askCause(){ return { "smb-stapeling":TL("loop-correcties (SMB's)","loop corrections (SMBs)","correções do loop (SMB)"),
  "correctie-nawerking":TL("correctiebolus","correction bolus","bólus de correção"), "maaltijd-nawerking":TL("maaltijdbolus","meal bolus","bólus de refeição"),
  "basaal":TL("basaal","basal","basal"), "sensordruk":TL("sensordruk","sensor pressure","pressão no sensor"), "onverklaard":TL("onverklaard","unexplained","inexplicado") }; }
// Intenties: keyword-sets (per taal, union-match) + antwoordbouwer die D krijgt.
function _askIntents(){ return [
  { id:"night", kw:["nacht","night","noite","vannacht","last night","geslapen","slept","dormi"],
    run:D=>{ const lows=(D.hy.allLows||[]).filter(e=>todMin(e.start)<360);
      const nn=lows.length, minv=nn?Math.min(...lows.map(x=>x.min)):null;
      const b = nn? TL(`Vannacht/recent zag ik <b>${nn}×</b> een waarde onder 3,9 tussen 00–06 u (laagste ${nl1(minv)}).`,`Last night/recently I saw <b>${nn}×</b> a value below 3.9 between 00–06 h (lowest ${nl1(minv)}).`,`Esta noite/recentemente vi <b>${nn}×</b> um valor abaixo de 3,9 entre 00–06 h (mínimo ${nl1(minv)}).`)
        : TL("Geen waarden onder 3,9 in de nachten van deze periode — rustige nachten.","No values below 3.9 in the nights of this period — quiet nights.","Sem valores abaixo de 3,9 nas noites deste período — noites tranquilas.");
      const sg=somogyiPattern(D.c.glucose,D.c.q);
      const extra = sg? " "+TL(`In ${sg.rebounds} van ${sg.nights} nachten met een laagte volgde een ochtendhyper — mogelijk Somogyi (omstreden).`,`In ${sg.rebounds} of ${sg.nights} nights with a low a morning high followed — possibly Somogyi (debated).`,`Em ${sg.rebounds} de ${sg.nights} noites com hipo seguiu-se hiperglicemia matinal — possivelmente Somogyi (debatido).`):"";
      return { t:TL("Je nachten","Your nights","As suas noites"), b:b+extra,
        e:TL("bron: sensorwaarden 00–06 u","source: sensor values 00–06 h","fonte: valores do sensor 00–06 h"),
        follow:["whylow","basal","safety"] }; } },
  { id:"whylow", kw:["waarom","why","porque","porque desco","zak","laag","hypo","low","daal","crash","drop","desco","baixo"],
    run:D=>{ const eps=(D.hy&&D.hy.eps)||[]; if(eps.length<2) return { t:TL("Waarom je zakt","Why you go low","Porque desce"), b:TL("Nog te weinig hypo-episodes om de oorzaken op te tellen — goed nieuws voor je bereik.","Too few low episodes to tally causes — good news for your range.","Poucos episódios de hipo para somar causas — boa notícia para o seu alvo."), e:"" };
      const LBL=_askCause(), tally={}; let done=0;
      for(const e of eps){ let w=null; try{ w=explainHypo(e,D.c.glucose,D.c.treatments,D.c.timeline); }catch(_){}
        if(!w)continue; tally[w.cause]=(tally[w.cause]||0)+1; done++; }
      const ranked=Object.entries(tally).sort((a,b)=>b[1]-a[1]);
      if(!done||!ranked.length) return { t:TL("Waarom je zakt","Why you go low","Porque desce"), b:TL("Ik kon de oorzaken niet betrouwbaar reconstrueren (te weinig insuline-/koolhydraatdata rond de laagtes).","I couldn't reliably reconstruct the causes (too little insulin/carb data around the lows).","Não consegui reconstruir as causas de forma fiável (poucos dados de insulina/hidratos à volta das hipos)."), e:"" };
      const [top,tn]=ranked[0], bd=ranked.map(([c,n])=>`${n}× ${LBL[c]||c}`).join(" · ");
      return { t:TL("Waarom je zakt","Why you go low","Porque desce"),
        b:TL(`Van je <b>${done}</b> gereconstrueerde hypo's paste <b>${LBL[top]}</b> het vaakst (${tn}×). Verdeling: ${bd}.`,`Of your <b>${done}</b> reconstructed lows, <b>${LBL[top]}</b> fit most often (${tn}×). Breakdown: ${bd}.`,`Das suas <b>${done}</b> hipos reconstruídas, <b>${LBL[top]}</b> encaixou mais vezes (${tn}×). Distribuição: ${bd}.`),
        e:TL(`n = ${done} doorgerekende hypo's · elk uit je insuline, koolhydraten en daalsnelheid`,`n = ${done} computed lows · each from your insulin, carbs and fall rate`,`n = ${done} hipos calculadas · cada uma da sua insulina, hidratos e taxa de descida`),
        consult:{id:"ask-whylow", title:TL(`Waarom-hypo's: vaakst ${LBL[top]}`,`Why-lows: most often ${LBL[top]}`,`Porquê-hipos: mais vezes ${LBL[top]}`)}, follow:["night","safety","isf"] }; } },
  { id:"whyspike", kw:["waarom","why","porque","piek","spike","hoog","high","na het eten","after eating","na de maaltijd","depois de comer","alto"],
    run:D=>{ const res=(D.MR&&D.MR.results)||[]; const dp=D.ent.dp, win={ochtend:[240,660],middag:[660,900],avond:[900,1320]}[dp];
      let notable=res.filter(r=>r.peakRise>=2.5); if(win) notable=notable.filter(r=>r.ts!=null&&todMin(r.ts)>=win[0]&&todMin(r.ts)<win[1]);
      if(notable.length<2) return { t:TL("Waarom je piekt","Why you spike","Porque tem picos"), b:TL("Nog te weinig geïsoleerde maaltijden met een piek om de oorzaken te duiden.","Too few isolated meals with a peak to explain the causes.","Poucas refeições isoladas com pico para explicar as causas."), e:"" };
      const SL={ prebolus:TL("een te late bolus (geen prebolus)","a late bolus (no prebolus)","um bólus tardio (sem prebólus)"), "kh-onderschat":TL("onderschatte koolhydraten","underestimated carbs","hidratos subestimados"), traag:TL("een trage/vette maaltijd","a slow/fatty meal","uma refeição lenta/gorda"), verwacht:TL("binnen verwachting","as expected","dentro do esperado") };
      const tally={}; for(const r of notable){ const w=explainSpike(r); tally[w.cause]=(tally[w.cause]||0)+1; }
      const ranked=Object.entries(tally).sort((a,b)=>b[1]-a[1]).filter(([c])=>c!=="verwacht");
      const lead = ranked.length? TL(`Je hoogste pieken${dp?` ('s ${mealName({ochtend:"ontbijt",middag:"lunch",avond:"diner"}[dp])})`:""} komen het vaakst door <b>${SL[ranked[0][0]]}</b> (${ranked[0][1]}×).`,`Your highest peaks${dp?` (${mealName({ochtend:"ontbijt",middag:"lunch",avond:"diner"}[dp])})`:""} most often come from <b>${SL[ranked[0][0]]}</b> (${ranked[0][1]}×).`,`Os seus picos mais altos${dp?` (${mealName({ochtend:"ontbijt",middag:"lunch",avond:"diner"}[dp])})`:""} vêm mais vezes de <b>${SL[ranked[0][0]]}</b> (${ranked[0][1]}×).`)
        : TL("Je pieken blijven binnen verwachting voor de maaltijdgrootte.","Your peaks stay within expectation for the meal size.","Os seus picos ficam dentro do esperado para o tamanho da refeição.");
      return { t:TL("Waarom je piekt","Why you spike","Porque tem picos"), b:lead,
        e:TL(`n = ${notable.length} maaltijden met piek ≥ 2,5 · doorgerekend met je eigen ISF & KH-ratio`,`n = ${notable.length} meals with peak ≥ 2.5 · computed with your own ISF & carb ratio`,`n = ${notable.length} refeições com pico ≥ 2,5 · calculado com o seu ISF e rácio`),
        consult:ranked.length?{id:"ask-whyspike", title:TL(`Waarom-pieken: vaakst ${SL[ranked[0][0]]}`,`Why-spikes: most often ${SL[ranked[0][0]]}`,`Porquê-picos: mais vezes ${SL[ranked[0][0]]}`)}:null, follow:["prebolus","carbs","meals"] }; } },
  { id:"carbs", kw:["koolhydraten","carb","hidratos","tel","count","conto","kh ratio","carb ratio","ratio"],
    run:D=>{ if(!D.MR||D.MR.results.length<MEAL_MIN) return { t:TL("Koolhydraten tellen","Carb counting","Contagem de hidratos"), b:TL("Nog te weinig geïsoleerde maaltijden met bolus om je koolhydraat-telling te toetsen.","Too few isolated meals with a bolus to check your carb counting.","Poucas refeições isoladas com bólus para verificar a contagem."), e:"" };
      const p=Math.round(D.MR.mfrac*100);
      const cal = p>=85&&p<=115?TL("je schatting sluit goed aan","your estimate matches well","a sua estimativa bate certo"):p<85?TL("je ziet minder terug dan ingevoerd — mogelijk tel je wat hoog","you see less than entered — you may count a bit high","vê menos do que introduziu — pode contar um pouco a mais"):TL("je ziet meer terug dan ingevoerd — mogelijk ondergeteld","you see more than entered — possibly undercounted","vê mais do que introduziu — possivelmente subcontado");
      return { t:TL("Koolhydraten tellen","Carb counting","Contagem de hidratos"),
        b:TL(`Je ziet mediaan <b>~${p}%</b> van je ingevoerde koolhydraten terug: ${cal}.`,`You see a median of <b>~${p}%</b> of your entered carbs back: ${cal}.`,`Vê uma mediana de <b>~${p}%</b> dos hidratos introduzidos: ${cal}.`),
        e:TL(`n = ${D.MR.results.length} maaltijden · maat valt structureel hoog uit, alleen als context`,`n = ${D.MR.results.length} meals · measure runs high, context only`,`n = ${D.MR.results.length} refeições · medida sai alta, apenas contexto`), follow:["prebolus","whyspike","meals"] }; } },
  { id:"prebolus", kw:["prebolus","prebólus","timing","wanneer","when","quando","bolus","piek","peak","hoe snel","how fast"],
    run:D=>{ if(!D.MR||D.MR.results.length<MEAL_MIN) return { t:TL("Prebolus & timing","Prebolus & timing","Prebólus e timing"), b:TL("Nog te weinig maaltijden met bolus-timing om je prebolus te beoordelen.","Too few meals with bolus timing to assess your prebolus.","Poucas refeições com timing de bólus para avaliar."), e:"" };
      const tpk=Math.round(D.MR.mtpk), off=D.MR.moffset;
      const ot = off==null?"" : off<-5?TL(` Je bolust mediaan ~${Math.round(-off)} min vóór het eten — een goede prebolus.`,` You bolus a median of ~${Math.round(-off)} min before eating — a good prebolus.`,` Bolusa uma mediana de ~${Math.round(-off)} min antes de comer — um bom prebólus.`):off>5?TL(` Je bolust mediaan ~${Math.round(off)} min ná het eten — eerder bolussen dempt de piek zónder meer insuline.`,` You bolus a median of ~${Math.round(off)} min after eating — bolusing earlier dampens the peak without more insulin.`,` Bolusa uma mediana de ~${Math.round(off)} min após comer — bolusar mais cedo reduz o pico sem mais insulina.`):TL(" Je bolust rond het eetmoment — een paar minuten eerder dempt de piek vaak nog."," You bolus around the eating moment — a few minutes earlier often still dampens the peak."," Bolusa por volta do momento de comer — uns minutos antes ainda reduz o pico.");
      return { t:TL("Prebolus & timing","Prebolus & timing","Prebólus e timing"),
        b:TL(`Je maaltijden pieken mediaan <b>~${tpk} min</b> na het eten.`,`Your meals peak a median of <b>~${tpk} min</b> after eating.`,`As suas refeições atingem o pico a uma mediana de <b>~${tpk} min</b> após comer.`)+ot,
        e:TL(`n = ${D.MR.results.length} maaltijden · handmatige bolus, SMB's tellen niet mee`,`n = ${D.MR.results.length} meals · manual bolus, SMBs excluded`,`n = ${D.MR.results.length} refeições · bólus manual, SMB excluídos`), follow:["whyspike","carbs","meals"] }; } },
  { id:"isf", kw:["isf","correctie","correction","correcao","gevoelig","sensitiv","sensivel","correctiefactor"],
    run:D=>{ const oi=D.oi; if(!oi||oi.obs==null) return { t:TL("Correctiefactor (ISF)","Correction factor (ISF)","Fator de correção (ISF)"), b:TL(`Nog te weinig schone handmatige correcties (${oi?oi.n:0}/8) om je ISF te meten. Bij een closed loop corrigeer je meestal via SMB's.`,`Too few clean manual corrections (${oi?oi.n:0}/8) to measure your ISF. With a closed loop you usually correct via SMBs.`,`Poucas correções manuais limpas (${oi?oi.n:0}/8) para medir o ISF. Num closed loop corrige via SMB.`), e:"" };
      const prof = oi.prof!=null?TL(` naast je ingestelde <b>${nl1(oi.prof)}</b>`,` next to your set <b>${nl1(oi.prof)}</b>`,` face ao definido <b>${nl1(oi.prof)}</b>`):"";
      const judge = oi.prof==null?"":(oi.obs/oi.prof>=0.8&&oi.obs/oi.prof<=1.25?TL(" — die sluiten aan."," — these align."," — alinham."):oi.obs/oi.prof>1.25?TL(" — je bent gevoeliger dan je profiel aanneemt; correcties kunnen doorschieten."," — you're more sensitive than your profile assumes; corrections may overshoot."," — é mais sensível do que o perfil assume; as correções podem exceder."):TL(" — correcties doen minder dan je profiel aanneemt."," — corrections do less than your profile assumes."," — as correções fazem menos do que o perfil assume."));
      return { t:TL("Correctiefactor (ISF)","Correction factor (ISF)","Fator de correção (ISF)"),
        b:TL(`Gemeten daalt 1 E je glucose ~<b>${nl1(oi.obs)}</b> mmol/L${prof}${judge}`,`Measured, 1 U lowers your glucose ~<b>${nl1(oi.obs)}</b> mmol/L${prof}${judge}`,`Medido, 1 U baixa a glicose ~<b>${nl1(oi.obs)}</b> mmol/L${prof}${judge}`),
        e:TL(`n = ${oi.n} correcties · IQR ${nl1(oi.q25)}–${nl1(oi.q75)} · meetwaarde, geen voorschrift`,`n = ${oi.n} corrections · IQR ${nl1(oi.q25)}–${nl1(oi.q75)} · measured, not a prescription`,`n = ${oi.n} correções · IQR ${nl1(oi.q25)}–${nl1(oi.q75)} · valor medido, não prescrição`),
        consult:oi.prof!=null&&(oi.obs/oi.prof<0.8||oi.obs/oi.prof>1.25)?{id:"ask-isf",title:TL(`Gemeten ISF ~${nl1(oi.obs)} vs ingesteld ${nl1(oi.prof)}`,`Measured ISF ~${nl1(oi.obs)} vs set ${nl1(oi.prof)}`,`ISF medido ~${nl1(oi.obs)} vs definido ${nl1(oi.prof)}`)}:null, follow:["basal","whylow","discuss"] }; } },
  { id:"basal", kw:["basaal","basal","drift","dawn","ochtendstijging","wegdrijf","morning rise","deriva","fasting"],
    run:D=>{ const dr=D.drift, dawn=dr&&dr.stat?dawnPattern(dr):null;
      if(!dr||!dr.stat) return { t:TL("Basaal & drift","Basal & drift","Basal e deriva"), b:TL("Te weinig maaltijd-/bolusvrije vensters om drift te meten. Bij een closed loop maskeert temp-basaal dit — zie Loop-basaal.","Too few meal-/bolus-free windows to measure drift. With a closed loop temp basal masks this — see Loop basal.","Poucas janelas sem refeição/bólus para medir a deriva. Num closed loop a basal temporária mascara isto — ver Basal do loop."), e:"" };
      let b;
      if(dawn) b=TL(`Je hebt een <b>dawn-fenomeen</b>: nuchter stijg je in de vroege ochtend (rond ${joinHrs(dawn.hours).join(", ")}) met ~${nl1(dawn.rise)} mmol/L/u.`,`You have a <b>dawn phenomenon</b>: when fasting you rise in the early morning (around ${joinHrs(dawn.hours).join(", ")}) by ~${nl1(dawn.rise)} mmol/L/h.`,`Tem um <b>fenómeno do amanhecer</b>: em jejum sobe de madrugada (por volta de ${joinHrs(dawn.hours).join(", ")}) ~${nl1(dawn.rise)} mmol/L/h.`);
      else if(!dr.up.length&&!dr.down.length) b=TL("In stille vensters drijf je nergens structureel weg — je basaal lijkt in balans.","In quiet windows you don't drift structurally anywhere — your basal seems balanced.","Em janelas calmas não deriva estruturalmente — a sua basal parece equilibrada.");
      else { const parts=[]; if(dr.up.length)parts.push(TL(`stijg je rond ${joinHrs(dr.up.map(x=>x.h)).join(", ")}`,`you rise around ${joinHrs(dr.up.map(x=>x.h)).join(", ")}`,`sobe por volta de ${joinHrs(dr.up.map(x=>x.h)).join(", ")}`)); if(dr.down.length)parts.push(TL(`zak je rond ${joinHrs(dr.down.map(x=>x.h)).join(", ")}`,`you fall around ${joinHrs(dr.down.map(x=>x.h)).join(", ")}`,`desce por volta de ${joinHrs(dr.down.map(x=>x.h)).join(", ")}`)); b=TL(`Nuchter ${parts.join(" en ")}.`,`When fasting ${parts.join(" and ")}.`,`Em jejum ${parts.join(" e ")}.`); }
      return { t:TL("Basaal & drift","Basal & drift","Basal e deriva"), b:b+" "+TL("Bespreekpunt, geen instelwaarde.","Discussion point, not a setting.","Ponto de discussão, não um parâmetro."),
        e:TL(`n = ${dr.total.toLocaleString(LOCALE())} driftmetingen in stille vensters`,`n = ${dr.total.toLocaleString(LOCALE())} drift readings in quiet windows`,`n = ${dr.total.toLocaleString(LOCALE())} medições de deriva em janelas calmas`),
        consult:(dawn||dr.up.length||dr.down.length)?{id:"ask-basal",title:dawn?TL("Dawn-fenomeen (ochtendstijging)","Dawn phenomenon (morning rise)","Fenómeno do amanhecer"):TL("Nuchtere drift per uur","Fasting drift per hour","Deriva em jejum por hora")}:null, follow:["night","discuss","isf"] }; } },
  { id:"tir", kw:["bereik","range","alvo","tir","hoe gaat","hoe sta","doing","tijd in bereik","time in range","como estou","como esta"],
    run:D=>{ const m=D.m; return { t:TL("Je maand in bereik","Your month in range","O seu mês no alvo"),
      b:TL(`Tijd in bereik <b>${pct0(m.tir)}</b> (streef >70%), hypo-tijd <b>${pct0(m.tbr)}</b> (<4%), variatie <b>${pct0(m.cv)}</b> (≤36%), GMI ${nl1(m.gmi)}%.`,`Time in range <b>${pct0(m.tir)}</b> (aim >70%), low time <b>${pct0(m.tbr)}</b> (<4%), variability <b>${pct0(m.cv)}</b> (≤36%), GMI ${nl1(m.gmi)}%.`,`Tempo no alvo <b>${pct0(m.tir)}</b> (meta >70%), tempo em hipo <b>${pct0(m.tbr)}</b> (<4%), variabilidade <b>${pct0(m.cv)}</b> (≤36%), GMI ${nl1(m.gmi)}%.`),
      e:TL(`n = ${m.n.toLocaleString(LOCALE())} metingen`,`n = ${m.n.toLocaleString(LOCALE())} readings`,`n = ${m.n.toLocaleString(LOCALE())} medições`), follow:["trend","safety","discuss"] }; } },
  { id:"safety", kw:["veilig","safe","seguro","hoeveel hypo","how many low","quantas hipo","ernstig","severe","hypos"],
    run:D=>{ const hy=D.hy; return { t:TL("Veiligheid — hypo's","Safety — lows","Segurança — hipos"),
      b:TL(`<b>${hy.episodes}</b> hypo-episode(s) ≥15 min${hy.level2?`, waarvan ${hy.level2} ernstig (<3,0)`:""}${hy.nocturnal?`; ${hy.nocturnal} 's nachts`:""}. Korte dips: ${hy.dips}.`,`<b>${hy.episodes}</b> low episode(s) ≥15 min${hy.level2?`, of which ${hy.level2} severe (<3.0)`:""}${hy.nocturnal?`; ${hy.nocturnal} at night`:""}. Short dips: ${hy.dips}.`,`<b>${hy.episodes}</b> episódio(s) de hipo ≥15 min${hy.level2?`, dos quais ${hy.level2} graves (<3,0)`:""}${hy.nocturnal?`; ${hy.nocturnal} à noite`:""}. Quedas curtas: ${hy.dips}.`),
      e:TL("een echte hypo = ≥15 min onder 3,9","a real low = ≥15 min below 3.9","uma hipo real = ≥15 min abaixo de 3,9"), follow:["whylow","night","awareness"] }; } },
  { id:"trend", kw:["trend","slechter","worse","beter","better","verandert","changing","vooruit","achteruit","pior","melhor","tendencia"],
    run:D=>{ const w=watchList(D.c.glucose,D.c.q);
      if(w.few) return { t:TL("Trend","Trend","Tendência"), b:TL("Nog te weinig dagen om de laatste 2 weken met de 2 weken daarvóór te vergelijken.","Too few days to compare the last 2 weeks with the 2 before.","Poucos dias para comparar as últimas 2 semanas com as 2 anteriores."), e:"" };
      const b = w.alerts.length? w.alerts.map(a=>`<b>${a.title}</b> — ${a.detail}`).join("<br>") : TL("Niets dat oploopt: hypo-tijd, tijd in bereik en variatie zijn stabiel of beter dan de 2 weken ervoor.","Nothing rising: low time, time in range and variability are stable or better than the 2 weeks before.","Nada a subir: tempo em hipo, tempo no alvo e variabilidade estão estáveis ou melhores que as 2 semanas anteriores.");
      return { t:TL("Trend","Trend","Tendência"), b, e:TL("laatste 2 weken vs de 2 weken daarvóór · ≥70% dekking","last 2 weeks vs the 2 before · ≥70% coverage","últimas 2 semanas vs as 2 anteriores · ≥70% cobertura"), follow:["tir","discuss","safety"] }; } },
  { id:"insulin", kw:["insuline","insulin","insulina","dosis","dose","eenheden","units","unidades","tdd","dagdosis"],
    run:D=>{ const ins=D.ins; if(ins.tdd==null&&!ins.bolusDay) return { t:TL("Insulinegebruik","Insulin use","Uso de insulina"), b:TL("Geen behandeldata gevonden om je insulinegebruik te tonen.","No treatment data found to show your insulin use.","Sem dados de tratamento para mostrar o uso de insulina."), e:"" };
      const td = ins.tdd!=null?TL(`Totale dagdosis ~<b>${nl1(ins.tdd)} E</b> (basaal/bolus ${Math.round(ins.basalPct*100)}/${Math.round(ins.bolusPct*100)}%).`,`Total daily dose ~<b>${nl1(ins.tdd)} U</b> (basal/bolus ${Math.round(ins.basalPct*100)}/${Math.round(ins.bolusPct*100)}%).`,`Dose diária total ~<b>${nl1(ins.tdd)} U</b> (basal/bólus ${Math.round(ins.basalPct*100)}/${Math.round(ins.bolusPct*100)}%).`):TL(`Bolus+SMB ~<b>${nl1(ins.bolusDay)} E/dag</b>.`,`Bolus+SMB ~<b>${nl1(ins.bolusDay)} U/day</b>.`,`Bólus+SMB ~<b>${nl1(ins.bolusDay)} U/dia</b>.`);
      return { t:TL("Insulinegebruik","Insulin use","Uso de insulina"), b:td+" "+TL(`Koolhydraten ~${Math.round(ins.carbsDay)} g/dag.`,`Carbs ~${Math.round(ins.carbsDay)} g/day.`,`Hidratos ~${Math.round(ins.carbsDay)} g/dia.`),
        e:TL("basaal is een profiel-schatting; bolus en koolhydraten zijn exact","basal is a profile estimate; bolus and carbs are exact","a basal é uma estimativa do perfil; bólus e hidratos são exatos"), follow:["tir","isf","discuss"] }; } },
  { id:"awareness", kw:["voel","feel","sinto","voelgrens","bewust","aware","hypogevoel","perceção","hypo awareness"],
    run:D=>{ let felt=[]; const aw=hypoAwareness(D.c.glucose, (window._askFelt||[]));
      // aw uses felt logs; we pass what we have (loaded async elsewhere). If none:
      if(!aw||!aw.n) return { t:TL("Hypo-gevoel","Hypo awareness","Perceção de hipo"), b:TL("Nog geen hypo-gevoel gelogd. Leg in het Overzicht (Hypo-gevoel) vast wannéér je een hypo vóélt — dan volgt de app of die voelgrens zakt.","No hypo awareness logged yet. In the Overview (Hypo awareness) note when you feel a hypo — then the app tracks whether that threshold drops.","Ainda sem perceção de hipo registada. No Resumo (Perceção de hipo) registe quando sente uma hipo — a app segue se esse limiar desce."), e:"" };
      return { t:TL("Hypo-gevoel","Hypo awareness","Perceção de hipo"), b:TL(`Je voelt hypo's mediaan rond <b>${nl1(aw.thr)} mmol/L</b>.`,`You feel lows at a median around <b>${nl1(aw.thr)} mmol/L</b>.`,`Sente hipos a uma mediana de <b>${nl1(aw.thr)} mmol/L</b>.`), e:`n = ${aw.n}`, follow:["safety","whylow"] }; } },
  { id:"day", kw:["beste dag","slechtste dag","best day","worst day","melhor dia","pior dia","ergste"],
    run:D=>{ const j=_notable||{}; const parts=[];
      if(j.best) parts.push(TL(`beste dag ${pct0(j.best.v)} in bereik`,`best day ${pct0(j.best.v)} in range`,`melhor dia ${pct0(j.best.v)} no alvo`));
      if(j.worst) parts.push(TL(`laagste ${nl1(j.worst.v)}`,`lowest ${nl1(j.worst.v)}`,`mínimo ${nl1(j.worst.v)}`));
      if(j.high) parts.push(TL(`hoogste ${nl1(j.high.v)}`,`highest ${nl1(j.high.v)}`,`máximo ${nl1(j.high.v)}`));
      if(!parts.length) return { t:TL("Beste & slechtste dag","Best & worst day","Melhor e pior dia"), b:TL("Nog te weinig volledige dagen om uitschieters aan te wijzen.","Too few full days to point out outliers.","Poucos dias completos para apontar extremos."), e:"" };
      return { t:TL("Beste & slechtste dag","Best & worst day","Melhor e pior dia"), b:parts.join(" · ")+". "+TL("Open de Dagcurve om ze te bekijken.","Open the Day curve to view them.","Abra a Curva do dia para os ver."), e:"", follow:["tir","safety"] }; } },
  { id:"discuss", kw:["bespreek","discuss","discutir","arts","doctor","medico","consult","vragen","questions","perguntas","aandacht"],
    run:D=>{ const op=opportunity(D.m, agp(D.g), D.hy, weeklyTrend(D.c.glucose,D.c.q));
      return { t:TL("Wat te bespreken","What to discuss","O que discutir"), b:op.msg,
        e:TL("Zet bevindingen op je consultlijst — ze komen automatisch in je rapport.","Add findings to your consult list — they go into your report automatically.","Adicione achados à lista de consulta — entram no relatório."),
        goto:"consult", follow:["tir","safety","isf"] }; } },
];}
function askData(query){
  const c=_ctx;
  if(!c||!c.glucose||!c.glucose.length) return { none:true, msg:TL("Nog geen data — synchroniseer eerst je Nightscout.","No data yet — sync your Nightscout first.","Ainda sem dados — sincronize primeiro o seu Nightscout.") };
  const q=_askNorm(query); if(!q) return null;
  const g=c.glucose.filter(x=>c.q.usableKeys.has(localDayKey(x.ts)));
  const D={ c, g, ent:{dp:_askDaypart(q)},
    m:metrics(g), hy:c.hy||hypoStats(g),
    MR:mealResults(c.glucose,c.treatments,c.timeline),
    oi:observedISF(c.glucose,c.treatments,c.timeline),
    drift:basalDrift(c.glucose,c.treatments,c.q),
    ins:insulinCarbs(c.treatments,c.timeline,c.q) };
  const intents=_askIntents();
  let best=null, bestScore=0;
  for(const it of intents){ let s=0; for(const k of it.kw){ if(q.includes(_askNorm(k))) s+= (k.includes(" ")?2:1); }
    if(s>bestScore){ bestScore=s; best=it; } }
  if(!best || bestScore===0) return { unknown:true };
  const ans=best.run(D); ans._id=best.id; return ans;
}
// Contextpakket voor de AI: uitsluitend de reeds-berekende samenvattende cijfers
// (dezelfde die op je scherm staan). Nooit de ruwe sensorstroom. Plain getallen.
function buildAskContext(){
  const c=_ctx; if(!c||!c.glucose||!c.glucose.length) return null;
  const g=c.glucose.filter(x=>c.q.usableKeys.has(localDayKey(x.ts)));
  const f1=v=>v==null||!isFinite(v)?"?":v.toFixed(1), P=v=>Math.round(v*100)+"%";
  const m=metrics(g), hy=c.hy||hypoStats(g), MR=mealResults(c.glucose,c.treatments,c.timeline),
    oi=observedISF(c.glucose,c.treatments,c.timeline), drift=basalDrift(c.glucose,c.treatments,c.q),
    ins=insulinCarbs(c.treatments,c.timeline,c.q), dawn=drift&&drift.stat?dawnPattern(drift):null,
    sg=somogyiPattern(c.glucose,c.q), watch=watchList(c.glucose,c.q);
  const L=[];
  L.push(`Period: ${c.q.usable.length}/${c.q.days.length} days, coverage ${P(c.q.coverage)}. Glucose unit mmol/L.`);
  L.push(`Time in range 3.9-10.0: ${P(m.tir)} (target >70%). Time <3.9: ${P(m.tbr)} (target <4%). Time <3.0: ${P(m.veryLow)}. Time >10.0: ${P(m.tar)}. Time >13.9: ${P(m.veryHigh)}. CV ${P(m.cv)} (target <=36%). GMI ${f1(m.gmi)}%. Mean ${f1(m.mean)}.`);
  L.push(`Lows: ${hy.episodes} episodes >=15min (${hy.level2} severe <3.0; ${hy.nocturnal} nocturnal 00-06h); ${hy.dips} short dips <15min.`);
  if(MR&&MR.results.length>=MEAL_MIN) L.push(`Meal response (n=${MR.results.length}): median peak ${Math.round(MR.mtpk)} min after eating; t50 ${MR.mt50==null?"?":Math.round(MR.mt50)} min; median ${P(MR.mfrac)} of entered carbs seen back; manual-bolus timing median ${MR.moffset==null?"?":Math.round(MR.moffset)+" min vs meal (negative = prebolus)"}.`);
  else L.push(`Meal response: too few isolated meals with a manual bolus to analyse.`);
  if(oi&&oi.obs!=null) L.push(`Measured ISF: 1 unit lowers ~${f1(oi.obs)} mmol/L (IQR ${f1(oi.q25)}-${f1(oi.q75)}, n=${oi.n})${oi.prof!=null?`, set profile ISF ${f1(oi.prof)}`:""}.`);
  else L.push(`Measured ISF: too few clean manual corrections to measure.`);
  if(dawn) L.push(`Dawn phenomenon detected: fasting early-morning rise ~${f1(dawn.rise)} mmol/L per hour around hours ${dawn.hours.join(",")}.`);
  else if(drift&&drift.stat){ const u=(drift.up||[]).map(s=>s.h), d=(drift.down||[]).map(s=>s.h);
    L.push(`Fasting drift: ${u.length?"rise around hours "+u.join(","):""}${u.length&&d.length?"; ":""}${d.length?"fall around hours "+d.join(","):""}${!u.length&&!d.length?"flat, no structural drift":""}.`); }
  if(sg) L.push(`Somogyi pattern: ${sg.rebounds}/${sg.nights} nights with a low were followed by a morning high (debated phenomenon; could also be dawn or breakfast).`);
  if(ins&&ins.tdd!=null) L.push(`Insulin: total daily dose ~${f1(ins.tdd)} U (basal/bolus ${Math.round(ins.basalPct*100)}/${Math.round(ins.bolusPct*100)}%), carbs ~${Math.round(ins.carbsDay)} g/day.`);
  if(!watch.few && watch.alerts.length) L.push(`Recent trend (last 2 weeks vs prior 2): `+watch.alerts.map(a=>a.title.replace(/<[^>]+>/g,"")).join("; ")+".");
  return { text:L.join("\n") };
}
const _AI_LANG = { nl:"Dutch", en:"English", pt:"Portuguese" };
async function askAI(question){
  const out=document.getElementById("askAnswer"); if(!out) return;
  if(!cfg.aiOn || !cfg.aiKey || !cfg.aiUrl){ out.innerHTML=`<div class="askA"><div class="askAb askNone">${t("ask.aiOff")}</div></div>`; return; }
  const ctx=buildAskContext();
  if(!ctx){ out.innerHTML=`<div class="askA"><div class="askAb">${TL("Nog geen data.","No data yet.","Ainda sem dados.")}</div></div>`; return; }
  const lang=_AI_LANG[LANG]||"Dutch";
  const sys=`You are a careful assistant helping a person with type 1 diabetes review THEIR OWN CGM and pump data. Answer ONLY using the FACTS provided below. If the facts do not contain the answer, say so plainly — never invent numbers. You are NOT a medical device: never give insulin doses, dose sizes, dose changes, correction amounts, or prescriptions. Frame everything as observations and discussion points for their care team. Glucose is in mmol/L. Be concise (at most ~4 sentences). Reply in ${lang}.\n\nFACTS:\n${ctx.text}`;
  out.innerHTML=`<div class="askA ai"><div class="askAb">${t("ask.aiThinking")}</div></div>`;
  try{
    const r=await fetch(cfg.aiUrl.replace(/\/+$/,"")+"/chat/completions",{ method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+cfg.aiKey },
      body:JSON.stringify({ model:cfg.aiModel||"gpt-4o-mini", temperature:0.2, max_tokens:400,
        messages:[{role:"system",content:sys},{role:"user",content:question}] }) });
    if(!r.ok){ const tx=await r.text().catch(()=>""); throw new Error("HTTP "+r.status+(tx?" — "+tx.slice(0,160):"")); }
    const j=await r.json();
    const msg=(j&&j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content||"").trim()
      || TL("Geen antwoord ontvangen.","No answer received.","Nenhuma resposta recebida.");
    out.innerHTML=`<div class="askA ai"><div class="askAb">${esc(msg).replace(/\n/g,"<br>")}</div>`+
      `<div class="askBadge">${t("ask.aiBadge")}</div>`+
      `<details class="aiSent"><summary>${t("ask.aiWhatSent")}</summary><pre>${esc(ctx.text)}</pre></details></div>`;
  }catch(e){ out.innerHTML=`<div class="askA ai"><div class="askAb">${t("ask.aiErr")}: ${esc(e.message)}</div></div>`; }
}
const aiEnabled = () => !!(cfg.aiOn && cfg.aiKey && cfg.aiUrl);
async function renderAsk(query){
  const out=document.getElementById("askAnswer"); if(!out) return;
  // hypo-gevoel-logs voor de awareness-intentie
  try{ window._askFelt=(await DB.all("annotations")).filter(a=>a.type==="hypogevoel").map(f=>({ts:f.ts,measured:f.measured,intensity:f.intensity})); }catch(_){ window._askFelt=[]; }
  const r=askData(query);
  if(!r){ out.innerHTML=""; return; }
  if(r.none){ out.innerHTML=`<div class="askA"><div class="askAb">${r.msg}</div></div>`; return; }
  const aiBtn = aiEnabled()?`<button type="button" class="act ghost" data-askai="${esc(query)}">${t("ask.aiBtn")}</button>`:"";
  if(r.unknown){ out.innerHTML=`<div class="askA"><div class="askAb askNone">${TL("Die vraag snap ik (nog) niet. Probeer bijvoorbeeld:","I don't understand that question (yet). Try for example:","Não entendo essa pergunta (ainda). Tente por exemplo:")}</div>${aiBtn?`<div class="askAct">${aiBtn}</div>`:""}<div class="chips askFollow">${_askExamples().slice(0,5).map(x=>`<button type="button" class="chip" data-ask="${esc(x)}">${esc(x)}</button>`).join("")}</div></div>`; wireAsk(out); return; }
  const foll=(r.follow||[]).map(id=>_askQtext(id)).filter(Boolean);
  out.innerHTML=`<div class="askA"><div class="askAh">${r.t}</div><div class="askAb">${r.b}</div>${r.e?`<div class="askAe">${r.e}</div>`:""}`+
    `<div class="askAct">`+
      (r.consult?`<button type="button" class="act ghost" data-askconsult='${esc(JSON.stringify(r.consult))}'>${TL("→ consultlijst","→ consult list","→ lista de consulta")}</button>`:"")+
      (r.goto?`<button type="button" class="act ghost" data-askgoto="${r.goto}">${TL("Open Consult","Open Consult","Abrir Consulta")}</button>`:"")+
      aiBtn+
    `</div>`+
    (foll.length?`<div class="chips askFollow">${foll.map(x=>`<button type="button" class="chip" data-ask="${esc(x)}">${esc(x)}</button>`).join("")}</div>`:"")+
    `</div>`;
  wireAsk(out);
}
function wireAsk(scope){
  scope.querySelectorAll("[data-ask]").forEach(b=>b.onclick=()=>{ const inp=document.getElementById("askInput"); if(inp) inp.value=b.dataset.ask; renderAsk(b.dataset.ask); });
  scope.querySelectorAll("[data-askgoto]").forEach(b=>b.onclick=()=>showTab(b.dataset.askgoto));
  scope.querySelectorAll("[data-askai]").forEach(b=>b.onclick=()=>askAI(b.dataset.askai));
  scope.querySelectorAll("[data-askconsult]").forEach(b=>b.onclick=async()=>{ let cc; try{cc=JSON.parse(b.dataset.askconsult);}catch(_){return;}
    let l=[]; try{ l=(await DB.meta("consultlist"))||[]; }catch(_){}
    if(!l.some(x=>x.id===cc.id)){ l.push(cc); await DB.meta("consultlist",l); toast(TL("Op je consultlijst gezet.","Added to your consult list.","Adicionado à lista de consulta.")); renderConsult(); }
    b.textContent=TL("✓ op consultlijst","✓ on consult list","✓ na lista"); b.disabled=true; });
}
// Voorbeeldvraag per intentie-id (voor de start- en vervolgvraag-chips).
function _askQtext(id){ return ({
  night:TL("Hoe ging mijn nacht?","How was my night?","Como foi a minha noite?"),
  whylow:TL("Waarom zak ik 's nachts?","Why do I go low at night?","Porque desço à noite?"),
  whyspike:TL("Waarom piek ik na het eten?","Why do I spike after eating?","Porque tenho picos após comer?"),
  carbs:TL("Tel ik mijn koolhydraten goed?","Am I counting carbs well?","Conto bem os hidratos?"),
  prebolus:TL("Wanneer moet ik prebolussen?","When should I prebolus?","Quando devo fazer prebólus?"),
  isf:TL("Klopt mijn correctiefactor?","Is my correction factor right?","O meu fator de correção está certo?"),
  basal:TL("Heb ik een dawn-fenomeen?","Do I have a dawn phenomenon?","Tenho fenómeno do amanhecer?"),
  tir:TL("Hoe is mijn tijd in bereik?","How's my time in range?","Como está o meu tempo no alvo?"),
  safety:TL("Hoeveel hypo's heb ik?","How many lows do I have?","Quantas hipos tenho?"),
  trend:TL("Word ik beter of slechter?","Am I getting better or worse?","Estou a melhorar ou a piorar?"),
  insulin:TL("Hoeveel insuline gebruik ik?","How much insulin do I use?","Quanta insulina uso?"),
  awareness:TL("Voel ik mijn hypo's nog?","Do I still feel my lows?","Ainda sinto as minhas hipos?"),
  day:TL("Wat was mijn beste en slechtste dag?","What were my best and worst days?","Quais foram os meus melhores e piores dias?"),
  discuss:TL("Wat bespreek ik met mijn arts?","What should I discuss with my doctor?","O que discuto com o médico?"),
})[id]||null; }
function renderAskExamples(){
  const box=document.getElementById("askBox"), ex=document.getElementById("askExamples"); if(!box||!ex) return;
  box.hidden = !(_ctx&&_ctx.glucose&&_ctx.glucose.length);
  const ids=["night","whylow","carbs","prebolus"];
  ex.innerHTML=ids.map(id=>_askQtext(id)).filter(Boolean).map(x=>`<button type="button" class="chip" data-ask="${esc(x)}">${esc(x)}</button>`).join("");
  wireAsk(ex);
}

async function renderConsult(){
  const el=document.getElementById("consultList"); if(!el) return;
  let cl=[]; try{ cl=(await DB.meta("consultlist"))||[]; }catch(_){}
  document.getElementById("consultSub").textContent = cl.length?TL(`${cl.length} punt${cl.length===1?"":"en"} verzameld`,`${cl.length} point${cl.length===1?"":"s"} collected`,`${cl.length} ponto${cl.length===1?"":"s"} recolhido${cl.length===1?"":"s"}`):"";
  const badge=document.getElementById("consultBadge");
  if (badge){ badge.textContent=cl.length; badge.hidden=!cl.length; }
  el.innerHTML = cl.length
    ? cl.map(c=>`<div class="citem"><span>${esc(c.title)}</span><button class="del" data-cid="${esc(c.id)}" aria-label="${TL("verwijderen","delete","eliminar")}">✕</button></div>`).join("")
    : `<div class="muted" style="padding:.2rem .1rem .4rem">${TL("Nog niets op je consultlijst.","Your consult list is empty.","A lista está vazia.")}</div>`;
  el.querySelectorAll("[data-cid]").forEach(b2=>b2.onclick=async()=>{
    let l2=(await DB.meta("consultlist"))||[]; l2=l2.filter(x=>x.id!==b2.dataset.cid);
    await DB.meta("consultlist",l2); renderConsult();
    if(_fctx) renderFindings(_fctx); });
}

/* ══ VERDIEPING — geavanceerde analyses (lui: pas bij openklappen) ═════════ */
function joinHrs(hs){ const s=[...hs].sort((a,b)=>a-b),o=[];
  for(let i=0;i<s.length;i++){ let j=i; while(j+1<s.length&&s[j+1]===s[j]+1)j++;
    o.push(`${String(s[i]).padStart(2,"0")}–${String(s[j]+1).padStart(2,"0")}u`); i=j; } return o; }

function driftSvg(stat){
  const has=stat.filter(s=>s.med!=null); if(!has.length) return "";
  const W=320,H=150,PB=20,PL=26,PT=10,mid=PT+(H-PB-PT)/2;
  const maxA=Math.max(0.5,...has.map(s=>Math.max(Math.abs(s.p25),Math.abs(s.p75),Math.abs(s.med))));
  const Y=v=>mid-(v/maxA)*((H-PB-PT)/2), bw=(W-PL-6)/24;
  let s=`<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  s+=`<line x1="${PL}" y1="${mid}" x2="${W}" y2="${mid}" stroke="var(--line-2)" stroke-width="1"/>`;
  s+=`<text x="${PL-3}" y="${(mid+3).toFixed(1)}" font-size="8" fill="var(--muted)" text-anchor="end">0</text>`;
  for(const h of [0,6,12,18]){ const x=PL+h*bw; s+=`<text x="${x.toFixed(1)}" y="${H-4}" font-size="8" fill="var(--muted)">${h}${TL("u","h","h")}</text>`; }
  has.forEach(o=>{ const x=PL+o.h*bw+bw*.15,w=bw*.7,y0=Y(0),y=Y(o.med),cx=x+w/2;
    const col=o.structural?(o.med>0?"var(--high)":"var(--low)"):"var(--line-2)";
    s+=`<line x1="${cx.toFixed(1)}" y1="${Y(o.p75).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${Y(o.p25).toFixed(1)}" stroke="var(--muted)" stroke-width="1"/>`;
    s+=`<rect x="${x.toFixed(1)}" y="${Math.min(y0,y).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.abs(y-y0).toFixed(1)}" rx="1.5" fill="${col}"/>`; });
  s+=`<text x="${PL}" y="12" font-size="7.5" fill="var(--dim)">mmol/L per uur — omhoog = stijgt, omlaag = zakt</text>`;
  return s+"</svg>";
}
function absorpSvg(GRID, medc, t50){
  const W=320,H=150,PB=22,PL=24,PT=10;
  const X=x=>PL+(x/240)*(W-PL), Y=p=>(H-PB)-(p/100)*(H-PB-PT);
  let s=`<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  for(const p of [0,50,100]){ const y=Y(p); s+=`<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"${p===50?' stroke-dasharray="3 3"':''}/><text x="${PL-3}" y="${(y+3).toFixed(1)}" font-size="8" fill="var(--muted)" text-anchor="end">${p}</text>`; }
  for(const mn of [60,120,180,240]){ const x=X(mn); s+=`<text x="${x.toFixed(1)}" y="${H-4}" font-size="8" fill="var(--muted)" text-anchor="middle">${mn}m</text>`; }
  if(t50!=null){ const x=X(t50); s+=`<line x1="${x.toFixed(1)}" y1="${Y(0).toFixed(1)}" x2="${x.toFixed(1)}" y2="${Y(100).toFixed(1)}" stroke="var(--high)" stroke-width="1" stroke-dasharray="2 2"/>`; }
  const d=GRID.map((x,i)=>(i?"L":"M")+X(x).toFixed(1)+" "+Y(medc[i]).toFixed(1)).join(" ");
  s+=`<path d="${d}" fill="none" stroke="var(--inRange)" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  s+=`<text x="${PL}" y="10" font-size="7.5" fill="var(--dim)">${TL("% koolhydraten opgenomen na de maaltijd","% carbs absorbed after the meal","% de hidratos absorvidos após a refeição")}</text>`;
  return s+"</svg>";
}

// Basaaldrift in maaltijd-/bolusvrije ("nuchtere") vensters, per uur van de dag.
// Herbruikt door zowel de dagpatroon-verdieping als het fine-tune-paneel.
function basalDrift(glucose, treatments, q){
  const CLEAN=5*3600e3, MIN_DT=3*60e3, MAX_DT=15*60e3, MIN_N=15, TH=0.3;
  const events=treatments.filter(t=>t.carbs>0||t.insulin>0).map(t=>t.ts).sort((a,b)=>a-b);
  const g=glucose.filter(x=>q.usableKeys.has(localDayKey(x.ts)));
  let ei=0; const clean=new Array(g.length);
  for(let i=0;i<g.length;i++){ const t=g[i].ts; while(ei<events.length&&events[ei]<=t)ei++; clean[i]=(t-(ei>0?events[ei-1]:-Infinity))>=CLEAN; }
  const perHour=Array.from({length:24},()=>[]);
  for(let i=1;i<g.length;i++){ if(!clean[i]||!clean[i-1])continue; const dt=g[i].ts-g[i-1].ts; if(dt<MIN_DT||dt>MAX_DT)continue;
    perHour[Math.floor(todMin(g[i-1].ts+dt/2)/60)%24].push((g[i].bg-g[i-1].bg)/(dt/3600e3)); }
  const total=perHour.reduce((s,a)=>s+a.length,0);
  if(total<120) return { total, stat:null, TH };
  const stat=perHour.map((arr,h)=>{ if(arr.length<MIN_N)return{h,med:null}; const s=[...arr].sort((a,b)=>a-b);
    const qf=p=>s[Math.min(s.length-1,Math.floor(p*s.length))]; const med=qf(.5),p25=qf(.25),p75=qf(.75);
    return {h,med,p25,p75,structural:Math.abs(med)>=TH&&((p25>0&&p75>0)||(p25<0&&p75<0))}; });
  const up=stat.filter(s=>s.structural&&s.med>0), down=stat.filter(s=>s.structural&&s.med<0);
  const peak=l=>l.reduce((m,s)=>Math.abs(s.med)>Math.abs(m)?s.med:m,0);
  return { total, stat, up, down, peakUp:peak(up), peakDown:peak(down), TH };
}
// ── Circadiane & context-patronen (referentie: T1D-managementmethoden, §4 & §5).
// Alles is observatie + bespreekpunt; nooit een dosis of protocol-instructie.

// Dawn-fenomeen: structurele nuchtere stijging in de vroege ochtend (04–08 u),
// klassiek door groeihormoon. Afgeleid uit de al berekende basaaldrift.
function dawnPattern(drift){
  if(!drift || !drift.stat) return null;
  const DAWN=[4,5,6,7], med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:null;};
  const up=(drift.up||[]).filter(s=>DAWN.includes(s.h));
  if(up.length<2) return null;                       // ≥2 dawn-uren met structurele stijging
  const pre=(drift.stat||[]).filter(s=>[0,1,2,3].includes(s.h)&&s.med!=null);
  const preFlat = !pre.length || med(pre.map(s=>Math.abs(s.med))) < drift.TH;   // nacht ervoor relatief vlak
  if(!preFlat) return null;                          // anders is het algemene drift, geen dawn
  return { hours:up.map(s=>s.h).sort((a,b)=>a-b), rise:med(up.map(s=>s.med)), n:drift.total };
}

// Somogyi-rebound (omstreden): een nachtelijke laagte gevolgd door een ochtendhyper.
// Puur observatie — het kan net zo goed het dawn-fenomeen of het ontbijt zijn.
function somogyiPattern(glucose, q){
  const g=glucose.filter(x=>q.usableKeys.has(localDayKey(x.ts)));
  if(g.length<200) return null;
  const byDay=new Map();
  for(const x of g){ const k=localDayKey(x.ts); (byDay.get(k)||byDay.set(k,[]).get(k)).push(x); }
  let nights=0, rebounds=0;
  for(const [,arr] of byDay){
    if(!arr.some(x=>todMin(x.ts)<360 && x.bg<3.9)) continue;      // nachtelijke laagte (00–06)
    nights++;
    if(arr.some(x=>{const m=todMin(x.ts); return m>=360 && m<600 && x.bg>10;})) rebounds++;  // ochtendhyper (06–10)
  }
  if(nights<3 || rebounds<3 || rebounds/nights<0.5) return null;
  return { nights, rebounds, frac:rebounds/nights };
}

// Verlate hypo na inspanning (delayed-onset): meer laagtes 4–12 u ná een
// "sport"-markering dan normaal. Leunt op je eigen logboek-markeringen.
function exerciseLatePattern(glucose, q, anns){
  const sport=(anns||[]).filter(a=>a.type==="sport").map(a=>a.ts);
  if(sport.length<3) return null;
  const g=glucose.filter(x=>q.usableKeys.has(localDayKey(x.ts)));
  if(!g.length) return null;
  const inWin=ts=>sport.some(s=>ts>=s+4*3600e3 && ts<=s+12*3600e3);
  let wLow=0,wN=0,bLow=0,bN=0;
  for(const x of g){ if(inWin(x.ts)){ wN++; if(x.bg<3.9)wLow++; } else { bN++; if(x.bg<3.9)bLow++; } }
  if(wN<40) return null;
  const wRate=wLow/wN, bRate=bLow/Math.max(1,bN);
  if(wRate < bRate+0.02) return null;                // duidelijk verhoogd
  return { events:sport.length, wRate, bRate };
}

function anDagpatroon(glucose, treatments, q){
  const d=basalDrift(glucose, treatments, q);
  if(!d.stat) return `<div class="muted">Te weinig maaltijd-/bolusvrije momenten (${d.total}) voor een dagpatroon. Bijna al je uren vallen binnen 5 uur na een maaltijd of bolus — met meer nuchtere periodes of historie komt dit beschikbaar.</div>`;
  const {stat,up,down,total}=d;
  const peak=l=>l.reduce((m,s)=>Math.abs(s.med)>Math.abs(m)?s.med:m,0);
  let obs;
  if(!up.length&&!down.length) obs="Geen uur waarop je in maaltijd- en bolusvrije vensters structureel wegdrijft — je basaal lijkt over de dag heen in balans.";
  else { const parts=[];
    if(up.length)parts.push(`stijg je rond <b>${joinHrs(up.map(s=>s.h)).join(", ")}</b> (tot ${nl1(peak(up))} mmol/L/u) — waar een iets hóger basaal in beeld komt`);
    if(down.length)parts.push(`zak je rond <b>${joinHrs(down.map(s=>s.h)).join(", ")}</b> (tot ${nl1(peak(down))} mmol/L/u) — waar een iets láger basaal hypo's kan schelen`);
    obs=`In stille vensters ${parts.join("; en ")}. In AAPS pas je een basaalblok doorgaans 1–2 uur vóór het effect aan. Observatie, geen instelwaarde — bespreek met je behandelteam.`; }
  return driftSvg(stat)+`<div class="obs">${obs}</div><div class="muted" style="margin-top:.4rem">n = ${total.toLocaleString(LOCALE())} driftmetingen in schone vensters · drempel 0,3 mmol/L/u · bij een closed loop kan temp-basaal een echt profielverschil maskeren</div>`;
}

// Loop-basaal: voor een closed loop werkt basaaldrift niet (de loop regelt de drift
// weg). Beter is te lezen wat de lóóp deed: per uur van de dag de werkelijk geleverde
// basaal (temp-basaal, met je profiel als terugval waar geen temp actief is) naast je
// profiel-basaal. Waar de loop dag na dag structureel méér/minder levert, staat je
// profiel daar te laag/hoog. Maaltijduren (3 u na koolhydraten) worden eruit gefilterd
// zodat het over nuchtere basaalbehoefte gaat; SMB's blijven juist meetellen.
function loopBasal(treatments, timeline, q){
  if(!timeline) return { noprof:true };
  const from=q.from||0, to=q.to||Date.now();
  const temps=treatments.filter(t=>t.type==="Temp Basal").map(t=>{ const r=t.raw||{};
    const durMs=r.durationInMilliseconds!=null?+r.durationInMilliseconds:(t.duration||0)*60000;
    return { ts:t.ts, end:t.ts+durMs,
      abs:(r.absolute!=null?+r.absolute:(r.rate!=null?+r.rate:null)),
      pct:(r.percent!=null?+r.percent:null) };
  }).filter(x=>x.end>from && x.ts<to && (x.abs!=null||x.pct!=null)).sort((a,b)=>a.ts-b.ts);
  if(temps.length<50) return { few:temps.length };
  const TL=temps.map(t=>t.ts);
  const lastTemp=ts=>{ let lo=0,hi=TL.length; while(lo<hi){const m=(lo+hi)>>1; if(TL[m]<=ts)lo=m+1;else hi=m;} return lo-1; };
  const carbTs=treatments.filter(t=>t.carbs>=20).map(t=>t.ts).sort((a,b)=>a-b);
  const MEAL=3*3600e3;
  const nearMeal=ts=>{ let lo=0,hi=carbTs.length; while(lo<hi){const m=(lo+hi)>>1; if(carbTs[m]<=ts)lo=m+1;else hi=m;} return lo>0 && carbTs[lo-1]>ts-MEAL; };
  const STEP=10*60e3, hp=Array.from({length:24},()=>({a:0,p:0,n:0,s:0}));
  const okDay=ts=>!q.usableKeys||q.usableKeys.has(localDayKey(ts));   // alleen bruikbare dagen (geen pen-/loop-uit-dagen)
  for(let t=from;t<to;t+=STEP){
    if(!okDay(t)||nearMeal(t)) continue;
    const prof=profileAt(timeline,t); if(!prof||prof.basal==null||prof.source==="geen") continue;
    const pr=prof.basal; let ar=pr; const i=lastTemp(t);
    if(i>=0 && t<temps[i].end){ const tb=temps[i]; ar = tb.abs!=null ? tb.abs : pr*(tb.pct/100); }
    const h=Math.floor(todMin(t)/60)%24; hp[h].a+=ar; hp[h].p+=pr; hp[h].n++;
  }
  // SMB's tellen mee als geleverde insuline: een loop die minder temp-basaal maar meer SMB geeft, levert netto evenveel.
  for(const t of treatments){ if(!t.isSMB||!(t.insulin>0)||t.ts<from||t.ts>=to) continue; if(!okDay(t.ts)||nearMeal(t.ts)) continue; hp[Math.floor(todMin(t.ts)/60)%24].s+=t.insulin; }
  const hours=hp.map((o,h)=>o.n>=18?{h,act:o.a/o.n+o.s/(o.n*STEP/3600e3),temp:o.a/o.n,smb:o.s/(o.n*STEP/3600e3),prof:o.p/o.n,n:o.n}:{h,n:o.n});
  const valid=hours.filter(x=>x.act!=null);
  if(valid.length<6) return { few:temps.length, thin:true };
  const totA=valid.reduce((s,x)=>s+x.act,0), totP=valid.reduce((s,x)=>s+x.prof,0);
  return { hours, ratio:totP>0?totA/totP:null, days:Math.max(1,Math.round((to-from)/DAY)), nTemps:temps.length };
}
function loopBasalSvg(hours){
  const W=340,H=124,PT=8,PB=16,PL=6, mx=Math.max(0.1,...hours.map(x=>Math.max(x.act||0,x.prof||0)));
  const bw=(W-PL*2)/24, X=h=>PL+h*bw, Y=v=>H-PB-(v/mx)*(H-PT-PB);
  let bars="",pmark="";
  for(let h=0;h<24;h++){ const o=hours[h]; if(o.act==null) continue; const x=X(h), y=Y(o.act), yp=Y(o.prof);
    bars+=`<rect x="${(x+.8).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw-1.6).toFixed(1)}" height="${(H-PB-y).toFixed(1)}" fill="var(--accent)" opacity="${o.act>=o.prof?'.55':'.3'}" rx="1"/>`;
    pmark+=`<line x1="${(x+.6).toFixed(1)}" y1="${yp.toFixed(1)}" x2="${(x+bw-.6).toFixed(1)}" y2="${yp.toFixed(1)}" stroke="var(--ink)" stroke-width="1.6"/>`; }
  const ax=[0,6,12,18,24].map(h=>`<text x="${X(Math.min(h,23.5)).toFixed(1)}" y="${H-4}" font-size="8" fill="var(--muted)" text-anchor="middle">${h}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block">${bars}${pmark}${ax}</svg>`+
    `<div class="legend"><span><i style="background:var(--accent);opacity:.55"></i>${TL("loop geleverd","loop delivered","entregue pelo loop")}</span><span><i style="background:var(--ink)"></i>${TL("profiel","profile","perfil")}</span></div>`;
}
function anLoopBasal(glucose, treatments, q, timeline){
  const r=loopBasal(treatments, timeline, q);
  if(r.noprof) return `<div class="muted">${TL("Geen profiel met basaalschema in Nightscout gevonden — nodig om je loop-basaal naast je profiel te leggen.","No profile with a basal schedule found in Nightscout — needed to compare your loop basal against your profile.","Nenhum perfil com esquema basal encontrado no Nightscout — necessário para comparar a basal do loop com o seu perfil.")}</div>`;
  if(r.thin) return `<div class="muted">${TL("Te weinig nuchtere uren met loop-data om je basaal per uur te vergelijken.","Too few fasting hours with loop data to compare your basal per hour.","Poucas horas em jejum com dados do loop para comparar a sua basal por hora.")}</div>`;
  if(r.few!=null) return `<div class="muted">${TL(`Te weinig temp-basaal-data (${r.few}). Werkt alleen bij een <b>closed loop</b> (AAPS/Loop) die temp-basaal naar Nightscout stuurt.`,`Too little temp-basal data (${r.few}). Only works with a <b>closed loop</b> (AAPS/Loop) that sends temp basal to Nightscout.`,`Poucos dados de basal temporária (${r.few}). Só funciona com um <b>closed loop</b> (AAPS/Loop) que envia basal temporária para o Nightscout.`)}</div>`;
  const TH=0.15;
  const dev=r.hours.filter(x=>x.act!=null && Math.abs(x.act-x.prof)/Math.max(0.05,x.prof)>=TH);
  const up=dev.filter(x=>x.act>x.prof).map(x=>x.h), down=dev.filter(x=>x.act<x.prof).map(x=>x.h);
  const pct=r.ratio!=null?Math.round((r.ratio-1)*100):0, ps=(pct>=0?"+":"")+pct+"%";
  let lead;
  if(!up.length && !down.length) lead=TL(`Je loop levert ongeveer je profiel-basaal (${ps} totaal) — je profiel sluit aan bij wat de loop nodig heeft.`,`Your loop delivers roughly your profile basal (${ps} total) — your profile matches what the loop needs.`,`O seu loop entrega aproximadamente a basal do perfil (${ps} total) — o seu perfil corresponde ao que o loop precisa.`);
  else { const parts=[];
    if(up.length) parts.push(TL(`rond <b>${joinHrs(up).join(", ")}</b> levert je loop <b>méér</b> — profiel mogelijk te <b>laag</b>`,`around <b>${joinHrs(up).join(", ")}</b> your loop delivers <b>more</b> — profile possibly too <b>low</b>`,`por volta de <b>${joinHrs(up).join(", ")}</b> o loop entrega <b>mais</b> — perfil possivelmente <b>baixo</b>`));
    if(down.length) parts.push(TL(`rond <b>${joinHrs(down).join(", ")}</b> <b>minder</b> — mogelijk te <b>hoog</b>`,`around <b>${joinHrs(down).join(", ")}</b> <b>less</b> — possibly too <b>high</b>`,`por volta de <b>${joinHrs(down).join(", ")}</b> <b>menos</b> — possivelmente <b>alto</b>`));
    lead=TL(`Je loop levert <b>${ps}</b> t.o.v. je profiel-basaal: ${parts.join("; ")}. Bespreekpunt, geen instelwaarde.`,`Your loop delivers <b>${ps}</b> vs your profile basal: ${parts.join("; ")}. Discussion point, not a setting.`,`O seu loop entrega <b>${ps}</b> face à basal do perfil: ${parts.join("; ")}. Ponto de discussão, não um parâmetro.`); }
  const explain=`<details class="mini" style="margin:0 0 .6rem"><summary>${TL("Wat zie ik hier?","What am I looking at?","O que estou a ver?")}</summary><div class="minibody">`+
    `<div>${TL("Je <b>profiel</b> is je plan (streepjes); je <b>loop</b> wijkt daarvan af om je in bereik te houden (balken).","Your <b>profile</b> is your plan (ticks); your <b>loop</b> deviates from it to keep you in range (bars).","O seu <b>perfil</b> é o seu plano (traços); o seu <b>loop</b> desvia-se dele para o manter no alvo (barras).")}</div>`+
    `<div>${TL("Geeft je loop op een uur dag na dag <b>méér</b> dan je profiel, dan staat je profiel-basaal daar waarschijnlijk te <b>laag</b>; structureel <b>minder</b> = te <b>hoog</b>.","If your loop gives <b>more</b> than your profile at an hour day after day, your profile basal is probably too <b>low</b> there; structurally <b>less</b> = too <b>high</b>.","Se o seu loop dá <b>mais</b> do que o perfil a uma hora dia após dia, a basal do perfil está provavelmente <b>baixa</b> aí; estruturalmente <b>menos</b> = <b>alta</b>.")}</div>`+
    `<div><b>${TL("Wat je eraan hebt:","What it's good for:","Para que serve:")}</b> ${TL("het wijst aan welke basaal-blokken je in je profiel kunt bijstellen. Klopt je profiel beter, dan hoeft je loop minder te corrigeren — dat geeft vlakkere, voorspelbaardere waarden.","it points out which basal blocks you can adjust in your profile. When your profile fits better, your loop has to correct less — giving flatter, more predictable values.","aponta quais os blocos basais que pode ajustar no seu perfil. Quando o perfil encaixa melhor, o loop corrige menos — dando valores mais planos e previsíveis.")}</div>`+
    `</div></details>`;
  return explain+loopBasalSvg(r.hours)+`<div class="obs">${lead}</div>`+
    `<div class="muted" style="margin-top:.4rem">${TL(`Geleverde basaal (temp-basaal) vs. profiel, per uur over ${r.days} dagen; maaltijduren eruit gefilterd. Temp-basaal reageert ook op correcties, dus richting — geen exacte instelwaarde.`,`Delivered basal (temp basal) vs profile, per hour over ${r.days} days; meal hours filtered out. Temp basal also responds to corrections, so direction — not an exact setting.`,`Basal entregue (basal temporária) vs perfil, por hora ao longo de ${r.days} dias; horas de refeição filtradas. A basal temporária também responde a correções, por isso direção — não um valor exato.`)}</div>`;
}

// Herbruikbare maaltijd-berekening (gebruikt door de kaart én door "Jouw vragen").
const MEAL_MIN=8;
function mealResults(glucose, treatments, timeline){
  const MIN_CARBS=30, WIN=4*3600e3, PRE=2*3600e3, MIN_READ=40;
  const boluses=treatments.filter(t=>t.insulin>0).sort((a,b)=>a.ts-b.ts);
  const carbTs=treatments.filter(t=>t.carbs>0).map(t=>t.ts).sort((a,b)=>a-b);
  const meals=treatments.filter(t=>t.carbs>=MIN_CARBS).filter(m=>!carbTs.some(ct=>ct!==m.ts&&ct>m.ts-PRE&&ct<m.ts+WIN)).sort((a,b)=>a.ts-b.ts);
  const T=glucose.map(g=>g.ts); const lb=ts=>{let lo=0,hi=T.length;while(lo<hi){const m=(lo+hi)>>1;if(T[m]<ts)lo=m+1;else hi=m;}return lo;};
  const results=[];
  for(const m of meals){ const prof=profileAt(timeline,m.ts); if(prof.source==="geen"||!prof.isf||!prof.ic)continue;
    const isf=prof.isf,ic=prof.ic,dia=Math.max(300,(prof.dia||6)*60),mdl=insulinModel(PEAK_MIN,dia),diaMs=dia*60000;
    const wB=boluses.filter(b=>b.ts>m.ts-diaMs&&b.ts<m.ts+WIN);
    // Alleen koolhydraten mét een handmatige maaltijdbolus eromheen tellen als "maaltijd".
    // Zonder bolus is het geen maaltijd om je KH-ratio op te toetsen: hypo-redding of
    // losse koolhydraten. (SMB's zijn de loop, geen maaltijdbolus.)
    const mealBolus=wB.reduce((s,b)=>(!b.isSMB && b.ts>=m.ts-45*60e3 && b.ts<=m.ts+90*60e3)?s+b.insulin:s,0);
    if(mealBolus<0.5) continue;
    const win=[]; for(let i=lb(m.ts);i<T.length&&T[i]<=m.ts+WIN;i++)win.push(glucose[i]);
    if(win.length<MIN_READ)continue; if(win[0].ts-m.ts>15*60e3)continue;
    // Timing van de HANDMATIGE bolus t.o.v. de koolhydraat-invoer (negatief = prebolus).
    // SMB's tellen niet mee: een loop-SMB vlak vóór de maaltijd zou anders als een
    // valse prebolus meetellen. Kanttekening: de invoertijd is het bolusmoment, niet
    // per se wanneer je begon te eten — wie tijdens/na het eten logt, meet ~0.
    const nb=wB.filter(b=>!b.isSMB && b.ts>=m.ts-30*60e3 && b.ts<=m.ts+30*60e3).sort((a,b)=>a.ts-b.ts)[0];
    const bolusOffset = nb ? (nb.ts-m.ts)/60000 : null;
    const bg0=win[0].bg; let cum=0,peak=bg0,tPeak=0; const curve=[{min:0,cum:0}];
    for(let i=1;i<win.length;i++){ const dt=(win[i].ts-win[i-1].ts)/60000; if(dt<=0||dt>20)continue;
      const mid=win[i-1].ts+(win[i].ts-win[i-1].ts)/2; let act=0;
      for(const b of wB){ const dm=(mid-b.ts)/60000; if(dm<=0||dm>=dia)continue; act+=b.insulin*mdl.activity(dm); }
      const dev=(win[i].bg-win[i-1].bg)-(-isf*act*dt); cum+=Math.max(0,dev)*ic/isf;
      const ms=(win[i].ts-m.ts)/60000; curve.push({min:ms,cum}); if(win[i].bg>peak){peak=win[i].bg;tPeak=ms;} }
    if(cum<5)continue; const half=cum/2; let t50=null;
    for(let i=1;i<curve.length;i++){ if(curve[i].cum>=half){ const p=curve[i-1],qq=curve[i]; t50=qq.cum===p.cum?qq.min:p.min+(half-p.cum)/(qq.cum-p.cum)*(qq.min-p.min); break; } }
    results.push({ts:m.ts,carbs:m.carbs,frac:cum/m.carbs,t50,peakRise:peak-bg0,tPeak,curve,peakBg:peak,bolusOffset,
      win,wB,isf,dia,bg0}); }   // ts = moment (voor split per dagdeel); ruwe data voor de maaltijd-simulatie
  const med=arr=>{const s=[...arr].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:null;};
  return { results, MIN_CARBS,
    mt50:med(results.filter(r=>r.t50!=null).map(r=>r.t50)), mfrac:med(results.map(r=>r.frac)),
    mtpk:med(results.map(r=>r.tPeak)), mrise:med(results.map(r=>r.peakRise)), mpeak:med(results.map(r=>r.peakBg)),
    moffset:med(results.filter(r=>r.bolusOffset!=null).map(r=>r.bolusOffset)) };
}
function anMeals(glucose, treatments, q, timeline){
  const MR=mealResults(glucose, treatments, timeline);
  const results=MR.results, MIN_CARBS=MR.MIN_CARBS, MIN_MEALS=MEAL_MIN;
  if(results.length<MIN_MEALS) return `<div class="muted">${TL(`Te weinig geïsoleerde maaltijden (${results.length}, minimaal ${MIN_MEALS}) vanaf ${MIN_CARBS} g. Vereist ook profieldata (ISF/IC) uit Nightscout.`,`Too few isolated meals (${results.length}, minimum ${MIN_MEALS}) from ${MIN_CARBS} g. Also requires profile data (ISF/ICR) from Nightscout.`,`Poucas refeições isoladas (${results.length}, mínimo ${MIN_MEALS}) a partir de ${MIN_CARBS} g. Requer também dados de perfil (ISF/ICR) do Nightscout.`)}</div>`;
  const med=arr=>{const s=[...arr].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:null;};
  const mt50=MR.mt50,mfrac=MR.mfrac,mtpk=MR.mtpk;
  const GRID=[];for(let x=0;x<=240;x+=10)GRID.push(x);
  const pctAt=(c,x)=>{const fin=c[c.length-1].cum||1;let cc=0;for(const p of c){if(p.min<=x)cc=p.cum;else break;}return 100*cc/fin;};
  const per=results.map(r=>GRID.map(x=>pctAt(r.curve,x))), medc=GRID.map((_,gi)=>med(per.map(y=>y[gi])));
  const speed=mt50==null?"":mt50>60?TL(" Aan de trage kant — passend bij grote of vette maaltijden."," On the slow side — fitting large or fatty meals."," Do lado lento — compatível com refeições grandes ou gordas."):mt50<35?TL(" Snel — dan telt prebolus-timing zwaar mee."," Fast — then prebolus timing matters a lot."," Rápido — então o timing do prebólus pesa muito."):TL(" Vrij gemiddeld."," Fairly average."," Bastante médio.");
  const acc=mfrac>=0.8&&mfrac<=1.2?TL("je koolhydraatschatting sluit redelijk aan bij wat je glucose laat zien","your carb estimate reasonably matches what your glucose shows","a sua estimativa de hidratos corresponde razoavelmente ao que a glicose mostra"):mfrac<0.8?TL("je ziet minder terug dan ingevoerd — mogelijk tel je te hoog, of dekt insuline ruim","you see less back than entered — you may count too high, or insulin covers generously","vê menos do que introduziu — pode contar a mais, ou a insulina cobre com folga"):TL("je ziet meer terug dan ingevoerd — mogelijk ondergeteld, of te weinig bolus","you see more back than entered — possibly undercounted, or too little bolus","vê mais do que introduziu — possivelmente subcontado, ou bólus insuficiente");
  const stats=`<div class="kpis" style="margin-top:.6rem"><div class="kpi"><div class="k">t50</div><div class="v">${mt50==null?"—":Math.round(mt50)}</div><div class="s">${TL("min tot 50%","min to 50%","min até 50%")}</div></div><div class="kpi"><div class="k">${TL("Piek","Peak","Pico")}</div><div class="v">${Math.round(mtpk)}</div><div class="s">${TL("min na maaltijd","min after meal","min após refeição")}</div></div></div>`;
  return absorpSvg(GRID,medc,mt50)+stats+mealDayparts(results,med)+`<div class="obs">${TL(`Je maaltijden vanaf ${MIN_CARBS} g zijn mediaan na ${mt50==null?"—":Math.round(mt50)} min half opgenomen, piek rond ${Math.round(mtpk)} min.${speed} Bruikbaar voor je bolus-timing.`,`Your meals from ${MIN_CARBS} g are half absorbed after a median of ${mt50==null?"—":Math.round(mt50)} min, peak around ${Math.round(mtpk)} min.${speed} Useful for your bolus timing.`,`As suas refeições a partir de ${MIN_CARBS} g estão meio absorvidas após uma mediana de ${mt50==null?"—":Math.round(mt50)} min, pico por volta de ${Math.round(mtpk)} min.${speed} Útil para o timing do bólus.`)}</div><div class="muted" style="margin-top:.4rem">${TL(`Terzijde: van je koolhydraten zie ik mediaan ${pct0(mfrac)} terug — ${acc}. Deze maat valt structureel te hoog uit (alleen positieve deviaties), dus alleen als context. n = ${results.length}.`,`Aside: of your carbs I see a median of ${pct0(mfrac)} back — ${acc}. This measure runs structurally high (positive deviations only), so context only. n = ${results.length}.`,`À parte: dos seus hidratos vejo uma mediana de ${pct0(mfrac)} de volta — ${acc}. Esta medida sai estruturalmente alta (só desvios positivos), por isso apenas contexto. n = ${results.length}.`)}</div>`;
}

// Lunchtijd: wanneer lunch je écht (invoert), hoe vaak ontbreekt hij, en wat
// doet je glucose op dagen met een late of geen lunch? Observatie, geen advies.
function anLunch(glucose, treatments, q){
  const LOW=3.9, med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:null;};
  const perDay=new Map(); for(const g of glucose){ const k=localDayKey(g.ts); perDay.set(k,(perDay.get(k)||0)+1); }
  const days=[...perDay.entries()].filter(([,n])=>n>=200).map(([k])=>k);
  const carbT=treatments.filter(t=>t.carbs>=10 && todMin(t.ts)>=660 && todMin(t.ts)<960).sort((a,b)=>a.ts-b.ts);
  const lun=[]; for(const t of carbT){ const k=localDayKey(t.ts); if(!days.includes(k)) continue; const l=lun[lun.length-1]; if(l&&l.day===k&&t.ts-l.ts<=2*3600e3){ l.carbs+=t.carbs; } else lun.push({ts:t.ts,day:k,carbs:t.carbs}); }
  if(lun.length<5||days.length<5) return `<div class="muted">${TL(`Te weinig lunches (${lun.length}) in ${days.length} volledige dagen.`,`Too few lunches (${lun.length}) in ${days.length} full days.`,`Poucos almoços (${lun.length}) em ${days.length} dias completos.`)}</div>`;
  const T=glucose.map(g=>g.ts), lb=ts=>{let lo=0,hi=T.length;while(lo<hi){const m=(lo+hi)>>1;if(T[m]<ts)lo=m+1;else hi=m;}return lo;};
  const lunDays=new Set(lun.map(l=>l.day)), skipped=days.filter(d=>!lunDays.has(d));
  const bins=[]; for(let m=660;m<960;m+=30) bins.push({m,n:lun.filter(l=>todMin(l.ts)>=m&&todMin(l.ts)<m+30).length});
  const maxn=Math.max(...bins.map(b=>b.n),1);
  const bars=bins.map(b=>`<div class="lnbar"><span style="width:2.6rem">${fmtMin(b.m)}</span><i style="width:${Math.round(b.n/maxn*160)}px"></i>${b.n||""}</div>`).join("");
  const buckets=[["≤12:30",0,750],["12:30–14:00",750,840],[">14:00",840,1e9]].map(([lab,lo,hi])=>{
    const rs=lun.filter(l=>{const m=todMin(l.ts);return m>=lo&&m<hi;}); const peaks=[],lows=[],st=[]; 
    for(const l of rs){ let pk=null,mn=null,s=null; for(let i=lb(l.ts);i<T.length&&T[i]<=l.ts+4*3600e3;i++){ const bg=glucose[i].bg; if(s==null&&T[i]-l.ts<=15*60e3)s=bg; if(T[i]<=l.ts+3*3600e3&&(pk==null||bg>pk))pk=bg; if(mn==null||bg<mn)mn=bg; }
      if(s!=null&&pk!=null){peaks.push(pk-s);st.push(s);} if(mn!=null)lows.push(mn<LOW?1:0); }
    return {lab,n:rs.length,start:med(st),rise:med(peaks),low:lows.length?lows.reduce((a,b)=>a+b,0)/lows.length:null};});
  const win=(dl)=>{ let n=0,l=0; for(const d of dl){ const s=new Date(d+"T00:00:00").getTime()+13*3600e3, e=s+3*3600e3; for(let i=lb(s);i<T.length&&T[i]<e;i++){n++; if(glucose[i].bg<LOW)l++;} } return n?l/n:null; };
  const wl=win([...lunDays].filter(d=>days.includes(d))), ws=win(skipped);
  const tbl=`<div class="watable" style="margin-top:.6rem"><div class="warow head"><span>${TL("lunchtijd","lunch time","hora do almoço")}</span><span>${TL("piek (med.)","peak (med.)","pico (med.)")}</span><span>${TL("laag ≤4 u","low ≤4 h","baixa ≤4 h")}</span></div>`+
    buckets.filter(b=>b.n>0).map(b=>`<div class="warow"><span>${b.lab} <span style="color:var(--dim)">· n=${b.n}</span></span><span>+${nl1(b.rise)}</span><span>${b.low==null?"—":pct0(b.low)}</span></div>`).join("")+`</div>`;
  const first=fmtMin(Math.min(...lun.map(l=>todMin(l.ts)))), last=fmtMin(Math.max(...lun.map(l=>todMin(l.ts)))), mm=fmtMin(med(lun.map(l=>todMin(l.ts))));
  const sk=TL(`Op <b>${skipped.length} van ${days.length}</b> volledige dagen is er geen lunch (≥10 g tussen 11:00 en 16:00) ingevoerd.`,`On <b>${skipped.length} of ${days.length}</b> full days no lunch (≥10 g between 11:00 and 16:00) was logged.`,`Em <b>${skipped.length} de ${days.length}</b> dias completos não foi registado almoço (≥10 g entre 11:00 e 16:00).`);
  const cmp=(wl!=null&&ws!=null&&skipped.length>=3)?`<div class="obs" style="margin-top:.4rem">${TL(`Tussen 13:00 en 16:00 zit je op dagen mét lunch ${pct0(wl)} van de tijd onder ${nl1(LOW)}, op dagen zonder ingevoerde lunch ${pct0(ws)}.`,`Between 13:00 and 16:00 you are below ${nl1(LOW)} ${pct0(wl)} of the time on days with lunch and ${pct0(ws)} on days without a logged lunch.`,`Entre as 13:00 e as 16:00 está abaixo de ${nl1(LOW)} ${pct0(wl)} do tempo nos dias com almoço e ${pct0(ws)} nos dias sem almoço registado.`)}</div>`:"";
  return `<div class="obs">${TL(`${lun.length} lunches tussen ${first} en ${last}, mediaan ${mm}.`,`${lun.length} lunches between ${first} and ${last}, median ${mm}.`,`${lun.length} almoços entre ${first} e ${last}, mediana ${mm}.`)} ${sk}</div>`+bars+tbl+cmp+
    `<div class="muted" style="margin-top:.4rem">${TL("Observatie, geen instelwaarde. Bespreek met je behandelteam wat je bij een late of overgeslagen lunch doet.","Observation, not a setting. Discuss with your care team what to do on a late or skipped lunch.","Observação, não uma definição. Discuta com a sua equipa o que fazer num almoço tardio ou omitido.")}</div>`;
}

// Maaltijden per dagdeel: legt ochtendresistentie (hoger ontbijt-piek) bloot.
function mealDayparts(results, med){
  const parts=[ {id:"ontbijt",lo:240,hi:660}, {id:"lunch",lo:660,hi:900}, {id:"diner",lo:900,hi:1320} ];
  const rows=parts.map(p=>{ const rs=results.filter(r=>r.ts!=null && todMin(r.ts)>=p.lo && todMin(r.ts)<p.hi);
    return { id:p.id, n:rs.length, rise:med(rs.map(r=>r.peakRise)), frac:med(rs.map(r=>r.frac)), t50:med(rs.filter(r=>r.t50!=null).map(r=>r.t50)) }; });
  const shown=rows.filter(r=>r.n>=3);
  if(shown.length<2) return "";   // pas zinvol bij ≥2 dagdelen met genoeg maaltijden
  const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
  const table=`<div class="watable" style="margin-top:.7rem"><div class="warow head"><span>${TL("dagdeel","part of day","período")}</span><span>${TL("piek (med.)","peak (med.)","pico (med.)")}</span><span>t50</span><span>${TL("KH-schatting","carb est.","est. HC")}</span></div>`+
    shown.map(r=>`<div class="warow"><span>${cap(mealName(r.id))} <span style="color:var(--dim)">· n=${r.n}</span></span><span>+${nl1(r.rise)}</span><span>${r.t50==null?"—":Math.round(r.t50)} min</span><span>${r.frac==null?"—":Math.round(r.frac*100)+"%"}</span></div>`).join("")+`</div><div class="muted" style="font-size:.7rem">${TL("KH-schatting = wat je glucose liet zien t.o.v. wat je invoerde (100% = klopt; &lt;80% = waarschijnlijk te hoog geschat, &gt;120% = te laag). Observatie.","Carb est. = what glucose implied vs what you entered (100% = matches; &lt;80% = likely overestimated, &gt;120% = underestimated). Observation.","Est. HC = o que a glicose indicou vs o que introduziu (100% = certo). Observação.")}</div>`;
  const withRise=shown.filter(r=>r.rise!=null).sort((a,b)=>b.rise-a.rise);
  let obs="";
  if(withRise.length>=2){ const top=withRise[0], lo=withRise[withRise.length-1];
    if(top.rise-lo.rise>=1.5) obs=`<div class="obs" style="margin-top:.4rem">${TL(`Je <b>${mealName(top.id)}</b> piekt het hoogst (+${nl1(top.rise)} mmol/L) tegen +${nl1(lo.rise)} bij ${mealName(lo.id)}${top.id==="ontbijt"?" — klassiek voor ochtendresistentie; een sterkere KH-ratio of ruimere prebolus rond het ontbijt kan schelen":""}.`,`Your <b>${mealName(top.id)}</b> peaks highest (+${nl1(top.rise)} mmol/L) vs +${nl1(lo.rise)} at ${mealName(lo.id)}${top.id==="ontbijt"?" — classic for morning resistance; a stronger carb ratio or a more generous prebolus around breakfast can help":""}.`,`O seu <b>${mealName(top.id)}</b> tem o pico mais alto (+${nl1(top.rise)} mmol/L) contra +${nl1(lo.rise)} no ${mealName(lo.id)}${top.id==="ontbijt"?" — clássico da resistência matinal; um rácio de hidratos mais forte ou um prebólus mais generoso ao pequeno-almoço pode ajudar":""}.`)}</div>`; }
  return table+obs;
}

// Stapeling-detail: HTML voor het correctie-stapelen vóór hypo's
function anStacking(glucose, treatments, q){
  const r=hypoStacking(glucose, treatments, q);
  if(r.few!=null) return `<div class="muted">${TL(`Te weinig hypo-episodes (${r.few}, minimaal 6)${r.thin?" of te weinig vergelijkbare controlemomenten":""} voor een betrouwbare vergelijking. Dat is op zich goed nieuws voor je tijd-in-bereik.`,`Too few low episodes (${r.few}, minimum 6)${r.thin?" or too few comparable control moments":""} for a reliable comparison. That's good news for your time in range.`,`Poucos episódios de hipo (${r.few}, mínimo 6)${r.thin?" ou poucos momentos de controlo comparáveis":""} para uma comparação fiável. Isso é boa notícia para o seu tempo no alvo.`)}</div>`;
  const obs=r.elevated
    ? TL(`Gestapelde correcties (≥2 handmatige bijspuiten in de 3 uur ervoor) gingen <b>${pct0(r.caseRate)}</b> van je hypo's vooraf, tegen <b>${pct0(r.ctrlRate)}</b> op vergelijkbare momenten zónder hypo. Even wachten tot een eerdere correctie is uitgewerkt vóór je opnieuw bijspuit kan dit type hypo schelen.`,`Stacked corrections (≥2 manual corrections in the 3 hours before) preceded <b>${pct0(r.caseRate)}</b> of your lows, vs <b>${pct0(r.ctrlRate)}</b> at comparable moments without a low. Waiting until an earlier correction has worn off before correcting again can help this type of low.`,`Correções acumuladas (≥2 correções manuais nas 3 horas anteriores) precederam <b>${pct0(r.caseRate)}</b> das suas hipos, contra <b>${pct0(r.ctrlRate)}</b> em momentos comparáveis sem hipo. Esperar que uma correção anterior se dissipe antes de corrigir de novo pode ajudar neste tipo de hipo.`)
    : TL(`Gestapelde correcties gingen ${pct0(r.caseRate)} van je hypo's vooraf, vergelijkbaar met ${pct0(r.ctrlRate)} op momenten zónder hypo — dit patroon springt er bij jou niet uit.`,`Stacked corrections preceded ${pct0(r.caseRate)} of your lows, similar to ${pct0(r.ctrlRate)} at moments without a low — this pattern doesn't stand out for you.`,`Correções acumuladas precederam ${pct0(r.caseRate)} das suas hipos, semelhante a ${pct0(r.ctrlRate)} em momentos sem hipo — este padrão não se destaca em si.`);
  return `<div class="obs">${obs}</div><div class="muted" style="margin-top:.4rem">${TL(`n = ${r.cases} hypo's vs ${r.controls} controlemomenten (zelfde tijdstip, andere dagen). Observatie, geen instelwaarde.`,`n = ${r.cases} lows vs ${r.controls} control moments (same time, other days). Observation, not a setting.`,`n = ${r.cases} hipos vs ${r.controls} momentos de controlo (mesma hora, outros dias). Observação, não um parâmetro.`)}</div>`;
}

// "Wat-als" nachtbasaal: eerste-orde contrafeitelijke simulatie. Neem je schone
// (maaltijd-/bolusvrije) nachten 00:00–06:00 en reken door wat een structureel
// andere basaal met je glucose gedaan zou hebben — extra basaal × ISF, steady-state.
// Tegenregulatie is níét gemodelleerd; onder ~3,9 dus alleen "risico neemt toe".
function nightSim(glucose, treatments, q, timeline, oi, MULT=[0.9,0.95,1.0,1.05,1.1]){
  if(!timeline) return { noprof:true };
  const CLEAN=3*3600e3;
  const events=treatments.filter(t=>t.carbs>0||t.insulin>0).map(t=>t.ts).sort((a,b)=>a-b);
  const g=glucose.filter(x=>q.usableKeys.has(localDayKey(x.ts)));
  const byNight=new Map(); let ei=0;
  for(let i=0;i<g.length;i++){ const t=g[i].ts;
    while(ei<events.length&&events[ei]<=t)ei++;
    if(todMin(t)>=360) continue;                          // alleen 00:00–06:00
    if(t-(ei>0?events[ei-1]:-Infinity)<CLEAN) continue;   // maaltijd-/bolusvrij
    const k=localDayKey(t); if(!byNight.has(k))byNight.set(k,[]); byNight.get(k).push(g[i]); }
  const segs=[...byNight.values()].filter(seg=>seg.length>=12);   // ≥ ~1 uur data
  // Basaal/ISF zijn 's nachts vrijwel constant — bemonster het profiel 3× per nacht
  // (start/mid/eind) en middel, i.p.v. profileAt per stap (dat is traag door Intl).
  // Gevoeligheid: de gemeten ISF als die betrouwbaar is (zelfde bron als de
  // correctie-simulatie), anders de profiel-ISF — nooit twee bronnen door elkaar.
  const useObs = !!(oi && oi.obs>0.5);
  const nights=[]; for(const seg of segs){
    const pk=[seg[0],seg[seg.length>>1],seg[seg.length-1]].map(x=>profileAt(timeline,x.ts)).filter(p=>p&&p.basal!=null&&p.isf);
    if(!pk.length) continue;
    nights.push({ seg, isf:useObs?oi.obs:pk.reduce((s,p)=>s+p.isf,0)/pk.length, basal:pk.reduce((s,p)=>s+p.basal,0)/pk.length }); }
  if(nights.length<5) return { few:nights.length };
  const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:null;};
  const res=MULT.map(m=>{ let lows=0; const ends=[];
    for(const {seg,isf,basal} of nights){ let adj=0, minbg=Infinity, endbg=null;
      for(let i=0;i<seg.length;i++){
        if(i>0){ const dtMin=(seg[i].ts-seg[i-1].ts)/60000; if(dtMin>0&&dtMin<=20) adj += -isf*(m-1)*basal*(dtMin/60); }
        const cf=seg[i].bg+adj; if(cf<minbg)minbg=cf; endbg=cf; }
      ends.push(endbg); if(minbg<3.9)lows++; }
    return { m, endMed:med(ends), lowNights:lows, nights:ends.length }; });
  return { nights:nights.length, res, src:useObs?`gemeten ISF ~${oi.obs.toFixed(1)}`:"profiel-ISF" };
}
// Maaltijdinsuline-simulatie (≈ je KH-ratio-hefboom): schaal je maaltijdbolus en
// reken de contrafeitelijke maaltijdpiek door. Eerste-orde model: extra insuline ×
// ISF via de activiteitscurve, timing constant gehouden. Alleen je HANDMATIGE bolus
// wordt geschaald — SMB's zijn de loop die reageert, geen KH-ratio-hefboom. Gebruikt
// door Bespreekwaarden.
function mealSim(MR, oi, MULT=[0.9,0.95,1.0,1.05,1.1], minN=MEAL_MIN){
  const rs=(MR.results||[]).filter(r=>r.win&&r.wB&&r.wB.length&&r.isf&&r.dia);
  if(rs.length<minN) return { few:rs.length };
  const useObs = !!(oi && oi.obs>0.5);
  const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:null;};
  const res=MULT.map(k=>{ const rises=[]; let lows=0;
    for(const r of rs){ const mdl=insulinModel(PEAK_MIN,r.dia); let peak=-Infinity, minb=Infinity;
      for(const p of r.win){ let extra=0;
        for(const b of r.wB){ if(b.isSMB)continue; const dm=(p.ts-b.ts)/60000; if(dm<=0||dm>=r.dia)continue; extra += b.insulin*(k-1)*(1-mdl.iob(dm)); }
        const cf=p.bg - (useObs?oi.obs:r.isf)*extra; if(cf>peak)peak=cf; if(cf<minb)minb=cf; }
      rises.push(peak-r.bg0); if(minb<3.9)lows++; }
    return { k, riseMed:med(rises), lowFrac:lows/rs.length, n:rs.length }; });
  return { n:rs.length, res, src:useObs?`gemeten ISF ~${oi.obs.toFixed(1)}`:"profiel-ISF" };
}
// Correctie-insuline-simulatie (≈ je ISF-hefboom): schaal je koolhydraatvrije
// correcties en reken door waar ze zouden uitkomen. Gebruikt je gemeten daling
// per E (waargenomen ISF) als sensitiviteit. Gebruikt door Bespreekwaarden.
function correctionSim(oi, MULT=[0.9,0.95,1.0,1.05,1.1], minN=8){
  if(!oi || !oi.evRaw || oi.evRaw.length<minN || oi.obs==null || oi.obs<=0.5) return { few: oi?oi.n:0 };
  const realISF=oi.obs;
  const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:null;};
  const res=MULT.map(k=>{ const ends=[]; let lows=0;
    for(const e of oi.evRaw){ const mdl=insulinModel(PEAK_MIN,e.dia); const cfs=[];
      for(const p of e.win){ const dm=(p.ts-e.ts)/60000; const extra=(dm>0&&dm<e.dia)?e.u*(k-1)*(1-mdl.iob(dm)):0; cfs.push(p.bg - realISF*extra); }
      const tail=cfs.slice(-3); ends.push(tail.reduce((s,v)=>s+v,0)/tail.length); if(Math.min(...cfs)<3.9)lows++; }
    return { k, endMed:med(ends), lowFrac:lows/oi.evRaw.length, n:oi.evRaw.length }; });
  return { n:oi.evRaw.length, realISF, res };
}
// ── Bespreekwaarden ─────────────────────────────────────────────────────────
// De hefbomen uit de fine-tune-lezing, maar concreet: per hefboom een huidige
// waarde en één of twee kandidaten — een behoudende halve stap én de volledige
// gemeten waarde — elk met het dóórgerekende effect (de correctie-/nacht-/
// maaltijd-simulaties) en een hypo-risicovlag. Het blijven bespreekpunten voor je team;
// niets hiervan is een instel- of pompopdracht. De veiligheidsregel: een
// kandidaat die méér insuline betekent (hoger basaal, sterkere KH-ratio, lagere
// ISF) krijgt een waarschuwing zodra de simulatie meer laagtes laat zien.
const _pR1=x=>Math.round(x*10)/10, _pR05=x=>Math.round(x*20)/20, _pR5g=x=>Math.round(x*2)/2;
const _pClamp=(x,a,b)=>Math.min(Math.max(a,x),Math.min(b,Math.max(a,b)));
const _pMed=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:null;};
const _pMean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const _pSd=v=>(v>0?"+":v<0?"−":"")+nl1(Math.abs(v));       // getekende drift
const P_RISK=0.03;                                          // 3 procentpunt extra laag = risicovlag

// ISF-kandidaten voor één set correcties (hele dag of één dagdeel).
function isfCands(sub){
  const P=sub.prof, M=sub.obs; if(P==null||M==null||M<=0.5) return null;
  const ratio=M/P; if(ratio<=1.25 && ratio>=0.8) return null;
  const beh=_pR1(_pClamp(P+0.5*(M-P), P*0.8, P*1.2)), vol=_pR1(M);
  const seen=new Set(), cands=[];
  for(const [tag,C] of [["behoudend",beh],["gemeten",vol]]){
    if(C===P || seen.has(C)) continue; seen.add(C);
    const k=P/C, sim=correctionSim({obs:M,evRaw:sub.evRaw,n:sub.n},[1,k],5); let eff=TL("niet apart doorgerekend","not computed separately","não calculado à parte"), risky=false;
    if(!sim.few){ const cur=sim.res.find(x=>x.k===1), c=sim.res.find(x=>x.k!==1);
      eff=TL(`correcties eindigen ${nl1(cur.endMed)} → ${nl1(c.endMed)} · te laag ${pct0(cur.lowFrac)} → ${pct0(c.lowFrac)}`,`corrections end ${nl1(cur.endMed)} → ${nl1(c.endMed)} · too low ${pct0(cur.lowFrac)} → ${pct0(c.lowFrac)}`,`correções terminam ${nl1(cur.endMed)} → ${nl1(c.endMed)} · demasiado baixo ${pct0(cur.lowFrac)} → ${pct0(c.lowFrac)}`);
      risky = k>1 && c.lowFrac>cur.lowFrac+P_RISK; }
    cands.push({tag, from:nl1(P), to:nl1(C), eff, risky, dir:C>P?TL("loop spuit iets minder bij","loop corrects a bit less","o loop corrige um pouco menos"):TL("loop spuit iets meer bij","loop corrects a bit more","o loop corrige um pouco mais")}); }
  return cands.length?{cands, meta:`n=${sub.n} · IQR ${nl1(sub.q25)}–${nl1(sub.q75)}`}:null;
}

/* ── Fase 3: vangrails op voorstellen ───────────────────────────────────────
   Laagtes eerst. Een voorstel dat meer insuline betekent wordt geblokkeerd in een
   dagdeel met >4% <3,9 of ≥1% <3,0; <14 dekkende dagen = "onduidelijk"; één wijziging
   per dagdeel tegelijk (basaal → KH → ISF); grote stappen (>10%) krijgen een waarschuwing. */
const _num=x=>parseFloat(String(x).replace(",","."));
function guardrailStats(glucose, q){
  const g=glucose.filter(x=>q.usableKeys.has(localDayKey(x.ts))), out={};
  const sets=[...DAYPARTS.map(d=>[d.key,d.lo,d.hi]),["alle",0,1440]];
  for(const [k,lo,hi] of sets){ const a=g.filter(x=>{const m=todMin(x.ts);return m>=lo&&m<hi;});
    out[k]={ n:a.length, days:new Set(a.map(x=>localDayKey(x.ts))).size,
      tbr:a.length?a.filter(x=>x.bg<3.9).length/a.length:0, vlow:a.length?a.filter(x=>x.bg<3.0).length/a.length:0 }; }
  return out;
}
function applyGuardrails(items, glucose, q){
  const st=guardrailStats(glucose,q), ORDER={basaal:0,ic:1,isf:2}, taken=new Set();
  const more=(key,c)=>{ const f=_num(c.from), t=_num(c.to); return key==="basaal"? t>f : t<f; };   // basaal omhoog / ISF·KH-ratio omlaag = méér insuline
  for(const it of [...items].sort((a,b)=>(ORDER[a.key]??9)-(ORDER[b.key]??9))){
    for(const r of it.rows||[]){ const S=st[r.dpKey]||st.alle, gl=(r.pre||[]).slice();
      const raises=r.cands.some(c=>more(it.key,c));
      if(S.days<14) gl.push({lvl:"unclear", msg:TL(`Onduidelijk: slechts ${S.days} dekkende dagen (min. 14).`,`Unclear: only ${S.days} covered days (min. 14).`,`Pouco claro: apenas ${S.days} dias cobertos (mín. 14).`)});
      if(raises && (S.tbr>0.04 || S.vlow>=0.01)) gl.push({lvl:"block", msg:TL(`Geblokkeerd: meer insuline terwijl je in dit dagdeel al ${pct0(S.tbr)} onder 3,9 zit${S.vlow>=0.01?` en ${pct0(S.vlow)} onder 3,0`:""}. Eerst de laagtes bespreken.`,`Blocked: more insulin while you already spend ${pct0(S.tbr)} below 3.9 in this part of day${S.vlow>=0.01?` and ${pct0(S.vlow)} below 3.0`:""}. Discuss the lows first.`,`Bloqueado: mais insulina quando já passa ${pct0(S.tbr)} abaixo de 3,9 neste período. Discuta primeiro as hipos.`)});
      const gem=r.cands.find(c=>c.tag==="gemeten")||r.cands[0];
      if(gem){ const f=_num(gem.from), t=_num(gem.to); if(f>0 && Math.abs(t-f)/f>0.10) gl.push({lvl:"warn", msg:TL("Stap >10%: overweeg in twee stappen, of kies de behoudende waarde.","Step >10%: consider two steps, or take the conservative value.","Passo >10%: considere dois passos ou o valor conservador.")}); }
      if(raises===false && false){}
      if(taken.has(r.dpKey) && r.dpKey!=="alle") gl.push({lvl:"queue", msg:TL("Wacht: er loopt al een voorstel voor dit dagdeel. Eén wijziging tegelijk, dan weet je wat werkte.","Wait: another proposal for this part of day comes first. One change at a time, so you know what worked.","Aguarde: já existe outra proposta para este período. Uma alteração de cada vez.")});
      else if(!gl.some(x=>x.lvl==="block"||x.lvl==="unclear")) taken.add(r.dpKey);
      r.gr=gl; r.blocked=gl.some(x=>x.lvl==="block"), r.unclear=gl.some(x=>x.lvl==="unclear"), r.queued=gl.some(x=>x.lvl==="queue");
      if(it.grid && it.grid[r.dpKey]){ const G=it.grid[r.dpKey]; if(r.blocked) G.blocked=true; else if(r.unclear) G.unclear=true; else if(gl.some(x=>x.carb)) G.warn=true; } }
  }
  return items;
}
function proposalEngine(drift, oi, MR, pi, glucose, treatments, q, timeline){
  const items=[];
  const isfRef = (oi&&oi.obs>0.5)?oi.obs : (pi.isf&&pi.isf.length?_pMed(pi.isf.map(b=>b.value)):null);

  // 1 — ISF · correctiefactor, per dagdeel. Elk dagdeel krijgt een status:
  // change (bespreekwaarde) · ok (gemeten sluit aan) · weinig (te weinig data).
  { const rows=[], grid={};
    for(const d of DAYPARTS){ const sub=oi&&oi.byDP&&oi.byDP[d.key];
      if(!sub || sub.n<5 || sub.obs==null || sub.prof==null){ grid[d.key]={status:"weinig", n:sub?sub.n:0}; continue; }
      const r=isfCands(sub);
      if(r){ rows.push({label:dpLabel(d.key), dpKey:d.key, meta:r.meta, cands:r.cands});
        const beh=r.cands.find(c=>c.tag==="behoudend"), gem=r.cands.find(c=>c.tag==="gemeten"), any=beh||gem;
        grid[d.key]={status:"change", from:any.from, to:(beh&&gem&&beh.to!==gem.to)?`${beh.to}–${gem.to}`:(gem?gem.to:beh.to), risky:(beh&&beh.risky)||(gem&&gem.risky)}; }
      else grid[d.key]={status:"ok", n:sub.n}; }
    let allRow=null;
    if(!rows.length && oi && oi.n>=8){ const r=isfCands(oi); if(r){ allRow={cands:r.cands, meta:r.meta}; rows.push({label:TL("hele dag","whole day","dia inteiro"), dpKey:"alle", meta:r.meta, cands:r.cands}); } }
    if(rows.length || Object.values(grid).some(g=>g.status!=="weinig"))
      items.push({ key:"isf", title:TL("ISF · correctiefactor","ISF · correction factor","ISF · fator de correção"), unit:TL("mmol/L per E","mmol/L per U","mmol/L por U"), rows, grid, allRow,
        why:TL(`Hoeveel 1 eenheid je écht liet dalen, naast wat je profiel aanneemt. Verschilt per dagdeel: 's ochtends ben je vaak minder gevoelig.`,`How much 1 unit really lowered you, next to what your profile assumes. Varies by part of day: in the morning you're often less sensitive.`,`Quanto 1 unidade realmente o baixou, face ao que o perfil assume. Varia por período do dia: de manhã é muitas vezes menos sensível.`) }); }

  // 2 — Basaal per dagdeel. Bij een closed loop lezen we wat de lóóp werkelijk
  // leverde (temp-basaal vs. profiel) — die data is er wél; anders de nuchtere drift.
  { const lb=loopBasal(treatments, timeline, q), lbHours=(lb&&lb.hours)?lb.hours:null;
    const rows=[], grid={}; let source=null;
    for(const d of DAYPARTS){
      // A — loop-basaal (voorkeur bij een loop): wat je loop echt leverde vs. profiel
      if(lbHours){ const hrs=lbHours.filter(x=>x.act!=null && x.h>=d.lo/60 && x.h<d.hi/60);
        if(hrs.length>=2){ source=source||"loop";
          const actTot=_pMean(hrs.map(x=>x.act)), actTmp=_pMean(hrs.map(x=>x.temp!=null?x.temp:x.act)), prof=_pMean(hrs.map(x=>x.prof));
          // Temp-basaal alléén en temp-basaal + SMB moeten dezelfde kant op wijzen; anders compenseert de loop
          // (minder temp, meer SMB — bv. voor niet-gelogd eten) en is "profiel te hoog/laag" geen veilige conclusie.
          const mixed = prof>0.05 && Math.abs(actTmp-prof)/prof>=0.15 && Math.abs(actTot-prof)/prof>=0.15 && Math.sign(actTmp-prof)!==Math.sign(actTot-prof);
          if(mixed){ grid[d.key]={status:"mixed", temp:nl2(actTmp), tot:nl2(actTot), prof:nl2(prof)}; continue; }
          const act = Math.abs(actTmp-prof)<Math.abs(actTot-prof) ? actTmp : actTot;   // behoudend: de kleinste afwijking
          if(prof>0.05){ const dev=(act-prof)/prof;
            if(Math.abs(dev)>=0.15){ const up=act>prof, seen=new Set(), cands=[];
              for(const [tag,frac] of [["behoudend",0.5],["gemeten",1.0]]){
                const C=_pR05(prof+(act-prof)*frac); if(C===_pR05(prof)||C<0||seen.has(C)) continue; seen.add(C);
                cands.push({tag, from:nl2(prof), to:nl2(C), risky:false,
                  eff:TL(`loop leverde gem. ${nl2(act)} vs profiel ${nl2(prof)} E/u`,`loop delivered avg. ${nl2(act)} vs profile ${nl2(prof)} U/h`,`loop entregou méd. ${nl2(act)} vs perfil ${nl2(prof)} U/h`),
                  dir:up?TL("loop levert méér — profiel mogelijk te laag","loop delivers more — profile possibly too low","loop entrega mais — perfil possivelmente baixo"):TL("loop levert minder — mogelijk te hoog","loop delivers less — possibly too high","loop entrega menos — possivelmente alto")}); }
              if(cands.length){ rows.push({label:dpLabel(d.key), dpKey:d.key, meta:TL(`loop vs profiel · ${hrs.reduce((s,x)=>s+x.n,0).toLocaleString(LOCALE())} metingen`,`loop vs profile · ${hrs.reduce((s,x)=>s+x.n,0).toLocaleString(LOCALE())} readings`,`loop vs perfil · ${hrs.reduce((s,x)=>s+x.n,0).toLocaleString(LOCALE())} medições`), cands});
                const beh=cands.find(c=>c.tag==="behoudend"), gem=cands.find(c=>c.tag==="gemeten"), any=beh||gem;
                grid[d.key]={status:"change", from:any.from, to:(beh&&gem&&beh.to!==gem.to)?`${beh.to}–${gem.to}`:(gem?gem.to:beh.to), risky:false}; continue; } }
            grid[d.key]={status:"ok"}; continue; } } }
      // B — nuchtere drift (val terug voor niet-loopers)
      if(drift && drift.stat && isfRef){ const hrs=drift.stat.filter(s=>s.h>=d.lo/60 && s.h<d.hi/60 && s.med!=null);
        if(hrs.length<2){ grid[d.key]={status:"weinig"}; continue; }
        const agg=_pMed(hrs.map(s=>s.med));
        if(Math.abs(agg)<drift.TH){ grid[d.key]={status:"ok"}; continue; }
        const blk=(pi.basal||[]).find(b=>d.mid>=b.from&&d.mid<b.to)||(pi.basal||[])[0]; if(!blk){ grid[d.key]={status:"weinig"}; continue; }
        const cb=blk.value, up=agg>0, sign=up?1:-1, dB=Math.abs(agg)/isfRef, seen=new Set(), cands=[]; source=source||"drift";
        for(const [tag,frac] of [["behoudend",0.5],["gemeten",1.0]]){
          const C=_pR05(cb+sign*dB*frac); if(C===_pR05(cb)||C<0||seen.has(C)) continue; seen.add(C);
          const proj=agg*(1-frac);
          cands.push({tag, from:nl2(cb), to:nl2(C), risky:false,
            eff:TL(`nuchtere drift ${_pSd(agg)} → ${_pSd(proj)} mmol/L/u`,`fasting drift ${_pSd(agg)} → ${_pSd(proj)} mmol/L/h`,`deriva em jejum ${_pSd(agg)} → ${_pSd(proj)} mmol/L/h`),
            dir:up?TL("hoger basaal (meer insuline)","higher basal (more insulin)","basal mais alta (mais insulina)"):TL("lager basaal (minder insuline)","lower basal (less insulin)","basal mais baixa (menos insulina)")}); }
        if(cands.length){ rows.push({label:dpLabel(d.key), dpKey:d.key, meta:TL(`stille vensters · drift ${_pSd(agg)} mmol/L/u`,`quiet windows · drift ${_pSd(agg)} mmol/L/h`,`janelas calmas · deriva ${_pSd(agg)} mmol/L/h`), cands});
          const beh=cands.find(c=>c.tag==="behoudend"), gem=cands.find(c=>c.tag==="gemeten"), any=beh||gem;
          grid[d.key]={status:"change", from:any.from, to:(beh&&gem&&beh.to!==gem.to)?`${beh.to}–${gem.to}`:(gem?gem.to:beh.to), risky:false}; }
        else grid[d.key]={status:"ok"}; }
      else grid[d.key]={status:"weinig"};
    }
    if(rows.length || Object.values(grid).some(g=>g.status!=="weinig"))
      items.push({ key:"basaal", title:TL("Basaal","Basal","Basal"), unit:TL("E/u","U/h","U/h"), rows, grid,
        why: source==="loop"
          ? TL(`Wat je loop werkelijk leverde (temp-basaal + SMB) naast je profiel-basaal, per dagdeel. Levert de loop structureel méér/minder, dan staat je profiel daar mogelijk te laag/hoog. Maaltijduren zijn eruit gefilterd.`,`What your loop actually delivered (temp basal) next to your profile basal, per part of day. If the loop structurally delivers more/less, your profile may be too low/high there. Meal hours are filtered out.`,`O que o seu loop realmente entregou (basal temporária) face à basal do perfil, por período do dia. Se o loop entrega estruturalmente mais/menos, o seu perfil pode estar baixo/alto aí. As horas de refeição são filtradas.`)
          : TL(`In maaltijd- en bolusvrije uren hoort je glucose vlak te lopen. Waar je toch wegdrijft, wijst dat op te veel of te weinig basaal — per dagdeel.`,`In meal- and bolus-free hours your glucose should run flat. Where you drift anyway points to too much or too little basal — per part of day.`,`Em horas sem refeição e sem bólus a sua glicose deve correr plana. Onde deriva mesmo assim aponta para basal a mais ou a menos — por período do dia.`) }); }

  // 3 — KH-ratio per maaltijdmoment (ontbijt/lunch/diner). Te hoge piek = onderdekking;
  // lager getal g/E = sterkere ratio = meer maaltijdinsuline.
  if(MR && MR.results && MR.results.length>=MEAL_MIN && pi.ic && pi.ic.length){
    const parts=[{id:"ontbijt",lo:240,hi:660,mid:450,dp:"ochtend"},{id:"lunch",lo:660,hi:900,mid:780,dp:"middag"},{id:"diner",lo:900,hi:1320,mid:1110,dp:"avond"}];
    const rows=[], grid={nacht:{status:"weinig"}};
    for(const p of parts){ const rs=MR.results.filter(r=>r.ts!=null && todMin(r.ts)>=p.lo && todMin(r.ts)<p.hi);
      if(rs.length<MEAL_MIN){ grid[p.dp]={status:"weinig", n:rs.length}; continue; }
      const rise=_pMed(rs.map(r=>r.peakRise));
      const frM=_pMed(rs.map(r=>r.frac));
      const blk=(pi.ic||[]).find(b=>p.mid>=b.from&&p.mid<b.to)||(pi.ic||[])[0];
      if(rise==null||rise<2.5||!blk){ grid[p.dp]={status:"ok", n:rs.length}; continue; }
      const cic=blk.value, sim=mealSim({results:rs},oi,[1.0,1.05,1.10],MEAL_MIN), seen=new Set(), cands=[];
      for(const [tag,m] of [["behoudend",1.05],["gemeten",1.10]]){
        const C=_pR5g(cic/m); if(C===_pR5g(cic)||seen.has(C)) continue; seen.add(C);
        let eff=TL("niet apart doorgerekend","not computed separately","não calculado à parte"), risky=false;
        if(!sim.few){ const cur=sim.res.find(x=>x.k===1), c=sim.res.find(x=>x.k===m);
          if(cur&&c){ eff=TL(`piek +${nl1(cur.riseMed)} → +${nl1(c.riseMed)} · eindigt laag ${pct0(cur.lowFrac)} → ${pct0(c.lowFrac)}`,`peak +${nl1(cur.riseMed)} → +${nl1(c.riseMed)} · ends low ${pct0(cur.lowFrac)} → ${pct0(c.lowFrac)}`,`pico +${nl1(cur.riseMed)} → +${nl1(c.riseMed)} · termina baixo ${pct0(cur.lowFrac)} → ${pct0(c.lowFrac)}`);
            risky = c.lowFrac>cur.lowFrac+P_RISK; } }
        cands.push({tag, from:nl1(cic), to:nl1(C), eff, risky, dir:TL("sterker (meer maaltijdinsuline)","stronger (more meal insulin)","mais forte (mais insulina de refeição)")}); }
      if(cands.length){ rows.push({label:mealName(p.id), dpKey:p.dp, meta:TL(`n=${rs.length} maaltijden · piek +${nl1(rise)}`,`n=${rs.length} meals · peak +${nl1(rise)}`,`n=${rs.length} refeições · pico +${nl1(rise)}`), cands, pre:(frM!=null&&frM>=1.25)?[{lvl:"warn", carb:1, msg:TL(`Je glucose laat ~${Math.round(frM*100)}% zien van de koolhydraten die je invoerde. Controleer eerst je invoer/schatting: een sterkere ratio compenseert onderschatting en kan hypo's geven.`,`Your glucose implies ~${Math.round(frM*100)}% of the carbs you entered. Check your estimates first: a stronger ratio compensates underestimation and can cause lows.`,`A glicose indica ~${Math.round(frM*100)}% dos hidratos introduzidos. Verifique primeiro as estimativas.`)}]:[]});
        const beh=cands.find(c=>c.tag==="behoudend"), gem=cands.find(c=>c.tag==="gemeten"), any=beh||gem;
        grid[p.dp]={status:"change", from:any.from, to:(beh&&gem&&beh.to!==gem.to)?`${beh.to}–${gem.to}`:(gem?gem.to:beh.to), risky:(beh&&beh.risky)||(gem&&gem.risky)}; }
      else grid[p.dp]={status:"ok", n:rs.length}; }
    if(rows.length || Object.values(grid).some(g=>g.status!=="weinig")){ const timingNote = (MR.moffset!=null && MR.moffset>-5) ? TL(" Let op: je bolust laat — een vroegere prebolus dempt de piek zónder meer insuline (zie Maaltijdrespons)."," Note: you bolus late — an earlier prebolus dampens the peak without more insulin (see Meal response)."," Nota: bolusa tarde — um prebólus mais cedo reduz o pico sem mais insulina (ver Resposta às refeições).") : "";
      items.push({ key:"ic", title:TL("KH-ratio","Carb ratio","Rácio de hidratos"), unit:TL("g per E","g per U","g por U"), rows, grid,
        why:TL(`Waar je maaltijdpiek structureel te hoog is, schiet de dekking tekort — vaak juist bij het ontbijt.${timingNote}`,`Where your meal peak is structurally too high, coverage falls short — often exactly at breakfast.${timingNote}`,`Onde o seu pico de refeição está estruturalmente alto, a cobertura é insuficiente — muitas vezes precisamente ao pequeno-almoço.${timingNote}`) }); }
  }

  return applyGuardrails(items, glucose, q);
}

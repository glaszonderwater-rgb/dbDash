"use strict";
/* IDA 2.0 — de assistent-schermen: Vandaag, Patronen-tegels, Eten-kop, Team-kop,
   het AAPS-profiel en Snel loggen. Klassiek script; gebruikt de globale functies
   uit js/core.js en index.html. Rekent zelf niets zwaars behalve aapsProfile(). */

let _penKeys = new Set();
let _P = null, _idaAnns = [], _profTab = "basal", _qlSel = null, _qlWhen = 0, _qlDur = 60;
const _idaN = (v,d=1) => (v==null||!isFinite(v)) ? "—" : v.toFixed(d).replace(".", DECSEP());
const _idaPct = v => (v==null||!isFinite(v)) ? "—" : Math.round(v*100)+"%";
const _idaEl = id => document.getElementById(id);

async function renderIda(keep){
  const c=_ctx; if(!c||!c.glucose||!c.glucose.length) return;
  if(!keep || !_idaAnns.length){ try{ _idaAnns = await DB.all("annotations"); }catch(_){ _idaAnns=[]; } }
  if(!keep || !_P){ try{ _P = aapsProfile(c.glucose, c.treatments, c.timeline, c.q, _dsAll); }catch(e){ console.error(e); _P=null; } }
  for(const f of [idaVandaag, idaPatronen, idaEten, idaTeam, idaProfiel]){ try{ f(c); }catch(e){ console.error(e); } }
  try{ if(typeof idaExtras==="function") idaExtras(c); }catch(e){ console.error(e); }
}

/* ── Vandaag ─────────────────────────────────────────────────────────────── */
function _heroColor(bg){ return bg<LO_T ? "#FF9E97" : bg>HI_T ? "#F2B455" : "#7FD1C8"; }
function unloggedRise(glucose, treatments){
  const end=glucose[glucose.length-1].ts, from=end-24*3600e3;
  // Gelogd eten telt tot 2 uur vóór de stijging mee: jouw maaltijden worden traag opgenomen
  // (de stijging begint soms pas een uur na het eten). Ook als AAPS nog koolhydraten aan boord ziet (COB) is het geen "ongelogd eten".
  const g=glucose.filter(x=>x.ts>=from), carbs=treatments.filter(t=>t.carbs>0&&t.ts>=from-5*3600e3).map(t=>t.ts);
  const ds=(typeof _dsAll!=="undefined"&&_dsAll)||[];
  const cobAt=ts=>{ let best=null; for(const d of ds){ if(d.cob==null||Math.abs(d.ts-ts)>10*60e3) continue; if(!best||Math.abs(d.ts-ts)<Math.abs(best.ts-ts)) best=d; } return best?best.cob:null; };
  let best=null;
  for(let i=0;i<g.length;i++){ for(let j=i+1;j<g.length&&g[j].ts-g[i].ts<=60*60e3;j++){
    const rise=g[j].bg-g[i].bg;
    if(rise>=3 && !carbs.some(c=>c>g[i].ts-2*3600e3 && c<g[j].ts) && (!best||rise>best.rise)) best={rise, t0:g[i].ts, t1:g[j].ts, b0:g[i].bg, b1:g[j].bg}; } }
  if(best){ const cb=cobAt(best.t0); if(cb!=null&&cb>=5) return null; }
  return best;
}
/* Schatting van de gemiste koolhydraten: de stijging zelf (gedeeld door wat 1 g bij jou doet: ISF ÷ KH-ratio)
   plus wat de loop er al tegenaan gaf (SMB's/bolussen tijdens en tot 1 uur na de stijging × KH-ratio).
   Afgerond op 5 g. Zonder profiel: geen schatting. */
function riseCarbEstimate(c, r){
  try{
    const p=profileAt(c.timeline, r.t0); if(!p||!(p.isf>0)||!(p.ic>0)) return null;
    const csf=p.isf/p.ic;                                         // mmol/L per gram
    const ins=c.treatments.filter(t=>t.insulin>0&&t.ts>=r.t0&&t.ts<=r.t1+3600e3).reduce((a,t)=>a+t.insulin,0);
    const g=r.rise/csf + ins*p.ic;
    return { grams:Math.min(150,Math.max(5,Math.round(g/5)*5)), fromRise:r.rise/csf, fromIns:ins*p.ic, ins, isf:p.isf, ic:p.ic };
  }catch(_){ return null; }
}
function idaVandaag(c){
  const g=c.glucose, last=g[g.length-1], age=Math.round((Date.now()-last.ts)/60000);
  _idaEl("idaDate").textContent = new Date().toLocaleDateString(LOCALE(),{weekday:"long",day:"numeric",month:"long"}).replace(/^./,m=>m.toUpperCase());
  const v=_idaEl("idaVal"); v.textContent=_idaN(last.bg); v.style.color=_heroColor(last.bg);
  const a=_idaEl("idaArrow"); a.textContent=ARROWS[last.dir]||""; a.style.color=_heroColor(last.bg);
  const ds=[..._dsRecent].reverse().find(d=>d.ev!=null && Math.abs(d.ts-last.ts)<20*60e3);
  _idaEl("idaPred").textContent = ds ? _idaN(ds.ev) : "—";
  _idaEl("idaPredBox").hidden = !ds;
  const iob=[..._dsRecent].reverse().find(d=>d.iob!=null && Date.now()-d.ts<20*60e3);
  const ageTxt = age<1 ? TL("zojuist","just now","agora") : age<90 ? TL(`${age} min geleden`,`${age} min ago`,`há ${age} min`) : TL(`${Math.round(age/60)} uur geleden`,`${Math.round(age/60)} h ago`,`há ${Math.round(age/60)} h`);
  _idaEl("idaMeta").textContent = `mmol/L · ${ageTxt}` + (iob ? ` · IOB ${_idaN(iob.iob)} ${TL("E","U","U")}` : "");
  _idaEl("idaHero").hidden=false;

  // Wat ik zie: assistent-kaarten
  const cards=[];
  const act=_idaActivation();
  if(_P && _P.basal && _P.changed && !(act && Date.now()-act.ts<7*864e5)){
    const up=_P.dayNew>_P.dayNow+0.3, nightUp=_P.basal[0]&&_P.basal[0].value>(_P.basal[0].now[0]||0);
    const lowBlk=_P.basal.find(b=>b.why==="laag");
    let msg = TL("Je nieuwe profiel staat klaar.","Your new profile is ready.","O seu novo perfil está pronto.");
    const parts=[];
    if(nightUp) parts.push(TL("meer basaal 's nachts","more basal at night","mais basal à noite"));
    if(lowBlk) parts.push(TL(`minder vanaf ${lowBlk.from}`,`less from ${lowBlk.from}`,`menos a partir das ${lowBlk.from}`));
    const icCh=_P.ic.find(b=>Math.abs(b.value-b.now)>=0.1);
    if(icCh) parts.push(TL(`KH-ratio ${_idaN(icCh.value)} vanaf ${icCh.from}`,`carb ratio ${_idaN(icCh.value)} from ${icCh.from}`,`rácio ${_idaN(icCh.value)} a partir das ${icCh.from}`));
    const sub = parts.length ? parts.join(", ").replace(/^./,m=>m.toUpperCase())+"." : (up?TL("Meer basaal.","More basal.","Mais basal."):"");
    cards.push(`<article class="icard"><div class="icrow"><span class="icic t">${_idaIcon("trend")}</span><span class="ictxt"><b>${msg}</b> ${sub}</span></div>
      <div class="icacts"><button class="ibtn acc" data-ida="profiel">${TL("Bekijk profiel","View profile","Ver perfil")}</button><button class="ibtn" data-idaask="profiel">${TL("Leg uit","Explain","Explicar")}</button></div></article>`);
  }
  const r=unloggedRise(g, c.treatments);
  if(r && !_idaAnns.some(x=>x.id==="rise-"+r.t0)){
    const est=riseCarbEstimate(c, r);
    const hm=ts=>fmtMin(todMin(ts));
    cards.push(`<article class="icard" id="riseCard"><div class="icrow"><span class="icic p">${_idaIcon("food")}</span><span class="ictxt"><b>${TL("Heb je iets gegeten?","Did you eat something?","Comeu alguma coisa?")}</b> ${TL(`Tussen ${hm(r.t0)} en ${hm(r.t1)} steeg je van ${_idaN(r.b0)} naar ${_idaN(r.b1)}, zonder gelogde koolhydraten.`,`Between ${hm(r.t0)} and ${hm(r.t1)} you rose from ${_idaN(r.b0)} to ${_idaN(r.b1)} without logged carbs.`,`Entre ${hm(r.t0)} e ${hm(r.t1)} subiu de ${_idaN(r.b0)} para ${_idaN(r.b1)} sem hidratos registados.`)}</span></div>
      <div class="icacts" id="riseActs">${est?`<button class="ibtn" data-rise="${est.grams}" data-t="${r.t0}" title="${TL(`Geschat: stijging ${_idaN(r.rise)} ÷ (ISF ${_idaN(est.isf)} ÷ KH ${_idaN(est.ic)}) + ${_idaN(est.ins)} E van de loop × ${_idaN(est.ic)}`,`Estimate from rise and loop insulin`,`Estimativa pela subida e insulina do loop`)}">${TL(`Ja, ~${est.grams} g`,`Yes, ~${est.grams} g`,`Sim, ~${est.grams} g`)}</button>`:""}<button class="ibtn" data-rise="ander" data-t="${r.t0}">${est?TL("Andere hoeveelheid","Other amount","Outra quantidade"):TL("Ja, hoeveel?","Yes, how much?","Sim, quanto?")}</button><button class="ibtn" data-rise="0" data-t="${r.t0}">${TL("Nee","No","Não")}</button></div>${est?`<div class="ihint">${TL(`~${est.grams} g geschat uit je stijging (${_idaN(r.rise)}) en ${_idaN(est.ins)} E die de loop gaf.`,`~${est.grams} g estimated from your rise (${_idaN(r.rise)}) and ${_idaN(est.ins)} U the loop gave.`,`~${est.grams} g estimado pela subida (${_idaN(r.rise)}) e ${_idaN(est.ins)} U do loop.`)}</div>`:""}</article>`);
  }
  // Weekoverzicht: op zondag en maandag als kaart
  const wd=new Date().getDay();
  if(wd===0||wd===1){ const R=weekReview(c); if(R) cards.push(`<article class="icard"><div class="icrow"><span class="icic t">${_idaIcon("trend")}</span><span class="ictxt"><b>${TL("Je weekoverzicht staat klaar.","Your weekly review is ready.","O seu resumo semanal está pronto.")}</b> ${TL(`In bereik ${_idaPct(R.A.tir)}${R.B?` (week ervoor ${_idaPct(R.B.tir)})`:""}.`,`In range ${_idaPct(R.A.tir)}${R.B?` (previous week ${_idaPct(R.B.tir)})`:""}.`,`No alvo ${_idaPct(R.A.tir)}.`)}</span></div><div class="icacts"><button class="ibtn acc" data-ida="week">${TL("Bekijk","View","Ver")}</button></div></article>`); }
  const host=_idaEl("assist"); host.innerHTML=cards.join("");
  host.querySelectorAll("[data-ida=week]").forEach(b=>b.onclick=()=>{ showTab("consult"); setTimeout(()=>{ const w=_idaEl("weekCard"); if(w) w.scrollIntoView({behavior:"smooth",block:"start"}); },80); });
  host.querySelectorAll("[data-ida=profiel]").forEach(b=>b.onclick=()=>showTab("profiel"));
  host.querySelectorAll("[data-rise]").forEach(b=>b.onclick=()=>_riseAnswer(b.dataset.rise, +b.dataset.t));
}
async function _riseAnswer(kind, t0){
  if(kind==="ander"){
    _idaEl("riseActs").innerHTML=`<label class="srl" for="riseG">${TL("Gram koolhydraten","Grams of carbs","Gramas de hidratos")}</label><input id="riseG" class="iinp" type="number" inputmode="numeric" min="1" max="300" placeholder="${TL("gram","grams","gramas")}"><button class="ibtn dark" id="riseSave">${TL("Opslaan","Save","Guardar")}</button>`;
    _idaEl("riseSave").onclick=()=>{ const v=parseInt(_idaEl("riseG").value,10); if(!(v>0)){ toast(TL("Vul een aantal gram in.","Enter grams.","Indique gramas.")); return; } _riseAnswer(String(v), t0); };
    return;
  }
  const grams=+kind||0;
  const an={ id:"rise-"+t0, ts:t0, type:"maaltijd", grams, note: grams?TL(`~${grams} g, achteraf aangegeven`,`~${grams} g, added afterwards`,`~${grams} g, indicado depois`):TL("geen eten","no food","sem comida"), created:Date.now(), src:"rise" };
  try{ await DB.putMany("annotations",[an]); }catch(e){ toast(TL("Opslaan mislukt.","Save failed.","Falha ao guardar.")); return; }
  toast(grams?TL("Vastgelegd. Dit telt mee in je eetpatroon.","Saved. This counts in your meal pattern.","Guardado."):TL("Vastgelegd.","Saved.","Guardado."));
  _idaAnns.push(an); const el=_idaEl("riseCard"); if(el) el.remove();
}
function _idaIcon(k){
  const P={ trend:'<path d="M4 14l4-4 4 3 8-8"/><path d="M15 5h5v5"/>', food:'<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10"/><path d="M17 3c-2 2-2 6 0 8v10"/>' };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${P[k]||""}</svg>`;
}

/* ── Patronen: tegels ────────────────────────────────────────────────────── */
function _hourStats(c){
  const hs=Array.from({length:24},()=>({n:0,lo:0,hi:0}));
  for(const x of c.glucose){ if(!c.q.usableKeys.has(localDayKey(x.ts))) continue; const o=hs[Math.floor(todMin(x.ts)/60)%24]; o.n++; if(x.bg<LO_T)o.lo++; if(x.bg>HI_T)o.hi++; }
  return hs.map(o=>({lo:o.n?o.lo/o.n:0, hi:o.n?o.hi/o.n:0}));
}
function _worstWindow(vals, w){ let best={s:0,v:-1}; for(let s=0;s<24;s++){ let v=0; for(let k=0;k<w;k++) v+=vals[(s+k)%24]; if(v>best.v) best={s,v}; } return best.s; }
function _bars(vals, hl, col){
  const m=Math.max(...vals,1e-9); let o="";
  vals.forEach((v,i)=>{ const h=Math.max(0.6,v/m*34), x=2+i*6.1; o+=`<rect x="${x.toFixed(1)}" y="${(38-h).toFixed(1)}" width="4.6" height="${h.toFixed(1)}" rx="1" fill="${hl.includes(i)?col:'var(--ida-mute)'}"/>`; });
  return `<svg class="ibars" viewBox="0 0 150 40" role="img" aria-hidden="true">${o}</svg>`;
}
function _eventDays(c, re, stepH, nSteps){
  const ev=c.treatments.filter(t=>re.test(t.type||"")).map(t=>t.ts).sort((a,b)=>a-b);
  if(ev.length<3) return null;
  const st=Array.from({length:nSteps},()=>({n:0,in:0}));
  for(const x of c.glucose){ if(!c.q.usableKeys.has(localDayKey(x.ts))) continue;
    let lo=0,hi=ev.length; while(lo<hi){const m=(lo+hi)>>1; if(ev[m]<=x.ts)lo=m+1;else hi=m;} if(lo===0) continue;
    const k=Math.floor((x.ts-ev[lo-1])/(stepH*3600e3)); if(k>=nSteps) continue; st[k].n++; if(x.bg>=LO_T&&x.bg<=HI_T) st[k].in++; }
  if(st.some(s=>s.n<500)) return null;
  return st.map(s=>s.in/s.n);
}
function idaPatronen(c){
  const host=_idaEl("bento"); if(!host) return;
  const tiles=[];
  // 1. gevoeligheid
  if(_P && _P.sensMax!=null){
    const by=new Map(); for(const d of _dsAll){ if(d.sens==null) continue; const k=localDayKey(d.ts); (by.get(k)||by.set(k,[]).get(k)).push(d.sens); }
    const days=[...by.keys()].sort().slice(-60), vals=days.map(k=>_pMean(by.get(k)));
    let path=""; if(vals.length>1){ const lo=Math.min(0.9,...vals), hi=Math.max(1.22,...vals);
      vals.forEach((v,i)=>{ path+=(i?"L":"M")+(4+i*142/(vals.length-1)).toFixed(1)+" "+(4+(hi-v)/(hi-lo)*32).toFixed(1); }); }
    const ymax=(4+(Math.max(1.22,...vals)-1.2)/(Math.max(1.22,...vals)-Math.min(0.9,...vals))*32).toFixed(1);
    tiles.push(`<article class="itile wide dark"><span class="itl">${TL("Je loop ziet vaak dat je minder gevoelig bent","Your loop often sees you are less sensitive","O seu loop vê muitas vezes menor sensibilidade")}</span>
      <div class="itv"><b>${_idaPct(_P.sensMax)}</b><span>${TL("van de tijd staat autosens op het maximum","of the time autosens is at its maximum","do tempo o autosens está no máximo")}</span></div>
      ${path?`<svg class="ispark" viewBox="0 0 150 40" preserveAspectRatio="none" role="img" aria-label="${TL("Autosens per dag","Autosens per day","Autosens por dia")}"><line x1="0" y1="${ymax}" x2="150" y2="${ymax}" stroke="#F2B455" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/><path d="${path}" fill="none" stroke="#FFFFFF" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`:""}
      <span class="its">${_P.sensMax>0.2?TL("Je profiel geeft dan te weinig insuline. Het nieuwe profiel past dat aan.","Your profile then gives too little insulin. The new profile adjusts that.","O perfil dá então pouca insulina. O novo perfil corrige isso."):TL("Je profiel past meestal goed bij wat de loop ziet.","Your profile mostly matches what the loop sees.","O perfil corresponde geralmente ao que o loop vê.")}</span></article>`);
  }
  // 2/3. laag en hoog per uur
  const hs=_hourStats(c), lo=hs.map(h=>h.lo), hi=hs.map(h=>h.hi);
  const ls=_worstWindow(lo,3), hsS=_worstWindow(hi,4);
  const lMax=Math.max(lo[ls%24],lo[(ls+1)%24],lo[(ls+2)%24]), lPk=[0,1,2].map(k=>(ls+k)%24).reduce((a,b)=>lo[b]>lo[a]?b:a,(ls)%24);
  const hMax=Math.max(...[0,1,2,3].map(k=>hi[(hsS+k)%24])), hPk=[0,1,2,3].map(k=>(hsS+k)%24).reduce((a,b)=>hi[b]>hi[a]?b:a,hsS%24);
  tiles.push(`<article class="itile"><span class="itl">${TL(`Laag tussen ${ls} en ${(ls+3)%24} uur`,`Low between ${ls} and ${(ls+3)%24} h`,`Baixa entre as ${ls} e as ${(ls+3)%24} h`)}</span><b class="itn lo">${_idaN(lMax*100)}%</b>${_bars(lo,[ls,ls+1,ls+2].map(x=>x%24),"var(--low)")}<span class="its">${TL(`van de tijd onder 3,9, het meest om ${lPk} uur`,`of the time under 3.9, most at ${lPk} h`,`do tempo abaixo de 3,9, sobretudo às ${lPk} h`)}</span></article>`);
  tiles.push(`<article class="itile"><span class="itl">${TL(`Hoog tussen ${hsS} en ${(hsS+4)%24} uur`,`High between ${hsS} and ${(hsS+4)%24} h`,`Alta entre as ${hsS} e as ${(hsS+4)%24} h`)}</span><b class="itn hi">${Math.round(hMax*100)}%</b>${_bars(hi,[0,1,2,3].map(k=>(hsS+k)%24),"var(--high)")}<span class="its">${TL(`van de tijd boven 10, het meest om ${hPk} uur`,`of the time above 10, most at ${hPk} h`,`do tempo acima de 10, sobretudo às ${hPk} h`)}</span></article>`);
  // 4. pod-dag
  const pod=_eventDays(c,/site change|cannula/i,24,3);
  if(pod){ const m=Math.max(...pod), mn=Math.min(...pod), w=pod.indexOf(mn);
    tiles.push(`<article class="itile"><span class="itl">${TL(`Dag ${w+1} van een pod`,`Day ${w+1} of a pod`,`Dia ${w+1} de um pod`)}</span><b class="itn">${_idaN(mn*100)}%</b>
      <svg class="ibars" viewBox="0 0 150 40" aria-hidden="true">${pod.map((v,i)=>{ const h=Math.max(4,(v-mn+0.02)/(m-mn+0.02)*30); return `<rect x="${6+i*49}" y="${38-h}" width="40" height="${h}" rx="4" fill="${i===w?'var(--ida-acc)':'var(--ida-acc-2)'}"/>`; }).join("")}</svg>
      <span class="its">${TL(`in bereik; beste dag ${_idaN(m*100)}%`,`in range; best day ${_idaN(m*100)}%`,`no alvo; melhor dia ${_idaN(m*100)}%`)}</span></article>`); }
  // 5. sensorstart
  const sen=_eventDays(c,/sensor (change|start)/i,12,3);
  if(sen){ const m=Math.max(...sen), mn=Math.min(...sen), w=sen.indexOf(mn);
    tiles.push(`<article class="itile"><span class="itl">${TL("Nieuwe sensor","New sensor","Novo sensor")}</span><b class="itn">${Math.round(mn*100)}%</b>
      <svg class="ibars" viewBox="0 0 150 40" aria-hidden="true">${sen.map((v,i)=>{ const h=Math.max(4,(v-mn+0.02)/(m-mn+0.02)*30); return `<rect x="${6+i*49}" y="${38-h}" width="40" height="${h}" rx="4" fill="${i===w?'var(--ida-acc)':'var(--ida-acc-2)'}"/>`; }).join("")}</svg>
      <span class="its">${TL(`in bereik, ${w*12} tot ${(w+1)*12} uur na de start`,`in range, ${w*12}–${(w+1)*12} h after start`,`no alvo, ${w*12}–${(w+1)*12} h após o início`)}</span></article>`); }
  // 6. hypo's
  try{ const hy=hypoStats(c.glucose.filter(x=>c.q.usableKeys.has(localDayKey(x.ts))));
    if(hy && hy.episodes!=null){ const n=hy.episodes, nn=hy.nocturnal||0, l2=hy.level2||0;
      tiles.push(`<article class="itile wide row"><div><span class="itl">${TL("Hypo's","Hypos","Hipos")}</span><span class="its big">${TL(`<b>${n}</b> keer onder 3,9, waarvan <b>${l2}</b> onder 3,0 en <b>${nn}</b> 's nachts.`,`<b>${n}</b> times below 3.9, of which <b>${l2}</b> below 3.0 and <b>${nn}</b> at night.`,`<b>${n}</b> vezes abaixo de 3,9; <b>${l2}</b> abaixo de 3,0 e <b>${nn}</b> à noite.`)}</span></div></article>`); } }catch(_){}
  host.innerHTML=tiles.join("");
}

/* ── Eten: kop ───────────────────────────────────────────────────────────── */
function idaEten(c){
  const host=_idaEl("etenHero"); if(!host) return;
  let MR=null; try{ MR=mealResults(c.glucose,c.treatments,c.timeline); }catch(_){}
  const n=MR&&MR.results?MR.results.length:0;
  if(!MR || n<MEAL_MIN || MR.mfrac==null){ host.innerHTML=""; return; }
  const use30=_P&&_P.mfrac!=null&&_P.mfracDays===30;
  const pct=Math.round((use30?_P.mfrac:MR.mfrac)*100), tpk=MR.mtpk!=null?Math.round(MR.mtpk):null, off=MR.moffset;
  const offTxt = off==null?null : off<-5?TL(`${Math.round(-off)} min vóór het eten`,`${Math.round(-off)} min before eating`,`${Math.round(-off)} min antes`) : off>5?TL(`${Math.round(off)} min na het eten`,`${Math.round(off)} min after eating`,`${Math.round(off)} min depois`) : TL("bij het eten","at the meal","à refeição");
  const lead = pct>=115 ? TL("Na het eten stijg je alsof je meer at","After meals you rise as if you ate more","Depois de comer sobe como se comesse mais")
             : pct<=85 ? TL("Na het eten stijg je minder dan je invoert","After meals you rise less than you enter","Depois de comer sobe menos do que regista")
             : TL("Je koolhydraten kloppen goed","Your carbs match well","Os hidratos batem certo");
  let html=`<section class="ihero sm"><span class="itl">${lead}</span><div class="itv"><b style="color:#F2B455">${pct}%</b><span>${TL("van de koolhydraten die je invoert","of the carbs you enter","dos hidratos que regista")}${use30?TL(" (laatste 30 dagen)"," (last 30 days)"," (últimos 30 dias)"):""}</span></div>
    <div class="ichips">${tpk!=null?`<span><i>${TL("piek na","peak after","pico após")}</i> <b>${tpk} min</b></span>`:""}${offTxt?`<span><i>${TL("bolus","bolus","bólus")}</i> <b>${offTxt}</b></span>`:""}<span><b>${n}</b> <i>${TL("maaltijden","meals","refeições")}</i></span></div>${pct>115?`<span class="its" style="color:#D7DADE;margin-top:.4rem">${TL("Waarschijnlijk tel je te weinig koolhydraten. Daarom past IDA je KH-ratio niet aan: weeg een paar maaltijden af of gebruik de schatter hieronder.","You probably under-count carbs, so IDA doesn't change your carb ratio: weigh a few meals or use the estimator below.","Provavelmente subestima os hidratos; por isso o IDA não altera o rácio.")}</span>`:""}</section>`;
  if(_P && _P.ic && _P.ic.length){
    html+=`<h2 class="ihead">${TL("Gemeten KH-ratio (g per E)","Measured carb ratio (g per U)","Rácio medido (g por U)")}</h2><div class="igrid3">`+
      _P.ic.map(b=>`<div class="itile sm"><span class="itl">${TL("vanaf","from","desde")} ${b.from}</span><b class="itn">${b.measured!=null?_idaN(b.measured):"—"}</b><span class="its">${TL(`nu ${_idaN(b.now)} · ${b.n} maaltijden`,`now ${_idaN(b.now)} · ${b.n} meals`,`agora ${_idaN(b.now)} · ${b.n} refeições`)}</span></div>`).join("")+`</div>`;
    const ch=_P.ic.find(b=>Math.abs(b.value-b.now)>=0.1);
    if(ch) html+=`<button class="ilink" data-ida="profiel">${TL(`Nieuw profiel: ${_idaN(ch.value)} vanaf ${ch.from}`,`New profile: ${_idaN(ch.value)} from ${ch.from}`,`Novo perfil: ${_idaN(ch.value)} a partir das ${ch.from}`)} ›</button>`;
  }
  host.innerHTML=html;
  host.querySelectorAll("[data-ida=profiel]").forEach(b=>b.onclick=()=>showTab("profiel"));
}

/* ── Team: profiel + effectmeting ────────────────────────────────────────── */
function _idaActivation(){ return _idaAnns.filter(a=>a.type==="wijziging" && a.ida).sort((a,b)=>b.ts-a.ts)[0]||null; }
function _periodStats(c, from, to, win){
  const g=c.glucose.filter(x=>x.ts>=from&&x.ts<to&&c.q.usableKeys.has(localDayKey(x.ts)));
  const inW=(x,s,w)=>{ const h=Math.floor(todMin(x.ts)/60); return ((h-s+24)%24)<w; };
  const gl=g.filter(x=>inW(x,win.lo,3)), gh=g.filter(x=>inW(x,win.hi,4));
  const ds=_dsAll.filter(d=>d.ts>=from&&d.ts<to&&d.sens!=null), top=ds.length?Math.max(...ds.map(d=>d.sens)):0;
  return { days:new Set(g.map(x=>localDayKey(x.ts))).size,
    low: gl.length?gl.filter(x=>x.bg<LO_T).length/gl.length:null, high: gh.length?gh.filter(x=>x.bg>HI_T).length/gh.length:null,
    smax: (ds.length&&top>=1.1)?ds.filter(d=>d.sens>=top-0.005).length/ds.length:(ds.length?0:null), vlow: g.length?g.filter(x=>x.bg<VLO_T).length/g.length:null };
}
function idaTeam(c){
  const host=_idaEl("teamTop"); if(!host) return;
  const hs=_hourStats(c), win={ lo:_worstWindow(hs.map(h=>h.lo),3), hi:_worstWindow(hs.map(h=>h.hi),4) };
  const act=_idaActivation(), now=Date.now();
  let html="";
  if(_P && _P.basal){
    const icCh=_P.ic.find(b=>Math.abs(b.value-b.now)>=0.1)||_P.ic[_P.ic.length-1];
    html+=`<button class="ihero tap" data-ida="profiel"><span class="itl">${TL("Nieuw AAPS-profiel","New AAPS profile","Novo perfil AAPS")}</span><span class="iname">${_profName()}</span>
      <div class="igrid3 dk"><div><i>${TL("Basaal/dag","Basal/day","Basal/dia")}</i><b>${_idaN(_P.dayNow)} → ${_idaN(_P.dayNew)}</b></div><div><i>ISF</i><b>${_idaN(_P.isfNow)} → ${_idaN(_pMed(_P.isf.map(b=>b.value)))}</b></div><div><i>${TL("KH vanaf","Carbs from","HC desde")} ${icCh?icCh.from:""}</i><b>${icCh?_idaN(icCh.now)+" → "+_idaN(icCh.value):"—"}</b></div></div>
      <span class="ibtn acc">${TL("Bekijk blokken en kopieer","View blocks and copy","Ver blocos e copiar")}</span></button>`;
  }
  const rows=[["low",TL(`Laag tussen ${win.lo} en ${(win.lo+3)%24} uur`,`Low between ${win.lo} and ${(win.lo+3)%24} h`,`Baixa ${win.lo}–${(win.lo+3)%24} h`),0.04,"var(--low)",0.10],
              ["high",TL(`Hoog tussen ${win.hi} en ${(win.hi+4)%24} uur`,`High between ${win.hi} and ${(win.hi+4)%24} h`,`Alta ${win.hi}–${(win.hi+4)%24} h`),0.30,"var(--high)",0.6],
              ["smax",TL("Autosens op maximum","Autosens at maximum","Autosens no máximo"),0.15,"var(--ida-acc)",0.6],
              ["vlow",TL("Onder 3,0","Below 3.0","Abaixo de 3,0"),0.01,"var(--low)",0.03]];
  let days=0, cur, base;
  if(act){ days=Math.floor((now-act.ts)/864e5); cur=_periodStats(c,act.ts,now,win); base=_periodStats(c,act.ts-14*864e5,act.ts,win); }
  else { cur=_periodStats(c,now-30*864e5,now,win); }
  const ring=Math.min(7,days), dash=(ring/7*151).toFixed(0);
  html+=`<section class="itile wide dark row"><svg width="58" height="58" viewBox="0 0 58 58" role="img" aria-label="${ring}/7"><circle cx="29" cy="29" r="24" fill="none" stroke="#2F353C" stroke-width="7"/><circle cx="29" cy="29" r="24" fill="none" stroke="#F2B455" stroke-width="7" stroke-dasharray="${dash} 151" stroke-linecap="round" transform="rotate(-90 29 29)"/><text x="29" y="34" text-anchor="middle" font-size="15" font-weight="800" fill="#fff">${ring}/7</text></svg>
    <div><b class="ittl">${TL("Effect van je nieuwe profiel","Effect of your new profile","Efeito do novo perfil")}</b><span class="its">${act?(days<7?TL(`Dag ${days} van 7. Na een week zie je hier de uitslag.`,`Day ${days} of 7. The result shows here after a week.`,`Dia ${days} de 7.`):TL("De meting is klaar. Vergelijk met de 14 dagen ervoor.","The measurement is done. Compared with the 14 days before.","Medição concluída.")):TL("De meting start zodra je het nieuwe profiel in AAPS activeert.","The measurement starts once you activate the new profile in AAPS.","A medição começa quando ativar o novo perfil no AAPS.")}</span></div></section>`;
  html+=`<section class="itile wide"><b class="ittl">${TL("Waar de meting naar kijkt","What the measurement looks at","O que a medição observa")}</b>`+
    rows.map(([k,lab,goal,col,scale])=>{ const v=cur[k], b=base&&base[k];
      const w=v==null?0:Math.min(100,v/scale*100), gw=Math.min(100,goal/scale*100);
      return `<div class="imeter"><div class="imrow"><span>${lab}</span><span><b>${v==null?"—":(k==="vlow"?_idaN(v*100):Math.round(v*100))+"%"}</b> <i>→ &lt;${k==="vlow"?_idaN(goal*100):Math.round(goal*100)}%</i>${b!=null&&act?` <i>(${TL("was","was","era")} ${k==="vlow"?_idaN(b*100):Math.round(b*100)}%)</i>`:""}</span></div><div class="imbar"><i style="width:${w.toFixed(0)}%;background:${col}"></i><em style="left:${gw.toFixed(0)}%"></em></div></div>`; }).join("")+
    `<span class="its">${TL("De zwarte streep is het doel. Kom je in een blok vaker laag, dan zie je meteen welk blok het is.","The black line is the goal. If a block gets more lows, you see straight away which one.","A linha preta é o objetivo.")}</span></section>`;
  const WR=weekReview(c);
  if(WR) html+=`<section class="itile wide" id="weekCard">${weekCardHtml(WR)}</section>`;
  html+=`<div class="igrid2"><button class="itile sm tap" id="idaWeek"><b class="ittl">${TL("Weektrend","Weekly trend","Tendência semanal")}</b><span class="its">${TL("tijd in bereik per week","time in range per week","tempo no alvo por semana")}</span></button><button class="itile sm tap" id="idaPdf"><b class="ittl">${TL("Consult-PDF","Consult PDF","PDF da consulta")}</b><span class="its">${TL("profiel, dagprofiel en meting","profile, daily profile and measurement","perfil, perfil diário e medição")}</span></button></div>`;
  host.innerHTML=html;
  host.querySelectorAll("[data-ida=profiel]").forEach(b=>b.onclick=()=>showTab("profiel"));
  if(WR && _idaEl("weekAIbtn")){ _idaEl("weekAIbtn").onclick=()=>weekAISummary(WR); try{ if(localStorage.getItem("ida.week."+localDayKey(Date.now()))) weekAISummary(WR); }catch(_){} }
  _idaEl("idaWeek").onclick=()=>{ try{ goTo("secTrend","analyses"); }catch(_){ showTab("analyses"); } };
  _idaEl("idaPdf").onclick=()=>{ try{ openReport(); }catch(e){ console.error(e); } };
}
function _profName(){ const d=new Date(); return "IDA "+d.toLocaleDateString(LOCALE(),{month:"short",year:"numeric"}).replace(".",""); }

/* ── Profiel (AAPS) ──────────────────────────────────────────────────────── */
function idaProfiel(c){
  const host=_idaEl("profBody"); if(!host) return;
  if(!_P || !_P.basal){
    const why = !_P ? TL("Nog geen berekening.","No calculation yet.","Ainda sem cálculo.")
      : _P.none==="profiel" ? TL("Er is geen AAPS-profiel gevonden in je Nightscout.","No AAPS profile found in your Nightscout.","Nenhum perfil AAPS encontrado.")
      : TL("Te weinig loop-data (temp-basaal) om een profiel te berekenen. Synchroniseer minstens 14 dagen.","Too little loop data to calculate a profile. Sync at least 14 days.","Poucos dados do loop.");
    host.innerHTML=`<section class="itile wide"><b class="ittl">${TL("Nog geen profielvoorstel","No profile proposal yet","Ainda sem proposta")}</b><span class="its">${why}</span></section>`; return;
  }
  const P=_P, icCh=P.ic.find(b=>Math.abs(b.value-b.now)>=0.1)||P.ic[P.ic.length-1];
  const isfNew=_pMed(P.isf.map(b=>b.value));
  let html=`<section class="ihero"><span class="itl">${TL("Nieuw AAPS-profiel","New AAPS profile","Novo perfil AAPS")}</span><span class="iname big">${_profName()}</span>
    <span class="its">${TL(`Berekend uit ${P.days} bruikbare dagen${P.name?` met je profiel '${esc(P.name)}'`:""}`,`Calculated from ${P.days} usable days${P.name?` with your profile '${esc(P.name)}'`:""}`,`Calculado a partir de ${P.days} dias`)}</span>
    <div class="igrid3 dk"><div><i>${TL("Basaal/dag","Basal/day","Basal/dia")}</i><b>${_idaN(P.dayNew)} ${TL("E","U","U")}</b><em>${TL("was","was","era")} ${_idaN(P.dayNow)}</em></div><div><i>ISF</i><b>${_idaN(isfNew)}</b><em>${TL("was","was","era")} ${_idaN(P.isfNow)}</em></div><div><i>${TL("KH vanaf","Carbs from","HC desde")} ${icCh.from}</i><b>${_idaN(icCh.value)}</b><em>${TL("was","was","era")} ${_idaN(icCh.now)}</em></div></div></section>`;
  // basaalgrafiek
  const W=318, X=m=>m/1440*W, mx=Math.max(1.4,...P.basal.map(b=>b.value), ...P.basal.flatMap(b=>b.now))*1.05, Y=v=>96-v/mx*90;
  let bars="", oldp="";
  P.basal.forEach((b,i)=>{ const f=hhmmToMin(b.from), t=i+1<P.basal.length?hhmmToMin(P.basal[i+1].from):1440, nowAvg=b.now.reduce((s,x)=>s+x,0)/b.now.length;
    const col = b.value<nowAvg-0.02 ? "var(--high)" : "var(--ida-acc)";
    bars+=`<rect x="${(X(f)+0.5).toFixed(1)}" y="${Y(b.value).toFixed(1)}" width="${(X(t)-X(f)-1).toFixed(1)}" height="${(96-Y(b.value)).toFixed(1)}" rx="3" fill="${col}"/>`; });
  for(let h=0;h<24;h++){ const p=profileAt(c.timeline, _hourTs(h, c.q.to||Date.now())); oldp+=(h?"L":"M")+X(h*60).toFixed(1)+" "+Y(p.basal).toFixed(1)+"H"+X((h+1)*60).toFixed(1); }
  html+=`<section class="itile wide"><div class="imrow"><b class="ittl">${TL("Basaal over de dag","Basal over the day","Basal ao longo do dia")}</b><i>${TL("E/u","U/h","U/h")}</i></div>
    <svg class="ibasal" viewBox="0 0 318 112" role="img" aria-label="${TL("Nieuwe basaalblokken, huidig profiel als stippellijn","New basal blocks, current profile dashed","Novos blocos basais")}">${bars}<path d="${oldp}" fill="none" stroke="var(--ida-ink)" stroke-width="1.6" stroke-dasharray="3 3"/>
    <text x="0" y="110" font-size="10" fill="var(--ida-sub)">0u</text><text x="79.5" y="110" font-size="10" fill="var(--ida-sub)" text-anchor="middle">6u</text><text x="159" y="110" font-size="10" fill="var(--ida-sub)" text-anchor="middle">12u</text><text x="238.5" y="110" font-size="10" fill="var(--ida-sub)" text-anchor="middle">18u</text><text x="318" y="110" font-size="10" fill="var(--ida-sub)" text-anchor="end">24u</text></svg>
    <div class="ileg"><span><i style="background:var(--ida-acc)"></i>${TL("hoger of gelijk","higher or same","maior ou igual")}</span><span><i style="background:var(--high)"></i>${TL("lager","lower","menor")}</span><span><i class="dash"></i>${TL("huidig profiel","current profile","perfil atual")}</span></div>
    <span class="its">${TL("Elk blok begint een uur vóór het moment dat je de insuline nodig hebt, omdat basaal pas na ongeveer een uur werkt.","Each block starts an hour before you need the insulin, because basal takes about an hour to act.","Cada bloco começa uma hora antes de precisar da insulina.")}</span></section>`;
  // tabs + rijen
  const tabs=[["basal",TL("Basaal","Basal","Basal")],["isf","ISF"],["ic",TL("KH-ratio","Carb ratio","Rácio HC")],["target",TL("Streefwaarde","Target","Alvo")]];
  const chip=(d,dec)=>{ if(Math.abs(d)<(dec===2?0.025:0.05)) return `<span class="ichip eq">${TL("gelijk","same","igual")}</span>`; return `<span class="ichip ${d>0?"up":"dn"}">${d>0?"+":"−"}${_idaN(Math.abs(d),dec)}</span>`; };
  let rows="";
  if(_profTab==="basal") rows=P.basal.map(b=>{ const n=b.now.length===1?b.now[0]:b.now.reduce((s,x)=>s+x,0)/b.now.length;
      const why=b.why==="laag"?TL(`${_idaN(b.low*100)}% laag`,`${_idaN(b.low*100)}% low`,`${_idaN(b.low*100)}% baixa`):b.act?TL(`loop levert ${_idaN(b.act[0],2)}${b.act[1]-b.act[0]>0.05?"–"+_idaN(b.act[1],2):""}`,`loop delivers ${_idaN(b.act[0],2)}`,`loop entrega ${_idaN(b.act[0],2)}`):"";
      return `<div class="iprow"><span class="ipt">${b.from}</span><span class="ipv">${_idaN(b.value,2)}</span><span class="ipw">${TL("was","was","era")} ${b.now.map(x=>_idaN(x,2)).join("/")}<br><em>${why}</em></span>${chip(b.value-n,2)}</div>`; }).join("");
  if(_profTab==="isf") rows=P.isf.map(b=>`<div class="iprow"><span class="ipt">${b.from}</span><span class="ipv">${_idaN(b.value)}</span><span class="ipw">${TL("was","was","era")} ${_idaN(b.now)}<br><em>${b.why==="laag"?TL("gelijk: hier zit je vaak laag","same: you're often low here","igual: baixas aqui"):TL("uit autosens en dagdosis","from autosens and daily dose","de autosens e dose diária")}</em></span>${chip(b.value-b.now,1)}</div>`).join("");
  if(_profTab==="ic") rows=P.ic.map(b=>`<div class="iprow"><span class="ipt">${b.from}</span><span class="ipv">${_idaN(b.value)}</span><span class="ipw">${TL("was","was","era")} ${_idaN(b.now)}<br><em>${b.why==="gemeten"?TL(`gemeten ${_idaN(b.measured)} (${b.n} maaltijden)`,`measured ${_idaN(b.measured)} (${b.n} meals)`,`medido ${_idaN(b.measured)}`):b.why==="gelijk"?TL(`gemeten ${_idaN(b.measured)}: klopt`,`measured ${_idaN(b.measured)}: matches`,`medido: certo`):b.why==="tellen"?TL(`gemeten ${_idaN(b.measured)}, maar je telt waarschijnlijk te weinig koolhydraten`,`measured ${_idaN(b.measured)}, but you probably under-count carbs`,`medido ${_idaN(b.measured)}, mas provavelmente subestima os hidratos`):b.why==="hoog"?TL(`gemeten ${_idaN(b.measured)}, maar je zit hierna vaak hoog`,`measured ${_idaN(b.measured)}, but you're often high afterwards`,`medido ${_idaN(b.measured)}, mas fica alto depois`):b.why==="laag"?TL(`gemeten ${_idaN(b.measured)}, maar je zit hier vaak laag`,`measured ${_idaN(b.measured)}, but you're often low here`,`medido ${_idaN(b.measured)}, mas baixa aqui`):TL(`te weinig maaltijden (${b.n})`,`too few meals (${b.n})`,`poucas refeições (${b.n})`)}</em></span>${chip(b.value-b.now,1)}</div>`).join("");
  if(_profTab==="target") rows=`<div class="iprow"><span class="ipt">00:00</span><span class="ipv">${P.target.lo!=null?_idaN(P.target.lo)+"–"+_idaN(P.target.hi):"—"}</span><span class="ipw"><em>${TL("ongewijzigd","unchanged","inalterado")}</em></span><span class="ichip eq">${TL("gelijk","same","igual")}</span></div>`;
  html+=`<section class="itile wide"><div class="itabs" role="tablist">${tabs.map(([k,l])=>`<button role="tab" aria-selected="${k===_profTab}" data-ptab="${k}">${l}</button>`).join("")}</div>${rows}</section>`;
  const MA=(typeof maxIobAdvice==="function")?maxIobAdvice(c):null, iobMin=_idaN(MA?MA.v:P.maxIobMin+(P.mealBolus||0));
  const why=MA?MA.why:TL("3× je hoogste basaal plus je gemiddelde maaltijdbolus","3× your highest basal plus your average meal bolus","3× o basal mais alto mais o bólus médio");
  html+=`<section class="inote">${TL(`<b>Max IOB</b> (AAPS → SMB-instellingen): zet die op minstens ${iobMin} E, omdat ${why}.`,`<b>Max IOB</b> (AAPS → SMB settings): set it to at least ${iobMin} U, because ${why}.`,`<b>Max IOB</b>: pelo menos ${iobMin} U (${why}).`)}</section>
    <button class="ibtn" id="profExplain" style="align-self:flex-start">${TL("Leg dit profiel uit","Explain this profile","Explicar este perfil")}</button>
    <div class="iacts"><button class="ibtn big acc" id="profCopy">${TL("Kopieer voor AAPS","Copy for AAPS","Copiar para AAPS")}</button><button class="ibtn big" id="profAct">${TL("Ik heb het profiel geactiveerd","I've activated the profile","Ativei o perfil")}</button></div>`;
  host.innerHTML=html;
  host.querySelectorAll("[data-ptab]").forEach(b=>b.onclick=()=>{ _profTab=b.dataset.ptab; idaProfiel(c); });
  _idaEl("profExplain").onclick=()=>openAI(TL("Uitleg bij je profiel","About your profile","Sobre o seu perfil"), _profileFacts(P), TL("Leg in gewone taal uit wat er in dit nieuwe profiel verandert en waarom.","Explain in plain words what changes in this new profile and why.","Explique em palavras simples o que muda neste novo perfil e porquê."));
  _idaEl("profCopy").onclick=async()=>{ const txt=aapsProfileText(P);
    try{ await navigator.clipboard.writeText(txt); toast(TL("Gekopieerd. Plak het naast AAPS → Profiel.","Copied.","Copiado.")); }
    catch(_){ const ta=document.createElement("textarea"); ta.value=txt; document.body.appendChild(ta); ta.select(); try{ document.execCommand("copy"); toast(TL("Gekopieerd.","Copied.","Copiado.")); }catch(__){} ta.remove(); } };
  _idaEl("profAct").onclick=async()=>{
    const an={ id:"prof-"+Date.now(), ts:Date.now(), type:"wijziging", note:TL(`Profiel ${_profName()} geactiveerd`,`Profile ${_profName()} activated`,`Perfil ${_profName()} ativado`), created:Date.now(),
      ida:{ basal:P.basal.map(b=>[b.from,b.value]), isf:P.isf.map(b=>[b.from,b.value]), ic:P.ic.map(b=>[b.from,b.value]) } };
    try{ await DB.putMany("annotations",[an]); }catch(e){ toast(TL("Opslaan mislukt.","Save failed.","Falha ao guardar.")); return; }
    _idaAnns.push(an); toast(TL("Vastgelegd. De meting loopt nu 7 dagen.","Saved. The 7-day measurement has started.","Guardado.")); idaTeam(_ctx); idaVandaag(_ctx); showTab("consult"); };
}

/* ── Snel loggen ─────────────────────────────────────────────────────────── */
const _LOGT_=()=>[["sport",TL("Sport","Exercise","Exercício"),'<circle cx="14" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2v4M6 12l3-3 4 1 3 4h3"/>'],
  ["ziek",TL("Ziek","Ill","Doente"),'<path d="M10 3h4v8a3 3 0 1 1-4 0z"/><path d="M12 14v2"/>'],
  ["stress",TL("Stress","Stress","Stress"),'<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'],
  ["alcohol",TL("Alcohol","Alcohol","Álcool"),'<path d="M8 3h8l-1 7a3 3 0 0 1-6 0zM12 13v8M9 21h6"/>'],
  ["correctie",TL("Correctie zonder eten","Correction without food","Correção sem comida"),'<path d="M12 3v12M8 11l4 4 4-4M5 21h14"/>'],
  ["pen",TL("Op pen","On pen","Em caneta"),'<path d="M4 20l4-1 11-11-3-3L5 16zM14 6l3 3"/>']];   // functie: labels in de actuele taal
function openLogSheet(){
  _qlSel=null; _qlWhen=0; _qlDur=60;
  const d=_idaEl("logSheet"); renderLogSheet();
  try{ d.showModal(); }catch(_){ d.setAttribute("open",""); }
}
function renderLogSheet(){
  const pen=_qlSel==="pen", durs=pen?[[1,TL("1 dag","1 day","1 dia")],[3,TL("3 dagen","3 days","3 dias")],[7,TL("7 dagen","7 days","7 dias")]]:[[30,"30 min"],[60,"60 min"],[90,"90 min"]];
  if(pen && ![1,3,7].includes(_qlDur)) _qlDur=1; if(!pen && ![30,60,90].includes(_qlDur)) _qlDur=60;
  const showDur=_qlSel && _qlSel!=="correctie";
  _idaEl("logBody").innerHTML=`<div class="lgrid">${_LOGT_().map(([k,l,ic])=>`<button class="ltile${_qlSel===k?" on":""}" data-lt="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg>${l}</button>`).join("")}</div>
    <span class="llab">${TL("Wanneer","When","Quando")}</span><div class="lchips">${[[0,TL("Nu","Now","Agora")],[30,TL("30 min geleden","30 min ago","há 30 min")],[120,TL("2 uur geleden","2 h ago","há 2 h")]].map(([v,l])=>`<button class="lchip${_qlWhen===v?" on":""}" data-lw="${v}">${l}</button>`).join("")}</div>
    ${showDur?`<span class="llab">${TL("Hoe lang","How long","Quanto tempo")}</span><div class="lchips">${durs.map(([v,l])=>`<button class="lchip${_qlDur===v?" on":""}" data-ld="${v}">${l}</button>`).join("")}</div>`:""}
    ${_qlSel==="sport"?(()=>{ const S=(typeof sportTT==="function"&&_ctx)?sportTT(_ctx):null; return `<span class="its big">${S?TL(`Tip: zet ongeveer een uur vóór het sporten een tijdelijke streefwaarde van ${_idaN(S.v)} voor ${Math.round(S.dur)} min${S.lowFrac>0.2?" (of iets hoger: je kwam daarna nog vaak laag)":""}.`,`Tip: about an hour before exercise, set a temporary target of ${_idaN(S.v)} for ${Math.round(S.dur)} min${S.lowFrac>0.2?" (or a bit higher: you still went low often)":""}.`,`Dica: cerca de uma hora antes, alvo temporário de ${_idaN(S.v)} durante ${Math.round(S.dur)} min.`):TL("Tip: zet ongeveer een uur vóór het sporten een tijdelijke streefwaarde in AAPS.","Tip: set a temporary target in AAPS about an hour before exercise.","Dica: alvo temporário uma hora antes.")}</span>`; })():""}
    <button class="ibtn big acc" id="logSave" ${_qlSel?"":"disabled"}>${TL("Opslaan","Save","Guardar")}</button>`;
  const b=_idaEl("logBody");
  b.querySelectorAll("[data-lt]").forEach(x=>x.onclick=()=>{ _qlSel=x.dataset.lt; renderLogSheet(); });
  b.querySelectorAll("[data-lw]").forEach(x=>x.onclick=()=>{ _qlWhen=+x.dataset.lw; renderLogSheet(); });
  b.querySelectorAll("[data-ld]").forEach(x=>x.onclick=()=>{ _qlDur=+x.dataset.ld; renderLogSheet(); });
  _idaEl("logSave").onclick=saveQuickLog;
}
async function saveQuickLog(){
  if(!_qlSel) return;
  const ts=Date.now()-_qlWhen*60000, lab=(_LOGT_().find(x=>x[0]===_qlSel)||[])[1]||_qlSel;
  const an={ id:"q"+ts+"-"+Math.random().toString(36).slice(2,6), ts, type:_qlSel, created:Date.now(), src:"quick",
    note: _qlSel==="pen" ? TL(`${_qlDur} dag(en) op pen`,`${_qlDur} day(s) on pen`,`${_qlDur} dia(s) em caneta`) : _qlSel==="correctie" ? "" : `${_qlDur} min`,
    days: _qlSel==="pen" ? _qlDur : undefined, dur: _qlSel!=="pen" ? _qlDur : undefined };
  try{ await DB.putMany("annotations",[an]); }catch(e){ toast(TL("Opslaan mislukt.","Save failed.","Falha ao guardar.")); return; }
  try{ if(typeof nsWriteNote==="function") await nsWriteNote(an); }catch(e){ toast(TL("Opgeslagen in IDA, maar niet in Nightscout: ","Saved in IDA, not in Nightscout: ","Guardado no IDA, não no Nightscout: ")+e.message); }
  closeLogSheet(); toast(TL(`${lab} vastgelegd.`,`${lab} saved.`,`${lab} guardado.`));
  try{ renderLog(); }catch(_){}
  if(_qlSel==="pen"){ try{ await refresh(); }catch(_){} }
}
function closeLogSheet(){ const d=_idaEl("logSheet"); try{ d.close(); }catch(_){ d.removeAttribute("open"); } }
// Dagen die je als "op pen" hebt gelogd tellen niet mee in de analyses.
function penDayKeys(anns){
  const s=new Set(); for(const a of anns||[]){ if(a.type!=="pen") continue; const n=Math.max(1,Math.min(30,+a.days||1));
    for(let i=0;i<n;i++) s.add(localDayKey(a.ts+i*864e5)); } return s;
}

/* ── AI-assistent: uitleg bij het profiel, doorvragen op kaarten, weekoverzicht ──
   Gebruikt de eigen AI-dienst uit Instellingen (OpenAI-compatibel of lokaal). De AI krijgt alleen
   de samenvattende cijfers die IDA al toont. Hij legt uit; profielwaarden berekent IDA zelf. */
let _aiMsgs = [], _aiSys = "", _aiBusy = false;
async function aiChat(messages, maxTokens){ return aiRequest(messages, maxTokens||500, 0.3); }
function _aiSystem(extra){
  const lang=_AI_LANG[LANG]||"Dutch", ctx=buildAskContext();
  return `You are IDA, a calm, practical assistant for a young adult with type 1 diabetes using AndroidAPS (closed loop, Omnipod Dash, Libre CGM). `+
    `Answer in ${lang}, briefly (max ~120 words unless asked for more), in plain words, no jargon without explanation. Use ONLY the facts below; if they don't contain the answer, say so. Never invent numbers. `+
    `Profile values (basal, ISF, carb ratio) are calculated by IDA with safety rules; you may explain them but never propose other insulin numbers or doses. `+
    `You may suggest habits (carb counting, timing, logging, exercise). Do not add disclaimers about consulting a care team; the user knows. Use mmol/L.\n\nFACTS:\n`+
    (ctx?ctx.text:"(no data)")+(extra?"\n\n"+extra:"");
}
function _profileFacts(P){
  if(!P||!P.basal) return "";
  const f=v=>v==null?"?":(+v).toFixed(2);
  return "IDA PROFILE PROPOSAL ("+_profName()+"), from "+P.days+" usable days:\n"+
    "Basal blocks (start: new U/h, was, reason): "+P.basal.map(b=>`${b.from}: ${f(b.value)} (was ${b.now.map(f).join("/")}; ${b.why==="laag"?"lowered: "+Math.round(b.low*100)+"% of time low":b.act?"loop delivered "+f(b.act[0])+"-"+f(b.act[1])+" U/h when fasting":"no data"})`).join("; ")+
    ". Each basal block starts 1 hour before the need because basal takes ~1 h to act. Daily basal "+f(P.dayNow)+" -> "+f(P.dayNew)+" U (max +30% per step).\n"+
    "ISF blocks: "+P.isf.map(b=>`${b.from}: ${b.value} (was ${b.now})`).join("; ")+". ISF estimates: "+P.isfEst.map(e=>`${e.k} ${e.v.toFixed(2)}`).join(", ")+".\n"+
    "Carb ratio blocks: "+P.ic.map(b=>`${b.from}: ${b.value} (was ${b.now}; measured ${b.measured!=null?b.measured.toFixed(2):"?"} over ${b.n} meals; status ${b.why})`).join("; ")+
    ". Carb ratio is not made stronger when glucose rises more than 115% of what entered carbs explain (seen "+(P.mfrac?Math.round(P.mfrac*100)+"%":"?")+"), because that points to under-counting carbs.\n"+
    "Autosens at its maximum "+(P.sensMax!=null?Math.round(P.sensMax*100)+"% of the time":"unknown")+"; mean autosens "+(P.sensMean?P.sensMean.toFixed(2):"?")+". Total daily dose "+(P.tdd?P.tdd.toFixed(1):"?")+" U.";
}
function openAI(title, extra, first){
  const d=_idaEl("aiSheet"); _idaEl("aiTitle").textContent=title;
  _aiMsgs=[]; _aiSys=_aiSystem(extra); _idaEl("aiLog").innerHTML="";
  if(!aiEnabled()){
    _idaEl("aiLog").innerHTML=`<div class="aimsg sys">${TL("Stel eerst je AI-dienst in bij Instellingen ⚙ → AI-assistent: adres, model en sleutel. Met een lokaal model (Ollama, LM Studio) blijven je gegevens op je eigen apparaat.","First set up your AI service under Settings ⚙ → AI assistant: address, model and key. With a local model your data stays on your device.","Configure primeiro o serviço de IA nas Definições.")}</div><button class="ibtn acc" id="aiToCfg">${TL("Naar Instellingen","Open settings","Abrir definições")}</button>`;
    _idaEl("aiToCfg").onclick=()=>{ closeAI(); document.getElementById("btnCfg").click(); };
    _idaEl("aiForm").hidden=true;
  } else _idaEl("aiForm").hidden=false;
  try{ d.showModal(); }catch(_){ d.setAttribute("open",""); }
  if(first && aiEnabled()) aiSend(first);
}
function closeAI(){ const d=_idaEl("aiSheet"); try{ d.close(); }catch(_){ d.removeAttribute("open"); } }
function _aiRender(){
  _idaEl("aiLog").innerHTML=_aiMsgs.map(m=>`<div class="aimsg ${m.role==="user"?"me":"ai"}">${esc(m.content).replace(/\n/g,"<br>")}</div>`).join("")+(_aiBusy?`<div class="aimsg ai busy">${TL("IDA denkt na…","IDA is thinking…","IDA está a pensar…")}</div>`:"");
  const l=_idaEl("aiLog"); l.scrollTop=l.scrollHeight;
}
async function aiSend(text){
  text=(text||"").trim(); if(!text||_aiBusy) return;
  _aiMsgs.push({role:"user",content:text}); _aiBusy=true; _aiRender();
  try{ const a=await aiChat([{role:"system",content:_aiSys},..._aiMsgs.slice(-10)]); _aiMsgs.push({role:"assistant",content:a||TL("Geen antwoord ontvangen.","No answer received.","Sem resposta.")}); }
  catch(e){ _aiMsgs.push({role:"assistant",content:TL("Er ging iets mis met je AI-dienst: ","Your AI service failed: ","O serviço de IA falhou: ")+e.message}); }
  _aiBusy=false; _aiRender();
}
// Doorvragen op elke kaart (assistent-kaarten en bevindingen)
document.addEventListener("click",e=>{
  const b=e.target.closest&&e.target.closest("[data-idaask]"); if(!b) return;
  e.preventDefault();
  const card=b.closest(".f,.icard,.itile"); const txt=card?card.innerText.replace(/Vraag door ›|Ask more ›|Perguntar ›/g,"").replace(/\s+/g," ").trim().slice(0,600):"";
  openAI(TL("Vraag door","Ask more","Perguntar"), "THE CARD THE USER ASKS ABOUT: "+txt+(b.dataset.idaask==="profiel"?"\n\n"+_profileFacts(_P):""), null);
  setTimeout(()=>{ const i=_idaEl("aiIn"); if(i){ i.placeholder=TL("Bijv. wat kan ik hieraan doen?","E.g. what can I do about this?","Ex.: o que posso fazer?"); i.focus(); } },50);
});

/* ── Weekoverzicht ──────────────────────────────────────────────────────── */
function weekStats(c, endTs){
  const from=endTs-7*864e5;
  const g=c.glucose.filter(x=>x.ts>=from&&x.ts<endTs&&c.q.usableKeys.has(localDayKey(x.ts)));
  if(g.length<288*3) return null;
  const m=metrics(g), days=new Set(g.map(x=>localDayKey(x.ts))).size;
  const carbs=c.treatments.filter(t=>t.carbs>0&&t.ts>=from&&t.ts<endTs&&c.q.usableKeys.has(localDayKey(t.ts))).reduce((s,t)=>s+t.carbs,0);
  const ds=_dsAll.filter(d=>d.ts>=from&&d.ts<endTs&&d.sens!=null), top=ds.length?Math.max(...ds.map(d=>d.sens)):0;
  return { days, tir:m.tir, tbr:m.tbr, vlow:m.veryLow, tar:m.tar, cv:m.cv, mean:m.mean, carbsDay:carbs/Math.max(1,days),
    smax:(ds.length&&top>=1.1)?ds.filter(d=>d.sens>=top-0.005).length/ds.length:null };
}
function weekReview(c){
  const end=c.glucose[c.glucose.length-1].ts, A=weekStats(c,end), B=weekStats(c,end-7*864e5);
  if(!A) return null;
  const better=[], worse=[];
  if(B){ if(A.tir-B.tir>=0.03) better.push(TL(`tijd in bereik ${_idaPct(B.tir)} → ${_idaPct(A.tir)}`,`time in range ${_idaPct(B.tir)} → ${_idaPct(A.tir)}`,`tempo no alvo ${_idaPct(B.tir)} → ${_idaPct(A.tir)}`));
    else if(B.tir-A.tir>=0.03) worse.push(TL(`tijd in bereik ${_idaPct(B.tir)} → ${_idaPct(A.tir)}`,`time in range ${_idaPct(B.tir)} → ${_idaPct(A.tir)}`,`tempo no alvo ${_idaPct(B.tir)} → ${_idaPct(A.tir)}`));
    if(B.tbr-A.tbr>=0.01) better.push(TL(`minder laag (${_idaN(B.tbr*100)}% → ${_idaN(A.tbr*100)}%)`,`fewer lows (${_idaN(B.tbr*100)}% → ${_idaN(A.tbr*100)}%)`,`menos baixas`));
    else if(A.tbr-B.tbr>=0.01) worse.push(TL(`meer laag (${_idaN(B.tbr*100)}% → ${_idaN(A.tbr*100)}%)`,`more lows (${_idaN(B.tbr*100)}% → ${_idaN(A.tbr*100)}%)`,`mais baixas`));
    if(B.cv-A.cv>=0.02) better.push(TL(`stabieler (variatie ${_idaPct(B.cv)} → ${_idaPct(A.cv)})`,`steadier (CV ${_idaPct(B.cv)} → ${_idaPct(A.cv)})`,`mais estável`));
    else if(A.cv-B.cv>=0.02) worse.push(TL(`grilliger (variatie ${_idaPct(B.cv)} → ${_idaPct(A.cv)})`,`more variable (CV ${_idaPct(B.cv)} → ${_idaPct(A.cv)})`,`mais variável`)); }
  let focus;
  if(A.tbr>0.04||A.vlow>0.01) focus=TL("Minder laagtes: kijk bij Patronen wanneer ze vallen.","Fewer lows: check Patterns for when they happen.","Menos baixas.");
  else if(_P&&_P.changed&&!_idaActivation()) focus=TL("Zet je nieuwe profiel in AAPS en tik op 'Ik heb het profiel geactiveerd'.","Set your new profile in AAPS and tap 'I've activated the profile'.","Ative o novo perfil.");
  else if(_P&&_P.mfrac>1.15) focus=TL(`Na het eten stijg je meer dan je ingevoerde koolhydraten verklaren (${_idaPct(_P.mfrac)}). Klopt je telling, dan is je KH-ratio waarschijnlijk te zwak: vraag IDA bij Profiel om hem te toetsen.`,`After meals you rise more than your entered carbs explain (${_idaPct(_P.mfrac)}). If your counting is right, your carb ratio is probably too weak: ask IDA in Profile to check it.`,`Depois de comer sobe mais do que os hidratos explicam (${_idaPct(_P.mfrac)}).`);
  else if(A.tar>0.25) focus=TL("Minder hoog: kijk bij Patronen in welke uren je het vaakst boven 10 zit.","Fewer highs: check Patterns for your high hours.","Menos altas.");
  else focus=TL("Zo doorgaan; log sport en ziek zijn met de +-knop.","Keep going; log exercise and illness with the + button.","Continue assim.");
  return { A, B, better, worse, focus };
}
function weekCardHtml(R){
  const row=(lab,a,b,fmt)=>`<div class="imrow"><span>${lab}</span><span><b>${fmt(a)}</b>${b!=null?` <i>(${TL("week ervoor","prev. week","semana anterior")} ${fmt(b)})</i>`:""}</span></div>`;
  const B=R.B||{};
  return `<b class="ittl">${TL("Weekoverzicht","Weekly review","Resumo semanal")}</b><span class="its">${TL(`laatste 7 dagen (${R.A.days} bruikbaar)`,`last 7 days (${R.A.days} usable)`,`últimos 7 dias`)}</span>
    ${row(TL("In bereik","In range","No alvo"),R.A.tir,B.tir,_idaPct)}${row(TL("Laag","Low","Baixa"),R.A.tbr,B.tbr,v=>v==null?"—":_idaN(v*100)+"%")}${row(TL("Boven 10","Above 10","Acima de 10"),R.A.tar,B.tar,_idaPct)}${row(TL("Variatie","Variability","Variabilidade"),R.A.cv,B.cv,_idaPct)}
    ${R.better.length?`<span class="its big">✓ ${R.better.join(", ")}</span>`:""}${R.worse.length?`<span class="its big">! ${R.worse.join(", ")}</span>`:""}
    <span class="its big"><b>${TL("Focus deze week:","Focus this week:","Foco:")}</b> ${R.focus}</span>
    <div id="weekAI"></div>
    <div class="icacts"><button class="ibtn acc" id="weekAIbtn">${TL("Samenvatting door IDA","Summary by IDA","Resumo pela IDA")}</button><button class="ibtn" data-idaask="week">${TL("Vraag door","Ask more","Perguntar")} ›</button></div>`;
}
async function weekAISummary(R){
  const host=_idaEl("weekAI"); if(!host) return;
  if(!aiEnabled()){ openAI(TL("Weekoverzicht","Weekly review","Resumo semanal"),"",null); return; }
  const key="ida.week."+localDayKey(Date.now());
  let txt=null; try{ txt=localStorage.getItem(key); }catch(_){}
  if(!txt){ host.innerHTML=`<span class="its">${TL("IDA schrijft je samenvatting…","IDA is writing your summary…","A escrever…")}</span>`;
    const facts=`WEEK REVIEW (last 7 days vs the week before): TIR ${_idaPct(R.A.tir)} vs ${R.B?_idaPct(R.B.tir):"?"}; low <3.9 ${_idaN(R.A.tbr*100)}% vs ${R.B?_idaN(R.B.tbr*100)+"%":"?"}; <3.0 ${_idaN(R.A.vlow*100)}%; >10 ${_idaPct(R.A.tar)} vs ${R.B?_idaPct(R.B.tar):"?"}; CV ${_idaPct(R.A.cv)} vs ${R.B?_idaPct(R.B.cv):"?"}; logged carbs ${Math.round(R.A.carbsDay)} g/day; autosens at max ${R.A.smax!=null?_idaPct(R.A.smax):"?"}. Rule-based focus: ${R.focus}\n`+_profileFacts(_P);
    try{ txt=await aiChat([{role:"system",content:_aiSystem(facts)},{role:"user",content:TL("Schrijf mijn weekoverzicht in 3 korte alinea's: wat ging goed, wat vraagt aandacht, en één concrete focus voor komende week.","Write my weekly review in 3 short paragraphs: what went well, what needs attention, and one concrete focus for next week.","Escreva o meu resumo semanal em 3 parágrafos curtos.")}],400);
      try{ localStorage.setItem(key,txt); }catch(_){} }
    catch(e){ host.innerHTML=`<span class="its">${TL("AI-dienst gaf een fout: ","AI service error: ","Erro: ")}${esc(e.message)}</span>`; return; } }
  host.innerHTML=`<div class="aiweek">${esc(txt).replace(/\n/g,"<br>")}</div>`;
}

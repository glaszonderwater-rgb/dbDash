"use strict";
/* IDA — extra functies: experiment, loop-limieten, hypo-analyse, rijcheck, GRI, reizen, alcohol,
   ziek/stress, voorraad, ziek-kaart, sportvoorbereiding, logboek naar Nightscout, back-up, CSV,
   rapport-sectie, automatisch synchroniseren. Klassiek script; gebruikt core.js, ida.js en index.html. */

const _H = 3600e3, _D = 864e5;
const _usable = (c, ts) => c.q.usableKeys.has(localDayKey(ts));

/* ── GRI (Glycemia Risk Index, Klonoff 2023) ─────────────────────────────── */
function griOf(g){
  if(!g.length) return null; const n=g.length, P=f=>g.filter(f).length/n*100;
  const vlow=P(x=>x.bg<VLO_T), low=P(x=>x.bg>=VLO_T&&x.bg<LO_T), vhigh=P(x=>x.bg>VHI_T), high=P(x=>x.bg>HI_T&&x.bg<=VHI_T);
  const gri=Math.min(100, 3.0*vlow + 2.4*low + 1.6*vhigh + 0.8*high);
  return { gri, zone:"ABCDE"[Math.min(4,Math.floor(gri/20))], hypo:vlow+0.8*low, hyper:vhigh+0.5*high };
}

/* ── Hypo-analyse: stapeling vooraf en overbehandeling erna ─────────────── */
function hypoDeep(c){
  const g=c.glucose.filter(x=>_usable(c,x.ts)); const hy=hypoStats(g); if(!hy||!hy.eps||hy.eps.length<3) return null;
  const T=c.glucose.map(x=>x.ts), at=ts=>{ let lo=0,hi=T.length; while(lo<hi){const m=(lo+hi)>>1; if(T[m]<ts)lo=m+1;else hi=m;} return lo; };
  let stacked=0, rebound=0, iobs=[], smbs=[];
  for(const e of hy.eps){
    const smb2=c.treatments.filter(t=>t.isSMB&&t.insulin>0&&t.ts>=e.start-2*_H&&t.ts<e.start).reduce((s,t)=>s+t.insulin,0);
    smbs.push(smb2); if(smb2>=1) stacked++;
    try{ iobs.push(reconstructIOB(c.treatments,e.start,PEAK_MIN,c.timeline)); }catch(_){}
    let mx=-1; for(let i=at(e.end); i<T.length && T[i]<=e.end+2*_H; i++) mx=Math.max(mx,c.glucose[i].bg);
    if(mx>HI_T) rebound++;
  }
  // typische IOB als vergelijking: willekeurige momenten op bruikbare dagen
  const ref=[]; for(let i=0;i<g.length;i+=Math.max(1,Math.floor(g.length/400))){ try{ ref.push(reconstructIOB(c.treatments,g[i].ts,PEAK_MIN,c.timeline)); }catch(_){ } }
  return { n:hy.eps.length, stacked, rebound, iobMed:_pMed(iobs), iobRef:_pMed(ref), smbMed:_pMed(smbs) };
}

/* ── Maaltijdbolus bij dalende glucose: hoe vaak volgde een hypo? ───────── */
// Een bolus op een lage of dalende waarde (onder 7 en zakkend, of AAPS voorspelt onder 5) gaf
// bij jou vaker een hypo. De bolus-calculator kijkt niet naar de trend; jij kunt dat wel.
const _ALC=/\b(bier|pils|wijn|alcohol|cocktail|wodka|whisky|rum|gin|cider|prosecco|champagne|beer|wine)\b/i;
function mealBolusRisk(c){
  const g=c.glucose, T=g.map(x=>x.ts), at=ts=>{ let lo=0,hi=T.length; while(lo<hi){const m=(lo+hi)>>1; if(T[m]<ts)lo=m+1;else hi=m;} return lo; };
  const bol=c.treatments.filter(t=>t.insulin>=1&&!t.isSMB&&_usable(c,t.ts)), carbs=c.treatments.filter(t=>t.carbs>0);
  const res={ fall:{n:0,hypo:0}, ok:{n:0,hypo:0}, alc:{n:0,hypo:0}, last:null };
  for(const b of bol){
    const cs=carbs.filter(x=>Math.abs(x.ts-b.ts)<=30*60e3); if(!cs.length) continue;
    const i=at(b.ts); if(i>=T.length||Math.abs(T[i]-b.ts)>10*60e3) continue;
    const j=at(b.ts-20*60e3); if(j>=i) continue;
    const bg=g[i].bg, slope=(g[i].bg-g[j].bg)/((T[i]-T[j])/60000);      // mmol/L per min
    const ds=_dsAll.find(d=>d.ev!=null&&d.ts>=b.ts-10*60e3&&d.ts<=b.ts);
    let mn=99; for(let k=i;k<T.length&&T[k]<=b.ts+4*_H;k++) mn=Math.min(mn,g[k].bg);
    const hypo=mn<LO_T, falling=(bg<7&&slope<-0.03)||(ds&&ds.ev<5), alc=cs.some(x=>_ALC.test((x.notes||"")+" "+((x.raw&&x.raw.notes)||"")));
    const o=falling?res.fall:res.ok; o.n++; if(hypo) o.hypo++;
    if(alc){ res.alc.n++; if(hypo) res.alc.hypo++; }
    if(falling&&hypo&&(!res.last||b.ts>res.last.ts)) res.last={ts:b.ts,bg,slope,min:mn};
  }
  return res.fall.n+res.ok.n>=8?res:null;
}

/* ── Loop-limieten: wilde de loop meer dan hij gaf? ─────────────────────── */
function loopLimits(c){
  const ds=_dsAll.filter(d=>d.insReq!=null && d.iob!=null && _usable(c,d.ts)); if(ds.length<500) return null;
  const smbT=c.treatments.filter(t=>t.isSMB&&t.insulin>0).map(t=>t.ts).sort((a,b)=>a-b);
  const gotSmb=ts=>{ let lo=0,hi=smbT.length; while(lo<hi){const m=(lo+hi)>>1; if(smbT[m]<ts-60e3)lo=m+1;else hi=m;} return lo<smbT.length&&smbT[lo]<=ts+6*60e3; };
  const T=c.glucose.map(x=>x.ts), bgAt=ts=>{ let lo=0,hi=T.length; while(lo<hi){const m=(lo+hi)>>1; if(T[m]<ts)lo=m+1;else hi=m;} const j=Math.min(lo,T.length-1); return Math.abs(T[j]-ts)<10*60e3?c.glucose[j].bg:null; };
  let want=0, held=0; const heldIob=[];
  for(const d of ds){ const bg=bgAt(d.ts); if(bg==null||bg<=HI_T) continue; if(d.insReq<0.2) continue;
    want++; if(!gotSmb(d.ts)){ held++; heldIob.push(d.iob); } }
  if(want<50) return { few:true, want };
  const iobAll=ds.map(d=>d.iob).sort((a,b)=>a-b), p95=iobAll[Math.floor(iobAll.length*0.95)], p99=iobAll[Math.floor(iobAll.length*0.99)];
  const hs=heldIob.sort((a,b)=>a-b), hHigh=hs.length?hs[Math.floor(hs.length*0.75)]:null;
  // plafond: hoog en scherp afgekapt (p99 dicht bij p95) én vaak tegengehouden bij die IOB
  const ceiling = (p99-p95<0.6 && hHigh!=null && hHigh>=p95-0.5) ? p99 : null;
  return { want, held, heldFrac:held/want, p95, p99, ceiling };
}
function maxIobAdvice(c){
  if(!_P||!_P.basal) return null;
  const base=_P.maxIobMin+(_P.mealBolus||0), L=loopLimits(c);
  let v=Math.ceil(base*2)/2, why=TL("3× je hoogste basaal plus je gemiddelde maaltijdbolus","3× your highest basal plus your average meal bolus","3× o basal mais alto mais o bólus médio");
  if(L&&L.ceiling&&L.heldFrac>0.3&&v<=L.ceiling+0.5){ v=Math.ceil((L.ceiling+1)*2)/2; why=TL(`je loop liep vaak vast rond ${_idaN(L.ceiling)} E IOB`,`your loop often got stuck around ${_idaN(L.ceiling)} U IOB`,`o loop ficou preso perto de ${_idaN(L.ceiling)} U`); }
  return { v, why, L };
}

/* ── Experiment: avondbolus eerder ──────────────────────────────────────── */
function _expActive(){ return (_idaAnns||[]).filter(a=>a.type==="experiment").sort((a,b)=>b.ts-a.ts)[0]||null; }
function expMeals(c, from, to, lo, hi){
  let MR=null; try{ MR=mealResults(c.glucose,c.treatments,c.timeline); }catch(_){ return []; }
  return (MR&&MR.results||[]).filter(r=>r.ts>=from&&r.ts<to&&todMin(r.ts)>=lo*60&&todMin(r.ts)<hi*60&&_usable(c,r.ts));
}
function expStats(ms, c){
  if(!ms.length) return null;
  const T=c.glucose.map(x=>x.ts); let n=0,inr=0;
  for(const r of ms){ let lo=0,hi=T.length; while(lo<hi){const m=(lo+hi)>>1; if(T[m]<r.ts)lo=m+1;else hi=m;}
    for(let j=lo;j<T.length&&T[j]<=r.ts+4*_H;j++){ n++; if(c.glucose[j].bg<=HI_T&&c.glucose[j].bg>=LO_T) inr++; } }
  const offs=ms.map(r=>r.bolusOffset).filter(x=>x!=null);
  const t50s=ms.map(r=>r.t50).filter(x=>x!=null);
  return { n:ms.length, t50:t50s.length>=4?_pMed(t50s):null, rise:_pMed(ms.map(r=>r.peakRise)), tir:n?inr/n:null, off:offs.length?_pMed(offs):null, early:offs.length?offs.filter(o=>o<=-8).length/offs.length:null };
}
/* Hoe ver vooruit bolussen: hangt af van hoe snel jóuw avondeten wordt opgenomen (t50 = half opgenomen). */
function expPre(S){
  const t=S&&S.t50;
  if(t==null) return { lo:10, hi:15, why:"" };
  if(t>90) return { lo:5, hi:10, why:TL(`Je avondeten wordt traag opgenomen (half na ${Math.round(t)} min), dus niet te vroeg.`,`Your dinner absorbs slowly (half after ${Math.round(t)} min), so not too early.`,`O jantar é absorvido devagar (metade após ${Math.round(t)} min).`) };
  if(t<60) return { lo:15, hi:20, why:TL(`Je avondeten wordt snel opgenomen (half na ${Math.round(t)} min).`,`Your dinner absorbs quickly (half after ${Math.round(t)} min).`,`O jantar é absorvido depressa (metade após ${Math.round(t)} min).`) };
  return { lo:10, hi:15, why:TL(`Half opgenomen na ${Math.round(t)} min.`,`Half absorbed after ${Math.round(t)} min.`,`Metade absorvida após ${Math.round(t)} min.`) };
}
function expCardHtml(c){
  const ex=_expActive(), now=Date.now();
  if(!ex){
    // voorstel op basis van je data
    const ms=expMeals(c, now-60*_D, now, 16, 22), S=expStats(ms,c); const hs=_hourStats(c);
    const eve=_pMean(hs.slice(18,22).map(h=>h.hi));
    if(!S||S.n<6) return "";
    const PR=expPre(S);
    return `<section class="itile wide"><b class="ittl">${TL("Experiment voor je avonden","Experiment for your evenings","Experiência para as noites")}</b>
      <span class="its big">${TL(`Na het avondeten zit je ${_idaPct(eve)} van de tijd boven 10. Je bolust nu ${S.off!=null?(S.off<-5?Math.round(-S.off)+" min vóór":S.off>5?Math.round(S.off)+" min ná":"rond"):"rond"} het eten. Probeer 14 dagen ${PR.lo}–${PR.hi} minuten vóór het avondeten te bolussen, behalve als je al daalt. ${PR.why}`,`After dinner you're above 10 for ${_idaPct(eve)} of the time. You now bolus ${S.off!=null&&S.off<-5?Math.round(-S.off)+" min before":"around"} eating. Try bolusing ${PR.lo}–${PR.hi} minutes before dinner for 14 days, unless you're already falling. ${PR.why}`,`Depois do jantar está acima de 10 em ${_idaPct(eve)} do tempo. Experimente 14 dias o bólus ${PR.lo}–${PR.hi} min antes do jantar, exceto se já estiver a descer. ${PR.why}`)}</span>
      <span class="its">${TL(`Uitgangspunt (laatste 60 dagen, ${S.n} maaltijden): stijging ${_idaN(S.rise)} mmol/L, ${_idaPct(S.tir)} in bereik in de 4 uur erna.`,`Baseline (last 60 days, ${S.n} meals): rise ${_idaN(S.rise)} mmol/L, ${_idaPct(S.tir)} in range in the 4 h after.`,`Base: subida ${_idaN(S.rise)}, ${_idaPct(S.tir)} no alvo.`)}</span>
      <div class="icacts"><button class="ibtn acc" id="expStart">${TL("Start experiment","Start experiment","Iniciar experiência")}</button></div></section>`;
  }
  const day=Math.floor((now-ex.ts)/_D), done=day>=14;
  const after=expStats(expMeals(c, ex.ts, Math.min(now, ex.ts+14*_D), 16, 22),c), before=ex.base||null;
  let verdict="";
  if(done && after && before && after.n>=5){
    const dT=(after.tir-before.tir), dR=(after.rise-before.rise);
    verdict = (dT>=0.05||dR<=-0.7) ? TL("Verbeterd: hou dit vast.","Improved: keep it up.","Melhorou.") : (dT<=-0.05||dR>=0.7) ? TL("Slechter: terug naar je oude moment.","Worse: go back to your old timing.","Pior.") : TL("Geen duidelijk verschil.","No clear difference.","Sem diferença clara.");
  } else if(done) verdict=TL("Te weinig avondmaaltijden met bolus om te beoordelen.","Too few evening meals with a bolus to judge.","Poucas refeições.");
  const row=(lab,a,b,f)=>`<div class="imrow"><span>${lab}</span><span><b>${a==null?"—":f(a)}</b>${b!=null?` <i>(${TL("was","was","era")} ${f(b)})</i>`:""}</span></div>`;
  return `<section class="itile wide"><b class="ittl">${TL("Experiment: eerder bolussen bij het avondeten","Experiment: earlier dinner bolus","Experiência: bólus mais cedo ao jantar")}</b>
    <span class="its">${done?TL("Afgelopen","Finished","Concluída"):TL(`Dag ${day} van 14`,`Day ${day} of 14`,`Dia ${day} de 14`)}</span>
    ${row(TL("Bolus vóór het eten","Bolus before eating","Bólus antes"),after&&after.off!=null?-after.off:null,before&&before.off!=null?-before.off:null,v=>Math.round(v)+" min")}
    ${row(TL("Stijging na het eten","Rise after eating","Subida"),after&&after.rise,before&&before.rise,v=>_idaN(v)+" mmol/L")}
    ${row(TL("In bereik 4 uur erna","In range 4 h after","No alvo 4 h"),after&&after.tir,before&&before.tir,_idaPct)}
    ${verdict?`<span class="its big"><b>${verdict}</b></span>`:""}
    <div class="icacts"><button class="ibtn" id="expStop">${done?TL("Afsluiten","Close","Fechar"):TL("Stoppen","Stop","Parar")}</button></div></section>`;
}
async function expStart(c){
  const now=Date.now(), base=expStats(expMeals(c, now-60*_D, now, 16, 22),c), PR=expPre(base);
  const an={ id:"exp-"+now, ts:now, type:"experiment", note:TL(`Experiment: bolus ${PR.lo}–${PR.hi} min vóór het avondeten`,`Experiment: bolus ${PR.lo}–${PR.hi} min before dinner`,`Experiência: bólus ${PR.lo}–${PR.hi} min antes do jantar`), created:now, base, pre:PR };
  await DB.putMany("annotations",[an]); _idaAnns.push(an); toast(TL(`Experiment gestart. Bolus de komende 14 dagen ${PR.lo}–${PR.hi} min vóór het avondeten, behalve als je al daalt.`,"Experiment started.","Experiência iniciada.")); idaExtrasTeam(c);
}
async function expStop(){ const ex=_expActive(); if(!ex) return; await DB.delRow("annotations",ex.id); _idaAnns=_idaAnns.filter(a=>a.id!==ex.id);
  const done={ id:"expdone-"+ex.id, ts:Date.now(), type:"notitie", note:TL("Experiment afgesloten: avondbolus","Experiment closed: dinner bolus","Experiência fechada"), created:Date.now() };
  try{ await DB.putMany("annotations",[done]); }catch(_){} idaExtrasTeam(_ctx); }

/* ── Reizen: tijdzone-periodes tegenover thuis ─────────────────────────── */
function travelStats(c){
  if(!_tzT||_tzT.length<2) return null;
  const segs=[]; for(let i=0;i<_tzT.length;i++) segs.push({ off:_tzO[i], from:_tzT[i], to:i+1<_tzT.length?_tzT[i+1]:Date.now() });
  // Thuis = de tijdzone van Amsterdam op dat moment (zomer- én wintertijd); afwijkend = op reis.
  // één formatter, en per uur onthouden (scheelt seconden: dit wordt voor elke meting gevraagd)
  const F=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Amsterdam",hour:"2-digit",minute:"2-digit",hour12:false,day:"2-digit"}), memo=new Map();
  const amsOff=ts=>{ const k=Math.floor(ts/36e5); let v=memo.get(k); if(v!==undefined) return v; const d=new Date(k*36e5), p=F.formatToParts(d);
    const g=t=>+p.find(x=>x.type===t).value; let diff=(g("hour")%24*60+g("minute"))-(d.getUTCHours()*60+d.getUTCMinutes()); if(g("day")!==d.getUTCDate()) diff+= (diff<0?1440:-1440); memo.set(k,diff); return diff; };
  const isHome=s=>s.off===amsOff((s.from+s.to)/2);
  const dur=new Map(); for(const s of segs) if(!isHome(s)) dur.set(s.off,(dur.get(s.off)||0)+(s.to-s.from));
  const home=null;
  const stat=(test)=>{ const g=c.glucose.filter(x=>test(x.ts)&&_usable(c,x.ts)); if(g.length<288*3) return null; const m=metrics(g);
    const ds=_dsAll.filter(d=>test(d.ts)&&d.sens!=null); return { tir:m.tir, tbr:m.tbr, days:new Set(g.map(x=>localDayKey(x.ts))).size, sens:ds.length?_pMean(ds.map(d=>d.sens)):null }; };
  const inOff=o=>ts=>tzOffsetAt(ts)===o && tzOffsetAt(ts)!==amsOff(ts);
  const H=stat(ts=>tzOffsetAt(ts)===amsOff(ts)); const away=[...dur.keys()].filter(o=>dur.get(o)>=3*_D).map(o=>({off:o, s:stat(inOff(o))})).filter(x=>x.s);
  if(!H||!away.length) return null; return { home, H, away };
}
const _utc = o => "UTC"+(o>=0?"+":"−")+Math.abs(o/60);

/* ── Logs tegenover data: alcohol, ziek, stress ─────────────────────────── */
function logEffects(c){
  const A=_idaAnns||[], out={};
  const alc=[...A.filter(a=>a.type==="alcohol"||_ALC.test(a.note||"")), ...c.treatments.filter(t=>t.carbs>0&&_ALC.test((t.notes||"")+" "+((t.raw&&t.raw.notes)||""))).map(t=>({ts:t.ts}))];
  const nightLow=(day0)=>{ const from=day0, g=c.glucose.filter(x=>x.ts>=from&&x.ts<from+7*_H); return g.length>40?g.filter(x=>x.bg<LO_T).length/g.length:null; };
  const nightStart=ts=>{ const m=todMin(ts); return ts-m*60000+ (m>=18*60?24*60*60000:0); };   // eerstvolgende middernacht (lokaal)
  if(alc.length){ const after=alc.map(a=>nightLow(nightStart(a.ts))).filter(v=>v!=null);
    const all=[]; for(let d=c.q.to-60*_D; d<c.q.to; d+=_D){ const v=nightLow(nightStart(d)); if(v!=null) all.push(v); }
    out.alcohol={ n:after.length, after:after.length?_pMean(after):null, base:all.length?_pMean(all):null }; }
  for(const k of ["ziek","stress"]){ const L=A.filter(a=>a.type===k); if(!L.length) continue;
    const days=new Set(L.map(a=>localDayKey(a.ts)));
    const g1=c.glucose.filter(x=>days.has(localDayKey(x.ts))), g0=c.glucose.filter(x=>!days.has(localDayKey(x.ts))&&_usable(c,x.ts));
    const s1=_dsAll.filter(d=>d.sens!=null&&days.has(localDayKey(d.ts))).map(d=>d.sens), s0=_dsAll.filter(d=>d.sens!=null&&!days.has(localDayKey(d.ts))).map(d=>d.sens);
    out[k]={ days:days.size, tir1:g1.length>100?metrics(g1).tir:null, tir0:g0.length?metrics(g0).tir:null, sens1:s1.length?_pMean(s1):null, sens0:s0.length?_pMean(s0):null }; }
  return out;
}

/* ── Sport: tijdelijke streefwaardes ─────────────────────────────────────── */
function sportTT(c){
  const tts=c.treatments.filter(t=>/temporary target/i.test(t.type||"")).map(t=>{ const r=t.raw||{}; const u=(r.units||"mg/dl").toLowerCase();
    const v=r.targetBottom!=null?+r.targetBottom:null; return { ts:t.ts, dur:(r.durationInMilliseconds!=null?+r.durationInMilliseconds/60000:+(r.duration||0)), v:v==null?null:(u.startsWith("mg")?v/MGDL:v), reason:r.reason||"" }; })
    .filter(x=>x.v!=null&&x.dur>0&&x.v>=6.5);
  if(tts.length<3) return null;
  const T=c.glucose.map(x=>x.ts); let lowN=0;
  for(const tt of tts){ let lo=0,hi=T.length; while(lo<hi){const m=(lo+hi)>>1; if(T[m]<tt.ts)lo=m+1;else hi=m;}
    for(let j=lo;j<T.length&&T[j]<=tt.ts+(tt.dur+120)*60000;j++){ if(c.glucose[j].bg<LO_T){ lowN++; break; } } }
  // Alleen sport-streefwaardes (reden "Activity"); automatische of hypo-streefwaardes zeggen niets over sport.
  const act=tts.filter(t=>/activ|sport|exerc/i.test(t.reason));
  if(act.length<3) return null;
  lowN=0; for(const tt of act){ let lo=0,hi=T.length; while(lo<hi){const m=(lo+hi)>>1; if(T[m]<tt.ts)lo=m+1;else hi=m;}
    for(let j=lo;j<T.length&&T[j]<=tt.ts+(tt.dur+120)*60000;j++){ if(c.glucose[j].bg<LO_T){ lowN++; break; } } }
  return { n:act.length, v:_pMed(act.map(t=>t.v)), dur:_pMed(act.map(t=>t.dur)), lowFrac:lowN/act.length };
}

/* ── Voorraad ────────────────────────────────────────────────────────────── */
function supplies(c){
  const span=Math.max(14,(c.q.to-c.q.from)/_D);
  const pods=c.treatments.filter(t=>/site change|cannula/i.test(t.type||"")).length, sens=c.treatments.filter(t=>/sensor (change|start)/i.test(t.type||"")).length;
  const tdd=(_P&&_P.tdd)||null;
  return { podsMonth:pods/span*30, sensMonth:sens?sens/span*30:null, insMonth:tdd?tdd*30:null, tdd, span };
}

/* ── Rijcheck ────────────────────────────────────────────────────────────── */
function driveCheck(){
  const g=_ctx&&_ctx.glucose; if(!g||!g.length) return null;
  const last=g[g.length-1], age=(Date.now()-last.ts)/60000;
  const prev=g.filter(x=>x.ts>=last.ts-20*60e3), slope=prev.length>=2?(last.bg-prev[0].bg)/((last.ts-prev[0].ts)/60000)*15:0;   // mmol/L per 15 min
  const ds=[..._dsRecent].reverse().find(d=>d.ev!=null&&Math.abs(d.ts-last.ts)<20*60e3);
  const in30=last.bg+slope*2;
  let st="ok", msg;
  if(age>15){ st="stale"; msg=TL(`Je laatste meting is ${Math.round(age)} min oud. Synchroniseer of meet eerst opnieuw.`,`Your last reading is ${Math.round(age)} min old. Sync or check again first.`,`A última leitura tem ${Math.round(age)} min.`); }
  else if(last.bg<5){ st="eat"; msg=TL("Onder 5: eerst eten en wachten tot je boven 5 zit.","Below 5: eat first and wait until you're above 5.","Abaixo de 5: coma primeiro."); }
  else if(in30<5 || (ds&&ds.ev<5)){ st="eat"; msg=TL("Je daalt richting 5 of lager: eet eerst iets voordat je gaat rijden.","You're heading to 5 or lower: eat something before driving.","Está a descer: coma algo antes de conduzir."); }
  else msg=TL("Goed om te rijden. Check onderweg elke 2 uur.","Good to drive. Check every 2 hours on the way.","Pode conduzir. Verifique a cada 2 horas.");
  return { st, msg, bg:last.bg, dir:last.dir, age, in30, ev:ds?ds.ev:null };
}
function openDrive(){
  const d=driveCheck(); if(!d) return;
  const col=d.st==="ok"?"var(--ida-acc)":d.st==="eat"?"var(--low)":"var(--high)";
  _idaEl("aiTitle").textContent=TL("Rijcheck","Driving check","Verificação de condução");
  _idaEl("aiForm").hidden=true;
  _idaEl("aiLog").innerHTML=`<div class="idrive" style="border-color:${col}"><div class="itv"><b style="color:${col}">${_idaN(d.bg)}</b><span>${ARROWS[d.dir]||""} mmol/L · ${Math.round(d.age)} min</span></div>
    <span class="its big"><b>${d.msg}</b></span>
    <span class="its">${TL(`Over ~30 min verwacht: ${_idaN(d.in30)}`,`Expected in ~30 min: ${_idaN(d.in30)}`,`Esperado em ~30 min: ${_idaN(d.in30)}`)}${d.ev!=null?TL(` · AAPS verwacht ${_idaN(d.ev)}`,` · AAPS expects ${_idaN(d.ev)}`,` · AAPS prevê ${_idaN(d.ev)}`):""}</span></div>
    ${d.st==="ok"?`<button class="ibtn acc big" id="driveLog">${TL("Ik ga rijden (vastleggen)","I'm driving (log it)","Vou conduzir (registar)")}</button>`:""}`;
  const s=_idaEl("aiSheet"); try{ s.showModal(); }catch(_){ s.setAttribute("open",""); }
  const b=_idaEl("driveLog"); if(b) b.onclick=async()=>{ const an={id:"drive-"+Date.now(),ts:Date.now(),type:"notitie",note:TL(`Rijden, start ${_idaN(d.bg)} mmol/L`,`Driving, start ${_idaN(d.bg)} mmol/L`,`Condução`),created:Date.now(),src:"drive"};
    try{ await DB.putMany("annotations",[an]); await nsWriteNote(an); }catch(_){} closeAI(); toast(TL("Goede rit.","Drive safely.","Boa viagem.")); };
}

/* ── Logboek naar Nightscout (alleen als je dat aanzet) ─────────────────── */
async function nsWriteNote(an){
  if(!cfg.nsWrite || !cfg.nsWriteToken || !cfg.url) return false;
  const body=[{ eventType:"Note", created_at:new Date(an.ts).toISOString(), notes:"IDA: "+(annotLabel?annotLabel(an.type):an.type)+(an.note?" — "+an.note:""), enteredBy:"IDA" }];
  const r=await fetch(cfg.url.replace(/\/+$/,"")+"/api/v1/treatments.json?token="+encodeURIComponent(cfg.nsWriteToken),{ method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(body) });
  if(!r.ok) throw new Error("HTTP "+r.status); return true;
}

/* ── Export: CSV per dag en back-up ──────────────────────────────────────── */
function dailyCsv(c){
  const by=new Map(); for(const x of c.glucose){ const k=localDayKey(x.ts); (by.get(k)||by.set(k,[]).get(k)).push(x); }
  const carbs=new Map(), ins=new Map(); for(const t of c.treatments){ const k=localDayKey(t.ts); if(t.carbs>0) carbs.set(k,(carbs.get(k)||0)+t.carbs); if(t.insulin>0) ins.set(k,(ins.get(k)||0)+t.insulin); }
  const sep=";", f=v=>v==null?"":String(Math.round(v*1000)/1000).replace(".",",");
  const L=[["datum","bruikbaar","metingen","in_bereik_%","onder_3,9_%","onder_3,0_%","boven_10_%","gemiddeld_mmol","CV_%","GRI","koolhydraten_g","bolus_smb_E"].join(sep)];
  for(const k of [...by.keys()].sort()){ const g=by.get(k), m=metrics(g), r=griOf(g);
    L.push([k, c.q.usableKeys.has(k)?"ja":"nee", g.length, f(m.tir*100), f(m.tbr*100), f(m.veryLow*100), f(m.tar*100), f(m.mean), f(m.cv*100), f(r&&r.gri), f(carbs.get(k)||0), f(ins.get(k)||0)].join(sep)); }
  return "﻿"+L.join("\n");
}
function _download(name, text, type){ const b=new Blob([text],{type}); const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },500); }

/* ── Tekenen ─────────────────────────────────────────────────────────────── */
function idaExtras(c){
  for(const f of [idaExtrasPatronen, idaExtrasVandaag, idaExtrasTeam]){ try{ f(c); }catch(e){ console.error(e); } }
}
function idaExtrasPatronen(c){
  const host=_idaEl("bento"); if(!host) return;
  const tiles=[];
  const g=c.glucose.filter(x=>_usable(c,x.ts)), G=griOf(g);
  if(G) tiles.push(`<article class="itile"><span class="itl">${TL("Risico-index (GRI)","Risk index (GRI)","Índice de risco (GRI)")}</span><b class="itn">${Math.round(G.gri)} <span class="ism">${TL("zone","zone","zona")} ${G.zone}</span></b>
    <svg class="ibars" viewBox="0 0 150 40" aria-hidden="true">${[0,1,2,3,4].map(i=>`<rect x="${2+i*29.6}" y="14" width="27" height="12" rx="3" fill="${["var(--ok)","color-mix(in srgb,var(--ok) 45%,var(--hi))","var(--hi)","color-mix(in srgb,var(--hi) 50%,var(--lo))","var(--lo)"][i]}" opacity="${"ABCDE"[i]===G.zone?1:0.35}"/>`).join("")}</svg>
    <span class="its">${TL(`0 is perfect, 100 slechtst. Laag telt ${_idaN(G.hypo)} mee, hoog ${_idaN(G.hyper)}.`,`0 is perfect, 100 worst. Lows add ${_idaN(G.hypo)}, highs ${_idaN(G.hyper)}.`,`0 é perfeito, 100 o pior.`)}</span></article>`);
  const HD=hypoDeep(c);
  if(HD) tiles.push(`<article class="itile"><span class="itl">${TL("Rond je hypo's","Around your lows","À volta das hipos")}</span><b class="itn lo">${HD.stacked}/${HD.n}</b>
    <span class="its">${TL(`na ≥1 E SMB in de 2 uur ervoor. Actieve insuline bij de start ${_idaN(HD.iobMed)} E (normaal ${_idaN(HD.iobRef)}). Bij ${HD.rebound} schoot je daarna boven 10: vaak te veel opgegeten.`,`after ≥1 U SMB in the 2 h before. Active insulin at onset ${_idaN(HD.iobMed)} U (normally ${_idaN(HD.iobRef)}). ${HD.rebound} times you then went above 10: often over-treated.`,`após ≥1 U de SMB nas 2 h anteriores. ${HD.rebound} vezes subiu acima de 10 depois.`)}</span></article>`);
  const MB=mealBolusRisk(c);
  if(MB && MB.fall.n>=3){ const rf=MB.fall.hypo/MB.fall.n, ro=MB.ok.n?MB.ok.hypo/MB.ok.n:0;
    tiles.push(`<article class="itile wide"><span class="itl">${TL("Bolussen op een dalende waarde","Bolusing on a falling value","Bólus com glicose a descer")}</span>
      <div class="imrow"><span>${TL("Glucose onder 7 en dalend bij de bolus","Glucose under 7 and falling at bolus","Abaixo de 7 e a descer")}</span><span><b>${_idaPct(rf)}</b> <i>${TL(`hypo erna (${MB.fall.hypo}/${MB.fall.n})`,`low after (${MB.fall.hypo}/${MB.fall.n})`,`hipo depois (${MB.fall.hypo}/${MB.fall.n})`)}</i></span></div>
      <div class="imrow"><span>${TL("Anders","Otherwise","Caso contrário")}</span><span><b>${_idaPct(ro)}</b> <i>${TL(`hypo erna (${MB.ok.hypo}/${MB.ok.n})`,`low after (${MB.ok.hypo}/${MB.ok.n})`,`hipo depois`)}</i></span></div>
      ${MB.alc.n?`<div class="imrow"><span>${TL("Met alcohol erbij","With alcohol","Com álcool")}</span><span><b>${_idaPct(MB.alc.hypo/MB.alc.n)}</b> <i>${TL(`hypo erna (${MB.alc.hypo}/${MB.alc.n})`,`low after (${MB.alc.hypo}/${MB.alc.n})`,`hipo depois`)}</i></span></div>`:""}
      <span class="its">${TL(`De bolus-calculator kijkt niet naar je trend. Zak je al vóór het eten, bolus dan pas bij het eten of iets minder. Alcohol remt je lever, dus bolus niet volledig voor de koolhydraten in bier of wijn.${MB.alc.n&&MB.alc.n<5?` (Met alcohol pas ${MB.alc.n}× gezien: nog geen vast patroon.)`:""}`,"The bolus calculator ignores your trend. If you're already falling before eating, bolus at the meal or a bit less. Alcohol slows your liver, so don't fully bolus for beer or wine carbs.","A calculadora ignora a tendência. Se já está a descer, faça o bólus à refeição ou um pouco menos. O álcool trava o fígado: não faça bólus completo para cerveja ou vinho.")}</span></article>`); }
  const L=loopLimits(c);
  if(L && !L.few) tiles.push(`<article class="itile"><span class="itl">${TL("Loop wil meer dan hij mag","Loop wants more than allowed","Loop quer mais do que pode")}</span><b class="itn hi">${_idaPct(L.heldFrac)}</b>
    <span class="its">${TL(`van de momenten boven 10 waarop de loop insuline wilde, kwam er geen SMB.${L.ceiling?` Je actieve insuline stopte dan rond ${_idaN(L.ceiling)} E: waarschijnlijk je max IOB.`:""}`,`of moments above 10 where the loop wanted insulin, no SMB followed.${L.ceiling?` Active insulin topped out near ${_idaN(L.ceiling)} U: probably your max IOB.`:""}`,`dos momentos acima de 10, o loop não deu SMB.`)}</span></article>`);
  const TR=travelStats(c);
  if(TR) tiles.push(`<article class="itile wide"><span class="itl">${TL("Reizen","Travel","Viagens")}</span>`+
    `<div class="imrow"><span>${TL("Thuis (Amsterdam)","Home (Amsterdam)","Casa (Amesterdão)")}</span><span><b>${_idaPct(TR.H.tir)}</b> <i>${TL("in bereik","in range","no alvo")} · autosens ${_idaN(TR.H.sens,2)}</i></span></div>`+
    TR.away.map(a=>`<div class="imrow"><span>${_utc(a.off)} · ${a.s.days} ${TL("dagen","days","dias")}</span><span><b>${_idaPct(a.s.tir)}</b> <i>${TL("in bereik","in range","no alvo")} · autosens ${_idaN(a.s.sens,2)}</i></span></div>`).join("")+
    `<span class="its">${TL("Autosens boven 1 betekent dat je loop je minder gevoelig vindt (bijvoorbeeld door warmte, ander eten of minder bewegen).","Autosens above 1 means your loop sees you as less sensitive (heat, other food, less activity).","Autosens acima de 1 = menos sensível.")}</span></article>`);
  const LE=logEffects(c);
  if(LE.alcohol) tiles.push(`<article class="itile"><span class="itl">${TL("Nacht na alcohol","Night after alcohol","Noite após álcool")}</span><b class="itn">${LE.alcohol.after!=null?_idaN(LE.alcohol.after*100)+"%":"—"}</b><span class="its">${TL(`laag in de nacht erna (${LE.alcohol.n}×), normaal ${LE.alcohol.base!=null?_idaN(LE.alcohol.base*100)+"%":"—"}`,`low the night after (${LE.alcohol.n}×), normally ${LE.alcohol.base!=null?_idaN(LE.alcohol.base*100)+"%":"—"}`,`baixa na noite seguinte`)}</span></article>`);
  for(const k of ["ziek","stress"]) if(LE[k]&&LE[k].tir1!=null) tiles.push(`<article class="itile"><span class="itl">${k==="ziek"?TL("Als je ziek bent","When you're ill","Quando doente"):TL("Bij stress","With stress","Com stress")}</span><b class="itn">${_idaPct(LE[k].tir1)}</b><span class="its">${TL(`in bereik op ${LE[k].days} gelogde dag(en), anders ${_idaPct(LE[k].tir0)}. Autosens ${_idaN(LE[k].sens1,2)} tegen ${_idaN(LE[k].sens0,2)}.`,`in range on ${LE[k].days} logged day(s), otherwise ${_idaPct(LE[k].tir0)}. Autosens ${_idaN(LE[k].sens1,2)} vs ${_idaN(LE[k].sens0,2)}.`,`no alvo nos dias registados.`)}</span></article>`);
  const SP=sportTT(c);
  if(SP) tiles.push(`<article class="itile"><span class="itl">${TL("Tijdelijke streefwaarde","Temporary target","Alvo temporário")}</span><b class="itn">${_idaN(SP.v)} <span class="ism">${Math.round(SP.dur)} min</span></b><span class="its">${TL(`je gebruikelijke sportwaarde (${SP.n}×). Bij ${_idaPct(SP.lowFrac)} kwam je tijdens of in de 2 uur erna toch laag${SP.lowFrac>0.2?": zet hem eerder of hoger":""}.`,`your usual activity target (${SP.n}×). ${_idaPct(SP.lowFrac)} still went low during or within 2 h${SP.lowFrac>0.2?": set it earlier or higher":""}.`,`o seu alvo habitual.`)}</span></article>`);
  host.insertAdjacentHTML("beforeend", tiles.join(""));
}
function idaExtrasVandaag(c){
  // rijcheck-knop in de kop
  const hero=_idaEl("idaHero");
  if(hero && !_idaEl("driveBtn")){ const b=document.createElement("button"); b.id="driveBtn"; b.className="idrivebtn"; b.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17h14M6 17l1.5-5h9L18 17M7 17v2M17 17v2"/><circle cx="8.5" cy="14.5" r=".8"/><circle cx="15.5" cy="14.5" r=".8"/></svg><span>${TL("Rijcheck","Drive check","Condução")}</span>`; b.onclick=openDrive; hero.appendChild(b); }
  else if(_idaEl("driveBtn")) _idaEl("driveBtn").querySelector("span").textContent=TL("Rijcheck","Drive check","Condução");
  const host=_idaEl("assist"); if(!host) return;
  const cards=[];
  const ill=(_idaAnns||[]).filter(a=>a.type==="ziek"&&Date.now()-a.ts<48*_H).sort((a,b)=>b.ts-a.ts)[0];
  if(ill){ const s=_dsAll.filter(d=>d.sens!=null&&d.ts>ill.ts-6*_H).map(d=>d.sens);
    cards.push(`<article class="icard"><div class="icrow"><span class="icic p">${_idaIcon("trend")}</span><span class="ictxt"><b>${TL("Je bent ziek gelogd.","You logged being ill.","Registou doença.")}</b> ${s.length?TL(`Autosens sindsdien gemiddeld ${_idaN(_pMean(s),2)}.`,`Autosens since then averages ${_idaN(_pMean(s),2)}.`,`Autosens médio ${_idaN(_pMean(s),2)}.`):""}</span></div>
      <ul class="ilist"><li>${TL("Blijf drinken, ook als je weinig eet.","Keep drinking, even if you eat little.","Continue a beber.")}</li><li>${TL("Meet ketonen bij glucose boven 14 of als je misselijk bent of overgeeft.","Check ketones above 14 or if you feel sick or vomit.","Meça cetonas acima de 14 ou com náuseas.")}</li><li>${TL("Zet je basaal niet uit; ziek zijn vraagt meestal juist méér insuline.","Don't stop basal; illness usually needs more insulin.","Não pare o basal.")}</li><li>${TL("Bij ketonen boven 1,5 of aanhoudend overgeven: bel direct je diabetesteam of de huisartsenpost.","With ketones above 1.5 or ongoing vomiting: call your diabetes team or out-of-hours GP right away.","Com cetonas acima de 1,5: ligue já.")}</li></ul></article>`); }
  const MB=mealBolusRisk(c);
  if(MB&&MB.last&&Date.now()-MB.last.ts<36*_H){ const hm=fmtMin(todMin(MB.last.ts));
    cards.push(`<article class="icard"><div class="icrow"><span class="icic p">${_idaIcon("food")}</span><span class="ictxt"><b>${TL(`Hypo na je bolus van ${hm}.`,`Low after your ${hm} bolus.`,`Hipo após o bólus das ${hm}.`)}</b> ${TL(`Je zat toen op ${_idaN(MB.last.bg)} en zakte al (${_idaN(MB.last.slope*15)} per kwartier). Daarna kwam je op ${_idaN(MB.last.min)}. Zak je vóór het eten, bolus dan pas bij het eten of iets minder.`,`You were at ${_idaN(MB.last.bg)} and already falling (${_idaN(MB.last.slope*15)} per 15 min). You then reached ${_idaN(MB.last.min)}. If you're falling before a meal, bolus at the meal or a bit less.`,`Estava a ${_idaN(MB.last.bg)} e a descer. Depois chegou a ${_idaN(MB.last.min)}.`)}</span></div><button class="iask" data-idaask="kaart">${TL("Vraag door","Ask more","Perguntar")} ›</button></article>`); }
  let lastExp=null; try{ lastExp=+localStorage.getItem("ida.lastBackup")||null; }catch(_){}
  if((_idaAnns||[]).length>=5 && !cfg.pushUrl && (!lastExp || Date.now()-lastExp>30*_D))   // met eigen server staat de back-up daar al
    cards.push(`<article class="icard"><div class="icrow"><span class="icic t">${_idaIcon("trend")}</span><span class="ictxt"><b>${TL("Maak een back-up van je logboek.","Back up your logbook.","Faça cópia do diário.")}</b> ${TL("Je logs staan alleen op dit apparaat.","Your logs only live on this device.","Os registos só estão neste aparelho.")}</span></div><div class="icacts"><button class="ibtn acc" id="bkNow">${TL("Back-up downloaden","Download backup","Descarregar")}</button></div></article>`);
  if(cards.length){ host.insertAdjacentHTML("beforeend",cards.join("")); const b=_idaEl("bkNow"); if(b) b.onclick=()=>{ document.getElementById("btnExport").click(); try{ localStorage.setItem("ida.lastBackup",String(Date.now())); }catch(_){} b.closest(".icard").remove(); }; }
}
function idaExtrasTeam(c){
  const host=_idaEl("teamTop"); if(!host) return;
  host.querySelectorAll(".ix").forEach(e=>e.remove());
  let html=`<div class="ix">${expCardHtml(c)}</div>`;
  const S=supplies(c);
  html+=`<section class="itile wide ix"><b class="ittl">${TL("Voorraad","Supplies","Material")}</b>
    <div class="imrow"><span>${TL("Pods per maand","Pods per month","Pods por mês")}</span><span><b>${_idaN(S.podsMonth)}</b></span></div>
    ${S.sensMonth!=null?`<div class="imrow"><span>${TL("Sensoren per maand","Sensors per month","Sensores por mês")}</span><span><b>${_idaN(S.sensMonth)}</b></span></div>`:""}
    ${S.insMonth!=null?`<div class="imrow"><span>${TL("Insuline per maand","Insulin per month","Insulina por mês")}</span><span><b>${Math.round(S.insMonth)} ${TL("E","U","U")}</b> <i>(${_idaN(S.tdd)} ${TL("E per dag","U per day","U por dia")})</i></span></div>`:""}
    <div class="imrow"><label for="tripDays" style="text-transform:none;letter-spacing:0;font-size:.82rem;font-weight:400;color:var(--ink);margin:0">${TL("Paklijst voor een reis van","Packing list for a trip of","Lista para uma viagem de")}</label><span><input id="tripDays" class="iinp" type="number" min="1" max="120" value="14"> ${TL("dagen","days","dias")}</span></div>
    <div id="tripList" class="its big"></div></section>`;
  html+=`<div class="igrid2 ix"><button class="itile sm tap" id="csvBtn"><b class="ittl">${TL("Export (CSV)","Export (CSV)","Exportar (CSV)")}</b><span class="its">${TL("cijfers per dag","figures per day","valores por dia")}</span></button><button class="itile sm tap" id="bkBtn"><b class="ittl">${TL("Back-up","Backup","Cópia")}</b><span class="its">${TL("logboek downloaden","download logbook","descarregar diário")}</span></button></div>`;
  host.insertAdjacentHTML("beforeend",html);
  const trip=()=>{ const n=Math.max(1,Math.min(120,parseInt(_idaEl("tripDays").value,10)||14)), x=1.5;   // 50% reserve
    const podDays=S.podsMonth>0.5?30/S.podsMonth:3, sensDays=S.sensMonth>0.3?30/S.sensMonth:14;   // jouw eigen wisselritme
    const pods=Math.ceil(n/podDays*x+1), sens=S.sensMonth!=null?Math.ceil(n/sensDays*x+1):null, ins=S.tdd?Math.ceil(S.tdd*n*x/100)*100:null;
    _idaEl("tripList").innerHTML=TL(`Neem mee (met 50% reserve): <b>${pods} pods</b>${sens!=null?`, <b>${sens} sensoren</b>`:""}${ins!=null?`, <b>${ins} E insuline</b>`:""}, een insulinepen met naalden als back-up, hypo-snacks en ketonstrips.`,`Take (with 50% spare): <b>${pods} pods</b>${sens!=null?`, <b>${sens} sensors</b>`:""}${ins!=null?`, <b>${ins} U insulin</b>`:""}, a backup insulin pen with needles, hypo snacks and ketone strips.`,`Leve (com 50% de reserva): <b>${pods} pods</b>${sens!=null?`, <b>${sens} sensores</b>`:""}${ins!=null?`, <b>${ins} U de insulina</b>`:""}, caneta de reserva, snacks e tiras de cetonas.`); };
  _idaEl("tripDays").oninput=trip; trip();
  const st=_idaEl("expStart"); if(st) st.onclick=()=>expStart(c);
  const sp=_idaEl("expStop"); if(sp) sp.onclick=()=>expStop();
  _idaEl("csvBtn").onclick=()=>_download(`IDA-dagen-${localDayKey(Date.now())}.csv`, dailyCsv(c), "text/csv;charset=utf-8");
  _idaEl("bkBtn").onclick=()=>{ document.getElementById("btnExport").click(); try{ localStorage.setItem("ida.lastBackup",String(Date.now())); }catch(_){} };
  try{ if(typeof _teamMore4==="function") _teamMore4(); }catch(e){ console.error(e); }
}
// Rapport: extra sectie met profiel, GRI, effectmeting en weekoverzicht
function idaReportHtml(){
  const c=_ctx; if(!c) return "";
  const g=c.glucose.filter(x=>_usable(c,x.ts)), G=griOf(g), W=weekReview(c), act=_idaActivation();
  let h=`<h2>${TL("IDA-samenvatting","IDA summary","Resumo IDA")}</h2>`;
  if(G) h+=`<p class="rp">GRI <b>${Math.round(G.gri)}</b> (${TL("zone","zone","zona")} ${G.zone}).</p>`;
  if(_P&&_P.basal) h+=`<p class="rp"><b>${TL("Voorgesteld AAPS-profiel","Proposed AAPS profile","Perfil AAPS proposto")}</b> (${_profName()}):<br>${TL("Basaal","Basal","Basal")}: ${_P.basal.map(b=>`${b.from} ${_idaN(b.value,2)}`).join(" · ")}<br>ISF: ${_P.isf.map(b=>`${b.from} ${_idaN(b.value)}`).join(" · ")}<br>${TL("KH-ratio","Carb ratio","Rácio HC")}: ${_P.ic.map(b=>`${b.from} ${_idaN(b.value)}`).join(" · ")}</p>`;
  if(act) h+=`<p class="rp">${TL(`Profiel geactiveerd op ${new Date(act.ts).toLocaleDateString(LOCALE())}.`,`Profile activated on ${new Date(act.ts).toLocaleDateString(LOCALE())}.`,`Perfil ativado em ${new Date(act.ts).toLocaleDateString(LOCALE())}.`)}</p>`;
  if(W) h+=`<p class="rp">${TL("Laatste 7 dagen","Last 7 days","Últimos 7 dias")}: ${TL("in bereik","in range","no alvo")} ${_idaPct(W.A.tir)}, ${TL("laag","low","baixa")} ${_idaN(W.A.tbr*100)}%. ${TL("Focus","Focus","Foco")}: ${W.focus}</p>`;
  const M=maxIobAdvice(c); if(M) h+=`<p class="rp">Max IOB: ${TL("minstens","at least","pelo menos")} ${_idaN(M.v)} ${TL("E","U","U")} (${M.why}).</p>`;
  return h;
}
// Automatisch synchroniseren bij openen en elke minuut zolang de app open is
async function autoSync(){
  if(!cfg.url || document.hidden) return; const b=document.getElementById("btnSync"); if(!b||b.disabled) return;
  let last=0; try{ last=+(await DB.meta("sync.at"))||0; }catch(_){}
  if(Date.now()-last>50e3){ try{ await doSync(); }catch(_){} }
}

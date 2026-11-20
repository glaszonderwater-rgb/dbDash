"use strict";
/* IDA 4 — tabs Vandaag · Dag · (+) · Profiel · Voortgang.
   - Vandaag: statuskaart (getal, één zin, IOB/COB) met gekleurde 24-uurscurve.
   - Dag: tijd in bereik per dag, oordeel t.o.v. je eigen gemiddelde, curve met genummerde momenten,
     per moment een pagina met "volgende keer". Patronen en Eten hangen onder Dag.
   - Profiel: werkbank (waar het misgaat, basaal nu/nieuw, wijzigingen) en stap voor stap overnemen in AAPS.
   Laadt als laatste; vervangt showTab, renderLast24 en idaProfiel, en vult idaVandaag/renderIda aan. */

const _H4 = 3600e3, _M4 = 60e3;
const _e4 = id => document.getElementById(id);
const _rm4 = () => { try{ return matchMedia("(prefers-reduced-motion: reduce)").matches; }catch(_){ return false; } };
const _hm4 = ts => fmtMin(todMin(ts));
const _i4 = { dagKey:null, take:0 };

/* ── navigatie ───────────────────────────────────────────────────────────── */
const _NAV4 = { overzicht:"overzicht", dag:"dag", analyses:"dag", eten:"dag", import:"dag", profiel:"profiel", consult:"consult" };
window.showTab = function(tab){
  if(tab!=="detail" && typeof _det!=="undefined" && _det) closeDetail(true);
  const prev=_curTab();
  const navTab = tab==="detail" ? (_NAV4[(typeof _det!=="undefined"&&_det&&_det.prev)||"overzicht"]||"overzicht") : (_NAV4[tab]||tab);
  document.querySelectorAll("#tabbar .tab").forEach(b=>{ const on=b.dataset.tab===navTab;
    b.classList.toggle("on",on); if(on) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current"); });
  document.querySelectorAll(".view").forEach(v=>v.hidden = v.dataset.view!==tab);
  const nu=_e4("secNow"); if(nu) nu.classList.toggle("hideOnHome", tab==="overzicht");
  window.scrollTo({top:0});
  if(tab==="dag") try{ idaDag(); }catch(e){ console.error(e); }
  if(tab==="profiel" && _ctx) try{ idaProfiel(_ctx); }catch(e){ console.error(e); }
  if(tab==="inzicht") try{ idaInzicht(); }catch(e){ console.error(e); }
  if(tab==="consult") setTimeout(()=>{ try{ _new5(); }catch(e){ console.error(e); } try{ _advView5(); }catch(e){ console.error(e); } },60);
  if(tab!==prev && prev!=="detail") idaEnter(tab);
};
document.querySelectorAll("[data-back]").forEach(b=>b.onclick=()=>showTab(b.dataset.back));

// Binnenkomst: blokken schuiven kort na elkaar in beeld. Alleen bij wisselen van scherm, niet bij elke sync.
function _stagTargets(v){
  const wrap=new Set(["teamTop","profBody","dagBody","bento","etenHero","detailBody"]), out=[];
  const walk=(el,d)=>{ for(const c of el.children){ if(c.hidden) continue;
    if(d<2 && (c.classList.contains("chome")||wrap.has(c.id))) walk(c,d+1); else out.push(c); } };
  walk(v,0); return out.filter(e=>e.offsetParent!==null).slice(0,14);
}
function idaEnter(tab){
  const v=document.querySelector(`.view[data-view="${tab}"]`); if(!v || _rm4()) return;
  _stagTargets(v).forEach((el,i)=>{ el.classList.add("stg"); el.style.setProperty("--i", i); });
  v.querySelectorAll(".wday").forEach((el,i)=>el.style.setProperty("--i", i));
  v.querySelectorAll(".ichart .mk").forEach((el,i)=>el.style.setProperty("--i", i));
  v.querySelectorAll(".heat .hrow i").forEach((el,i)=>el.style.setProperty("--i", i%24));
  v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter");
  clearTimeout(v._enT); v._enT=setTimeout(()=>v.classList.remove("enter"), 1800);
}
window.addEventListener("scroll",()=>{ const h=document.querySelector("header"); if(h) h.classList.toggle("scrolled", window.scrollY>4); },{passive:true});

// "Bekijk de dag" bij een melding opent nu het Dag-scherm
document.addEventListener("click",e=>{
  const b=e.target.closest&&e.target.closest("[data-goday]"); if(!b) return;
  e.stopPropagation(); e.preventDefault(); idaDagOpen(b.dataset.goday);
}, true);
function idaDagOpen(key){ _i4.dagKey=key; showTab("dag"); }

// Instelling openen en aanwijzen
function idaOpenSetting(id){
  try{ _e4("btnCfg").click(); }catch(_){}
  setTimeout(()=>{ const el=_e4(id); if(!el) return; const row=el.closest("label")||el; row.scrollIntoView({block:"center",behavior:_rm4()?"auto":"smooth"});
    row.style.transition="background .3s"; row.style.background="var(--brand-soft)"; row.style.borderRadius="12px"; setTimeout(()=>{ row.style.background=""; },1600); try{ el.focus({preventScroll:true}); }catch(_){} }, 350);
}
// "Ik tel mijn koolhydraten nauwkeurig" werkt meteen (niet pas bij Bewaren)
(function(){ const el=_e4("inCarbsOk"); if(!el) return;
  el.addEventListener("change",()=>{ cfg.carbsAccurate=el.checked; saveCfg(); _P=null;
    try{ renderIda(); }catch(_){} toast(el.checked?TL("Opgeslagen: IDA gaat ervan uit dat je nauwkeurig telt.","Saved: IDA assumes you count accurately.","Guardado."):TL("Opgeslagen.","Saved.","Guardado.")); }); })();

// Patronen: alleen wat je echt gebruikt. Wat elders al staat of zelden iets zegt gaat uit de lijst
// (Dagcurve → Dag, Profiel/Gemeten vs. ingesteld → Profiel, Insuline & KH → Voorraad, Band → kerncijfers);
// via een link of melding blijven ze bereikbaar.
const _GONE4=["#secDay","#secProfile","#mvsFold","#secInsulin","#bandCard",'details[data-an="lunch"]','details[data-an="maand"]','details[data-an="dagpatroon"]'];
(function(){ const o=buildRows; window.buildRows=function(){ o();
  for(const q of _GONE4){ const d=document.querySelector(q); if(d&&d._row) d._row.classList.add("gone"); }
  document.querySelectorAll('.view[data-view="analyses"] .h3').forEach(h=>{ let n=h.nextElementSibling, any=false;
    while(n&&!n.classList.contains("h3")){ if(n.classList.contains("irow")&&!n.hidden&&!n.classList.contains("gone")) any=true; n=n.nextElementSibling; }
    h.classList.toggle("gone",!any); }); }; })();

/* ── grafiek: gekleurde glucoselijn ──────────────────────────────────────── */
function _zone(bg){ return bg<LO_T?"lo":bg>HI_T?"hi":"ok"; }
function idaCurveSvg(rd, ev, o){
  o=o||{}; const W=340, H=o.h||150, PT=14, PB=16, PR=16;
  if(rd.length<3) return `<div class="mempty">${TL("Te weinig metingen.","Too few readings.","Poucas leituras.")}</div>`;
  const span=o.to-o.from, lo=Math.min(2.6,...rd.map(r=>r.bg))-0.2, hi=Math.min(25,Math.max(12,...rd.map(r=>r.bg))+0.6);
  const X=ts=>(ts-o.from)/span*(W-PR), Y=b=>PT+(hi-b)/(hi-lo)*(H-PT-PB);
  const f=v=>v.toFixed(1);
  let s=`<rect class="band" x="0" y="${f(Y(HI_T))}" width="${W-PR}" height="${f(Y(LO_T)-Y(HI_T))}" rx="3"/>`;
  // uren
  // hele uren in de tijdzone van je data (ook als je onderweg van tijdzone wisselde)
  const step=span>14*_H4?6:span>7*_H4?2:1, f0=o.from+((60-(todMin(o.from)%60))%60)*_M4;
  for(let t=f0;t<=o.to+1;t+=_H4){ const h=Math.round(todMin(t)/60)%24; if(h%step) continue; const x=X(t);
    s+=`<line class="grid" x1="${f(x)}" y1="${PT}" x2="${f(x)}" y2="${H-PB}"/><text x="${f(x)}" y="${H-3}" text-anchor="middle">${String(h).padStart(2,"0")}${step>1?"":":00"}</text>`; }
  for(const b of [LO_T,HI_T]){ const bv=Math.round(b*10)/10; s+=`<text x="${W-PR+3}" y="${f(Y(b)+3)}">${_idaN(bv,bv%1?1:0)}</text>`; }
  // lijn per zone, onderbroken bij gaten
  const segs=[]; let cur=null;
  for(let i=1;i<rd.length;i++){ const a=rd[i-1], b=rd[i]; if(b.ts-a.ts>15*_M4){ cur=null; continue; }
    const z=_zone((a.bg+b.bg)/2);
    if(!cur||cur.z!==z){ cur={z,d:`M${f(X(a.ts))} ${f(Y(a.bg))}`}; segs.push(cur); }
    cur.d+=`L${f(X(b.ts))} ${f(Y(b.bg))}`; }
  s+=segs.map(g=>`<path class="gl ${g.z}" d="${g.d}"/>`).join("");
  // eten en bolus
  for(const e of ev||[]){ const x=X(e.ts); if(x<0||x>W-PR) continue;
    if(e.carbs>0) s+=`<circle class="carb" cx="${f(x)}" cy="${PT-7}" r="${e.carbs>=30?3.4:2.4}"/>`;
    if(e.insulin>0&&!e.isSMB) s+=`<line class="bol" x1="${f(x)}" y1="${H-PB-1}" x2="${f(x)}" y2="${f(H-PB-1-Math.min(12,3+e.insulin*1.6))}"/>`; }
  // verwachting van AAPS
  if(o.pred){ const p=o.pred, x1=Math.min(W-PR,X(p.ts+45*_M4)); s+=`<path class="pred" d="M${f(X(p.ts))} ${f(Y(p.bg))}L${f(x1)} ${f(Y(Math.max(lo,Math.min(hi,p.ev))))}"/>`; }
  // laatste punt
  if(o.dot){ const l=rd[rd.length-1]; s+=`<circle class="now" cx="${f(X(l.ts))}" cy="${f(Y(l.bg))}" r="4" style="stroke:var(--${l.bg<LO_T?"lo":l.bg>HI_T?"hi":"ok"})"/>`; }
  // genummerde momenten
  for(const m of o.marks||[]){ const x=Math.max(9,Math.min(W-PR-9,X(m.ts))); let y=Y(m.bg)+(m.k==="lo"?13:-13); y=Math.max(PT+2,Math.min(H-PB-9,y));
    s+=`<g class="mk k-${m.k}"><circle cx="${f(x)}" cy="${f(y)}" r="8.5"/><text x="${f(x)}" y="${f(y+3.2)}">${m.n}</text></g>`; }
  return `<svg class="ichart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label||TL("Glucosecurve","Glucose curve","Curva de glicose"))}">${s}</svg>`;
}
window.renderLast24=function(){
  const host=_e4("last24"); if(!host||!_ctx) return;
  const g=_ctx.glucose; if(!g.length){ host.innerHTML=""; return; }
  const last=g[g.length-1], to0=Math.max(last.ts, Date.now()-5*_M4);
  let pred=null; try{ const d=[..._dsRecent].reverse().find(x=>x.ev!=null&&Math.abs(x.ts-last.ts)<20*_M4);
    if(d && Date.now()-last.ts<60*_M4) pred={ts:last.ts, bg:last.bg, ev:d.ev}; }catch(_){}
  const to=pred?Math.max(to0,pred.ts+45*_M4):to0, from=to-24*_H4;
  const rd=g.filter(x=>x.ts>=from&&x.ts<=to), ev=(_ctx.treatments||[]).filter(t=>t.ts>=from&&t.ts<=to);
  host.innerHTML=idaCurveSvg(rd,ev,{from,to,pred,dot:true,h:140,label:TL("Laatste 24 uur","Last 24 hours","Últimas 24 horas")});
  const sub=_e4("l24sub"); if(sub){ const n=rd.length; sub.textContent=n>=3?`${pct0(rd.filter(x=>x.bg>=LO_T&&x.bg<=HI_T).length/n)}`:""; }
};

/* ── Vandaag: statuskaart ────────────────────────────────────────────────── */
const _ARR4={ DoubleUp:-90, SingleUp:-90, FortyFiveUp:-45, Flat:0, FortyFiveDown:45, SingleDown:90, DoubleDown:90 };
function _countUp(el, to){
  const from=el._v; el._v=to;
  if(_rm4() || (from!=null && Math.abs(from-to)<0.05)){ el.textContent=_idaN(to); return; }
  const a=from!=null?from:Math.max(2,to-2.4), t0=performance.now(), dur=from!=null?500:750;
  const step=now=>{ const k=Math.min(1,(now-t0)/dur), e=1-Math.pow(1-k,3); el.textContent=_idaN(a+(to-a)*e); if(k<1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function idaHero4(c){
  const hero=_e4("idaHero"); if(!hero) return;
  const g=c.glucose, last=g[g.length-1], age=Math.round((Date.now()-last.ts)/_M4);
  const st = age>20 ? "old" : last.bg<LO_T ? "lo" : last.bg>HI_T ? "hi" : "ok";
  hero.dataset.st=st;
  _e4("idaPillTxt").textContent = st==="old"?TL("Meting is oud","Reading is old","Leitura antiga"):st==="lo"?TL("Onder bereik","Below range","Abaixo do alvo"):st==="hi"?TL("Boven bereik","Above range","Acima do alvo"):TL("In bereik","In range","No alvo");
  _e4("idaPill").classList.toggle("live", age<=10);
  _e4("idaAge").textContent = age<1?TL("zojuist","just now","agora"):age<90?TL(`${age} min geleden`,`${age} min ago`,`há ${age} min`):TL(`${Math.round(age/60)} uur geleden`,`${Math.round(age/60)} h ago`,`há ${Math.round(age/60)} h`);
  const v=_e4("idaVal"); v.style.color=""; _countUp(v, last.bg);
  const deg=_ARR4[last.dir], dbl=/^Double/.test(last.dir||"");
  const a=_e4("idaArrow"); a.style.color="";
  if(deg==null) { a.innerHTML=""; a.hidden=true; }
  else { a.hidden=false; a.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${deg}deg)"><path d="${dbl?"M4 12h14M9 6l6 6-6 6M14 6l6 6-6 6":"M5 12h13M13 6l6 6-6 6"}"/></svg>`;
    a.setAttribute("aria-label", ARROWS[last.dir]||""); }
  // één zin
  const prev=g.filter(x=>x.ts>=last.ts-20*_M4), s15=prev.length>=2?(last.bg-prev[0].bg)/((last.ts-prev[0].ts)/_M4)*15:0;
  const up=s15>=0.3, dn=s15<=-0.3;
  const ds=[..._dsRecent].reverse().find(d=>d.ev!=null&&Math.abs(d.ts-last.ts)<20*_M4);
  let say;
  if(st==="old") say=TL(`Je laatste meting is ${age<90?age+" min":Math.round(age/60)+" uur"} oud. Synchroniseer voor je actuele waarde.`,`Your last reading is ${age<90?age+" min":Math.round(age/60)+" h"} old. Sync for your current value.`,`A última leitura tem ${age<90?age+" min":Math.round(age/60)+" h"}. Sincronize.`);
  else if(st==="lo") say=up?TL("Onder bereik, maar je stijgt al.","Below range, but already rising.","Abaixo do alvo, mas já a subir."):TL("Onder bereik. Neem snelle koolhydraten en meet na 15 minuten opnieuw.","Below range. Take fast carbs and check again after 15 minutes.","Abaixo do alvo. Tome hidratos rápidos e meça após 15 minutos.");
  else if(st==="hi") say=up?TL("Boven bereik en nog stijgend.","Above range and still rising.","Acima do alvo e a subir."):dn?TL("Boven bereik, maar je daalt al.","Above range, but already falling.","Acima do alvo, mas já a descer."):TL("Boven bereik.","Above range.","Acima do alvo.");
  else say=dn&&last.bg<6?TL("In bereik, maar je daalt richting de ondergrens.","In range, but falling towards the lower limit.","No alvo, mas a descer para o limite."):dn?TL("In bereik, licht dalend.","In range, gently falling.","No alvo, a descer ligeiramente."):up&&last.bg>8?TL("In bereik, maar je stijgt richting de bovengrens.","In range, but rising towards the upper limit.","No alvo, mas a subir para o limite."):up?TL("In bereik, licht stijgend.","In range, gently rising.","No alvo, a subir ligeiramente."):TL("Stabiel in bereik.","Steady in range.","Estável no alvo.");
  if(ds && st!=="old") say+=" "+TL(`AAPS verwacht ${_idaN(ds.ev)}.`,`AAPS expects ${_idaN(ds.ev)}.`,`O AAPS prevê ${_idaN(ds.ev)}.`);
  _e4("idaSay").textContent=say;
  // IOB · COB · vandaag in bereik
  const dl=[..._dsRecent].reverse().find(d=>(d.iob!=null||d.cob!=null)&&Date.now()-d.ts<20*_M4);
  const today=localDayKey(last.ts), tg=g.filter(x=>x.ts>last.ts-26*_H4&&localDayKey(x.ts)===today);
  const parts=[];
  if(dl&&dl.iob!=null) parts.push(`IOB <b>${_idaN(dl.iob,2)}</b> ${TL("E","U","U")}`);
  if(dl&&dl.cob!=null) parts.push(`COB <b>${Math.round(dl.cob)}</b> g`);
  if(tg.length>=12) parts.push(TL(`vandaag <b>${pct0(tg.filter(x=>x.bg>=LO_T&&x.bg<=HI_T).length/tg.length)}</b> in bereik`,`today <b>${pct0(tg.filter(x=>x.bg>=LO_T&&x.bg<=HI_T).length/tg.length)}</b> in range`,`hoje <b>${pct0(tg.filter(x=>x.bg>=LO_T&&x.bg<=HI_T).length/tg.length)}</b> no alvo`));
  _e4("idaMeta").innerHTML=parts.join(" · ");
  const foot=_e4("idaFoot");
  if(foot){ foot.innerHTML=`<span class="hage">${TL("laatste 24 uur","last 24 hours","últimas 24 horas")}</span><button class="hchip" type="button" id="idaDrive"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17h14M6 17l1.5-5h9L18 17M7 17v2M17 17v2"/></svg>${TL("Rijcheck","Drive check","Condução")}</button>`;
    _e4("idaDrive").onclick=()=>{ try{ openDrive(); }catch(e){ console.error(e); } }; }
}
(function(){ const o=idaVandaag; window.idaVandaag=function(c){ o(c); try{ idaHero4(c); }catch(e){ console.error(e); } try{ _now5(c); }catch(e){ console.error(e); } }; })();

/* ── Dag ─────────────────────────────────────────────────────────────────── */
function _dayData(c){
  if(c._days4) return c._days4;
  const m=new Map();
  for(const x of c.glucose){ const k=localDayKey(x.ts); let d=m.get(k); if(!d){ d={k,n:0,inr:0,lo:0,first:x.ts}; m.set(k,d); } d.n++; if(x.bg>=LO_T&&x.bg<=HI_T) d.inr++; if(x.bg<LO_T) d.lo++; }
  for(const d of m.values()) d.tir=d.n?d.inr/d.n:null;
  return (c._days4=m);
}
function _mealName(ts, g){
  const m=todMin(ts);
  if(m>=300&&m<630) return TL("Ontbijt","Breakfast","Pequeno-almoço");
  if(m>=690&&m<900) return TL("Lunch","Lunch","Almoço");
  if(m>=1020&&m<1290) return TL("Avondeten","Dinner","Jantar");
  return g<25?TL("Tussendoortje","Snack","Lanche"):TL("Maaltijd","Meal","Refeição");
}
// Momenten van één dag: maaltijden, laagtes (≥15 min of onder 3,0) en hoogtes zonder maaltijd ervoor (≥30 min boven 10)
function dayMoments(c, from, to){
  const G=c.glucose.filter(x=>x.ts>=from-3*_H4&&x.ts<to+4*_H4), T=c.treatments||[];
  const near=(ts,w)=>{ let b=null; for(const x of G){ const d=Math.abs(x.ts-ts); if(d<=(w||10*_M4)&&(!b||d<Math.abs(b.ts-ts))) b=x; } return b; };
  const win=(a,b)=>G.filter(x=>x.ts>=a&&x.ts<=b);
  const smbIn=(a,b)=>T.filter(t=>t.isSMB&&t.insulin>0&&t.ts>=a&&t.ts<=b).reduce((s,t)=>s+t.insulin,0);
  // laagtes en hoogtes
  const eps=(test,gap,minDur)=>{ const out=[]; let cur=null;
    for(const x of G){ if(x.ts<from||x.ts>=to+2*_H4) continue;
      if(test(x.bg)){ if(cur&&x.ts-cur.end<=gap) { cur.end=x.ts; cur.pts.push(x); } else { cur={start:x.ts,end:x.ts,pts:[x]}; out.push(cur); } } }
    return out.filter(e=>e.start>=from&&e.start<to).map(e=>({...e, dur:(e.end-e.start)/_M4+5})).filter(minDur); };
  const lows=eps(b=>b<LO_T,15*_M4,e=>e.dur>=15||e.pts.some(p=>p.bg<VLO_T)).map(e=>{ const m=e.pts.reduce((a,b)=>b.bg<a.bg?b:a); return {k:"lo", ts:e.start, tMark:m.ts, bg:m.bg, min:m.bg, dur:e.dur, end:e.end}; });
  const highs=eps(b=>b>HI_T,20*_M4,e=>e.dur>=30).map(e=>{ const m=e.pts.reduce((a,b)=>b.bg>a.bg?b:a); return {k:"hi", ts:e.start, tMark:m.ts, bg:m.bg, peak:m.bg, dur:e.dur, end:e.end}; });
  // maaltijden (koolhydraten binnen 45 min samen)
  const cs=T.filter(t=>t.carbs>0&&t.ts>=from-_H4&&t.ts<to).sort((a,b)=>a.ts-b.ts), groups=[];
  for(const t of cs){ const gp=groups[groups.length-1]; if(gp&&t.ts-gp.ts<=45*_M4) gp.g+=t.carbs; else groups.push({ts:t.ts,g:t.carbs}); }
  const meals=[];
  groups.forEach((gp,i)=>{ if(gp.ts<from||gp.g<10) return;
    const b0=near(gp.ts,15*_M4), bPre=near(gp.ts-20*_M4,10*_M4);
    const bol=T.filter(t=>t.insulin>0&&!t.isSMB&&t.ts>=gp.ts-45*_M4&&t.ts<=gp.ts+30*_M4).sort((a,b)=>a.ts-b.ts);
    // hypo-correctie, geen maaltijd
    if(b0&&b0.bg<4.5&&gp.g<=25&&!bol.length){ const l=lows.find(x=>gp.ts>=x.ts-20*_M4&&gp.ts<=x.end+20*_M4); if(l){ l.fix=(l.fix||0)+gp.g; return; } }
    const next=groups[i+1], endPk=Math.min(gp.ts+4*_H4, next?next.ts:Infinity);
    const wp=win(gp.ts,endPk), w4=win(gp.ts,gp.ts+4*_H4);
    const pk=wp.length?wp.reduce((a,b)=>b.bg>a.bg?b:a):null, mn=w4.length?w4.reduce((a,b)=>b.bg<a.bg?b:a):null;
    meals.push({k:"meal", ts:gp.ts, tMark:gp.ts, bg:b0?b0.bg:(pk?pk.bg:6), g:Math.round(gp.g), bg0:b0?b0.bg:null,
      slope0:(b0&&bPre)?(b0.bg-bPre.bg)/((b0.ts-bPre.ts)/_M4):null,
      bolus:bol.reduce((s,t)=>s+t.insulin,0), bolOff:bol.length?Math.round((bol[0].ts-gp.ts)/_M4):null,
      peak:pk?pk.bg:null, tPeak:pk?Math.round((pk.ts-gp.ts)/_M4):null, min:mn?mn.bg:null, tMin:mn?mn.ts:null,
      lowAfter:!!(mn&&mn.bg<LO_T), smb:smbIn(gp.ts,gp.ts+3*_H4) }); });
  // hoogtes na een maaltijd horen bij die maaltijd
  const hs=highs.filter(h=>{ const m=meals.find(m=>h.ts>=m.ts-15*_M4&&h.ts<=m.ts+4*_H4); if(m){ m.high=h; return false; } return true; });
  for(const l of lows){ l.meal=meals.find(m=>l.ts>=m.ts&&l.ts<=m.ts+4*_H4)||null; l.smb2=smbIn(l.ts-2*_H4,l.ts);
    const bolB=T.filter(t=>t.insulin>0&&!t.isSMB&&t.ts>=l.ts-3*_H4&&t.ts<=l.ts); l.bolus3=bolB.reduce((s,t)=>s+t.insulin,0);
    const after=win(l.end,l.end+2.5*_H4); l.rebound=after.length?Math.max(...after.map(x=>x.bg)):null;
    l.sport=(_idaAnns||[]).find(a=>a.type==="sport"&&a.ts<=l.ts&&a.ts>=l.ts-5*_H4)||null; }
  for(const h of hs){ h.site=T.find(t=>/site change|cannula/i.test(t.type||"")&&t.ts<=h.ts&&t.ts>=h.ts-4*_H4)||null;
    h.carbs3=T.some(t=>t.carbs>0&&t.ts>=h.ts-3*_H4&&t.ts<=h.ts); h.smb=smbIn(h.ts,h.end); }
  const all=[...meals,...lows,...hs].sort((a,b)=>a.ts-b.ts);
  all.forEach((m,i)=>m.n=i+1);
  return all;
}
// Prebolus per dagdeel uit je eigen maaltijden (zelfde regel als het experiment: t50 → 5–10/10–15/15–20 min)
function _preFor(c, ts){
  if(!c._mr4){ try{ c._mr4=mealResults(c.glucose,c.treatments,c.timeline); }catch(_){ c._mr4={results:[]}; } }
  const R=(c._mr4&&c._mr4.results)||[], m=todMin(ts);
  const near=R.filter(r=>r.t50!=null&&Math.abs(((todMin(r.ts)-m+720+1440)%1440)-720)<=150).map(r=>r.t50);
  const use=near.length>=4?near:R.filter(r=>r.t50!=null).map(r=>r.t50);
  if(use.length<4) return null;
  const t=_pMed(use); return { t50:t, lo:t>90?5:t<60?15:10, hi:t>90?10:t<60?20:15, n:use.length };
}
function _momTitle(m){
  return m.k==="meal"?_mealName(m.ts,m.g):m.k==="lo"?TL("Laag","Low","Baixa"):TL("Hoog","High","Alta");
}
function _momSub(m){
  if(m.k==="meal"){ const p=[`${m.g} g`];
    p.push(m.bolus>0?(m.bolOff<=-5?TL(`bolus ${-m.bolOff} min vooraf`,`bolus ${-m.bolOff} min before`,`bólus ${-m.bolOff} min antes`):m.bolOff>=5?TL(`bolus ${m.bolOff} min erna`,`bolus ${m.bolOff} min after`,`bólus ${m.bolOff} min depois`):TL("bolus bij het eten","bolus at the meal","bólus à refeição")):TL("geen bolus","no bolus","sem bólus"));
    if(m.lowAfter) p.push(TL(`daarna laag ${_idaN(m.min)}`,`then low ${_idaN(m.min)}`,`depois baixa ${_idaN(m.min)}`));
    else if(m.peak!=null) p.push(TL(`piek ${_idaN(m.peak)}`,`peak ${_idaN(m.peak)}`,`pico ${_idaN(m.peak)}`));
    return p.join(" · "); }
  if(m.k==="lo") return [TL(`laagste ${_idaN(m.min)}`,`lowest ${_idaN(m.min)}`,`mínimo ${_idaN(m.min)}`), `${Math.round(m.dur)} min`, m.meal?TL(`na ${_mealName(m.meal.ts,m.meal.g).toLowerCase()}`,`after ${_mealName(m.meal.ts,m.meal.g).toLowerCase()}`,`após refeição`):""].filter(Boolean).join(" · ");
  const d=Math.round(m.dur); return [TL(`piek ${_idaN(m.peak)}`,`peak ${_idaN(m.peak)}`,`pico ${_idaN(m.peak)}`), d>=60?TL(`${Math.floor(d/60)} u ${d%60} min boven 10`,`${Math.floor(d/60)} h ${d%60} min above 10`,`${Math.floor(d/60)} h ${d%60} min acima de 10`):TL(`${d} min boven 10`,`${d} min above 10`,`${d} min acima de 10`)].join(" · ");
}
// "Volgende keer": alleen uit wat er gebeurde en je eigen cijfers
function _momNext(c, m){
  const out=[], E=TL("E","U","U");
  if(m.k==="meal"){
    const pre=_preFor(c,m.ts);
    if(m.lowAfter){
      if(m.bg0!=null&&m.bg0<7&&m.slope0!=null&&m.slope0<=-0.03) out.push(TL(`Je zat op ${_idaN(m.bg0)} en daalde al toen je bolusde. Bolus in zo'n geval pas bij het eten, of iets minder.`,`You were at ${_idaN(m.bg0)} and already falling when you bolused. In that case bolus at the meal, or a bit less.`,`Estava a ${_idaN(m.bg0)} e já a descer no bólus. Nesse caso, bólus à refeição ou um pouco menos.`));
      else if(m.smb>=1) out.push(TL(`De loop gaf na het eten nog ${_idaN(m.smb)} ${E} extra en daarna kwam je laag. Klopten de koolhydraten? Te hoog ingevoerd geeft precies dit.`,`The loop added ${_idaN(m.smb)} ${E} after the meal and then you went low. Were the carbs right? Entering too many gives exactly this.`,`O loop deu mais ${_idaN(m.smb)} ${E} e depois baixou. Os hidratos estavam certos?`));
      else out.push(TL(`Je kwam ${m.tMin?Math.round((m.tMin-m.ts)/_M4)+" min na het eten ":""}op ${_idaN(m.min)}. Controleer of de koolhydraten klopten; bij vet of eiwitrijk eten kan een deel van de bolus beter later.`,`You reached ${_idaN(m.min)}${m.tMin?" "+Math.round((m.tMin-m.ts)/_M4)+" min after eating":""}. Check whether the carbs were right; with fatty or protein-rich food part of the bolus works better later.`,`Chegou a ${_idaN(m.min)}. Verifique os hidratos; com comida gorda parte do bólus pode ser mais tarde.`));
    } else if(m.peak!=null&&m.peak>HI_T){
      if(!(m.bolus>0)) out.push(TL("Er is geen bolus gevonden bij deze maaltijd; de loop moest alles inhalen. Geef de bolus vóór of bij het eten.","No bolus was found for this meal; the loop had to catch up. Bolus before or at the meal.","Sem bólus nesta refeição; o loop teve de compensar."));
      else if(m.bolOff>-5){ out.push(pre?TL(`Bolus eerder: ${pre.lo}–${pre.hi} min vóór het eten. Rond deze tijd is je eten na ~${Math.round(pre.t50)} min half opgenomen (${pre.n} maaltijden).`,`Bolus earlier: ${pre.lo}–${pre.hi} min before eating. Around this time your food is half absorbed after ~${Math.round(pre.t50)} min (${pre.n} meals).`,`Bólus mais cedo: ${pre.lo}–${pre.hi} min antes. Metade absorvida após ~${Math.round(pre.t50)} min.`):TL("Bolus eerder, een kwartier vóór het eten is de gebruikelijke start.","Bolus earlier; 15 minutes before eating is the usual start.","Bólus mais cedo; 15 minutos antes é o habitual.")); }
      else out.push(TL(`Je bolusde al ${-m.bolOff} min vooraf en piekte toch op ${_idaN(m.peak)}. Waarschijnlijk zat er meer koolhydraat in dan ingevoerd: weeg of check het etiket.`,`You bolused ${-m.bolOff} min ahead and still peaked at ${_idaN(m.peak)}. Probably more carbs than entered: weigh it or check the label.`,`Fez bólus ${-m.bolOff} min antes e mesmo assim chegou a ${_idaN(m.peak)}. Provavelmente mais hidratos do que registou.`));
      if(m.high&&m.high.dur>=120) out.push(TL(`Je zat ${Math.round(m.high.dur/60*10)/10} uur boven 10. Bij een lange stijging (vet, pizza, pasta) helpt een deel van de bolus later.`,`You were above 10 for ${Math.round(m.high.dur/60*10)/10} hours. With a long rise (fat, pizza, pasta) part of the bolus later helps.`,`Esteve ${Math.round(m.high.dur/60*10)/10} h acima de 10.`));
    } else out.push(TL(`Goed gegaan: piek ${m.peak!=null?_idaN(m.peak):"—"}, niet laag erna. Zo houden.`,`Went well: peak ${m.peak!=null?_idaN(m.peak):"—"}, no low afterwards. Keep it this way.`,`Correu bem: pico ${m.peak!=null?_idaN(m.peak):"—"}, sem baixa.`));
  } else if(m.k==="lo"){
    if(m.meal) out.push(TL(`Deze laagte kwam ${Math.round((m.ts-m.meal.ts)/_M4)} min na je ${_mealName(m.meal.ts,m.meal.g).toLowerCase()} (${m.meal.g} g, ${_idaN(m.meal.bolus)} ${E}).`,`This low came ${Math.round((m.ts-m.meal.ts)/_M4)} min after your ${_mealName(m.meal.ts,m.meal.g).toLowerCase()} (${m.meal.g} g, ${_idaN(m.meal.bolus)} ${E}).`,`Esta baixa veio ${Math.round((m.ts-m.meal.ts)/_M4)} min após a refeição.`)+" "+(_momNext(c,{...m.meal,lowAfter:true})[0]||""));
    else if(m.sport) out.push(TL("Na sport. Zet ongeveer een uur vooraf een tijdelijke streefwaarde, dan remt de loop eerder af.","After exercise. Set a temporary target about an hour before, so the loop holds back earlier.","Após exercício. Alvo temporário uma hora antes."));
    else if(m.smb2>=1) out.push(TL(`De loop gaf ${_idaN(m.smb2)} ${E} SMB in de 2 uur ervoor. Kwam je van een hoge waarde, dan schoot die correctie te ver door.`,`The loop gave ${_idaN(m.smb2)} ${E} SMB in the 2 hours before. If you came from a high value, that correction overshot.`,`O loop deu ${_idaN(m.smb2)} ${E} de SMB nas 2 h anteriores.`));
    else if(m.bolus3>0) out.push(TL(`Je gaf ${_idaN(m.bolus3)} ${E} bolus in de 3 uur ervoor zonder maaltijd erbij. Was dat een correctie, dan was hij te groot of te snel na de vorige.`,`You gave ${_idaN(m.bolus3)} ${E} bolus in the 3 hours before without a meal. If that was a correction, it was too large or too soon after the last.`,`Deu ${_idaN(m.bolus3)} ${E} de bólus sem refeição.`));
    else out.push(TL(`Geen eten of bolus in de 3 uur ervoor: dan is het basaal. Kijk bij Profiel naar het blok rond ${_hm4(m.ts).slice(0,2)} uur.`,`No food or bolus in the 3 hours before: that points to basal. Check the block around ${_hm4(m.ts).slice(0,2)}:00 under Profile.`,`Sem comida ou bólus antes: aponta para a basal. Veja o bloco das ${_hm4(m.ts).slice(0,2)} h em Perfil.`));
    if(m.rebound!=null&&m.rebound>HI_T) out.push(TL(`Daarna schoot je door naar ${_idaN(m.rebound)}${m.fix?` (${m.fix} g gelogd)`:""}: waarschijnlijk te veel opgegeten. Vuistregel: 15 g, 15 minuten wachten, dan pas meer.`,`Afterwards you overshot to ${_idaN(m.rebound)}${m.fix?` (${m.fix} g logged)`:""}: probably over-treated. Rule of thumb: 15 g, wait 15 minutes, then more if needed.`,`Depois subiu a ${_idaN(m.rebound)}: provavelmente comeu demais. Regra: 15 g, esperar 15 min.`));
  } else {
    if(m.site) out.push(TL(`Kort na een podwissel (${_hm4(m.site.ts)}). Een nieuwe pod neemt de eerste uren soms trager op.`,`Shortly after a pod change (${_hm4(m.site.ts)}). A new pod sometimes absorbs more slowly in the first hours.`,`Pouco depois de trocar o pod (${_hm4(m.site.ts)}).`));
    if(!m.carbs3) out.push(TL("Geen koolhydraten gelogd in de 3 uur ervoor. Iets gegeten? Leg het vast met +, dan klopt je eetpatroon.","No carbs logged in the 3 hours before. Did you eat? Log it with +, so your meal pattern is right.","Sem hidratos registados nas 3 h anteriores."));
    const h=+_hm4(m.ts).slice(0,2); if(!m.site&&(h<6||h>=23)) out.push(TL(`Hoog in de nacht zonder eten ervoor: kijk bij Profiel naar je basaal rond ${String(h).padStart(2,"0")} uur.`,`High at night without food before: check your basal around ${String(h).padStart(2,"0")}:00 under Profile.`,`Alta à noite sem comida: veja a basal em Perfil.`));
    if(!out.length) out.push(TL(`De loop gaf ${_idaN(m.smb)} ${TL("E","U","U")} SMB tijdens deze hoogte.`,`The loop gave ${_idaN(m.smb)} U SMB during this high.`,`O loop deu ${_idaN(m.smb)} U de SMB.`));
  }
  return out;
}
function idaDag(){
  const host=_e4("dagBody"); if(!host||!_ctx||!_ctx.glucose) return;
  const c=_ctx, D=_dayData(c), keys=[...D.keys()].sort();
  if(!keys.length){ host.innerHTML=""; return; }
  if(!_i4.dagKey||!D.has(_i4.dagKey)) _i4.dagKey=keys[keys.length-1];
  const idx=keys.indexOf(_i4.dagKey), key=_i4.dagKey, day=D.get(key), isToday=idx===keys.length-1&&key===localDayKey(Date.now());
  const from=day.first-todMin(day.first)*_M4, to=from+24*_H4;
  const rd=c.glucose.filter(x=>localDayKey(x.ts)===key), ev=(c.treatments||[]).filter(t=>t.ts>=from&&t.ts<to);
  // eigen gemiddelde: bruikbare dagen in de 30 dagen ervoor
  const before=keys.slice(0,idx).filter(k=>c.q.usableKeys.has(k)).slice(-30).map(k=>D.get(k).tir).filter(v=>v!=null);
  const avg=before.length>=5?before.reduce((s,v)=>s+v,0)/before.length:null;
  // week
  const end=Math.min(keys.length-1, Math.max(idx+3, Math.min(6,keys.length-1))), start=Math.max(0,end-6), wk=keys.slice(start,end+1);
  const wkAvg=wk.map(k=>D.get(k)).filter(d=>d.n>=50), wAvg=wkAvg.length?wkAvg.reduce((s,d)=>s+d.tir,0)/wkAvg.length:null;
  const lab=k=>new Date(k+"T12:00:00").toLocaleDateString(LOCALE(),{weekday:"short"}).replace(".","").slice(0,2);
  const BH=74;
  const bars=wk.map(k=>{ const d=D.get(k), ok=d.n>=50, t=ok?d.tir:0, cls=!ok?"none":t>=0.7?"":t>=0.5?"hi":"lo";
    return `<button type="button" class="wday${k===key?" on":""}${ok?"":" none"}" data-day="${k}" aria-label="${esc(new Date(k+"T12:00:00").toLocaleDateString(LOCALE(),{weekday:"long",day:"numeric",month:"long"}))}${ok?": "+pct0(t):""}" ${k===key?'aria-current="date"':""}><span class="wv">${ok?Math.round(t*100):""}</span><span class="wb ${cls}" style="height:${Math.max(4,Math.round(t*BH))}px"></span><span class="wl">${lab(k)}</span></button>`; }).join("");
  // oordeel
  const tir=day.n?day.inr/day.n:null, diff=(avg!=null&&tir!=null)?tir-avg:null;
  let verdict=diff==null?TL("Je dag in cijfers.","Your day in numbers.","O seu dia em números."):diff>=0.05?TL("Beter dan je gemiddelde.","Better than your average.","Melhor do que a sua média."):diff<=-0.05?TL("Minder dan je gemiddelde.","Below your average.","Abaixo da sua média."):TL("Zoals je gemiddelde.","Like your average.","Como a sua média.");
  if(isToday&&diff!=null) verdict=TL("Tot nu toe: ","So far: ","Até agora: ")+verdict.charAt(0).toLowerCase()+verdict.slice(1);
  const mx=rd.length?rd.reduce((a,b)=>b.bg>a.bg?b:a):null;
  const M=dayMoments(c,from,to).filter(m=>localDayKey(m.ts)===key), nLo=M.filter(m=>m.k==="lo").length;
  M.forEach((m,i)=>m.n=i+1);
  const facts=[`<span><b>${tir!=null?pct0(tir):"—"}</b> ${TL("in bereik","in range","no alvo")}</span>`];
  if(avg!=null) facts.push(`<span>${TL("30 dagen","30 days","30 dias")} <b>${pct0(avg)}</b></span>`);
  facts.push(`<span><b>${nLo}</b>× ${TL("laag","low","baixa")}</span>`);
  if(mx) facts.push(`<span>${TL("hoogste","highest","máx.")} <b>${_idaN(mx.bg)}</b></span>`);
  const dl=new Date(key+"T12:00:00").toLocaleDateString(LOCALE(),{weekday:"long",day:"numeric",month:"long"}).replace(/^./,x=>x.toUpperCase());
  const ic=k=>({chart:'<path d="M4 19V5M4 19h16"/><path d="M7 15l4-4 3 3 5-6"/>', food:'<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10"/><path d="M17 3c-2 2-2 6 0 8v10"/>'}[k]);
  host.innerHTML=`<div class="dnav"><button type="button" id="dagPrev" aria-label="${TL("Vorige dag","Previous day","Dia anterior")}" ${idx<=0?"disabled":""}><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><b>${esc(dl)}</b><button type="button" id="dagNext" aria-label="${TL("Volgende dag","Next day","Dia seguinte")}" ${idx>=keys.length-1?"disabled":""}><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button></div>
    <section class="ibox"><span class="ilabel">${TL("Tijd in bereik per dag","Time in range per day","Tempo no alvo por dia")}</span>
      <div style="position:relative"><div class="wstrip">${bars}</div>${wAvg!=null?`<i class="wavgl" style="bottom:${21+Math.round(wAvg*BH)}px" aria-hidden="true"></i>`:""}</div>
      ${wAvg!=null?`<div class="wmeta"><span>${TL(`Deze ${wk.length} dagen`,`These ${wk.length} days`,`Estes ${wk.length} dias`)}</span><span>${TL("gemiddeld","average","média")} <b>${pct0(wAvg)}</b></span></div>`:""}</section>
    <section class="ibox"><p class="verdict ${diff==null?"":diff>=0.05?"up":diff<=-0.05?"dn":""}">${verdict}</p><div class="dfacts">${facts.join("")}</div>
      <div style="margin-top:.6rem">${idaCurveSvg(rd,ev,{from,to,marks:M.map(m=>({ts:m.tMark,bg:m.bg,n:m.n,k:m.k})),h:170,label:dl})}</div></section>
    <h2 class="ihead">${TL("Momenten","Moments","Momentos")}</h2>
    <div class="mlist">${M.length?M.map(m=>`<button type="button" class="mrow" data-mom="${m.n}"><span class="mnum k-${m.k}">${m.n}</span><span class="mt"><b>${_momTitle(m)}</b><i>${esc(_momSub(m))}</i></span><span class="mtime">${_hm4(m.k==="meal"?m.ts:m.tMark)}</span><span class="irc" aria-hidden="true">›</span></button>`).join(""):`<div class="mempty">${TL("Geen maaltijden, laagtes of lange hoogtes op deze dag.","No meals, lows or long highs on this day.","Sem refeições, baixas ou altas longas neste dia.")}</div>`}</div>
    <h2 class="ihead">${TL("Verder kijken","Look further","Ver mais")}</h2>
    <button type="button" class="irow" data-go="analyses"><span class="ird">${`<svg viewBox="0 0 24 24">${ic("chart")}</svg>`}</span><span class="irt"><b>${TL("Patronen","Patterns","Padrões")}</b><i>${TL("alle analyses over je periode","all analyses of your period","todas as análises")}</i></span><span class="irc" aria-hidden="true">›</span></button>
    <button type="button" class="irow" data-go="eten"><span class="ird sun">${`<svg viewBox="0 0 24 24">${ic("food")}</svg>`}</span><span class="irt"><b>${TL("Eten","Food","Comida")}</b><i>${TL("koolhydraten schatten en je eetpatroon","estimate carbs and your meal pattern","estimar hidratos")}</i></span><span class="irc" aria-hidden="true">›</span></button>`;
  host.querySelectorAll("[data-day]").forEach(b=>b.onclick=()=>{ _i4.dagKey=b.dataset.day; idaDag(); });
  _e4("dagPrev").onclick=()=>{ _i4.dagKey=keys[Math.max(0,idx-1)]; idaDag(); };
  _e4("dagNext").onclick=()=>{ _i4.dagKey=keys[Math.min(keys.length-1,idx+1)]; idaDag(); };
  host.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>showTab(b.dataset.go));
  host.querySelectorAll("[data-mom]").forEach(b=>b.onclick=()=>{ const m=M.find(x=>x.n===+b.dataset.mom); if(m) openMoment(c,m,from); });
  try{ _dagLink5(host); }catch(e){ console.error(e); }
}

/* ── Wat meespeelde: per moment meerdere factoren, vergeleken met je eigen gewone waarden ──
   Elke factor: { w (gewicht), txt (wat er was), tip (volgende keer, optioneel), pos (gunstig) }.
   "Volgende keer" komt uit de zwaarste factoren, zodat het advies per moment verschilt. */
const _DP4=m=>m<360?0:m<660?1:m<1020?2:3;   // nacht, ochtend, middag, avond
const _DPN4=()=>[TL("'s nachts","at night","à noite"),TL("bij je ontbijt","at breakfast","ao pequeno-almoço"),TL("bij je lunch","at lunch","ao almoço"),TL("bij je avondeten","at dinner","ao jantar")];
function _med4(a){ if(!a.length) return null; const s=[...a].sort((x,y)=>x-y), k=s.length>>1; return s.length%2?s[k]:(s[k-1]+s[k])/2; }
function _dsAt4(ts,tol){ const A=(typeof _dsAll!=="undefined"&&_dsAll)||[]; let lo=0,hi=A.length; while(lo<hi){const k=(lo+hi)>>1; if(A[k].ts<ts)lo=k+1; else hi=k;}
  let best=null; for(const i of [lo-1,lo]){ const d=A[i]; if(d&&Math.abs(d.ts-ts)<=(tol||10*_M4)&&(!best||Math.abs(d.ts-ts)<Math.abs(best.ts-ts))) best=d; } return best; }
function _base4(c){
  if(c._base4) return c._base4;
  const T=c.treatments||[], B={ rise:[[],[],[],[]], t50:[[],[],[],[]], iobMeal:[], iobHour:Array.from({length:24},()=>[]), ioMax:null };
  let R=[]; try{ R=(c._mr4||(c._mr4=mealResults(c.glucose,c.treatments,c.timeline))).results||[]; }catch(_){}
  for(const r of R){ const dp=_DP4(todMin(r.ts)); if(r.peakRise!=null) B.rise[dp].push(r.peakRise); if(r.t50!=null) B.t50[dp].push(r.t50);
    const d=_dsAt4(r.ts); if(d&&d.iob!=null) B.iobMeal.push(d.iob); }
  const A=(typeof _dsAll!=="undefined"&&_dsAll)||[], step=Math.max(1,Math.floor(A.length/6000)); const io=[];
  for(let i=0;i<A.length;i+=step){ const d=A[i]; if(d.iob==null) continue; B.iobHour[Math.floor(todMin(d.ts)/60)%24].push(d.iob); io.push(d.iob); }
  io.sort((a,b)=>a-b); B.ioP95=io.length?io[Math.floor(io.length*0.95)]:null;
  B.rise=B.rise.map(_med4); B.t50=B.t50.map(_med4); B.iobMeal=_med4(B.iobMeal); B.iobHour=B.iobHour.map(_med4);
  B.sites=T.filter(t=>/site change|cannula/i.test(t.type||"")).map(t=>t.ts).sort((a,b)=>a-b);
  B.sensors=T.filter(t=>/sensor (change|start)/i.test(t.type||"")).map(t=>t.ts).sort((a,b)=>a-b);
  return (c._base4=B);
}
function _lastBefore4(arr,ts){ let r=null; for(const x of arr){ if(x<=ts) r=x; else break; } return r; }
function _momFactors(c, m){
  const B=_base4(c), F=[], E=TL("E","U","U"), G=c.glucose, T=c.treatments||[], dp=_DP4(todMin(m.ts)), dpn=_DPN4()[dp];
  const win=(a,b)=>G.filter(x=>x.ts>=a&&x.ts<=b);
  const ann=(type,a,b)=>(_idaAnns||[]).find(x=>x.type===type&&x.ts>=a&&x.ts<=b);
  const site=_lastBefore4(B.sites,m.ts), podAgeH=site!=null?(m.ts-site)/_H4:null;
  const sens=_lastBefore4(B.sensors,m.ts), sensAgeH=sens!=null?(m.ts-sens)/_H4:null;
  const P=_P&&_P.basal?_P:null, newBasal=h=>{ if(!P) return null; let v=P.basal[0].value; for(const b of P.basal) if(hhmmToMin(b.from)<=h*60) v=b.value; return v; };
  const hr=Math.floor(todMin(m.ts)/60)%24;
  // context uit je logboek en materiaal (voor alle soorten momenten)
  const alc=ann("alcohol",m.ts-6*_H4,m.ts+_H4), sp=ann("sport",m.ts-5*_H4,m.ts+_H4), ill=ann("ziek",m.ts-48*_H4,m.ts), str=ann("stress",m.ts-12*_H4,m.ts);
  if(alc) F.push({k:"alcohol",w:3,txt:TL(`Alcohol gelogd om ${_hm4(alc.ts)}.`,`Alcohol logged at ${_hm4(alc.ts)}.`,`Álcool registado às ${_hm4(alc.ts)}.`),tip:m.k==="hi"?null:TL("Alcohol remt je lever: bolus niet volledig voor bier of wijn, en eet iets voor de nacht.","Alcohol slows your liver: don't fully bolus for beer or wine, and eat something before bed.","O álcool trava o fígado: não faça bólus completo para cerveja ou vinho.")});
  if(sp) F.push({k:"sport",w:3,txt:TL(`Sport gelogd om ${_hm4(sp.ts)}.`,`Exercise logged at ${_hm4(sp.ts)}.`,`Exercício às ${_hm4(sp.ts)}.`),tip:m.k==="hi"?null:TL("Zet ongeveer een uur vóór het sporten een tijdelijke streefwaarde, en bolus kleiner voor een maaltijd vlak ervoor of erna.","Set a temporary target about an hour before exercise, and bolus less for a meal just before or after.","Alvo temporário uma hora antes do exercício.")});
  if(ill) F.push({k:"ziek",w:2,txt:TL("Je had ziek gelogd.","You had logged being ill.","Tinha registado doença."),tip:m.k==="hi"?TL("Ziek zijn vraagt vaak meer insuline; meet ketonen boven 14.","Illness often needs more insulin; check ketones above 14.","Doença pede muitas vezes mais insulina."):null});
  if(str) F.push({k:"stress",w:1,txt:TL("Stress gelogd.","Stress logged.","Stress registado.")});
  if(podAgeH!=null&&podAgeH<3) F.push({k:"podnieuw",w:m.k==="hi"?3:1,txt:TL(`Pod net gewisseld (${_hm4(site)}).`,`Pod just changed (${_hm4(site)}).`,`Pod acabado de trocar.`),tip:m.k==="hi"?TL("Een nieuwe pod neemt de eerste uren soms trager op. Wissel liever niet vlak voor eten of slapen.","A new pod sometimes absorbs slowly at first. Avoid changing right before a meal or sleep.","Um pod novo absorve por vezes mais devagar."):null});
  else if(podAgeH!=null&&podAgeH>=60&&m.k!=="lo") F.push({k:"poddag3",w:1,txt:TL(`Pod op dag ${Math.floor(podAgeH/24)+1}.`,`Pod on day ${Math.floor(podAgeH/24)+1}.`,`Pod no dia ${Math.floor(podAgeH/24)+1}.`)});
  if(sensAgeH!=null&&sensAgeH<24) F.push({k:"sensor1",w:m.k==="lo"?2:1,txt:TL(`Sensor pas ${Math.round(sensAgeH)} uur oud.`,`Sensor only ${Math.round(sensAgeH)} hours old.`,`Sensor com ${Math.round(sensAgeH)} h.`),tip:m.k==="lo"?TL("De eerste dag meet een sensor vaak te laag: prik ter controle voor je corrigeert.","On day one a sensor often reads low: fingerprick before treating.","No primeiro dia o sensor lê muitas vezes baixo."):null});
  if(m.k==="meal"){
    const prof=profileAt(c.timeline,m.ts), d0=_dsAt4(m.ts,15*_M4), iob0=d0&&d0.iob!=null?d0.iob:null;
    const tHi=prof&&prof.targetHigh!=null?prof.targetHigh:6.5;
    const exp=prof&&prof.ic>0?m.g/prof.ic+Math.max(0,((m.bg0||0)-tHi)/(prof.isf||3))-Math.max(0,iob0||0):null;
    const rise=m.peak!=null&&m.bg0!=null?m.peak-m.bg0:null, bR=B.rise[dp], t50=B.t50[dp];
    // timing
    if(m.bolus>0&&m.bolOff>-5&&m.peak!=null&&m.peak>HI_T){ const lo=t50!=null?(t50>90?5:t50<60?15:10):10, hi=lo+5;
      F.push({w:3,txt:TL(`Bolus ${m.bolOff>=5?m.bolOff+" min ná":"bij"} het eten; ${dpn} is je eten na ~${t50!=null?Math.round(t50):"?"} min half opgenomen.`,`Bolus ${m.bolOff>=5?m.bolOff+" min after":"at"} the meal; ${dpn} your food is half absorbed after ~${t50!=null?Math.round(t50):"?"} min.`,`Bólus ${m.bolOff>=5?m.bolOff+" min depois":"à refeição"}.`),tip:TL(`Bolus ${lo}–${hi} min vóór het eten.`,`Bolus ${lo}–${hi} min before eating.`,`Bólus ${lo}–${hi} min antes.`)}); }
    else if(m.bolus>0&&m.bolOff<=-20&&m.lowAfter) F.push({w:2,txt:TL(`Bolus ${-m.bolOff} min vooraf, en daarna laag.`,`Bolus ${-m.bolOff} min ahead, then low.`,`Bólus ${-m.bolOff} min antes e depois baixa.`),tip:TL("Iets korter vooraf bolussen, zeker als je al onder 7 zit.","Bolus a bit closer to the meal, especially below 7.","Bólus um pouco mais perto da refeição.")});
    if(!(m.bolus>0)) F.push({w:3,txt:TL("Geen bolus bij deze maaltijd.","No bolus for this meal.","Sem bólus nesta refeição."),tip:TL("Geef de bolus vóór of bij het eten; de loop haalt een gemiste bolus niet in.","Bolus before or at the meal; the loop can't make up a missed bolus.","Faça o bólus antes ou à refeição.")});
    // dosis tegenover je ratio
    if(exp!=null&&m.bolus>0&&exp>0.5){ const r=m.bolus/exp-1;
      if(r<=-0.2) F.push({w:m.peak>HI_T?3:1,txt:TL(`Bolus ${_idaN(m.bolus)} ${E}; je ratio (${_idaN(prof.ic)}) zou ~${_idaN(exp)} ${E} geven (${Math.round(r*100)}%).`,`Bolus ${_idaN(m.bolus)} ${E}; your ratio (${_idaN(prof.ic)}) would give ~${_idaN(exp)} ${E} (${Math.round(r*100)}%).`,`Bólus ${_idaN(m.bolus)} ${E}; o rácio daria ~${_idaN(exp)} ${E}.`),tip:m.peak>HI_T?TL("Laat de bolus-calculator rekenen met de echte koolhydraten in plaats van zelf minder te geven.","Let the bolus calculator use the real carbs instead of giving less yourself.","Use a calculadora com os hidratos reais."):null});
      else if(r>=0.2) F.push({w:m.lowAfter?3:1,txt:TL(`Bolus ${_idaN(m.bolus)} ${E}, meer dan je ratio (~${_idaN(exp)} ${E}, +${Math.round(r*100)}%).`,`Bolus ${_idaN(m.bolus)} ${E}, more than your ratio (~${_idaN(exp)} ${E}, +${Math.round(r*100)}%).`,`Bólus acima do rácio (+${Math.round(r*100)}%).`),tip:m.lowAfter?TL("Geef de berekende bolus, zonder extra erbovenop.","Give the calculated bolus, nothing extra on top.","Dê o bólus calculado, sem extra."):null});
      else F.push({w:0,pos:true,txt:TL(`Bolus klopte met je ratio (${_idaN(m.bolus)} ${E}).`,`Bolus matched your ratio (${_idaN(m.bolus)} ${E}).`,`Bólus de acordo com o rácio.`)}); }
    // start
    if(m.bg0!=null&&m.bg0<7&&m.slope0!=null&&m.slope0<=-0.03) F.push({w:m.lowAfter?3:1,txt:TL(`Start ${_idaN(m.bg0)} en dalend.`,`Start ${_idaN(m.bg0)} and falling.`,`Início ${_idaN(m.bg0)} a descer.`),tip:TL("Zak je al bij het eten: bolus pas bij de eerste hap, of iets minder.","If you're already falling: bolus at the first bite, or a bit less.","Se já está a descer: bólus à primeira garfada.")});
    else if(m.bg0!=null&&m.bg0>HI_T) F.push({w:2,txt:TL(`Je begon al hoog (${_idaN(m.bg0)}).`,`You started high (${_idaN(m.bg0)}).`,`Começou alto (${_idaN(m.bg0)}).`),tip:TL("Bij een hoge start eerder bolussen en wachten tot je daalt voor je eet.","With a high start, bolus earlier and wait until you're falling before eating.","Com início alto, bólus mais cedo.")});
    if(iob0!=null&&B.iobMeal!=null&&iob0>=Math.max(1.5,B.iobMeal*1.8)) F.push({w:m.lowAfter?2:1,txt:TL(`Al ${_idaN(iob0)} ${E} actief bij het eten (meestal ${_idaN(B.iobMeal)}).`,`Already ${_idaN(iob0)} ${E} active at the meal (usually ${_idaN(B.iobMeal)}).`,`Já ${_idaN(iob0)} ${E} ativos (normalmente ${_idaN(B.iobMeal)}).`)});
    // reactie tegenover gewoonlijk
    if(rise!=null&&bR!=null){ if(rise>=bR+2) F.push({w:2,txt:TL(`Steeg ${_idaN(rise)}; ${dpn} meestal ${_idaN(bR)}.`,`Rose ${_idaN(rise)}; ${dpn} usually ${_idaN(bR)}.`,`Subiu ${_idaN(rise)}; normalmente ${_idaN(bR)}.`),tip:TL("Meer koolhydraat dan ingevoerd? Weeg het of lees het etiket.","More carbs than entered? Weigh it or read the label.","Mais hidratos do que registou?")});
      else if(rise<=bR-1.5&&!m.lowAfter) F.push({w:0,pos:true,txt:TL(`Steeg maar ${_idaN(rise)}; ${dpn} meestal ${_idaN(bR)}.`,`Only rose ${_idaN(rise)}; ${dpn} usually ${_idaN(bR)}.`,`Subiu só ${_idaN(rise)}.`)}); }
    if(m.g>=70) F.push({w:1,txt:TL(`Grote maaltijd (${m.g} g).`,`Large meal (${m.g} g).`,`Refeição grande (${m.g} g).`),tip:m.high&&m.high.dur>=120?TL("Bij grote of vette maaltijden een deel van de bolus 1–2 uur later.","With large or fatty meals give part of the bolus 1–2 hours later.","Parte do bólus 1–2 h depois."):null});
    if(m.smb>=Math.max(1,0.25*(m.bolus||0))&&m.peak>HI_T) F.push({w:2,txt:TL(`De loop gaf daarna nog ${_idaN(m.smb)} ${E} extra.`,`The loop added ${_idaN(m.smb)} ${E} afterwards.`,`O loop deu mais ${_idaN(m.smb)} ${E}.`)});
  } else if(m.k==="lo"){
    const d0=_dsAt4(m.ts,15*_M4), iob=d0&&d0.iob!=null?d0.iob:null, bI=B.iobHour[hr];
    if(m.meal){ const ml=m.meal, pr=profileAt(c.timeline,ml.ts), ex=pr&&pr.ic>0?ml.g/pr.ic:null, over=ex&&ml.bolus>ex*1.2, fall=ml.bg0!=null&&ml.bg0<7&&ml.slope0!=null&&ml.slope0<=-0.03;
      F.push({w:3,txt:TL(`${Math.round((m.ts-ml.ts)/_M4)} min na je ${_mealName(ml.ts,ml.g).toLowerCase()} (${ml.g} g, ${_idaN(ml.bolus)} ${E}${fall?`, start ${_idaN(ml.bg0)} en dalend`:""}${over?`, meer dan je ratio (~${_idaN(ex)} ${E})`:""}).`,`${Math.round((m.ts-ml.ts)/_M4)} min after your ${_mealName(ml.ts,ml.g).toLowerCase()} (${ml.g} g, ${_idaN(ml.bolus)} ${E}).`,`${Math.round((m.ts-ml.ts)/_M4)} min após a refeição.`),
        tip:fall?TL("Zak je al bij het eten: bolus pas bij de eerste hap, of iets minder.","If you're already falling: bolus at the first bite, or a bit less.","Se já está a descer: bólus à primeira garfada."):over?TL("Geef de berekende bolus, zonder extra erbovenop.","Give the calculated bolus, nothing extra on top.","Dê o bólus calculado."):TL("Klopten de koolhydraten? Te hoog ingevoerd geeft precies dit.","Were the carbs right? Entering too many gives exactly this.","Os hidratos estavam certos?")}); }
    if(iob!=null&&bI!=null&&iob>=bI+1) F.push({w:2,txt:TL(`${_idaN(iob)} ${E} actief bij het begin; om deze tijd meestal ${_idaN(bI)}.`,`${_idaN(iob)} ${E} active at onset; usually ${_idaN(bI)} at this time.`,`${_idaN(iob)} ${E} ativos; normalmente ${_idaN(bI)}.`)});
    const pre=win(m.ts-3*_H4,m.ts), mx=pre.length?pre.reduce((a,b)=>b.bg>a.bg?b:a):null;
    if(mx&&mx.bg>=12&&!m.meal) F.push({w:3,txt:TL(`Je kwam van ${_idaN(mx.bg)} om ${_hm4(mx.ts)}.`,`You came from ${_idaN(mx.bg)} at ${_hm4(mx.ts)}.`,`Vinha de ${_idaN(mx.bg)} às ${_hm4(mx.ts)}.`),tip:TL("Na een piek werkt de correctie 3–4 uur door. Geef na een handmatige correctie geen tweede binnen 2 uur.","After a peak the correction keeps working for 3–4 hours. Don't add a second manual correction within 2 hours.","Após um pico a correção atua 3–4 h.")});
    if(m.smb2>=1) F.push({w:2,txt:TL(`${_idaN(m.smb2)} ${E} SMB in de 2 uur ervoor.`,`${_idaN(m.smb2)} ${E} SMB in the 2 hours before.`,`${_idaN(m.smb2)} ${E} de SMB nas 2 h anteriores.`)});
    const p30=win(m.ts-30*_M4,m.ts); if(p30.length>=3&&p30[0].bg-p30[p30.length-1].bg>=2) F.push({w:1,txt:TL(`Snelle daling: ${_idaN(p30[0].bg-p30[p30.length-1].bg)} in 30 min.`,`Fast drop: ${_idaN(p30[0].bg-p30[p30.length-1].bg)} in 30 min.`,`Descida rápida.`)});
    const post=win(m.tMark,m.tMark+30*_M4); if(hr<7&&m.dur<=25&&post.length&&Math.max(...post.map(x=>x.bg))-m.min>=2.5) F.push({w:3,txt:TL("Snelle dip én snel herstel in de nacht: past bij op de sensor liggen.","Quick dip and quick recovery at night: fits lying on the sensor.","Queda e recuperação rápidas à noite: pressão no sensor."),tip:TL("Waarschijnlijk geen echte hypo; draag de sensor waar je niet op ligt.","Probably not a real low; wear the sensor where you don't lie on it.","Provavelmente não é hipo real.")});
    if(!m.meal&&!(m.bolus3>0)&&m.smb2<1&&P){ const nb=newBasal(hr), cur=profileAt(c.timeline,m.ts); if(nb!=null&&cur&&cur.basal!=null) F.push({w:2,txt:TL(`Geen eten of bolus ervoor: dit is basaal (nu ${_idaN(cur.basal,2)} ${E}/u).`,`No food or bolus before: this is basal (now ${_idaN(cur.basal,2)} U/h).`,`Sem comida nem bólus: é a basal.`),tip:nb<cur.basal-0.02?TL(`Het voorstel bij Profiel verlaagt dit uur naar ${_idaN(nb,2)}.`,`The proposal under Profile lowers this hour to ${_idaN(nb,2)}.`,`A proposta baixa esta hora para ${_idaN(nb,2)}.`):TL("Het voorstel bij Profiel verlaagt dit uur niet; gebeurt dit vaker, dan zakt het blok mee.","The Profile proposal doesn't lower this hour; if it happens more often, the block will follow.","A proposta não baixa esta hora.")}); }
    if(m.rebound!=null&&m.rebound>HI_T) F.push({w:2,txt:TL(`Daarna door naar ${_idaN(m.rebound)}${m.fix?` (${m.fix} g gelogd)`:""}.`,`Then up to ${_idaN(m.rebound)}${m.fix?` (${m.fix} g logged)`:""}.`,`Depois subiu a ${_idaN(m.rebound)}.`),tip:TL("Vuistregel bij een laagte: 15 g, 15 minuten wachten, dan pas meer.","Rule of thumb for a low: 15 g, wait 15 minutes, then more if needed.","Regra: 15 g, esperar 15 min.")});
  } else {
    const pre=win(m.ts-2*_H4,m.ts), mn=pre.length?Math.min(...pre.map(x=>x.bg)):null;
    if(mn!=null&&mn<4) F.push({w:3,txt:TL(`Na een laagte (${_idaN(mn)}) in de 2 uur ervoor.`,`After a low (${_idaN(mn)}) in the 2 hours before.`,`Após uma baixa (${_idaN(mn)}).`),tip:TL("Vuistregel bij een laagte: 15 g, 15 minuten wachten, dan pas meer.","Rule of thumb for a low: 15 g, wait 15 minutes, then more if needed.","Regra: 15 g, esperar 15 min.")});
    const late=T.filter(t=>t.carbs>=20&&t.ts<m.ts-3*_H4&&t.ts>=m.ts-7*_H4).pop();
    if(late&&!(mn!=null&&mn<4)) F.push({w:2,txt:TL(`${Math.round((m.ts-late.ts)/_H4*10)/10} uur na ${Math.round(late.carbs)} g om ${_hm4(late.ts)}: een late stijging.`,`${Math.round((m.ts-late.ts)/_H4*10)/10} hours after ${Math.round(late.carbs)} g at ${_hm4(late.ts)}: a late rise.`,`Subida tardia após ${Math.round(late.carbs)} g.`),tip:TL("Vet of eiwitrijk eten (pizza, pasta met room, vlees) stijgt laat: geef een deel van de bolus 1–2 uur later.","Fatty or protein-rich food rises late: give part of the bolus 1–2 hours later.","Comida gorda sobe tarde: parte do bólus 1–2 h depois.")});
    let est=null; if(!m.carbs3&&!late){ try{ est=riseCarbEstimate(c,{t0:m.ts,t1:m.tMark,rise:Math.max(0,m.peak-(pre.length?pre[pre.length-1].bg:m.peak-3))}); }catch(_){} }
    if(!(mn!=null&&mn<4)&&!m.carbs3&&!late&&hr>=6&&est&&est.grams>=15){
      F.push({w:2,txt:TL(`Geen koolhydraten gelogd${est?`; de stijging past bij ~${est.grams} g`:""}.`,`No carbs logged${est?`; the rise fits ~${est.grams} g`:""}.`,`Sem hidratos registados.`),tip:TL("Iets gegeten? Leg het vast met +, dan klopt je eetpatroon en je KH-berekening.","Did you eat? Log it with +, so your meal pattern and carb maths are right.","Comeu? Registe com +.")}); }
    const dpk=_dsAt4(m.tMark,15*_M4); if(dpk&&dpk.iob!=null&&B.ioP95!=null&&dpk.iob>=B.ioP95*0.95) F.push({w:2,txt:TL(`Actieve insuline ${_idaN(dpk.iob)} ${E}, tegen je hoogste waarden aan.`,`Active insulin ${_idaN(dpk.iob)} ${E}, near your highest values.`,`Insulina ativa perto do máximo.`),tip:TL("De loop mocht waarschijnlijk niet meer geven: kijk bij Profiel naar Max IOB.","The loop probably wasn't allowed to give more: check Max IOB under Profile.","Veja o Max IOB em Perfil.")});
    if(hr>=4&&hr<9&&!m.carbs3&&P){ const nb=newBasal(Math.max(0,hr-1)), cur=profileAt(c.timeline,m.ts-_H4); if(nb!=null&&cur) F.push({w:2,txt:TL("Ochtendstijging zonder eten (dawn).","Morning rise without food (dawn).","Subida matinal sem comida."),tip:nb>cur.basal+0.02?TL(`Het voorstel bij Profiel zet ${String(Math.max(0,hr-1)).padStart(2,"0")}:00 op ${_idaN(nb,2)} (nu ${_idaN(cur.basal,2)}).`,`The Profile proposal sets ${String(Math.max(0,hr-1)).padStart(2,"0")}:00 to ${_idaN(nb,2)} (now ${_idaN(cur.basal,2)}).`,`A proposta põe ${_idaN(nb,2)}.`):null}); }
    if(hr<4&&!m.carbs3&&!late&&P&&!F.some(f=>f.w>=2&&f.tip)){ const nb=newBasal(hr), cur=profileAt(c.timeline,m.ts); if(nb!=null&&cur&&cur.basal!=null) F.push({w:2,txt:TL(`Hoog in de nacht zonder eten ervoor (basaal nu ${_idaN(cur.basal,2)} ${E}/u).`,`High at night without food before (basal now ${_idaN(cur.basal,2)} U/h).`,`Alta à noite sem comida.`),tip:nb>cur.basal+0.02?TL(`Het voorstel bij Profiel zet dit uur op ${_idaN(nb,2)}.`,`The Profile proposal sets this hour to ${_idaN(nb,2)}.`,`A proposta põe esta hora em ${_idaN(nb,2)}.`):TL("Gebeurt dit vaker op dit uur, dan gaat het basaalblok bij Profiel vanzelf mee omhoog.","If this happens more often at this hour, the basal block under Profile will follow.","Se acontecer mais vezes, a basal acompanha.")}); }
    if(m.smb>=1) F.push({w:0,txt:TL(`De loop gaf ${_idaN(m.smb)} ${E} SMB tijdens deze hoogte.`,`The loop gave ${_idaN(m.smb)} ${E} SMB during this high.`,`O loop deu ${_idaN(m.smb)} ${E} de SMB.`)});
  }
  try{ _facEnrich5(c,m,F); _anEnrich5(c,m,F); }catch(e){ console.error(e); }
  return F.filter(f=>!f.drop).sort((a,b)=>b.w-a.w);
}
function _momTips4(c,m,F){
  if(m.k==="meal"&&!m.lowAfter&&!(m.peak>HI_T)) return [TL(`Goed gegaan: piek ${m.peak!=null?_idaN(m.peak):"—"}, niet laag erna. Zo houden.`,`Went well: peak ${m.peak!=null?_idaN(m.peak):"—"}, no low afterwards. Keep it this way.`,`Correu bem: pico ${m.peak!=null?_idaN(m.peak):"—"}.`)];
  const tips=[], seen=new Set(); for(const f of F){ if(!f.tip||seen.has(f.tip)) continue; seen.add(f.tip);
    let ev={ tip:f.tip }; try{ if(typeof _tipEvidence5==="function") ev=_tipEvidence5(c,f.tip); }catch(_){}
    if(ev.drop) continue; tips.push(ev.tip); if(tips.length>=2) break; }
  if(!tips.length) return _momNext(c,m);
  return tips;
}

function openMoment(c, m, dayFrom){
  const hold=_e4("dagHold"); if(!hold) return;
  const a=m.k==="meal"?m.ts-_H4:m.ts-2*_H4, b=m.k==="meal"?m.ts+4*_H4:Math.max(m.end||m.ts,m.ts)+1.5*_H4;
  const rd=c.glucose.filter(x=>x.ts>=a&&x.ts<=b), ev=(c.treatments||[]).filter(t=>t.ts>=a&&t.ts<=b);
  const E=TL("E","U","U"), F=[];
  if(m.k==="meal"){
    F.push([TL("Koolhydraten","Carbs","Hidratos"),`${m.g} g`,""]);
    F.push([TL("Bolus","Bolus","Bólus"),m.bolus>0?`${_idaN(m.bolus)} ${E}`:"—",m.bolOff==null?"":m.bolOff<=-5?TL(`${-m.bolOff} min vooraf`,`${-m.bolOff} min before`,`${-m.bolOff} min antes`):m.bolOff>=5?TL(`${m.bolOff} min erna`,`${m.bolOff} min after`,`${m.bolOff} min depois`):TL("bij het eten","at the meal","à refeição")]);
    F.push([TL("Start","Start","Início"),m.bg0!=null?_idaN(m.bg0):"—",m.slope0!=null?(m.slope0<=-0.03?TL("dalend","falling","a descer"):m.slope0>=0.03?TL("stijgend","rising","a subir"):TL("vlak","flat","estável")):""]);
    F.push([TL("Piek","Peak","Pico"),m.peak!=null?_idaN(m.peak):"—",m.tPeak!=null?TL(`na ${m.tPeak} min`,`after ${m.tPeak} min`,`após ${m.tPeak} min`):""]);
    F.push([TL("Laagste erna","Lowest after","Mínimo depois"),m.min!=null?_idaN(m.min):"—",m.lowAfter?TL("onder 3,9","below 3.9","abaixo de 3,9"):""]);
    F.push([TL("SMB erna","SMB after","SMB depois"),`${_idaN(m.smb)} ${E}`,TL("3 uur","3 hours","3 horas")]);
  } else if(m.k==="lo"){
    F.push([TL("Laagste","Lowest","Mínimo"),_idaN(m.min),_hm4(m.tMark)]);
    F.push([TL("Duur","Duration","Duração"),`${Math.round(m.dur)} min`,`${_hm4(m.ts)}–${_hm4(m.end)}`]);
    F.push([TL("SMB ervoor","SMB before","SMB antes"),`${_idaN(m.smb2)} ${E}`,TL("2 uur","2 hours","2 horas")]);
    F.push([TL("Bolus ervoor","Bolus before","Bólus antes"),`${_idaN(m.bolus3)} ${E}`,TL("3 uur","3 hours","3 horas")]);
    if(m.fix) F.push([TL("Opgegeten","Treated with","Corrigido com"),`${m.fix} g`,""]);
    if(m.rebound!=null) F.push([TL("Hoogste erna","Highest after","Máximo depois"),_idaN(m.rebound),TL("2,5 uur","2.5 hours","2,5 horas")]);
  } else {
    F.push([TL("Piek","Peak","Pico"),_idaN(m.peak),_hm4(m.tMark)]);
    F.push([TL("Boven 10","Above 10","Acima de 10"),`${Math.round(m.dur)} min`,`${_hm4(m.ts)}–${_hm4(m.end)}`]);
    F.push([TL("SMB tijdens","SMB during","SMB durante"),`${_idaN(m.smb)} ${E}`,""]);
    F.push([TL("Gelogd eten","Logged food","Comida registada"),m.carbs3?TL("ja","yes","sim"):TL("nee","no","não"),TL("3 uur ervoor","3 hours before","3 h antes")]);
  }
  let FX=[]; try{ FX=_momFactors(c,m); }catch(e){ console.error(e); }
  const next=_momTips4(c,m,FX);
  // Laagte: dezelfde oorzaakbepaling als de meldingen op Vandaag (explainHypo), zodat beide hetzelfde zeggen
  let cause=null; if(m.k==="lo"){ try{ cause=explainHypo({start:m.ts}, c.glucose, c.treatments, c.timeline); }catch(_){} }
  const node=document.createElement("div"); node.className="momdet";
  node.innerHTML=`<p class="isub">${esc(new Date(localDayKey(m.ts)+"T12:00:00").toLocaleDateString(LOCALE(),{weekday:"long",day:"numeric",month:"long"}))} · ${_hm4(m.k==="meal"?m.ts:m.tMark)}</p>
    <section class="ibox">${idaCurveSvg(rd,ev,{from:a,to:b,marks:[{ts:m.tMark,bg:m.bg,n:m.n,k:m.k}],h:170})}</section>
    ${cause?`<p class="mcause"><span>${TL("Waarschijnlijke oorzaak","Likely cause","Causa provável")}</span><b>${cause.label.charAt(0).toUpperCase()+cause.label.slice(1)}</b><i>${TL("zekerheid","certainty","certeza")} ${cause.conf}</i></p>`:""}
    <div class="mfacts">${F.map(([k,v,s])=>`<div><i>${k}</i><b>${v}</b>${s?`<em>${s}</em>`:""}</div>`).join("")}</div>
    ${FX.length?`<section class="ibox mwhy"><span class="ilabel">${TL("Wat meespeelde","What played a part","O que contribuiu")}</span><ul>${FX.slice(0,5).map(f=>`<li class="${f.pos?"pos":f.w>=3?"big":f.w>=2?"mid":"low"}">${esc(f.txt)}</li>`).join("")}</ul></section>`:""}
    <section class="nexttime"><span class="nk">${TL("VOLGENDE KEER","NEXT TIME","PRÓXIMA VEZ")}</span>${next.map(t=>`<p>${esc(t)}</p>`).join("")}</section>
    <button class="ibtn line" data-idaask="moment" style="align-self:flex-start">${TL("Vraag door","Ask more","Perguntar")} ›</button>`;
  hold.appendChild(node);
  openDetail([node], `${_momTitle(m)} · ${_hm4(m.k==="meal"?m.ts:m.tMark)}`, ()=>node.remove());
}

/* ── Profiel: werkbank ───────────────────────────────────────────────────── */
function _blkEnd(arr,i){ return i+1<arr.length?hhmmToMin(arr[i+1].from):1440; }
function _avg(a){ return a.reduce((s,x)=>s+x,0)/a.length; }
function idaProfiel(c){
  const host=_e4("profBody"); if(!host) return;
  if(!_P || !_P.basal){
    const why = !_P ? TL("Nog geen berekening.","No calculation yet.","Ainda sem cálculo.")
      : _P.none==="profiel" ? TL("Er is geen AAPS-profiel gevonden in je Nightscout.","No AAPS profile found in your Nightscout.","Nenhum perfil AAPS encontrado.")
      : TL("Te weinig loop-data (temp-basaal) om een profiel te berekenen. Synchroniseer minstens 14 dagen.","Too little loop data to calculate a profile. Sync at least 14 days.","Poucos dados do loop.");
    host.innerHTML=`<section class="ibox"><b class="ittl">${TL("Nog geen profielvoorstel","No profile proposal yet","Ainda sem proposta")}</b><p class="its" style="margin-top:.3rem">${why}</p></section>`; try{ _profWhy5(c); }catch(e){ console.error(e); } return;
  }
  const P=_P, E=TL("E","U","U"), isfNew=_pMed(P.isf.map(b=>b.value));
  const icCh=P.ic.filter(b=>Math.abs(b.value-b.now)>=0.1);
  const cls=(a,b)=>a>b+0.04?"up":a<b-0.04?"dn":"";
  let html=`<p class="isub">${TL(`Voorstel uit ${P.days} bruikbare dagen${P.name?` · nu actief: ${esc(P.name)}`:""}`,`Proposal from ${P.days} usable days${P.name?` · active now: ${esc(P.name)}`:""}`,`Proposta de ${P.days} dias${P.name?` · ativo: ${esc(P.name)}`:""}`)}</p>
  <div class="psum"><div class="${cls(P.dayNew,P.dayNow)}"><i>${TL("Basaal per dag","Basal per day","Basal por dia")}</i><b>${_idaN(P.dayNew)} ${E}</b><em>${TL("nu","now","agora")} ${_idaN(P.dayNow)}</em></div>
    <div class="${cls(P.isfNow,isfNew)}"><i>ISF</i><b>${_idaN(isfNew)}</b><em>${TL("nu","now","agora")} ${_idaN(P.isfNow)}</em></div>
    <div class="${icCh.length?(icCh[0].value<icCh[0].now?"up":"dn"):""}"><i>${TL("KH-ratio","Carb ratio","Rácio HC")}</i><b>${icCh.length?_idaN(icCh[0].value):P.ic.map(b=>_idaN(b.value)).join(" · ")}</b><em>${icCh.length?TL(`nu ${_idaN(icCh[0].now)}, vanaf ${icCh[0].from}`,`now ${_idaN(icCh[0].now)}, from ${icCh[0].from}`,`agora ${_idaN(icCh[0].now)}`):TL("gelijk","unchanged","igual")}</em></div></div>`;
  // waar het misgaat
  const hs=_hourStats(c), lo=hs.map(h=>h.lo), hi=hs.map(h=>h.hi), ls=_worstWindow(lo,3), hw=_worstWindow(hi,4);
  const lW=Math.max(...[0,1,2].map(k=>lo[(ls+k)%24])), hW=Math.max(...[0,1,2,3].map(k=>hi[(hw+k)%24]));
  const cell=(v,mx,col)=>`<i style="background:color-mix(in srgb,var(--${col}) ${Math.round(Math.min(1,v/mx)*100)}%,var(--surface-2))" title="${Math.round(v*100)}%"></i>`;
  html+=`<section class="ibox"><span class="ilabel">${TL("Waar het misgaat","Where it goes wrong","Onde corre mal")}</span>
    <div class="heat"><span>${TL("te laag","too low","baixa")}</span><div class="hrow">${lo.map(v=>cell(v,0.10,"lo")).join("")}</div>
    <span>${TL("te hoog","too high","alta")}</span><div class="hrow">${hi.map(v=>cell(v,0.5,"hi")).join("")}</div>
    <div class="hax"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div></div>
    <p class="heatsay">${TL(`Laag vooral tussen <b>${ls} en ${(ls+3)%24} uur</b> (${_idaN(lW*100)}% van de tijd), hoog vooral tussen <b>${hw} en ${(hw+4)%24} uur</b> (${Math.round(hW*100)}%).`,`Low mostly between <b>${ls}:00 and ${(ls+3)%24}:00</b> (${_idaN(lW*100)}% of the time), high mostly between <b>${hw}:00 and ${(hw+4)%24}:00</b> (${Math.round(hW*100)}%).`,`Baixa sobretudo entre <b>${ls} e ${(ls+3)%24} h</b> (${_idaN(lW*100)}%), alta entre <b>${hw} e ${(hw+4)%24} h</b> (${Math.round(hW*100)}%).`)}</p></section>`;
  // basaal nu en nieuw
  const W=340, H=128, PL=22, PB=16, PT=8, X=m=>PL+m/1440*(W-PL-4);
  const old=[]; for(let h=0;h<24;h++){ const p=profileAt(c.timeline,_hourTs(h,c.q.to||Date.now())); old.push(p&&p.basal!=null?p.basal:0); }
  const nw=[]; for(let h=0;h<24;h++){ let v=P.basal[0].value; for(const b of P.basal) if(hhmmToMin(b.from)<=h*60) v=b.value; nw.push(v); }
  const mx=Math.max(1,...old,...nw)*1.12, Y=v=>PT+(1-v/mx)*(H-PT-PB), f=v=>v.toFixed(1);
  let fill="", po="", pn="";
  for(let h=0;h<24;h++){ const a=old[h], b=nw[h]; if(Math.abs(a-b)>=0.025) fill+=`<rect class="${b>a?"up":"dn"}" x="${f(X(h*60))}" y="${f(Y(Math.max(a,b)))}" width="${f(X(60)-PL)}" height="${f(Math.abs(Y(a)-Y(b)))}"/>`;
    po+=(h?"L":"M")+f(X(h*60))+" "+f(Y(a))+"H"+f(X((h+1)*60)); pn+=(h?"L":"M")+f(X(h*60))+" "+f(Y(b))+"H"+f(X((h+1)*60)); }
  let ax=""; for(const h of [0,6,12,18,24]) ax+=`<line class="grid" x1="${f(X(h*60))}" y1="${PT}" x2="${f(X(h*60))}" y2="${H-PB}"/><text x="${f(X(h*60))}" y="${H-3}" text-anchor="${h===0?"start":h===24?"end":"middle"}">${String(h).padStart(2,"0")}</text>`;
  for(const v of [0.5,1,1.5,2,2.5].filter(v=>v<mx)) ax+=`<text x="${PL-4}" y="${f(Y(v)+3)}" text-anchor="end">${_idaN(v)}</text>`;
  html+=`<section class="ibox"><div class="imrow"><span class="ilabel" style="margin:0">${TL("Basaal","Basal","Basal")}</span><i class="imono" style="font-size:.7rem">${TL("E/u","U/h","U/h")}</i></div>
    <svg class="bchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${TL("Basaal nu (stippellijn) en nieuw","Basal now (dashed) and new","Basal atual e nova")}">${ax}${fill}<path class="old" d="${po}"/><path class="new" d="${pn}"/></svg>
    <div class="ileg"><span><i class="l-new"></i>${TL("nieuw","new","nova")}</span><span><i class="dash"></i>${TL("nu","now","atual")}</span><span><i class="l-up"></i>${TL("meer","more","mais")}</span><span><i class="l-dn"></i>${TL("minder","less","menos")}</span></div>
    <p class="its" style="margin-top:.45rem">${TL("Elk blok begint een uur vóór het moment dat je de insuline nodig hebt: basaal werkt pas na ongeveer een uur.","Each block starts an hour before you need the insulin: basal takes about an hour to act.","Cada bloco começa uma hora antes: a basal demora cerca de uma hora.")}</p></section>`;
  // wijzigingen
  const rows=[], chip=(d,dec)=>`<span class="ichip ${d>0?"up":"dn"}">${d>0?"+":"−"}${_idaN(Math.abs(d),dec)}</span>`;
  P.basal.forEach((b,i)=>{ const n=_avg(b.now); if(Math.abs(b.value-n)<0.05) return;
    const why=b.why==="laag"?TL(`${_idaN(b.low*100)}% van de tijd laag`,`${_idaN(b.low*100)}% of the time low`,`${_idaN(b.low*100)}% do tempo baixa`):b.act?TL(`loop levert nuchter ${_idaN(b.act[0],2)}${b.act[1]-b.act[0]>0.05?"–"+_idaN(b.act[1],2):""}`,`loop delivers ${_idaN(b.act[0],2)}${b.act[1]-b.act[0]>0.05?"–"+_idaN(b.act[1],2):""} fasting`,`loop entrega ${_idaN(b.act[0],2)}`):"";
    const capped=b.value>n && b.act && b.act[0]*0.98>b.value;
    const why2=why+(capped?TL(" · hooguit +20% per stap"," · at most +20% per step"," · máx. +20% por passo"):"");
    const was=b.now.length>1?`${_idaN(Math.min(...b.now),2)}–${_idaN(Math.max(...b.now),2)}`:_idaN(b.now[0],2);
    rows.push(`<div class="iprow"><span class="ipt">${b.from}</span><span class="ipv"><span class="ipk">${TL("Basaal","Basal","Basal")}</span><s>${was} → </s>${_idaN(b.value,2)}</span>${chip(b.value-n,2)}<span class="ipw">${why2}</span></div>`); });
  P.isf.forEach(b=>{ if(Math.abs(b.value-b.now)<0.1) return;
    rows.push(`<div class="iprow"><span class="ipt">${b.from}</span><span class="ipv"><span class="ipk">ISF</span><s>${_idaN(b.now)} → </s>${_idaN(b.value)}</span>${chip(b.value-b.now,1)}<span class="ipw">${b.why==="laag"?TL("hier zit je vaak laag","you're often low here","baixas aqui"):TL("uit autosens en dagdosis","from autosens and daily dose","de autosens e dose diária")}</span></div>`); });
  icCh.forEach(b=>{ rows.push(`<div class="iprow"><span class="ipt">${b.from}</span><span class="ipv"><span class="ipk">${TL("KH-ratio","Carb ratio","Rácio HC")}</span><s>${_idaN(b.now)} → </s>${_idaN(b.value)}</span>${chip(b.value-b.now,1)}<span class="ipw">${TL(`gemeten ${_idaN(b.measured)} uit ${b.n} maaltijden`,`measured ${_idaN(b.measured)} from ${b.n} meals`,`medido ${_idaN(b.measured)} em ${b.n} refeições`)}</span></div>`); });
  const same=[]; if(!P.isf.some(b=>Math.abs(b.value-b.now)>=0.1)) same.push("ISF"); if(!icCh.length) same.push(TL("KH-ratio","carb ratio","rácio HC")); same.push(TL("streefwaarde","target","alvo"));
  html+=`<section class="ibox chg"><span class="ilabel">${TL("Wijzigingen","Changes","Alterações")}</span>${rows.length?rows.join(""):`<p class="its">${TL("Je profiel past bij je data. Geen wijzigingen nodig.","Your profile matches your data. No changes needed.","O perfil corresponde aos dados.")}</p>`}
    <p class="its" style="margin-top:.5rem">${TL(`Ongewijzigd: ${same.join(", ")}.`,`Unchanged: ${same.join(", ")}.`,`Inalterado: ${same.join(", ")}.`)}</p>`;
  const tel=P.ic.filter(b=>b.why==="tellen"), hoog=P.ic.filter(b=>b.why==="hoog"), laag=P.ic.filter(b=>b.why==="laag");
  if(tel.length) html+=`<div class="pnote">${TL(`<b>KH-ratio blijft gelijk.</b> Je maaltijden wijzen op ${tel.map(b=>`${_idaN(b.measured)} vanaf ${b.from}`).join(" en ")} (sterker), maar na het eten stijg je alsof je ${_idaPct(P.mfrac)} van je ingevoerde koolhydraten at. Dat kan ook aan het tellen liggen. Weeg je je eten of lees je etiketten? Zet dan "Ik tel mijn koolhydraten nauwkeurig" aan; dan neemt IDA de gemeten ratio over (hooguit 20% per stap).`,`<b>Carb ratio stays the same.</b> Your meals point to ${tel.map(b=>`${_idaN(b.measured)} from ${b.from}`).join(" and ")} (stronger), but after meals you rise as if you ate ${_idaPct(P.mfrac)} of the carbs you entered. That can also be the counting. Do you weigh food or read labels? Turn on "I count my carbs accurately"; IDA then uses the measured ratio (at most 20% per step).`,`<b>Rácio igual.</b> As refeições apontam para um rácio mais forte, mas pode ser a contagem. Se pesa a comida, ative "Conto os hidratos com precisão".`)}<br><button class="ibtn" data-set="inCarbsOk">${TL("Naar de instelling","Open the setting","Abrir a definição")}</button></div>`;
  else if(cfg.carbsAccurate&&icCh.some(b=>b.value<b.now)) html+=`<div class="pnote">${TL("Je telt nauwkeurig (instelling): de gemeten KH-ratio is overgenomen, hooguit 20% per stap.","You count accurately (setting): the measured carb ratio is used, at most 20% per step.","Conta com precisão: o rácio medido foi usado.")}</div>`;
  if(hoog.length) html+=`<p class="its" style="margin-top:.5rem">${TL(`KH-ratio vanaf ${hoog.map(b=>b.from).join(", ")} niet zwakker: na die maaltijden zit je ${_idaPct(_avg(hoog.map(b=>b.hiF)))} van de tijd boven 10.`,`Carb ratio from ${hoog.map(b=>b.from).join(", ")} not weaker: after those meals you're above 10 ${_idaPct(_avg(hoog.map(b=>b.hiF)))} of the time.`,`Rácio não mais fraco: alta depois das refeições.`)}</p>`;
  if(laag.length) html+=`<p class="its" style="margin-top:.5rem">${TL(`KH-ratio vanaf ${laag.map(b=>b.from).join(", ")} niet sterker: na die maaltijden zit je ${_idaN(_avg(laag.map(b=>b.loF))*100)}% van de tijd laag.`,`Carb ratio from ${laag.map(b=>b.from).join(", ")} not stronger: after those meals you're low ${_idaN(_avg(laag.map(b=>b.loF))*100)}% of the time.`,`Rácio não mais forte: baixas depois das refeições.`)}</p>`;
  html+=`</section>`;
  // meting
  const act=_idaActivation();
  if(act){ const d=Math.floor((Date.now()-act.ts)/864e5), r=Math.min(7,d), dash=(r/7*94.2).toFixed(1);
    html+=`<section class="ibox pmeas"><svg class="pring" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="15" stroke="var(--surface-2)"/><circle cx="20" cy="20" r="15" stroke="var(--brand)" stroke-dasharray="${dash} 94.2" stroke-linecap="round" transform="rotate(-90 20 20)"/></svg>
      <div style="flex:1"><b>${d<7?TL(`Meting loopt · dag ${d} van 7`,`Measuring · day ${d} of 7`,`A medir · dia ${d} de 7`):TL("Meting klaar","Measurement done","Medição concluída")}</b><br><span>${TL(`Geactiveerd op ${new Date(act.ts).toLocaleDateString(LOCALE(),{day:"numeric",month:"long"})}. De uitslag staat bij Voortgang.`,`Activated on ${new Date(act.ts).toLocaleDateString(LOCALE(),{day:"numeric",month:"long"})}. The result is under Progress.`,`Ativado em ${new Date(act.ts).toLocaleDateString(LOCALE())}.`)}</span></div><button class="ibtn" data-team="1">${TL("Voortgang","Progress","Progresso")} ›</button></section>`; }
  // max IOB
  const MA=(typeof maxIobAdvice==="function")?maxIobAdvice(c):null, iobMin=_idaN(MA?MA.v:P.maxIobMin+(P.mealBolus||0));
  const whyI=MA?MA.why:TL("3× je hoogste basaal plus je gemiddelde maaltijdbolus","3× your highest basal plus your average meal bolus","3× o basal mais alto mais o bólus médio");
  html+=`<section class="inote">${TL(`<b>Max IOB</b> (AAPS › SMB-instellingen): minstens ${iobMin} ${E}, omdat ${whyI}.`,`<b>Max IOB</b> (AAPS › SMB settings): at least ${iobMin} ${E}, because ${whyI}.`,`<b>Max IOB</b>: pelo menos ${iobMin} ${E} (${whyI}).`)}</section>
    <div class="pacts"><button class="ibtn big acc" id="profTake">${TL("Overnemen in AAPS","Copy into AAPS","Passar para o AAPS")}</button>
      <div class="row2"><button class="ibtn line" id="profCopy">${TL("Kopieer als tekst","Copy as text","Copiar texto")}</button><button class="ibtn line" id="profExplain">${TL("Leg uit","Explain","Explicar")}</button></div>
      <button class="ibtn big line" id="profAct">${TL("Ik heb het profiel geactiveerd","I've activated the profile","Ativei o perfil")}</button></div>`;
  host.innerHTML=html;
  host.querySelectorAll("[data-set]").forEach(b=>b.onclick=()=>idaOpenSetting(b.dataset.set));
  host.querySelectorAll("[data-team]").forEach(b=>b.onclick=()=>showTab("consult"));
  _e4("profTake").onclick=()=>openTake(c);
  _e4("profExplain").onclick=()=>openAI(TL("Uitleg bij je profiel","About your profile","Sobre o seu perfil"), _profileFacts(P), TL("Leg in gewone taal uit wat er in dit nieuwe profiel verandert en waarom.","Explain in plain words what changes in this new profile and why.","Explique em palavras simples o que muda neste novo perfil e porquê."));
  _e4("profCopy").onclick=async()=>{ const txt=aapsProfileText(P);
    try{ await navigator.clipboard.writeText(txt); toast(TL("Gekopieerd.","Copied.","Copiado.")); }
    catch(_){ const ta=document.createElement("textarea"); ta.value=txt; document.body.appendChild(ta); ta.select(); try{ document.execCommand("copy"); toast(TL("Gekopieerd.","Copied.","Copiado.")); }catch(__){} ta.remove(); } };
  _e4("profAct").onclick=()=>profActivate();
  try{ _profWhy5(c); }catch(e){ console.error(e); }
}
async function profActivate(){
  const P=_P; if(!P||!P.basal) return;
  const an={ id:"prof-"+Date.now(), ts:Date.now(), type:"wijziging", note:TL(`Profiel ${_profName()} geactiveerd`,`Profile ${_profName()} activated`,`Perfil ${_profName()} ativado`), created:Date.now(),
    ida:{ basal:P.basal.map(b=>[b.from,b.value]), isf:P.isf.map(b=>[b.from,b.value]), ic:P.ic.map(b=>[b.from,b.value]) } };
  try{ await DB.putMany("annotations",[an]); }catch(e){ toast(TL("Opslaan mislukt.","Save failed.","Falha ao guardar.")); return; }
  _idaAnns.push(an); toast(TL("Vastgelegd. De meting loopt nu 7 dagen.","Saved. The 7-day measurement has started.","Guardado. A medição de 7 dias começou."));
  try{ localStorage.removeItem("ida.take"); }catch(_){}
  if(typeof _det!=="undefined"&&_det) closeDetail(true);
  for(const f of [idaTeam, idaVandaag, idaProfiel]) try{ f(_ctx); }catch(e){ console.error(e); }
  showTab("profiel");
}

/* ── Overnemen in AAPS: stap voor stap, in de volgorde van het lokale profiel ── */
function _takeSig(P){ return JSON.stringify([P.basal.map(b=>[b.from,b.value]),P.isf.map(b=>[b.from,b.value]),P.ic.map(b=>[b.from,b.value])]); }
function _takeState(P){ let s=null; try{ s=JSON.parse(localStorage.getItem("ida.take")||"null"); }catch(_){}
  if(!s||s.sig!==_takeSig(P)) s={sig:_takeSig(P),done:{}}; return s; }
function _takeSave(s){ try{ localStorage.setItem("ida.take",JSON.stringify(s)); }catch(_){} }
function openTake(c){
  const hold=_e4("profHold"); if(!hold||!_P||!_P.basal) return;
  const node=document.createElement("div"); node.className="take"; hold.appendChild(node);
  _i4.take=0; renderTake(node);
  openDetail([node], TL("Overnemen in AAPS","Copy into AAPS","Passar para o AAPS"), ()=>node.remove());
}
function renderTake(node){
  const P=_P, S=_takeState(P), st=_i4.take, E=TL("E","U","U");
  const steps=[
    { k:"ic", h:TL("KH-ratio","Carb ratio","Rácio HC"), tab:"IC", unit:TL("g/E","g/U","g/U"), rows:P.ic.map(b=>({from:b.from, v:_idaN(b.value), was:_idaN(b.now), chg:Math.abs(b.value-b.now)>=0.1})) },
    { k:"isf", h:"ISF", tab:"ISF", unit:"mmol/L/"+E, rows:P.isf.map(b=>({from:b.from, v:_idaN(b.value), was:_idaN(b.now), chg:Math.abs(b.value-b.now)>=0.1})) },
    { k:"bas", h:TL("Basaal","Basal","Basal"), tab:"BAS", unit:TL("E/u","U/h","U/h"), rows:P.basal.map(b=>({from:b.from, v:_idaN(b.value,2), was:b.now.length>1?`${_idaN(Math.min(...b.now),2)}–${_idaN(Math.max(...b.now),2)}`:_idaN(b.now[0],2), chg:Math.abs(b.value-_avg(b.now))>=0.05})) },
    { k:"act", h:TL("Opslaan en activeren","Save and activate","Guardar e ativar"), tab:"TARG" } ];
  const s=steps[st];
  const sum=P.basal.reduce((t,b,i)=>t+b.value*(_blkEnd(P.basal,i)-hhmmToMin(b.from))/60,0);
  let body=`<div class="steps">${steps.map((_,i)=>`<i class="${i<=st?"on":""}"></i>`).join("")}</div>
    <span class="stepk">${TL(`Stap ${st+1} van 4 · tabblad ${s.tab}`,`Step ${st+1} of 4 · tab ${s.tab}`,`Passo ${st+1} de 4 · separador ${s.tab}`)}</span>
    <h2 class="steph">${s.h}</h2>`;
  if(s.rows){
    body+=`<p class="stepp">${st===0?TL("Open in AAPS je lokale profiel en kies het tabblad IC. Zet elk blok zoals hieronder en vink het af.","In AAPS, open your local profile and choose the IC tab. Set each block as below and tick it off.","No AAPS, abra o perfil local, separador IC. Defina cada bloco e marque-o."):TL(`Tabblad ${s.tab}. Zet elk blok zoals hieronder en vink het af.`,`Tab ${s.tab}. Set each block as below and tick it off.`,`Separador ${s.tab}. Defina cada bloco e marque-o.`)} <span class="imono">${s.unit}</span></p>
      <div class="clist">${s.rows.map((r,i)=>{ const id=`${s.k}-${r.from}`, on=!!S.done[id];
        return `<label class="crow${r.chg?" chg":""}${on?" done":""}"><input type="checkbox" data-ck="${id}" ${on?"checked":""}><span class="ct">${r.from}</span><span class="cv">${r.v}</span><span class="cw">${r.chg?TL(`was ${r.was}`,`was ${r.was}`,`era ${r.was}`):TL("gelijk","same","igual")}</span></label>`; }).join("")}</div>`;
    if(s.k==="bas") body+=`<div class="tcheck"><span>${TL("AAPS toont het dagtotaal. Dat moet zijn:","AAPS shows the daily total. It should be:","O AAPS mostra o total diário. Deve ser:")}</span><b>${_idaN(sum,2)} ${E}</b></div>`;
  } else {
    body+=`<p class="stepp">${TL(`Tabblad TARG: ${P.target.lo!=null?_idaN(P.target.lo)+"–"+_idaN(P.target.hi):"je streefwaarde"} blijft gelijk. Geef het profiel een naam, bijvoorbeeld "${_profName()}", sla op en activeer het met een profielwissel (100%, zonder duur).`,`TARG tab: ${P.target.lo!=null?_idaN(P.target.lo)+"–"+_idaN(P.target.hi):"your target"} stays the same. Name the profile, e.g. "${_profName()}", save it and activate it with a profile switch (100%, no duration).`,`Separador TARG: o alvo fica igual. Dê um nome ao perfil, guarde e ative-o (100%, sem duração).`)}</p>
      <div class="clist"><label class="crow"><input type="checkbox" data-ck="saved" ${S.done.saved?"checked":""}><span class="cv" style="font-size:.95rem">${TL("Profiel opgeslagen","Profile saved","Perfil guardado")}</span></label><label class="crow"><input type="checkbox" data-ck="switched" ${S.done.switched?"checked":""}><span class="cv" style="font-size:.95rem">${TL("Profielwissel gedaan","Profile switch done","Troca de perfil feita")}</span></label></div>
      <p class="its" style="margin-top:.6rem">${TL("Tik daarna op de knop: IDA start de meting van 7 dagen en vergelijkt met de 14 dagen ervoor.","Then tap the button: IDA starts the 7-day measurement and compares it with the 14 days before.","Depois toque no botão: o IDA começa a medição de 7 dias.")}</p>`;
  }
  const left=s.rows?s.rows.filter(r=>!S.done[`${s.k}-${r.from}`]).length:0;
  body+=`<div class="snav"><button class="ibtn line" id="takePrev" ${st===0?"disabled":""}>${TL("Vorige","Back","Anterior")}</button>
    ${st<3?`<button class="ibtn acc" id="takeNext">${left?TL(`Volgende (${left} open)`,`Next (${left} open)`,`Seguinte (${left})`):TL("Volgende","Next","Seguinte")}</button>`:`<button class="ibtn acc" id="profAct2">${TL("Ik heb het geactiveerd","I've activated it","Ativei")}</button>`}</div>`;
  node.innerHTML=`<div class="stepbody${_rm4()?"":" in"}">${body}</div>`;
  node.querySelectorAll("[data-ck]").forEach(cb=>cb.onchange=()=>{ const S2=_takeState(P); if(cb.checked) S2.done[cb.dataset.ck]=1; else delete S2.done[cb.dataset.ck]; _takeSave(S2);
    cb.closest(".crow").classList.toggle("done",cb.checked);
    const nb=_e4("takeNext"); if(nb&&s.rows){ const l=s.rows.filter(r=>!S2.done[`${s.k}-${r.from}`]).length; nb.textContent=l?TL(`Volgende (${l} open)`,`Next (${l} open)`,`Seguinte (${l})`):TL("Volgende","Next","Seguinte"); } });
  const pv=_e4("takePrev"); if(pv) pv.onclick=()=>{ _i4.take=Math.max(0,st-1); renderTake(node); window.scrollTo({top:0}); };
  const nx=_e4("takeNext"); if(nx) nx.onclick=()=>{ _i4.take=Math.min(3,st+1); renderTake(node); window.scrollTo({top:0}); };
  const ac=_e4("profAct2"); if(ac) ac.onclick=()=>profActivate();
}

/* ── na elke berekening: Dag bijwerken, eerste binnenkomst animeren ───────── */
(function(){ const o=renderIda; let first=true;
  window.renderIda=async function(keep){
    const r=await o(keep);
    try{ if(_ctx&&_ctx.glucose){ delete _ctx._days4; delete _ctx._mr4;
      const t=_curTab(); if(t==="dag") idaDag();
      if(first){ first=false; requestAnimationFrame(()=>idaEnter(t)); } } }catch(e){ console.error(e); }
    return r; };
})();

/* ── Voortgang: voorraad en export onderaan, los van meting en consult ──── */
(function(){ const o=idaExtrasTeam;
  window.idaExtrasTeam=function(c){
    let more=_e4("teamMore");
    if(!more){ const ep=_e4("epConsult"); if(!ep) return o(c);
      ep.insertAdjacentHTML("afterend",`<div class="h3" id="teamMoreH">${TL("Voorraad en export","Supplies and export","Material e exportação")}</div><div id="teamMore"></div>`); more=_e4("teamMore"); }
    more.innerHTML=""; o(c);
    const top=_e4("teamTop"); if(!top) return;
    [...top.querySelectorAll(".ix")].forEach(el=>{ if(el.querySelector("#expStart,#expStop")||/xperiment/.test(el.textContent.slice(0,60))) return; more.appendChild(el); });
  }; })();

"use strict";
/* IDA — de 32 analyses uit het onderzoek (doc "IDA — welke analyses horen in de assistent").
   Eén motor (idaAn) rekent alles uit eigen data; het scherm "Analyses" (onder Dag) toont ze per thema,
   Vandaag krijgt alleen wat nú telt (ketonen, pod, vergeten profielpercentage), en de momenten in Dag
   krijgen er de factoren bij die bij jóu aantoonbaar meespelen (analyse 28).
   Laadt na ida4.js. Klassiek script, globale functies uit core.js / ida*.js. */

const _H5=3600e3, _M5=60e3, _D5=864e5;
const _n5=(v,d=1)=>(v==null||!isFinite(v))?"—":(+v).toFixed(d).replace(".",DECSEP());
const _p5=v=>(v==null||!isFinite(v))?"—":Math.round(v*100)+"%";
const _pp5=v=>(v==null||!isFinite(v))?"—":(v>0?"+":v<0?"−":"")+Math.abs(Math.round(v*100))+TL("%-punt","%-pt","%-pt");
const _med5=a=>{ if(!a.length) return null; const s=[...a].sort((x,y)=>x-y), k=s.length>>1; return s.length%2?s[k]:(s[k-1]+s[k])/2; };
const _avg5=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const _hm5=ts=>fmtMin(todMin(ts));
const _dk5=ts=>localDayKey(ts);
const _dateL5=ts=>new Date(ts).toLocaleDateString(LOCALE(),{day:"numeric",month:"short"});
const _DPN5=()=>[TL("nacht","night","noite"),TL("ochtend","morning","manhã"),TL("middag","afternoon","tarde"),TL("avond","evening","noite")];
const _dp5=ts=>{ const m=todMin(ts); return m<360?0:m<660?1:m<1020?2:3; };
_NAV4.inzicht="dag";

/* ── basis ─────────────────────────────────────────────────────────────── */
function _lb5(arr, ts){ let lo=0,hi=arr.length; while(lo<hi){ const m=(lo+hi)>>1; if(arr[m].ts<ts) lo=m+1; else hi=m; } return lo; }
function _slice5(G, a, b){ const out=[]; for(let i=_lb5(G,a); i<G.length&&G[i].ts<b; i++) out.push(G[i]); return out; }
function _bgAt5(G, ts, tol){ const i=_lb5(G,ts); let best=null; for(const j of [i-1,i]){ const x=G[j]; if(x&&Math.abs(x.ts-ts)<=(tol||10*_M5)&&(!best||Math.abs(x.ts-ts)<Math.abs(best.ts-ts))) best=x; } return best?best.bg:null; }
function _stat5(arr){ if(!arr.length) return { n:0 };
  let inr=0, lo=0, hi=0, vlo=0, vhi=0, s=0; for(const x of arr){ s+=x.bg; if(x.bg<LO_T){ lo++; if(x.bg<VLO_T) vlo++; } else if(x.bg>HI_T){ hi++; if(x.bg>13.9) vhi++; } else inr++; }
  const n=arr.length; return { n, tir:inr/n, tbr:lo/n, tar:hi/n, vlo:vlo/n, vhi:vhi/n, mean:s/n }; }
/* Episodes volgens de consensus van 2023: begint na ≥15 min aaneen in de zone, eindigt na ≥15 min erbuiten. */
function _eps5(G, inZone, minMin){
  const out=[]; let cur=null, inS=null, outS=null, prev=null; const MIN=(minMin||15)*_M5, low=inZone(1);
  const close=()=>{ if(cur){ cur.dur=(cur.end-cur.start)/_M5+5; out.push(cur); } cur=null; outS=null; };
  for(const x of G){
    if(prev&&x.ts-prev.ts>30*_M5){ close(); inS=null; }
    if(inZone(x.bg)){ outS=null;
      if(!cur){ if(inS==null) inS=x; if(x.ts-inS.ts+5*_M5>=MIN) cur={ start:inS.ts, end:x.ts, ext:x.bg, extTs:x.ts }; }
      else cur.end=x.ts;
      if(cur&&(low?x.bg<cur.ext:x.bg>cur.ext)){ cur.ext=x.bg; cur.extTs=x.ts; } }
    else { inS=null; if(cur){ if(outS==null) outS=x; if(x.ts-outS.ts+5*_M5>=15*_M5) close(); } }
    prev=x; }
  close(); return out;
}
// som van insuline in [a,b) via prefixsommen (snel bij veel vensters)
function _insSum5(c, smb){ const k=smb?"_ps5s":"_ps5m"; if(!c[k]){ const T=(c.treatments||[]).filter(t=>t.insulin>0&&(smb?t.isSMB:!t.isSMB)).sort((a,b)=>a.ts-b.ts), P=[0]; for(const t of T) P.push(P[P.length-1]+t.insulin); c[k]={ T, P }; }
  const { T, P }=c[k]; return (a,b)=>P[_lb5(T,b)]-P[_lb5(T,a)]; }
function _carbTs5(c){ return c._ct5||(c._ct5=(c.treatments||[]).filter(t=>t.carbs>0).map(t=>({ ts:t.ts, g:t.carbs })).sort((a,b)=>a.ts-b.ts)); }
const _isLo5=bg=>bg<LO_T, _isVlo5=bg=>bg<VLO_T, _isHi5=bg=>bg>HI_T, _isVhi5=bg=>bg>13.9;
function _sites5(c){ return (c.treatments||[]).filter(t=>/site change|cannula/i.test(t.type||"")).map(t=>t.ts).sort((a,b)=>a-b); }
function _sensors5(c){ return (c.treatments||[]).filter(t=>/sensor (change|start)/i.test(t.type||"")).map(t=>t.ts).sort((a,b)=>a-b); }
function _anns5(type){ return ((typeof _idaAnns!=="undefined"&&_idaAnns)||[]).filter(a=>a.type===type).sort((a,b)=>a.ts-b.ts); }
// Tijdelijke streefwaarden en profielpercentages uit AAPS (via Nightscout)
function _tts5(c){ return (c.treatments||[]).filter(t=>t.type==="Temporary Target"&&t.duration>0).map(t=>{ const r=t.raw||{}; let lo=+r.targetBottom||null, hi=+r.targetTop||null;
  if(lo&&lo>30) lo=lo/18.0182; if(hi&&hi>30) hi=hi/18.0182; return { a:t.ts, b:t.ts+t.duration*_M5, v:lo&&hi?(lo+hi)/2:(lo||hi), reason:r.reason||"" }; }); }
const _ttAuto5=x=>/^(hypo|automation)$/i.test(x.reason||"");   // reactie van AAPS of een automatisering: gevolg, geen oorzaak
function _pcts5(c){ const sw=((c.timeline&&c.timeline.switches)||[]).slice().sort((a,b)=>a.ts-b.ts), out=[];
  for(let i=0;i<sw.length;i++){ const s=sw[i], p=s.percentage??100; const dur=(+s.duration||0)*_M5, next=i+1<sw.length?sw[i+1].ts:Date.now();
    if(p!==100) out.push({ a:s.ts, b:dur>0?Math.min(next,s.ts+dur):next, p }); }
  return out; }

/* ── analyse 28: oorzaken samen wegen (n-of-1) ──────────────────────────
   Elke factor levert vensters. Elk venster wordt vergeleken met hetzelfde kloktijdvak op je eigen
   bruikbare dagen zonder die factor (tot 30 dagen ervoor en erna). Effect telt pas bij ≥5 vensters
   én ≥10%-punt verschil in bereik (of ≥2%-punt meer laag); anders "onbekend". */
function _factorDefs5(c){
  const A=t=>_anns5(t), sites=_sites5(c), sens=_sensors5(c), F=[];
  const L=(nl,en)=>TL(nl,en,nl);
  F.push({ id:"sport", t:L("Sport","Exercise"), w:A("sport").map(a=>({a:a.ts,b:a.ts+12*_H5})), span:L("12 uur erna","12 hours after") });
  F.push({ id:"alcohol", t:L("Alcohol","Alcohol"), w:A("alcohol").map(a=>({a:a.ts,b:a.ts+16*_H5})), span:L("tot de ochtend erna","until next morning") });
  F.push({ id:"stress", t:L("Stress","Stress"), w:A("stress").map(a=>({a:a.ts,b:a.ts+12*_H5})), span:L("12 uur","12 hours") });
  F.push({ id:"ziek", t:L("Ziek","Ill"), w:A("ziek").map(a=>({a:a.ts,b:a.ts+48*_H5})), span:L("2 dagen","2 days") });
  F.push({ id:"warmte", t:L("Warmte (sauna, heet bad)","Heat (sauna, hot bath)"), w:A("warmte").map(a=>({a:a.ts,b:a.ts+3*_H5})), span:L("3 uur erna","3 hours after") });
  F.push({ id:"prednison", t:L("Prednison","Prednisone"), w:A("medicijn").filter(a=>a.med==="prednison").map(a=>({a:a.ts,b:a.ts+Math.max(1,+a.days||1)*_D5})), span:L("tijdens de kuur","during the course") });
  F.push({ id:"nacht", t:L("Korte nacht","Short night"), w:A("nacht").map(a=>{ const s=a.ts-todMin(a.ts)*_M5; return {a:s+6*_H5,b:s+24*_H5}; }), span:L("de dag erna","the day after") });
  F.push({ id:"poddag3", t:L("Pod op dag 3","Pod on day 3"), w:sites.map((s,i)=>({a:s+48*_H5,b:Math.min(i+1<sites.length?sites[i+1]:s+80*_H5,s+80*_H5)})).filter(w=>w.b>w.a), span:L("vanaf 48 uur","from 48 hours") });
  F.push({ id:"podnieuw", t:L("Nieuwe pod (eerste 6 uur)","New pod (first 6 hours)"), w:sites.map(s=>({a:s,b:s+6*_H5})), span:L("6 uur","6 hours") });
  F.push({ id:"sensor1", t:L("Sensor op dag 1","Sensor on day 1"), w:sens.map(s=>({a:s,b:s+24*_H5})), span:L("24 uur","24 hours") });
  const lows=_eps5(c.glucose,_isLo5).filter(e=>e.dur>=15);
  F.push({ id:"nalaag", t:L("Laagte in de 24 uur ervoor","Low in the previous 24 hours"), w:lows.map(e=>({a:e.end+_H5,b:e.end+24*_H5})), span:L("24 uur","24 hours") });
  F.push({ id:"tt", t:L("Tijdelijke streefwaarde (zelf gezet)","Temporary target (set yourself)"), w:_tts5(c).filter(x=>!_ttAuto5(x)).map(x=>({a:x.a,b:x.b})), span:L("terwijl actief","while active") });
  F.push({ id:"pct", t:L("Profielpercentage ≠ 100%","Profile percentage ≠ 100%"), w:_pcts5(c).map(x=>({a:x.a,b:x.b,p:x.p})), span:L("terwijl actief","while active") });
  const wk=[]; for(const k of (c.q&&c.q.usableKeys)||[]){ const d=new Date(k+"T12:00:00"); if(d.getDay()===0||d.getDay()===6){ const g=c.glucose[_lb5(c.glucose,Date.parse(k+"T00:00:00"))]; if(g) wk.push({a:g.ts-todMin(g.ts)*_M5,b:g.ts-todMin(g.ts)*_M5+_D5}); } }
  F.push({ id:"weekend", t:L("Weekend","Weekend"), w:wk, span:L("de hele dag","the whole day") });
  return F;
}
function _acc5(){ return { n:0, inr:0, lo:0, hi:0, vlo:0, vhi:0, sum:0 }; }
function _add5(A, G, a, b){ let k=0; for(let i=_lb5(G,a); i<G.length&&G[i].ts<b; i++){ const bg=G[i].bg; k++; A.sum+=bg; if(bg<LO_T){ A.lo++; if(bg<VLO_T) A.vlo++; } else if(bg>HI_T){ A.hi++; if(bg>13.9) A.vhi++; } else A.inr++; } A.n+=k; return k; }
function _cnt5(G, a, b){ return _lb5(G,b)-_lb5(G,a); }
function _accStat5(A){ return A.n?{ n:A.n, tir:A.inr/A.n, tbr:A.lo/A.n, tar:A.hi/A.n, vlo:A.vlo/A.n, vhi:A.vhi/A.n, mean:A.sum/A.n }:{ n:0 }; }
function _factorEffect5(c, f){
  const G=c.glucose, U=c.q&&c.q.usableKeys, W=f.w.filter(w=>w.b>w.a).sort((x,y)=>x.a-y.a);
  const starts=W.map(w=>w.a); let maxLen=0; for(const w of W) maxLen=Math.max(maxLen,w.b-w.a);
  const overl=(a,b)=>{ let lo=0,hi=starts.length; while(lo<hi){ const m=(lo+hi)>>1; if(starts[m]<b) lo=m+1; else hi=m; } for(let i=lo-1;i>=0&&starts[i]>=a-maxLen;i--) if(W[i].b>a) return true; return false; };
  const O=_acc5(), K=_acc5(); let nOcc=0;
  for(const w of W){ if(U&&!U.has(_dk5(w.a))) continue;
    const exp=(w.b-w.a)/(5*_M5); if(_cnt5(G,w.a,w.b)<Math.max(6,0.6*exp)) continue; nOcc++; _add5(O,G,w.a,w.b);
    for(let d=-30; d<=30; d++){ if(!d) continue; const a=w.a+d*_D5, b=w.b+d*_D5; if(U&&!U.has(_dk5(a))) continue; if(overl(a,b)) continue;
      if(_cnt5(G,a,b)>=0.6*exp) _add5(K,G,a,b); } }
  const o=_accStat5(O), k=_accStat5(K);
  const dTir=o.n&&k.n?o.tir-k.tir:null, dTbr=o.n&&k.n?o.tbr-k.tbr:null;
  const known=nOcc>=5&&k.n>=200&&(Math.abs(dTir)>=0.10||dTbr>=0.02);
  return { id:f.id, t:f.t, span:f.span, n:nOcc, o, k, dTir, dTbr, known, enough:nOcc>=5 };
}
function idaFactors5(c){
  if(c._fac5) return c._fac5;
  const out=[]; for(const f of _factorDefs5(c)){ if(!f.w.length) continue; try{ out.push(_factorEffect5(c,f)); }catch(e){ console.error(e); } }
  out.sort((a,b)=>(b.known-a.known)||((Math.abs(b.dTir||0)+3*Math.max(0,b.dTbr||0))-(Math.abs(a.dTir||0)+3*Math.max(0,a.dTbr||0))));
  return (c._fac5=out);
}
function _facLine5(e){
  if(!e) return "";
  if(!e.enough) return TL(`bij jou nog te weinig keren (${e.n}) om te vergelijken`,`too few times yet (${e.n}) to compare`,`poucas vezes (${e.n})`);
  const parts=[]; if(e.dTir!=null) parts.push(TL(`${_pp5(e.dTir)} in bereik`,`${_pp5(e.dTir)} in range`,`${_pp5(e.dTir)} no alvo`));
  if(e.dTbr!=null&&Math.abs(e.dTbr)>=0.01) parts.push(TL(`${_pp5(e.dTbr)} laag`,`${_pp5(e.dTbr)} low`,`${_pp5(e.dTbr)} baixa`));
  return (e.known?TL("bij jou ","for you ","para si "):TL("bij jou geen duidelijk verschil: ","no clear difference for you: ","sem diferença clara: "))+parts.join(", ")+` (${e.n}×)`;
}

/* ── de analyses ─────────────────────────────────────────────────────── */
// Elke analyse: { n, id, g (thema), t (titel), s ("let"|"ok"|"info"|"leeg"), v (één zin), f (feiten [k,v,s]), x (html extra), rule, src }
const _GRP5=()=>[["veilig",TL("Veiligheid","Safety","Segurança")],["eten",TL("Eten en bolus","Food and bolus","Comida e bólus")],["loop",TL("Profiel en loop","Profile and loop","Perfil e loop")],
  ["leef",TL("Leefstijl","Lifestyle","Estilo de vida")],["mat",TL("Pod en sensor","Pod and sensor","Pod e sensor")],["cijf",TL("Kerncijfers","Key numbers","Números-chave")],["meld",TL("Meldingen","Notifications","Notificações")]];

function idaAn(c){
  if(c._an5) return c._an5;
  const out=[]; const add=(fn)=>{ try{ const r=fn(c); if(r) out.push(r); }catch(e){ console.error(fn.name, e); } };
  [_a1,_a2,_a3,_a4,_a5,_a6,_a7,_a8,_a9,_a10,_a11,_a12,_a13,_a14,_a15,_a16,_a17,_a18,_a19,_a20,_a21,_a22,_a23,_a24,_a25,_a26,_a29,_a30,_a31,_a32].forEach(add);
  // 27 (meldingen naspelen) is zwaar: alleen een rij; uitrekenen bij openen
  out.push({ n:27, id:"meldingen", g:"meld", t:TL("Werken de meldingen?","Do the alerts work?","Os alertas funcionam?"), s:"info", lazy:true,
    v:TL("Tik om je meldingen van de laatste 2 weken na te spelen, en zet uit wat niet helpt.","Tap to replay your alerts of the last 2 weeks, and switch off what doesn't help.","Toque para rever os alertas."), f:[] });
  return (c._an5=out.sort((a,b)=>a.n-b.n));
}
const _U5=(c,ts)=>!c.q||!c.q.usableKeys||c.q.usableKeys.has(_dk5(ts));
const _last5=(c,days)=>{ const to=c.glucose[c.glucose.length-1].ts; return c.glucose.filter(x=>x.ts>to-days*_D5); };

// 1 · Ziek-dag en ketonen
function _hiLong5(G){ const out=[]; for(const e of _eps5(G,bg=>bg>=14)) if(e.dur>=120) out.push(e); return out; }
function _a1(c){
  const G=_last5(c,30), E=_hiLong5(G), last=E[E.length-1], end=c.glucose[c.glucose.length-1].ts;
  const now=last&&end-last.end<=10*_M5;
  const ill=_anns5("ziek").filter(a=>a.ts>end-14*_D5);
  return { n:1, id:"ketonen", g:"veilig", t:TL("Ziek-dag en ketonen","Sick days and ketones","Dias de doença e cetonas"),
    s:now?"let":E.length?"info":"ok",
    v:now?TL(`Nu al ${Math.round(last.dur/60*10)/10} uur boven 14: meet ketonen.`,`Above 14 for ${Math.round(last.dur/60*10)/10} hours now: check ketones.`,`Acima de 14: meça cetonas.`)
      :E.length?TL(`${E.length}× langer dan 2 uur boven 14 in 30 dagen.`,`${E.length}× above 14 for over 2 hours in 30 days.`,`${E.length}× acima de 14 mais de 2 h.`):TL("Niet langer dan 2 uur boven 14 in 30 dagen.","Never above 14 for over 2 hours in 30 days.","Nunca acima de 14 mais de 2 h."),
    f:[[TL("Boven 14 > 2 u","Above 14 > 2 h","Acima de 14 > 2 h"),String(E.length),TL("30 dagen","30 days","30 dias")],
       [TL("Langste","Longest","Mais longa"),E.length?Math.round(Math.max(...E.map(e=>e.dur)))+" min":"—",""],
       [TL("Ziek gelogd","Logged ill","Doença registada"),String(ill.length),TL("14 dagen","14 days","14 dias")]],
    x:`<div class="an5steps"><p><b>${TL("Onder 0,6","Below 0.6","Abaixo de 0,6")}</b> ${TL("Normaal. Corrigeer volgens je ISF en meet over 2 uur opnieuw.","Normal. Correct per your ISF and recheck in 2 hours.","Normal.")}</p>
      <p><b>0,6–1,4</b> ${TL("Correctie met de pen (niet via de pod), nieuwe pod, drinken, over 1–2 uur opnieuw meten.","Correct with a pen (not via the pod), new pod, drink, recheck in 1–2 hours.","Correção com caneta, pod novo.")}</p>
      <p><b>1,5–2,9</b> ${TL("Als hierboven, en bel je diabetesteam.","As above, and call your diabetes team.","Como acima e ligue à equipa.")}</p>
      <p><b>3,0+</b> ${TL("Spoed: direct medische hulp.","Emergency: get medical help now.","Urgência.")}</p></div>`,
    rule:TL("Melding bij ≥ 14 mmol/L langer dan 2 uur, of na een \"ziek\"-log bij ≥ 14.","Alert at ≥ 14 mmol/L for more than 2 hours, or after an \"ill\" log at ≥ 14.","Alerta ≥ 14 por mais de 2 h."),
    src:"ISPAD/DTN HCL sick day rules 2026", now };
}
// 2 · Laagte na laagte
function _a2(c){
  const G=c.glucose.filter(x=>_U5(c,x.ts)), E=_eps5(G,_isLo5).filter(e=>e.dur>=15), days=(c.q&&c.q.usable&&c.q.usable.length)||1;
  let after=0, base=0; for(let i=1;i<E.length;i++) if(E[i].start-E[i-1].end<24*_H5) after++;
  const pAfter=E.length>1?after/(E.length-1):null, dayKeys=new Set(E.map(e=>_dk5(e.start))), pDay=dayKeys.size/days;
  const end=c.glucose[c.glucose.length-1].ts, last=E[E.length-1], active=last&&end-last.end<24*_H5;
  const let_=pAfter!=null&&E.length>=6&&pAfter>pDay*1.3;
  return { n:2, id:"nalaag", g:"veilig", t:TL("Laagte na laagte","Low after low","Baixa após baixa"), s:active?"let":let_?"let":"ok",
    v:pAfter==null?TL("Te weinig laagtes om te vergelijken.","Too few lows to compare.","Poucas baixas."):
      TL(`Na een laagte kwam in ${_p5(pAfter)} binnen 24 uur een volgende; op een gewone dag heb je ${_p5(pDay)} kans op een laagte.`,`After a low, ${_p5(pAfter)} were followed by another within 24 hours; on an ordinary day your chance of a low is ${_p5(pDay)}.`,`Após uma baixa, ${_p5(pAfter)} tiveram outra em 24 h.`),
    f:[[TL("Laagtes","Lows","Baixas"),String(E.length),TL(`${days} dagen`,`${days} days`,`${days} dias`)],[TL("Binnen 24 u na de vorige","Within 24 h of previous","Em 24 h da anterior"),String(after),pAfter!=null?_p5(pAfter):""],
       [TL("Laatste laagte","Last low","Última baixa"),last?`${_dateL5(last.start)} ${_hm5(last.start)}`:"—",active?TL("minder dan 24 uur geleden","less than 24 hours ago","há menos de 24 h"):""]],
    x:active?`<p class="an5note">${TL("De komende 24 uur voel je een volgende laagte minder goed aan. IDA maakt je profiel 48 uur niet strakker, en de eetmelding komt al onder 7,5 in plaats van 7.","For the next 24 hours you'll feel the next low less well. IDA won't tighten your profile for 48 hours, and the meal alert already comes below 7.5 instead of 7.","Nas próximas 24 h sente menos a próxima baixa.")}</p>`:"",
    rule:TL("Na elke laagte: 48 uur geen strakker profiel; eetmelding vanaf 7,5 (0,5 eerder).","After each low: no tighter profile for 48 hours; meal alert from 7.5 (0.5 earlier).","Após cada baixa: 48 h sem perfil mais apertado."),
    src:"Dagogo-Jack e.a. 1993", active };
}
// 3 · Wat je logt
function _a3(c){
  const T=c.treatments||[], G=c.glucose, to=G[G.length-1].ts, keys=[...(c.q.usableKeys||[])].filter(k=>Date.parse(k)>to-30*_D5);
  if(keys.length<5) return null; const K=new Set(keys);
  const inK=t=>K.has(_dk5(t.ts)); const tr=T.filter(inK);
  const carbs=tr.reduce((s,t)=>s+(t.carbs||0),0)/keys.length, entries=tr.filter(t=>t.carbs>0).length/keys.length;
  const back=_anns5("maaltijd").filter(a=>a.src==="rise"&&a.grams>0&&K.has(_dk5(a.ts))), backG=back.reduce((s,a)=>s+a.grams,0)/keys.length;
  const smb=tr.filter(t=>t.isSMB&&t.insulin>0).reduce((s,t)=>s+t.insulin,0), man=tr.filter(t=>!t.isSMB&&t.insulin>0).reduce((s,t)=>s+t.insulin,0);
  const share=smb+man>0?smb/(smb+man):null;
  const CT=_carbTs5(c), noCarb=tr.filter(t=>!t.isSMB&&t.insulin>=0.5&&_lb5(CT,t.ts+45*_M5+1)===_lb5(CT,t.ts-45*_M5)).length/keys.length;
  const tdd=_P&&_P.tdd?_P.tdd:null, ic=_P&&_P.ic&&_P.ic.length?_med5(_P.ic.map(b=>b.now)):null;
  // wat je bolusinsuline aan koolhydraten kan dekken (bolus + SMB minus nuchter-SMB is niet te scheiden: bovengrens)
  const cover=ic?((smb+man)/keys.length)*ic:null;
  // per week
  const wk=[]; for(let w=3; w>=0; w--){ const a=to-(w+1)*7*_D5, b=to-w*7*_D5, ks=keys.filter(k=>{ const t=Date.parse(k+"T12:00:00"); return t>=a&&t<b; }); if(ks.length<3) continue; const S=new Set(ks);
    wk.push({ w, g:T.filter(t=>S.has(_dk5(t.ts))).reduce((s,t)=>s+(t.carbs||0),0)/ks.length }); }
  const let_=share!=null&&share>0.5;
  return { n:3, id:"loggen", g:"eten", t:TL("Wat je logt","What you log","O que regista"), s:let_?"let":"ok",
    v:let_?TL(`${_p5(share)} van je bolusinsuline komt van de loop (SMB). Waarschijnlijk wordt veel eten niet of te laag ingevoerd.`,`${_p5(share)} of your bolus insulin comes from the loop (SMB). Much food is probably not entered, or entered too low.`,`${_p5(share)} da insulina de bólus vem do loop.`)
      :TL(`Je voert gemiddeld ${Math.round(carbs)} g per dag in; de loop geeft ${_p5(share)} van je bolusinsuline.`,`You enter ${Math.round(carbs)} g a day on average; the loop gives ${_p5(share)} of your bolus insulin.`,`Regista ${Math.round(carbs)} g por dia.`),
    f:[[TL("Ingevoerd per dag","Entered per day","Registado por dia"),`${Math.round(carbs)} g`,TL(`${_n5(entries)} keer`,`${_n5(entries)} times`,`${_n5(entries)} vezes`)],
       ...(back.length?[[TL("Achteraf aangegeven","Added afterwards","Indicado depois"),`${Math.round(backG)} g`,TL(`${back.length}× via "Iets gegeten?"`,`${back.length}× via "Did you eat?"`,`${back.length}×`)]]:[]),
       [TL("Bolus + SMB per dag","Bolus + SMB per day","Bólus + SMB por dia"),`${_n5((smb+man)/keys.length)} ${TL("E","U","U")}`,TL(`SMB ${_p5(share)}`,`SMB ${_p5(share)}`,`SMB ${_p5(share)}`)],
       [TL("Bolus zonder KH","Bolus without carbs","Bólus sem hidratos"),`${_n5(noCarb)}/${TL("dag","day","dia")}`,TL("±45 min","±45 min","±45 min")],
       ...(cover!=null?[[TL("Dekt aan eten","Covers in food","Cobre em comida"),`± ${Math.round(cover/10)*10} g`,TL("bovengrens, met je KH-ratio","upper bound, with your carb ratio","limite superior")]]:[]),
       ...(tdd?[[TL("Dagdosis","Daily dose","Dose diária"),`${_n5(tdd)} ${TL("E","U","U")}`,""]]:[])],
    x:wk.length>=2?`<div class="an5bars">${wk.map(o=>`<div><span style="height:${Math.min(100,Math.round(o.g/2))}%"></span><i>${Math.round(o.g)} g</i><em>${o.w?TL(`${o.w} wk terug`,`${o.w} wk ago`,`há ${o.w} sem`):TL("deze week","this week","esta semana")}</em></div>`).join("")}</div>`:"",
    rule:TL("Ingevoerde KH per dag naast je dagdosis; een bolus zonder koolhydraten telt mee en IDA vraagt ernaar.","Entered carbs per day next to your daily dose; a bolus without carbs is counted and IDA asks about it.","Hidratos registados por dia."),
    src:TL("eigen data","own data","dados próprios") };
}
// 4 · Loop na maaltijden
function _a4(c){
  const T=c.treatments||[], meals=T.filter(t=>t.carbs>=20&&_U5(c,t.ts)), smbIn=_insSum5(c,true);
  const CT=_carbTs5(c);
  const free=(a,b)=>_lb5(CT,b)===_lb5(CT,a-2*_H5);
  const R=[0,1,2,3].map(()=>({n:0,meal:0,fast:0,nf:0,g:0}));
  for(const m of meals){ const r=R[_dp5(m.ts)]; r.n++; r.g+=m.carbs; r.meal+=smbIn(m.ts,m.ts+4*_H5);
    for(const d of [-7,-6,-5,-4,-3,-2,-1,1,2,3,4,5,6,7]){ const a=m.ts+d*_D5; if(!_U5(c,a)||!free(a,a+4*_H5)) continue; r.fast+=smbIn(a,a+4*_H5); r.nf++; } }
  const bolIn=_insSum5(c,false);
  meals.forEach(m=>{ R[_dp5(m.ts)].bol=(R[_dp5(m.ts)].bol||0)+bolIn(m.ts-45*_M5,m.ts+30*_M5); });
  const rows=R.map((r,i)=>({ i, n:r.n, g:r.n?r.g/r.n:0, meal:r.n?r.meal/r.n:null, fast:r.nf?r.fast/r.nf:null, bol:r.n?(r.bol||0)/r.n:null })).filter(r=>r.n>=5&&r.fast!=null);
  if(!rows.length) return null;
  rows.forEach(r=>{ r.extra=r.meal-r.fast; r.share=r.bol>0?r.meal/r.bol:null; });
  const worst=rows.reduce((a,b)=>(b.share||0)>(a.share||0)?b:a), N=_DPN5(), E=TL("E","U","U");
  const flag=worst.share!=null&&worst.share>=0.5&&worst.meal>=1.5;
  return { n:4, id:"loopmaal", g:"eten", t:TL("Wat de loop na het eten bijgeeft","What the loop adds after meals","O que o loop dá após comer"), s:flag?"let":"ok",
    v:flag?TL(`Na je ${N[worst.i]}maaltijd geeft de loop ~${_n5(worst.meal)} ${E} SMB in 4 uur, ${_p5(worst.share)} van je bolus erbovenop: te weinig ingevoerd of je ratio is daar te zwak.`,`After your ${N[worst.i]} meal the loop gives ~${_n5(worst.meal)} ${E} SMB in 4 hours, ${_p5(worst.share)} on top of your bolus: too little entered, or your ratio is too weak there.`,`Após a refeição o loop dá ~${_n5(worst.meal)} ${E}.`)
      :TL("De loop hoeft na het eten weinig bij te geven.","The loop needs to add little after meals.","O loop dá pouco a mais."),
    f:rows.map(r=>[N[r.i].replace(/^./,x=>x.toUpperCase()),`${_n5(r.meal)} ${E}`,TL(`SMB na eten · bolus ${_n5(r.bol)} · zelfde uren zonder gelogd eten ${_n5(r.fast)} · ${r.n}×`,`SMB after meals · bolus ${_n5(r.bol)} · same hours without logged food ${_n5(r.fast)} · ${r.n}×`,`SMB após comer`)]),
    x:rows.some(r=>r.fast>=1)&&`<p class="an5note">${TL("Ook op uren zonder gelogd eten geeft de loop bij jou veel SMB. Dat past bij eten dat niet is ingevoerd.","Even in hours without logged food the loop gives you a lot of SMB. That fits food that wasn't entered.","Também sem comida registada há muito SMB.")}</p>`,
    rule:TL("SMB in 0–4 uur na eten per dagdeel, naast je maaltijdbolus en dezelfde uren zonder gelogd eten. Telt bij ≥ 1,5 E en ≥ 50% van de bolus.","SMB in 0–4 hours after meals per part of day, next to your meal bolus and the same hours without logged food. Counts at ≥ 1.5 U and ≥ 50% of the bolus.","SMB 0–4 h após comer vs jejum."),
    src:"NHS Tayside HCL pointers; Medtronic 780G protocol" };
}
// 5 · Telfout per maaltijdgrootte
function _a5(c){
  let R=[]; try{ R=(c._mr4||(c._mr4=mealResults(c.glucose,c.treatments,c.timeline))).results||[]; }catch(_){}
  R=R.filter(r=>r.frac!=null&&_U5(c,r.ts)); if(R.length<8) return null;
  const B=[[0,40,"< 40 g"],[40,70,"40–70 g"],[70,999,"> 70 g"]].map(([a,b,l])=>{ const x=R.filter(r=>r.carbs>=a&&r.carbs<b).map(r=>r.frac); return { l, n:x.length, m:_med5(x) }; });
  const D=[0,1,2,3].map(i=>{ const x=R.filter(r=>_dp5(r.ts)===i).map(r=>r.frac); return { i, n:x.length, m:_med5(x) }; }).filter(o=>o.n>=4);
  const bad=B.filter(b=>b.n>=4&&b.m>1.15);
  return { n:5, id:"telfout", g:"eten", t:TL("Telfout per maaltijdgrootte","Counting error by meal size","Erro de contagem por tamanho"), s:bad.length?"let":"ok",
    v:bad.length?TL(`Bij ${bad.map(b=>b.l).join(" en ")} komt meer terug dan je invoert (${bad.map(b=>_p5(b.m)).join(", ")}).`,`For ${bad.map(b=>b.l).join(" and ")} more comes back than you enter (${bad.map(b=>_p5(b.m)).join(", ")}).`,`Volta mais do que regista.`)
      :TL("Wat je invoert komt bij elke maaltijdgrootte ongeveer terug.","What you enter roughly comes back at every meal size.","O que regista volta aproximadamente."),
    f:B.map(b=>[b.l,b.n>=4?_p5(b.m):"—",TL(`${b.n} maaltijden`,`${b.n} meals`,`${b.n} refeições`)]).concat(D.map(o=>[_DPN5()[o.i].replace(/^./,x=>x.toUpperCase()),_p5(o.m),TL(`${o.n} maaltijden`,`${o.n} meals`,`${o.n} refeições`)])),
    x:`<p class="an5note">${TL("100% = de stijging past precies bij wat je invoerde. De maat telt alleen stijging, dus valt iets hoog uit; let op het verschil tussen de groepen.","100% = the rise fits exactly what you entered. It only counts rises, so it runs a bit high; look at the differences between groups.","100% = a subida corresponde ao registado.")}</p>`,
    rule:TL("Wat terugkomt (frac) per < 40 / 40–70 / > 70 g en per dagdeel; > 115% telt.","What comes back (frac) per < 40 / 40–70 / > 70 g and per part of day; > 115% counts.","Fração por tamanho."),
    src:"Brazeau 2013; Roversi 2020" };
}
// 6 · Vuistregel-controle
function _a6(c){
  if(!_P||!_P.tdd) return null;
  const tdd=_P.tdd, ic=_med5(_P.ic.map(b=>b.now)), isf=_P.isfNow, crR=500/tdd, isfR=100/tdd;
  const dC=ic?ic/crR-1:null, dI=isf?isf/isfR-1:null, bad=(dC!=null&&Math.abs(dC)>0.5)||(dI!=null&&Math.abs(dI)>0.5);
  return { n:6, id:"vuist", g:"loop", t:TL("Controle met de vuistregels","Rule-of-thumb check","Regras práticas"), s:bad?"let":"ok",
    v:bad?TL("Je profiel wijkt meer dan 50% af van de vuistregel. In een SMB-loop kan dat kloppen, maar check het.","Your profile is more than 50% off the rule of thumb. In an SMB loop that can be right, but check it.","O perfil difere mais de 50% da regra.")
      :TL("Je KH-ratio en ISF liggen binnen 50% van de vuistregels.","Your carb ratio and ISF are within 50% of the rules of thumb.","Dentro de 50% das regras."),
    f:[[TL("Dagdosis","Daily dose","Dose diária"),`${_n5(tdd)} ${TL("E","U","U")}`,""],[TL("KH-ratio","Carb ratio","Rácio"),_n5(ic),TL(`500-regel ${_n5(crR)} (${dC!=null?(dC>0?"+":"")+Math.round(dC*100)+"%":"—"})`,`500 rule ${_n5(crR)}`,`regra 500 ${_n5(crR)}`)],
       [TL("ISF","ISF","ISF"),_n5(isf),TL(`100-regel ${_n5(isfR)} (${dI!=null?(dI>0?"+":"")+Math.round(dI*100)+"%":"—"})`,`100 rule ${_n5(isfR)}`,`regra 100 ${_n5(isfR)}`)]],
    x:`<p class="an5note">${TL("Een grotere KH-ratio dan de 500-regel past bij te weinig ingevoerde koolhydraten: dan lijkt je dagdosis te groot voor wat je eet (zie Wat je logt).","A larger carb ratio than the 500 rule fits too few entered carbs: your daily dose then looks too big for what you eat (see What you log).","Rácio maior que a regra 500: poucos hidratos registados.")}</p>`,
    rule:TL("KH ≈ 500 ÷ dagdosis, ISF ≈ 100 ÷ dagdosis (mmol/L); > 50% verschil = waarschuwing.","Carb ratio ≈ 500 ÷ daily dose, ISF ≈ 100 ÷ daily dose (mmol/L); > 50% difference = warning.","Regras 500 e 100."),
    src:"Wilmot e.a. 2014; Walsh" };
}
// 7 · Voorzichtige stand
function _a7(c){
  const C=_P&&_P.careful; if(!C) return null;
  return { n:7, id:"voorzichtig", g:"loop", t:TL("Voorzichtige stand van het profielvoorstel","Cautious mode of the profile proposal","Modo cauteloso"), s:C.on?"let":"ok",
    v:C.on?(C.low48?TL(`Aan: laagte op ${_dateL5(C.low48)} om ${_hm5(C.low48)}. Tot 48 uur daarna wordt niets strakker en gaat het voorstel 50% van de weg.`,`On: low on ${_dateL5(C.low48)} at ${_hm5(C.low48)}. For 48 hours after nothing gets tighter and the proposal goes 50% of the way.`,`Ligado: baixa recente.`)
      :TL(`Aan: ${_p5(C.tbr)} van de tijd onder 3,9 (14 dagen). Het voorstel gaat 50% van de weg in plaats van 70%.`,`On: ${_p5(C.tbr)} of the time below 3.9 (14 days). The proposal goes 50% of the way instead of 70%.`,`Ligado: ${_p5(C.tbr)} abaixo de 3,9.`))
      :TL("Uit: geen laagte in 48 uur en minder dan 4% onder 3,9. Het voorstel gaat 70% van de weg.","Off: no low in 48 hours and under 4% below 3.9. The proposal goes 70% of the way.","Desligado."),
    f:[[TL("Onder 3,9","Below 3.9","Abaixo de 3,9"),_p5(C.tbr),TL("14 dagen","14 days","14 dias")],[TL("Stap","Step","Passo"),C.on?"50%":"70%",TL("van de weg","of the way","do caminho")]],
    rule:TL("Na een laagte of bij > 4% onder 3,9: 50% van de weg en 48 uur niets strakker; anders 70%.","After a low or with > 4% below 3.9: 50% of the way and nothing tighter for 48 hours; otherwise 70%.","50% após baixa."),
    src:"OpenAPS Autotune; Nimri e.a. 2020 (ADVICE4U)" };
}
// 8 · 14 dagen + minuten per dag
function _a8(c){
  const G=_last5(c,14); if(G.length<288*5) return null; const m=metrics(G), cov=G.length/(14*288);
  const min=v=>{ const t=Math.round(v*1440); return t>=60?`${Math.floor(t/60)} ${TL("u","h","h")} ${t%60} min`:`${t} min`; };
  const ok=m.tir>=0.7&&m.tbr<0.04&&m.veryLow<0.01&&m.cv<=0.36;
  return { n:8, id:"14d", g:"cijf", t:TL("Laatste 14 dagen","Last 14 days","Últimos 14 dias"), s:ok?"ok":"let",
    v:TL(`${_p5(m.tir)} in bereik (${min(m.tir)} per dag), ${min(m.tbr)} per dag laag.`,`${_p5(m.tir)} in range (${min(m.tir)} a day), ${min(m.tbr)} a day low.`,`${_p5(m.tir)} no alvo.`),
    f:[[TL("In bereik 3,9–10","In range 3.9–10","No alvo"),_p5(m.tir),min(m.tir)+TL(" per dag"," a day"," por dia")],[TL("Onder 3,9","Below 3.9","Abaixo de 3,9"),_p5(m.tbr),min(m.tbr)],[TL("Onder 3,0","Below 3.0","Abaixo de 3,0"),_p5(m.veryLow),min(m.veryLow)],
       [TL("Boven 10","Above 10","Acima de 10"),_p5(m.tar),min(m.tar)],[TL("Boven 13,9","Above 13.9","Acima de 13,9"),_p5(m.veryHigh),min(m.veryHigh)],[TL("Strak 3,9–7,8","Tight 3.9–7.8","Apertado"),_p5(m.titr),min(m.titr)],
       ["GMI",_n5(m.gmi)+"%",""],["CV",_p5(m.cv),TL("doel ≤ 36%","target ≤ 36%","alvo ≤ 36%")],[TL("Sensor actief","Sensor active","Sensor ativo"),_p5(Math.min(1,cov)),TL("doel ≥ 70%","target ≥ 70%","alvo ≥ 70%")]],
    rule:TL("Kerncijfers over 14 dagen; doelen: > 70% in bereik, < 4% onder 3,9, < 1% onder 3,0, < 25% boven 10, < 5% boven 13,9, CV ≤ 36%.","Key numbers over 14 days; targets: > 70% in range, < 4% below 3.9, < 1% below 3.0, < 25% above 10, < 5% above 13.9, CV ≤ 36%.","Metas internacionais."),
    src:"Battelino e.a. 2019" };
}
// 9 · Episodes volgens consensus 2023
function _a9(c){
  const G=_last5(c,28); if(G.length<288*7) return null;
  const L1=_eps5(G,_isLo5), L2=_eps5(G,_isVlo5), X=L1.filter(e=>e.dur>120), H2=_eps5(G,_isVhi5), HX=H2.filter(e=>e.dur>120);
  const wk=4;
  return { n:9, id:"episodes", g:"veilig", t:TL("Laagtes en hoogtes als episodes","Lows and highs as episodes","Episódios"), s:(L2.length>wk||X.length)?"let":"ok",
    v:TL(`${_n5(L1.length/wk)} laagtes per week, ${L2.length} onder 3,0 in 4 weken; gemiddeld ${Math.round(_med5(L1.map(e=>e.dur))||0)} min.`,`${_n5(L1.length/wk)} lows a week, ${L2.length} below 3.0 in 4 weeks; typically ${Math.round(_med5(L1.map(e=>e.dur))||0)} min.`,`${_n5(L1.length/wk)} baixas por semana.`),
    f:[[TL("Laag < 3,9","Low < 3.9","Baixa < 3,9"),String(L1.length),TL(`${_n5(L1.length/wk)} per week`,`${_n5(L1.length/wk)} a week`,`${_n5(L1.length/wk)}/sem`)],[TL("Ernstig < 3,0","Severe < 3.0","Grave < 3,0"),String(L2.length),""],
       [TL("Langdurig laag > 2 u","Prolonged low > 2 h","Baixa prolongada"),String(X.length),""],[TL("Herstelduur laag","Low recovery time","Recuperação"),L1.length?Math.round(_med5(L1.map(e=>e.dur)))+" min":"—",TL("mediaan","median","mediana")],
       [TL("Hoog > 13,9","High > 13.9","Alta > 13,9"),String(H2.length),""],[TL("Langdurig > 13,9 > 2 u","Prolonged > 13.9 > 2 h","Prolongada"),String(HX.length),""]],
    rule:TL("Episode begint na ≥ 15 min in de zone en eindigt na ≥ 15 min erbuiten; langdurig = > 120 min. Laatste 4 weken.","An episode starts after ≥ 15 min in the zone and ends after ≥ 15 min out of it; prolonged = > 120 min. Last 4 weeks.","Consenso 2023."),
    src:"Battelino e.a. 2023 (Lancet D&E)" };
}
// 10 · AGP 5–95% (de grafiek zelf staat bij Patronen; hier de breedte per dagdeel)
function _a10(c){
  const G=_last5(c,14); if(G.length<288*5) return null; const ag=agp(G); if(ag.length<20) return null;
  const parts=[[0,360],[360,660],[660,1020],[1020,1440]].map(([a,b],i)=>{ const x=ag.filter(o=>o.min>=a&&o.min<b); return { i, w:_avg5(x.map(o=>o.p95-o.p5)), lo:Math.min(...x.map(o=>o.p5)), hi:Math.max(...x.map(o=>o.p95)) }; });
  const widest=parts.reduce((a,b)=>b.w>a.w?b:a);
  return { n:10, id:"agp", g:"cijf", t:TL("Dagprofiel (AGP)","Daily profile (AGP)","Perfil diário"), s:"info",
    v:TL(`De meeste spreiding zit in de ${_DPN5()[widest.i]}: 90% van je waarden ligt daar tussen ${_n5(widest.lo)} en ${_n5(widest.hi)}.`,`Most spread is in the ${_DPN5()[widest.i]}: 90% of your values there are between ${_n5(widest.lo)} and ${_n5(widest.hi)}.`,`Mais dispersão na ${_DPN5()[widest.i]}.`),
    f:parts.map(p=>[_DPN5()[p.i].replace(/^./,x=>x.toUpperCase()),`${_n5(p.lo)}–${_n5(p.hi)}`,TL(`breedte ${_n5(p.w)}`,`width ${_n5(p.w)}`,`largura ${_n5(p.w)}`)]),
    x:agpSvg(ag), rule:TL("Banden 5–95% en 25–75% met mediaan, 14 dagen.","Bands 5–95% and 25–75% with median, 14 days.","Bandas 5–95%."), src:"Battelino 2019; ADS AGP-consensus 2020" };
}
// 11 · SD, MODD, LBGI/HBGI
function _a11(c){
  const G=_last5(c,14); if(G.length<288*5) return null;
  const mean=_avg5(G.map(x=>x.bg)), sd=Math.sqrt(_avg5(G.map(x=>(x.bg-mean)**2)));
  const d=[]; for(const x of G){ const y=_bgAt5(G,x.ts-_D5,5*_M5); if(y!=null) d.push(Math.abs(x.bg-y)); } const modd=_avg5(d);
  let lr=0, hr=0; for(const x of G){ const mg=Math.max(20,x.bg*18.0182), f=1.509*(Math.pow(Math.log(mg),1.084)-5.381), r=10*f*f; if(f<0) lr+=r; else hr+=r; }
  const lbgi=lr/G.length, hbgi=hr/G.length;
  const lc=lbgi<2.5?TL("laag risico","low risk","risco baixo"):lbgi<=5?TL("matig risico","moderate risk","risco moderado"):TL("hoog risico","high risk","risco alto");
  const hc=hbgi<4.5?TL("laag risico","low risk","risco baixo"):hbgi<=9?TL("matig risico","moderate risk","risco moderado"):TL("hoog risico","high risk","risco alto");
  return { n:11, id:"variab", g:"cijf", t:TL("Schommelingen en risico","Variability and risk","Variabilidade"), s:lbgi>2.5?"let":"ok",
    v:TL(`Kans op laag: ${lc} (LBGI ${_n5(lbgi)}); dag-op-dag verschil ${_n5(modd)} mmol/L.`,`Risk of lows: ${lc} (LBGI ${_n5(lbgi)}); day-to-day difference ${_n5(modd)} mmol/L.`,`Risco de baixa: ${lc}.`),
    f:[["SD",_n5(sd),TL("spreiding","spread","dispersão")],["MODD",_n5(modd),TL("verschil met dezelfde tijd gisteren","difference with same time yesterday","diferença com ontem")],["LBGI",_n5(lbgi),lc],["HBGI",_n5(hbgi),hc]],
    rule:TL("LBGI < 2,5 laag, 2,5–5 matig, > 5 hoog risico; HBGI < 4,5 / 4,5–9 / > 9. 14 dagen.","LBGI < 2.5 low, 2.5–5 moderate, > 5 high risk; HBGI < 4.5 / 4.5–9 / > 9. 14 days.","Kovatchev."),
    src:"Kovatchev; Ceriello, Monnier & Owens 2018" };
}
// 12 · Gemiste en late bolus
function _a12(c){
  const T=c.treatments||[], to=c.glucose[c.glucose.length-1].ts, from=to-30*_D5;
  const meals=T.filter(t=>t.carbs>=15&&t.ts>=from&&_U5(c,t.ts)), man=T.filter(t=>!t.isSMB&&t.insulin>=0.5);
  const R=[0,1,2,3].map(()=>({n:0,miss:0,late:0}));
  for(const m of meals){ const r=R[_dp5(m.ts)]; r.n++; const b=man.filter(x=>x.ts>=m.ts-45*_M5&&x.ts<=m.ts+60*_M5).sort((a,z)=>a.ts-z.ts)[0];
    if(!b) r.miss++; else if(b.ts-m.ts>15*_M5) r.late++; }
  // stijgingen ≥3 zonder koolhydraten en zonder bolus (VanderWel: gemiste snackbolus)
  let rises=0; const G=c.glucose.filter(x=>x.ts>=from); let i0=0;
  const CT12=T.filter(t=>t.carbs>0||(!t.isSMB&&t.insulin>=0.5)).map(t=>({ts:t.ts})).sort((a,b)=>a.ts-b.ts);
  const dq=[]; for(let i=0;i<G.length;i++){ while(i0<i&&G[i].ts-G[i0].ts>90*_M5) i0++; while(dq.length&&G[dq[dq.length-1]].bg>=G[i].bg) dq.pop(); dq.push(i); while(dq[0]<i0) dq.shift(); const lo=G[dq[0]];
    if(G[i].bg-lo.bg>=3&&G[i].bg>HI_T&&lo.bg>=4.5){ const a=lo.ts; if(_lb5(CT12,G[i].ts)===_lb5(CT12,a-2*_H5)){ rises++; while(i<G.length-1&&G[i+1].bg>=G[i].bg-0.5) i++; i0=i; dq.length=0; dq.push(i); } } }
  const tot=R.reduce((s,r)=>s+r.n,0); if(tot<10) return null; const miss=R.reduce((s,r)=>s+r.miss,0), late=R.reduce((s,r)=>s+r.late,0);
  const N=_DPN5();
  return { n:12, id:"gemist", g:"eten", t:TL("Gemiste en late bolus","Missed and late bolus","Bólus esquecido ou tardio"), s:(miss+late)/tot>0.15||rises/30>0.5?"let":"ok",
    v:TL(`${miss} maaltijden zonder bolus en ${late} met een bolus > 15 min na het eten, plus ${rises} stijgingen zonder iets gelogd (30 dagen).`,`${miss} meals without bolus and ${late} with a bolus > 15 min after eating, plus ${rises} rises with nothing logged (30 days).`,`${miss} refeições sem bólus, ${late} tardias.`),
    f:R.map((r,i)=>[N[i].replace(/^./,x=>x.toUpperCase()),`${r.miss} / ${r.late}`,TL(`gemist / laat · ${r.n} maaltijden`,`missed / late · ${r.n} meals`,`esquecido / tardio`)]).filter((_,i)=>R[i].n).concat([[TL("Stijging zonder log","Rise without log","Subida sem registo"),String(rises),TL("≥ 3 erbij tot boven 10","≥ 3 up to above 10","≥ 3 até > 10")]]),
    rule:TL("Maaltijd zonder handmatige bolus binnen −45/+60 min = gemist; bolus > 15 min na de invoer = laat; stijging ≥ 3 zonder KH of bolus = mogelijk gemist eten.","Meal without manual bolus within −45/+60 min = missed; bolus > 15 min after entry = late; rise ≥ 3 without carbs or bolus = possibly missed food.","Regras de bólus."),
    src:"VanderWel e.a. 2010; Mozzillo e.a. 2022" };
}
// 13 · Late stijging (vet/eiwit)
function _a13(c){
  let R=[]; try{ R=(c._mr4||(c._mr4=mealResults(c.glucose,c.treatments,c.timeline))).results||[]; }catch(_){}
  R=R.filter(r=>_U5(c,r.ts)); if(R.length<8) return null;
  const late=r=>r.tPeak>180;
  const D=[0,1,2,3].map(i=>{ const x=R.filter(r=>_dp5(r.ts)===i); return { i, n:x.length, l:x.filter(late).length }; }).filter(o=>o.n>=4);
  const bad=D.filter(o=>o.l/o.n>=0.3), N=_DPN5();
  return { n:13, id:"laat", g:"eten", t:TL("Late stijging na eten","Late rise after meals","Subida tardia"), s:bad.length?"let":"ok",
    v:bad.length?TL(`Bij je ${bad.map(o=>N[o.i]).join(" en ")} piekt ${_p5(bad[0].l/bad[0].n)} pas na 3 uur: vet of eiwit. Geef daar een deel van de bolus 1–2 uur later.`,`At your ${bad.map(o=>N[o.i]).join(" and ")} ${_p5(bad[0].l/bad[0].n)} peak only after 3 hours: fat or protein. Give part of the bolus 1–2 hours later there.`,`Pico após 3 h.`)
      :TL("Je maaltijden pieken meestal binnen 3 uur.","Your meals usually peak within 3 hours.","Pico em 3 h."),
    f:D.map(o=>[N[o.i].replace(/^./,x=>x.toUpperCase()),`${o.l} / ${o.n}`,TL("piek na 3 uur","peak after 3 hours","pico após 3 h")]),
    rule:TL("Piek > 3 uur na eten, als patroon per dagdeel (≥ 30% van de maaltijden).","Peak > 3 hours after eating, as a pattern per part of day (≥ 30% of meals).","Pico > 3 h."),
    src:"Bell e.a. 2016" };
}
// 14 · Sport tot 24 uur
function _a14(c){
  const S=_anns5("sport").filter(a=>_U5(c,a.ts)); if(!S.length) return _empty5(14,"sport","leef",TL("Sport tot 24 uur erna","Exercise up to 24 hours after","Exercício até 24 h"),TL("Log sport met + om te zien wat het tot 24 uur erna doet.","Log exercise with + to see what it does up to 24 hours later.","Registe exercício com +."),"McMahon e.a. 2007; EASD/ISPAD 2024");
  const G=c.glucose, win=[["tijdens","during",a=>a.ts,a=>a.ts+(+a.dur||60)*_M5],["0–4 u erna","0–4 h after",a=>a.ts+(+a.dur||60)*_M5,a=>a.ts+(+a.dur||60)*_M5+4*_H5],["7–11 u erna","7–11 h after",a=>a.ts+7*_H5,a=>a.ts+11*_H5]];
  const rows=win.map(([nl,en,fa,fb])=>{ let o=[], k=[]; for(const a of S){ const A=fa(a), B=fb(a); o=o.concat(_slice5(G,A,B));
      for(const d of [-7,-6,-5,-4,-3,-2,-1,1,2,3,4,5,6,7]){ if(S.some(x=>Math.abs(x.ts-(a.ts+d*_D5))<12*_H5)) continue; if(!_U5(c,A+d*_D5)) continue; k=k.concat(_slice5(G,A+d*_D5,B+d*_D5)); } }
    return { l:TL(nl,en,nl), o:_stat5(o), k:_stat5(k) }; });
  const worst=rows.reduce((a,b)=>((b.o.tbr||0)-(b.k.tbr||0))>((a.o.tbr||0)-(a.k.tbr||0))?b:a);
  const dl=(worst.o.tbr||0)-(worst.k.tbr||0);
  return { n:14, id:"sport", g:"leef", t:TL("Sport tot 24 uur erna","Exercise up to 24 hours after","Exercício até 24 h"), s:S.length>=3&&dl>=0.03?"let":"info",
    v:S.length<3?TL(`${S.length}× sport gelogd; vanaf 3 keer volgt een vergelijking.`,`${S.length}× exercise logged; a comparison follows from 3 times.`,`${S.length}× exercício.`)
      :dl>=0.03?TL(`Na sport zit je ${worst.l} ${_p5(worst.o.tbr)} laag, normaal ${_p5(worst.k.tbr)}.`,`After exercise you're low ${_p5(worst.o.tbr)} ${worst.l}, normally ${_p5(worst.k.tbr)}.`,`Após exercício: ${_p5(worst.o.tbr)} baixa.`)
      :TL("Sport geeft bij jou geen extra laagtes tot de nacht erna.","Exercise gives you no extra lows up to the night after.","Sem baixas extra."),
    f:rows.map(r=>[r.l.replace(/^./,x=>x.toUpperCase()),`${_p5(r.o.tir)} / ${_p5(r.o.tbr)}`,TL(`in bereik / laag · normaal ${_p5(r.k.tir)} / ${_p5(r.k.tbr)}`,`in range / low · normally ${_p5(r.k.tir)} / ${_p5(r.k.tbr)}`,`normal ${_p5(r.k.tir)}`)]).concat([[TL("Keer gelogd","Times logged","Vezes"),String(S.length),""]]),
    x:`<p class="an5note">${TL("Met AAPS: tijdelijke streefwaarde ± 8,3 1–2 uur vóór het sporten; binnen 2 uur na een maaltijd ook de bolus 25–33% lager.","With AAPS: temporary target ± 8.3 1–2 hours before exercise; within 2 hours of a meal also 25–33% less bolus.","Alvo temporário ± 8,3.")}</p>`,
    rule:TL("In bereik en laag tijdens, 0–4 uur na, en 7–11 uur na sport (de nacht), tegen dezelfde uren op dagen zonder sport.","In range and low during, 0–4 hours after, and 7–11 hours after exercise (the night), versus the same hours on days without exercise.","Durante, 0–4 h e 7–11 h."),
    src:"McMahon e.a. 2007; EASD/ISPAD 2024" };
}
function _empty5(n,id,g,t,v,src){ return { n, id, g, t, s:"leeg", v, f:[], rule:"", src }; }
// 15 · Ochtend na alcohol
function _a15(c){
  const A=_anns5("alcohol").filter(a=>todMin(a.ts)>=960||todMin(a.ts)<180);
  if(!A.length) return _empty5(15,"alcohol","leef",TL("Ochtend na alcohol","Morning after alcohol","Manhã após álcool"),TL("Log alcohol met + om je ochtend erna te vergelijken.","Log alcohol with + to compare the next morning.","Registe álcool com +."),"Turner e.a. 2001");
  const G=c.glucose, mornStart=ts=>{ const dayStart=ts-todMin(ts)*_M5+(todMin(ts)<180?0:_D5); return dayStart+6*_H5; };
  const ms=new Set(A.map(a=>mornStart(a.ts)));
  let o=[], k=[], mins=[], kmins=[]; for(const m of ms){ const s=_slice5(G,m,m+6*_H5); o=o.concat(s); if(s.length) mins.push(Math.min(...s.map(x=>x.bg))); }
  const keys=[...(c.q.usableKeys||[])].slice(-60); for(const kk of keys){ const g=G[_lb5(G,Date.parse(kk+"T00:00:00"))]; if(!g) continue; const m=g.ts-todMin(g.ts)*_M5+6*_H5; if([...ms].some(x=>Math.abs(x-m)<_H5)) continue; const s=_slice5(G,m,m+6*_H5); if(s.length<40) continue; k=k.concat(s); kmins.push(Math.min(...s.map(x=>x.bg))); }
  const O=_stat5(o), K=_stat5(k);
  return { n:15, id:"alcohol", g:"leef", t:TL("Ochtend na alcohol","Morning after alcohol","Manhã após álcool"), s:ms.size>=3&&O.tbr-K.tbr>=0.03?"let":"info",
    v:TL(`Op ${ms.size} ochtenden na alcohol: ${_p5(O.tbr)} laag en laagste ${_n5(_med5(mins))}; gewone ochtenden ${_p5(K.tbr)} en ${_n5(_med5(kmins))}.`,`On ${ms.size} mornings after alcohol: ${_p5(O.tbr)} low, lowest ${_n5(_med5(mins))}; ordinary mornings ${_p5(K.tbr)} and ${_n5(_med5(kmins))}.`,`${ms.size} manhãs após álcool.`),
    f:[[TL("Laag 06–12 u","Low 06–12 h","Baixa 06–12 h"),_p5(O.tbr),TL(`normaal ${_p5(K.tbr)}`,`normally ${_p5(K.tbr)}`,`normal ${_p5(K.tbr)}`)],[TL("In bereik","In range","No alvo"),_p5(O.tir),TL(`normaal ${_p5(K.tir)}`,`normally ${_p5(K.tir)}`,`normal ${_p5(K.tir)}`)],[TL("Laagste (mediaan)","Lowest (median)","Mínimo"),_n5(_med5(mins)),TL(`normaal ${_n5(_med5(kmins))}`,`normally ${_n5(_med5(kmins))}`,"")]],
    x:`<p class="an5note">${TL("Alcohol remt je lever tot de volgende ochtend. IDA stuurt de ochtend na een alcohol-log een eetmelding bij je ontbijt.","Alcohol slows your liver until the next morning. The morning after an alcohol log IDA sends a meal reminder at breakfast.","O álcool trava o fígado até à manhã seguinte.")}</p>`,
    rule:TL("Ontbijt en ochtend (06–12 u) na een alcohol-log in de avond, tegen gewone ochtenden.","Breakfast and morning (06–12 h) after an evening alcohol log, versus ordinary mornings.","Manhã após álcool."),
    src:"Turner e.a. 2001; Adams 2008" };
}
// 16 · Nacht-risico bij slapengaan
function _nightFactors5(c, t23){
  const T=c.treatments||[], G=c.glucose, d=_dsAt4(t23,20*_M5), F=[];
  const B=_base4(c), io=d&&d.iob!=null?d.iob:null, usual=B.iobHour[23];
  if(io!=null&&usual!=null&&io>=usual+1) F.push("iob");
  if(T.some(t=>!t.isSMB&&t.insulin>=1&&t.ts>t23-3*_H5&&t.ts<=t23)) F.push("bolus");
  const day0=t23-todMin(t23)*_M5;
  if(_anns5("sport").some(a=>a.ts>=day0&&a.ts<=t23)) F.push("sport");
  if(_anns5("alcohol").some(a=>a.ts>=t23-8*_H5&&a.ts<=t23+2*_H5)) F.push("alcohol");
  if(_eps5(_slice5(G,day0+6*_H5,t23),_isLo5).length) F.push("laag");
  const bg=_bgAt5(G,t23,15*_M5); if(bg!=null&&bg<6.5) F.push("start");
  return F;
}
function _a16(c){
  const G=c.glucose, keys=[...(c.q.usableKeys||[])].slice(-90), rows=[];
  for(const k of keys){ const g=G[_lb5(G,Date.parse(k+"T12:00:00"))]; if(!g) continue; const t23=g.ts-todMin(g.ts)*_M5+23*_H5;
    const night=_slice5(G,t23,t23+8*_H5); if(night.length<60) continue; rows.push({ F:_nightFactors5(c,t23), low:_eps5(night,_isLo5).length>0 }); }
  if(rows.length<14) return null;
  const grp=[[0,1],[2,9]].map(([a,b])=>{ const x=rows.filter(r=>r.F.length>=a&&r.F.length<=b); return { a, n:x.length, p:x.length?x.filter(r=>r.low).length/x.length:null }; });
  const names={ iob:TL("veel actieve insuline","lots of active insulin","muita insulina ativa"), bolus:TL("bolus in de 3 uur ervoor","bolus in the 3 hours before","bólus nas 3 h"), sport:TL("sport overdag","exercise that day","exercício"), alcohol:TL("alcohol","alcohol","álcool"), laag:TL("laagte overdag","low during the day","baixa de dia"), start:TL("onder 6,5 bij het slapen","below 6.5 at bedtime","abaixo de 6,5") };
  const per=Object.keys(names).map(f=>{ const w=rows.filter(r=>r.F.includes(f)), wo=rows.filter(r=>!r.F.includes(f)); return { f, n:w.length, p:w.length?w.filter(r=>r.low).length/w.length:null, p0:wo.length?wo.filter(r=>r.low).length/wo.length:null }; }).filter(o=>o.n>=3);
  const now=Date.now(), tn=todMin(now), cur=(tn>=21*60)?_nightFactors5(c,now-tn*_M5+23*_H5):null;
  const hi=grp[1].p!=null&&grp[0].p!=null&&grp[1].p>grp[0].p;
  return { n:16, id:"nacht", g:"veilig", t:TL("Kans op een laagte vannacht","Risk of a low tonight","Risco de baixa à noite"), s:cur&&cur.length>=3?"let":"info",
    v:TL(`Nachten met 2 of meer risicofactoren eindigden in ${_p5(grp[1].p)} laag, met 0–1 in ${_p5(grp[0].p)}.`,`Nights with 2 or more risk factors ended low ${_p5(grp[1].p)} of the time, with 0–1 ${_p5(grp[0].p)}.`,`Noites com 2+ fatores: ${_p5(grp[1].p)} baixa.`)+(cur?" "+TL(`Vannacht: ${cur.length?cur.map(f=>names[f]).join(", "):"geen factoren"}.`,`Tonight: ${cur.length?cur.map(f=>names[f]).join(", "):"no factors"}.`,`Esta noite: ${cur.length}.`):""),
    f:per.map(o=>[names[o.f].replace(/^./,x=>x.toUpperCase()),_p5(o.p),TL(`nachten laag, zonder ${_p5(o.p0)} · ${o.n}×`,`nights low, without ${_p5(o.p0)} · ${o.n}×`,`sem ${_p5(o.p0)}`)]),
    rule:TL("Om 23 uur: actieve insuline (≥ 1 E boven je gewone), bolus in 3 uur, sport, alcohol, laagte overdag, onder 6,5. Melding alleen bij ≥ 3 factoren.","At 23:00: active insulin (≥ 1 U above usual), bolus within 3 hours, exercise, alcohol, low during the day, below 6.5. Alert only with ≥ 3 factors.","Às 23 h."),
    src:"Jensen e.a. 2020; Leutheuser e.a. 2024" };
}
// 17 · Dawn
function _a17(c){
  const G=c.glucose, T=c.treatments||[], keys=[...(c.q.usableKeys||[])].slice(-56), res=[];
  for(const k of keys){ const g=G[_lb5(G,Date.parse(k+"T12:00:00"))]; if(!g) continue; const d0=g.ts-todMin(g.ts)*_M5;
    if(T.some(t=>t.carbs>0&&t.ts>=d0-2*_H5&&t.ts<d0+8*_H5)) continue;
    const night=_slice5(G,d0,d0+5*_H5), morn=_slice5(G,d0+7*_H5,d0+8*_H5); if(night.length<40||!morn.length) continue;
    const nad=Math.min(...night.map(x=>x.bg)), m=_avg5(morn.map(x=>x.bg)); res.push({ k, d0, rise:m-nad }); }
  if(res.length<7) return null; const yes=res.filter(r=>r.rise>=1.1);
  const wk=[0,1,2,3].map(w=>{ const to=res[res.length-1].d0-w*7*_D5, x=res.filter(r=>r.d0<=to&&r.d0>to-7*_D5); return { w, n:x.length, y:x.filter(r=>r.rise>=1.1).length }; }).reverse().filter(o=>o.n);
  return { n:17, id:"dawn", g:"loop", t:TL("Ochtendstijging (dawn)","Dawn rise","Fenómeno da alvorada"), s:yes.length/res.length>=0.5?"let":"info",
    v:TL(`${yes.length} van ${res.length} nachten zonder eten een stijging van ≥ 1,1 naar de ochtend (mediaan ${_n5(_med5(yes.map(r=>r.rise)))}).`,`${yes.length} of ${res.length} nights without food a rise of ≥ 1.1 into the morning (median ${_n5(_med5(yes.map(r=>r.rise)))}).`,`${yes.length} de ${res.length} noites.`),
    f:wk.map(o=>[o.w?TL(`${o.w} wk terug`,`${o.w} wk ago`,`há ${o.w} sem`):TL("Deze week","This week","Esta semana"),`${o.y} / ${o.n}`,TL("nachten met dawn","nights with dawn","noites")]),
    x:`<p class="an5note">${TL("Het basaalvoorstel bij Profiel zet het blok vóór je stijging al een uur eerder hoger.","The basal proposal under Profile raises the block an hour before your rise.","A proposta sobe o bloco uma hora antes.")}</p>`,
    rule:TL("Stijging ≥ 1,1 mmol/L van het nachtelijk dal (00–05 u) tot 07–08 u, zonder eten; per week.","Rise ≥ 1.1 mmol/L from the night nadir (00–05) to 07–08, without food; per week.","Subida ≥ 1,1."),
    src:"Monnier e.a. 2013; Barua e.a. 2024" };
}
// 18 · Eerste uren na podwissel
function _a18(c){
  const S=_sites5(c).filter(s=>_U5(c,s)); if(S.length<4) return null; const G=c.glucose;
  let o=[]; for(const s of S) o=o.concat(_slice5(G,s,s+6*_H5)); const O=_stat5(o);
  let k=[]; for(const s of S) for(const d of [-1,1,-2,2]){ const a=s+d*_D5; if(S.some(x=>Math.abs(x-a)<8*_H5)) continue; k=k.concat(_slice5(G,a,a+6*_H5)); } const K=_stat5(k);
  const bad=O.tir<K.tir-0.10;
  return { n:18, id:"podnieuw", g:"mat", t:TL("Eerste uren na een podwissel","First hours after a pod change","Primeiras horas após troca"), s:bad?"let":"ok",
    v:bad?TL(`In de 6 uur na wisselen ${_p5(O.tir)} in bereik, op dezelfde uren andere dagen ${_p5(K.tir)}. Wissel liever niet vlak voor eten of slapen.`,`In the 6 hours after changing ${_p5(O.tir)} in range, same hours on other days ${_p5(K.tir)}. Avoid changing right before a meal or sleep.`,`${_p5(O.tir)} vs ${_p5(K.tir)}.`)
      :TL(`Na wisselen ${_p5(O.tir)} in bereik, andere dagen ${_p5(K.tir)}: geen probleem.`,`After changing ${_p5(O.tir)} in range, other days ${_p5(K.tir)}: no problem.`,`Sem problema.`),
    f:[[TL("0–6 u na wissel","0–6 h after change","0–6 h após"),_p5(O.tir),TL(`hoog ${_p5(O.tar)}`,`high ${_p5(O.tar)}`,`alta ${_p5(O.tar)}`)],[TL("Zelfde uren, andere dag","Same hours, other day","Mesmas horas"),_p5(K.tir),TL(`hoog ${_p5(K.tar)}`,`high ${_p5(K.tar)}`,`alta ${_p5(K.tar)}`)],[TL("Wissels","Changes","Trocas"),String(S.length),""]],
    rule:TL("In bereik 0–6 uur na wisselen tegenover dezelfde uren 1–2 dagen ervoor en erna; 10%-punt verschil telt.","In range 0–6 hours after changing versus the same hours 1–2 days before and after; a 10-point difference counts.","0–6 h após troca."),
    src:"JDST 2010 (draagduur infuusset)" };
}
// 19 · Pod-falen
function _podFails5(c, from){
  const G=c.glucose.filter(x=>x.ts>=from), T=c.treatments||[], out=[];
  for(const e of _eps5(G,_isVhi5)) if(e.dur>=300) out.push({ ts:e.start, end:e.end, why:"5u" });
  const cor=T.filter(t=>t.ts>=from&&!t.isSMB&&t.insulin>=0.5&&!T.some(x=>x.carbs>0&&Math.abs(x.ts-t.ts)<=45*_M5)).sort((a,b)=>a.ts-b.ts);
  for(let i=1;i<cor.length;i++){ const a=cor[i-1], b=cor[i]; if(b.ts-a.ts>3*_H5) continue; const bgA=_bgAt5(c.glucose,a.ts), bgB=_bgAt5(c.glucose,b.ts), bg90=_bgAt5(c.glucose,b.ts+90*_M5);
    if(bgA!=null&&bgB!=null&&bg90!=null&&bgB>=13.9&&bgB>=bgA-0.5&&bg90>=bgB-1) if(!out.some(o=>Math.abs(o.ts-b.ts)<6*_H5)) out.push({ ts:b.ts, end:b.ts+90*_M5, why:"cor" }); }
  return out.sort((a,b)=>a.ts-b.ts);
}
function _a19(c){
  const end=c.glucose[c.glucose.length-1].ts, P=_podFails5(c,end-60*_D5), last=P[P.length-1];
  const now=last&&end-last.end<=15*_M5, perM=P.length/2;
  return { n:19, id:"podfalen", g:"mat", t:TL("Pod die niet goed werkt","Pod not working properly","Pod com falha"), s:now?"let":perM>1?"let":"ok",
    v:now?TL("Nu: lang hoog of correcties zonder effect. Pod mogelijk niet goed: vervang hem en corrigeer met de pen.","Now: long high or corrections without effect. Pod may be failing: replace it and correct with a pen.","Agora: pod possivelmente com falha.")
      :P.length?TL(`${P.length}× in 60 dagen (${_n5(perM)} per maand). Meer dan 1× per maand hangt samen met een hoger HbA1c.`,`${P.length}× in 60 days (${_n5(perM)} a month). More than once a month goes with a higher HbA1c.`,`${P.length}× em 60 dias.`):TL("Geen tekenen van een falende pod in 60 dagen.","No signs of a failing pod in 60 days.","Sem sinais de falha."),
    f:P.slice(-4).reverse().map(p=>[`${_dateL5(p.ts)} ${_hm5(p.ts)}`,p.why==="5u"?TL("> 5 u boven 13,9","> 5 h above 13.9","> 5 h acima"):TL("2 correcties zonder effect","2 corrections without effect","2 correções sem efeito"),""]),
    rule:TL("Vermoed falen bij > 5 uur boven 13,9, of 2 correcties binnen 3 uur waarna je niet daalt. Melding direct.","Suspect failure with > 5 hours above 13.9, or 2 corrections within 3 hours after which you don't fall. Alert immediately.","Suspeita de falha."),
    src:"Walsh; JDST 2010", now };
}
// 20 · GMI tegen lab-HbA1c
function _a20(c){
  const L=_anns5("hba1c").filter(a=>a.value>0), G=c.glucose, out=[];
  for(const a of L){ const s=G.filter(x=>x.ts>a.ts-90*_D5&&x.ts<=a.ts); if(s.length<288*30) { out.push({ a, gmi:null }); continue; } out.push({ a, gmi:metrics(s).gmi }); }
  const last=out[out.length-1], d=last&&last.gmi!=null?last.a.value-last.gmi:null;
  const cur=G.length?metrics(_last5(c,90)).gmi:null;
  return { n:20, id:"hba1c", g:"cijf", t:TL("GMI tegen je lab-HbA1c","GMI versus your lab HbA1c","GMI vs HbA1c"), s:d!=null&&Math.abs(d)>=0.5?"let":L.length?"ok":"leeg",
    v:!L.length?TL(`Je GMI is ${_n5(cur)}%. Vul je laatste lab-HbA1c in om te zien of die bij jou afwijkt.`,`Your GMI is ${_n5(cur)}%. Enter your last lab HbA1c to see whether it differs for you.`,`GMI ${_n5(cur)}%.`)
      :d==null?TL("Te weinig sensordata in de 90 dagen voor je labwaarde.","Too little sensor data in the 90 days before your lab value.","Poucos dados."):
      Math.abs(d)>=0.5?TL(`Je lab-HbA1c ligt ${_n5(Math.abs(d))} ${d>0?"hoger":"lager"} dan je GMI. Lees je GMI voortaan als ~${_n5(cur+d)}%.`,`Your lab HbA1c is ${_n5(Math.abs(d))} ${d>0?"higher":"lower"} than your GMI. Read your GMI as ~${_n5(cur+d)}% from now on.`,`Diferença ${_n5(d)}.`)
      :TL("Je lab-HbA1c en GMI komen overeen (verschil < 0,5).","Your lab HbA1c and GMI agree (difference < 0.5).","Concordam."),
    f:out.slice(-3).reverse().map(o=>[_dateL5(o.a.ts),`${_n5(o.a.value)}%`,o.gmi!=null?TL(`GMI ${_n5(o.gmi)}%`,`GMI ${_n5(o.gmi)}%`,`GMI ${_n5(o.gmi)}%`):TL("te weinig data","too little data","poucos dados")]).concat([[TL("GMI nu (90 d)","GMI now (90 d)","GMI agora"),_n5(cur)+"%",""]]),
    x:`<div class="an5in"><label>${TL("Lab-HbA1c (%)","Lab HbA1c (%)","HbA1c (%)")}<input type="text" id="an5Hb" inputmode="decimal" placeholder="7,0"></label><label>${TL("Datum","Date","Data")}<input type="date" id="an5HbD" value="${new Date().toISOString().slice(0,10)}"></label><button class="ibtn acc" data-an5="hba1c">${TL("Bewaren","Save","Guardar")}</button></div>`,
    rule:TL("Lab-HbA1c invoeren; een verschil ≥ 0,5% met de GMI over de 90 dagen ervoor wordt gemeld.","Enter lab HbA1c; a difference ≥ 0.5% with the GMI over the 90 days before is reported.","Diferença ≥ 0,5%."),
    src:"Perlman e.a. 2021" };
}
// 21 · Weekdag tegen weekend
function _a21(c){
  const keys=[...(c.q.usableKeys||[])].slice(-60), G=c.glucose, T=c.treatments||[]; if(keys.length<14) return null;
  const isWe=k=>{ const d=new Date(k+"T12:00:00").getDay(); return d===0||d===6; };
  const grp=[false,true].map(we=>{ const ks=new Set(keys.filter(k=>isWe(k)===we)); const g=G.filter(x=>ks.has(_dk5(x.ts)));
    const meals=T.filter(t=>t.carbs>=15&&ks.has(_dk5(t.ts))); const bf=meals.filter(t=>_dp5(t.ts)===1).map(t=>todMin(t.ts));
    return { n:ks.size, s:_stat5(g), bf:_med5(bf), g:meals.reduce((s,t)=>s+t.carbs,0)/(ks.size||1) }; });
  const d=grp[1].s.tir-grp[0].s.tir;
  return { n:21, id:"weekend", g:"cijf", t:TL("Weekdagen tegen weekend","Weekdays versus weekend","Semana vs fim de semana"), s:Math.abs(d)>=0.1?"let":"ok",
    v:TL(`Weekend ${_p5(grp[1].s.tir)} in bereik, doordeweeks ${_p5(grp[0].s.tir)}.`,`Weekend ${_p5(grp[1].s.tir)} in range, weekdays ${_p5(grp[0].s.tir)}.`,`Fim de semana ${_p5(grp[1].s.tir)}.`)+(grp[0].bf!=null&&grp[1].bf!=null&&Math.abs(grp[1].bf-grp[0].bf)>=60?TL(` Je ontbijt in het weekend ${_n5(Math.abs(grp[1].bf-grp[0].bf)/60)} uur ${grp[1].bf>grp[0].bf?"later":"eerder"}.`,` Weekend breakfast is ${_n5(Math.abs(grp[1].bf-grp[0].bf)/60)} hours ${grp[1].bf>grp[0].bf?"later":"earlier"}.`,""):""),
    f:[[TL("Doordeweeks","Weekdays","Semana"),_p5(grp[0].s.tir),TL(`laag ${_p5(grp[0].s.tbr)} · ontbijt ${grp[0].bf!=null?fmtMin(grp[0].bf):"—"} · ${Math.round(grp[0].g)} g/dag`,`low ${_p5(grp[0].s.tbr)} · breakfast ${grp[0].bf!=null?fmtMin(grp[0].bf):"—"} · ${Math.round(grp[0].g)} g/day`,"")],
       [TL("Weekend","Weekend","Fim de semana"),_p5(grp[1].s.tir),TL(`laag ${_p5(grp[1].s.tbr)} · ontbijt ${grp[1].bf!=null?fmtMin(grp[1].bf):"—"} · ${Math.round(grp[1].g)} g/dag`,`low ${_p5(grp[1].s.tbr)} · breakfast ${grp[1].bf!=null?fmtMin(grp[1].bf):"—"} · ${Math.round(grp[1].g)} g/day`,"")]],
    rule:TL("Kerncijfers en eettijden apart voor weekdagen en weekend (60 dagen); 10%-punt verschil telt.","Key numbers and meal times separately for weekdays and weekend (60 days); a 10-point difference counts.","60 dias."),
    src:"Endotext" };
}
// 22 · Laagte behandelen
function _a22(c){
  const G=c.glucose, T=c.treatments||[], E=_eps5(G.filter(x=>x.ts>G[G.length-1].ts-60*_D5),_isLo5);
  const rows=E.map(e=>{ const g=T.filter(t=>t.carbs>0&&t.ts>=e.start-10*_M5&&t.ts<=e.start+40*_M5).reduce((s,t)=>s+t.carbs,0); const after=_slice5(G,e.end,e.end+150*_M5); return { g, reb:after.length?Math.max(...after.map(x=>x.bg)):null }; });
  if(rows.length<5) return null; const logged=rows.filter(r=>r.g>0), reb=rows.filter(r=>r.reb!=null&&r.reb>HI_T);
  return { n:22, id:"hypobeh", g:"veilig", t:TL("Laagte behandelen","Treating a low","Tratar uma baixa"), s:reb.length/rows.length>=0.25?"let":"ok",
    v:TL(`Na ${_p5(reb.length/rows.length)} van je laagtes schoot je door boven 10${logged.length?`; je logt meestal ${Math.round(_med5(logged.map(r=>r.g)))} g`:""}.`,`After ${_p5(reb.length/rows.length)} of your lows you overshot above 10${logged.length?`; you usually log ${Math.round(_med5(logged.map(r=>r.g)))} g`:""}.`,`${_p5(reb.length/rows.length)} acima de 10 depois.`),
    f:[[TL("Laagtes","Lows","Baixas"),String(rows.length),TL("60 dagen","60 days","60 dias")],[TL("Met KH gelogd","With carbs logged","Com hidratos"),String(logged.length),logged.length?TL(`mediaan ${Math.round(_med5(logged.map(r=>r.g)))} g`,`median ${Math.round(_med5(logged.map(r=>r.g)))} g`,""):""],[TL("Erna boven 10","Above 10 after","Acima de 10 depois"),String(reb.length),TL("binnen 2,5 uur","within 2.5 hours","em 2,5 h")]],
    x:`<p class="an5note">${TL("Met een loop staat je basaal bij een dreigende laagte al uit, dus je hebt minder nodig: 5 g per 5 minuten, of de helft van wat je zonder loop zou nemen.","With a loop your basal is already off when a low threatens, so you need less: 5 g every 5 minutes, or half of what you'd take without a loop.","Com loop precisa de menos.")}</p>`,
    rule:TL("Hoeveel gram rond de laagte en wat erna (> 10 binnen 2,5 uur = doorgeschoten); advies kleiner bij AID.","How many grams around the low and what follows (> 10 within 2.5 hours = overshoot); smaller advice with AID.","Sobretratamento."),
    src:"NHS Tayside; Endotext" };
}
// 23 · Hypo-gevoel (Gold)
function _a23(c){
  const L=_anns5("gold"), last=L[L.length-1], due=!last||Date.now()-last.ts>90*_D5;
  return { n:23, id:"gold", g:"veilig", t:TL("Voel je een laagte aankomen?","Do you feel a low coming?","Sente uma baixa?"), s:last&&last.value>=4?"let":due?"leeg":"ok",
    v:!last?TL("Nog niet ingevuld. Eén vraag, elk kwartaal.","Not filled in yet. One question, every quarter.","Por preencher."):last.value>=4?TL(`Score ${last.value} (${_dateL5(last.ts)}): verminderd gevoel. Dan telt elke laagte zwaarder, en IDA blijft voorzichtig.`,`Score ${last.value} (${_dateL5(last.ts)}): reduced awareness. Then every low counts more, and IDA stays cautious.`,`Pontuação ${last.value}.`):TL(`Score ${last.value} (${_dateL5(last.ts)}): je voelt laagtes goed aankomen.`,`Score ${last.value} (${_dateL5(last.ts)}): you feel lows coming.`,`Pontuação ${last.value}.`),
    f:L.slice(-3).reverse().map(a=>[_dateL5(a.ts),String(a.value),a.value>=4?TL("verminderd","reduced","reduzida"):TL("goed","good","boa")]),
    x:`<p class="an5q">${TL("Weet je wanneer je laag wordt? 1 = altijd, 7 = nooit.","Do you know when your hypos are starting? 1 = always, 7 = never.","Sabe quando começa uma baixa? 1 = sempre, 7 = nunca.")}</p><div class="an5scale">${[1,2,3,4,5,6,7].map(v=>`<button class="lchip" data-an5gold="${v}">${v}</button>`).join("")}</div>`,
    rule:TL("Gold-vraag 1–7, elk kwartaal; ≥ 4 = verminderd gevoel.","Gold question 1–7, every quarter; ≥ 4 = impaired awareness.","Gold ≥ 4."),
    src:"Gold e.a. 1994", due };
}
// 24 · Slaap
function _a24(c){
  const e=idaFactors5(c).find(f=>f.id==="nacht");
  if(!e) return _empty5(24,"slaap","leef",TL("Korte nacht","Short night","Noite curta"),TL("Log een korte nacht met + om te zien wat die de dag erna doet.","Log a short night with + to see what it does the next day.","Registe uma noite curta com +."),"Donga e.a. 2010");
  return { n:24, id:"slaap", g:"leef", t:TL("Korte nacht","Short night","Noite curta"), s:e.known&&e.dTir<0?"let":"info",
    v:TL(`De dag na een korte nacht: ${_facLine5(e)}.`,`The day after a short night: ${_facLine5(e)}.`,`Dia após noite curta: ${_facLine5(e)}.`),
    f:[[TL("In bereik","In range","No alvo"),_p5(e.o.tir),TL(`normaal ${_p5(e.k.tir)}`,`normally ${_p5(e.k.tir)}`,"")],[TL("Gemiddeld","Mean","Média"),_n5(e.o.mean),TL(`normaal ${_n5(e.k.mean)}`,`normally ${_n5(e.k.mean)}`,"")]],
    x:`<p class="an5note">${TL("Eén korte nacht maakt je de dag erna minder gevoelig voor insuline. Dan helpt een iets hoger profielpercentage, of eerder bolussen.","One short night makes you less sensitive to insulin the next day. A slightly higher profile percentage or bolusing earlier then helps.","Uma noite curta reduz a sensibilidade.")}</p>`,
    rule:TL("De dag (06–24 u) na een gelogde korte nacht, tegenover dezelfde uren op andere dagen.","The day (06–24) after a logged short night, versus the same hours on other days.","Dia seguinte."),
    src:"Donga e.a. 2010" };
}
// 25 · Cyclus
function _a25(c){
  const S=_anns5("cyclus"); if(!S.length&&!cfg.cycle) return null;
  if(S.length<2) return _empty5(25,"cyclus","leef",TL("Cyclus","Cycle","Ciclo"),TL("Log de eerste dag van je menstruatie met +; na 2 cycli volgt een vergelijking per fase.","Log the first day of your period with +; after 2 cycles a comparison per phase follows.","Registe o 1.º dia."),"Brown e.a. 2015");
  const G=c.glucose, ph=[[0,13,TL("folliculair (dag 1–13)","follicular (day 1–13)","folicular")],[14,28,TL("luteaal (dag 14–28)","luteal (day 14–28)","lútea")]];
  const rows=ph.map(([a,b,l])=>{ let g=[], s=[]; for(const x of S){ g=g.concat(_slice5(G,x.ts+a*_D5,x.ts+(b+1)*_D5)); for(const d of (_dsAll||[])) if(d.ts>=x.ts+a*_D5&&d.ts<x.ts+(b+1)*_D5&&d.sens!=null) s.push(d.sens); } return { l, s:_stat5(g), sens:_avg5(s) }; });
  return { n:25, id:"cyclus", g:"leef", t:TL("Cyclus","Cycle","Ciclo"), s:"info",
    v:TL(`Luteaal ${_p5(rows[1].s.tir)} in bereik, folliculair ${_p5(rows[0].s.tir)}.`,`Luteal ${_p5(rows[1].s.tir)} in range, follicular ${_p5(rows[0].s.tir)}.`,`Lútea ${_p5(rows[1].s.tir)}.`),
    f:rows.map(r=>[r.l.replace(/^./,x=>x.toUpperCase()),_p5(r.s.tir),TL(`autosens ${_n5(r.sens,2)}`,`autosens ${_n5(r.sens,2)}`,`autosens ${_n5(r.sens,2)}`)]),
    rule:TL("Gevoeligheid en in bereik per fase, vanaf de gelogde eerste dag.","Sensitivity and in range per phase, from the logged first day.","Por fase."), src:"Brown e.a. 2015" };
}
// 26 · Plaats van de pod
function _a26(c){
  const P=_anns5("plaats"); if(!P.length) return _empty5(26,"plaats","mat",TL("Plaats van de pod","Pod site","Local do pod"),TL("Log bij een nieuwe pod de plaats met +; IDA vergelijkt per plaats.","Log the site with + when you place a new pod; IDA compares per site.","Registe o local com +."),"Blanco e.a. 2013");
  const S=_sites5(c), G=c.glucose, by=new Map();
  for(const p of P){ const s=S.find(x=>Math.abs(x-p.ts)<=6*_H5)||p.ts; const nx=S.find(x=>x>s+6*_H5)||s+72*_H5; const o=by.get(p.site)||{ n:0, g:[] }; o.n++; o.g=o.g.concat(_slice5(G,s,Math.min(nx,s+80*_H5))); by.set(p.site,o); }
  const rows=[...by.entries()].map(([k,o])=>({ k, n:o.n, s:_stat5(o.g) })).filter(r=>r.s.n).sort((a,b)=>b.s.tir-a.s.tir);
  const best=rows[0], worst=rows[rows.length-1];
  return { n:26, id:"plaats", g:"mat", t:TL("Plaats van de pod","Pod site","Local do pod"), s:rows.length>=2&&best.n>=2&&worst.n>=2&&best.s.tir-worst.s.tir>=0.1?"let":"info",
    v:rows.length<2?TL(`${P.length}× gelogd; vanaf 2 plaatsen volgt een vergelijking.`,`${P.length}× logged; a comparison follows from 2 sites.`,`${P.length}×.`):TL(`Beste plaats ${_site5(best.k)} (${_p5(best.s.tir)}), minste ${_site5(worst.k)} (${_p5(worst.s.tir)}).`,`Best site ${_site5(best.k)} (${_p5(best.s.tir)}), worst ${_site5(worst.k)} (${_p5(worst.s.tir)}).`,`Melhor ${_site5(best.k)}.`),
    f:rows.map(r=>[_site5(r.k),_p5(r.s.tir),TL(`${r.n} pods · gem. ${_n5(r.s.mean)}`,`${r.n} pods · mean ${_n5(r.s.mean)}`,`${r.n} pods`)]),
    x:`<p class="an5note">${TL("Steeds dezelfde plek geeft verhard vet (lipohypertrofie) en slechtere opname. Wissel van plek.","Always the same spot causes hardened fat (lipohypertrophy) and poorer absorption. Rotate sites.","Varie o local.")}</p>`,
    rule:TL("In bereik over de draagduur van elke pod, per gelogde plaats.","In range over each pod's wear time, per logged site.","Por local."), src:"Blanco e.a. 2013" };
}
const _SITES5=()=>({ buikL:TL("buik links","belly left","barriga esq."), buikR:TL("buik rechts","belly right","barriga dir."), armL:TL("arm links","arm left","braço esq."), armR:TL("arm rechts","arm right","braço dir."), beenL:TL("been links","leg left","perna esq."), beenR:TL("been rechts","leg right","perna dir."), rug:TL("onderrug","lower back","lombar") });
function _site5(k){ return _SITES5()[k]||k; }
// 27 · Werkt een melding?
function _a27(c){
  if(typeof idaMoments!=="function") return null;
  const G=c.glucose, T=(c.treatments||[]).slice().sort((a,b)=>a.ts-b.ts), end=G[G.length-1].ts, from=end-14*_D5, seen=new Map();
  const anns=(typeof _idaAnns!=="undefined"&&_idaAnns)||[];
  for(let t=from; t<=end; t+=20*_M5){ const off=(typeof tzOffsetAt==="function"&&tzOffsetAt(t)!=null)?tzOffsetAt(t):-new Date(t).getTimezoneOffset();
    const g=G.slice(Math.max(0,_lb5(G,t-36*_H5)),_lb5(G,t+1)), tr=T.slice(_lb5(T,t-30*_D5),_lb5(T,t+1));
    let L=[]; try{ L=idaMoments(g,tr,{ now:t, tzOffsetMin:off, anns, stats:null, iob:(()=>{ const d=_dsAt4(t,10*_M5); return d?d.iob:null; })() }); }catch(_){}
    for(const m of L) if(!seen.has(m.key)) seen.set(m.key,{ ...m, t }); }
  const kinds={}; for(const m of seen.values()){ const k=kinds[m.kind]||(kinds[m.kind]={ n:0, ok:0 }); k.n++;
    // uitkomst: wat de melding wil bereiken
    const win=_slice5(G,m.t,m.t+4*_H5);
    if(m.kind==="vraag") { if(T.some(x=>x.carbs>0&&x.ts>=m.t-2*_H5&&x.ts<=m.t+3*_H5)) k.ok++; }
    else if(m.kind==="eten"||m.kind==="nacht"||m.kind==="alcohol") { if(!win.some(x=>x.bg<LO_T)) k.ok++; }
    else if(m.kind==="ketonen"||m.kind==="pod") { const a=_bgAt5(G,m.t+3*_H5,20*_M5); if(a!=null&&a<=12) k.ok++; }
    else if(m.kind==="sport") { if(!_slice5(G,m.t,m.t+6*_H5).some(x=>x.bg<LO_T)) k.ok++; } }
  const nm={ eten:TL("Bolus pas bij de eerste hap","Bolus at the first bite","Bólus à 1.ª garfada"), vraag:TL("Stijging zonder eten","Rise without food","Subida sem comida"), ketonen:TL("Meet ketonen","Check ketones","Meça cetonas"), pod:TL("Pod mogelijk niet goed","Pod may be failing","Pod com falha"), nacht:TL("Laagte vannacht","Low tonight","Baixa à noite"), alcohol:TL("Ochtend na alcohol","Morning after alcohol","Manhã após álcool"), sport:TL("Streefwaarde vóór sport","Target before exercise","Alvo antes do exercício"), waakhond:TL("Geen data van je telefoon (server)","No data from your phone (server)","Sem dados do telemóvel") };
  const okw={ eten:TL("niet laag erna","no low after","sem baixa"), vraag:TL("eten gelogd","food logged","comida registada"), ketonen:TL("binnen 3 uur ≤ 12","≤ 12 within 3 hours","≤ 12 em 3 h"), pod:TL("binnen 3 uur ≤ 12","≤ 12 within 3 hours","≤ 12 em 3 h"), nacht:TL("niet laag erna","no low after","sem baixa"), alcohol:TL("niet laag erna","no low after","sem baixa"), sport:TL("niet laag erna","no low after","sem baixa") };
  const rows=Object.entries(kinds).map(([k,o])=>({ k, ...o }));
  const weak=rows.filter(r=>r.n>=5&&r.ok/r.n<0.2&&r.k==="vraag");
  const muted=(cfg.mute5||[]);
  return { n:27, id:"meldingen", g:"meld", t:TL("Werken de meldingen?","Do the alerts work?","Os alertas funcionam?"), s:weak.length?"let":"info",
    v:!rows.length?TL("Geen meldingen in de laatste 2 weken.","No alerts in the last 2 weeks.","Sem alertas."):TL(`${rows.reduce((s,r)=>s+r.n,0)} meldingen in 2 weken.`,`${rows.reduce((s,r)=>s+r.n,0)} alerts in 2 weeks.`,`${rows.reduce((s,r)=>s+r.n,0)} alertas.`)+(weak.length?TL(` Op "${nm[weak[0].k]}" volgt zelden iets: zet hem uit als hij je niet helpt.`,` "${nm[weak[0].k]}" rarely leads anywhere: switch it off if it doesn't help.`,""):""),
    f:rows.map(r=>[nm[r.k]||r.k,`${r.ok} / ${r.n}`,okw[r.k]||""]),
    x:`<div class="an5mute"><span class="ilabel">${TL("Meldingen aan","Alerts on","Alertas ligados")}</span>${Object.keys(nm).map(k=>`<label class="an5tg"><input type="checkbox" data-an5mute="${k}" ${muted.includes(k)?"":"checked"}><span>${nm[k]}</span></label>`).join("")}</div>`,
    rule:TL("Per soort melding (nagespeeld over 2 weken) de uitkomst erna; een melding zonder effect kun je uitzetten.","Per kind of alert (replayed over 2 weeks) the outcome afterwards; switch off an alert without effect.","Resultado por alerta."),
    src:TL("eigen ontwerp","own design","design próprio") };
}
// 29 · Wat je in AAPS zelf instelde
function _a29(c){
  const end=c.glucose[c.glucose.length-1].ts, from=end-30*_D5, TTall=_tts5(c).filter(x=>x.b>from), TT=TTall.filter(x=>!_ttAuto5(x)), TA=TTall.filter(_ttAuto5), PC=_pcts5(c).filter(x=>x.b>from);
  const hrs=a=>a.reduce((s,x)=>s+(Math.min(x.b,end)-Math.max(x.a,from)),0)/_H5;
  const cur=PC.find(x=>x.a<=end&&x.b>=end), long=cur&&end-cur.a>24*_H5;
  const FF=c._fac5||null, fTT=FF&&FF.find(f=>f.id==="tt"), fP=FF&&FF.find(f=>f.id==="pct");
  return { n:29, id:"aaps", g:"loop", t:TL("Wat je in AAPS zelf instelde","What you set in AAPS yourself","O que definiu no AAPS"), s:long?"let":"info",
    v:long?TL(`Profielpercentage staat al ${Math.round((end-cur.a)/_H5)} uur op ${cur.p}%. Bewust? Het verandert basaal, ISF en KH-ratio tegelijk.`,`Profile percentage has been ${cur.p}% for ${Math.round((end-cur.a)/_H5)} hours. On purpose? It changes basal, ISF and carb ratio together.`,`Percentagem em ${cur.p}%.`)
      :TL(`In 30 dagen ${TT.length}× zelf een tijdelijke streefwaarde (${Math.round(hrs(TT))} uur), ${TA.length}× door AAPS en ${PC.length}× een profielpercentage (${Math.round(hrs(PC))} uur).`,`In 30 days ${TT.length}× a temporary target set yourself (${Math.round(hrs(TT))} hours), ${TA.length}× by AAPS and ${PC.length}× a profile percentage (${Math.round(hrs(PC))} hours).`,`${TT.length}× alvo temporário.`),
    f:[[TL("Streefwaarde, zelf gezet","Target, set yourself","Alvo, definido por si"),`${TT.length}×`,fTT?_facLine5(fTT):""],[TL("Streefwaarde door AAPS","Target by AAPS","Alvo pelo AAPS"),`${TA.length}×`,TL("hypo en automatisering: een reactie, geen oorzaak","hypo and automation: a reaction, not a cause","reação")],[TL("Profielpercentage","Profile percentage","Percentagem"),`${PC.length}×`,fP?_facLine5(fP):""]]
      .concat(PC.slice(-3).reverse().map(x=>[`${_dateL5(x.a)} ${_hm5(x.a)}`,`${x.p}%`,`${Math.round((Math.min(x.b,end)-x.a)/_H5)} ${TL("uur","hours","horas")}`])),
    x:`<p class="an5note">${TL("Het profielvoorstel rekent met het profiel dat écht actief was, inclusief percentage.","The profile proposal uses the profile that was actually active, including percentage.","A proposta usa o perfil realmente ativo.")}</p>`,
    rule:TL("Tijdelijke streefwaarden en profielpercentages uit Nightscout; > 24 uur ≠ 100% wordt gemeld.","Temporary targets and profile percentages from Nightscout; > 24 hours ≠ 100% is reported.","Do Nightscout."),
    src:"AAPS-documentatie (profielwissel en percentage)", long, cur };
}
// 30 · Warmte
function _a30(c){
  const e=idaFactors5(c).find(f=>f.id==="warmte");
  if(!e) return _empty5(30,"warmte","leef",TL("Warmte","Heat","Calor"),TL("Log sauna, heet bad of een hete dag met +; IDA vergelijkt de 3 uur erna.","Log a sauna, hot bath or hot day with +; IDA compares the 3 hours after.","Registe calor com +."),"Koivisto 1980");
  return { n:30, id:"warmte", g:"leef", t:TL("Warmte","Heat","Calor"), s:e.known&&e.dTbr>0?"let":"info",
    v:TL(`3 uur na warmte: ${_facLine5(e)}.`,`3 hours after heat: ${_facLine5(e)}.`,`3 h após calor: ${_facLine5(e)}.`),
    f:[[TL("Laag","Low","Baixa"),_p5(e.o.tbr),TL(`normaal ${_p5(e.k.tbr)}`,`normally ${_p5(e.k.tbr)}`,"")],[TL("In bereik","In range","No alvo"),_p5(e.o.tir),TL(`normaal ${_p5(e.k.tir)}`,`normally ${_p5(e.k.tir)}`,"")]],
    x:`<p class="an5note">${TL("Warmte laat insuline tot twee keer zo snel opnemen. Eet iets kleins vooraf, of zet een tijdelijke streefwaarde.","Heat can absorb insulin up to twice as fast. Eat a small snack first, or set a temporary target.","O calor acelera a absorção.")}</p>`,
    rule:TL("Laag en in bereik in 0–3 uur na een warmte-log, tegen dezelfde uren op andere dagen.","Low and in range 0–3 hours after a heat log, versus the same hours on other days.","0–3 h."), src:"Koivisto 1980 (BMJ)" };
}
// 31 · Medicijnen
function _a31(c){
  const M=_anns5("medicijn"); const end=Date.now();
  if(!M.length) return _empty5(31,"medicijn","leef",TL("Medicijnen","Medication","Medicação"),TL("Log prednison, vitamine C of aspirine met +; IDA past zijn berekeningen aan.","Log prednisone, vitamin C or aspirin with +; IDA adjusts its calculations.","Registe com +."),"Abbott; Terveyskylä");
  const act=M.filter(a=>end<a.ts+(Math.max(1,+a.days||1)+(a.med==="prednison"?2:0))*_D5);
  const e=idaFactors5(c).find(f=>f.id==="prednison"), nm={ prednison:TL("prednison","prednisone","prednisona"), vitc:TL("vitamine C","vitamin C","vitamina C"), aspirine:TL("aspirine","aspirin","aspirina") };
  return { n:31, id:"medicijn", g:"leef", t:TL("Medicijnen","Medication","Medicação"), s:act.length?"let":"info",
    v:act.length?act.map(a=>a.med==="prednison"?TL("Prednison actief: vanaf de middag hoger. Het profielvoorstel slaat deze dagen (en 2 erna) over.","Prednisone active: higher from the afternoon. The profile proposal skips these days (and 2 after).","Prednisona ativa."):a.med==="vitc"?TL("Vitamine C: je sensor kan te hoog meten. Prik voor je corrigeert; deze dagen tellen niet mee.","Vitamin C: your sensor may read high. Fingerprick before correcting; these days don't count.","Vitamina C: sensor alto."):TL("Aspirine: je sensor kan iets te laag meten. Prik bij twijfel; deze dagen tellen niet mee.","Aspirin: your sensor may read slightly low. Fingerprick if in doubt; these days don't count.","Aspirina: sensor baixo.")).join(" ")
      :TL(`${M.length}× gelogd; niets actief.`,`${M.length}× logged; nothing active.`,`${M.length}×.`),
    f:M.slice(-4).reverse().map(a=>[_dateL5(a.ts),nm[a.med]||a.med||"—",`${Math.max(1,+a.days||1)} ${TL("dag(en)","day(s)","dia(s)")}`]).concat(e?[[TL("Prednison, effect","Prednisone, effect","Efeito"),"",_facLine5(e)]]:[]),
    rule:TL("Prednison: stijging vanaf de middag, profielvoorstel pauzeert tot 2 dagen na de kuur. Vitamine C (vals hoog) en aspirine (iets te laag): die dagen tellen niet mee.","Prednisone: rise from the afternoon, proposal pauses until 2 days after the course. Vitamin C (falsely high) and aspirin (slightly low): those days don't count.","Regras."),
    src:"Abbott (Libre 2); Terveyskylä (cortison)" };
}
// 32 · Seizoen en lange trend
function _a32(c){
  const G=c.glucose, by=new Map(); for(const x of G){ if(!_U5(c,x.ts)) continue; const k=_dk5(x.ts).slice(0,7); const a=by.get(k)||[]; a.push(x); by.set(k,a); }
  const rows=[...by.entries()].filter(([,a])=>a.length>=288*7).map(([k,a])=>({ k, s:_stat5(a) })).sort((a,b)=>a.k.localeCompare(b.k));
  if(rows.length<2) return null;
  const W=[]; const end=G[G.length-1].ts; for(let w=7; w>=0; w--){ const s=_stat5(G.filter(x=>x.ts>end-(w+1)*7*_D5&&x.ts<=end-w*7*_D5&&_U5(c,x.ts))); if(s.n>288*3) W.push({ w, tir:s.tir }); }
  let slope=null; if(W.length>=4){ const n=W.length, xs=W.map((_,i)=>i), ys=W.map(o=>o.tir), mx=_avg5(xs), my=_avg5(ys); slope=xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0)/xs.reduce((s,x)=>s+(x-mx)**2,0); }
  const ml=k=>new Date(k+"-15T12:00:00").toLocaleDateString(LOCALE(),{month:"long",year:"numeric"});
  return { n:32, id:"trend", g:"cijf", t:TL("Maanden en trend","Months and trend","Meses e tendência"), s:slope!=null&&slope<=-0.01?"let":"info",
    v:(slope==null?"":slope>=0.01?TL(`Stijgende lijn: ~${_pp5(slope)} in bereik per week. `,`Upward trend: ~${_pp5(slope)} in range a week. `,""):slope<=-0.01?TL(`Dalende lijn: ~${_pp5(slope)} in bereik per week. `,`Downward trend: ~${_pp5(slope)} in range a week. `,""):TL("Stabiel over de laatste weken. ","Stable over recent weeks. ",""))
      +(rows.length<6?TL(`Seizoen: na 6 maanden data (nu ${rows.length}).`,`Season: after 6 months of data (now ${rows.length}).`,""):""),
    f:rows.slice(-6).reverse().map(r=>[ml(r.k).replace(/^./,x=>x.toUpperCase()),_p5(r.s.tir),TL(`laag ${_p5(r.s.tbr)} · gem. ${_n5(r.s.mean)}`,`low ${_p5(r.s.tbr)} · mean ${_n5(r.s.mean)}`,"")]),
    x:`<p class="an5note">${TL("In de winter ligt de tijd in bereik bij de meeste mensen lager. Het profielvoorstel volgt je laatste weken, niet één slechte week.","Time in range is lower in winter for most people. The profile proposal follows your recent weeks, not one bad week.","No inverno é mais baixo.")}</p>`,
    rule:TL("In bereik per maand; trend over de laatste 8 weken.","In range per month; trend over the last 8 weeks.","Por mês."), src:"Endocrine 2024 (Kobe)" };
}

/* ── analyse 28 als scherm: wat bij jou het meest meespeelt ─────────────── */
function _a28view(c){
  const F=idaFactors5(c).filter(f=>f.n>0), known=F.filter(f=>f.known), unk=F.filter(f=>!f.known);
  const bar=f=>{ const v=f.dTir||0, w=Math.min(50,Math.abs(v)*100*1.5); return `<span class="an5fb"><i class="${v<0?"neg":"pos"}" style="width:${w}%;${v<0?"right:50%":"left:50%"}"></i></span>`; };
  return `<section class="ibox an5fac"><span class="ilabel">${TL("Wat bij jou het meest meespeelt","What matters most for you","O que mais conta para si")}</span>
    ${known.length?known.slice(0,6).map(f=>`<div class="an5fr"><b>${esc(f.t)}</b>${bar(f)}<i>${esc(_facLine5(f))} · ${esc(f.span)}</i></div>`).join(""):`<p class="an5note">${TL("Nog geen factor met een duidelijk effect. Log sport, alcohol, stress en ziek met +; vanaf 5 keer vergelijkt IDA.","No factor with a clear effect yet. Log exercise, alcohol, stress and illness with +; from 5 times IDA compares.","Ainda sem fator claro.")}</p>`}
    ${unk.length?`<p class="an5unk">${TL("Geen duidelijk effect of te weinig keren: ","No clear effect or too few times: ","Sem efeito claro: ")}${unk.map(f=>`${esc(f.t)} (${f.n}×)`).join(", ")}.</p>`:""}
    <p class="an5src">${TL("Elk venster tegen dezelfde uren op je eigen dagen zonder die factor; telt vanaf 5 keer en 10%-punt verschil.","Each window versus the same hours on your own days without that factor; counts from 5 times and a 10-point difference.","Cada janela vs as mesmas horas sem o fator.")}</p></section>`;
}

/* ── scherm "Analyses" ───────────────────────────────────────────────── */
function idaInzicht(){
  const host=document.getElementById("inzBody"); if(!host||!_ctx||!_ctx.glucose||!_ctx.glucose.length) return;
  const c=_ctx, A=idaAn(c), G=_GRP5();
  const dot=s=>`<span class="an5d ${s}"></span>`;
  const row=a=>`<button type="button" class="irow an5r" data-an5open="${a.id}">${dot(a.s)}<span class="irt"><b>${esc(a.t)}</b><i>${esc(a.v)}</i></span><span class="irc" aria-hidden="true">›</span></button>`;
  host.innerHTML=`<p class="an5intro">${TL("Hier rekent IDA mee. Wat ertoe doet zie je bij je momenten, op Vandaag en bij Profiel; dit is de onderbouwing.","This is what IDA calculates with. What matters shows up in your moments, on Today and under Profile; this is the reasoning behind it.","Isto é a base dos cálculos.")}</p>`+_a28view(c)
    +G.map(([g,l])=>{ const x=A.filter(a=>a.g===g); return x.length?`<h2 class="ihead">${l}</h2>${x.map(row).join("")}`:""; }).join("");
  host.querySelectorAll("[data-an5open]").forEach(b=>b.onclick=()=>openAn5(b.dataset.an5open));
}
function openAn5(id){
  const c=_ctx; let a=idaAn(c).find(x=>x.id===id); if(!a) return;
  if(a.lazy){ try{ const full=_one5(c,_a27); if(full) a=full; }catch(e){ console.error(e); } }
  const hold=document.getElementById("inzHold"); const node=document.createElement("div"); node.className="momdet an5det";
  node.innerHTML=`<p class="verdict an5v ${a.s}">${esc(a.v)}</p>
    ${a.f&&a.f.length?`<div class="mfacts">${a.f.map(([k,v,s])=>`<div><i>${esc(k)}</i><b>${esc(v)}</b>${s?`<em>${esc(s)}</em>`:""}</div>`).join("")}</div>`:""}
    ${a.x?`<section class="ibox">${a.x}</section>`:""}
    ${a.rule?`<p class="an5rule"><b>${TL("Regel","Rule","Regra")}</b> ${esc(a.rule)}</p>`:""}
    <p class="an5src">${TL("Bron","Source","Fonte")}: ${esc(a.src||"")} · ${TL("analyse","analysis","análise")} ${a.n}</p>`;
  hold.appendChild(node);
  _wireAn5(node, id);
  openDetail([node], a.t, ()=>node.remove());
}
async function _addAnn5(an){ an.id=an.id||("a5"+an.ts+"-"+Math.random().toString(36).slice(2,6)); an.created=Date.now(); an.src="ida5";
  await DB.putMany("annotations",[an]); _idaAnns=await DB.all("annotations"); if(_ctx){ delete _ctx._an5; delete _ctx._fac5; } }
function _wireAn5(node, id){
  node.querySelectorAll('[data-an5="hba1c"]').forEach(b=>b.onclick=async()=>{ const v=parseFloat(String(node.querySelector("#an5Hb").value).replace(",",".")), d=node.querySelector("#an5HbD").value;
    if(!(v>=4&&v<=15)){ toast(TL("Vul een HbA1c tussen 4 en 15% in.","Enter an HbA1c between 4 and 15%.","HbA1c entre 4 e 15%.")); return; }
    await _addAnn5({ type:"hba1c", ts:Date.parse(d+"T12:00:00")||Date.now(), value:v, note:`HbA1c ${v}%` }); closeDetail(true); openAn5(id); toast(TL("HbA1c bewaard.","HbA1c saved.","Guardado.")); });
  node.querySelectorAll("[data-an5gold]").forEach(b=>b.onclick=async()=>{ const v=+b.dataset.an5gold;
    await _addAnn5({ type:"gold", ts:Date.now(), value:v, note:`Gold ${v}` }); closeDetail(true); openAn5(id); toast(TL("Bewaard.","Saved.","Guardado.")); });
  node.querySelectorAll("[data-an5mute]").forEach(b=>b.onchange=()=>{ const k=b.dataset.an5mute, s=new Set(cfg.mute5||[]); if(b.checked) s.delete(k); else s.add(k); cfg.mute5=[...s]; saveCfg(); });
}

/* ── inhaken: idaDag, idaProfiel, idaVandaag, showTab en _momFactors (ida4) roepen deze functies zelf aan ── */
function _dagLink5(h){ if(!h||h.querySelector("[data-go5]")) return; const b=document.createElement("button"); b.type="button"; b.className="an5link"; b.dataset.go5="1";
  b.textContent=TL("Alle analyses ›","All analyses ›","Todas as análises ›"); b.onclick=()=>showTab("inzicht"); h.appendChild(b); }
function _now5(c){
  document.getElementById("an5Now")?.remove(); const host=document.getElementById("assist"); if(!host||!c||!c.glucose||c.glucose.length<50) return;
  if(Date.now()-c.glucose[c.glucose.length-1].ts>20*_M5) return;
  // ketonen, pod, nacht, alcohol en sport komen als moment (js/moments.js); hier alleen een vergeten profielpercentage
  let a=null; try{ const p=_one5(c,_a29); if(p&&p.long) a=p; }catch(_){}
  if(!a) return;
  const el=document.createElement("button"); el.type="button"; el.id="an5Now"; el.className="imoment an5now";
  el.innerHTML=`<span class="imk">${TL("NU","NOW","AGORA")}</span><b></b><p></p>`; el.querySelector("b").textContent=a.t; el.querySelector("p").textContent=a.v;
  el.onclick=()=>{ showTab("inzicht"); setTimeout(()=>openAn5(a.id),50); };
  host.prepend(el);
}

/* analyse 28 in de momenten: verrijkt de factoren van _momFactors (ida4) */
function _facEnrich5(c, m, F){
    let E=[]; try{ E=idaFactors5(c); }catch(_){ return F; }
    const at=m.ts, byId=Object.fromEntries(E.map(e=>[e.id,e]));
    const defs=_factorDefs5(c), active=new Set(defs.filter(d=>d.w.some(w=>w.a<=at&&w.b>at)).map(d=>d.id));
    // bestaande factoren verrijken met het effect bij jou
    for(const f of F){ if(f.k&&byId[f.k]&&active.has(f.k)){ const e=byId[f.k]; f.txt+=" "+_facLine5(e).replace(/^./,x=>x.toUpperCase())+"."; if(e.known) f.w=Math.max(f.w,Math.abs(e.dTir)>=0.2||e.dTbr>=0.04?3:2); else if(e.enough&&!f.tip) f.drop=1; } }
    const have=new Set(F.map(f=>f.k).filter(Boolean));
    const extra={ tt:TL("Tijdelijke streefwaarde actief.","Temporary target active.","Alvo temporário ativo."), pct:TL("Profielpercentage ≠ 100% actief.","Profile percentage ≠ 100% active.","Percentagem ativa."),
      warmte:TL("Warmte gelogd (sauna/heet bad).","Heat logged (sauna/hot bath).","Calor registado."), prednison:TL("Prednison-kuur.","Prednisone course.","Prednisona."), nacht:TL("Na een korte nacht.","After a short night.","Após noite curta."),
      nalaag:TL("Laagte in de 24 uur ervoor.","Low in the previous 24 hours.","Baixa nas 24 h anteriores."), weekend:TL("Weekend.","Weekend.","Fim de semana.") };
    const tips={ warmte:TL("Bij warmte neemt insuline sneller op: eet iets kleins vooraf of zet een tijdelijke streefwaarde.","Heat speeds up insulin: eat a small snack first or set a temporary target.","Calor acelera a insulina."),
      nalaag:TL("Na een laagte voel je de volgende minder: eet bij twijfel eerder iets.","After a low you feel the next one less: eat something earlier when in doubt.","Após uma baixa sente menos a seguinte."),
      prednison:TL("Prednison geeft vanaf de middag hogere waarden; een hoger profielpercentage tijdens de kuur helpt.","Prednisone raises glucose from the afternoon; a higher profile percentage during the course helps.","Prednisona sobe à tarde.") };
    for(const id of Object.keys(extra)){ if(!active.has(id)||have.has(id)) continue; const e=byId[id];
      if((id==="weekend"||id==="tt")&&!(e&&e.known)) continue;
      if(e&&e.enough&&!e.known&&!tips[id]) continue;   // bij jou geen verschil: niet noemen
      const pct=id==="pct"?(_pcts5(c).find(x=>x.a<=at&&x.b>at)||{}).p:null;
      F.push({ k:id, w:e&&e.known?(Math.abs(e.dTir)>=0.2||e.dTbr>=0.04?3:2):1, txt:(pct?TL(`Profielpercentage ${pct}% actief.`,`Profile percentage ${pct}% active.`,`Percentagem ${pct}%.`):extra[id])+(e?" "+_facLine5(e).replace(/^./,x=>x.toUpperCase())+".":""),
        tip:(m.k==="lo"||id==="prednison")&&tips[id]?tips[id]:null }); }
    return F;
}
(function(){ const el=document.getElementById("inCycle"); if(!el) return; el.addEventListener("change",()=>{ cfg.cycle=el.checked; saveCfg(); }); })();

/* ── losse analyses op aanvraag (snel, zonder alles door te rekenen) ── */
function _one5(c, fn){ c._one5=c._one5||{}; const k=fn.name; if(!(k in c._one5)){ try{ c._one5[k]=fn(c); }catch(e){ console.error(e); c._one5[k]=null; } } return c._one5[k]; }

/* ── Profiel: waarom dit voorstel (max 3 regels uit de analyses) ── */
function _profWhy5(c){
  const h=document.getElementById("profBody"); if(!h||h.querySelector(".an5why")) return;
  const L=[], C=_P&&_P.careful;
  if(C&&C.on) L.push(["let",C.low48?TL(`Voorzichtige stand: laagte op ${_dateL5(C.low48)} ${_hm5(C.low48)}. Tot 48 uur erna wordt niets strakker.`,`Cautious mode: low on ${_dateL5(C.low48)} ${_hm5(C.low48)}. Nothing gets tighter for 48 hours after.`,`Modo cauteloso.`):TL(`Voorzichtige stand: ${_p5(C.tbr)} onder 3,9. Het voorstel zet halve stappen.`,`Cautious mode: ${_p5(C.tbr)} below 3.9. The proposal takes half steps.`,`Modo cauteloso.`),"voorzichtig"]);
  const a3=_one5(c,_a3); if(a3&&a3.s==="let") L.push(["let",a3.v+" "+TL("Daarom past IDA je KH-ratio voorzichtig aan.","That's why IDA adjusts your carb ratio cautiously.",""),"loggen"]);
  const a4=_one5(c,_a4); if(a4&&a4.s==="let") L.push(["let",a4.v,"loopmaal"]);
  const a17=_one5(c,_a17); if(a17&&a17.s==="let") L.push(["info",a17.v+" "+TL("Het ochtendblok gaat daarom een uur eerder omhoog.","So the morning block goes up an hour earlier.",""),"dawn"]);
  const a29=_one5(c,_a29); if(a29&&a29.long) L.push(["let",a29.v,"aaps"]);
  try{ const fx=_fixedHtml5(c); if(fx&&!h.querySelector(".an5fix")){ const d=document.createElement("div"); d.innerHTML=fx; const s2=d.firstElementChild; const pacts=h.querySelector(".pacts"); if(pacts) pacts.before(s2); else h.appendChild(s2); } }catch(e){ console.error(e); }
  if(!L.length) return;
  const sec=document.createElement("section"); sec.className="ibox an5why";
  sec.innerHTML=`<span class="ilabel">${TL("Waarom","Why","Porquê")}</span>${L.slice(0,3).map(([st,t,id])=>`<button type="button" class="an5wl" data-an5open="${id}"><span class="an5d ${st}"></span><span>${esc(t)}</span><span class="irc" aria-hidden="true">›</span></button>`).join("")}`;
  const chg=h.querySelector(".ibox.chg"); if(chg) chg.after(sec); else h.prepend(sec);
  sec.querySelectorAll("[data-an5open]").forEach(b=>b.onclick=()=>{ showTab("inzicht"); setTimeout(()=>openAn5(b.dataset.an5open),50); });
}

/* ── Voortgang: nieuw deze week (patronen die bij geen moment horen) ── */
const _NEWIDS5=["loggen","telfout","vuist","14d","episodes","variab","gemist","laat","weekend","trend","hba1c","plaats","podnieuw","podfalen","meldingen","nalaag","hypobeh","dawn","sport","alcohol","slaap","warmte","cyclus","gold"];
function _new5(){
  const top=document.getElementById("teamTop"); if(!top||!_ctx||!_ctx.glucose||!_ctx.glucose.length) return;
  document.getElementById("an5New")?.remove();
  const A=idaAn(_ctx); let seen={}; try{ seen=JSON.parse(localStorage.getItem("ida.an5new")||"{}"); }catch(_){}
  const now=Date.now(), lets=A.filter(a=>a.s==="let"&&_NEWIDS5.includes(a.id));
  for(const k of Object.keys(seen)) if(!lets.some(a=>a.id===k)) delete seen[k];   // weer in orde: volgende keer opnieuw "nieuw"
  for(const a of lets) if(!seen[a.id]) seen[a.id]=now;
  try{ localStorage.setItem("ida.an5new",JSON.stringify(seen)); }catch(_){}
  const fresh=lets.filter(a=>now-seen[a.id]<7*_D5).sort((a,b)=>seen[b.id]-seen[a.id]).slice(0,3);
  // eten loggen blijft altijd zichtbaar zolang het speelt
  const log=lets.find(a=>a.id==="loggen"); if(log&&!fresh.includes(log)) fresh.unshift(log);
  if(!fresh.length) return;
  const sec=document.createElement("section"); sec.id="an5New"; sec.className="ibox an5why";
  sec.innerHTML=`<span class="ilabel">${TL("Uit je analyses","From your analyses","Das análises")}</span>${fresh.slice(0,3).map(a=>`<button type="button" class="an5wl" data-an5open="${a.id}"><span class="an5d let"></span><span><b>${esc(a.t)}</b> ${esc(a.v)}</span><span class="irc" aria-hidden="true">›</span></button>`).join("")}`;
  top.after(sec);
  sec.querySelectorAll("[data-an5open]").forEach(b=>b.onclick=()=>{ showTab("inzicht"); setTimeout(()=>openAn5(b.dataset.an5open),50); });
}

/* ── momenten: wat de analyses over dít moment zeggen ── */
/* wat de losse analyses over dít moment zeggen */
function _anEnrich5(c, m, F){
    const add=f=>{ if(!F.some(x=>x.k===f.k)) F.push(f); };
    try{
      const dp=_dp5(m.ts), N=_DPN5(), E=TL("E","U","U"), hr=Math.floor(todMin(m.ts)/60);
      if(m.k==="meal"){
        try{ const f=idaFixedMeals5(c).find(f=>todMin(m.ts)>=f.from&&todMin(m.ts)<=f.to&&Math.abs(m.g-f.g)<=Math.max(5,f.g*0.2));
          if(f) add({ k:"vast", w:1, txt:TL(`Je vaste ${f.name.toLowerCase()} (${f.g} g, ${f.days} dagen in 45).`,`Your regular ${f.name.toLowerCase()} (${f.g} g, ${f.days} days in 45).`,`Refeição habitual.`), tip:f.under?TL(`Je vaste ${f.name.toLowerCase()} stijgt meestal ${_n5(f.rise)}: weeg hem één keer, dan weet je wat je echt invoert.`,`Your regular ${f.name.toLowerCase()} usually rises ${_n5(f.rise)}: weigh it once, so you know what you really enter.`,`Pese uma vez.`):TL(`Zet hem als QuickWizard in AAPS (${f.g} g, ${fmtMin(f.from)}–${fmtMin(f.to)}): één tik voor koolhydraten en bolus.`,`Add it as QuickWizard in AAPS (${f.g} g, ${fmtMin(f.from)}–${fmtMin(f.to)}): one tap for carbs and bolus.`,`QuickWizard no AAPS.`) }); }catch(_){}
        const a4=_one5(c,_a4), r4=a4&&a4.s==="let"&&m.smb>=1?(a4.f||[]).find(r=>r[0].toLowerCase()===N[dp]):null;
        if(r4) add({ k:"an4", w:2, txt:TL(`Na je ${N[dp]}maaltijd geeft de loop gemiddeld ${r4[1]} SMB bij in 4 uur.`,`After your ${N[dp]} meal the loop adds ${r4[1]} SMB on average in 4 hours.`,`O loop dá ${r4[1]} após comer.`), tip:TL("Voer alles in wat je eet, ook kleine dingen; dan hoeft de loop niet in te halen.","Enter everything you eat, small things too; then the loop doesn't have to catch up.","Registe tudo o que come.") });
        const a5=_one5(c,_a5); if(a5&&m.peak>HI_T){ const lab=m.g<40?"< 40 g":m.g<70?"40–70 g":"> 70 g", row=(a5.f||[]).find(r=>r[0]===lab); const v=row?parseInt(row[1]):NaN; if(v>115) add({ k:"an5", w:2, txt:TL(`Bij maaltijden van ${lab} komt bij jou ${v}% terug van wat je invoert.`,`For ${lab} meals ${v}% of what you enter comes back for you.`,`${v}% volta.`), tip:TL("Schat dit soort maaltijden ruimer, of weeg ze een paar keer.","Estimate this kind of meal more generously, or weigh it a few times.","Estime com mais margem.") }); }
        const a13=_one5(c,_a13); if(a13&&a13.s==="let"&&m.tPeak>180){ const row=(a13.f||[]).find(r=>r[0].toLowerCase()===N[dp]); if(row) add({ k:"an13", w:2, txt:TL(`Piek pas na ${Math.round(m.tPeak/60*10)/10} uur; bij je ${N[dp]} gebeurt dat vaker (${row[1]}).`,`Peak only after ${Math.round(m.tPeak/60*10)/10} hours; at your ${N[dp]} this happens more often (${row[1]}).`,`Pico tardio.`), tip:TL("Geef bij dit soort maaltijden een deel van de bolus 1–2 uur later.","For this kind of meal give part of the bolus 1–2 hours later.","Parte do bólus 1–2 h depois.") }); }
      } else if(m.k==="lo"){
        const a22=_one5(c,_a22); if(a22&&a22.s==="let"&&m.rebound!=null&&m.rebound>HI_T) add({ k:"an22", w:2, txt:TL(`${a22.v.split(";")[0].replace(/\.$/,"")}.`,`${a22.v.split(";")[0].replace(/\.$/,"")}.`,`Sobretrata com frequência.`), tip:TL("Met de loop heb je minder nodig: 5 g per 5 minuten, of de helft van wat je gewend bent.","With the loop you need less: 5 g every 5 minutes, or half of what you're used to.","Com o loop precisa de menos.") });
        if(hr<7||hr>=23){ const t23=m.ts-((todMin(m.ts)-1380+1440)%1440)*_M5; const NF=_nightFactors5(c,t23); if(NF.length>=2){ const nm={ iob:TL("veel actieve insuline","lots of active insulin",""), bolus:TL("bolus in de 3 uur ervoor","bolus in the 3 hours before",""), sport:TL("sport overdag","exercise that day",""), alcohol:TL("alcohol","alcohol",""), laag:TL("laagte overdag","low during the day",""), start:TL("onder 6,5 bij het slapen","below 6.5 at bedtime","") };
          add({ k:"an16", w:2, txt:TL(`Om 23 uur al ${NF.length} risicofactoren: ${NF.map(f=>nm[f]).join(", ")}.`,`At 23:00 already ${NF.length} risk factors: ${NF.map(f=>nm[f]).join(", ")}.`,`${NF.length} fatores às 23 h.`), tip:TL("Met zo'n avond: iets kleins eten voor het slapen of een tijdelijke streefwaarde voor de nacht.","On an evening like that: a small snack before bed or a temporary target for the night.","Coma algo antes de dormir.") }); } }
      } else {
        const bk=_anns5("maaltijd").find(a=>a.src==="rise"&&Math.abs(a.ts-m.ts)<=3*_H5);
        if(bk){ for(const f of F) if(/Geen koolhydraten gelogd|No carbs logged/.test(f.txt)) f.drop=1;
          add({ k:"achteraf", w:2, txt:bk.grams>0?TL(`Achteraf aangegeven: ~${bk.grams} g gegeten.`,`Added afterwards: ~${bk.grams} g eaten.`,`~${bk.grams} g indicado depois.`):TL("Achteraf aangegeven: niets gegeten.","Added afterwards: nothing eaten.","Nada comido."),
            tip:bk.grams>0?TL("Voer het eten vóór de bolus in; dan hoeft de loop niet in te halen.","Enter food before the bolus; then the loop doesn't have to catch up.","Registe antes do bólus."):null }); }
        const a19=_one5(c,_a19); const pf=_podFails5(c,m.ts-6*_H5).find(p=>p.ts<=(m.end||m.ts)+_H5&&p.end>=m.ts-_H5);
        if(pf) add({ k:"an19", w:3, txt:pf.why==="5u"?TL("Meer dan 5 uur boven 13,9: past bij een pod die niet goed werkte.","More than 5 hours above 13.9: fits a pod that wasn't working properly.","Pod com falha."):TL("Correcties zonder effect: past bij een pod die niet goed werkte.","Corrections without effect: fits a pod that wasn't working properly.","Pod com falha."), tip:TL("Bij dit beeld: pod vervangen en corrigeren met de pen.","With this picture: replace the pod and correct with a pen.","Troque o pod.") });
        if(m.peak>=14&&m.dur>=120) add({ k:"an1", w:2, txt:TL(`${Math.round(m.dur/60*10)/10} uur boven 10, piek ${_n5(m.peak)}.`,`${Math.round(m.dur/60*10)/10} hours above 10, peak ${_n5(m.peak)}.`,`Alta longa.`), tip:TL("Langer dan 2 uur boven 14: meet ketonen.","More than 2 hours above 14: check ketones.","Meça cetonas.") });
        if(hr>=4&&hr<9){ const a17=_one5(c,_a17); if(a17&&a17.s==="let") for(const f of F) if(/dawn/i.test(f.txt)&&!/nachten/.test(f.txt)) f.txt+=" "+a17.v.replace(/ \(mediaan.*$/,"").replace(/\.$/,"")+"."; }
      }
    }catch(e){ console.error(e); }
    return F;
}

/* ── Werkt het advies bij jou? ─────────────────────────────────────────
   Voor elk soort advies dat IDA geeft: vergelijk je eigen keren mét en zonder dat gedrag (laatste 90 dagen).
   "werkt" = duidelijk beter, "geen" = genoeg keren maar geen verschil (dan laat IDA het advies weg),
   "slechter" = slechter, "weinig" = te weinig keren om iets te zeggen. */
function _meals5(c){
  if(c._meals5) return c._meals5;
  const G=c.glucose, T=c.treatments||[], end=G[G.length-1].ts, out=[];
  const man=T.filter(t=>!t.isSMB&&t.insulin>=0.5).sort((a,b)=>a.ts-b.ts), carbs=T.filter(t=>t.carbs>=15&&t.ts>end-90*_D5).sort((a,b)=>a.ts-b.ts);
  for(const m of carbs){ if(!_U5(c,m.ts)) continue; if(carbs.some(x=>x!==m&&x.ts>m.ts&&x.ts<m.ts+3*_H5)) continue;
    const b=man.filter(x=>x.ts>=m.ts-45*_M5&&x.ts<=m.ts+60*_M5)[0]; if(!b) continue;
    const bg0=_bgAt5(G,m.ts), bgm=_bgAt5(G,m.ts-20*_M5), w=_slice5(G,m.ts,m.ts+4*_H5); if(bg0==null||w.length<30) continue;
    const peak=Math.max(...w.map(x=>x.bg)), min=Math.min(...w.map(x=>x.bg)), late=_slice5(G,m.ts+2*_H5,m.ts+5*_H5);
    const second=man.some(x=>x!==b&&x.ts>=m.ts+45*_M5&&x.ts<=m.ts+180*_M5&&!T.some(y=>y.carbs>0&&Math.abs(y.ts-x.ts)<=30*_M5));
    out.push({ ts:m.ts, g:m.carbs, off:(b.ts-m.ts)/_M5, bg0, slope:bgm!=null?(bg0-bgm)/20:null, rise:peak-bg0, low:min<LO_T, tarLate:late.length?late.filter(x=>x.bg>HI_T).length/late.length:null, second });
  }
  return (c._meals5=out);
}
function _cmp5(A, B, f, minN){ const a=A.map(f).filter(v=>v!=null), b=B.map(f).filter(v=>v!=null); return { na:a.length, nb:b.length, va:_avg5(a), vb:_avg5(b), ok:a.length>=(minN||6)&&b.length>=(minN||6) }; }
function idaAdvice5(c){
  if(c._adv5) return c._adv5;
  const M=_meals5(c), R=[], N=(n,nl,en)=>TL(`${n} ${nl}`,`${n} ${en}`,`${n}`);
  // 1 · bolus vooraf (niet bij een dalende start)
  { const S=M.filter(m=>!(m.bg0<7&&m.slope!=null&&m.slope<=-0.03)), r=_cmp5(S.filter(m=>m.off<=-5),S.filter(m=>m.off>-5),m=>m.rise), l=_cmp5(S.filter(m=>m.off<=-5),S.filter(m=>m.off>-5),m=>m.low?1:0);
    const d=r.vb-r.va, worse=l.ok&&l.va-l.vb>=0.05;
    R.push({ id:"prebolus", re:/vóór het eten|before eating/i, t:TL("Bolus vóór het eten","Bolus before eating","Bólus antes de comer"), ...r,
      verdict:!r.ok?"weinig":worse?"slechter":d>=1?"werkt":d<0.4?"geen":"twijfel",
      line:r.ok?TL(`Bij jou: met bolus vooraf stijg je ${_n5(r.va)}, zonder ${_n5(r.vb)} (${N(r.na,"tegen","vs")} ${r.nb} maaltijden).`,`For you: with a pre-bolus you rise ${_n5(r.va)}, without ${_n5(r.vb)} (${r.na} vs ${r.nb} meals).`,`Com bólus antes sobe ${_n5(r.va)}, sem ${_n5(r.vb)}.`)+(worse?TL(` Wel vaker laag (${_p5(l.va)} tegen ${_p5(l.vb)}).`,` But more lows (${_p5(l.va)} vs ${_p5(l.vb)}).`,""):""):"" }); }
  // 2 · dalend aan tafel: bolus pas bij de eerste hap
  { const S=M.filter(m=>m.bg0<7&&m.slope!=null&&m.slope<=-0.03), r=_cmp5(S.filter(m=>m.off>=-2),S.filter(m=>m.off<-2),m=>m.low?1:0,4);
    const d=r.vb-r.va;
    R.push({ id:"eerstehap", re:/eerste hap|first bite/i, safe:true, t:TL("Dalend aan tafel: bolus bij de eerste hap","Falling at the table: bolus at the first bite","A descer: bólus à 1.ª garfada"), ...r,
      verdict:!r.ok?"weinig":d>=0.1?"werkt":d<=-0.1?"slechter":"geen",
      line:r.ok?TL(`Bij jou: bolus bij de eerste hap gaf ${_p5(r.va)} laag erna, vooraf ${_p5(r.vb)} (${r.na} tegen ${r.nb} keer).`,`For you: bolus at the first bite gave ${_p5(r.va)} lows after, before ${_p5(r.vb)} (${r.na} vs ${r.nb} times).`,""):"" }); }
  // 3 · een laagte behandelen met hooguit 15 g
  { const G=c.glucose, T=c.treatments||[], E=_eps5(G.filter(x=>x.ts>G[G.length-1].ts-90*_D5),_isLo5), H=[];
    for(const e of E){ const g=T.filter(t=>t.carbs>0&&t.ts>=e.start-10*_M5&&t.ts<=e.start+40*_M5).reduce((s,t)=>s+t.carbs,0); if(!g) continue; const a=_slice5(G,e.end,e.end+150*_M5); if(!a.length) continue; H.push({ g, reb:Math.max(...a.map(x=>x.bg))>HI_T?1:0 }); }
    const r=_cmp5(H.filter(h=>h.g<=15),H.filter(h=>h.g>15),h=>h.reb,4), d=r.vb-r.va;
    R.push({ id:"hypo15", re:/15 g|5 g per 5|5 g every 5/i, safe:true, t:TL("Laagte: hooguit 15 g, dan wachten","Low: at most 15 g, then wait","Baixa: até 15 g"), ...r,
      verdict:!r.ok?"weinig":d>=0.15?"werkt":d<=-0.15?"slechter":"geen",
      line:r.ok?TL(`Bij jou: met ≤ 15 g schoot je ${_p5(r.va)} door boven 10, met meer ${_p5(r.vb)} (${r.na} tegen ${r.nb} keer).`,`For you: with ≤ 15 g you overshot above 10 ${_p5(r.va)}, with more ${_p5(r.vb)} (${r.na} vs ${r.nb} times).`,""):"" }); }
  // 4 · een deel van de bolus later
  { const S=M.filter(m=>m.g>=40), r=_cmp5(S.filter(m=>m.second),S.filter(m=>!m.second),m=>m.tarLate,4), d=r.vb-r.va;
    R.push({ id:"split", re:/1–2 uur later|1–2 hours later/i, t:TL("Bij vet of grote maaltijden een deel later","Part of the bolus later for fatty or large meals","Parte do bólus depois"), ...r,
      verdict:!r.ok?"weinig":d>=0.1?"werkt":d<0.03?"geen":"twijfel",
      line:r.ok?TL(`Bij jou: met een tweede bolus 2–5 uur na eten ${_p5(r.va)} boven 10, zonder ${_p5(r.vb)} (${r.na} tegen ${r.nb} maaltijden).`,`For you: with a second bolus 2–5 h after eating ${_p5(r.va)} above 10, without ${_p5(r.vb)} (${r.na} vs ${r.nb} meals).`,""):"" }); }
  // 5 · tijdelijke streefwaarde vóór sport
  { const S=_anns5("sport"), tts=_tts5(c).filter(x=>!_ttAuto5(x)), G=c.glucose;
    const X=S.map(a=>({ tt:tts.some(x=>x.a>=a.ts-150*_M5&&x.a<=a.ts+15*_M5), low:_slice5(G,a.ts,a.ts+((+a.dur||60)+240)*_M5).some(x=>x.bg<LO_T)?1:0 }));
    const r=_cmp5(X.filter(x=>x.tt),X.filter(x=>!x.tt),x=>x.low,3), d=r.vb-r.va;
    R.push({ id:"sporttt", re:/streefwaarde.*sport|vóór het sporten|before exercise/i, safe:true, t:TL("Streefwaarde vóór het sporten","Target before exercise","Alvo antes do exercício"), ...r,
      verdict:!r.ok?"weinig":d>=0.15?"werkt":d<=-0.15?"slechter":"geen",
      line:r.ok?TL(`Bij jou: met streefwaarde vooraf ${_p5(r.va)} van de keren laag, zonder ${_p5(r.vb)}.`,`For you: with a target beforehand low ${_p5(r.va)} of the time, without ${_p5(r.vb)}.`,""):"" }); }
  // 6 · alles invoeren: weken met meer ingevoerd tegenover minder
  { const G=c.glucose, T=c.treatments||[], end=G[G.length-1].ts, W=[];
    for(let w=0; w<12; w++){ const a=end-(w+1)*7*_D5, b=end-w*7*_D5; const ks=new Set([...(c.q.usableKeys||[])].filter(k=>{ const t=Date.parse(k+"T12:00:00"); return t>=a&&t<b; })); if(ks.size<4) continue;
      const g=T.filter(t=>t.carbs>0&&ks.has(_dk5(t.ts))).reduce((s,t)=>s+t.carbs,0)+_anns5("maaltijd").filter(x=>x.grams>0&&ks.has(_dk5(x.ts))).reduce((s,x)=>s+x.grams,0);
      W.push({ g:g/ks.size, tir:_stat5(G.filter(x=>ks.has(_dk5(x.ts)))).tir }); }
    const md=_med5(W.map(x=>x.g)), r=_cmp5(W.filter(x=>x.g>md),W.filter(x=>x.g<=md),x=>x.tir,3), d=r.va-r.vb;
    R.push({ id:"loggen", re:/Voer alles in|Enter everything|Leg het vast|Log it/i, safe:true, t:TL("Alles invoeren wat je eet","Enter everything you eat","Registar tudo"), ...r,
      verdict:!r.ok?"weinig":d>=0.05?"werkt":d<=-0.05?"slechter":"geen",
      line:r.ok?TL(`Bij jou: in weken met meer ingevoerd ${_p5(r.va)} in bereik, met minder ${_p5(r.vb)}.`,`For you: in weeks with more entered ${_p5(r.va)} in range, with less ${_p5(r.vb)}.`,""):"" }); }
  return (c._adv5=R);
}
// Gebruikt door _momTips4 (ida4): onderbouw een tip met je eigen uitkomst, of laat hem weg als hij bij jou niets doet.
function _tipEvidence5(c, tip){
  let A=[]; try{ A=idaAdvice5(c); }catch(e){ console.error(e); return { tip }; }
  const a=A.find(x=>x.re.test(tip)); if(!a) return { tip };
  if(a.verdict==="geen"&&!a.safe) return { drop:true, a };
  if(a.verdict==="werkt"||a.verdict==="slechter") return { tip:tip+" "+a.line.replace(/ \([^)]*(maaltijden|keer|meals|times)\)/,""), a };
  return { tip, a };
}
function _advView5(){
  const top=document.getElementById("teamTop"); if(!top||!_ctx||!_ctx.glucose||!_ctx.glucose.length) return;
  document.getElementById("an5Adv")?.remove();
  const A=idaAdvice5(_ctx).filter(a=>a.verdict!=="weinig"); if(!A.length) return;
  const lab={ werkt:TL("werkt bij jou","works for you","funciona"), geen:TL("geen verschil","no difference","sem diferença"), slechter:TL("pakt slechter uit","turns out worse","pior"), twijfel:TL("klein verschil","small difference","pequena diferença") };
  const cls={ werkt:"ok", geen:"leeg", slechter:"let", twijfel:"info" };
  const sec=document.createElement("section"); sec.id="an5Adv"; sec.className="ibox an5why";
  sec.innerHTML=`<span class="ilabel">${TL("Wat werkt bij jou","What works for you","O que funciona")}</span>${A.map(a=>`<div class="an5wl"><span class="an5d ${cls[a.verdict]}"></span><span><b>${esc(a.t)}</b> · ${lab[a.verdict]}<br><i class="an5sub">${esc(a.line)}</i></span></div>`).join("")}
    <p class="an5src">${TL("Je eigen keren mét en zonder dit gedrag, laatste 90 dagen. Advies zonder verschil laat IDA bij je momenten weg (behalve veiligheid).","Your own times with and without this behaviour, last 90 days. Advice without a difference is dropped from your moments (except safety).","Últimos 90 dias.")}</p>`;
  const after=document.getElementById("an5New")||top; after.after(sec);
}

/* ── Vaste maaltijden → AAPS QuickWizard ────────────────────────────────
   Wat je vaak eet (zelfde dagdeel, ongeveer dezelfde grammen, ≥ 5 dagen in 45 dagen) wordt een knop in AAPS:
   QuickWizard legt koolhydraten én bolus in één tik vast, op het tijdstip waarvoor hij geldt.
   IDA geeft geen dosis: AAPS rekent de bolus met je eigen KH-ratio. */
function idaFixedMeals5(c){
  if(c._fix5) return c._fix5;
  const T=c.treatments||[], end=c.glucose[c.glucose.length-1].ts;
  const E=T.filter(t=>t.carbs>=10&&t.ts>end-45*_D5).map(t=>({ ts:t.ts, g:t.carbs, src:"aaps" }))
    .concat(_anns5("maaltijd").filter(a=>a.grams>0&&a.ts>end-45*_D5).map(a=>({ ts:a.ts, g:a.grams, src:"achteraf" })));
  const parts=[["ontbijt",300,660,TL("Ontbijt","Breakfast","Pequeno-almoço")],["lunch",660,960,TL("Lunch","Lunch","Almoço")],["avond",960,1380,TL("Avondeten","Dinner","Jantar")],["snack",0,1440,TL("Tussendoortje","Snack","Lanche")]];
  const out=[], used=new Set();
  for(const [id,a,b,name] of parts){
    const P=E.filter(e=>!used.has(e)&&todMin(e.ts)>=a&&todMin(e.ts)<b&&(id!=="snack"||e.g<=25));
    // dichtste groep grammen (±20% rond een middenwaarde)
    let best=null; for(const p of P){ const grp=P.filter(q=>Math.abs(q.g-p.g)<=Math.max(5,p.g*0.2)); const days=new Set(grp.map(q=>_dk5(q.ts))).size;
      if(days>=5&&(!best||days>best.days)) best={ grp, days }; }
    if(!best) continue; best.grp.forEach(q=>used.add(q));
    const ms=best.grp.map(q=>todMin(q.ts)).sort((x,y)=>x-y), q=p=>ms[Math.min(ms.length-1,Math.max(0,Math.round((ms.length-1)*p)))];
    const r15=v=>Math.round(v/15)*15, from=Math.max(0,r15(q(0.1))-30), to=Math.min(1439,r15(q(0.9))+30);
    const g=Math.round(_med5(best.grp.map(q=>q.g))/5)*5, back=best.grp.filter(q=>q.src==="achteraf").length;
    const pre=_preFor(c, best.grp[0].ts);
    // hoe het bij deze maaltijd afliep (uit je echte maaltijden)
    const M=_meals5(c).filter(m=>todMin(m.ts)>=a&&todMin(m.ts)<b&&Math.abs(m.g-g)<=Math.max(5,g*0.2));
    const rise=_med5(M.map(m=>m.rise));
    out.push({ id, name, g, from, to, days:best.days, n:best.grp.length, back, pre, rise, low:M.length?M.filter(m=>m.low).length/M.length:null, nm:M.length, under:M.length>=4&&rise!=null&&rise>=5 });
  }
  return (c._fix5=out);
}
function _fixedHtml5(c){
  let F=[]; try{ F=idaFixedMeals5(c); }catch(e){ console.error(e); } if(!F.length) return "";
  return `<section class="ibox an5fix"><span class="ilabel">${TL("Vaste maaltijden als knop in AAPS","Regular meals as a button in AAPS","Refeições habituais no AAPS")}</span>
    <p class="an5note">${TL("Deze eet je vaak. Zet ze als QuickWizard in AAPS: dan leg je koolhydraten én bolus in één tik vast, en vergeet je niets in te voeren.","You eat these often. Add them as QuickWizard in AAPS: then you log carbs and bolus in one tap, and nothing gets forgotten.","Adicione-as como QuickWizard no AAPS.")}</p>
    ${F.map(f=>`<div class="an5fx"><b>${esc(f.name)}</b><span class="an5fxv">${f.g} g · ${fmtMin(f.from)}–${fmtMin(f.to)}</span>
      <i>${TL(`${f.days} dagen in 45`,`${f.days} days in 45`,`${f.days} dias`)}${f.back?TL(`, ${f.back}× achteraf aangegeven`,`, ${f.back}× added afterwards`,""):""}${f.pre?TL(` · bolus ${f.pre.lo}–${f.pre.hi} min vooraf`,` · bolus ${f.pre.lo}–${f.pre.hi} min ahead`,` · bólus ${f.pre.lo}–${f.pre.hi} min antes`):""}${f.nm>=4&&f.rise!=null?TL(` · stijgt meestal ${_n5(f.rise)}`,` · usually rises ${_n5(f.rise)}`,""):""}</i>${f.under?`<i class="an5warn">${TL(`Stijgt meestal ${_n5(f.rise)}: waarschijnlijk zit er meer in dan ${f.g} g. Weeg hem één keer en zet dát in de QuickWizard.`,`Usually rises ${_n5(f.rise)}: probably more than ${f.g} g. Weigh it once and put that in the QuickWizard.`,`Provavelmente mais de ${f.g} g.`)}</i>`:""}</div>`).join("")}
    <p class="an5src">${TL("AAPS › Overzicht › QuickWizard (of Instellingen › QuickWizard) › +: naam, koolhydraten, geldig van–tot. De bolus rekent AAPS zelf met je KH-ratio.","AAPS › Overview › QuickWizard (or Preferences › QuickWizard) › +: name, carbs, valid from–to. AAPS calculates the bolus with your carb ratio.","AAPS › QuickWizard › +.")}</p></section>`;
}

// Node-unit-tests voor de rekenkern (js/core.js), zonder browser. Draai: node test/unit.mjs
import vm from 'node:vm'; import fs from 'node:fs'; import assert from 'node:assert/strict';
const core=fs.readFileSync(new URL('../js/core.js',import.meta.url),'utf8');
const pre=`
const cfg={peak:75,lang:"nl"}; let LANG="nl"; const I18N={};
const TL=(nl,en,pt)=>nl; const t=k=>k; const DECSEP=()=>","; const esc=s=>String(s);
const document={documentElement:{}}; const getComputedStyle=()=>({getPropertyValue:()=>""});
const indexedDB={open(){throw new Error("geen idb")}}; const localStorage={getItem(){return null},setItem(){}};
`;
const post=`;({metrics,localDayKey,todMin,fmtMin,loopBasal,smbISF,applyGuardrails,guardrailStats,DAYPARTS,toMgdl,mmol,bandOf,_pMed,_pMean})`;
const ctx=vm.createContext({console,Intl,Date,Math,Map,Set,Promise,JSON,Object,Array,Number,String,RegExp,parseFloat,isFinite,setTimeout,navigator:{}});
const X=vm.runInContext(pre+core+post,ctx);
let n=0; const T=(name,f)=>{try{f();n++;console.log('OK  ',name)}catch(e){console.log('FAIL',name,'\n',e.message);process.exitCode=1}};
const H=36e5, base=Date.UTC(2026,10,10,0,0); // 10 nov 2026, 00:00 UTC = 01:00 Amsterdam
const series=(days,f)=>{const o=[];for(let d=0;d<days;d++)for(let i=0;i<288;i++){const ts=base+d*24*H+i*5*60e3;o.push({ts,bg:f(ts,d,i)});}return o;};

T('metrics: TIR/TBR/TAR kloppen op bekende verdeling',()=>{
  const g=[...Array(80).fill(6),...Array(10).fill(3.5),...Array(10).fill(12)].map((bg,i)=>({ts:base+i*3e5,bg}));
  const m=X.metrics(g); assert.equal(m.n,100); assert.ok(Math.abs(m.tir-.8)<1e-9); assert.ok(Math.abs(m.tbr-.1)<1e-9); assert.ok(Math.abs(m.tar-.1)<1e-9);
  assert.ok(Math.abs(m.titr-.8)<1e-9); });
T('metrics: GMI formule',()=>{ const m=X.metrics([{ts:base,bg:7},{ts:base+1,bg:7}]); assert.ok(Math.abs(m.gmi-(3.31+0.02392*X.toMgdl(7)))<1e-9); assert.equal(m.cv,0); });
T('tijd: Amsterdam-lokale tijd en fmtMin',()=>{ assert.equal(X.todMin(Date.UTC(2026,10,10,0,0)),60); assert.equal(X.fmtMin(75),'01:15'); assert.equal(X.localDayKey(Date.UTC(2026,10,10,23,30)),'2026-11-11'); });
T('_pMed/_pMean',()=>{ assert.equal(X._pMed([3,1,2]),2); assert.equal(X._pMean([1,2,3]),2); assert.equal(X._pMed([]),null); });
T('loopBasal: zonder profiel / te weinig temps',()=>{
  assert.equal(X.loopBasal([],null,{}).noprof,true);
  assert.equal(X.loopBasal([],{},{from:0,to:1e12,usableKeys:null}).few,0); });
const mk=(over)=>{const g=series(20,(ts)=>{const m=X.todMin(ts);return (m<360&&over)?3.4:6;});
  const keys=new Set(g.map(x=>X.localDayKey(x.ts))); return {g,q:{usableKeys:keys}};};
const item=(from,to)=>({key:'basaal',rows:[{dpKey:'nacht',cands:[{from,to,tag:'gemeten'}],pre:[]}]});
T('guardrail: basaal omhoog met 10% laagtes in nacht → geblokkeerd',()=>{
  const {g,q}=mk(true); const r=X.applyGuardrails([item('0.80','0.88')],g,q).at(0).rows[0]; assert.equal(r.blocked,true); });
T('guardrail: zelfde voorstel zonder laagtes → niet geblokkeerd',()=>{
  const {g,q}=mk(false); const r=X.applyGuardrails([item('0.80','0.88')],g,q).at(0).rows[0]; assert.equal(r.blocked,false); assert.equal(r.unclear,false); });
T('guardrail: basaal OMLAAG bij laagtes → niet geblokkeerd',()=>{
  const {g,q}=mk(true); const r=X.applyGuardrails([item('0.80','0.72')],g,q).at(0).rows[0]; assert.equal(r.blocked,false); });
T('guardrail: <14 dagen → onduidelijk',()=>{
  const g=series(8,()=>6), q={usableKeys:new Set(g.map(x=>X.localDayKey(x.ts)))}; const r=X.applyGuardrails([item('0.80','0.84')],g,q).at(0).rows[0]; assert.equal(r.unclear,true); });
T('guardrail: stap >10% geeft waarschuwing',()=>{
  const {g,q}=mk(false); const r=X.applyGuardrails([item('0.80','0.95')],g,q).at(0).rows[0]; assert.ok(r.gr.some(x=>x.lvl==='warn')); });
T('guardrail: één wijziging per dagdeel (tweede wacht)',()=>{
  const {g,q}=mk(false); const it=[item('0.80','0.84'),{key:'ic',rows:[{dpKey:'nacht',cands:[{from:'5',to:'4.8',tag:'gemeten'}],pre:[]}]}];
  const out=X.applyGuardrails(it,g,q); assert.equal(out.find(x=>x.key==='ic').rows[0].queued,true); });
T('smbISF: te weinig vensters → alleen n',()=>{ const r=X.smbISF(series(2,()=>9),[],null,null); assert.equal(r.n,0); assert.equal(r.med,undefined); });
T('smbISF: koolhydraatvrije SMB-vensters met daling geven mediaan',()=>{
  const g=series(20,(ts,d,i)=>{const m=i%96; return m<12?10:(m<36?10-(m-12)*0.1:7.6)}); // elke 8 u: start 10, daalt ~2.4
  const tr=[]; for(let d=0;d<20;d++)for(let k=0;k<3;k++) tr.push({ts:base+d*24*H+k*8*H,insulin:1,isSMB:true,carbs:0});
  const r=X.smbISF(g,tr,null,null); assert.ok(r.n>=12,'n='+r.n); assert.ok(r.med>0,'med='+r.med); });
console.log(`\n${n} tests geslaagd`); 

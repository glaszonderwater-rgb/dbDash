// Nieuwe meldingen (v42): ketonen, pod, eten na laagte, nacht, ochtend na alcohol, sport, uitzetten.
import { createRequire } from 'module'; const require=createRequire(import.meta.url);
const { idaMoments } = require('../server/moments.cjs');
const MIN=60e3,H=60*MIN,DAY=24*H; let fail=0; const ok=(c,m)=>{ if(!c){ fail++; console.log('FOUT:',m); } };
const day0=Date.UTC(2026,10,10); const mk=(from,to,f)=>{ const g=[]; for(let t=from;t<=to;t+=5*MIN) g.push({ts:t,bg:f(t)}); return g; };
const kinds=(g,tr,o)=>idaMoments(g,tr,{tzOffsetMin:0,...o}).map(m=>m.kind);
// ketonen: 2,5 uur boven 14
let now=day0+15*H; let g=mk(now-6*H,now,t=>t>now-150*MIN?15.5:8); ok(kinds(g,[],{now}).includes('ketonen'),'ketonen na 2,5 u > 14');
g=mk(now-6*H,now,t=>t>now-60*MIN?15.5:8); ok(!kinds(g,[],{now}).includes('ketonen'),'geen ketonen na 1 u');
ok(kinds(g,[],{now,anns:[{type:'ziek',ts:now-5*H}]}).includes('ketonen'),'ketonen bij ziek na 1 u');
// pod: 5,5 uur boven 13,9
g=mk(now-8*H,now,t=>t>now-330*MIN?14.5:8); ok(kinds(g,[],{now}).includes('pod'),'pod na 5,5 u');
// pod: 2 correcties zonder daling
g=mk(now-8*H,now,t=>t>now-200*MIN?14.2:8); ok(kinds(g,[{ts:now-170*MIN,insulin:2,carbs:0},{ts:now-80*MIN,insulin:2,carbs:0}],{now}).includes('pod'),'pod na 2 correcties');
// mute
ok(!kinds(g,[{ts:now-170*MIN,insulin:2,carbs:0},{ts:now-80*MIN,insulin:2,carbs:0}],{now,mute:['pod']}).includes('pod'),'pod uitgezet');
// eten: 7,3 en dalend → alleen na een laagte in 24 u
const meals=[]; for(let d=1;d<=14;d++) meals.push({ts:day0-d*DAY+12*H+15*MIN,carbs:40,insulin:4});
now=day0+12*H+10*MIN; const fall=t=>7.3+(now-t)/MIN*0.05;
g=mk(now-12*H,now,fall); ok(!kinds(g,meals,{now,stats:null}).includes('eten'),'geen eetmelding bij 7,3 zonder laagte');
g=mk(now-12*H,now,t=>(t>now-10*H&&t<now-9*H)?3.4:fall(t)); ok(kinds(g,meals,{now,stats:null}).includes('eten'),'eetmelding bij 7,3 na laagte');
// nacht: 3 factoren om 23:00
now=day0+23*H; g=mk(now-8*H,now,()=>6.0); ok(kinds(g,[{ts:now-2*H,insulin:3,carbs:30}],{now,iob:3.5}).includes('nacht'),'nachtmelding bij 3 factoren');
ok(!kinds(g,[],{now,iob:3.5}).includes('nacht'),'geen nachtmelding bij 2 factoren');
// alcohol-ochtend
now=day0+7*H; g=mk(now-8*H,now,()=>6.5); ok(kinds(g,[],{now,anns:[{type:'alcohol',ts:day0-2*H}]}).includes('alcohol'),'ochtend na alcohol');
ok(!kinds(g,[],{now}).includes('alcohol'),'geen alcoholmelding zonder log');
// sport: elke dinsdag 18:00 → om 16:45
const anns=[1,2,3].map(w=>({type:'sport',ts:day0+7*H*0-w*7*DAY+18*H}));
now=day0+16*H+45*MIN; g=mk(now-6*H,now,()=>7); ok(kinds(g,[],{now,anns}).includes('sport'),'sportmelding 75 min vooraf');
now=day0+17*H+45*MIN; g=mk(now-6*H,now,()=>7); ok(!kinds(g,[],{now,anns}).includes('sport'),'geen sportmelding 15 min vooraf');
// stijging zonder eten: pas vanaf 4, met schatting en één-tik-antwoord
now=day0+15*H; const rise=d=>mk(now-6*H,now,t=>t<now-60*MIN?6:6+d*Math.min(1,(t-(now-60*MIN))/(45*MIN)));
ok(!kinds(rise(3.5),[],{now}).includes('vraag'),'geen vraag bij stijging 3,5');
const v=idaMoments(rise(5),[{ts:now-30*MIN,insulin:1,isSMB:true,carbs:0}],{now,tzOffsetMin:0,prof:{isf:2,ic:10}}).find(m=>m.kind==='vraag');
ok(v&&v.rise&&v.rise.grams===35,'schatting 5/(2/10)+1×10 = 35 g, kreeg '+(v&&v.rise&&v.rise.grams));
ok(!kinds(rise(5),[],{now,anns:[{type:'maaltijd',ts:now-70*MIN,grams:25}]}).includes('vraag'),'geen vraag als al beantwoord');
// ketonen hooguit 1× per dag (zelfde sleutel)
const k1=idaMoments(mk(now-6*H,now,t=>t>now-150*MIN?15.5:8),[],{now,tzOffsetMin:0}).find(m=>m.kind==='ketonen'), now2=now+6*H;
const k2=idaMoments(mk(now2-8*H,now2,t=>t>now2-150*MIN?15.5:8),[],{now:now2,tzOffsetMin:0}).find(m=>m.kind==='ketonen');
ok(k1&&k2&&k1.key===k2.key,'ketonen één sleutel per dag');
if(fail){ console.log(fail+' fout(en)'); process.exit(1); } console.log('moment5check OK');

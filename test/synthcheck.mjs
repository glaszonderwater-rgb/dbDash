import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=30,now=Date.now(),start=now-NDAYS*DAY;
function model(peak,dia){const td=Math.max(300,dia),tp=peak,tau=tp*(1-tp/td)/(1-2*tp/td),a=2*tau/td,S=1/(1-a+(1+a)*Math.exp(-td/tau));return {iob(t){if(t<=0)return 1;if(t>=td)return 0;return 1-S*(1-a)*((t*t/(tau*td*(1-a))-t/tau-1)*Math.exp(-t/tau)+1);}};}
const ISF=2,IC=10,DIA=360,mdl=model(75,DIA);
const entries=[],treatments=[],idx=new Map();
for(let t=start;t<now;t+=STEP){const d=new Date(t),h=d.getUTCHours()+d.getUTCMinutes()/60;let bg=6.5;bg+=(Math.random()-0.5)*0.5;const r={_id:'e'+t,date:t,dateString:d.toISOString(),sgv:0,type:'sgv',direction:'Flat'};r.bg=bg;entries.push(r);idx.set(t,entries.length-1);}
// vannacht (laatste dag ~03:00 lokale tijd ≈ 01:00 UTC): korte druk-dip
const todayStart=now-(now%DAY); const dipT=todayStart+1*3600e3;
for(const e of entries){
  if(e.date>=dipT && e.date<dipT+13*60e3) e.bg=3.3;                       // dip zelf (~2-3 punten)
  else if(e.date>=dipT-12*60e3 && e.date<dipT) e.bg=6.0;                  // steile instap
  else if(e.date>=dipT+13*60e3 && e.date<dipT+26*60e3) e.bg=6.0; }        // steil herstel
for(let day=start;day<now;day+=DAY){for(const [hh,carbs,ins] of [[6,50,3],[11,60,6],[18,70,7]]){const mt=day+hh*3600e3;treatments.push({_id:'t'+mt,created_at:new Date(mt).toISOString(),eventType:'Meal Bolus',carbs,insulin:ins});for(let tt=mt;tt<=mt+4*3600e3;tt+=STEP){const i=idx.get(tt);if(i==null)continue;const min=(tt-mt)/60000;entries[i].bg+=(ISF/IC)*carbs*(1-Math.exp(-min/45))-ISF*ins*(1-mdl.iob(min));}}
  const ct=day+14.5*3600e3;treatments.push({_id:'k'+ct,created_at:new Date(ct).toISOString(),eventType:'Correction Bolus',carbs:0,insulin:1.5});
  for(let tt=ct;tt<=ct+3*3600e3;tt+=STEP){const i=idx.get(tt);if(i==null)continue;const min=(tt-ct)/60000;entries[i].bg=11.0-2.6*1.5*(1-mdl.iob(min));}}
for(const e of entries){e.sgv=Math.round(Math.max(2.5,Math.min(18,e.bg))*MG);delete e.bg;}
treatments.push({_id:'psw',created_at:new Date(start+DAY).toISOString(),eventType:'Profile Switch',percentage:100,timeshift:0,profile:'Std',profileJson:JSON.stringify({dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]})});
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','30');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('secInsulin').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(600);
const r=await page.evaluate(()=>({
  nu:document.getElementById('nowVal').textContent+' '+document.getElementById('onboard').textContent,
  todaySub:document.getElementById('todaySub').textContent,
  findToday:[...document.querySelectorAll('#findToday .f .ftxt')].map(x=>x.textContent),
  findWeek:[...document.querySelectorAll('#findWeek .f .ftxt')].map(x=>x.textContent),
  kpis:[...document.querySelectorAll('#kpis .kpi .k')].map(k=>k.textContent.trim()),
  mvs:[...document.querySelectorAll('#tune .mvs tr')].map(tr=>tr.textContent.replace(/\s+/g,' ').trim()),
  consult:document.getElementById('consultList').textContent.slice(0,60),
  scrub:[...document.querySelectorAll('#tabbar .tab')].map(b=>b.textContent.trim()),
}));
console.log('NU:',r.nu);
console.log('vandaag-sub:',r.todaySub);
console.log('bevindingen vandaag:',r.findToday);
console.log('bevindingen week:',r.findWeek);
console.log('maand-kpis:',r.kpis.join(' | '));
r.mvs.forEach(x=>console.log('  mvs:',x));
console.log('consult:',r.consult);
console.log('scrubber:',r.scrub.join(' · '));
// triage: consultlijst-knop klikken
const btn=await page.$('[data-consult]');
if(btn){ await btn.click(); await page.waitForTimeout(300);
  const c2=await page.evaluate(()=>({n:document.getElementById('consultBadge').textContent,list:[...document.querySelectorAll('.citem span')].map(x=>x.textContent.slice(0,50))}));
  console.log('na → consultlijst: badge=',c2.n,'| items:',c2.list); }
console.log('errors:',errors.length?errors:'geen');
await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(200);
await page.screenshot({path:'/tmp/diametric-tests/synth-top.png'});
await page.screenshot({path:'/tmp/diametric-tests/synth-full.png',fullPage:true});
await browser.close();

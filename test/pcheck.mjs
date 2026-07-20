import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=30,now=Date.now(),start=now-NDAYS*DAY;
function model(peak,dia){const td=Math.max(300,dia),tp=peak,tau=tp*(1-tp/td)/(1-2*tp/td),a=2*tau/td,S=1/(1-a+(1+a)*Math.exp(-td/tau));return {iob(t){if(t<=0)return 1;if(t>=td)return 0;return 1-S*(1-a)*((t*t/(tau*td*(1-a))-t/tau-1)*Math.exp(-t/tau)+1);}};}
const ISF=2,IC=10,DIA=360,mdl=model(75,DIA);
const entries=[],treatments=[],idx=new Map();
for(let t=start;t<now;t+=STEP){const d=new Date(t),h=d.getUTCHours()+d.getUTCMinutes()/60;let bg=6.5;if(h>=2&&h<4)bg-=1.2;bg+=(Math.random()-0.5)*0.5;const r={_id:'e'+t,date:t,dateString:d.toISOString(),sgv:0,type:'sgv',direction:'Flat'};r.bg=bg;entries.push(r);idx.set(t,entries.length-1);}
for(let day=start;day<now;day+=DAY){for(const [hh,carbs,ins] of [[8,40,4],[13,60,6],[19,70,7]]){const mt=day+hh*3600e3;treatments.push({_id:'t'+mt,created_at:new Date(mt).toISOString(),eventType:'Meal Bolus',carbs,insulin:ins});for(let k=1;k<=3;k++){const st=mt+k*12*60e3;treatments.push({_id:'t'+st,created_at:new Date(st).toISOString(),eventType:'SMB',insulin:0.4,isSMB:true});}for(let tt=mt;tt<=mt+4*3600e3;tt+=STEP){const i=idx.get(tt);if(i==null)continue;const min=(tt-mt)/60000;entries[i].bg+=(ISF/IC)*carbs*(1-Math.exp(-min/50))-ISF*ins*(1-mdl.iob(min));}}
  // geïsoleerde ochtendcorrectie: verhoogde start, geen carbs, laat glucose ~ISF*U dalen
  const ct=day+2*3600e3;
  treatments.push({_id:'k'+ct,created_at:new Date(ct).toISOString(),eventType:'Correction Bolus',carbs:0,insulin:1.5});
  for(let tt=ct;tt<=ct+3*3600e3;tt+=STEP){const i=idx.get(tt);if(i==null)continue;const min=(tt-ct)/60000;entries[i].bg=10.5 - ISF*1.5*(1-mdl.iob(min));}
}
for(const e of entries){e.sgv=Math.round(Math.max(2.5,Math.min(18,e.bg))*MG);delete e.bg;}
// profielwissel met blokken (verschillende basaal/ISF/IC over de dag) + 90%
treatments.push({_id:'psw',created_at:new Date(start+DAY).toISOString(),eventType:'Profile Switch',percentage:100,timeshift:0,profile:'Werk',
  profileJson:JSON.stringify({dia:6,units:'mmol',basal:[{time:'00:00',value:0.80},{time:'03:00',value:1.05},{time:'06:00',value:0.95}],sens:[{time:'00:00',value:2.2},{time:'12:00',value:1.8}],carbratio:[{time:'00:00',value:11},{time:'12:00',value:9}]})});
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',async route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','30');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('secProfile').hidden||document.getElementById('fatalBar'),{timeout:40000}).catch(()=>{});
await page.waitForTimeout(400);
const r=await page.evaluate(()=>({vis:!document.getElementById('secProfile').hidden,
  kpis:[...document.querySelectorAll('#profile .kpi')].map(k=>k.querySelector('.k').textContent+'='+k.querySelector('.v').textContent),
  cols:[...document.querySelectorAll('#profile .pcol')].map(c=>({h:c.querySelector('.ph').textContent, rows:[...c.querySelectorAll('.prow')].map(x=>x.textContent.replace(/\s+/g,' ').trim())})),
  obs:document.querySelector('#profile .obs')?.textContent,
  meta:document.querySelector('#profile .muted')?.textContent }));
console.log('secProfile zichtbaar:',r.vis);
console.log('KPIs:',r.kpis.join(' | '));
for(const c of r.cols) console.log(' ',c.h+':',c.rows.join('  '));
console.log('OBS:',r.obs);
console.log('META:',r.meta);
console.log('errors:',errors.length?errors:'geen');
await page.evaluate(()=>document.getElementById('secProfile').scrollIntoView());
await page.waitForTimeout(200);
await page.screenshot({path:'/tmp/diametric-tests/profile.png'});
await browser.close();

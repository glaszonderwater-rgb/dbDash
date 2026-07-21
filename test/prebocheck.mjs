import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=40,now=Date.now();
const _s=new Date(now-NDAYS*DAY);_s.setHours(0,0,0,0);const start=_s.getTime();
function model(peak,dia){const td=Math.max(300,dia),tp=peak,tau=tp*(1-tp/td)/(1-2*tp/td),a=2*tau/td,S=1/(1-a+(1+a)*Math.exp(-td/tau));return {iob(t){if(t<=0)return 1;if(t>=td)return 0;return 1-S*(1-a)*((t*t/(tau*td*(1-a))-t/tau-1)*Math.exp(-t/tau)+1);}};}
const ISF=2,IC=10,DIA=360,mdl=model(75,DIA);
const entries=[],treatments=[],idx=new Map();
for(let t=start;t<now;t+=STEP){const r={_id:'e'+t,date:t,dateString:new Date(t).toISOString(),sgv:0,type:'sgv',direction:'Flat'};r.bg=6.5;entries.push(r);idx.set(t,entries.length-1);}
for(let day=start;day<now;day+=DAY){for(const [hh,carbs,ins] of [[8,50,5],[13,60,6],[19,70,7]]){
  const mt=day+hh*3600e3;
  // SMB 20 min VÓÓR de maaltijd (loop corrigeert een stijging) — mag GEEN prebolus worden
  treatments.push({_id:'p'+mt,created_at:new Date(mt-20*60e3).toISOString(),eventType:'Correction Bolus',type:'SMB',insulin:0.3});
  // Handmatige maaltijdbolus precies bij de koolhydraat-invoer (offset ~0 = tijdens/na eten)
  treatments.push({_id:'t'+mt,created_at:new Date(mt).toISOString(),eventType:'Meal Bolus',type:'NORMAL',carbs,insulin:ins});
  for(let tt=mt;tt<=mt+4*3600e3;tt+=STEP){const i=idx.get(tt);if(i==null)continue;const min=(tt-mt)/60000;entries[i].bg+=(ISF/IC)*carbs*(1-Math.exp(-min/45))-ISF*ins*(1-mdl.iob(min));}}}
for(const e of entries){e.sgv=Math.round(Math.max(2.5,Math.min(18,e.bg))*MG);delete e.bg;}
treatments.push({_id:'psw',created_at:new Date(start+DAY).toISOString(),eventType:'Profile Switch',percentage:100,timeshift:0,profileJson:JSON.stringify({dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]})});
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','40');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('secInsulin').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(300);
await page.evaluate(()=>{showTab('overzicht'); document.getElementById('mvsCard')?.scrollIntoView();});
const r=await page.evaluate(()=>{const rows=[...document.querySelectorAll('#tune .mvs tr')].map(tr=>tr.textContent.replace(/\s+/g,' ').trim());
  return { prebolusRow: rows.find(x=>/Prebolus/i.test(x))||'—' };});
console.log('Prebolus-rij:', r.prebolusRow);
const falsePrebolus=/\bvóór\b/.test(r.prebolusRow) && /prebolus/i.test(r.prebolusRow);
console.log('valse prebolus (SMB als prebolus geteld)?', falsePrebolus ? 'JA — bug' : 'NEE — correct (bolus rond/na)');
console.log('errors:', errors.length?errors:'geen');
await browser.close();

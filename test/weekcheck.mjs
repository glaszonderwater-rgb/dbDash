import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=30,now=Date.now();
const _s=new Date(now-NDAYS*DAY);_s.setHours(0,0,0,0);const start=_s.getTime();
// Closed-loop-achtig: vlakke glucose, frequente SMB's die elk schoon nuchter venster
// breken → geen basaaldrift-bevinding; geen (analyseerbare) maaltijden → lege week.
const entries=[],treatments=[];
for(let t=start;t<now;t+=STEP){entries.push({_id:'e'+t,date:t,dateString:new Date(t).toISOString(),sgv:Math.round(6.5*MG),type:'sgv',direction:'Flat'});}
for(let t=start;t<now;t+=20*60e3){treatments.push({_id:'s'+t,created_at:new Date(t).toISOString(),eventType:'Correction Bolus',type:'SMB',insulin:0.1});}
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','30');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('secInsulin').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(300);
const r=await page.evaluate(()=>({
  week:[...document.querySelectorAll('#findWeek .f, #findWeek .ftxt, #findWeek')].map(e=>e.textContent.replace(/\s+/g,' ').trim()).filter(Boolean),
  empty:document.getElementById('findWeek').textContent.trim()===''}));
console.log('findWeek leeg:', r.empty);
console.log('findWeek inhoud:', (r.week[0]||'—').slice(0,140));
console.log('errors:', errors.length?errors:'geen');
await browser.close();

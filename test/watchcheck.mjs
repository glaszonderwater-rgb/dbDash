import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=30,now=Date.now(),start=now-NDAYS*DAY;
const entries=[];
// laatste 14 dagen: nachtelijke hypo's + hogere gemiddelden (TIR zakt); daarvoor rustig
for(let t=start;t<now;t+=STEP){const d=new Date(t),h=d.getUTCHours();const recent=t>now-14*DAY;let bg=6.4;
  if(recent){ if(h>=2&&h<4)bg=3.4; else bg=8.8+ (h>=10&&h<16?2:0); } else { if(h>=2&&h<4)bg=5.6; }
  bg+=(Math.random()-0.5)*0.5;
  entries.push({_id:'e'+t,date:t,dateString:d.toISOString(),sgv:Math.round(Math.max(2.5,Math.min(18,bg))*MG),type:'sgv',direction:'Flat'});}
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l);
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:1000},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','30');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('secWatch').hidden||document.getElementById('fatalBar'),{timeout:40000}).catch(()=>{});
await page.waitForTimeout(300);
const r=await page.evaluate(()=>({vis:!document.getElementById('secWatch').hidden,
  alerts:[...document.querySelectorAll('#watch .watch')].map(w=>({t:w.querySelector('.wt').textContent,d:w.querySelector('.wd').textContent})),
  none:document.querySelector('#watch .obs')?.textContent, foot:document.querySelector('#watch .muted')?.textContent}));
console.log('secWatch zichtbaar:',r.vis);
r.alerts.forEach(a=>console.log(' ⚠',a.t,'—',a.d));
if(r.none) console.log('geen-alerts tekst:',r.none);
console.log('voet:',r.foot);
console.log('errors:',errors.length?errors:'geen');
await page.evaluate(()=>document.getElementById('secWatch').scrollIntoView());await page.waitForTimeout(200);
await page.screenshot({path:'/tmp/diametric-tests/watch.png'});
await browser.close();

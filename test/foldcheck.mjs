import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,now=Date.now(),start=now-30*DAY;
const entries=[];for(let t=start;t<now;t+=STEP){const d=new Date(t),h=d.getUTCHours();let bg=6.5;if(h===3)bg=3.5;entries.push({_id:'e'+t,date:t,dateString:d.toISOString(),sgv:Math.round(bg*MG),type:'sgv',direction:'Flat'});}
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l);
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','30');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('secInsulin').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(300);
// volgorde-check + fold open/dicht
const r=await page.evaluate(()=>{
  const order=[...document.querySelectorAll('main .epoch')].map(s=>s.id);
  const fold=document.getElementById('bandCard');
  const closed=!fold.open, hasRows=!!fold.querySelector('.trow');
  fold.open=true;
  const visibleAfter=!!fold.querySelector('.trow') && fold.open;
  return { order, closedByDefault:closed, hasRows, visibleAfter,
    ariaCurrent:document.querySelector('#tabbar .tab[aria-current="page"]')?.dataset.tab };
});
console.log('volgorde:',r.order.join(' → '));
console.log('fold dicht bij start:',r.closedByDefault,'| inhoud aanwezig:',r.hasRows,'| open werkt:',r.visibleAfter);
console.log('aria-current:',r.ariaCurrent);
console.log('errors:',errors.length?errors:'geen');
await browser.close();

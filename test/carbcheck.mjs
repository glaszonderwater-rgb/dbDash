import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=7,now=Date.now();
const _s=new Date(now-NDAYS*DAY);_s.setHours(0,0,0,0);const start=_s.getTime();
// Minimale, vlakke data zodat de app boot en de tabs tonen (de schatter zelf heeft geen data nodig).
const entries=[],treatments=[];
for(let t=start;t<now;t+=STEP){entries.push({_id:'e'+t,date:t,dateString:new Date(t).toISOString(),sgv:Math.round(6.5*MG),type:'sgv',direction:'Flat'});}
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','7');
await page.click('#btnSave');
await page.waitForFunction(()=>document.getElementById('kpis')&&document.getElementById('kpis').children.length>0,{timeout:40000}).catch(()=>{});
await page.evaluate(()=>{showTab('analyses'); const n=document.getElementById('tabbar'); if(n) n.style.display='none';});
await page.evaluate(()=>{document.getElementById('secCarb').open=true;});
await page.waitForTimeout(150);

// 1) Zoek "banaan" → resultaat verschijnt
await page.fill('#cbSearch','banaan');
await page.waitForFunction(()=>[...document.querySelectorAll('#cbResults .cbN')].some(x=>/Banaan/.test(x.textContent)),{timeout:5000}).catch(()=>{});
// 2) Klik het resultaat → portie-editor; standaard "stuk" (120 g) → 21 g/100 g ⇒ 25 g
await page.evaluate(()=>{[...document.querySelectorAll('#cbResults .cbRhead')].find(r=>/Banaan/.test(r.textContent)).click();});
await page.waitForTimeout(100);
const est1=await page.evaluate(()=>document.getElementById('cbEst')?.textContent||'');
await page.click('#cbAddBtn');
await page.waitForTimeout(100);
// 3) Zoek "cola" → kies "blikje" (330 g) → 11 g/100 g ⇒ 36 g
await page.fill('#cbSearch','cola');
await page.waitForFunction(()=>[...document.querySelectorAll('#cbResults .cbN')].some(x=>x.textContent.trim()==='Cola'),{timeout:5000}).catch(()=>{});
await page.evaluate(()=>{[...document.querySelectorAll('#cbResults .cbRhead')].find(r=>r.querySelector('.cbN').textContent.trim()==='Cola').click();});
await page.waitForTimeout(100);
await page.evaluate(()=>{const b=[...document.querySelectorAll('.cbUnit')].find(x=>/blikje/.test(x.textContent));if(b)b.click();});
const est2=await page.evaluate(()=>document.getElementById('cbEst')?.textContent||'');
await page.click('#cbAddBtn');
await page.waitForTimeout(100);
const total=await page.evaluate(()=>document.getElementById('cbTotal')?.textContent||'');
// 4) Vastleggen → logboek toont de maaltijd
await page.click('#cbSave');
await page.waitForTimeout(200);
const log=await page.evaluate(()=>document.getElementById('logList')?.textContent.replace(/\s+/g,' ').trim()||'');

console.log('schatting banaan (1 stuk):', est1, '→', /25 g/.test(est1)?'OK (25 g)':'FOUT');
console.log('schatting cola (blikje):', est2, '→', /36 g/.test(est2)?'OK (36 g)':'FOUT');
console.log('bord-totaal:', total, '→', /61 g/.test(total)?'OK (61 g)':'FOUT');
console.log('logboek toont maaltijd:', /Maaltijd/.test(log)&&/61 g koolhydraten/.test(log)?'JA':'NEE');
console.log('logboek-fragment:', log.slice(0,160));
console.log('errors:', errors.length?errors:'geen');
await browser.close();

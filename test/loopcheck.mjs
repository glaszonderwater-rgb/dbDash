import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=30,now=Date.now();
const _s=new Date(now-NDAYS*DAY);_s.setHours(0,0,0,0);const start=_s.getTime();
const PBASAL=0.9;
// Closed loop: elke 30 min een Temp Basal. 's Nachts (03–06 u lokaal) levert de loop
// structureel MEER (1,2 U/u) dan het profiel (0,9) → "profiel-basaal te laag" verwacht.
const entries=[],treatments=[];
for(let t=start;t<now;t+=STEP){entries.push({_id:'e'+t,date:t,dateString:new Date(t).toISOString(),sgv:Math.round(6.5*MG),type:'sgv',direction:'Flat'});}
for(let t=start;t<now;t+=30*60e3){const h=Math.floor(((t-start)/3600e3)%24);const rate=(h>=3&&h<6)?1.2:0.9;
  treatments.push({_id:'tb'+t,created_at:new Date(t).toISOString(),eventType:'Temp Basal',type:'NORMAL',absolute:rate,rate,duration:30,durationInMilliseconds:1800000});}
treatments.push({_id:'psw',created_at:new Date(start+STEP).toISOString(),eventType:'Profile Switch',percentage:100,timeshift:0,profileJson:JSON.stringify({dia:6,units:'mmol',basal:[{time:'00:00',value:PBASAL}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]})});
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:PBASAL}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','30');
await page.click('#btnSave');
await page.waitForFunction(()=>document.getElementById('kpis')&&document.getElementById('kpis').children.length>0,{timeout:40000}).catch(()=>{});
await page.$eval('details[data-an="loopbasal"]', d=>{d.open=true;});
await page.waitForFunction(()=>{const b=document.querySelector('details[data-an="loopbasal"] .body');return b&&!b.querySelector('.loading');},{timeout:15000}).catch(()=>{});
const r=await page.evaluate(()=>({obs:document.querySelector('details[data-an="loopbasal"] .obs')?.textContent||'',
  bars:document.querySelectorAll('details[data-an="loopbasal"] svg rect').length}));
console.log('obs:', r.obs.slice(0,220));
console.log('svg-balken:', r.bars);
console.log('meldt "meer/te laag" rond nacht:', /méér.*te.*laag|te.*laag/i.test(r.obs) ? 'JA' : 'NEE');
console.log('errors:', errors.length?errors:'geen');
await browser.close();

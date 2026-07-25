import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=30,now=Date.now();
const _s=new Date(now-NDAYS*DAY);_s.setHours(0,0,0,0);const start=_s.getTime();
// Closed loop: profiel-basaal 0,9; loop levert de hele dag structureel 1,2 U/u
// (profiel dus ~33% te laag). Geen basaaldrift (glucose vlak), dus de basaal-
// bespreekwaarde MOET uit loop-basaal komen — in elk dagdeel een kandidaat.
const entries=[],treatments=[];
for(let t=start;t<now;t+=STEP){entries.push({_id:'e'+t,date:t,dateString:new Date(t).toISOString(),sgv:Math.round(6.5*MG),type:'sgv',direction:'Flat'});}
for(let t=start;t<now;t+=30*60e3){treatments.push({_id:'tb'+t,created_at:new Date(t).toISOString(),eventType:'Temp Basal',type:'NORMAL',absolute:1.2,rate:1.2,duration:30,durationInMilliseconds:1800000});}
treatments.push({_id:'psw',created_at:new Date(start+STEP).toISOString(),eventType:'Profile Switch',percentage:100,profileJson:JSON.stringify({dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]})});
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','30');
await page.click('#btnSave');
await page.waitForFunction(()=>document.getElementById('kpis')&&document.getElementById('kpis').children.length>0,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(300);
await page.evaluate(()=>{showTab('analyses'); const n=document.getElementById('tabbar'); if(n) n.style.display='none';});
await page.waitForTimeout(150);
const r=await page.evaluate(()=>({
  rows:[...document.querySelectorAll('#proposals .bwm tbody tr')].map(tr=>[...tr.children].map(td=>td.textContent.replace(/\s+/g,' ').trim())),
  basaalCard:[...document.querySelectorAll('#proposals .pcard')].map(c=>({t:c.querySelector('.pctitle')?.textContent,why:c.querySelector('.pcwhy')?.textContent,metas:[...c.querySelectorAll('.pdmeta')].map(m=>m.textContent)})).find(c=>/Basaal/.test(c.t))}));
console.log('=== matrix (dagdeel | ISF | Basaal | KH) ===');
for(const row of r.rows) console.log('  ', row.join(' | '));
const basaalChanged=r.rows.some(row=>/→/.test(row[2]||''));
console.log('basaal-kolom gevuld met kandidaat:', basaalChanged?'JA':'NEE');
console.log('basaal-bron loop-basaal:', r.basaalCard && /loop.*profiel|temp-basaal/i.test((r.basaalCard.why||'')+(r.basaalCard.metas||[]).join(' '))?'JA':'NEE');
console.log('errors:', errors.length?errors:'geen');
await browser.close();

import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=30,now=Date.now();
const _s=new Date(now-NDAYS*DAY);_s.setHours(0,0,0,0);const start=_s.getTime();
const entries=[],treatments=[];
for(let t=start;t<now;t+=STEP){const d=new Date(t);entries.push({_id:'e'+t,date:t,dateString:d.toISOString(),sgv:Math.round(6.5*MG),type:'sgv',direction:'Flat'});}
for(let day=start;day<now;day+=DAY){
  const mt=day+8*3600e3;
  treatments.push({_id:'m'+mt,created_at:new Date(mt).toISOString(),eventType:'Meal Bolus',type:'NORMAL',carbs:50,insulin:5});           // handmatig
  treatments.push({_id:'c'+mt,created_at:new Date(day+15*3600e3).toISOString(),eventType:'Correction Bolus',type:'NORMAL',insulin:1.5}); // handmatig
  // Echte AAPS-vorm: eventType 'Correction Bolus' + type 'SMB', géén isSMB-veld
  for(let k=1;k<=3;k++) treatments.push({_id:'s'+mt+k,created_at:new Date(mt+k*12*60e3).toISOString(),eventType:'Correction Bolus',type:'SMB',insulin:0.4});
}
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
await page.evaluate(()=>{showTab('analyses'); document.getElementById('secInsulin').open=true;});
await page.waitForTimeout(200);
const r=await page.evaluate(()=>({
  kpis:[...document.querySelectorAll('#insKpis .kpi')].map(k=>k.querySelector('.k').textContent+'='+k.querySelector('.v').textContent),
  diag:document.getElementById('smbDiagBody').textContent.replace(/\s+/g,' ').trim().slice(0,220) }));
console.log('KPIs:', r.kpis.join(' | '));
const smbRow=r.kpis.find(x=>x.startsWith("SMB's"));
console.log("SMB-rij aanwezig:", !!smbRow, smbRow||'');
console.log('diagnose:', r.diag);
console.log('errors:', errors.length?errors:'geen');
await browser.close();

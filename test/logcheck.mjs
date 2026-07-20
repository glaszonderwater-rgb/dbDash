import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=30,now=Date.now(),start=now-NDAYS*DAY;
const entries=[],treatments=[];
// eerste helft slechtere TIR (meer hoog), tweede helft beter — zodat voor/na iets laat zien
for(let t=start;t<now;t+=STEP){const d=new Date(t),h=d.getUTCHours()+d.getUTCMinutes()/60;const early=t<start+15*DAY;let bg=early?8.6:6.6;if(h>=2&&h<4)bg-=0.6;bg+=(Math.random()-0.5)*0.7;const r={_id:'e'+t,date:t,dateString:d.toISOString(),sgv:Math.round(Math.max(2.5,Math.min(18,bg))*MG),type:'sgv',direction:'Flat'};entries.push(r);}
for(let day=start;day<now;day+=DAY){for(const [hh,carbs,ins] of [[8,40,4],[13,60,6],[19,70,7]]){const mt=day+hh*3600e3;treatments.push({_id:'t'+mt,created_at:new Date(mt).toISOString(),eventType:'Meal Bolus',carbs,insulin:ins});}}
treatments.push({_id:'psw',created_at:new Date(start+DAY).toISOString(),eventType:'Profile Switch',percentage:100,timeshift:0,profileJson:JSON.stringify({dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]})});
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const ctx=await browser.newContext({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const page=await ctx.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const routes=async route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});};
await page.route('https://mock.nightscout.test/**',routes);
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','30');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('secLog').hidden||document.getElementById('fatalBar'),{timeout:40000}).catch(()=>{});
await page.waitForTimeout(300);
// datum 15 dagen geleden
const d15=new Date(now-15*DAY),dv=`${d15.getFullYear()}-${String(d15.getMonth()+1).padStart(2,'0')}-${String(d15.getDate()).padStart(2,'0')}`;
await page.evaluate(()=>{applyTab('voortgang'); const n=document.getElementById('tabbar'); if(n) n.style.display='none';}); await page.waitForTimeout(120);
await page.fill('#logDate',dv);
await page.fill('#logNote','basaal 03u +0,1');
await page.$eval('#logAdd', el=>el.scrollIntoView({block:'center'})); await page.waitForTimeout(50);
await page.click('#logAdd');
await page.waitForTimeout(300);
const r1=await page.evaluate(()=>({
  visible:!document.getElementById('secLog').hidden,
  entries:document.querySelectorAll('#logList .logentry').length,
  head:document.querySelector('#logList .leh .lt')?.textContent,
  note:document.querySelector('#logList .lenote')?.textContent,
  ba:document.querySelector('#logList .ba')?.textContent?.replace(/\s+/g,' ').trim(),
  verdict:document.querySelector('#logList .verdict')?.textContent,
}));
console.log('secLog zichtbaar:',r1.visible,'| entries:',r1.entries);
console.log('type:',r1.head,'| note:',r1.note);
console.log('voor/na:',r1.ba);
console.log('verdict:',r1.verdict);
// persistentie: herlaad pagina in dezelfde context
await page.reload({waitUntil:'load'});
await page.waitForFunction(()=>!document.getElementById('secLog').hidden||document.getElementById('fatalBar'),{timeout:40000}).catch(()=>{});
await page.waitForTimeout(300);
const r2=await page.evaluate(()=>document.querySelectorAll('#logList .logentry').length);
console.log('na reload entries:',r2);
await page.evaluate(()=>document.getElementById('secLog').scrollIntoView());
await page.waitForTimeout(200);
await page.screenshot({path:'/tmp/diametric-tests/log.png'});
console.log('errors:',errors.length?errors:'geen');
await browser.close();

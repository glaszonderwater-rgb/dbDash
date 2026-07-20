import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,now=Date.now(),start=now-20*DAY;
const entries=[];for(let t=start;t<now;t+=STEP)entries.push({_id:'e'+t,date:t,dateString:new Date(t).toISOString(),sgv:Math.round(6.5*MG),type:'sgv',direction:'Flat'});
const treatments=[{_id:'rt',created_at:new Date(now-30*60e3).toISOString(),eventType:'Meal Bolus',carbs:40,insulin:5}];
// devicestatus in AAPS-vorm: openaps.iob.iob + openaps.suggested.COB
const devicestatus=[];
for(let k=6;k>=1;k--){const ct=now-k*5*60e3;devicestatus.push({_id:'d'+ct,created_at:new Date(ct).toISOString(),openaps:{iob:{iob:2.3},suggested:{COB:12}}});}
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});if(p==='/api/v1/devicestatus.json')return route.fulfill({json:inC(devicestatus,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','20');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('secNow').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(400);
const txt=await page.evaluate(()=>document.getElementById('onboard').textContent);
const dsCount=await page.evaluate(async()=>(await DB.all('devicestatus')).length);
console.log('devicestatus opgeslagen:',dsCount);
console.log('onboard:',txt);
console.log('errors:',errors.length?errors:'geen');
await browser.close();

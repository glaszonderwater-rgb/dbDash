import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=90,now=Date.now(),start=now-NDAYS*DAY;
const entries=[],treatments=[];
for(let t=start;t<now;t+=STEP){const d=new Date(t),h=d.getUTCHours()+d.getUTCMinutes()/60;let bg=6.2;if(h>=0&&h<6)bg=6.0+h*0.35;bg+=(Math.random()-0.5)*0.4;entries.push({_id:'e'+t,date:t,dateString:d.toISOString(),sgv:Math.round(Math.max(2.5,Math.min(18,bg))*MG),type:'sgv',direction:'Flat'});}
for(let day=start;day<now;day+=DAY){for(const [hh,carbs,ins] of [[8,40,4],[13,60,6],[19,70,7]]){const mt=day+hh*3600e3;treatments.push({_id:'t'+mt,created_at:new Date(mt).toISOString(),eventType:'Meal Bolus',carbs,insulin:ins});}}
treatments.push({_id:'psw',created_at:new Date(start+DAY).toISOString(),eventType:'Profile Switch',percentage:100,timeshift:0,profileJson:JSON.stringify({dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]})});
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','90');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('secDeep').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(300);
const timing=await page.evaluate(()=>{const {glucose,q,treatments,timeline}=_ctx;const t0=performance.now();const r=nightSim(glucose,treatments,q,timeline);const t1=performance.now();return {ms:+(t1-t0).toFixed(1),nights:r.nights,glucoseN:glucose.length};});
console.log('data:',timing.glucoseN,'metingen · nachten:',timing.nights);
console.log('nightSim pure compute:',timing.ms,'ms');
await browser.close();

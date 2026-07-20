import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=20,now=Date.now(),start=now-NDAYS*DAY;
const entries=[],treatments=[];
for(let t=start;t<now;t+=STEP){const bg=t> now-40*60e3 ? 7.0 - (t-(now-40*60e3))/60e3*0.04 : 6.5; entries.push({_id:'e'+t,date:t,dateString:new Date(t).toISOString(),sgv:Math.round(Math.max(3,bg)*MG),type:'sgv',direction: t>now-15*60e3?'SingleDown':'Flat'});}
for(let day=start;day<now-DAY;day+=DAY){for(const [hh,carbs,ins] of [[8,40,4],[13,60,6],[19,70,7]]){const mt=day+hh*3600e3;treatments.push({_id:'t'+mt,created_at:new Date(mt).toISOString(),eventType:'Meal Bolus',carbs,insulin:ins});}}
// recente maaltijd+bolus 30 min geleden → IOB en COB nu > 0
const rt=now-30*60e3; treatments.push({_id:'rt',created_at:new Date(rt).toISOString(),eventType:'Meal Bolus',carbs:45,insulin:5});
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','20');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('secNow').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(400);
const r=await page.evaluate(()=>({hidden:document.getElementById('onboard').hidden,txt:document.getElementById('onboard').textContent,hint:!!document.querySelector('#onboard .ob-hint')}));
console.log('onboard verborgen:',r.hidden);
console.log('tekst:',r.txt);
console.log('hint aanwezig:',r.hint);
console.log('errors:',errors.length?errors:'geen');
await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(150);
await page.screenshot({path:'/tmp/diametric-tests/iob.png'});
await browser.close();

import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=20,now=Date.now(),start=now-NDAYS*DAY;
const entries=[],treatments=[],idx=new Map();
for(let t=start;t<now;t+=STEP){const d=new Date(t),h=d.getUTCHours()+d.getUTCMinutes()/60;let bg=6.5;if(h>=2&&h<4)bg=3.5;if(h>=10&&h<13)bg=9+Math.sin(h)*2;bg+=(Math.random()-0.5)*0.5;const r={_id:'e'+t,date:t,dateString:d.toISOString(),sgv:Math.round(Math.max(2.5,Math.min(18,bg))*MG),type:'sgv',direction:'Flat'};entries.push(r);idx.set(t,entries.length-1);}
for(let day=start;day<now;day+=DAY){for(const [hh,carbs,ins] of [[8,45,4],[13,60,5],[19,70,6]]){const mt=day+hh*3600e3;treatments.push({_id:'t'+mt,created_at:new Date(mt).toISOString(),eventType:'Meal Bolus',carbs,insulin:ins});}
  const ct=day+22*3600e3;treatments.push({_id:'c'+ct,created_at:new Date(ct).toISOString(),eventType:'Correction Bolus',carbs:0,insulin:1});}
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','20');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('secDay').hidden,{timeout:40000}).catch(()=>{});
const r1=await page.evaluate(()=>({label:document.getElementById('dayLabel').textContent,hasSvg:!!document.querySelector('#dayChart svg'),narr:document.getElementById('dayNarr').textContent,nextDisabled:document.getElementById('dayNext').disabled,prevDisabled:document.getElementById('dayPrev').disabled}));
console.log('laatste dag:',r1.label,'| svg:',r1.hasSvg,'| next uit:',r1.nextDisabled);
console.log('duiding:',r1.narr);
await page.click('#dayPrev'); await page.waitForTimeout(150);
const r2=await page.evaluate(()=>({label:document.getElementById('dayLabel').textContent,narr:document.getElementById('dayNarr').textContent}));
console.log('vorige dag:',r2.label);
console.log('duiding:',r2.narr);
console.log('errors:',errors.length?errors:'geen');
const jump=await page.evaluate(()=>[...document.querySelectorAll('#dayJump .chip')].map(c=>c.textContent));
console.log('jump-chips:',jump.join(' | '));
const worstChip=await page.$('#dayJump .chip'); if(worstChip){ await worstChip.click(); await page.waitForTimeout(150);
  const jr=await page.evaluate(()=>({label:document.getElementById('dayLabel').textContent,narr:document.getElementById('dayNarr').textContent,sel:document.querySelector('#dayJump .chip.sel')?.textContent}));
  console.log('na klik ergste-hypo →',jr.label); console.log('  duiding:',jr.narr); console.log('  actief gemarkeerd:',jr.sel); }
await page.evaluate(()=>document.getElementById('secDay').scrollIntoView());await page.waitForTimeout(200);
await page.screenshot({path:'/tmp/diametric-tests/day.png'});
await browser.close();

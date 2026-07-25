import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=24,now=Date.now();
const _s=new Date(now-NDAYS*DAY);_s.setHours(0,0,0,0);const start=_s.getTime();
// Elke dag een lunch (60 g) met de bolus 30 min TE LAAT (geen prebolus) → hoge piek.
// De piek-"waarom"-motor moet dit patroon herkennen als 'te late bolus'.
function bgTod(min){
  if(min>=720&&min<780) return 7.0 + 5.0*(min-720)/60;    // 12:00–13:00 stijging naar +5
  if(min>=780&&min<960) return 12.0 - 6.0*(min-780)/180;  // 13:00–16:00 daling
  return 7.0;
}
const entries=[],treatments=[];
for(let t=start;t<now;t+=STEP){ const ld=new Date(t); const tod=ld.getHours()*60+ld.getMinutes();
  entries.push({_id:'e'+t,date:t,dateString:new Date(t).toISOString(),sgv:Math.round(Math.max(3,Math.min(16,bgTod(tod)))*MG),type:'sgv',direction:'Flat'}); }
for(let day=start;day<now;day+=DAY){
  const ct=day+12*3600e3;   treatments.push({_id:'c'+ct,created_at:new Date(ct).toISOString(),eventType:'Carbs',carbs:60});
  const bt=day+12.5*3600e3; treatments.push({_id:'b'+bt,created_at:new Date(bt).toISOString(),eventType:'Meal Bolus',type:'NORMAL',insulin:6}); // 30 min te laat
}
treatments.push({_id:'psw',created_at:new Date(start+STEP).toISOString(),eventType:'Profile Switch',percentage:100,profileJson:JSON.stringify({dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]})});
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','24');
await page.click('#btnSave');
await page.waitForFunction(()=>document.getElementById('kpis')&&document.getElementById('kpis').children.length>0,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(400);
const week=await page.evaluate(()=>document.getElementById('findWeek')?.textContent.replace(/\s+/g,' ').trim()||'');
console.log('=== WEEK ===\n', week.slice(0,700));
const okPiek=/hoogste pieken komen het vaakst/.test(week);
const okLaat=/te late bolus/.test(week);
const okGrootste=/Grootste piek/.test(week);
console.log('\npiek-patroon aanwezig:', okPiek?'JA':'NEE');
console.log('oorzaak = te late bolus:', okLaat?'JA':'NEE');
console.log('toont grootste piek als voorbeeld:', okGrootste?'JA':'NEE');
console.log('errors:', errors.length?errors:'geen');
await browser.close();

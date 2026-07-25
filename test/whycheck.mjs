import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=30,now=Date.now();
const _s=new Date(now-NDAYS*DAY);_s.setHours(0,0,0,0);const start=_s.getTime();
// Elke nacht dezelfde closed-loop hypo: de loop stapelt 3 SMB's tegen een stijging,
// die insuline werkt door en duwt je rond 03:10 onder 3,9. Oorzaak = SMB-stapeling.
// bg puur als functie van tijd-van-de-dag (deterministisch, elke nacht gelijk).
function bgTod(min){
  if(min>=120&&min<150) return 6.5 + (9.0-6.5)*(min-120)/30;   // 02:00–02:30 stijging
  if(min>=150&&min<195) return 9.0 - (9.0-3.4)*(min-150)/45;   // 02:30–03:15 insulinegedreven daling
  if(min>=195&&min<225) return 3.4 + (3.9-3.4)*(min-195)/30;   // 03:15–03:45 low (dur >30 min → echte hypo, geen sensordruk)
  if(min>=225&&min<360) return 3.9 + (6.5-3.9)*(min-225)/135;  // 03:45–06:00 herstel
  return 6.5;
}
const entries=[],treatments=[];
for(let t=start;t<now;t+=STEP){ const ld=new Date(t); const tod=ld.getHours()*60+ld.getMinutes();
  const bg=Math.max(2.6,Math.min(16,bgTod(tod)));
  entries.push({_id:'e'+t,date:t,dateString:new Date(t).toISOString(),sgv:Math.round(bg*MG),type:'sgv',direction:'Flat'}); }
for(let day=start;day<now;day+=DAY){ for(const off of [120,130,140]){ const ct=day+off*60e3;
  treatments.push({_id:'smb'+ct,created_at:new Date(ct).toISOString(),eventType:'SMB',type:'SMB',insulin:0.4}); } }
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
await page.waitForTimeout(400);
const r=await page.evaluate(()=>({
  today:document.getElementById('findToday')?.textContent.replace(/\s+/g,' ').trim()||'',
  week:document.getElementById('findWeek')?.textContent.replace(/\s+/g,' ').trim()||''
}));
console.log('=== VANDAAG (nacht-kaart) ===\n', r.today.slice(0,600));
console.log('\n=== WEEK (waarom-patroon) ===\n', r.week.slice(0,600));
const okWaarom=/Waarom/.test(r.today);
const okCause=/loop-correcties|SMB/.test(r.today);
const okIob=/Actieve insuline/.test(r.today);
const okPatroon=/hypo's paste bij/.test(r.week) && /loop-correcties/.test(r.week);
console.log('\nnacht-kaart toont "Waarom":', okWaarom?'JA':'NEE');
console.log('oorzaak = SMB/loop-correcties:', okCause?'JA':'NEE');
console.log('toont actieve insuline (bewijs):', okIob?'JA':'NEE');
console.log('week-patroon telt oorzaken op:', okPatroon?'JA':'NEE');
console.log('errors:', errors.length?errors:'geen');
await browser.close();

import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE=new URL('../index.html',import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=30,now=Date.now(),start=now-NDAYS*DAY;
const entries=[],treatments=[];
for(let t=start;t<now;t+=STEP){const d=new Date(t),h=d.getUTCHours()+d.getUTCMinutes()/60;let bg=6.4;if(h>=2&&h<4)bg-=1.1;if(h>=13&&h<15)bg+=2.0;bg+=(Math.random()-0.5)*0.5;entries.push({_id:'e'+t,date:t,dateString:d.toISOString(),sgv:Math.round(Math.max(2.6,Math.min(17,bg))*MG),type:'sgv',direction:'Flat'});}
for(let day=start;day<now;day+=DAY){for(const [hh,c,ins] of [[8,40,4],[13,60,6],[19,70,7]]){const mt=day+hh*3600e3;treatments.push({_id:'t'+mt,created_at:new Date(mt).toISOString(),eventType:'Meal Bolus',carbs:c,insulin:ins});}}
treatments.push({_id:'psw',created_at:new Date(start+DAY).toISOString(),eventType:'Profile Switch',percentage:100,profileJson:JSON.stringify({dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]})});
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),pa=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(pa==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(pa==='/api/v1/profile.json')return route.fulfill({json:profile});if(pa==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(pa==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','30');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('tabbar').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(400);

const home=await page.evaluate(()=>({
  greetShown:!document.getElementById('homeGreet').hidden,
  greetHi:document.getElementById('greetHi').textContent.trim(),
  heroShown:!document.getElementById('homeHero').hidden,
  heroVal:document.getElementById('ringVal').textContent.trim(),
  heroArrow:document.getElementById('heroArrow').textContent.trim(),
  heroSide:document.getElementById('ringMeta').textContent.trim(),
  kpiCount:document.querySelectorAll('.chome .kpis .kpi').length,
  aandacht:/Aandacht/i.test(document.getElementById('epVandaag').textContent),
  findings:document.querySelectorAll('#findToday .f, #findWeek .f').length,
  noRing:!document.getElementById('ringArc'),
  noActs:!document.getElementById('homeActs'),
  nuHidden:document.getElementById('secNow').classList.contains('hideOnHome'),
}));
// Nu-balk terug zichtbaar op een andere tab
await page.click('#tabbar .tab[data-tab="analyses"]'); await page.waitForTimeout(120);
const nuOnOther=await page.evaluate(()=>!document.getElementById('secNow').classList.contains('hideOnHome'));
await page.click('#tabbar .tab[data-tab="overzicht"]'); await page.waitForTimeout(120);
const backHidden=await page.evaluate(()=>document.getElementById('secNow').classList.contains('hideOnHome'));

console.log('begroeting:',home.greetShown?home.greetHi:'NEE');
console.log('waarde-kaart:',home.heroVal,home.heroArrow,'| side:',home.heroSide.slice(0,40));
console.log('geen ring / geen actieknoppen:',home.noRing&&home.noActs?'JA':'NEE');
console.log('kerncijfer-tegels:',home.kpiCount,'| Aandacht-kop:',home.aandacht?'JA':'NEE','| bevindingen:',home.findings);
console.log('Nu-balk verborgen op home:',home.nuHidden?'JA':'NEE','| zichtbaar elders:',nuOnOther?'JA':'NEE','| na terugkeer verborgen:',backHidden?'JA':'NEE');
console.log('errors:',errors.length?errors:'geen');
const ok = home.greetShown && /Goede/.test(home.greetHi) && home.heroShown && /^\d/.test(home.heroVal)
  && home.noRing && home.noActs && home.kpiCount===4 && home.aandacht && home.findings>0
  && home.nuHidden && nuOnOther && backHidden && !errors.length;
console.log('\nRESULTAAT:',ok?'OK':'FOUT');
if(!ok) process.exitCode=1;
await browser.close();

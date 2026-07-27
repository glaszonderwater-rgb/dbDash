import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE=new URL('../index.html',import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=30,now=Date.now(),start=now-NDAYS*DAY;
// Dawn-fenomeen: vlakke nacht (00–04), stijging 04–08, terug omlaag 08–10, geen behandelingen.
const entries=[];
for(let t=start;t<now;t+=STEP){ const h=new Date(t).getUTCHours()+new Date(t).getUTCMinutes()/60;
  let bg=6.5; if(h>=4&&h<8) bg=6.5+(h-4)*0.5; else if(h>=8&&h<10) bg=8.5-(h-8)*1.0;
  entries.push({_id:'e'+t,date:t,dateString:new Date(t).toISOString(),sgv:Math.round(bg*MG),type:'sgv',direction:'Flat'}); }
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l);
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),pa=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));if(pa==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(pa==='/api/v1/profile.json')return route.fulfill({json:profile});if(pa==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','30');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('tabbar').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(400);

// 1) Dawn-fenomeen end-to-end: verschijnt als week-bevinding
const week=await page.evaluate(()=>document.getElementById('findWeek').textContent.replace(/\s+/g,' ').trim());
const okDawn = /Dawn-fenomeen/.test(week) && /vroege ochtend/.test(week);
console.log('dawn-bevinding:', okDawn?'JA':'NEE');
console.log('  →', (week.match(/Dawn-fenomeen[^.]*\./)||[''])[0].slice(0,110));

// 2) Somogyi-detector (unit): 5 nachten met laagte → ochtendhyper
const sg=await page.evaluate(()=>{
  const DAY=864e5,STEP=5*60e3, base=Date.now()-6*DAY, g=[];
  for(let d=0;d<5;d++){ const d0=base+d*DAY;
    for(let t=d0;t<d0+DAY;t+=STEP){ const h=new Date(t).getUTCHours(); let bg=6.5;
      if(h<2) bg=3.5; else if(h>=4&&h<6) bg=12; g.push({ts:t,bg}); } }
  const keys=new Set(g.map(x=>localDayKey(x.ts)));
  return somogyiPattern(g,{usableKeys:keys});
});
const okSg = sg && sg.nights>=3 && sg.rebounds>=3;
console.log('somogyi-detector:', okSg?'JA':'NEE', sg?`(nachten=${sg.nights}, rebounds=${sg.rebounds})`:'(null)');

// 3) Verlate-hypo-na-sport-detector (unit): 3 sport-markeringen + laagtes 4–12u erna
const ex=await page.evaluate(()=>{
  const DAY=864e5,STEP=5*60e3, base=Date.now()-5*DAY, g=[], anns=[];
  for(let t=base;t<Date.now();t+=STEP) g.push({ts:t,bg:6.5});
  for(let d=0;d<3;d++){ const s=base+d*DAY+12*3600e3; anns.push({type:'sport',ts:s});
    for(const x of g){ if(x.ts>=s+4*3600e3 && x.ts<=s+12*3600e3 && Math.random()<0.35) x.bg=3.4; } }
  const keys=new Set(g.map(x=>localDayKey(x.ts)));
  return exerciseLatePattern(g,{usableKeys:keys},anns);
});
const okEx = ex && ex.events>=3 && ex.wRate>ex.bRate;
console.log('sport-nawerking-detector:', okEx?'JA':'NEE', ex?`(wRate=${(ex.wRate*100).toFixed(0)}% vs ${(ex.bRate*100).toFixed(0)}%)`:'(null)');

// 4) Dawn-bevinding vertaalt mee
await page.evaluate(()=>setLang('en')); await page.waitForTimeout(200);
const weekEN=await page.evaluate(()=>document.getElementById('findWeek').textContent);
const okEN = /Dawn phenomenon/.test(weekEN) && !/vroege ochtend/.test(weekEN);
console.log('dawn vertaalt (EN):', okEN?'JA':'NEE');

console.log('errors:', errors.length?errors:'geen');
const ok = okDawn && okSg && okEx && okEN && !errors.length;
console.log('\nRESULTAAT:', ok?'OK':'FOUT');
if(!ok) process.exitCode=1;
await browser.close();

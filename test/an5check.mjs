// Analyses (v42): alle analyses rekenen zonder fouten, scherm en details openen, loggen met nieuwe soorten.
import { chromium } from 'playwright-core';
const EXE=(process.env.CHROME_PATH||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const FILE=new URL('../index.html',import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=40,now=Date.now(),start=now-NDAYS*DAY;
const entries=[],treatments=[];
for(let t=start;t<now;t+=STEP){const d=new Date(t),h=d.getUTCHours()+d.getUTCMinutes()/60;let bg=6.6+Math.sin(t/7e6)*1.2;if(h>=2&&h<3&&d.getUTCDate()%5===0)bg=3.3;if(h>=13&&h<16)bg+=3.5;if(h>=19&&h<23&&d.getUTCDate()%7===0)bg=15.2;entries.push({_id:'e'+t,date:t,dateString:d.toISOString(),sgv:Math.round(Math.max(2.4,Math.min(20,bg))*MG),type:'sgv',direction:'Flat'});}
for(let day=start;day<now;day+=DAY){for(const [hh,c,ins] of [[8,40,4],[13,60,6],[19,70,7]]){const mt=day+hh*3600e3;treatments.push({_id:'t'+mt,created_at:new Date(mt).toISOString(),eventType:'Meal Bolus',carbs:c,insulin:ins});}
  treatments.push({_id:'s'+day,created_at:new Date(day+15*3600e3).toISOString(),eventType:'Correction Bolus',insulin:0.4,isSMB:true});
  if(Math.round((day-start)/DAY)%3===0) treatments.push({_id:'p'+day,created_at:new Date(day+10*3600e3).toISOString(),eventType:'Site Change'});}
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{ if(m.type()==='error') errors.push(m.text()); });
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),pa=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(pa==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(pa==='/api/v1/profile.json')return route.fulfill({json:profile});if(pa==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(pa==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','40');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('tabbar').hidden&&_ctx&&_ctx.glucose&&_ctx.glucose.length>5000,{timeout:60000}).catch(()=>{});
await page.waitForTimeout(800);
let fail=0; const ok=(c,m)=>{ if(!c){ fail++; console.log('FOUT:',m); } };
// loggen met nieuwe soorten
await page.evaluate(()=>openLogSheet()); await page.waitForTimeout(100);
const tiles=await page.evaluate(()=>[...document.querySelectorAll('[data-lt]')].map(b=>b.dataset.lt));
ok(['warmte','nacht','medicijn','plaats'].every(k=>tiles.includes(k)),'nieuwe logsoorten: '+tiles);
await page.click('[data-lt="medicijn"]'); await page.click('[data-ls="prednison"]'); await page.click('[data-ld="3"]'); await page.click('#logSave'); await page.waitForTimeout(600);
const med=await page.evaluate(async()=>(await DB.all('annotations')).find(a=>a.type==='medicijn'));
ok(med&&med.med==='prednison'&&med.days===3,'medicijn bewaard met soort en dagen');
ok(await page.evaluate(()=>_medKeys.size>=3),'prednisondagen uitgesloten');
const r=await page.evaluate(()=>{ delete _ctx._an5; delete _ctx._fac5; const A=idaAn(_ctx); return { n:A.length, ids:A.map(a=>a.id), bad:A.filter(a=>!a.t||!a.v||!a.s).map(a=>a.n), med:A.find(a=>a.id==='medicijn') }; });
ok(r.n>=26,'minstens 26 analyses, kreeg '+r.n+' '+r.ids);
ok(!r.bad.length,'analyses zonder titel/zin: '+r.bad);
ok(r.med&&r.med.s==='let','prednison actief gemeld');
await page.evaluate(()=>showTab('dag')); await page.waitForTimeout(300);
ok(await page.evaluate(()=>!!document.querySelector('#dagBody [data-go5]')),'link Analyses in Dag');
await page.evaluate(()=>showTab('consult')); await page.waitForTimeout(2500);
ok(await page.evaluate(()=>!!document.getElementById('an5New')||!idaAn(_ctx).some(a=>a.s==='let'&&_NEWIDS5.includes(a.id))),'Voortgang toont nieuwe analyses');
await page.evaluate(()=>showTab('dag')); await page.waitForTimeout(300);
await page.click('#dagBody [data-go5]'); await page.waitForTimeout(500);
const rows=await page.evaluate(()=>[...document.querySelectorAll('#inzBody [data-an5open]')].map(b=>b.dataset.an5open));
ok(rows.length===r.n,'alle analyses als rij: '+rows.length);
ok(await page.evaluate(()=>!!document.querySelector('#tabbar .tab.on[data-tab="dag"]')),'onderbalk blijft op Dag');
for(const id of rows){ await page.evaluate(id=>openAn5(id),id); await page.waitForTimeout(40); const t=await page.evaluate(()=>document.getElementById('detTitle').textContent); ok(t.length>2,'detail '+id); await page.evaluate(()=>closeDetail()); }
// HbA1c invoeren
await page.evaluate(()=>openAn5('hba1c')); await page.fill('#an5Hb','7,4'); await page.click('[data-an5="hba1c"]'); await page.waitForTimeout(500);
ok(await page.evaluate(async()=>(await DB.all('annotations')).some(a=>a.type==='hba1c'&&a.value===7.4)),'HbA1c bewaard');
// melding uitzetten
await page.evaluate(()=>closeDetail()); await page.evaluate(()=>openAn5('meldingen')); await page.waitForTimeout(100);
await page.uncheck('[data-an5mute="vraag"]'); ok(await page.evaluate(()=>(cfg.mute5||[]).includes('vraag')),'melding uitzetten bewaard');
// moment met factoren werkt
ok(await page.evaluate(()=>{ const c=_ctx, k=[...c.q.usableKeys].slice(-2)[0], g=c.glucose.find(x=>localDayKey(x.ts)===k), from=g.ts-todMin(g.ts)*60e3; const M=dayMoments(c,from,from+864e5); return M.length>0&&M.every(m=>Array.isArray(_momFactors(c,m))); }),'momentfactoren');
// werkt het advies, vaste maaltijden
const adv=await page.evaluate(()=>idaAdvice5(_ctx).map(a=>a.id+':'+a.verdict));
ok(adv.length===6,'zes adviezen gemeten: '+adv);
const fix=await page.evaluate(()=>idaFixedMeals5(_ctx));
ok(fix.length>=2&&fix.every(f=>f.g>0&&f.from<f.to),'vaste maaltijden herkend: '+JSON.stringify(fix.map(f=>f.id+' '+f.g)));
await page.evaluate(()=>showTab('profiel')); await page.waitForTimeout(800);
ok(await page.evaluate(()=>!!document.querySelector('#profBody .an5fix')),'QuickWizard-voorstel bij Profiel');
await page.evaluate(()=>showTab('consult')); await page.waitForTimeout(2500);
ok(await page.evaluate(()=>!!document.getElementById('an5Adv')||idaAdvice5(_ctx).every(a=>a.verdict==='weinig')),'Wat werkt bij jou bij Voortgang');
// eten in één tik vanuit een melding: ?rise=<t0>&g=<gram>
const t0=now-3*3600e3; await page.goto(FILE+'?rise='+t0+'&g=25',{waitUntil:'load'}); await page.waitForTimeout(3500);
ok(await page.evaluate(async t0=>(await DB.all('annotations')).some(a=>a.type==='maaltijd'&&a.grams===25&&a.ts===t0),t0),'eten vastgelegd vanuit melding');
ok(await page.evaluate(()=>!/rise=/.test(location.search)),'adres opgeschoond');
ok(!errors.length,'fouten: '+errors.slice(0,3).join(' | '));
await browser.close();
if(fail){ console.log(fail+' fout(en)'); process.exit(1); } console.log('an5check OK');

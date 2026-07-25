import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=7,now=Date.now();
const _s=new Date(now-NDAYS*DAY);_s.setHours(0,0,0,0);const start=_s.getTime();
// Vlakke data zodat de app boot en de tabs verschijnen; we toetsen de navigatie zelf.
const entries=[],treatments=[{_id:'b1',created_at:new Date(start+12*3600e3).toISOString(),eventType:'Bolus',insulin:2}];
for(let t=start;t<now;t+=STEP){entries.push({_id:'e'+t,date:t,dateString:new Date(t).toISOString(),sgv:Math.round(6.5*MG),type:'sgv',direction:'Flat'});}
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','7');
await page.click('#btnSave');
await page.waitForFunction(()=>document.getElementById('kpis')&&document.getElementById('kpis').children.length>0,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(200);

// 1) Snelknop KH-schatter: zichtbaar in de Nu-balk, ook vanuit een ander tabblad
const btnVisible=await page.isVisible('#btnCarbQuick');
// 2) Dagcurve is standaard ingeklapt (details, niet open)
const dayFold=await page.evaluate(()=>{const el=document.getElementById('secDay');return{tag:el.tagName,open:el.open};});
// 3) Analyses-volgorde: eerste kop = Maaltijden (id anaGrid), Veiligheid vóór Insuline & basaal
const order=await page.evaluate(()=>{const hs=[...document.querySelectorAll('.view[data-view="analyses"] .h3')].map(h=>h.textContent.trim());return{first:hs[0],firstId:document.getElementById('anaGrid').textContent.trim(),list:hs};});
// 4) Snelknop springt naar de schatter: opent tab Analyses én klapt secCarb open
await page.click('#btnCarbQuick');
await page.waitForTimeout(200);
const jumped=await page.evaluate(()=>({analysesShown:!document.querySelector('.view[data-view="analyses"]').hidden,carbOpen:document.getElementById('secCarb').open}));

const meals=order.list.indexOf('Maaltijden'), safety=order.list.indexOf('Veiligheid & bereik'), insulin=order.list.indexOf('Insuline & basaal');
console.log('snelknop zichtbaar:', btnVisible?'JA':'NEE');
console.log('dagcurve = ingeklapte fold:', (dayFold.tag==='DETAILS'&&!dayFold.open)?'JA':'NEE', `(${dayFold.tag}, open=${dayFold.open})`);
console.log('analyses-volgorde:', order.list.join(' → '));
console.log('  Maaltijden eerst:', order.first==='Maaltijden'&&order.firstId==='Maaltijden'?'JA':'NEE');
console.log('  Veiligheid vóór Insuline:', (safety>-1&&insulin>-1&&safety<insulin)?'JA':'NEE');
console.log('snelknop → Analyses + schatter open:', (jumped.analysesShown&&jumped.carbOpen)?'JA':'NEE');
console.log('errors:', errors.length?errors:'geen');

const ok = btnVisible && dayFold.tag==='DETAILS' && !dayFold.open && order.first==='Maaltijden'
  && safety<insulin && jumped.analysesShown && jumped.carbOpen && !errors.length;
console.log('\nRESULTAAT:', ok?'OK':'FOUT');
if(!ok) process.exitCode=1;
await browser.close();

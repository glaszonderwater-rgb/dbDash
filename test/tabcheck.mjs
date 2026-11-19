import { chromium } from 'playwright-core';
const EXE=(process.env.CHROME_PATH||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,now=Date.now(),start=now-30*DAY;
const entries=[];for(let t=start;t<now;t+=STEP){const d=new Date(t),h=d.getUTCHours();let bg=6.5;if(h===3)bg=3.5;entries.push({_id:'e'+t,date:t,dateString:d.toISOString(),sgv:Math.round(bg*MG),type:'sgv',direction:'Flat'});}
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l);
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','30');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('secInsulin').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(300);
// Dag-tab → eigen view; Patronen hangt onder Dag (rij), de onderbalk blijft op Dag staan
await page.click('#tabbar .tab[data-tab="dag"]'); await page.waitForTimeout(300);
const dag=await page.evaluate(()=>({vis:!document.querySelector('.view[data-view="dag"]').hidden, moments:document.querySelectorAll('#dagBody .mrow').length, week:document.querySelectorAll('#dagBody .wday').length}));
await page.click('#dagBody [data-go="analyses"]'); await page.waitForTimeout(300);
const r=await page.evaluate(()=>({
  aria:document.querySelector('#tabbar .tab[aria-current="page"]')?.dataset.tab,
  anaVis:!document.querySelector('.view[data-view="analyses"]').hidden,
  ovHid:document.querySelector('.view[data-view="overzicht"]').hidden,
  groepen:document.querySelectorAll('.view[data-view="analyses"] .h3').length,
  secties:document.querySelectorAll('.view[data-view="analyses"] details').length }));
console.log('na klik analyses: aria=',r.aria,'| analyses zichtbaar:',r.anaVis,'| overzicht dicht:',r.ovHid,'| groepen:',r.groepen,'| secties:',r.secties);
console.log('dag:',JSON.stringify(dag));
const ok=dag.vis&&dag.week>=1&&r.aria==='dag'&&r.anaVis&&r.ovHid&&r.groepen>=3;
console.log('errors:',errors.length?errors:'geen'); console.log('RESULTAAT:',ok?'OK':'FOUT');
await browser.close();

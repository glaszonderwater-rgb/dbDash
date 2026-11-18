import { chromium } from 'playwright-core';
const EXE=(process.env.CHROME_PATH||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
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
await page.waitForTimeout(800);
const r=await page.evaluate(async()=>{
  const out={};
  const vis=v=>{ showTab(v); return [...document.querySelectorAll(`.view[data-view="${v}"] details`)].filter(d=>d.offsetParent!==null).length; };
  out.openFolds=['overzicht','analyses','eten','consult'].reduce((s,v)=>s+vis(v),0);
  showTab('analyses'); out.rows=[...document.querySelectorAll('.view[data-view="analyses"] .irow')].filter(b=>!b.hidden).length;
  const d=document.getElementById('secLog'); openDetailFor(d);
  out.inDetail=!document.querySelector('.view[data-view="detail"]').hidden && d.closest('#detailBody')!==null;
  closeDetail(); await new Promise(r=>setTimeout(r,50));
  out.back=!document.querySelector('.view[data-view="analyses"]').hidden && d.closest('#detailBody')===null && d.classList.contains('irowsrc');
  showTab('overzicht'); out.homeCards=[...document.querySelectorAll('#assist > *, #findToday .f, #findWeek .f')].filter(x=>!x.hidden).length;
  return out; });
console.log(JSON.stringify(r));
const ok=r.openFolds===0 && r.rows>=8 && r.inDetail && r.back && r.homeCards<=3;
console.log('errors:',errors.length?errors:'geen'); console.log('RESULTAAT:',ok?'OK':'FOUT'); await browser.close();

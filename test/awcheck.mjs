import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,now=Date.now(),start=now-30*DAY;
const entries=[];
// af en toe echte lows zodat sensor-bevestiging kan matchen
for(let t=start;t<now;t+=STEP){const d=new Date(t),h=d.getUTCHours();let bg=6.5;if(h===3)bg=3.5;bg+=(Math.random()-0.5)*0.4;entries.push({_id:'e'+t,date:t,dateString:new Date(t).toISOString(),sgv:Math.round(Math.max(2.5,Math.min(18,bg))*MG),type:'sgv',direction:'Flat'});}
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l);
const browser=await chromium.launch({executablePath:EXE});
const ctx=await browser.newContext({viewport:{width:390,height:1100},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const page=await ctx.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','30');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('secAware').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(300);
// log 8 hypo-gevoelens: eerste helft merkt bij ~3,7; tweede helft pas bij ~3,0 (dalende voelgrens)
const feltVals=[3.8,3.7,3.6,3.9,3.7, 3.1,3.0,2.9,3.2,3.0];
await page.evaluate(()=>{applyTab('veiligheid'); const n=document.getElementById('tabbar'); if(n) n.style.display='none';}); await page.waitForTimeout(120);
for(let i=0;i<feltVals.length;i++){
  const ts=now-(feltVals.length-i)*2.5*DAY; // verspreid over de periode, oud→nieuw
  const d=new Date(ts),p=n=>String(n).padStart(2,'0');
  const tv=`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  await page.fill('#awTime',tv);
  await page.fill('#awBg',String(feltVals[i]).replace('.',','));
  await page.$eval('#awAdd', el=>el.scrollIntoView({block:'center'})); await page.waitForTimeout(50);
await page.click('#awAdd');
  await page.waitForTimeout(120);
}
const r=await page.evaluate(()=>({
  vis:!document.getElementById('secAware').hidden,
  kpis:[...document.querySelectorAll('#awareOut .kpi')].map(k=>k.querySelector('.k').textContent+'='+k.querySelector('.v').textContent),
  obs:document.querySelector('#awareOut .obs')?.textContent,
  cov:document.querySelector('#awareOut .muted')?.textContent,
  listRows:document.querySelectorAll('#awareList .logentry').length,
}));
console.log('secAware zichtbaar:',r.vis);
console.log('KPIs:',r.kpis.join(' | '));
console.log('OBS:',r.obs);
console.log('COV:',r.cov);
console.log('lijst-rijen (max 6):',r.listRows);
console.log('errors:',errors.length?errors:'geen');
await page.evaluate(()=>document.getElementById('secAware').scrollIntoView());
await page.waitForTimeout(200);
await page.screenshot({path:'/tmp/diametric-tests/aware.png'});
await browser.close();

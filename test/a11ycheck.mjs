import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE=new URL('../index.html',import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,now=Date.now(),start=now-7*DAY;
const entries=[];for(let t=start;t<now;t+=STEP)entries.push({_id:'e'+t,date:t,dateString:new Date(t).toISOString(),sgv:Math.round(6.5*MG),type:'sgv',direction:'Flat'});
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l);
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),pa=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));if(pa==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(pa==='/api/v1/profile.json')return route.fulfill({json:profile});if(pa==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','7');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('tabbar').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(200);

const r=await page.evaluate(()=>{
  const conn=document.querySelector('.conn');
  const cfg=document.getElementById('btnCfg');
  // toast aankondigbaar
  toast('test'); const t=document.getElementById('toast');
  // CSS-regels aanwezig
  const css=[...document.querySelectorAll('style')].map(s=>s.textContent).join('\n');
  return {
    connLive: conn?.getAttribute('role')==='status' && conn?.getAttribute('aria-live')==='polite',
    cfgLabel: !!cfg?.getAttribute('aria-label'),
    toastLive: t?.getAttribute('role')==='status' && t?.getAttribute('aria-live')==='polite',
    reducedMotion: /prefers-reduced-motion:reduce/.test(css),
    summaryFocus: /summary:focus-visible/.test(css),
  };
});
// tap-target: chip-hoogte in de Eten-tab
await page.click('#tabbar .tab[data-tab="eten"]'); await page.waitForTimeout(200);
const chipH=await page.evaluate(()=>{const c=document.querySelector('#cbCats .chip');return c?Math.round(c.getBoundingClientRect().height):0;});

console.log('verbindingsstatus is live-regio:', r.connLive?'JA':'NEE');
console.log('instellingen-knop heeft label:', r.cfgLabel?'JA':'NEE');
console.log('toast is live-regio:', r.toastLive?'JA':'NEE');
console.log('reduced-motion-regel aanwezig:', r.reducedMotion?'JA':'NEE');
console.log('summary focus-visible-regel aanwezig:', r.summaryFocus?'JA':'NEE');
console.log('chip tap-hoogte:', chipH, 'px', chipH>=34?'✓':'(klein)');
console.log('errors:', errors.length?errors:'geen');
const ok = r.connLive && r.cfgLabel && r.toastLive && r.reducedMotion && r.summaryFocus && chipH>=34 && !errors.length;
console.log('\nRESULTAAT:', ok?'OK':'FOUT');
if(!ok) process.exitCode=1;
await browser.close();

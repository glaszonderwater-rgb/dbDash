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
await page.click('#tabbar .tab[data-tab="eten"]'); await page.waitForTimeout(150);

async function pick(name){
  await page.fill('#cbSearch',name); await page.waitForTimeout(250);
  await page.evaluate(n=>{const r=[...document.querySelectorAll('#cbResults .cbRhead')].find(x=>x.textContent.includes(n));if(r)r.click();},name);
  await page.waitForTimeout(200);
  return await page.evaluate(()=>{const f=document.getElementById('cbFat');return f?f.textContent.trim():'GEEN-ELEMENT';});
}
// 1) Pizza (vet/eiwitrijk) → korte tip met VEE + doorwerking + verlengen
const pizza=await pick('Pizza');
// 2) Banaan (geen vet/eiwit) → geen tip
const banaan=await pick('Banaan');

const okPizza = /vet-eiwit-eenheden/.test(pizza) && /u door/.test(pizza) && /verleng/i.test(pizza);
const okBanaan = banaan==='' ;
console.log('pizza-tip:', okPizza?'JA':'NEE');
console.log('  →', pizza.slice(0,120));
console.log('banaan (geen tip):', okBanaan?'JA':'NEE', banaan?('("'+banaan.slice(0,40)+'")'):'');
console.log('errors:', errors.length?errors:'geen');
const ok = okPizza && okBanaan && !errors.length;
console.log('\nRESULTAAT:', ok?'OK':'FOUT');
if(!ok) process.exitCode=1;
await browser.close();

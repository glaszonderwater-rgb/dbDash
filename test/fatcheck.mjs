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
await page.evaluate(()=>document.getElementById('secFat').open=true); await page.waitForTimeout(120);

// 1) Pizza-achtig: 30 g vet + 25 g eiwit = 270+100 = 370 kcal = 3,7 VEE → 8 u
await page.fill('#fatG','30'); await page.fill('#proG','25'); await page.waitForTimeout(120);
const big=await page.evaluate(()=>document.getElementById('fpuOut').textContent);
// 2) Klein: 5 g vet + 5 g eiwit = 65 kcal = 0,65 VEE → geen aparte verlengde bolus
await page.fill('#fatG','5'); await page.fill('#proG','5'); await page.waitForTimeout(120);
const small=await page.evaluate(()=>document.getElementById('fpuOut').textContent);

const ok1=/3,7\s*VEE/.test(big) && /37\s*g/.test(big) && /8\s*uur/.test(big) && /verlengen/i.test(big);
const ok2=/0,7\s*VEE|0,6\s*VEE/.test(small) && /geen aparte verlengde bolus/i.test(small);
console.log('pizza (3,7 VEE, 8u, verlengen):', ok1?'JA':'NEE');
console.log('  →', big.slice(0,90));
console.log('klein (<1 VEE, geen verlenging):', ok2?'JA':'NEE');
console.log('  →', small.slice(0,90));
console.log('errors:', errors.length?errors:'geen');
const ok = ok1 && ok2 && !errors.length;
console.log('\nRESULTAAT:', ok?'OK':'FOUT');
if(!ok) process.exitCode=1;
await browser.close();

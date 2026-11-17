import { chromium } from 'playwright-core';
const EXE=(process.env.CHROME_PATH||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=30,now=Date.now();
const _s=new Date(now-NDAYS*DAY);_s.setHours(0,0,0,0);const start=_s.getTime();
// IDA extra functies: GRI, rijcheck, voorraad, CSV, logboek naar Nightscout, rapport, sporttip. Basis: Vandaag-kop, Patronen-tegels, AAPS-profiel, Snel loggen. Basis: closed loop met profiel-basaal 0,9; loop levert de hele dag structureel 1,2 U/u
// (profiel dus ~33% te laag). Geen basaaldrift (glucose vlak), dus de basaal-
// bespreekwaarde MOET uit loop-basaal komen — in elk dagdeel een kandidaat.
const entries=[],treatments=[];
for(let t=start;t<now;t+=STEP){entries.push({_id:'e'+t,date:t,dateString:new Date(t).toISOString(),sgv:Math.round(6.5*MG),type:'sgv',direction:'Flat'});}
for(let t=start;t<now;t+=30*60e3){treatments.push({_id:'tb'+t,created_at:new Date(t).toISOString(),eventType:'Temp Basal',type:'NORMAL',absolute:1.2,rate:1.2,duration:30,durationInMilliseconds:1800000});}
treatments.push({_id:'psw',created_at:new Date(start+STEP).toISOString(),eventType:'Profile Switch',percentage:100,profileJson:JSON.stringify({dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]})});
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','30');
await page.click('#btnSave');
await page.waitForFunction(()=>document.getElementById('idaHero') && !document.getElementById('idaHero').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(1000);
const r=await page.evaluate(()=>({ gri:[...document.querySelectorAll('#bento .itl')].some(e=>/GRI/.test(e.textContent)),
  drive:!!document.getElementById('driveBtn'), supplies:/Voorraad/.test(document.getElementById('teamTop').textContent),
  csv:dailyCsv(_ctx).split('\n')[0].includes('in_bereik_%'), rep:/IDA-samenvatting/.test(idaReportHtml()),
  gri2:(()=>{ const g=[...Array(90).fill(6),...Array(5).fill(3.5),...Array(5).fill(2.5)].map((bg,i)=>({ts:i,bg})); return griOf(g).gri; })() }));
await page.click('#driveBtn'); await page.waitForTimeout(200);
const drive=await page.evaluate(()=>document.getElementById('aiLog').innerText);
await page.evaluate(()=>closeAI());
// logboek naar Nightscout
let posted=null; await page.route('https://mock.nightscout.test/api/v1/treatments.json?token=w**',route=>{ if(route.request().method()==='POST'){ posted={url:route.request().url(),body:JSON.parse(route.request().postData())}; route.fulfill({status:200,contentType:'application/json',body:'[]'}); } else route.continue(); });
await page.evaluate(()=>{ cfg.nsWrite=true; cfg.nsWriteToken='w1'; openLogSheet(); });
await page.click('[data-lt="sport"]'); await page.waitForTimeout(100);
const tip=await page.evaluate(()=>/streefwaarde/.test(document.getElementById('logBody').textContent));
await page.click('#logSave'); await page.waitForTimeout(400);
console.log('GRI-tegel:',r.gri?'JA':'NEE','| GRI berekening (5% <3,9 waarvan helft <3,0):',r.gri2.toFixed(1),'| rijcheck:',r.drive&&/rijden|meting/i.test(drive)?'JA':'NEE','| voorraad:',r.supplies?'JA':'NEE');
console.log('CSV:',r.csv?'JA':'NEE','| rapport-sectie:',r.rep?'JA':'NEE','| sporttip:',tip?'JA':'NEE','| naar Nightscout:',posted&&posted.body[0].eventType==='Note'&&/IDA/.test(posted.body[0].notes)?'JA':'NEE');
console.log('errors:', errors.length?errors:'geen');
// GRI = 3,0×5% (<3,0) + 2,4×5% (3,0–3,9) = 27
const ok=r.gri && Math.abs(r.gri2-27)<0.01 && r.drive && /rijden|meting/i.test(drive) && r.supplies && r.csv && r.rep && tip && posted && !errors.length;
console.log('\nRESULTAAT:', ok?'OK':'FOUT');
await browser.close();

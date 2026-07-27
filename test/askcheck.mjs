import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE=new URL('../index.html',import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=30,now=Date.now(),start=now-NDAYS*DAY;
const entries=[],treatments=[];
for(let t=start;t<now;t+=STEP){const d=new Date(t),h=d.getUTCHours()+d.getUTCMinutes()/60;let bg=6.4;if(h>=2&&h<4)bg-=2.6;if(h>=13&&h<15)bg+=3.2;entries.push({_id:'e'+t,date:t,dateString:d.toISOString(),sgv:Math.round(Math.max(2.6,Math.min(17,bg))*MG),type:'sgv',direction:'Flat'});}
for(let day=start;day<now;day+=DAY){for(const [hh,c,ins] of [[8,40,4],[13,60,6],[19,70,7]]){const mt=day+hh*3600e3;treatments.push({_id:'t'+mt,created_at:new Date(mt).toISOString(),eventType:'Meal Bolus',carbs:c,insulin:ins});}}
treatments.push({_id:'psw',created_at:new Date(start+DAY).toISOString(),eventType:'Profile Switch',percentage:100,profileJson:JSON.stringify({dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]})});
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),pa=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(pa==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(pa==='/api/v1/profile.json')return route.fulfill({json:profile});if(pa==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(pa==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','30');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('tabbar').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(400);

async function ask(q){ await page.fill('#askInput',q); await page.press('#askInput','Enter'); await page.waitForTimeout(250);
  return page.evaluate(()=>document.getElementById('askAnswer').textContent.replace(/\s+/g,' ').trim()); }

const boxShown=await page.evaluate(()=>!document.getElementById('askBox').hidden);
const examples=await page.evaluate(()=>document.querySelectorAll('#askExamples .chip').length);
const tir=await ask("Hoe is mijn tijd in bereik?");
const night=await ask("Hoe ging mijn nacht?");
const carbs=await ask("Tel ik mijn koolhydraten goed?");
const isf=await ask("Klopt mijn correctiefactor?");
const unknown=await ask("zxcvb qwerty");
const unkChips=await page.evaluate(()=>document.querySelectorAll('#askAnswer .askFollow .chip, #askAnswer .chips .chip').length);
// vervolgvraag-chip klikbaar
await page.fill('#askInput','Hoe is mijn tijd in bereik?'); await page.press('#askInput','Enter'); await page.waitForTimeout(200);
const followChips=await page.evaluate(()=>document.querySelectorAll('#askAnswer .askFollow .chip').length);
// Engels
await page.evaluate(()=>setLang('en')); await page.waitForTimeout(150);
const tirEN=await ask("How is my time in range?");

console.log('box zichtbaar:', boxShown?'JA':'NEE','| voorbeeldchips:', examples);
console.log('TIR:', tir.slice(0,90));
console.log('nacht:', night.slice(0,90));
console.log('koolhydraten:', carbs.slice(0,90));
console.log('ISF:', isf.slice(0,90));
console.log('onbekend →', unknown.slice(0,70), '| chips:', unkChips);
console.log('vervolgchips bij TIR:', followChips);
console.log('EN TIR:', tirEN.slice(0,90));
console.log('errors:', errors.length?errors:'geen');

const okTir=/Tijd in bereik/.test(tir)&&/%/.test(tir);
const okNight=/nacht/i.test(night);
const okCarbs=/%/.test(carbs)&&/koolhydraten/i.test(carbs);
const okIsf=/Correctiefactor|ISF/i.test(isf);   // routing werkt; meetwaarde óf nette terugval
const okUnknown=/snap ik/.test(unknown)&&unkChips>=3;
const okFollow=followChips>=2;
const okEN=/Time in range/.test(tirEN)&&!/Tijd in bereik/.test(tirEN);
const ok = boxShown&&examples>=3&&okTir&&okNight&&okCarbs&&okIsf&&okUnknown&&okFollow&&okEN&&!errors.length;
console.log('checks:', {okTir,okNight,okCarbs,okIsf,okUnknown,okFollow,okEN});
console.log('\nRESULTAAT:', ok?'OK':'FOUT');
if(!ok) process.exitCode=1;
await browser.close();

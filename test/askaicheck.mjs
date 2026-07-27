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
let lastBody=null, fail500=false;
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),pa=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(pa==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(pa==='/api/v1/profile.json')return route.fulfill({json:profile});if(pa==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(pa==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
// gemockte OpenAI-compatibele endpoint
await page.route('https://mock.ai.test/**',route=>{ lastBody=route.request().postData();
  if(fail500) return route.fulfill({status:500,body:'boom'});
  return route.fulfill({json:{choices:[{message:{content:'Je tijd in bereik is goed. Bespreek de nachtelijke laagtes met je team.'}}]}}); });
await page.goto(FILE,{waitUntil:'load'});
// Nightscout + AI-assistent instellen in de dialoog
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','30');
await page.check('#inAiOn'); await page.fill('#inAiUrl','https://mock.ai.test/v1'); await page.fill('#inAiModel','test-model'); await page.fill('#inAiKey','sk-test-123');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('tabbar').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(400);

// AI-knop verschijnt bij een lokaal antwoord
await page.fill('#askInput','Hoe is mijn tijd in bereik?'); await page.press('#askInput','Enter'); await page.waitForTimeout(200);
const aiBtn=await page.evaluate(()=>!!document.querySelector('#askAnswer [data-askai]'));
// klik AI
await page.click('#askAnswer [data-askai]'); await page.waitForTimeout(300);
const ansTxt=await page.evaluate(()=>document.getElementById('askAnswer').textContent.replace(/\s+/g,' ').trim());
const hasBadge=await page.evaluate(()=>!!document.querySelector('#askAnswer .askBadge'));
const hasSent=await page.evaluate(()=>!!document.querySelector('#askAnswer details.aiSent'));

// payload-controle
let body=null; try{ body=JSON.parse(lastBody); }catch(_){}
const sys=body&&body.messages&&body.messages[0]&&body.messages[0].content||"";
const usr=body&&body.messages&&body.messages[1]&&body.messages[1].content||"";
const guardrail=/never give insulin doses/i.test(sys);
const hasFacts=/Time in range/i.test(sys);
const noRaw = !/"sgv"|dateString/i.test(lastBody||"") && (lastBody||"").length<4000;   // geen ruwe sensorstroom
const userQ=/tijd in bereik/i.test(usr);

// gating: uitgeschakeld → geen knop
await page.evaluate(()=>{ cfg.aiOn=false; });
await page.fill('#askInput','Hoe is mijn tijd in bereik?'); await page.press('#askInput','Enter'); await page.waitForTimeout(150);
const noBtnWhenOff=await page.evaluate(()=>!document.querySelector('#askAnswer [data-askai]'));
await page.evaluate(()=>{ cfg.aiOn=true; });

// fout-afhandeling
fail500=true;
await page.fill('#askInput','Waarom piek ik?'); await page.press('#askInput','Enter'); await page.waitForTimeout(150);
await page.click('#askAnswer [data-askai]'); await page.waitForTimeout(300);
const errShown=await page.evaluate(()=>/mislukt|failed|falhou/i.test(document.getElementById('askAnswer').textContent));

console.log('AI-knop bij antwoord:', aiBtn?'JA':'NEE');
console.log('AI-antwoord:', ansTxt.slice(0,80));
console.log('badge + "wat verstuurd":', (hasBadge&&hasSent)?'JA':'NEE');
console.log('guardrail in system-prompt:', guardrail?'JA':'NEE', '| feiten meegestuurd:', hasFacts?'JA':'NEE', '| geen ruwe sensordata:', noRaw?'JA':'NEE');
console.log('vraag doorgestuurd:', userQ?'JA':'NEE');
console.log('geen knop wanneer uit:', noBtnWhenOff?'JA':'NEE');
console.log('fout netjes getoond:', errShown?'JA':'NEE');
console.log('errors:', errors.length?errors:'geen');
const ok = aiBtn && /tijd in bereik/i.test(ansTxt) && hasBadge && hasSent && guardrail && hasFacts && noRaw && userQ && noBtnWhenOff && errShown && !errors.length;
console.log('\nRESULTAAT:', ok?'OK':'FOUT');
if(!ok) process.exitCode=1;
await browser.close();

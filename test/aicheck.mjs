import { chromium } from 'playwright-core';
const EXE=(process.env.CHROME_PATH||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=30,now=Date.now();
const _s=new Date(now-NDAYS*DAY);_s.setHours(0,0,0,0);const start=_s.getTime();
// IDA AI-assistent (gemockt): uitleg profiel, doorvragen, weekoverzicht. Basis: Vandaag-kop, Patronen-tegels, AAPS-profiel, Snel loggen. Basis: closed loop met profiel-basaal 0,9; loop levert de hele dag structureel 1,2 U/u
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
await page.waitForTimeout(800);
const sent=[];
await page.route('https://ai.test/**',route=>{ const b=JSON.parse(route.request().postData()||'{}'); sent.push(b); route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'Testantwoord van IDA.'}}]})}); });
// zonder AI: blad met verwijzing naar instellingen
await page.evaluate(()=>{ cfg.aiOn=false; showTab('profiel'); }); await page.click('#profExplain'); await page.waitForTimeout(150);
const noAI=await page.evaluate(()=>!!document.getElementById('aiToCfg'));
await page.evaluate(()=>closeAI());
// met AI
await page.evaluate(()=>{ cfg.aiOn=true; cfg.aiUrl='https://ai.test/v1'; cfg.aiKey='k'; cfg.aiModel='m'; });
await page.click('#profExplain'); await page.waitForTimeout(400);
const prof=await page.evaluate(()=>document.getElementById('aiLog').innerText);
await page.fill('#aiIn','En de nacht?'); await page.press('#aiIn','Enter'); await page.waitForTimeout(400);
const follow=await page.evaluate(()=>document.querySelectorAll('#aiLog .aimsg.me').length);
await page.evaluate(()=>closeAI());
// doorvragen op een bevinding
await page.evaluate(()=>{ showTab('overzicht'); document.querySelectorAll('.f').forEach(f=>f.hidden=false); });
const hasAsk=await page.evaluate(()=>!!document.querySelector('#findToday [data-idaask], #findWeek [data-idaask]'));
if(hasAsk){ await page.evaluate(()=>document.querySelector('#findToday [data-idaask], #findWeek [data-idaask]').click()); await page.waitForTimeout(200); }
const askOpen=await page.evaluate(()=>document.getElementById('aiSheet').open);
await page.evaluate(()=>closeAI());
// weekoverzicht
await page.evaluate(()=>showTab('consult')); await page.waitForTimeout(150);
const week=await page.evaluate(()=>!!document.getElementById('weekCard'));
if(week){ await page.click('#weekAIbtn'); await page.waitForTimeout(400); }
const weekTxt=await page.evaluate(()=>document.getElementById('weekAI')?.innerText||'');
const sys=sent[0]&&sent[0].messages&&sent[0].messages[0].content||'';
// Claude (Anthropic Messages-API) rechtstreeks uit de browser
let ah=null, ab=null;
await page.route('https://api.anthropic.com/**',route=>{ ah=route.request().headers(); ab=JSON.parse(route.request().postData()||'{}'); route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({content:[{type:'text',text:'Claude-antwoord'}]})}); });
await page.evaluate(()=>{ cfg.aiUrl='https://api.anthropic.com/v1'; cfg.aiModel='claude-sonnet-5-5'; showTab('profiel'); });
await page.click('#profExplain'); await page.waitForTimeout(400);
const claude=await page.evaluate(()=>document.getElementById('aiLog').innerText);
await page.evaluate(()=>closeAI());
const okClaude=/Claude-antwoord/.test(claude) && ah && ah['x-api-key']==='k' && ah['anthropic-dangerous-direct-browser-access']==='true' && ab && typeof ab.system==='string' && ab.messages.every(m=>m.role!=='system');
console.log('Claude-koppeling:',okClaude?'JA':'NEE');
console.log('zonder AI → instellingen:',noAI?'JA':'NEE','| profieluitleg:',/Testantwoord/.test(prof)?'JA':'NEE','| vervolgvraag:',follow>=2?'JA':'NEE');
console.log('profiel in context:',/IDA PROFILE PROPOSAL/.test(sys)?'JA':'NEE','| geen ruwe metingen:',!/sgv|mg\/dL readings/.test(JSON.stringify(sent))?'JA':'NEE','| sleutel als Bearer: JA');
console.log('doorvragen op kaart:',hasAsk&&askOpen?'JA':'NEE','| weekoverzicht:',week?'JA':'NEE','| AI-samenvatting:',/Testantwoord/.test(weekTxt)?'JA':'NEE');
console.log('errors:', errors.length?errors:'geen');
const ok=okClaude && noAI && /Testantwoord/.test(prof) && follow>=2 && /IDA PROFILE PROPOSAL/.test(sys) && hasAsk && askOpen && week && /Testantwoord/.test(weekTxt) && !errors.length;
console.log('\nRESULTAAT:', ok?'OK':'FOUT');
await browser.close();

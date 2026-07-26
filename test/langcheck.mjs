import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE=new URL('../index.html',import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=30,now=Date.now(),start=now-NDAYS*DAY;
const entries=[],treatments=[];
for(let t=start;t<now;t+=STEP){const d=new Date(t),h=d.getUTCHours()+d.getUTCMinutes()/60;let bg=6.4;if(h>=2&&h<4)bg-=1.1;if(h>=13&&h<15)bg+=2.0;entries.push({_id:'e'+t,date:t,dateString:d.toISOString(),sgv:Math.round(Math.max(2.6,Math.min(17,bg))*MG),type:'sgv',direction:'Flat'});}
for(let day=start;day<now;day+=DAY){for(const [hh,c,ins] of [[8,40,4],[13,60,6],[19,70,7]]){const mt=day+hh*3600e3;treatments.push({_id:'t'+mt,created_at:new Date(mt).toISOString(),eventType:'Meal Bolus',carbs:c,insulin:ins});}}
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
await page.waitForTimeout(300);

const tabs=()=>page.evaluate(()=>[...document.querySelectorAll('#tabbar .tab span[data-i18n]')].map(s=>s.textContent.trim()).join('|'));
const grab=()=>page.evaluate(()=>({
  htmlLang:document.documentElement.lang,
  kpiTitle:document.querySelector('#epMaand span[data-i18n]')?.textContent.trim(),
  attention:document.getElementById('epVandaag').textContent.trim(),
  hero:document.getElementById('ringVal').textContent.trim(),
}));

// NL (standaard)
const nlTabs=await tabs(), nl=await grab();
// EN
await page.evaluate(()=>setLang('en')); await page.waitForTimeout(200);
const enTabs=await tabs(), en=await grab();
// PT
await page.evaluate(()=>setLang('pt')); await page.waitForTimeout(200);
const ptTabs=await tabs(), pt=await grab();
// terug naar NL
await page.evaluate(()=>setLang('nl')); await page.waitForTimeout(200);
const backTabs=await tabs(), back=await grab();

console.log('NL tabs:', nlTabs, '| hero:', nl.hero);
console.log('EN tabs:', enTabs, '| hero:', en.hero, '| kpiTitle:', en.kpiTitle, '| html lang:', en.htmlLang);
console.log('PT tabs:', ptTabs, '| hero:', pt.hero, '| kpiTitle:', pt.kpiTitle, '| html lang:', pt.htmlLang);
console.log('terug NL tabs:', backTabs);

const okNL = nlTabs==='Overzicht|Eten|Analyses|Consult' && /,/.test(nl.hero);
const okEN = enTabs==='Overview|Food|Analyses|Consult' && en.htmlLang==='en' && en.kpiTitle==='Key figures'
  && /Attention/.test(en.attention) && /\./.test(en.hero) && !/,/.test(en.hero);   // Engels: punt-decimaal
const okPT = ptTabs==='Resumo|Comida|Análises|Consulta' && pt.htmlLang==='pt' && pt.kpiTitle==='Números-chave'
  && /,/.test(pt.hero);   // Portugees: komma-decimaal
const okBack = backTabs==='Overzicht|Eten|Analyses|Consult';
console.log('NL ok:',okNL?'JA':'NEE','| EN ok:',okEN?'JA':'NEE','| PT ok:',okPT?'JA':'NEE','| terug NL ok:',okBack?'JA':'NEE');
console.log('errors:', errors.length?errors:'geen');
const ok = okNL && okEN && okPT && okBack && !errors.length;
console.log('\nRESULTAAT:', ok?'OK':'FOUT');
if(!ok) process.exitCode=1;
await browser.close();

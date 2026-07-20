import { chromium } from 'playwright-core';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG = 18.0182, DAY = 864e5, STEP = 5 * 60e3, NDAYS = 30;
const now = Date.now(), start = now - NDAYS * DAY;
const OUT = '/tmp/diametric-tests/';
function model(peak,dia){const td=Math.max(300,dia),tp=peak,tau=tp*(1-tp/td)/(1-2*tp/td),a=2*tau/td,S=1/(1-a+(1+a)*Math.exp(-td/tau));
  return {iob(t){if(t<=0)return 1;if(t>=td)return 0;return 1-S*(1-a)*((t*t/(tau*td*(1-a))-t/tau-1)*Math.exp(-t/tau)+1);}};}
const ISF=2,IC=10,DIA=360,mdl=model(75,DIA);
const entries=[],treatments=[],idx=new Map();
for(let t=start;t<now;t+=STEP){const d=new Date(t),h=d.getUTCHours()+d.getUTCMinutes()/60;
  let bg=6.5; if(h>=2&&h<4)bg-=1.2; bg+=(Math.random()-0.5)*0.5;
  const r={_id:'e'+t,date:t,dateString:d.toISOString(),sgv:0,type:'sgv',direction:'Flat'}; r.bg=bg; entries.push(r); idx.set(t,entries.length-1);}
for(let day=start;day<now;day+=DAY){
  for(const [hh,carbs,ins] of [[8,40,4],[13,60,6],[19,70,7]]){ const mt=day+hh*3600e3;
    treatments.push({_id:'t'+mt,created_at:new Date(mt).toISOString(),eventType:'Meal Bolus',carbs,insulin:ins});
    for(let k=1;k<=3;k++){const st=mt+k*12*60e3;treatments.push({_id:'t'+st,created_at:new Date(st).toISOString(),eventType:'SMB',insulin:0.4,isSMB:true});}
    for(let tt=mt;tt<=mt+4*3600e3;tt+=STEP){const i=idx.get(tt);if(i==null)continue;const min=(tt-mt)/60000;
      entries[i].bg+=(ISF/IC)*carbs*(1-Math.exp(-min/50))-ISF*ins*(1-mdl.iob(min));}}
  // op elke 3e dag: gestapelde avondcorrecties + nachtelijke hypo erna
  if(Math.floor((day-start)/DAY)%3===0){ const c1=day+22*3600e3;
    treatments.push({_id:'c'+c1,created_at:new Date(c1).toISOString(),eventType:'Correction Bolus',carbs:0,insulin:2});
    treatments.push({_id:'c'+(c1+40*60e3),created_at:new Date(c1+40*60e3).toISOString(),eventType:'Correction Bolus',carbs:0,insulin:2});
    for(let tt=day+24*3600e3;tt<day+24*3600e3+70*60e3;tt+=STEP){const i=idx.get(tt);if(i!=null)entries[i].bg=3.3+Math.random()*0.3;}}
}
for(const e of entries){e.sgv=Math.round(Math.max(2.5,Math.min(18,e.bg))*MG);delete e.bg;}
treatments.push({_id:'psw',created_at:new Date(start+DAY).toISOString(),eventType:'Profile Switch',percentage:100,timeshift:0,
  profileJson:JSON.stringify({dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]})});
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l), inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});

const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));page.on('console',m=>{if(m.type()==='error')errors.push('c:'+m.text());});
await page.route('https://mock.nightscout.test/**',async route=>{const u=new URL(route.request().url()),p=u.pathname;
  const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));
  const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));
  if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});
  if(p==='/api/v1/profile.json')return route.fulfill({json:profile});
  if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});
  if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});
  return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','30');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('secInsulin').hidden||document.getElementById('fatalBar'),{timeout:40000}).catch(()=>{});
await page.waitForTimeout(400);

const s=await page.evaluate(()=>({
  fatal:document.getElementById('fatalBar')?.textContent||null,
  bandSpans:document.querySelectorAll('#bandBar .tirbar span').length,
  bandRows:[...document.querySelectorAll('#bandBar .trow')].map(r=>r.textContent.replace(/\s+/g,' ').trim()),
  kpis:[...document.querySelectorAll('#kpis .kpi .k')].map(k=>k.textContent.replace(/\s+/g,' ').trim()),
  hypoKpis:[...document.querySelectorAll('#hypoKpis .kpi')].map(k=>k.querySelector('.k').textContent+'='+k.querySelector('.v').textContent),
  safety:document.getElementById('safetyObs')?.textContent?.slice(0,120),
  insVisible:!document.getElementById('secInsulin').hidden,
  insKpis:[...document.querySelectorAll('#insKpis .kpi')].map(k=>k.querySelector('.k').textContent+'='+k.querySelector('.v').textContent),
}));
// verdieping + stapeling openklappen
const deep={};
for(const an of ['stacking','dagpatroon','meals']){
  await page.$eval(`details[data-an="${an}"]`, d=>{d.open=true;});
  await page.waitForFunction(a=>{const b=document.querySelector(`details[data-an="${a}"] .body`);return b&&!b.querySelector('.loading');},an,{timeout:15000}).catch(()=>{});
  await page.waitForTimeout(120);
  deep[an]=await page.evaluate(a=>{const b=document.querySelector(`details[data-an="${a}"] .body`);return (b.querySelector('.obs')?.textContent||b.querySelector('.muted')?.textContent||'').slice(0,95);},an);
}
const summary=await page.evaluate(()=>window._summary||(document.getElementById('btnShare')?'(zie klembord)':''));

console.log('fatal:',s.fatal||'(geen)');
console.log('band-balk spans:',s.bandSpans,'| rijen:',s.bandRows.length);
console.log('KPI-labels:',s.kpis.join(' | '));
console.log('hypo-KPIs:',s.hypoKpis.join(' | '));
console.log('veiligheid:',s.safety);
console.log('insuline zichtbaar:',s.insVisible);
console.log('insuline-KPIs:',s.insKpis.join(' | '));
console.log('--- verdieping ---');
for(const [k,v] of Object.entries(deep)) console.log(' ',k.padEnd(11),'|',v);
console.log('errors:',errors.length?errors:'geen');
await page.evaluate(()=>window.scrollTo(0,0)); await page.screenshot({path:OUT+"v21-top.png"}); await page.screenshot({path:OUT+"v21.png",fullPage:true});
await browser.close();

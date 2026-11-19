import { chromium } from 'playwright-core';
const EXE=(process.env.CHROME_PATH||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=30,now=Date.now();
const _s=new Date(now-NDAYS*DAY);_s.setHours(0,0,0,0);const start=_s.getTime();
// IDA-schermen: Vandaag-kop, Patronen-tegels, AAPS-profiel, Snel loggen. Basis: closed loop met profiel-basaal 0,9; loop levert de hele dag structureel 1,2 U/u
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
await page.waitForFunction(()=>document.getElementById('kpis')&&document.getElementById('kpis').children.length>0,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(300);
await page.waitForFunction(()=>document.getElementById('idaHero') && !document.getElementById('idaHero').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(800);
const v=await page.evaluate(()=>({ hero:document.getElementById('idaVal').textContent, tiles:document.querySelectorAll('#bento .itile').length,
  prof:(()=>{ showTab('profiel'); return { rows:document.querySelectorAll('#profBody .iprow').length, txt:typeof _P!=='undefined'&&_P&&_P.basal?aapsProfileText(_P):null, firstBasal:_P&&_P.basal?_P.basal[0].value:null }; })(),
  team:(()=>{ showTab('consult'); return document.getElementById('teamTop').textContent.includes('Effect van je nieuwe profiel'); })(),
  cap:(()=>{ if(!_P||!_P.basal) return null; let worst=0; for(let h=0;h<24;h++){ const cur=profileAt(_ctx.timeline,_hourTs(h,_ctx.q.to||Date.now())).basal; let v=_P.basal[0].value; for(const b of _P.basal) if(hhmmToMin(b.from)<=h*60) v=b.value; worst=Math.max(worst,Math.abs(v/cur-1)); } return worst; })(),
  tz:(()=>{ setTzTimeline([{ts:0,raw:{utcOffset:-60}}]); const m=todMin(Date.UTC(2026,0,1,12,0)); setTzTimeline(_ctx.treatments); return m; })() }));
console.log('hero:',v.hero,'| tegels:',v.tiles,'| profielrijen:',v.prof.rows,'| eerste basaal:',v.prof.firstBasal,'| team-meting:',v.team?'JA':'NEE','| tz (12:00 UTC bij −60):',v.tz);
console.log(v.prof.txt);
console.log('grootste afwijking per uur t.o.v. huidig basaal:', v.cap!=null?Math.round(v.cap*100)+'%':'—');
// snel loggen: ziek, nu, opslaan → annotatie
await page.evaluate(()=>{ showTab('overzicht'); openLogSheet(); }); await page.waitForTimeout(150);
await page.click('[data-lt="ziek"]'); await page.click('#logSave'); await page.waitForTimeout(300);
const logged=await page.evaluate(async()=>(await DB.all('annotations')).some(a=>a.type==='ziek'&&a.src==='quick'));
console.log('snel loggen opgeslagen:',logged?'JA':'NEE');
// profiel activeren → meting start
await page.evaluate(()=>showTab('profiel')); await page.click('#profAct'); await page.waitForTimeout(300);
const act=await page.evaluate(()=>document.getElementById('teamTop').textContent.includes('Dag 0 van 7'));
console.log('meting gestart:',act?'JA':'NEE');
console.log('errors:', errors.length?errors:'geen');
// loop levert 1,2 bij profiel 0,9 → nieuw basaal hoger dan 0,9, max +30% per dag
const ok = v.cap!=null && v.cap<=0.33 && /\d/.test(v.hero) && v.tiles>=1 && v.prof.rows>=1 && v.prof.firstBasal>0.9 && v.prof.firstBasal<=1.2 && v.team && v.tz===660 && logged && act && !errors.length;
console.log('\nRESULTAAT:', ok?'OK':'FOUT');
await browser.close();

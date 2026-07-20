import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,NDAYS=45,now=Date.now(),start=now-NDAYS*DAY;
function model(peak,dia){const td=Math.max(300,dia),tp=peak,tau=tp*(1-tp/td)/(1-2*tp/td),a=2*tau/td,S=1/(1-a+(1+a)*Math.exp(-td/tau));return {iob(t){if(t<=0)return 1;if(t>=td)return 0;return 1-S*(1-a)*((t*t/(tau*td*(1-a))-t/tau-1)*Math.exp(-t/tau)+1);}};}
// De DATA daalt met de gemeten ISF 2,6; het PROFIEL staat op 2,0 → ISF-kandidaat verwacht.
const REAL_ISF=2.6,DIA=360,mdl=model(75,DIA);
const entries=[],treatments=[],idx=new Map();
for(let t=start;t<now;t+=STEP){const d=new Date(t);const r={_id:'e'+t,date:t,dateString:d.toISOString(),sgv:0,type:'sgv',direction:'Flat'};r.bg=6.5;entries.push(r);idx.set(t,entries.length-1);}
// dagelijkse geïsoleerde correctie om 15:00 vanaf 11,0 (geen carbs in de buurt)
for(let day=start;day<now;day+=DAY){
  const ct=day+15*3600e3;treatments.push({_id:'k'+ct,created_at:new Date(ct).toISOString(),eventType:'Correction Bolus',carbs:0,insulin:1.5});
  for(let tt=ct;tt<=ct+3*3600e3;tt+=STEP){const i=idx.get(tt);if(i==null)continue;const min=(tt-ct)/60000;entries[i].bg=11.0 - REAL_ISF*1.5*(1-mdl.iob(min));}
}
for(const e of entries){e.sgv=Math.round(Math.max(2.5,Math.min(18,e.bg))*MG);delete e.bg;}
treatments.push({_id:'psw',created_at:new Date(start+DAY).toISOString(),eventType:'Profile Switch',percentage:100,timeshift:0,profileJson:JSON.stringify({dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]})});
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l),inC=(a,g,l)=>a.filter(r=>{const v=Date.parse(r.created_at);return v>=g&&v<l;});
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));const gc=Date.parse(u.searchParams.get('find[created_at][$gte]')),lc=Date.parse(u.searchParams.get('find[created_at][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});if(p==='/api/v1/treatments.json')return route.fulfill({json:inC(treatments,gc,lc)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','45');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('secDeep').hidden,{timeout:40000}).catch(()=>{});
await page.waitForTimeout(300);
await page.evaluate(()=>{showTab('analyses'); const n=document.getElementById('tabbar'); if(n) n.style.display='none';});
await page.waitForTimeout(150);
const r=await page.evaluate(()=>({
  hidden:document.getElementById('secProposals').hidden,
  cards:[...document.querySelectorAll('#proposals .pcard')].map(c=>({
    title:c.querySelector('.pctitle')?.textContent,
    why:c.querySelector('.pcwhy')?.textContent.replace(/\s+/g,' ').trim(),
    cands:[...c.querySelectorAll('.pcand')].map(x=>({
      tag:x.querySelector('.pctag')?.textContent.replace(/\s+/g,' ').trim(),
      val:x.querySelector('.pcval')?.textContent.replace(/\s+/g,' ').trim(),
      eff:x.querySelector('.pceff')?.textContent.replace(/\s+/g,' ').trim(),
      risk:x.classList.contains('risk')}))})),
  good:document.querySelector('#proposals .pgood')?.textContent}));
console.log('secProposals hidden:',r.hidden);
for(const c of r.cards){ console.log('\n['+c.title+']'); console.log('  waarom:',c.why);
  for(const cd of c.cands) console.log('  ·',cd.tag,'|',cd.val,'|',cd.eff, cd.risk?'[RISK]':''); }
if(r.good) console.log('geen-voorstellen:',r.good);
console.log('\nerrors:',errors.length?errors:'geen');
await page.evaluate(()=>document.getElementById('secProposals').scrollIntoView());await page.waitForTimeout(200);
await page.screenshot({path:'/tmp/diametric-tests/proposals.png',fullPage:true});
await browser.close();

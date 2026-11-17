import { chromium } from 'playwright-core';
const EXE=(process.env.CHROME_PATH||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'),MG=18.0182,DAY=864e5,now=Date.now(),start=now-30*DAY;
const entries=[],treatments=[];
for(let t=start;t<now;t+=60e3){const h=new Date(t).getUTCHours();const bg=7+2*Math.sin(t/3e6)+(h>=19&&h<=22?1.5:0);entries.push({_id:'e'+t,date:t,dateString:new Date(t).toISOString(),sgv:Math.round(bg*MG),type:'sgv',direction:'Flat'});}
const dayK=t=>new Date(t).toLocaleDateString('sv-SE');
const gapDays=new Set([dayK(now-10*DAY),dayK(now-9*DAY),dayK(now-5*DAY)]);
for(let t=start;t<now;t+=5*60e3){ if(gapDays.has(dayK(t))) { if(Math.random()>0.05) continue; }
  treatments.push({_id:'tb'+t,created_at:new Date(t).toISOString(),eventType:'Temp Basal',duration:30,rate:0.5});}
for(let d=0;d<30;d++){const mt=start+d*DAY+12*3600e3;treatments.push({_id:'m'+d,created_at:new Date(mt).toISOString(),eventType:'Meal Bolus',carbs:50,insulin:5});}
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const b=await chromium.launch({executablePath:EXE});const p=await b.newPage({viewport:{width:390,height:844}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.route('https://mock.nightscout.test/**',r=>{const u=new URL(r.request().url()),q=u.searchParams;const g=Number(q.get('find[date][$gte]')),l=Number(q.get('find[date][$lt]')||q.get('find[date][$lte]')||9e15);
 const cg=Date.parse(q.get('find[created_at][$gte]')||0),cl=Date.parse(q.get('find[created_at][$lt]')||q.get('find[created_at][$lte]')||'2100-01-01');
 let out=[];if(u.pathname.includes('entries'))out=entries.filter(e=>e.date>=g&&e.date<l);else if(u.pathname.includes('treatments'))out=treatments.filter(t=>{const v=Date.parse(t.created_at);return v>=cg&&v<cl});else if(u.pathname.includes('profile'))out=profile;
 const c=Number(q.get('count')||1e9);r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(out.slice(0,c))})});
await p.goto(''+new URL('../index.html',import.meta.url).href+'');
await p.fill('#inUrl','https://mock.nightscout.test');await p.fill('#inTok','x');await p.fill('#inDays','30');await p.click('#btnSave');
await p.waitForFunction(()=>!document.getElementById('secInsulin').hidden,{timeout:60000}).catch(()=>{});await p.waitForTimeout(800);



const r=await p.evaluate(async()=>{ const t0=Date.now()-5*864e5; const rows=[];
 for(let i=0;i<4;i++){ rows.push({id:"m"+i,ts:t0+i*864e5+12*3600e3,type:"maaltijd",carbs:40,items:[{n:"Brood"}],created:1}); }
 await DB.putMany("annotations",rows);
 const d=document.querySelector('details[data-an="geheugen"]'); d.open=true; d.dispatchEvent(new Event("toggle")); await new Promise(r=>setTimeout(r,600));
 const u=document.querySelector('details[data-an="uur"]'); u.open=true; u.dispatchEvent(new Event("toggle")); await new Promise(r=>setTimeout(r,300));
 return {g:d.querySelector(".body").innerText.replace(/\s+/g," ").slice(0,300)};});
console.log(JSON.stringify(r,null,1));console.log('errors',errs);await b.close();

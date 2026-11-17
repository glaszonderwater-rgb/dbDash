import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome',MG=18.0182,DAY=864e5,now=Date.now(),start=now-30*DAY;
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



p.on('dialog',d=>d.accept(new Date(Date.now()-20*864e5).toISOString().slice(0,10)));
const r=await p.evaluate(async()=>{ const o={};
 document.getElementById("proposals").innerHTML=`<div class="pdec" data-id="v-basaal-nacht" data-key="basaal" data-dp="nacht" data-label="nacht" data-from="0,9" data-to="1,0"></div>`;
 await decorateProposals();
 document.querySelector('#proposals [data-d="accept"]').click(); await new Promise(r=>setTimeout(r,500));
 o.s1=document.querySelector("#proposals .pdec").innerText.replace(/\s+/g," ");
 o.fxWait=document.getElementById("effects").innerText.replace(/\s+/g," ").slice(0,160);
 o.annA=(await DB.all("annotations")).map(a=>a.type);
 document.querySelector('#proposals [data-d="applied"]').click(); await new Promise(r=>setTimeout(r,800));
 o.s2=document.querySelector("#proposals .pdec").innerText.replace(/\s+/g," ");
 o.annB=(await DB.all("annotations")).map(a=>a.type+(a.applied?"*":""));
 o.fx=document.getElementById("effects").innerText.replace(/\s+/g," ").slice(0,200);
 return o;});
console.log(JSON.stringify(r,null,1));console.log('errors',errs);await b.close();

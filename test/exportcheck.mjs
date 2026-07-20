import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE = new URL('../index.html', import.meta.url).href;
const MG=18.0182,DAY=864e5,STEP=5*60e3,now=Date.now(),start=now-20*DAY;
const entries=[];for(let t=start;t<now;t+=STEP)entries.push({_id:'e'+t,date:t,dateString:new Date(t).toISOString(),sgv:Math.round(6.5*MG),type:'sgv',direction:'Flat'});
const profile=[{_id:'p1',mills:start,defaultProfile:'Default',units:'mmol',store:{Default:{dia:6,units:'mmol',basal:[{time:'00:00',value:0.9}],sens:[{time:'00:00',value:2.0}],carbratio:[{time:'00:00',value:10}]}}}];
const inR=(a,g,l)=>a.filter(r=>r.date>=g&&r.date<l);
const browser=await chromium.launch({executablePath:EXE});
const ctx=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
const page=await ctx.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://mock.nightscout.test/**',route=>{const u=new URL(route.request().url()),p=u.pathname;const g=Number(u.searchParams.get('find[date][$gte]')),l=Number(u.searchParams.get('find[date][$lt]'));if(p==='/api/v1/status.json')return route.fulfill({json:{status:'ok'}});if(p==='/api/v1/profile.json')return route.fulfill({json:profile});if(p==='/api/v1/entries.json')return route.fulfill({json:inR(entries,g,l)});return route.fulfill({json:[]});});
await page.goto(FILE,{waitUntil:'load'});
await page.fill('#inUrl','https://mock.nightscout.test');await page.fill('#inTok','x');await page.fill('#inDays','20');
await page.click('#btnSave');
await page.waitForFunction(()=>!document.getElementById('secNow').hidden,{timeout:40000}).catch(()=>{});
// voeg 3 markeringen toe
await page.evaluate(async()=>{ await DB.putMany("annotations",[
  {id:"a1",ts:Date.now()-5*864e5,type:"wijziging",note:"basaal test",created:Date.now()},
  {id:"a2",ts:Date.now()-3*864e5,type:"ziek",note:"griep",created:Date.now()},
  {id:"h1",ts:Date.now()-2*864e5,type:"hypogevoel",measured:3.4,intensity:"duidelijk",created:Date.now()}]); });
// open dialoog, exporteer, vang download
await page.click('#btnCfg'); await page.waitForTimeout(200);
const [dl]=await Promise.all([page.waitForEvent('download'), page.click('#btnExport')]);
const path=await dl.path(); const content=JSON.parse(readFileSync(path,'utf8'));
console.log('export: kind=',content.kind,'| aantal=',content.annotations.length,'| bestandsnaam=',dl.suggestedFilename());
// verwijder alle annotaties, controleer leeg, importeer terug
await page.evaluate(async()=>{ for(const a of await DB.all("annotations")) await DB.delRow("annotations",a.id); });
const before=await page.evaluate(async()=>(await DB.all("annotations")).length);
await page.setInputFiles('#fileImport', path);
await page.waitForTimeout(300);
const after=await page.evaluate(async()=>(await DB.all("annotations")).length);
console.log('na verwijderen:',before,'| na import:',after);
console.log('errors:',errors.length?errors:'geen');
await browser.close();

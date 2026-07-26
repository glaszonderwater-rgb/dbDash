import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT=dirname(dirname(fileURLToPath(import.meta.url))); // /workspace/dbdash
const TYPES={'.html':'text/html; charset=utf-8','.json':'application/json','.js':'application/javascript','.svg':'image/svg+xml'};

// Statische server op localhost — localhost telt als 'secure context', dus de
// service worker mag registreren (lukt niet vanaf file://).
const server=http.createServer(async (req,res)=>{
  try{
    let p=decodeURIComponent(new URL(req.url,'http://x').pathname);
    if(p==='/'||p==='') p='/index.html';
    const full=normalize(join(ROOT,p));
    if(!full.startsWith(ROOT)){res.writeHead(403);return res.end('no');}
    const buf=await readFile(full);
    const ext=full.slice(full.lastIndexOf('.'));
    res.writeHead(200,{'Content-Type':TYPES[ext]||'application/octet-stream'});
    res.end(buf);
  }catch(e){res.writeHead(404);res.end('404');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const BASE='http://127.0.0.1:'+server.address().port+'/';

const browser=await chromium.launch({executablePath:EXE});
const context=await browser.newContext({viewport:{width:390,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));

await page.goto(BASE,{waitUntil:'load'});

// 1) Manifest bereikbaar en geldig, door de browser opgehaald via de <link>.
const man=await page.evaluate(async ()=>{
  const l=document.querySelector('link[rel=manifest]');
  if(!l) return null;
  const r=await fetch(l.href); const j=await r.json();
  return {name:j.name, short:j.short_name, display:j.display, icons:(j.icons||[]).length,
          maskable:(j.icons||[]).some(i=>/maskable/.test(i.purpose||'')), start:j.start_url, scope:j.scope};
});
console.log('manifest:', man);
console.log('  naam+short+standalone+icoon+maskable:',
  man && man.name && man.short && man.display==='standalone' && man.icons>0 && man.maskable ? 'OK':'FOUT');

// 2) Icoon bereikbaar en is echt SVG.
const iconType=await page.evaluate(async ()=>{ const r=await fetch('icon.svg'); return r.headers.get('content-type'); });
console.log('icoon content-type:', iconType, /svg/.test(iconType||'')?'OK':'FOUT');

// 3) Service worker registreert en gaat de pagina besturen.
const controlled=await page.evaluate(async ()=>{
  if(!('serviceWorker' in navigator)) return 'geen SW-ondersteuning';
  const reg=await navigator.serviceWorker.ready;
  // wacht tot er een controller is (claim), max ~5s
  for(let i=0;i<50 && !navigator.serviceWorker.controller;i++){ await new Promise(r=>setTimeout(r,100)); }
  return { active: !!(reg&&reg.active), controller: !!navigator.serviceWorker.controller };
});
console.log('service worker:', controlled);

// 4) Offline-terugval: verbinding uit, herladen — de app moet nog laden uit cache.
await context.setOffline(true);
let offlineOk=false, offErr='';
try{
  await page.reload({waitUntil:'load'});
  offlineOk=await page.evaluate(()=>!!document.getElementById('kpis') || /IDM/.test(document.title));
}catch(e){ offErr=e.message; }
console.log('offline herladen werkt:', offlineOk?'JA':'NEE', offErr?('('+offErr+')'):'');
await context.setOffline(false);

console.log('errors:', errors.length?errors:'geen');
await browser.close();
server.close();

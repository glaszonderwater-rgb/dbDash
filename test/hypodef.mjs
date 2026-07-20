import { chromium } from 'playwright-core';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser=await chromium.launch({executablePath:EXE});
const page=await browser.newPage();
await page.goto(new URL('../index.html', import.meta.url).href,{waitUntil:'load'});
await page.evaluate(()=>document.getElementById('cfgDlg').close());
const r=await page.evaluate(()=>{
  const mk=(arr)=>arr.map(([min,bg])=>({ts:Date.parse('2026-07-10T00:00:00Z')+min*60e3,bg}));
  // A: echte episode — 25 min laag, rustig erin/eruit
  const A=mk([[0,5.5],[5,4.8],[10,4.2],[15,3.6],[20,3.4],[25,3.5],[30,3.6],[35,3.7],[40,4.2],[45,4.8],[50,5.2]]);
  // B: sensordruk — duik 6,2→3,0 in 10 min, 10 min laag, herstel naar 6,0 in 10 min
  const B=mk([[0,6.2],[5,6.1],[10,4.4],[15,3.0],[20,3.1],[25,4.6],[30,6.0],[35,6.1]]);
  // C: één losse dip-meting
  const C=mk([[0,5.0],[5,4.4],[10,3.7],[15,4.4],[20,5.0]]);
  return { A:hypoStats(A), B:hypoStats(B), C:hypoStats(C) };
});
const s=x=>`eps=${x.episodes} dips=${x.dips} suspect=${x.suspect}`;
console.log('A (echte 25-min episode):', s(r.A));
console.log('B (sensordruk-patroon):  ', s(r.B));
console.log('C (losse dip):           ', s(r.C));
await browser.close();

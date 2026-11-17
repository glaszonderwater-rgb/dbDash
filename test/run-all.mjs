// Draait alle *check.mjs; faalt bij exit≠0, "errors:" ≠ geen of "RESULTAAT:" ≠ OK.
import {readdirSync} from 'node:fs'; import {spawnSync} from 'node:child_process';
const skip=new Set(['perf.mjs','navshot.mjs','shot_redesign.mjs','verify_v21.mjs','hypodef.mjs']);
const files=readdirSync(new URL('.',import.meta.url)).filter(f=>/check\.mjs$/.test(f)&&!skip.has(f)).sort();
let bad=0;
for(const f of files){
  const r=spawnSync('node',[new URL(f,import.meta.url).pathname],{encoding:'utf8',timeout:240000});
  const o=(r.stdout||'')+(r.stderr||'');
  const e=[...o.matchAll(/errors:\s*(.*)/g)].some(m=>!/^geen/.test(m[1].trim()));
  const q=[...o.matchAll(/RESULTAAT:\s*(.*)/g)].some(m=>!/^OK/.test(m[1].trim()));
  const ok=r.status===0&&!e&&!q; if(!ok)bad++;
  console.log((ok?'OK   ':'FAIL ')+f);
  if(!ok)console.log(o.split('\n').slice(-8).join('\n'));
}
console.log(bad?`${bad} mislukt`:'alles OK'); process.exit(bad?1:0);

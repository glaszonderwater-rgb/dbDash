"use strict";
/* IDA — back-up naar je eigen server (Railway + Supabase).
   Zodra er een meldingenserver is ingesteld, gaan je instellingen en je logboek daar automatisch heen,
   en komen ze bij het openen terug als ze op dit apparaat ontbreken (nieuwe telefoon, cache gewist, ander adres).
   Samenvoegen: logboek per id (verwijderingen worden onthouden), instellingen: wat hier leeg is wordt aangevuld. */

const _ST_DEL = "ida.deleted", _ST_AT = "ida.stateAt";
const _stLS = (k, v) => { try{ if(v===undefined) return localStorage.getItem(k); localStorage.setItem(k, v); }catch(_){ return null; } };
function _stDeleted(){ try{ return JSON.parse(_stLS(_ST_DEL)||"{}"); }catch(_){ return {}; } }
function _stUrl(){ return cfg.pushUrl ? cfg.pushUrl.replace(/\/+$/,"")+"/state" : null; }

// Wat er van de instellingen mee mag: hetzelfde als lokaal bewaard wordt (met wachtwoordbeveiliging dus alleen versleuteld).
function _stCfgOut(){ const o=Object.assign({},cfg); if(cfg.protected){ delete o.token; delete o.aiKey; delete o.nsWriteToken; } return o; }

let _stTimer=null, _stBusy=false, _stLastSent="";
function stateSoon(ms){ if(!_stUrl()) return; clearTimeout(_stTimer); _stTimer=setTimeout(()=>{ statePush().catch(()=>{}); }, ms==null?4000:ms); }

async function statePush(){
  const url=_stUrl(); if(!url || _stBusy) return; _stBusy=true;
  try{
    let anns=[]; try{ anns=await DB.all("annotations"); }catch(_){}
    const body={ app:"IDA", v:1, savedAt:new Date().toISOString(), cfg:_stCfgOut(), annotations:anns, deleted:_stDeleted() };
    const sig=JSON.stringify([body.cfg, anns.length, anns.reduce((m,a)=>Math.max(m,a.created||a.ts||0),0), Object.keys(body.deleted).length]);
    if(sig===_stLastSent) return;
    const r=await fetch(url,{ method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify(body) });
    if(r.ok){ _stLastSent=sig; _stLS(_ST_AT, String(Date.now())); }
  }finally{ _stBusy=false; }
}

async function statePull(){
  const url=_stUrl(); if(!url) return false;
  let d; try{ const r=await fetch(url,{ cache:"no-store" }); if(!r.ok) return false; d=await r.json(); }catch(_){ return false; }
  if(!d || d.app!=="IDA") return false;
  let changed=false;
  // logboek: wat de server heeft en hier ontbreekt (en niet bewust verwijderd is)
  const del=Object.assign({}, d.deleted||{}, _stDeleted()); _stLS(_ST_DEL, JSON.stringify(del));
  let local=[]; try{ local=await DB.all("annotations"); }catch(_){}
  const have=new Set(local.map(a=>a.id));
  const add=(d.annotations||[]).filter(a=>a&&a.id&&a.ts&&a.type&&!have.has(a.id)&&!del[a.id]);
  if(add.length){ try{ await _stOrigPut.call(DB,"annotations",add); changed=true; }catch(_){} }
  for(const a of local) if(del[a.id]){ try{ await _stOrigDel.call(DB,"annotations",a.id); changed=true; }catch(_){} }
  // instellingen: alleen aanvullen wat hier leeg is; zonder Nightscout-adres hier: alles overnemen
  const sc=d.cfg||{};
  if(!cfg.url && sc.url){ for(const k of Object.keys(sc)) cfg[k]=sc[k]; changed=true; }
  else for(const k of Object.keys(sc)){ if((cfg[k]===undefined||cfg[k]==="") && sc[k]!==undefined && sc[k]!==""){ cfg[k]=sc[k]; changed=true; } }
  if(changed){ saveCfg(); try{ if(typeof _idaAnns!=="undefined") _idaAnns=await DB.all("annotations"); }catch(_){} }
  return { changed, added:add.length };
}

// Logboekwijzigingen opvangen (zonder elke plek in de app aan te passen)
const _stOrigPut=DB.putMany, _stOrigDel=DB.delRow;
DB.putMany=async function(store, rows){ const r=await _stOrigPut.call(this, store, rows); if(store==="annotations") stateSoon(); return r; };
DB.delRow=async function(store, key){ const r=await _stOrigDel.call(this, store, key);
  if(store==="annotations"){ const d=_stDeleted(); d[key]=Date.now(); _stLS(_ST_DEL, JSON.stringify(d)); stateSoon(); } return r; };

// Instellingen: wijzigingen merken we op aan wat er lokaal bewaard wordt
let _stCfgSeen=_stLS(CFG_KEY)||"";
setInterval(()=>{ const now=_stLS(CFG_KEY)||""; if(now!==_stCfgSeen){ _stCfgSeen=now; stateSoon(1500); } }, 3000);
document.addEventListener("visibilitychange",()=>{ if(document.hidden) stateSoon(0); });

// Bij openen: eerst ophalen (herstellen), daarna een verse back-up
async function stateStart(){
  if(!_stUrl()) return;
  const r=await statePull();
  if(r && r.changed){
    toast(TL(`Hersteld van je server${r.added?`: ${r.added} logboekregels`:""}.`,`Restored from your server${r.added?`: ${r.added} log entries`:""}.`,`Restaurado do servidor.`));
    try{ const btn=document.getElementById("btnSync"); if(btn) btn.disabled=!cfg.url;
      if(cfg.url && typeof doSync==="function") await doSync(); }catch(_){}
  }
  stateSoon(2000);
}
setTimeout(()=>{ stateStart().catch(()=>{}); }, 1200);

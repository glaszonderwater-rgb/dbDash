"use strict";
/* IDA — meldingen. Twee routes, allebei optioneel:
   1. Lokaal: terwijl IDA open is of net op de achtergrond staat, toont de app zelf een melding.
   2. Server: met een meldingenserver (server/push.mjs) komen meldingen ook als IDA dicht is.
      De app meldt zich daarvoor aan met Web Push; de server leest Nightscout zelf.
   Een melding zegt nooit hoeveel insuline: alleen timing of een vraag. */

const _NOTE_KEY = "ida.notified";
function _notified(){ try{ return JSON.parse(localStorage.getItem(_NOTE_KEY)||"{}"); }catch(_){ return {}; } }
function _markNotified(k){ try{ const o=_notified(); o[k]=Date.now(); for(const x in o) if(Date.now()-o[x]>3*864e5) delete o[x]; localStorage.setItem(_NOTE_KEY, JSON.stringify(o)); }catch(_){} }

function currentMoments(){
  if(typeof idaMoments!=="function" || !_ctx || !_ctx.glucose) return [];
  const now=Date.now(); const off=(typeof tzOffsetAt==="function" && tzOffsetAt(now)!=null) ? tzOffsetAt(now) : -new Date().getTimezoneOffset();
  let st; try{ const r=mealBolusRisk(_ctx); st=r&&r.fall.n>=5&&r.ok.n>=5?{ fallPct:Math.round(100*r.fall.hypo/r.fall.n), okPct:Math.round(100*r.ok.hypo/r.ok.n) }:null; }catch(_){ st=undefined; }
  let iob=null; try{ const ds=(typeof _dsAll!=="undefined"&&_dsAll)||[], d=ds[ds.length-1]; if(d&&now-d.ts<15*60e3) iob=d.iob; }catch(_){}
  const anns=(typeof _idaAnns!=="undefined"&&_idaAnns)||[];
  try{ return idaMoments(_ctx.glucose, _ctx.treatments, { now, tzOffsetMin:off, stats:st, anns, iob, mute:cfg.mute5||[] }); }catch(e){ console.error(e); return []; }
}

// In de app: het moment staat bovenaan Vandaag
function renderMoment(){
  const host=document.getElementById("assist"); if(!host) return;
  document.getElementById("idaMoment")?.remove();
  const m=currentMoments().find(x=>x.kind!=="vraag"); if(!m) return;
  const el=document.createElement("section"); el.id="idaMoment"; el.className="imoment";
  el.innerHTML=`<span class="imk">${TL("NU","NOW","AGORA")}</span><b></b><p></p>`;
  el.querySelector("b").textContent=m.title; el.querySelector("p").textContent=m.body;
  host.before(el);
  maybeNotify([m]);
}

// Lokale melding (alleen als IDA niet in beeld is, één keer per moment)
async function maybeNotify(list){
  if(!cfg.notify || typeof Notification==="undefined" || Notification.permission!=="granted" || !document.hidden) return;
  const seen=_notified();
  for(const m of list){ if(seen[m.key]) continue;
    try{ const reg=await navigator.serviceWorker?.ready;
      if(reg) await reg.showNotification(m.title,{ body:m.body, tag:m.key, icon:"icon-180.png", badge:"icon-180.png", data:{url:"./"} });
      else new Notification(m.title,{ body:m.body, tag:m.key });
      _markNotified(m.key);
    }catch(_){}
  }
}
function notifyCheck(){ try{ maybeNotify(currentMoments()); }catch(_){} }

// Web Push-aanmelding voor een eigen server
function _b64u(s){ const p="=".repeat((4-s.length%4)%4), b=atob((s+p).replace(/-/g,"+").replace(/_/g,"/")); return Uint8Array.from(b,c=>c.charCodeAt(0)); }
async function pushSubscribe(){
  if(!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error(TL("Deze browser ondersteunt geen pushmeldingen.","This browser doesn't support push.","Este navegador não suporta notificações push."));
  if(!cfg.pushKey) throw new Error(TL("Vul eerst de publieke sleutel van je server in.","Enter your server's public key first.","Introduza primeiro a chave pública do servidor."));
  const perm=await Notification.requestPermission(); if(perm!=="granted") throw new Error(TL("Meldingen zijn niet toegestaan.","Notifications not allowed.","Notificações não permitidas."));
  const reg=await navigator.serviceWorker.ready;
  let sub=await reg.pushManager.getSubscription();
  if(!sub) sub=await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:_b64u(cfg.pushKey) });
  const json=sub.toJSON();
  if(cfg.pushUrl){
    const r=await fetch(cfg.pushUrl.replace(/\/+$/,"")+"/subscribe",{ method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(json) });
    if(!r.ok) throw new Error("Server: "+r.status);
  }
  return json;
}
async function pushCopy(){
  try{ cfg.notify=true; saveCfg(); const j=await pushSubscribe(); await navigator.clipboard.writeText(JSON.stringify(j));
    toast(TL("Aanmelding gekopieerd. Zet hem als geheim PUSH_SUBSCRIPTIONS bij je server.","Subscription copied. Store it as the PUSH_SUBSCRIPTIONS secret on your server.","Subscrição copiada. Guarde-a como segredo PUSH_SUBSCRIPTIONS no servidor."));
  }catch(e){ toast(e.message); }
}
async function notifyEnable(){
  if(typeof Notification==="undefined") return;
  if(Notification.permission==="default") try{ await Notification.requestPermission(); }catch(_){}
  if(cfg.pushKey) try{ await pushSubscribe(); }catch(e){ toast(e.message); }
}

// Testmelding via de server (controleert de hele keten: server → pushdienst → telefoon)
async function pushTest(){
  try{
    cfg.notify=true; saveCfg(); const nc=document.getElementById("inNotify"); if(nc) nc.checked=true;
    if(!cfg.pushUrl) throw new Error(TL("Vul eerst het adres van de meldingenserver in.","Enter the notification server address first.","Introduza primeiro o endereço do servidor."));
    await pushSubscribe();
    const r=await fetch(cfg.pushUrl.replace(/\/+$/,"")+"/test",{ method:"POST" });
    if(!r.ok) throw new Error("Server: "+r.status);
    const j=await r.json();
    toast(j.ok?TL(`Testmelding verstuurd naar ${j.ok} apparaat/apparaten.`,`Test sent to ${j.ok} device(s).`,`Teste enviado para ${j.ok} aparelho(s).`):TL("Server bereikt, maar geen apparaat kreeg de melding.","Server reached, but no device received it.","Servidor alcançado, mas nenhum aparelho recebeu."));
  }catch(e){ toast(e.message); }
}

// Meldingenvelden meteen bewaren (niet pas bij "Bewaren", dat ook Nightscout controleert)
(function(){
  const sync=()=>{ const n=document.getElementById("inNotify"), u=document.getElementById("inPushUrl"), k=document.getElementById("inPushKey"); if(!n) return;
    cfg.notify=n.checked; cfg.pushUrl=u.value.trim().replace(/\/+$/,""); cfg.pushKey=k.value.trim(); saveCfg(); };
  for(const id of ["inNotify","inPushUrl","inPushKey"]){ const el=document.getElementById(id); if(el) el.addEventListener("change", sync); }
})();

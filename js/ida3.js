"use strict";
/* IDA — navigatie zonder uitklapblokken. Elk inklapblok wordt een rij; tikken opent een eigen
   detailpagina (met terugknop), zoals in Apple Gezondheid. Het oorspronkelijke blok wordt daarvoor
   tijdelijk verplaatst (functies en knoppen blijven werken) en daarna teruggezet. */

let _det = null;   // { items:[{el, ph, wasOpen}], prev, scroll, onClose }

function _curTab(){ const v=[...document.querySelectorAll(".view")].find(x=>!x.hidden); return v?v.dataset.view:"overzicht"; }
function _sumTitle(d){ const s=d.querySelector(":scope>summary"); if(!s) return ""; const sp=s.querySelector("span"); return ((sp||s).textContent||"").trim(); }
function _sumHint(d){ const h=d.querySelector(":scope>summary .foldhint"); return h?h.textContent.trim():""; }

function openDetail(nodes, title, onClose){
  if(_det) closeDetail(true);
  const body=document.getElementById("detailBody"); if(!body) return;
  const items=[];
  for(const el of nodes){ if(!el) continue; const ph=document.createComment("ida-ph"); el.before(ph);
    items.push({ el, ph, wasOpen: el.tagName==="DETAILS" ? el.open : null, wasHidden: el.hidden });
    el.classList.remove("irowsrc"); el.classList.add("indetail"); el.hidden=false; body.appendChild(el);
    if(el.tagName==="DETAILS") el.open=true;
    el.querySelectorAll("details").forEach(d=>{ d.open=true; }); }
  _det={ items, prev:_curTab(), scroll:window.scrollY, onClose };
  document.getElementById("detTitle").textContent=title||"";
  showTab("detail"); window.scrollTo({top:0});
}
function closeDetail(silent){
  if(!_det) return; const d=_det; _det=null;
  for(const it of d.items){ it.el.classList.remove("indetail"); it.ph.replaceWith(it.el);
    if(it.wasOpen!==null) it.el.open=it.wasOpen; it.el.hidden=it.wasHidden;
    if(it.el.dataset.idaRow) it.el.classList.add("irowsrc"); }
  if(d.onClose) try{ d.onClose(); }catch(_){}
  if(!silent){ showTab(d.prev); window.scrollTo({top:d.scroll}); }
}
function openDetailFor(el){ if(!el) return; const top=el.closest("details.irowsrc,details.indetail")||el; openDetail([top], _sumTitle(top)); }

// Inklapblokken in Patronen en Team omzetten naar rijen
function buildRows(){
  for(const sel of ['.view[data-view="analyses"]','.view[data-view="consult"]']){
    const root=document.querySelector(sel); if(!root) continue;
    root.querySelectorAll("details.deep, details.fold").forEach(d=>{
      if(d.dataset.idaRow || d.parentElement.closest("details") || d.closest("#detailBody")) return;
      d.dataset.idaRow="1"; d.classList.add("irowsrc");
      const b=document.createElement("button"); b.type="button"; b.className="irow";
      const hint=_sumHint(d);
      b.innerHTML=`<span class="irt"><b></b>${hint?"<i></i>":""}</span><span class="irc" aria-hidden="true">›</span>`;
      b.querySelector("b").textContent=_sumTitle(d); if(hint) b.querySelector("i").textContent=hint;
      b.onclick=()=>openDetail([d], _sumTitle(d));
      b.hidden=d.hidden; d.before(b); d._row=b;
      new MutationObserver(()=>{ if(!d.classList.contains("indetail")) b.hidden=d.hidden;
        b.querySelector("b").textContent=_sumTitle(d); const i=b.querySelector("i"); if(i) i.textContent=_sumHint(d); })
        .observe(d,{attributes:true,attributeFilter:["hidden"],subtree:true,childList:true,characterData:true});
    });
  }
}
// "Waarom ›" onder een melding opent de onderbouwing als pagina
function buildWhyLinks(){
  document.querySelectorAll(".f details.fmore-d").forEach(d=>{
    if(d.dataset.idaWhy) return; d.dataset.idaWhy="1"; d.classList.add("irowsrc");
    const b=document.createElement("button"); b.type="button"; b.className="iask"; b.textContent=TL("Waarom ›","Why ›","Porquê ›");
    b.onclick=()=>{ const f=d.closest(".f"); const t=f?(f.querySelector(".ftxt")||f).textContent.trim():""; openDetail([d], t.length>60?t.slice(0,58)+"…":t); };
    d.before(b);
  });
}
function openAllFindings(){
  const t=document.getElementById("findToday"), w=document.getElementById("findWeek");
  [t,w].forEach(x=>x&&x.querySelectorAll(".f").forEach(f=>f.hidden=false));
  openDetail([t,w].filter(Boolean), TL("Alle meldingen","All notices","Todos os avisos"), ()=>{ _capN=-1; capHome(); });
}
// goTo (sprong naar een analyse) opent nu de detailpagina
(function(){
  const orig=typeof goTo==="function"?goTo:null;
  window.goTo=function(target, view){
    const el = target && target.startsWith("an:") ? document.querySelector(`details[data-an="${target.slice(3)}"]`) : document.getElementById(target);
    const top = el && (el.closest("details.irowsrc") || (el.matches&&el.matches("details.irowsrc")?el:null));
    if(top){ openDetail([top], _sumTitle(top)); return; }
    if(orig) return orig(target, view);
  };
})();

// Vandaag: nooit meer dan 2 kaarten onder "Let op"; de rest achter "Alle meldingen"
let _capN=-1;
function capHome(){
  if(_det) return;
  const a=[...document.querySelectorAll("#assist > *")].filter(x=>!x.hidden).length;
  const n=Math.max(0,2-a);
  const cards=[...document.querySelectorAll("#findToday .f, #findWeek .f")];
  const vis=cards.filter(c=>!c.hidden).length, want=Math.min(n,cards.length);
  if(n===_capN && vis===want) return; _capN=n; try{ limitFindings(n); }catch(_){}
}
let _rowsT=null;
function idaLayout(){ clearTimeout(_rowsT); _rowsT=setTimeout(()=>{ try{ buildRows(); buildWhyLinks(); capHome(); }catch(e){ console.error(e); } },30); }
new MutationObserver(idaLayout).observe(document.getElementById("tl")||document.body,{childList:true,subtree:true});
document.getElementById("detBack").onclick=()=>closeDetail();
idaLayout();

// Instellink voor meldingen: …/dbDash/#meldingen&server=<url>&key=<publieke sleutel>
// Vult de velden in, haalt je back-up van de server op en opent de instellingen.
function idaSetupLink(){
  try{
    const h=location.hash.slice(1); if(!/^meldingen(&|$)/.test(h)) return;
    const p=new URLSearchParams(h.replace(/^meldingen&?/,"")), server=(p.get("server")||"").replace(/\/+$/,""), key=p.get("key")||"";
    history.replaceState(null,"",location.pathname+location.search);
    if(!/^https:\/\/[^\s]+$/.test(server) || !/^[A-Za-z0-9_-]{80,100}$/.test(key)) { toast(TL("Deze instellink is ongeldig.","This setup link is invalid.","Ligação inválida.")); return; }
    cfg.pushUrl=server; cfg.pushKey=key; cfg.notify=true; saveCfg();
    try{ if(typeof stateStart==="function") setTimeout(()=>stateStart().catch(()=>{}),300); }catch(_){}
    setTimeout(()=>{ try{ document.getElementById("btnCfg").click(); const el=document.getElementById("btnPushTest"); if(el) el.scrollIntoView({block:"center"});
      toast(TL("Meldingen ingevuld. Tik op 'Stuur testmelding' en sta meldingen toe.","Notifications filled in. Tap 'Send test notification' and allow notifications.","Notificações preenchidas. Toque em 'Enviar notificação de teste'.")); }catch(_){} }, 600);
  }catch(e){ console.error(e); }
}
idaSetupLink();
window.addEventListener("hashchange", idaSetupLink);

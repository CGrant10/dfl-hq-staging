// DFL Arena Beta — live vehicle compositor foundation.
// Live Arena/Broadcast remain isolated; Beta loadout persists locally only.
const STORAGE_KEY="dfl.arenaBeta.live.v1";
const ASSET_VERSION="1.113.0";
const KART_ART=`assets/arena-beta/live/kart.webp?v=${ASSET_VERSION}`;
const PAINTS=["Red","Orange","Yellow","Green","Teal","Blue","Purple","Black","White"];
const PAINT_FILTERS={
  Red:"none", Orange:"hue-rotate(28deg) saturate(1.08)", Yellow:"hue-rotate(55deg) saturate(1.12)",
  Green:"hue-rotate(118deg) saturate(1.08)", Teal:"hue-rotate(165deg) saturate(1.02)",
  Blue:"hue-rotate(215deg) saturate(1.08)", Purple:"hue-rotate(270deg) saturate(1.05)",
  Black:"grayscale(.8) brightness(.48) contrast(1.15)", White:"grayscale(.85) brightness(1.55) contrast(.82)"
};
const FUTURE=["Mini Stock","Golf Cart","Tiny Pickup","Open Wheel","Box Beater"];
function ensureAssets(){
  const old=document.getElementById("arena-beta-render-css"); if(old) old.remove();
  const l=document.createElement("link"); l.id="arena-beta-render-css"; l.rel="stylesheet";
  l.href=`css/arena-beta-render.css?v=${ASSET_VERSION}`; document.head.appendChild(l);
}
function loadState(){const d={paint:"Red",flag:"DFL",wheels:"Gold Rims",accessory:"Beacon"};try{return {...d,...JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}")}}catch{return d}}
function saveState(s){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(s))}catch{}}
function paintButtons(s){return PAINTS.map(p=>`<button class="abr-paint${s.paint===p?" is-selected":""}" data-paint-choice="${p}" data-paint="${p.toLowerCase()}" aria-label="${p}" aria-pressed="${s.paint===p}"></button>`).join("")}
function futureCards(){return FUTURE.map(v=>`<button class="abr-live-future" type="button" disabled><span>${v}</span><small>Production asset next</small></button>`).join("")}
function update(root,s){
  const img=root.querySelector("[data-live-kart]"); if(img) img.style.filter=PAINT_FILTERS[s.paint]||"none";
  root.querySelectorAll("[data-paint-choice]").forEach(b=>{const on=b.dataset.paintChoice===s.paint;b.classList.toggle("is-selected",on);b.setAttribute("aria-pressed",String(on))});
  const flag=root.querySelector("[data-live-flag]"); if(flag) flag.textContent=(s.flag||"DFL").slice(0,20);
  const load=root.querySelector("[data-loadout]"); if(load) load.textContent=`Arcade Kart · ${s.paint} · ${s.wheels} · ${s.accessory}`;
}
function wire(root,s){
  root.addEventListener("click",e=>{const b=e.target.closest("[data-paint-choice]");if(!b)return;s.paint=b.dataset.paintChoice;saveState(s);update(root,s)});
  const flag=root.querySelector("[data-flag]"); flag?.addEventListener("input",()=>{s.flag=flag.value.slice(0,20);saveState(s);update(root,s)});
}
export async function render(view){
  ensureAssets(); const s=loadState();
  view.innerHTML=`<div id="arena-beta-real" class="arena-beta-real abr-live-page">
    <header class="abr-topbar"><a class="abr-back" href="#/arena">← Live Arena</a><div class="abr-status"><strong>DFL ARENA BETA</strong><span>Live Garage compositor · isolated from races</span></div><span class="abr-pill">BETA</span></header>
    <div class="abr-title"><div><span>PHASE 2</span><h1>Garage & Track Test</h1><p>Build it. Race it. Brag about it.</p></div><div class="abr-protected">Live Arena protected</div></div>
    <main class="abr-live-grid">
      <section class="abr-live-stage-panel">
        <div class="abr-live-stage">
          <div class="abr-live-neon abr-live-neon-a"></div><div class="abr-live-neon abr-live-neon-b"></div>
          <div class="abr-live-sign">DFL GARAGE</div>
          <div class="abr-live-turntable"></div>
          <div class="abr-live-vehicle-wrap">
            <img data-live-kart class="abr-live-vehicle" src="${KART_ART}" alt="Arcade Kart production artwork">
            <div class="abr-live-flagpole" aria-hidden="true"><span data-live-flag>${s.flag||"DFL"}</span></div>
          </div>
          <div class="abr-live-badge"><small>LIVE PREVIEW</small><strong>Arcade Kart</strong><span>Real asset · no screenshot crop</span></div>
        </div>
        <div class="abr-live-loadout"><span>Current Beta Loadout</span><strong data-loadout>Arcade Kart · ${s.paint} · ${s.wheels} · ${s.accessory}</strong></div>
      </section>
      <aside class="abr-controls abr-live-controls">
        <section class="abr-panel"><div class="abr-panel-head"><h2>Vehicle Body</h2><span>1 production-ready</span></div><button class="abr-live-current" type="button" aria-pressed="true"><img src="${KART_ART}" alt=""><strong>Arcade Kart</strong><small>Live now</small></button><div class="abr-live-future-grid">${futureCards()}</div></section>
        <section class="abr-panel"><div class="abr-panel-head"><h2>Paint / Livery</h2><span>Live on vehicle</span></div><div class="abr-paint-row">${paintButtons(s)}</div><p class="abr-help">Paint changes now update the vehicle itself instead of a saved label.</p></section>
        <section class="abr-panel"><div class="abr-panel-head"><h2>Antenna Flag</h2><span>Trails behind vehicle</span></div><label class="abr-field"><span>Flag text</span><input data-flag maxlength="20" value="${s.flag||"DFL"}"></label><p class="abr-help">This is a live overlay on the Garage stage. Image upload comes when the flag raster layer is finalized.</p></section>
        <section class="abr-panel abr-layer-next"><div class="abr-panel-head"><h2>Wheels</h2><span>Layer slot ready</span></div><strong>${s.wheels}</strong><p>Real wheel sprites are the next asset layer. The old screenshot strip has been removed so this control does not fake a visual change.</p></section>
        <section class="abr-panel abr-layer-next"><div class="abr-panel-head"><h2>Accessories</h2><span>Layer slot ready</span></div><strong>${s.accessory}</strong><p>Beacon, exhaust, trophy and commissioner gear will mount from per-vehicle anchor coordinates here.</p></section>
      </aside>
    </main>
  </div>`;
  const root=view.querySelector("#arena-beta-real"); wire(root,s); update(root,s);
}

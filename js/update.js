import { APP_VERSION } from "./config.js";

const bar=()=>document.getElementById("update");
const UPDATE_CHECK_MS=10*60*1000;

function pendingGolfScores(){
  try{
    const value=JSON.parse(localStorage.getItem("dfl.golf.pending")||"{}");
    return value&&typeof value==="object"&&Object.keys(value).length>0;
  }catch{return false;}
}

function scoreEntryOpen(){
  return Boolean(document.querySelector('[data-tb-sheet]:not([hidden]),[data-gqm-pop]:not([hidden])'));
}

export function updateBlocked(){return pendingGolfScores()||scoreEntryOpen();}

async function routeList(){
  try{const r=await import("./router.js");if(typeof r.routeNames==="function")return r.routeNames()}catch{}
  return [...document.querySelectorAll("#tabbar a[data-route]")].map(a=>a.dataset.route).filter(Boolean);
}

async function appFiles(){
  const base=new URL(".",location.href).href;
  const loaded=performance.getEntriesByType("resource").map(e=>e.name.split("?")[0]).filter(n=>n.startsWith(location.origin)&&/\.(js|css|json|html)$/.test(n));
  const pages=(await routeList()).map(n=>`${base}js/pages/${n}.js`);
  const shell=["","index.html","css/style.css","css/profile-neutral.css","manifest.json","sw.js","js/config.js","js/nav-neutral.js","js/golf-gps-course-map.js","js/golf-club-recommendation.js","js/golf-gps-beta.js","js/golf-gps-red-trail-beta.js","js/golf-gps-rolla-beta.js","js/golf-gps-imported.js","js/golf-event-course-picker.js","js/golf-live-to-par.js"].map(p=>base+p);
  return [...new Set([...shell,...loaded,...pages])];
}

async function refetchAll(){
  const files=await appFiles();
  const results=await Promise.allSettled(files.map(url=>fetch(url,{cache:"reload"})));
  const failed=results.filter(r=>r.status==="rejected").length;
  if(failed)console.warn(`Update: ${failed} of ${files.length} files could not be refreshed`);
}

export function isNewer(remote,local){
  const a=String(remote).trim().split(".").map(Number),b=String(local).trim().split(".").map(Number);
  for(let i=0;i<Math.max(a.length,b.length);i++){const x=a[i]||0,y=b[i]||0;if(x>y)return true;if(x<y)return false}
  return false;
}

export function updateGateMarkup(version){
  const safeVersion=String(version).replace(/[^0-9.]/g,"");
  return `<div class="update-gate__content">
    <p class="update-gate__eyebrow">DFL HQ UPDATE</p>
    <h1>The league just got better.</h1>
    <p class="update-gate__intro">Quality and performance improvements are ready. Update to continue.</p>
    <img class="update-gate__mark" src="icons/app-update-512.png" alt="DFL HQ" width="512" height="512">
    <div class="update-gate__features" aria-label="What is improved">
      <div><span class="update-gate__feature-icon"><svg aria-hidden="true"><use href="#i-arena"></use></svg></span><strong>Faster loading</strong></div>
      <div><span class="update-gate__feature-icon"><svg aria-hidden="true"><use href="#i-analyzer-steel"></use></svg></span><strong>Sharper analysis</strong></div>
      <div><span class="update-gate__feature-icon"><svg aria-hidden="true"><use href="#i-versus"></use></svg></span><strong>Smoother game day</strong></div>
    </div>
    <div class="update-gate__action">
      <button class="update-gate__button" id="update-go" type="button">UPDATE NOW</button>
      <p class="update-gate__version">Version ${safeVersion}</p>
      <p class="update-gate__status" role="status" aria-live="polite"></p>
    </div>
  </div>`;
}

function showGate(el,version){
  el.dataset.version=version;
  el.setAttribute("role","dialog");
  el.setAttribute("aria-modal","true");
  el.setAttribute("aria-labelledby","update-gate-title");
  el.innerHTML=updateGateMarkup(version).replace("<h1>",'<h1 id="update-gate-title">');
  el.classList.remove("hidden");
  el.classList.add("update-gate");
  document.body.classList.add("update-required");
  requestAnimationFrame(()=>el.querySelector("#update-go")?.focus());
}

async function serverVersion(){
  const res=await fetch(`version.txt?cb=${Date.now()}`,{cache:"no-store"});
  if(!res.ok)throw new Error(`version.txt returned ${res.status}`);
  const text=(await res.text()).trim();
  if(!/^\d+(\.\d+)*$/.test(text))throw new Error(`version.txt looks wrong: "${text.slice(0,30)}"`);
  return text;
}

function watchWorkerChange(timeout=5000){
  if(!("serviceWorker" in navigator))return{promise:Promise.resolve(),cancel(){}};
  let finish=()=>{};
  const promise=new Promise(resolve=>{
    let done=false,timer;
    finish=()=>{
      if(done)return;
      done=true;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange",finish);
      resolve();
    };
    navigator.serviceWorker.addEventListener("controllerchange",finish);
    timer=setTimeout(finish,timeout);
  });
  return{promise,cancel:finish};
}

export async function forceUpdate(){
  if(updateBlocked())return false;
  try{
    // Keep the current shell available until the replacement worker is ready.
    await refetchAll();
    if("serviceWorker" in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      const before=navigator.serviceWorker.controller;
      const change=watchWorkerChange();
      await Promise.all(regs.map(r=>r.update().catch(()=>{})));
      const replacement=regs.some(r=>r.installing||r.waiting);
      const alreadyChanged=navigator.serviceWorker.controller!==before;
      if(replacement&&!alreadyChanged)await change.promise;
      else change.cancel();
      await navigator.serviceWorker.ready.catch(()=>{});
    }
  }catch(err){console.warn("Update refresh failed, reloading with cache buster",err)}
  location.replace(`${location.pathname}?u=${Date.now()}${location.hash}`);
  return true;
}

export async function checkForUpdate(announce=false){
  const latest=await serverVersion(),stale=isNewer(latest,APP_VERSION),el=bar();
  if(stale&&el&&!updateBlocked())showGate(el,latest);
  return{current:APP_VERSION,latest,stale};
}

export function setupUpdates(){
  const el=bar();if(!el)return;
  el.addEventListener("click",async e=>{
    const go=e.target.closest("#update-go");
    if(go){
      if(updateBlocked()){el.querySelector(".update-gate__status").textContent="Finish or sync the current score, then update.";return}
      go.disabled=true;go.textContent="UPDATING…";
      el.classList.add("is-updating");
      el.querySelector(".update-gate__status").textContent="Refreshing DFL HQ…";
      await forceUpdate();return;
    }
  });
  checkForUpdate().catch(()=>{});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)checkForUpdate().catch(()=>{})});
  setInterval(()=>{if(!document.hidden)checkForUpdate().catch(()=>{})},UPDATE_CHECK_MS);
}

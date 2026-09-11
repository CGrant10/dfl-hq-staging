// DFL dynamic entries in the existing More sheet. Kept out of index.html so
// the shell markup stays stable; the router calls this once at startup.
import { decorateChipEaters } from "./chip-eaters.js";

export function ensureSportsbookNav() {
  const nav = document.querySelector("#more .quicknav");
  if (nav && !nav.querySelector('a[href="#/sportsbook"]')) {
    const link = document.createElement("a");
    link.href = "#/sportsbook";
    /* -steel, like every other glyph in this sheet - see the sprite in
       index.html and the note in css/profile-neutral.css. */
    link.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-versus-steel"></use></svg><span class="qn-label">Sportsbook</span>`;
    const admin = nav.querySelector('a[href="#/admin"]');
    nav.insertBefore(link, admin || null);
  }
  if (nav && !nav.querySelector('a[href="#/proposals"]')) {
    const link = document.createElement("a");
    link.href = "#/proposals";
    link.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-rules-steel"></use></svg><span class="qn-label">Proposals</span>`;
    const rules = nav.querySelector('a[href="#/rules"]');
    if (rules?.nextSibling) nav.insertBefore(link, rules.nextSibling); else nav.appendChild(link);
  }
  startChipEaters();
}

let chipStarted=false;
function startChipEaters(){
  if(chipStarted)return;chipStarted=true;
  let timer=0;
  const paint=()=>{clearTimeout(timer);timer=setTimeout(()=>{const view=document.getElementById("view");if(view)decorateChipEaters(view).catch(()=>{})},60)};
  new MutationObserver(paint).observe(document.getElementById("view")||document.body,{childList:true,subtree:true});
  window.addEventListener("hashchange",paint);
  paint();
}

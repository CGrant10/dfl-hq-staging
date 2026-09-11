// =====================================================================
// app.js - start-up: theme, "Who are you?", admin restore, router, SW
// =====================================================================
import "./arena/mobile-broadcast-performance.js";
import { APP_VERSION } from "./config.js";
import { getUsername } from "./store.js";
import { restoreAdmin, registerUser, configured } from "./supabase.js";
import { loadMembers, restoreMember, selectMember, currentMember, getMemberId } from "./members.js";
import { startPresence } from "./presence.js";
import { initTheme, syncThemeFromMember } from "./theme.js";
import { adoptSelectedMemberTheme } from "./member-theme-scope.js";
import { loadSettings } from "./settings.js";
import { mountMemberPreview } from "./member-preview.js";
import { startRouter, renderRoute, go, currentRoute, onRoute } from "./router.js";
import { paintBottomline, startBottomline } from "./bottomline.js";
import { setupInstall } from "./install.js";
import { setupUpdates } from "./update.js";
import { setupNotifyNudge } from "./notify-nudge.js";
import { esc, toast } from "./ui.js";
import { golfPass, clearGolfPass, onGolfPassChange } from "./golf-guest.js";
import { mountJoin } from "./golf-join.js";
import { trapFocus } from "./focus-trap.js";
import { forgetVerifiedPin } from "./member-lock.js";
import { mountSeasonNavigation } from "./season-nav.js";
import { mountNotificationBell } from "./notifications.js";

/* Draft and golf are complete. Rebuild the shell before any navigation
   handlers bind, so the fixed bar reflects what the league uses each week. */
mountSeasonNavigation();
/* welcomeForm and welcomeInput used to be looked up here and have never
   existed in index.html - leftovers from the free-text name box that the
   member picker replaced. Every branch that touched them was dead. */
const welcome=document.getElementById("welcome"),welcomeCancel=document.getElementById("welcome-cancel"),
      welcomeJoin=document.getElementById("welcome-join"),welcomeGolf=document.getElementById("welcome-golf"),
      welcomeCard=welcome?.querySelector(".overlay-card"),
      memberList=document.getElementById("member-list"),whoamiName=document.getElementById("whoami-name");
welcomeCard?.classList.add("access-card","welcome-card");
if(welcomeCard){welcomeCard.querySelector("h2").textContent="Welcome to DFL HQ";welcomeCard.querySelector("h2 + p")?.replaceChildren("Choose your profile to continue.")}
/* A golf guest is somebody, and the chip should say so. They have no member
   row and no username, so without this the top right read "Who are you?" at
   a person who had just told the app exactly who they were. */
function paintName(){
  const m=currentMember(),g=golfPass();
  if(!whoamiName)return;
  whoamiName.textContent=m?m.display_name:(g?g.name:(getUsername()||"Who are you?"));
}
/*
  FOCUS, FOR THE TWO THINGS THAT COVER THE PAGE.

  Both overlays already behaved by mouse and by thumb. By keyboard neither
  did: opening one left focus on the button BEHIND it, so the first Tab walked
  into a page that aria-modal has told a screen reader to ignore, and closing
  dropped focus back to the top of the document.

  One release function per surface, held here because there is exactly one of
  each on the page. releaseX() is idempotent (see focus-trap.js), so calling
  it on a close path that has already run costs nothing.

  The picker and the golf-join card are SIBLING overlay cards and the hidden
  one keeps its buttons in the DOM - which is why moving between them has to
  release one trap and take another, and why focus-trap.js filters on
  visibility rather than on markup alone.
*/
let releasePicker = null;
let releaseJoin = null;
let releaseMore = null;

function dropPickerFocus(){releasePicker?.();releasePicker=null;releaseJoin?.();releaseJoin=null}
/* Every path that hides #welcome goes through here, so there is one place
   where the overlay closing and the focus going back are the same event. */
function closeWelcome(){welcome?.classList.add("hidden");dropPickerFocus()}

async function openPicker({cancellable=false}={}){
  if(!welcome||!memberList)return;
  releaseJoin?.();releaseJoin=null;
  welcomeJoin?.classList.add("hidden");
  welcomeCard?.classList.remove("hidden");
  /* Dismissable when there is somewhere to go back to. This is what the
     button in index.html now makes possible; before, cancellable was a
     parameter that toggled a class on null. */
  welcomeCancel?.classList.toggle("hidden",!cancellable);
  welcome.classList.remove("hidden");
  /*
    Trapped BEFORE the list arrives, so a slow members read cannot leave a
    keyboard stranded on the page behind an open modal. The heading is the
    landing point rather than the first member button: it is what a screen
    reader should announce, and it stops Enter from instantly choosing
    whoever happens to be first.
  */
  releasePicker?.();
  /* The list does not exist yet, so the landing point is a FUNCTION - see
     focus-trap.js. Whoever is already chosen, else the first member: the
     dialog exists to pick a name, so a keyboard should arrive on the names
     rather than on the golf escape hatch beside them. */
  releasePicker=trapFocus(welcomeCard||welcome,{initial:()=>
    memberList.querySelector(".memberbtn.on")||memberList.querySelector(".memberbtn")});
  memberList.innerHTML=`<div class="muted tiny">Loading members…</div>`;
  let members=[];
  try{members=await loadMembers({force:true})}catch{}
  if(!members.length){
    memberList.innerHTML=`<div class="muted tiny">No members yet. An admin can add them in Admin → Members.</div>`;
    return;
  }
  const mine=getMemberId();
  memberList.innerHTML=members.map(m=>`<button type="button" class="memberbtn ${String(m.id)===mine?"on":""}" data-member="${m.id}"><span class="avatar avatar-fallback sm">${esc(initials(m.display_name))}</span><span class="memberbtn-text"><strong>${esc(m.display_name)}</strong>${m.team_name?`<span class="muted tiny">${esc(m.team_name)}</span>`:""}</span></button>`).join("");
}

/*
  THE GUEST DOOR.

  Mounted over the picker rather than beside it, and it never touches member
  identity: no selectMember, no setUsername, no registerUser. A guest who
  finishes this has an event pass and nothing else, which is exactly the
  amount of standing they should have.
*/
function openGolfJoin(){
  if(!welcome||!welcomeJoin)return;
  welcome.classList.remove("hidden");
  /* The picker is hidden but its buttons are still in the DOM one element
     away, so its trap has to go before this one arrives or Tab would walk
     into a member list nobody can see. */
  releasePicker?.();releasePicker=null;
  welcomeCard?.classList.add("hidden");
  welcomeJoin.classList.remove("hidden");
  mountJoin(welcomeJoin,{
    onDone:(pass)=>{
      closeWelcome();
      paintName();
      location.hash=`#/golf?id=${pass.outing}`;
      renderRoute();
    },
    /* Back to the picker, because somebody who opened this by mistake still
       has to get in somehow. */
    onCancel:()=>openPicker({cancellable:!!(currentMember()||getUsername()||golfPass())}),
  });
  /* mountJoin() has just built the form, so its first field exists to be
     focused. Taken after mounting for that reason. */
  releaseJoin?.();
  releaseJoin=trapFocus(welcomeJoin);
}

function initials(name){return String(name||"?").trim().slice(0,2).toUpperCase()}
/*
  The More sheet. Weekly football tools live in the fixed bar; completed-season
  and occasional tools live here. The routes are unchanged, so
  a link inside it just changes the hash and the sheet closes itself.
*/
const moreSheet=document.getElementById("more"),moreBtn=document.getElementById("more-btn");
/* The button says whether the sheet is open, because "More" on its own tells
   a screen reader nothing about what tapping it just did. */
const syncMore=()=>moreBtn?.setAttribute("aria-expanded",String(!moreSheet?.classList.contains("hidden")));
/*
  Closing gives focus back to the More button. That is the right place even
  when the close was a link: the sheet is the app's navigation, so a keyboard
  lands back on the control that opens it rather than at the top of a document
  it has just navigated to.
*/
const closeMore=()=>{moreSheet?.classList.add("hidden");syncMore();releaseMore?.();releaseMore=null};
const openMore=()=>{
  moreSheet?.classList.remove("hidden");
  syncMore();
  releaseMore?.();
  /* Close first, not the first nav link: it is the one control in here whose
     job is getting out, and it puts Escape and Tab on the same footing. */
  releaseMore=trapFocus(moreSheet.querySelector(".sheet-card")||moreSheet,{initial:"#more-close"});
};
moreBtn?.addEventListener("click",()=>{
  if(moreSheet?.classList.contains("hidden"))openMore();else closeMore();
});
document.getElementById("more-close")?.addEventListener("click",closeMore);
// Tapping the backdrop closes it; tapping the card must not.
moreSheet?.addEventListener("click",e=>{if(e.target===moreSheet)closeMore()});
moreSheet?.addEventListener("click",e=>{if(e.target.closest("a"))closeMore()});
window.addEventListener("hashchange",closeMore);
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMore()});
if(memberList)memberList.addEventListener("click",async e=>{const btn=e.target.closest("button[data-member]");if(!btn)return;const members=await loadMembers();const member=members.find(m=>String(m.id)===btn.dataset.member);if(!member)return;const previous=currentMember();if(previous&&String(previous.id)!==String(member.id))forgetVerifiedPin(previous.id);selectMember(member);await adoptSelectedMemberTheme();paintName();closeWelcome();await registerUser(member.display_name);toast(`Welcome, ${member.display_name}`);renderRoute()});
welcomeCancel?.addEventListener("click",closeWelcome);
welcomeGolf?.addEventListener("click",openGolfJoin);
/* Escape closes the picker only when there is a way back in - trapping
   somebody in a modal is the bug this pass exists to fix, and so is letting
   them escape a first run with no identity at all. */
/*
  THE FIRST-RUN RULE IS UNCHANGED, and the focus work must not weaken it.
  Escape still only closes the picker for somebody who already has an
  identity; a fresh browser cannot dismiss it, and the trap adds no other way
  out because it never closes anything - it only moves focus.
*/
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape"||welcome?.classList.contains("hidden"))return;
  if(currentMember()||getUsername()||golfPass())closeWelcome();
});
document.getElementById("whoami")?.addEventListener("click",()=>{
  if(currentMember())return go("profile");
  /* A guest's name goes back to the event they joined. Sending them to the
     member picker would be asking a question they have already answered. */
  const g=golfPass();
  if(g)return void(location.hash=`#/golf?id=${g.outing}`);
  openPicker({cancellable:!!getUsername()});
});
window.addEventListener("dfl:pick-member",event=>{if(event.detail?.forgetMemberId)forgetVerifiedPin(event.detail.forgetMemberId);openPicker({cancellable:true})});

/*
  THE SLIDING TAB INDICATOR.

  The CSS owns the transition; this only ever measures. Two custom properties
  on the bar - the active tab's offset and its width - and the ::before slides
  between them. Measured rather than computed from an index because the bar
  scrolls horizontally on a narrow phone and the tabs are not equal width.

  offsetLeft is relative to the bar, and the bar is the offsetParent (it is
  position:fixed), so a scrolled bar needs no correction - which is exactly why
  this is not done with getBoundingClientRect.
*/
function moveTabIndicator(){
  const bar=document.getElementById("tabbar");
  if(!bar)return;
  const active=bar.querySelector("a.on")||document.getElementById("more-btn")?.classList.contains("on")
    ?bar.querySelector("a.on")||document.getElementById("more-btn"):null;
  if(!active){bar.classList.remove("has-indicator");return;}
  bar.style.setProperty("--tab-x",`${active.offsetLeft}px`);
  bar.style.setProperty("--tab-w",`${active.offsetWidth}px`);
  bar.classList.add("has-indicator");
}
/* A rotate or a keyboard opening changes the tab widths under it. */
window.addEventListener("resize",moveTabIndicator);

const isPublicBroadcast=()=>location.hash.split("?")[0]==="#/broadcast";
async function boot(){console.log(`DFL HQ v${APP_VERSION}`);initTheme();/* Aggregate only - presence.js never learns who anybody is. */startPresence();if(!configured)toast("Add your Supabase keys in js/config.js",true);await Promise.all([restoreAdmin(),restoreMember(),loadSettings()]);paintName();mountMemberPreview();
  mountNotificationBell();
  /* The palette follows the member, not the browser. localStorage has already
     painted the first frame; this reconciles it with what they chose on any
     other device, and is deliberately not awaited so it cannot delay boot. */
  void syncThemeFromMember();
  /*
    THE TAB INDICATOR AND THE BOTTOMLINE, both hung off the router's own
    notification rather than off hashchange - so they update after the page has
    swapped rather than racing it, and Back/Forward get the same treatment as a
    tap because the router handles all three identically.
  */
  onRoute((name) => { moveTabIndicator(); paintBottomline(name, location.hash); });
  startRouter();
  /* Off the critical path on purpose: the first paint of the app does not wait
     for a ticker, and a failure means no ticker rather than no app. */
  startBottomline(currentRoute);/* A broadcast/OBS URL is a public spectator surface. It must render without
   asking the viewer to identify themselves, including in a fresh browser. */
if(!isPublicBroadcast()&&!currentMember()&&!getUsername()&&!golfPass())openPicker();
else if(getUsername())registerUser(getUsername());if("serviceWorker"in navigator&&location.protocol.startsWith("http"))navigator.serviceWorker.register("sw.js",{updateViaCache:"none"}).catch(console.warn);setupInstall();setupUpdates();
  /* Not awaited: it waits on the profile picker, which can stay open for as
     long as the member takes to find their name. */
  void setupNotifyNudge();
}
onGolfPassChange(paintName);
boot();

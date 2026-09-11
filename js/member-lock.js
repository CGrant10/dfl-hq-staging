// =====================================================================
// Member lock - optional PIN before a protected member identity can be used.
// Also owns the post-identity view choice for commissioners/owner.
// =====================================================================
import { db, restoreAdmin, commissionerLogin, adminLogin, adminLogout } from "./supabase.js";
import { currentMember } from "./members.js";
import { getAdminToken, getCommissionerPin, setAdminToken, setCommissionerPin } from "./store.js";
import { esc, toast } from "./ui.js";
import { icon } from "./icons.js";
const key=id=>`dfl.profile.unlocked.${id}`;
const pinKey=id=>`dfl.profile.pin.${id}`;
const trustedKey=id=>`dfl.profile.trustedDevice.${id}`;
const reminderKey=id=>`dfl.profile.lockReminder.${id}`;
const REMINDER_MS=30*24*60*60*1000;
const unlocked=id=>{try{if(sessionStorage.getItem(key(id))==="1")return true}catch{}try{return localStorage.getItem(trustedKey(id))==="1"}catch{return false}};
const markUnlocked=id=>{try{sessionStorage.setItem(key(id),"1")}catch{}};
const trustDevice=id=>{try{localStorage.setItem(trustedKey(id),"1")}catch{}};
const rememberPin=(id,pin)=>{try{sessionStorage.setItem(pinKey(id),pin)}catch{}};
export const markMemberUnlocked = (id, pin = null, { rememberDevice = false } = {}) => { markUnlocked(id); if (pin) rememberPin(id, pin); if (rememberDevice) trustDevice(id); };
export const isMemberUnlocked = (id) => unlocked(id);
export function verifiedPin(memberId){if(memberId==null)return null;try{return sessionStorage.getItem(pinKey(memberId))||null}catch{return null}}
export function forgetVerifiedPin(memberId){try{sessionStorage.removeItem(pinKey(memberId));sessionStorage.removeItem(key(memberId))}catch{}try{localStorage.removeItem(trustedKey(memberId))}catch{}}

let overlay=null,pendingButton=null,started=false,replaying=false,releasePinPad=()=>{};
let commissionerIds=null;
async function isLocked(memberId){try{const{data,error}=await db().rpc("profile_lock_status",{target_member_id:Number(memberId)});if(error)throw error;return!!data}catch{return false}}
async function loadCommissionerIds(){
 if(commissionerIds)return commissionerIds;
 try{const{data,error}=await db().rpc("public_commissioners");if(error)throw error;commissionerIds=new Set((data||[]).map(r=>String(r.member_id)));}
 catch{commissionerIds=new Set();}
 return commissionerIds;
}
function closeOverlay(){releasePinPad();releasePinPad=()=>{};overlay?.remove();overlay=null;document.body.classList.remove("access-locked")}
function replay(btn){replaying=true;try{btn?.click()}finally{replaying=false}}
const waitForMember=async id=>{for(let i=0;i<30;i++){if(String(localStorage.getItem("dfl.memberId")||"")===String(id))return true;await new Promise(r=>setTimeout(r,20));}return false};
const redraw=()=>window.dispatchEvent(new HashChangeEvent("hashchange"));

function pinPadMarkup({id,name,label="PIN",min=4,max=6}){
 const dots=Array.from({length:Math.min(max,6)},()=>`<span></span>`).join("");
 const keys=["1","2","3","4","5","6","7","8","9","clear","0","back"];
 return `<div class="access-pin" data-pin-pad data-pin-input="${id}" data-pin-min="${min}" data-pin-max="${max}"><input id="${id}" name="${name}" type="hidden"><div class="access-pin-head"><strong>${esc(label)}</strong><span data-pin-count>Enter ${min}–${max} digits</span></div><div class="access-pin-dots" data-pin-dots aria-live="polite" aria-label="No PIN digits entered">${dots}</div><div class="access-keypad" role="group" aria-label="${esc(label)} keypad">${keys.map(key=>key==="clear"?`<button type="button" class="is-command" data-pin-key="clear">Clear</button>`:key==="back"?`<button type="button" class="is-command" data-pin-key="back" aria-label="Delete last digit">⌫</button>`:`<button type="button" data-pin-key="${key}" aria-label="${key}">${key}</button>`).join("")}</div></div>`;
}

function wirePinPad(host){
 releasePinPad();
 const pad=host.querySelector("[data-pin-pad]");if(!pad)return null;
 const input=host.querySelector(`#${pad.dataset.pinInput}`),form=pad.closest("form"),submit=form?.querySelector('button[type="submit"]'),min=Number(pad.dataset.pinMin)||4,max=Number(pad.dataset.pinMax)||6,dots=[...pad.querySelectorAll("[data-pin-dots] span")],count=pad.querySelector("[data-pin-count]"),dotBox=pad.querySelector("[data-pin-dots]");
 const feedbackTimers=new Map();
 const feedback=button=>{if(!button)return;button.classList.remove("is-pressed");void button.offsetWidth;button.classList.add("is-pressed");clearTimeout(feedbackTimers.get(button));feedbackTimers.set(button,setTimeout(()=>button.classList.remove("is-pressed"),280));try{button.focus({preventScroll:true});navigator.vibrate?.(8)}catch{}};
 const update=()=>{const length=input.value.length;dots.forEach((dot,index)=>{dot.classList.toggle("is-filled",index<Math.min(length,dots.length));dot.classList.toggle("is-next",index===length&&length<max)});count.textContent=length?`${length} digit${length===1?"":"s"} entered`:`Enter ${min}–${max} digits`;dotBox.setAttribute("aria-label",length?`${length} PIN digits entered`:"No PIN digits entered");if(submit)submit.disabled=length<min;};
 const press=(key,button=pad.querySelector(`[data-pin-key="${key}"]`))=>{feedback(button);if(key==="clear")input.value="";else if(key==="back")input.value=input.value.slice(0,-1);else if(/^\d$/.test(key)&&input.value.length<max)input.value+=key;update();};
 let lastTouchButton=null,lastTouchAt=0;
 const pointerdown=e=>{if(e.pointerType==="mouse")return;const button=e.target.closest?.("[data-pin-key]");if(!button)return;e.preventDefault();lastTouchButton=button;lastTouchAt=performance.now();press(button.dataset.pinKey,button)};
 const click=e=>{const button=e.target.closest?.("[data-pin-key]");if(!button)return;if(e.detail!==0&&button===lastTouchButton&&performance.now()-lastTouchAt<800)return;press(button.dataset.pinKey,button)};
 const keydown=e=>{if(!overlay||!host.isConnected||e.target?.matches?.('input:not([type="hidden"]),textarea'))return;if(/^\d$/.test(e.key)){e.preventDefault();press(e.key)}else if(e.key==="Backspace"){e.preventDefault();press("back")}else if(e.key==="Escape"){const back=host.querySelector("[data-member-lock-cancel],[data-mode-back]");if(back){e.preventDefault();back.click()}}else if(e.key==="Enter"&&input.value.length>=min){e.preventDefault();form?.requestSubmit()}};
 pad.addEventListener("pointerdown",pointerdown);pad.addEventListener("click",click);document.addEventListener("keydown",keydown);input.clearPin=()=>{input.value="";pad.querySelectorAll("[data-pin-key]").forEach(key=>key.classList.remove("is-pressed"));update()};releasePinPad=()=>{pad.removeEventListener("pointerdown",pointerdown);pad.removeEventListener("click",click);document.removeEventListener("keydown",keydown);feedbackTimers.forEach(timer=>clearTimeout(timer));feedbackTimers.clear()};update();return input;
}

const trustedDeviceMarkup=()=>`<label class="access-trust"><input type="checkbox" data-trust-device><span><strong>Stay unlocked on this device</strong><small>Skip this PIN on this browser until you switch profiles. Use only on your own device.</small></span></label>`;

function reminderDue(id){
 try{
   const last=Number(localStorage.getItem(reminderKey(id))||0);
   return !last||Date.now()-last>=REMINDER_MS;
 }catch{return true}
}
function markReminder(id){try{localStorage.setItem(reminderKey(id),String(Date.now()))}catch{}}
async function scrollToProfileLock(){
 location.hash="#/profile";
 for(let i=0;i<24;i++){
   await new Promise(r=>setTimeout(r,100));
   const card=document.querySelector("[data-profile-lock-settings]");
   if(card){card.scrollIntoView({behavior:"smooth",block:"center"});return;}
 }
}
function showProfileLockReminder(member){
 if(overlay)return;
 overlay=document.createElement("div");overlay.className="overlay";overlay.setAttribute("role","dialog");overlay.setAttribute("aria-modal","true");overlay.setAttribute("aria-label","Protect your DFL profile");
 overlay.innerHTML=`<div class="overlay-card"><h2>Want to lock your profile?</h2><p class="muted">You can add a 4–6 digit PIN so nobody else can open DFL HQ as <strong>${esc(member.display_name)}</strong>.</p><div class="row-end"><button type="button" class="btn ghost" data-lock-remind-later>Not now</button><button type="button" class="btn" data-lock-remind-set>Set a PIN</button></div><p class="muted tiny">We’ll only remind you about this occasionally.</p></div>`;
 document.body.appendChild(overlay);
 overlay.querySelector("[data-lock-remind-later]")?.addEventListener("click",closeOverlay);
 overlay.querySelector("[data-lock-remind-set]")?.addEventListener("click",async()=>{closeOverlay();await scrollToProfileLock();});
}
async function maybeRemindProfileLock(member){
 if(!member?.id||!reminderDue(member.id))return;
 /* A lock already exists: never advertise a feature this profile already uses. */
 if(await isLocked(member.id))return;
 markReminder(member.id);
 showProfileLockReminder(member);
}
function scheduleProfileLockReminder(member){setTimeout(()=>void maybeRemindProfileLock(member),550)}

/* Member View must really be non-admin even when a credential is remembered.
   Preserve the saved secrets, clear only the live privileged client, then put
   the secrets back so Commissioner View can restore them later without a trip
   through Admin. */
function suspendPrivilege(){
 const master=getAdminToken(),commissioner=getCommissionerPin();
 adminLogout();
 if(master)setAdminToken(master);
 if(commissioner)setCommissionerPin(commissioner);
}

async function activateSavedPrivilege(memberId){
 await waitForMember(memberId);
 try{return await restoreAdmin()}catch{return false}
}

function showPrivilegeLogin(member,btn,{startup=false,stayPut=false,onDone=null}={}){
 closeOverlay();overlay=document.createElement("div");overlay.className="overlay";overlay.setAttribute("role","dialog");overlay.setAttribute("aria-modal","true");overlay.setAttribute("aria-label",`Commissioner access for ${member.display_name}`);
 overlay.innerHTML=`<div class="overlay-card access-card"><div class="access-brand"><span class="pin-mark">${icon("shield",{size:21})}</span><span><small>DFL SECURE ACCESS</small><strong>Commissioner View</strong></span></div><p class="muted">Enter your commissioner PIN for <strong>${esc(member.display_name)}</strong>.</p>
 <form data-commissioner-login autocomplete="off">${pinPadMarkup({id:"pick-commissioner-pin",name:"dfl-commissioner-pin",label:"Commissioner PIN",min:4,max:12})}<div class="row-end"><button type="button" class="btn ghost" data-mode-back>Back</button><button type="submit" class="btn">Open Commissioner View</button></div></form>
 <details style="margin-top:12px"><summary class="muted tiny">Owner master access</summary><form data-master-login autocomplete="off" style="margin-top:10px"><label for="pick-master-key">Master password</label><input id="pick-master-key" name="dfl-admin-key" type="password" autocomplete="off" data-lpignore="true" data-1p-ignore><div class="row-end"><button type="submit" class="btn ghost">Open Owner View</button></div></form></details></div>`;
 document.body.appendChild(overlay);
 const pin=wirePinPad(overlay);
 overlay.querySelector("[data-mode-back]")?.addEventListener("click",()=>{if(stayPut){closeOverlay();onDone?.(false);return}showViewChoice(member,btn,{startup})});
 overlay.querySelector("[data-commissioner-login]")?.addEventListener("submit",async e=>{e.preventDefault();const submit=e.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;try{await waitForMember(member.id);if(!(await commissionerLogin(pin.value,true)))throw new Error("Commissioner PIN not accepted");closeOverlay();toast("Commissioner View on");if(stayPut){onDone?.(true)}else if(startup)redraw();else{location.hash="#/home";redraw();scheduleProfileLockReminder(member);}}catch(err){toast(err.message||"Could not unlock commissioner access",true);pin.clearPin?.();}});
 overlay.querySelector("[data-master-login]")?.addEventListener("submit",async e=>{e.preventDefault();const input=e.currentTarget.querySelector("#pick-master-key"),submit=e.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;try{await waitForMember(member.id);if(!(await adminLogin(input.value,true)))throw new Error("Master password not accepted");closeOverlay();toast("Owner View on");if(stayPut){onDone?.(true)}else if(startup)redraw();else{location.hash="#/home";redraw();scheduleProfileLockReminder(member);}}catch(err){toast(err.message||"Could not unlock owner access",true);submit.disabled=false;input.select();}});
}

function showViewChoice(member,btn,{startup=false}={}){
 closeOverlay();overlay=document.createElement("div");overlay.className="overlay";overlay.setAttribute("role","dialog");overlay.setAttribute("aria-modal","true");overlay.setAttribute("aria-label",`Choose view for ${member.display_name}`);
 /*
   TWO CHOICES, DRAWN AS CHOICES.

   These were .btn and .btn.ghost inside a `.stack` - a class that is
   defined in no stylesheet, so its inline gap:10px did nothing on a
   display:block element and the two buttons sat flush against each other.
   Each also held a <strong> and a <span> inside a centred inline-flex with
   zero vertical padding, so a two-line explanation came out squashed and
   centred inside a control shaped like a submit button.

   A choice between two ways into the app is a list of options, not a pair
   of buttons: full width, icon, title, and the sentence that tells them
   apart, left-aligned so the eye reads down them.
 */
 overlay.innerHTML=`<div class="overlay-card"><h2>Open as ${esc(member.display_name)}</h2>
 <p class="muted">Choose how you want to enter DFL HQ.</p>
 <div class="choice-list">
   <button type="button" class="choice" data-member-view>
     <span class="choice-ico">${icon("user",{size:20})}</span>
     <span class="choice-body"><strong>Member View</strong>
       <span class="choice-sub">The regular league view. No commissioner controls.</span></span>
   </button>
   <button type="button" class="choice is-primary" data-admin-view>
     <span class="choice-ico">${icon("shield",{size:20})}</span>
     <span class="choice-body"><strong>Commissioner View</strong>
       <span class="choice-sub">Opens with your privileged tools.</span></span>
   </button>
 </div>
 ${startup?"":`<div class="row-end" style="margin-top:14px"><button type="button" class="btn ghost" data-choice-cancel>Back</button></div>`}</div>`;
 document.body.appendChild(overlay);
 overlay.querySelector("[data-choice-cancel]")?.addEventListener("click",closeOverlay);
 overlay.querySelector("[data-member-view]")?.addEventListener("click",()=>{suspendPrivilege();closeOverlay();if(btn){replay(btn);scheduleProfileLockReminder(member);}else redraw();toast(`Member View · ${member.display_name}`)});
 overlay.querySelector("[data-admin-view]")?.addEventListener("click",async()=>{
   const choice=overlay.querySelector("[data-admin-view]");choice.disabled=true;
   closeOverlay();if(btn)replay(btn);
   if(await activateSavedPrivilege(member.id)){toast(`Commissioner View · ${member.display_name}`);if(startup)redraw();else{location.hash="#/home";redraw();scheduleProfileLockReminder(member);}return;}
   showPrivilegeLogin(member,btn,{startup});
 });
}

async function continueMemberPick(btn,member){
 const ids=await loadCommissionerIds();
 if(ids.has(String(member.id))){showViewChoice(member,btn);return;}
 replay(btn);
 scheduleProfileLockReminder(member);
}

function showLock(member,{onSuccess=null,cancellable=true,afterUnlock=null}={}){
 closeOverlay();overlay=document.createElement("div");overlay.className="overlay access-lock-overlay";document.body.classList.add("access-locked");overlay.setAttribute("role","dialog");overlay.setAttribute("aria-modal","true");overlay.setAttribute("aria-label",`${member.display_name} locked`);
 overlay.innerHTML=`<div class="overlay-card access-card is-pin"><div class="access-brand"><span class="pin-mark">${icon("lock",{size:21})}</span><span><small>WELCOME BACK</small><strong>${esc(member.display_name)}</strong></span></div><p class="muted">Enter your profile PIN to open DFL HQ.</p><form data-member-lock-form autocomplete="off">${pinPadMarkup({id:"member-lock-pin",name:"dfl-member-pin",label:"Profile PIN",min:4,max:6})}${trustedDeviceMarkup()}<div class="row-end">${cancellable?`<button type="button" class="btn ghost" data-member-lock-cancel>Back</button>`:""}<button type="submit" class="btn">Unlock DFL HQ</button></div></form></div>`;document.body.appendChild(overlay);
 const input=wirePinPad(overlay);overlay.querySelector("[data-member-lock-cancel]")?.addEventListener("click",()=>{pendingButton=null;closeOverlay()});overlay.querySelector("[data-member-lock-form]")?.addEventListener("submit",async e=>{e.preventDefault();const submit=e.currentTarget.querySelector('button[type="submit"]'),rememberDevice=!!e.currentTarget.querySelector("[data-trust-device]")?.checked;submit.disabled=true;try{const{data,error}=await db().rpc("profile_verify_pin",{target_member_id:Number(member.id),attempted_pin:input.value});if(error)throw error;if(data!==true)throw new Error("Wrong profile PIN");markMemberUnlocked(member.id,input.value,{rememberDevice});const choice=pendingButton;pendingButton=null;closeOverlay();toast(rememberDevice?`Trusted this device for ${member.display_name}`:`Unlocked for ${member.display_name}`);if(afterUnlock&&choice)await afterUnlock(choice,member);else if(onSuccess)await onSuccess();else replay(choice);}catch(err){toast(err.message||"Could not unlock member",true);input.clearPin?.();}});
}

function interceptMemberPick(event){
 if(replaying)return;const btn=event.target.closest?.("button[data-member]");if(!btn)return;
 event.preventDefault();event.stopImmediatePropagation();const id=btn.dataset.member;if(!id)return;
 const label=btn.querySelector("strong")?.textContent?.trim()||"This member";const member={id,display_name:label};
 if(unlocked(id)){void continueMemberPick(btn,member);return;}
 btn.disabled=true;isLocked(id).then(locked=>{btn.disabled=false;if(!locked){void continueMemberPick(btn,member);return;}pendingButton=btn;showLock(member,{cancellable:true,afterUnlock:continueMemberPick});});
}

async function enterRememberedIdentity(){
 const member=currentMember();
 if(!member)return;
 /* A shared/OBS broadcast is intentionally public and must never get an
    identity-mode modal dropped over the race. */
 if(location.hash.split("?")[0]==="#/broadcast")return;
 const ids=await loadCommissionerIds();
 const privileged=ids.has(String(member.id));
 const locked=await isLocked(member.id);
 if(locked&&!unlocked(member.id)){
   showLock(member,{cancellable:false,onSuccess:async()=>{if(privileged)showViewChoice(member,null,{startup:true});}});
   return;
 }
 if(privileged)showViewChoice(member,null,{startup:true});
}

/* Whether a member holds commissioner access at all, which is a different
   question from whether they have entered their PIN this session. Answered by
   the public_commissioners RPC, so it needs no credentials. */
export async function isCommissionerMember(memberId){
  if(memberId==null)return false;
  const ids=await loadCommissionerIds();
  return ids.has(String(memberId));
}

/*
  Ask for commissioner access without leaving the page. Resolves true once the
  session is privileged and false if the member declines or is not a
  commissioner. A saved PIN is tried first, so somebody who has already unlocked
  on this device is not asked twice.
*/
export async function requestCommissionerAccess(){
  const member=currentMember();
  if(!member||!(await isCommissionerMember(member.id)))return false;
  if(await activateSavedPrivilege(member.id))return true;
  return await new Promise(resolve=>{
    let settled=false;
    const done=ok=>{if(settled)return;settled=true;resolve(!!ok)};
    showPrivilegeLogin({id:member.id,display_name:member.display_name},null,{stayPut:true,onDone:done});
  });
}

export function startMemberLock(){
 if(started)return;
 started=true;
 document.addEventListener("click",interceptMemberPick,true);
 void enterRememberedIdentity();
}

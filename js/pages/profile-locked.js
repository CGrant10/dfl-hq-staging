// =====================================================================
// Profile gate/settings. PINs are numeric app locks, not login credentials.
// =====================================================================
import { db } from "../supabase.js";
import { currentMember, loadMembers } from "../members.js";
import { esc, toast } from "../ui.js";
import { icon } from "../icons.js";
import * as profile from "./profile.js";
/*
  ONE OWNER FOR THE UNLOCKED SESSION, in member-lock.js.

  This file used to keep its own key()/unlocked()/markUnlocked() against the same
  sessionStorage keys. Two copies of one piece of state, and only one of them
  learned to keep the verified PIN - so unlocking HERE (the gate a member
  actually passes) recorded the boolean and threw the PIN away, and anything
  needing server-side proof later asked for it again.
*/
import { markMemberUnlocked, isMemberUnlocked, forgetVerifiedPin } from "../member-lock.js";
const unlocked=id=>isMemberUnlocked(id);
const markUnlocked=(id,pin=null,options)=>markMemberUnlocked(id,pin,options);
const clearUnlocked=id=>forgetVerifiedPin(id);
const pinInput=(id,name,required=true)=>`<input id="${id}" name="${name}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" minlength="4" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" style="-webkit-text-security:disc" ${required?"required":""}>`;
async function targetMember(){const wanted=new URLSearchParams((location.hash.split("?")[1]||"")).get("id"),members=await loadMembers(),me=currentMember();return wanted?members.find(m=>String(m.id)===String(wanted)):me;}
async function lockStatus(id){const{data,error}=await db().rpc("profile_lock_status",{target_member_id:Number(id)});if(error)throw error;return!!data;}
function missingLockSchema(err){
 const code=String(err?.code||"");
 const message=String(err?.message||"").toLowerCase();
 return code==="PGRST202"||code==="42883"||message.includes("profile_lock_status")&&message.includes("not find");
}
/*
  THE LOCK SCREEN.

  It used to be a page-head and a full-width form card, so on a desktop a
  four-to-six digit PIN got an 834px input - a code field the width of the
  monitor, left-aligned, next to a heading and a paragraph spread across the
  same width. It is one question, so it is now one narrow centred panel: a
  lock mark, the question, a short centred field with the digits tracked
  apart, and the two things you can do about it.

  It also never focused the field. `setAttribute("autofocus", "")` after the
  element is already in the document does nothing - the attribute is only
  read when the element is parsed - so every visit started with a tap on the
  input. There is a real focus() call at the end now.
*/
function gate(view,member,{statusUnknown=false}={}){view.innerHTML=`<div id="profile-lock-gate"><div class="pin-panel"><span class="pin-mark">${icon("lock",{size:24})}</span><h1>${statusUnknown?"Unlock profile":"Profile locked"}</h1><p class="muted">${statusUnknown?"We couldn’t confirm the lock after changing views. Enter your PIN or try the check again.":`${esc(member.display_name)} keeps this one behind a PIN.`}</p><form id="profile-unlock-form" autocomplete="off"><label for="profile-unlock-pin">Profile PIN</label>${pinInput("profile-unlock-pin","dfl-profile-unlock").replace("<input ","<input class=\"pin-input\" ")}<label class="access-trust"><input type="checkbox" data-trust-device><span><strong>Stay unlocked on this device</strong><small>Skip this PIN on this browser until you switch profiles. Use only on your own device.</small></span></label><div class="row-end"><a class="btn ghost" href="#/home">Back</a>${statusUnknown?`<button class="btn ghost" type="button" id="profile-lock-retry">Retry</button>`:""}<button class="btn" type="submit">Unlock profile</button></div></form><p class="muted tiny pin-note">Forgot it? A DFL Owner can reset the lock, but nobody can read the PIN.</p></div></div>`;const form=view.querySelector("#profile-unlock-form"),input=view.querySelector("#profile-unlock-pin");input?.addEventListener("input",()=>{input.value=input.value.replace(/\D/g,"").slice(0,6)});view.querySelector("#profile-lock-retry")?.addEventListener("click",()=>render(view));setTimeout(()=>input?.focus(),0);form?.addEventListener("submit",async e=>{e.preventDefault();const btn=form.querySelector("button[type=submit]"),rememberDevice=!!form.querySelector("[data-trust-device]")?.checked;btn.disabled=true;try{const{data,error}=await db().rpc("profile_verify_pin",{target_member_id:Number(member.id),attempted_pin:input.value});if(error)throw error;if(data!==true)throw new Error("Wrong profile PIN");markUnlocked(member.id,input.value,{rememberDevice});toast(rememberDevice?"Profile unlocked on this device":"Profile unlocked");render(view);}catch(err){toast(err.message||"Could not unlock profile",true);btn.disabled=false;input.select();}});}
function settingsCard(member,locked,migrationReady){if(!migrationReady)return `<div class="card note"><div class="card-title">Profile lock</div><div class="card-body muted">Profile PIN setup is ready in the app. Run <strong>profile_lock_schema.sql</strong> in Supabase to turn it on.</div></div>`;return `<div class="card" data-profile-lock-settings><div class="card-title">Profile lock</div><p class="muted tiny">Optional 4–6 digit PIN for using DFL HQ as you. You can trust your personal device when you unlock.</p><form id="profile-lock-form" autocomplete="off">${locked?`<label for="profile-current-pin">Current PIN</label>${pinInput("profile-current-pin","dfl-current-pin")}`:""}<label for="profile-new-pin">${locked?"New PIN":"Choose a PIN"}</label>${pinInput("profile-new-pin","dfl-new-pin")}<div class="row-end">${locked?`<button type="button" class="btn danger ghost" id="profile-disable-lock">Turn lock off</button>`:""}<button type="submit" class="btn">${locked?"Change PIN":"Turn lock on"}</button></div></form></div>`;}
function wireSettings(view,member,locked){const root=view.querySelector("[data-profile-lock-settings]");if(!root)return;root.querySelectorAll('input[inputmode="numeric"]').forEach(input=>input.addEventListener("input",()=>{input.value=input.value.replace(/\D/g,"").slice(0,6)}));const form=root.querySelector("#profile-lock-form");form?.addEventListener("submit",async e=>{e.preventDefault();const current=root.querySelector("#profile-current-pin")?.value||null,next=root.querySelector("#profile-new-pin")?.value||"",btn=form.querySelector("button[type=submit]");btn.disabled=true;try{const{error}=await db().rpc("profile_set_pin",{new_pin:next,current_pin:current});if(error)throw error;markUnlocked(member.id,next);toast(locked?"Profile PIN changed":"Profile lock turned on");render(view);}catch(err){toast(err.message||"Could not save profile PIN",true);btn.disabled=false;}});root.querySelector("#profile-disable-lock")?.addEventListener("click",async()=>{const current=root.querySelector("#profile-current-pin")?.value||"";if(!current){toast("Enter your current PIN first",true);return;}if(!confirm("Turn off your Profile PIN?"))return;try{const{error}=await db().rpc("profile_disable_pin",{current_pin:current});if(error)throw error;clearUnlocked(member.id);toast("Profile lock turned off");render(view);}catch(err){toast(err.message||"Could not turn off profile lock",true);}});}
export async function render(view){let member;try{member=await targetMember()}catch(err){view.innerHTML=`<h1>Profile</h1><div class="card"><div class="card-body">${esc(err.message||"Could not load member")}</div></div>`;return;}if(!member)return profile.render(view);let locked=false,migrationReady=true;try{locked=await lockStatus(member.id)}catch(err){if(missingLockSchema(err)){migrationReady=false}else if(!unlocked(member.id)){gate(view,member,{statusUnknown:true});return;}}if(locked&&!unlocked(member.id)){gate(view,member);return;}await profile.render(view);const me=currentMember(),isMe=me&&String(me.id)===String(member.id);if(!isMe)return;const slot=view.querySelector("[data-profile-privacy-slot]");if(!slot)return;slot.innerHTML=settingsCard(member,locked,migrationReady);if(migrationReady)wireSettings(view,member,locked);}

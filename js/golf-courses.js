/* DFL Golf course library - mobile-first admin course picker */
import { db, isAdmin } from "./supabase.js";
import { toast } from "./ui.js";
const esc=v=>String(v??"").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let lastKey="";
function style(){if(document.getElementById("golf-course-library-style"))return;const s=document.createElement("style");s.id="golf-course-library-style";s.textContent=`.golf-course-library{margin:12px 0;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--bg-2)}.course-picker-head{margin-bottom:9px}.course-picker-row{display:flex;gap:8px;align-items:center}.course-picker-row select{min-width:0;flex:1;height:40px;padding:0 10px;border:1px solid var(--line);border-radius:7px;background:var(--bg-3);color:var(--text);font:inherit}.course-picker-row .btn{min-height:40px}.golf-course-library .card-title{font-weight:800}.golf-course-library .tiny{margin:3px 0 0}@media(max-width:600px){.course-picker-row{display:grid;grid-template-columns:1fr}.course-picker-row .btn{width:100%}}`;document.head.appendChild(s)}
async function enhance(){
  if(!isAdmin())return;
  const root=document.querySelector("#golf-outing");
  if(!root)return;
  const q=new URLSearchParams(location.hash.split("?")[1]||"");
  const outingId=q.get("id");
  if(!outingId||q.get("team"))return;
  const adminCard=root.querySelector(".golf-admin-card"),betaSetup=root.querySelector(".tb-setup"),host=adminCard||betaSetup;
  if(!host)return;
  const key=`${outingId}:${betaSetup?"beta":"classic"}:${adminCard?.querySelector(".golf-generator")?.outerHTML?.length||0}`;
  if(lastKey===key&&host.querySelector("#golf-course-picker"))return;
  lastKey=key;
  style();
  const[courses,outings]=await Promise.all([db().from("golf_courses").select("id,name,city,state,holes,par,yardage,course_rating,slope").order("name"),db().from("golf_outings").select("course_id,course,holes").eq("id",outingId).maybeSingle()]);
  if(courses.error||outings.error||!outings.data)return;
  const current=outings.data,list=courses.data||[],wrap=document.createElement("div");
  wrap.className="golf-course-library";wrap.id="golf-course-picker";
  wrap.innerHTML=`<div class="course-picker-head"><div class="card-title">Event course</div><p class="muted tiny">Pick a saved course to populate this event's scorecards, yardages and GPS.</p></div><div class="course-picker-row"><select id="golf-course-select"><option value="">— Select course —</option>${list.map(c=>`<option value="${c.id}" ${String(c.id)===String(current.course_id)?"selected":""}>${esc(c.name)}${c.city?` · ${esc(c.city)}, ${esc(c.state||"")}`:""}</option>`).join("")}</select><button class="btn small" id="golf-course-apply" disabled>Apply course</button></div><div id="golf-course-meta" class="muted tiny"></div>`;
  if(betaSetup)betaSetup.prepend(wrap);else adminCard.querySelector(".golf-generator")?.insertAdjacentElement("beforebegin",wrap);
  const select=wrap.querySelector("#golf-course-select"),apply=wrap.querySelector("#golf-course-apply"),meta=wrap.querySelector("#golf-course-meta");
  const showMeta=()=>{const c=list.find(x=>String(x.id)===String(select.value));apply.disabled=!c;if(c)meta.textContent=`${c.holes} holes · Par ${c.par??"—"} · ${c.yardage?`${c.yardage} yds`:"yardage not listed"}`;else meta.textContent=""};
  select.addEventListener("change",showMeta);showMeta();
  apply.addEventListener("click",async()=>{if(!select.value)return;apply.disabled=true;try{const{error}=await db().rpc("golf_apply_course_to_outing",{p_outing_id:Number(outingId),p_course_id:Number(select.value)});if(error)throw error;toast("Course applied — scorecards and GPS updated");lastKey="";window.dispatchEvent(new HashChangeEvent("hashchange"))}catch(err){toast(err.message||"Could not apply course",true);showMeta()}});
}
const observer=new MutationObserver(()=>enhance());function boot(){observer.observe(document.body,{childList:true,subtree:true});enhance()}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();

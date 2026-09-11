/* Enhance the Golf outing editor so Course is selected from golf_courses.
   Keeps the legacy course text populated for old UI while also saving course_id. */
import { db } from "./supabase.js";

let busy=false;
const esc=v=>String(v??"").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

async function enhance(){
  if(busy)return;
  const input=document.querySelector('.overlay input[name="course"], dialog input[name="course"], .modal input[name="course"], .sheet input[name="course"]');
  if(!input||input.dataset.courseDbEnhanced)return;
  busy=true;
  try{
    const {data,error}=await db().from("golf_courses").select("id,name,city,state,holes").order("name");
    if(error||!data?.length)return;
    input.dataset.courseDbEnhanced="1";
    const current=String(input.value||"");
    const select=document.createElement("select");
    select.name="course";
    select.required=true;
    select.innerHTML=`<option value="">— Select saved course —</option>${data.map(c=>`<option value="${esc(c.name)}" data-id="${c.id}" data-holes="${c.holes||9}" ${current===c.name?"selected":""}>${esc(c.name)}${c.city?` · ${esc(c.city)}`:""}${c.state?`, ${esc(c.state)}`:""}</option>`).join("")}`;
    select.className=input.className;
    const courseId=document.createElement("input");
    courseId.type="hidden";
    courseId.name="course_id";
    const sync=()=>{
      const o=select.selectedOptions[0];
      courseId.value=o?.dataset.id||"";
      const holes=select.closest("form")?.querySelector('[name="holes"]')||document.querySelector('dialog [name="holes"], .modal [name="holes"], .sheet [name="holes"]');
      if(holes&&o?.dataset.holes)holes.value=o.dataset.holes;
    };
    select.addEventListener("change",sync);
    input.replaceWith(select);
    select.insertAdjacentElement("afterend",courseId);
    sync();
  }finally{busy=false}
}

const observer=new MutationObserver(()=>enhance());
function boot(){observer.observe(document.body,{childList:true,subtree:true});enhance()}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();

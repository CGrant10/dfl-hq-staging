import { db } from "./supabase.js";
import { loadMembers, getMemberId } from "./members.js";
import { esc, toast } from "./ui.js";
import { averagePuttsLabel, roundDetailStats } from "./golf-round-stats.js";
import { quickCourseHoleMap, quickCourseId, quickHolesFor } from "./golf-quick-courses.js";

const onGolf=()=>location.hash.split("?")[0]==="#/golf"&&!new URLSearchParams(location.hash.split("?")[1]||"").get("id");
const label=m=>m?.golf_name||m?.display_name||m?.name||"Golfer";
const initials=name=>String(name||"G").trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()||"G";
const handicap=m=>m?.golf_handicap??m?.handicap??m?.hcp??null;
const ordinal=n=>{const v=n%100;return `${n}${v>=11&&v<=13?"th":n%10===1?"st":n%10===2?"nd":n%10===3?"rd":"th"}`};

function style(){
  if(document.getElementById("golf-quick-style"))return;
  const s=document.createElement("style");s.id="golf-quick-style";s.textContent=`
.gq{margin:12px 0;padding:0;overflow:hidden}.gq-home{padding:14px}.gq-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.gq-head h2{margin:0;font-size:19px}.gq-head p{margin:3px 0 0}.gq-form{display:grid;gap:10px;margin-top:12px}.gq-form select,.gq-form input{width:100%;min-height:42px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg-3);color:var(--text);font:inherit}.gq-members{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.gq-person,.gq-private{display:flex;gap:7px;align-items:center;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg-2);font-size:13px}.gq-person input,.gq-private input{width:auto;min-height:auto}.gq-person-course{display:grid;grid-template-columns:minmax(0,1fr) minmax(118px,.9fr)}.gq-person-course label{display:flex;align-items:center;gap:7px;min-width:0}.gq-person-course label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gq-person-course select{min-width:0;font-size:11px}.gq-guest-course{display:grid;grid-template-columns:1fr 1fr;gap:8px}.gq-player-course-name{margin-top:3px;color:var(--muted);font-size:10px;font-weight:800}.gq-actions{display:flex;gap:8px}.gq-recent{display:grid;gap:6px;margin-top:10px}.gq-recent button{display:flex;justify-content:space-between;gap:10px;width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg-2);color:var(--text);font:inherit;text-align:left}
.gq-play{min-height:560px;background:var(--bg);color:var(--text);position:relative;padding-bottom:76px}.gq-round-meta{display:none}.gq-hole-head{display:grid;grid-template-columns:42px 1fr 42px 104px;align-items:center;gap:7px;padding:12px 10px 10px;border-bottom:1px solid var(--line);background:var(--bg-2)}.gq-navbtn{width:42px;height:42px;border:0;border-radius:50%;background:var(--bg-3);color:var(--text);font-size:28px;line-height:1}.gq-hole-title{text-align:center}.gq-hole-title strong{display:block;font-size:29px;line-height:1}.gq-hole-title span{display:block;margin-top:7px;font-size:13px;color:var(--muted)}.gq-yardage{width:96px;height:96px;border:3px solid currentColor;border-radius:50%;display:grid;place-items:center;text-align:center;justify-self:end;background:var(--bg-3);color:var(--text)}.gq-yardage small{display:block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.gq-yardage b{display:block;font-size:30px;line-height:1}.gq-timer{padding:10px 16px;border-bottom:1px solid var(--line);font-size:13px;color:var(--muted);background:var(--bg)}.gq-players{display:grid}.gq-player{display:grid;grid-template-columns:72px minmax(0,1fr) 118px;align-items:center;gap:10px;padding:16px;border-bottom:1px solid var(--line);min-height:138px;background:var(--bg)}.gq-avatar{width:62px;height:62px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,var(--accent,#4d7cff),var(--bg-3));color:#fff;font-size:24px;font-weight:900;border:1px solid rgba(255,255,255,.15)}.gq-name{font-size:20px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gq-name small{font-size:14px;font-weight:700;color:var(--muted)}.gq-status{margin-top:6px;font-size:17px;font-weight:900}.gq-status small{font-size:13px;color:var(--muted);font-weight:700}.gq-add-score{min-height:86px;border:1px solid var(--line);border-radius:12px;background:var(--bg-2);color:var(--text);font:900 18px/1.05 inherit;padding:8px}.gq-add-score span{display:block;font-size:21px;margin-bottom:2px}.gq-add-score small{font-size:12px;color:var(--muted)}.gq-bottom{position:absolute;left:0;right:0;bottom:0;display:grid;grid-template-columns:repeat(2,1fr);border-top:1px solid var(--line);background:var(--bg-2);min-height:68px}.gq-bottom button{border:0;background:transparent;color:var(--muted);font:800 10px/1.1 inherit;padding:8px 4px}.gq-bottom button b{display:block;font-size:20px;line-height:1.1;margin-bottom:4px}.gq-bottom .is-active{color:var(--text)}.gq-bottom [data-gq-gps]{color:#9ccf37}.gq-score-sheet{position:fixed;inset:0;z-index:140;background:rgba(0,0,0,.56);display:flex;align-items:flex-end}.gq-score-card{width:100%;background:var(--bg-2);border-radius:18px 18px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom));box-shadow:0 -16px 44px rgba(0,0,0,.35)}.gq-score-card h3{margin:0;text-align:center;font-size:20px}.gq-score-card p{margin:5px 0 14px;text-align:center;color:var(--muted)}.gq-stepper{display:grid;grid-template-columns:64px 1fr 64px;gap:12px;align-items:center}.gq-stepper button{height:58px;border:1px solid var(--line);border-radius:12px;background:var(--bg-3);color:var(--text);font-size:30px}.gq-stepper input{width:100%;height:58px;text-align:center;border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--text);font:900 28px/1 inherit}.gq-sheet-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.gq-sheet-actions button{min-height:48px;border-radius:10px}.gq-finish{padding:12px 16px}.gq-finish button{width:100%}.gq-gps-wait{position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:90;padding:8px 12px;border-radius:999px;background:var(--bg-3);border:1px solid var(--line);font-size:11px;font-weight:900}
@media(max-width:620px){.gq-members{grid-template-columns:1fr}.gq-guest-course{grid-template-columns:1fr}.gq-hole-head{grid-template-columns:38px 1fr 38px 86px}.gq-navbtn{width:38px;height:38px}.gq-yardage{width:82px;height:82px}.gq-yardage b{font-size:26px}.gq-player{grid-template-columns:62px minmax(0,1fr) 104px;padding:14px 12px;min-height:126px}.gq-avatar{width:54px;height:54px;font-size:21px}.gq-name{font-size:18px}.gq-add-score{min-height:78px;font-size:16px}}
.gq-detail-steppers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.gq-detail-step label{display:block;margin-bottom:5px;text-align:center;color:var(--muted);font-size:10px;font-weight:900}.gq-detail-step .gq-stepper{grid-template-columns:34px minmax(38px,1fr) 34px;gap:3px}.gq-detail-step .gq-stepper button,.gq-detail-step .gq-stepper input{height:48px}.gq-detail-step .gq-stepper input{font-size:21px}
.gq-history-stats{display:grid;gap:7px;padding:12px 16px}.gq-history-stat{display:grid;grid-template-columns:minmax(90px,1.4fr) repeat(3,1fr);gap:6px;padding:8px;border:1px solid var(--line);border-radius:10px;background:var(--bg-2)}.gq-history-stat>strong{align-self:center;overflow:hidden;text-overflow:ellipsis}.gq-history-stat span{text-align:center}.gq-history-stat b,.gq-history-stat small{display:block}.gq-history-stat small{color:var(--muted);font-size:8px;text-transform:uppercase}
`;document.head.appendChild(s);
}

async function data(){
  const me=Number(getMemberId()),[c,m,r,p]=await Promise.all([
    db().from("golf_courses").select("id,name,city,state,holes,par,yardage").order("name"),
    loadMembers(),
    db().from("golf_quick_rounds").select("id,course_id,created_by,played_on,holes,status,is_private,golf_courses(name)").order("played_on",{ascending:false}).order("id",{ascending:false}),
    db().from("golf_quick_players").select("round_id").eq("member_id",me)
  ]);
  if(c.error||r.error||p.error)throw c.error||r.error||p.error;
  const played=new Set((p.data||[]).map(row=>String(row.round_id)));
  return{courses:c.data||[],members:m||[],recent:(r.data||[]).filter(row=>Number(row.created_by)===me||played.has(String(row.id))).slice(0,12)};
}

async function mount(){
  if(!onGolf())return;
  const wrap=document.querySelector("#golf-wrap");
  if(!wrap||wrap.querySelector("#golf-quick"))return;
  style();
  const host=document.createElement("section");host.id="golf-quick";host.className="card gq";
  wrap.querySelector(".page-head")?.insertAdjacentElement("afterend",host);
  try{const d=await data();paintHome(host,d)}catch(e){host.innerHTML=`<div class="gq-home"><div class="muted tiny">Quick Round unavailable: ${esc(e.message||e)}</div></div>`}
}

function paintHome(host,d){
  delete host.dataset.gqHole;
  const me=String(getMemberId());
  host.innerHTML=`<div class="gq-home"><div class="gq-head"><div><h2>My Quick Rounds</h2><p class="muted tiny">Your active rounds and personal history.</p></div><button class="btn small" data-gq-new>Start round</button></div><div data-gq-body>${d.recent.length?`<div class="gq-recent">${d.recent.map(r=>`<button data-gq-open="${r.id}"><span><strong>${esc(r.golf_courses?.name||"Round")}</strong><br><small class="muted">${esc(r.played_on)} · ${r.holes} holes${r.is_private?" · Private":""}</small></span><span>${r.status==="final"?"Final":"Open"}</span></button>`).join("")}</div>`:`<p class="muted tiny">No quick-round history yet.</p>`}</div></div>`;
  host.querySelector("[data-gq-new]").onclick=()=>paintForm(host,d,me);
  host.querySelectorAll("[data-gq-open]").forEach(b=>b.onclick=()=>openRound(host,Number(b.dataset.gqOpen),d));
}

const courseChoices=(courses,roundLabel="Round course")=>`<option value="">${esc(roundLabel)}</option>${courses.map(course=>`<option value="${course.id}">${esc(course.name)}${course.city?` · ${esc(course.city)}, ${esc(course.state||"")}`:""}</option>`).join("")}`;

function paintForm(host,d,me){
  const body=host.querySelector("[data-gq-body]");
  body.innerHTML=`<div class="gq-form"><label>Round course<select data-gq-course><option value="">Select a saved course</option>${d.courses.map(c=>`<option value="${c.id}">${esc(c.name)}${c.city?` · ${esc(c.city)}, ${esc(c.state||"")}`:""}</option>`).join("")}</select></label><p class="muted tiny">Everyone uses the round course unless you choose a different course beside their name.</p><label>Holes<select data-gq-holes><option value="18">18 holes</option><option value="9">9 holes</option></select></label><label class="gq-private"><input type="checkbox" data-gq-private> Keep this round private</label><div><div class="tiny muted">Golfers · choose 1–4</div><div class="gq-members">${d.members.map(m=>`<div class="gq-person gq-person-course"><label><input type="checkbox" data-gq-member value="${m.id}" ${String(m.id)===me?"checked":""}><span>${esc(label(m))}</span></label><select data-gq-player-course aria-label="Course for ${esc(label(m))}">${courseChoices(d.courses)}</select></div>`).join("")}</div></div><div class="gq-guest-course"><label>Guest / buddy <input data-gq-guest placeholder="Optional name"></label><label>Guest course<select data-gq-guest-course>${courseChoices(d.courses)}</select></label></div><div class="gq-actions"><button class="btn primary" data-gq-start>Start scorecards</button><button class="btn" data-gq-cancel>Cancel</button></div></div>`;
  body.querySelector("[data-gq-cancel]").onclick=()=>paintHome(host,d);
  body.querySelector("[data-gq-start]").onclick=()=>start(host,d);
}

async function start(host,d){
  const body=host.querySelector("[data-gq-body]"),course=Number(body.querySelector("[data-gq-course]").value),holes=Number(body.querySelector("[data-gq-holes]").value),isPrivate=body.querySelector("[data-gq-private]").checked,selected=[...body.querySelectorAll("[data-gq-member]:checked")],guest=body.querySelector("[data-gq-guest]").value.trim();
  const count=selected.length+(guest?1:0);
  if(!course)return toast("Pick a course",true);
  if(count<1||count>4)return toast("Choose 1 to 4 golfers",true);
  try{
    const{data:r,error}=await db().from("golf_quick_rounds").insert({course_id:course,created_by:Number(getMemberId()),holes,is_private:isPrivate}).select().single();
    if(error)throw error;
    const players=[...selected.map((input,i)=>({round_id:r.id,member_id:Number(input.value),course_id:Number(input.closest(".gq-person-course")?.querySelector("[data-gq-player-course]")?.value)||null,sort_order:i})),...(guest?[{round_id:r.id,guest_name:guest,course_id:Number(body.querySelector("[data-gq-guest-course]")?.value)||null,sort_order:selected.length}]:[])];
    const p=await db().from("golf_quick_players").insert(players);if(p.error)throw p.error;
    toast("Quick Round started");await openRound(host,r.id,d);
  }catch(e){toast(e.message||"Could not start round",true)}
}

async function openRound(host,id,d){
  const ppRead=db().from("golf_quick_players").select("*").eq("round_id",id).order("sort_order");
  const [rr,pp]=await Promise.all([db().from("golf_quick_rounds").select("*,golf_courses(id,name,city,state,holes,par,yardage)").eq("id",id).single(),ppRead]);
  if(rr.error||pp.error)return toast((rr.error||pp.error).message,true);
  const playerIds=(pp.data||[]).map(x=>x.id);
  const courseIds=[...new Set([Number(rr.data.course_id),...(pp.data||[]).map(player=>Number(player.course_id))].filter(Boolean))];
  const [ss,holesRes]=await Promise.all([
    playerIds.length?db().from("golf_quick_scores").select("*").in("player_id",playerIds):Promise.resolve({data:[],error:null}),
    db().from("golf_course_holes").select("course_id,hole,par,handicap,yardage_men,yardage_women").in("course_id",courseIds).order("hole")
  ]);
  if(ss.error||holesRes.error)return toast((ss.error||holesRes.error).message,true);
  paintRound(host,rr.data,pp.data||[],ss.data||[],quickCourseHoleMap(holesRes.data||[]),d);
}

function parFor(parMap,h){return parMap.get(h)||parMap.get(h-9)||null}
function holeRow(rows,h){return rows.find(x=>Number(x.hole)===h)||rows.find(x=>Number(x.hole)===h-9)||null}
function roundScore(player,r,scoreMap,parMap){
  let st=0,pa=0,n=0;
  for(let h=1;h<=r.holes;h++){const v=scoreMap.get(`${player.id}:${h}`),par=parFor(parMap,h);if(v&&par){st+=v;pa+=par;n++}}
  const diff=st-pa;return{n,st,diff,label:n?(diff===0?"E":diff>0?`+${diff}`:`${diff}`):"E"};
}
function firstIncomplete(r,players,scoreMap){for(let h=1;h<=r.holes;h++)if(players.some(p=>!scoreMap.get(`${p.id}:${h}`)))return h;return r.holes}

function paintRound(host,r,players,scores,holesByCourse,d){
  const members=new Map(d.members.map(m=>[String(m.id),m])),courses=new Map(d.courses.map(course=>[String(course.id),course])),scoreMap=new Map(scores.map(s=>[`${s.player_id}:${s.hole}`,Number(s.strokes)]));
  let hole=Number(host.dataset.gqHole)||firstIncomplete(r,players,scoreMap);hole=Math.max(1,Math.min(r.holes,hole));host.dataset.gqHole=String(hole);
  const gpsPlayer=players.find(player=>String(player.member_id||"")===String(getMemberId()))||players[0],gpsCourseId=quickCourseId(r,gpsPlayer),gpsRows=quickHolesFor(r,gpsPlayer,holesByCourse),gpsParMap=new Map(gpsRows.map(row=>[Number(row.hole),Number(row.par)])),info=holeRow(gpsRows,hole)||{},par=parFor(gpsParMap,hole)||"—",yard=Number(info.yardage_men)||null,hcp=info.handicap??null;
  const gpsCourse=courses.get(String(gpsCourseId))||r.golf_courses||{},course=gpsCourse.name||"Quick Round",courseLoc=[gpsCourse.city,gpsCourse.state].filter(Boolean).join(", ");
  const elapsed=(()=>{const start=r.created_at?new Date(r.created_at).getTime():NaN;if(!Number.isFinite(start))return"";const mins=Math.max(0,Math.floor((Date.now()-start)/60000));return `${Math.floor(mins/60)}:${String(mins%60).padStart(2,"0")}`})();
  host.innerHTML=`<div class="gq-play dfl-team-card" data-gqm-entry data-active-hole="${hole}" data-quick-player-card data-quick-active="true">
    <div class="gq-round-meta golf-event-head"><div class="golf-meta"><span>${esc(course)}</span><span>${esc(courseLoc)}</span></div></div>
    <div class="gq-hole-head"><button class="gq-navbtn" data-gq-prev aria-label="Previous hole">‹</button><div class="gq-hole-title"><strong>⚑ ${ordinal(hole)}</strong><span>Par ${esc(par)}${yard?` · ${yard} yds`:""}${hcp!=null?` · HCP ${esc(hcp)}`:""}</span></div><button class="gq-navbtn" data-gq-next aria-label="Next hole">›</button><button class="gq-yardage" data-gq-gps-top type="button"><span><small>Center</small><b>${yard||"GPS"}</b><small>${yard?"YDS":"tap"}</small></span></button></div>
    <div class="gq-timer">Hole ${hole}${elapsed?` · Round ${elapsed}`:""}</div>
    <div class="gq-players">${players.map(p=>{const m=p.member_id?members.get(String(p.member_id)):null,name=p.member_id?label(m):p.guest_name||"Golfer",playerRows=quickHolesFor(r,p,holesByCourse),playerParMap=new Map(playerRows.map(row=>[Number(row.hole),Number(row.par)])),x=roundScore(p,r,scoreMap,playerParMap),current=scoreMap.get(`${p.id}:${hole}`)||0,h=handicap(m),playerCourse=courses.get(String(quickCourseId(r,p)))?.name||course;return`<article class="gq-player" data-player="${p.id}" data-player-course="${quickCourseId(r,p)}"><div class="gq-avatar">${esc(initials(name))}</div><div><div class="gq-name">${esc(name)}${h!=null?` <small>[${esc(h)}]</small>`:""}</div><div class="gq-player-course-name">${esc(playerCourse)}</div><div class="gq-status">${esc(x.label)} <small>(${current||0}) · ${x.n?`${x.st} strokes`:`Hole ${hole}`}</small></div></div><button class="gq-add-score" data-gq-add data-player="${p.id}" type="button"><span>•••</span>${current?`Edit Score<small>${current} on hole ${hole}</small>`:`Add Score<small>Hole ${hole}</small>`}</button></article>`}).join("")}</div>
    <div class="gq-finish"><button class="btn primary" data-gq-finish ${r.status==="final"?"disabled":""}>${r.status==="final"?"Round finished":"Finish round"}</button></div>
    <nav class="gq-bottom" aria-label="Quick round tools"><button class="is-active" type="button"><b>▦</b>Scorecard</button><button type="button" data-gq-gps><b>◎</b>GPS</button></nav>
  </div>`;
  if(r.status==="final"){
    const summary=document.createElement("section");summary.className="gq-history-stats";summary.setAttribute("aria-label","Round putting and drop statistics");summary.innerHTML=players.map(player=>{const member=player.member_id?members.get(String(player.member_id)):null,name=player.member_id?label(member):player.guest_name||"Golfer",stats=roundDetailStats(scores.filter(row=>Number(row.player_id)===Number(player.id)));return `<div class="gq-history-stat"><strong>${esc(name)}</strong><span><b>${stats.tracked?stats.putts:"—"}</b><small>Putts</small></span><span><b>${stats.tracked?averagePuttsLabel(stats.averagePutts):"—"}</b><small>Avg / hole</small></span><span><b>${stats.tracked?stats.drops:"—"}</b><small>Drops</small></span></div>`}).join("");host.querySelector(".gq-finish")?.before(summary);
  }
  const play=host.querySelector(".gq-play");play.dataset.gpsCourseId=String(gpsCourseId||"");play.dataset.gpsCourseName=course;play.dataset.gpsCourseLabel=[course,courseLoc].filter(Boolean).join(" · ");
  const move=delta=>{host.dataset.gqHole=String(Math.max(1,Math.min(r.holes,hole+delta)));paintRound(host,r,players,scores,holesByCourse,d);window.dispatchEvent(new CustomEvent("dfl:quick-player-change"))};
  host.querySelector("[data-gq-prev]").onclick=()=>move(-1);host.querySelector("[data-gq-next]").onclick=()=>move(1);
  host.querySelectorAll("[data-gq-add]").forEach(btn=>btn.onclick=()=>{const player=players.find(item=>Number(item.id)===Number(btn.dataset.player)),rows=quickHolesFor(r,player,holesByCourse),playerParMap=new Map(rows.map(row=>[Number(row.hole),Number(row.par)]));showScoreSheet(host,r,players,scores,d,Number(btn.dataset.player),hole,scoreMap.get(`${btn.dataset.player}:${hole}`)||parFor(playerParMap,hole)||4)});
  const openGps=()=>{window.dispatchEvent(new CustomEvent("dfl:quick-player-change"));setTimeout(()=>{const bubble=document.querySelector(".dfl-gps-bubble");if(bubble)bubble.click();else{const wait=document.createElement("div");wait.className="gq-gps-wait";wait.textContent="GPS is loading for this course…";document.body.appendChild(wait);setTimeout(()=>wait.remove(),1800)}},120)};
  host.querySelector("[data-gq-gps]").onclick=openGps;host.querySelector("[data-gq-gps-top]").onclick=openGps;
  host.querySelector("[data-gq-finish]").onclick=async()=>{const q=await db().from("golf_quick_rounds").update({status:"final"}).eq("id",r.id);if(q.error)return toast(q.error.message,true);toast("Round saved to history");await openRound(host,r.id,d)};
  play.dispatchEvent(new CustomEvent("input",{bubbles:true}));window.dispatchEvent(new CustomEvent("dfl:quick-player-change"));
}

function showScoreSheet(host,r,players,scores,d,playerId,hole,startValue){
  document.querySelector(".gq-score-sheet")?.remove();
  const player=players.find(p=>Number(p.id)===Number(playerId)),members=new Map(d.members.map(m=>[String(m.id),m])),name=player?.member_id?label(members.get(String(player.member_id))):player?.guest_name||"Golfer";
  const row=scores.find(score=>Number(score.player_id)===playerId&&Number(score.hole)===hole)||{},values={strokes:Math.max(1,Math.min(15,Number(startValue)||4)),putts:Number(row.putts)||0,drops:Number(row.drop_shots)||0};
  const sheet=document.createElement("div");sheet.className="gq-score-sheet";sheet.innerHTML=`<div class="gq-score-card"><h3>${esc(name)} · Hole ${hole}</h3><p>Add shots, putts, and penalty drops.</p><div class="gq-detail-steppers">${[["strokes","Shots",15],["putts","Putts",15],["drops","Drops",9]].map(([key,title,max])=>`<div class="gq-detail-step"><label>${title}</label><div class="gq-stepper"><button type="button" data-detail-step="${key}:-1">−</button><input data-detail-value="${key}" type="number" inputmode="numeric" min="${key==="strokes"?1:0}" max="${max}" value="${values[key]}"><button type="button" data-detail-step="${key}:1">+</button></div></div>`).join("")}</div><div class="gq-sheet-actions"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-save>Save score</button></div></div>`;document.body.appendChild(sheet);
  sheet.querySelectorAll("[data-detail-step]").forEach(button=>button.onclick=()=>{const[key,step]=button.dataset.detailStep.split(":"),input=sheet.querySelector(`[data-detail-value="${key}"]`),min=key==="strokes"?1:0,max=key==="drops"?9:15;input.value=String(Math.max(min,Math.min(max,(Number(input.value)||0)+Number(step))))});
  sheet.querySelector("[data-cancel]").onclick=()=>sheet.remove();sheet.onclick=e=>{if(e.target===sheet)sheet.remove()};
  sheet.querySelector("[data-save]").onclick=async()=>{const strokes=Number(sheet.querySelector('[data-detail-value="strokes"]').value),putts=Number(sheet.querySelector('[data-detail-value="putts"]').value)||0,drop_shots=Number(sheet.querySelector('[data-detail-value="drops"]').value)||0;if(strokes<1||strokes>15)return toast("Score must be 1–15",true);const q=await db().from("golf_quick_scores").upsert({player_id:playerId,hole,strokes,putts,drop_shots},{onConflict:"player_id,hole"});if(q.error)return toast(q.error.message||"Score did not save",true);sheet.remove();await openRound(host,r.id,d)};
}

let busy=false;const observer=new MutationObserver(()=>{if(!busy){busy=true;queueMicrotask(()=>{busy=false;mount()})}});function boot(){observer.observe(document.body,{childList:true,subtree:true});mount()}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();window.addEventListener("hashchange",mount);

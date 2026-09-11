// DFL Rule Proposals - submit ideas, vote, and record commissioner rulings.
import { db, isAdmin } from "../supabase.js";
import { currentMember } from "../members.js";
import { esc, toast, errorBox } from "../ui.js";

const statusLabel={open:"Open",passed:"Passed",rejected:"Rejected",adopted:"Adopted",withdrawn:"Withdrawn"};
const statusTone={open:"green",passed:"warn",rejected:"grey",adopted:"green",withdrawn:"grey"};

export async function render(view){
  const me=currentMember(),admin=isAdmin();
  const [pr,vr,mr]=await Promise.all([
    db().from("rule_proposals").select("*").order("created_at",{ascending:false}),
    db().from("rule_proposal_votes").select("proposal_id,member_id,vote"),
    db().from("members").select("id,display_name,team_name")
  ]);
  const err=pr.error||vr.error||mr.error;
  if(err){
    const msg=err.message||String(err);
    view.innerHTML=`<h1>Proposals</h1>${/rule_proposals|schema cache|does not exist/i.test(msg)?`<div class="card note"><div class="card-body">Run <strong>proposals_schema.sql</strong> in Supabase.</div></div>`:errorBox(err)}`;
    return;
  }
  const proposals=pr.data||[],votes=vr.data||[],members=new Map((mr.data||[]).map(m=>[String(m.id),m]));
  const open=proposals.filter(p=>p.status==="open"),closed=proposals.filter(p=>p.status!=="open");
  view.innerHTML=`<div id="proposal-wrap"><header class="page-head"><h1>Proposals</h1></header>
    ${me?submitCard():`<div class="card note"><div class="card-body">Pick your name to submit or vote.</div></div>`}
    ${open.length?`<section class="block"><h2 class="section-title">Open<span class="count">${open.length}</span></h2>${open.map(p=>proposalCard(p,votes,members,me,admin)).join("")}</section>`:`<div class="card"><div class="card-body muted">No open proposals.</div></div>`}
    ${closed.length?`<section class="block" data-collapse="proposal-archive" data-collapse-default="folded" data-collapse-title="Decided proposals" data-collapse-badge="${closed.length}">${closed.map(p=>proposalCard(p,votes,members,me,admin)).join("")}</section>`:""}
  </div>`;
  wire(view,me,admin);
}

function submitCard(){return `<details class="card"><summary class="card-title">Propose a rule</summary><form class="card-body" id="proposal-form"><label>Title<input id="proposal-title" maxlength="100" required placeholder="Keeper deadline change"></label><label>Rule change<textarea id="proposal-body" maxlength="1200" rows="4" required placeholder="What should change?"></textarea></label><div class="row-end"><button class="btn" type="submit">Submit proposal</button></div></form></details>`}

function proposalCard(p,allVotes,members,me,admin){
  const votes=allVotes.filter(v=>String(v.proposal_id)===String(p.id)),yes=votes.filter(v=>v.vote==="yes"),no=votes.filter(v=>v.vote==="no"),mine=me?votes.find(v=>String(v.member_id)===String(me.id)):null,total=votes.length||1,yesPct=Math.round(yes.length/total*100),author=members.get(String(p.member_id));
  return `<article class="card proposal-card"><div class="card-title-row"><div><h3 class="card-heading">${esc(p.title)}</h3><div class="muted tiny">${esc(author?.display_name||"DFL member")}</div></div><span class="pill ${statusTone[p.status]||"grey"}">${statusLabel[p.status]||esc(p.status)}</span></div><div class="card-body">${esc(p.body)}</div><div class="results"><div class="result ${mine?.vote==="yes"?"mine":""}">${p.status==="open"?`<button class="result-pick" data-proposal-vote="yes" data-proposal="${p.id}" ${me?"":"disabled"}><div class="result-top"><span>Yes</span><span class="result-n">${yes.length} · ${yesPct}%</span></div></button>`:`<div class="result-top"><span>Yes</span><span class="result-n">${yes.length} · ${yesPct}%</span></div>`}<div class="bar"><span style="width:${yesPct}%"></span></div>${voterNames(yes,members)}</div><div class="result ${mine?.vote==="no"?"mine":""}">${p.status==="open"?`<button class="result-pick" data-proposal-vote="no" data-proposal="${p.id}" ${me?"":"disabled"}><div class="result-top"><span>No</span><span class="result-n">${no.length} · ${100-yesPct}%</span></div></button>`:`<div class="result-top"><span>No</span><span class="result-n">${no.length} · ${100-yesPct}%</span></div>`}<div class="bar"><span style="width:${100-yesPct}%"></span></div>${voterNames(no,members)}</div></div>${mine&&p.status==="open"?`<div class="row-end"><button class="linkbtn" data-clear-proposal="${p.id}">Remove my vote</button></div>`:""}${admin?adminControls(p):""}</article>`;
}

function voterNames(list,members){return list.length?`<div class="voters">${list.map(v=>`<span class="voter">${esc(members.get(String(v.member_id))?.display_name||"Someone")}</span>`).join("")}</div>`:""}
function adminControls(p){return `<div class="poll-admin"><span class="admin-tag">Commissioner</span>${["open","passed","rejected","adopted","withdrawn"].filter(s=>s!==p.status).map(s=>`<button class="btn ghost small" data-proposal-status="${s}" data-proposal="${p.id}">${statusLabel[s]}</button>`).join("")}<button class="btn ghost small" data-proposal-delete="${p.id}">Delete</button></div>`}

function wire(view,me,admin){
  view.querySelector("#proposal-form")?.addEventListener("submit",async e=>{e.preventDefault();const btn=e.target.querySelector('button[type="submit"]');btn.disabled=true;const{error}=await db().rpc("proposal_submit",{p_title:view.querySelector("#proposal-title").value.trim(),p_body:view.querySelector("#proposal-body").value.trim()});if(error){toast(error.message,true);btn.disabled=false;return}toast("Proposal submitted");render(view)});
  view.querySelector("#proposal-wrap")?.addEventListener("click",async e=>{
    const vote=e.target.closest("[data-proposal-vote]"),clear=e.target.closest("[data-clear-proposal]"),status=e.target.closest("[data-proposal-status]"),del=e.target.closest("[data-proposal-delete]");
    if(vote){if(!me)return toast("Pick your name first",true);vote.disabled=true;const{error}=await db().rpc("proposal_vote",{p_proposal_id:Number(vote.dataset.proposal),p_vote:vote.dataset.proposalVote});if(error)return toast(error.message,true);toast("Vote counted");return render(view)}
    if(clear){const{error}=await db().rpc("proposal_clear_vote",{p_proposal_id:Number(clear.dataset.clearProposal)});if(error)return toast(error.message,true);toast("Vote removed");return render(view)}
    if(status&&admin){const{error}=await db().rpc("proposal_set_status",{p_proposal_id:Number(status.dataset.proposal),p_status:status.dataset.proposalStatus});if(error)return toast(error.message,true);toast(`Proposal ${status.dataset.proposalStatus}`);return render(view)}
    if(del&&admin){if(!confirm("Delete this proposal and every vote on it?"))return;const{error}=await db().rpc("proposal_delete",{p_proposal_id:Number(del.dataset.proposalDelete)});if(error)return toast(error.message,true);toast("Proposal deleted");return render(view)}
  });
}

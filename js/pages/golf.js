// DFL Golf - mobile-first event/team view with live leaderboard.
import { db, insertRow, updateRow } from "../supabase.js";
import { esc, empty, errorBox, toast, fmtDate, fmtWhen, loading } from "../ui.js";
import { loadMembers, refreshMember } from "../members.js";
import { passFor, clearGolfPass, eventHasCode } from "../golf-guest.js";
import { mountJoin } from "../golf-join.js";
import { addControl, editControls, wireInline, canEdit, visible, hiddenClass } from "../inline.js";
import { pendingFor, dropPending } from "../golf-offline.js";
import { memberNames, playerName, isGuest, realName } from "../golf-people.js";
import { tournamentHoles } from "../golf-battle.js";
import { newTeamColor, teamInk } from "../brand-ink.js";
import { icon } from "../icons.js";
const DEFAULT_RATING=75;
/* Set once per render of an event, and read by every card that prints a
   player's name. A participant is either a league member or a guest with a
   name typed for the day, so no card can read a name off member_id. */
let nameMap=new Map();
const TEAM_NAMES=["Team Chaos","Team Bogey","Team Shank","Team Mulligan","Team Sandbagger","Team Whiff","Team Duff","Team Yips"];
/*
  TEAM COLOURS COME FROM THE HOUSE IDENTITY NOW, not from six hues invented
  here. The old list - a spring green, a sky blue, an orange, a coral, a violet
  and a teal - was Golf's own brand: it reached the teams card, the team dots,
  the roster editor, the draft board and every shared image, so Golf looked
  like a different product. See js/brand-ink.js.

  teamInk() translates a STORED colour on the way to the screen, so an event
  generated last summer stops looking like a different app without anything
  rewriting golf_teams.color. newTeamColor() is what a newly generated team
  gets written with. Nothing about teams, scoring or persistence changes.
*/
export async function render(view,{quiet=false}={}){stopLeaderPoll();const qs=new URLSearchParams(location.hash.split("?")[1]||"");const id=qs.get("id");if(id)return renderOuting(view,id,qs.get("team"),qs.get("match"),quiet);return renderList(view);}
async function renderList(view){view.innerHTML=loading();const [res,partRes,teamRes,roundRes]=await Promise.all([db().from("golf_outings").select("*").order("event_date",{ascending:false}),db().from("golf_participants").select("outing_id"),db().from("golf_teams").select("outing_id,name,captain_member_id"),db().from("golf_rounds").select("outing_id,holes").then(r=>r,()=>({data:[],error:null}))]);if(res.error){view.innerHTML=`<h1>DFL Golf</h1>${errorBox(res.error)}<div class="card"><div class="card-body muted">If the golf tables are missing, run <strong>golf_schema.sql</strong> in Supabase.</div></div>`;return;}/* Real counts for the poster line. One extra read each, both tiny, and a
     failure just means the line says less rather than the page breaking. */
  const playerCount=new Map(),teamCount=new Map();
  for(const r of partRes.data||[])playerCount.set(String(r.outing_id),(playerCount.get(String(r.outing_id))||0)+1);
  for(const r of teamRes.data||[])teamCount.set(String(r.outing_id),(teamCount.get(String(r.outing_id))||0)+1);
  /* The rounds each event has, so a card can say how long the DAY is rather
     than how long the course is - same helper, same answer, as the event page
     itself. An event with no rounds keeps its own hole count. */
  const roundsBy=new Map();
  for(const r of roundRes?.error?[]:(roundRes?.data||[])){const k=String(r.outing_id);if(!roundsBy.has(k))roundsBy.set(k,[]);roundsBy.get(k).push(r);}
  const counts=o=>({players:playerCount.get(String(o.id))||0,teams:teamCount.get(String(o.id))||0,holes:tournamentHoles(roundsBy.get(String(o.id)),o.holes||18)});
  const outings=visible("golf_outings",res.data||[]),live=outings.filter(o=>o.status!=="final"),past=outings.filter(o=>o.status==="final");view.innerHTML=`<div id="golf-wrap"><header class="page-head"><h1>DFL Golf</h1>${addControl("golf_outings","New event")}</header>${outings.length?"":empty(canEdit()?"No golf events yet. Create one above.":"No golf events yet.")}${live.length?`<h2 class="section-title">Upcoming<span class="count">${live.length}</span></h2>${live.map(o=>outingCard(o,counts(o))).join("")}`:""}${past.length?`<h2 class="section-title">Golf history<span class="count">${past.length}</span></h2>${past.map(o=>outingCard(o,counts(o))).join("")}`:""}<div class="golf-bag-page"></div></div>`;wireInline(view.querySelector("#golf-wrap"),()=>render(view));}
/*
  THE TOURNAMENT POSTER.

  This was a heading, a pill and a run-on meta line - accurate and
  completely forgettable. A poster answers four questions in the order a
  person asks them: what is this, when, what state is it in, and how big.

  Every figure is real. The player and team counts come from the rows the
  list already had to read; nothing is estimated, and a count of zero
  prints nothing rather than "0 players", because an event still being
  built has not got them yet.
*/
function outingCard(o,count={players:0,teams:0,holes:0}){
  const state=o.status==="final"?["Final","grey"]:o.status==="active"?["Live now","green"]:["Upcoming","warn"];
  const type=o.event_type==="quick"?"Quick Round":o.event_type==="tournament_beta"?"Tournament Beta":"Tournament";
  const when=o.event_date?fmtWhen(o.event_date,o.event_time):"";
  const facts=[
    count.players?`${count.players} player${count.players===1?"":"s"}`:"",
    count.teams?`${count.teams} team${count.teams===1?"":"s"}`:"",
    `${count.holes||o.holes||18} holes`,
  ].filter(Boolean);
  return `<article class="card golf-card dfl-mark ${hiddenClass("golf_outings",o)}">
    <a class="golf-link gposter" href="#/golf?id=${o.id}">
      <span class="gposter-kicker" data-event-type="${esc(o.event_type||"tournament")}">${type}${o.course?` · ${esc(o.course)}`:""}</span>
      <h3 class="gposter-name">${esc(o.name)}</h3>
      ${when?`<span class="gposter-when">${esc(when)}</span>`:""}
      <span class="gposter-status pill ${state[1]}">${state[0]}</span>
      <span class="gposter-facts">${facts.map(f=>`<span>${esc(f)}</span>`).join("")}</span>
    </a>${editControls("golf_outings",o,{compact:true})}</article>`;
}
/*
  A 9-hole course is stored as 9 pars and played twice, so hole 12 takes hole
  3's par - the same wrap the scorecard has always applied.

  Without it the pars map had no key for 10-18, every back-nine stroke failed
  the isFinite check below, and the board quietly threw half the round away: a
  team that had finished read "Thru 9" at their front-nine score.
*/
function parFor(pars,hole){const h=Number(hole);if(pars.has(h))return pars.get(h);if(pars.size&&pars.size<=9&&h>9)return pars.get(h-9);return undefined;}
function scoreToPar(scores,pars){let total=0,par=0,holes=0;for(const s of scores){const h=Number(s.hole),st=Number(s.strokes),p=Number(parFor(pars,h));if(Number.isFinite(st)&&Number.isFinite(p)){total+=st;par+=p;holes++;}}return{diff:total-par,holes,total};}
/* A dash, not "Not started" - the line under the team name already says that,
   and the score column is 44px of tabular numerals. */
function scoreLabel(diff,holes){if(!holes)return"—";if(diff===0)return"E";return diff>0?`+${diff}`:`${diff}`;}
/* Strokes this device has entered but not yet managed to send count on the
   board too - the alternative is your own team reading a hole behind while
   you stand there looking at the number you just typed. */
function withPending(outingId,teamId,rows){const pend=pendingFor(outingId,teamId);if(!pend.size)return rows;
const map=new Map(rows.map(r=>[Number(r.hole),r]));
for(const [hole,strokes] of pend){if(strokes==null)map.delete(hole);else map.set(hole,{hole,strokes});}
return [...map.values()];}

/*
  The rows on their own, so the poll can replace them without rebuilding the
  card around them.

  Sorted by to-par, which ranks a team at −1 thru 6 above one at +2 thru 18 -
  that is how a live golf leaderboard works, so THRU is printed next to every
  score. A team yet to start sits at the bottom rather than at even par.
*/
/* 18, NOT outing.holes. A 9-hole course is stored as holes=9 and played twice,
   and the scorecard always offers holes 1-18 - so reading outing.holes here
   would call a team finished when they were standing on the 10th tee. */
const ROUND_HOLES=18;
/*
  ONE ROW, IN THE ORDER SOMEBODY STANDING ON A TEE ASKS IT.

  Position, then who, then THE NUMBER, then how far through. The
  score-to-par is the biggest thing on the row on purpose - it is the one
  fact the board exists to deliver, and it used to be a 19px figure sat
  between a team name in the same weight and a chevron in the same colour.
  Strokes drop to the second line: useful, never the headline.

  Nothing about the ranking changed. Same sort, same to-par, same thru.
*/
function leaderRows(teams,scores,holes,outing){const pars=new Map((holes||[]).map(h=>[Number(h.hole),Number(h.par)]));
const cards=teams.map(t=>{const ss=withPending(outing.id,t.id,scores.filter(s=>String(s.team_id)===String(t.id)));const x=scoreToPar(ss,pars);return{team:t,...x,label:scoreLabel(x.diff,x.holes)};}).sort((a,b)=>{if(!a.holes&&!b.holes)return a.team.sort_order-b.team.sort_order;if(!a.holes)return 1;if(!b.holes)return-1;return a.diff-b.diff||b.holes-a.holes||a.team.sort_order-b.team.sort_order;});
if(!cards.length)return empty("No teams yet.");
/* Under par, level, over par - the tint is the same vocabulary the
   scorecard uses, so a red number means the same thing on both screens. */
const tone=x=>!x.holes?"none":x.diff<0?"under":x.diff>0?"over":"even";
const progress=x=>!x.holes?"Not started":x.holes>=ROUND_HOLES?"Finished":`Thru ${x.holes}`;
const strokes=x=>!x.holes?"":`${x.total} stroke${x.total===1?"":"s"}`;
/* First place, and only when somebody has actually hit a shot - leading a
   board on which nothing has happened is not leading. */
return cards.map((x,i)=>{const lead=i===0&&!!x.holes;
return `<a class="gl-row${lead?" is-leader":""}" href="#/golf?id=${x.team.outing_id}&team=${x.team.id}" aria-label="${esc(x.team.name||"Team")}, ${esc(x.label)}, ${esc(progress(x))} — open this team's scorecard">
  <span class="gl-pos">${lead?`<svg class="ico-sm" aria-hidden="true"><use href="#i-trophy"></use></svg>`:""}<b>${i+1}</b></span>
  <span class="gl-team"><strong>${esc(x.team.name||"Team")}</strong>${lead?`<small class="gl-flag">Leader</small>`:""}</span>
  <span class="gl-score" data-tone="${tone(x)}">${esc(x.label)}</span>
  <span class="gl-thru"><b>${esc(progress(x))}</b><small>${esc(strokes(x))}</small></span>
</a>`;}).join("");}

/*
  THE BOARD ITSELF.

  Hero content during play: it sits second on the event page, under the
  tournament points, and it carries the one instruction that used to be
  hidden inside the Teams section - tapping a team is how you enter its
  strokes. That is the scoring entry point now, and it belongs here, beside
  the live numbers, rather than on a roster card.
*/
function leaderboard(teams,scores,holes,outing){return `<section class="card golf-leaderboard ge-live" data-collapse="golf-leaderboard" data-collapse-title="Live leaderboard"><div class="gl-head"><div><span class="gl-kicker">Live leaderboard</span><p class="muted tiny">Tap a team to enter its strokes.</p></div><span class="badge live">Live</span></div><div class="golf-leader-list" data-leader-list>${leaderRows(teams,scores,holes,outing)}</div></section>`;}

const LEADER_POLL_MS=15000;
let leaderTimer=0,onLeaderVisible=null;
/*
  Called by the router on the way out. The leaderboard poll is a 15s interval
  plus a visibilitychange listener on the document, and both outlived
  navigation: the tick did stop ITSELF the first time it noticed its list had
  left the DOM, but until then the interval and the listener were still
  registered on somebody else's page. render() already calls stopLeaderPoll()
  for the rebuild case; this is the other direction.
*/
export function leave(){stopLeaderPoll();}
function stopLeaderPoll(){clearInterval(leaderTimer);leaderTimer=0;
if(onLeaderVisible){document.removeEventListener("visibilitychange",onLeaderVisible);onLeaderVisible=null;}}

/*
  "Updates as teams enter strokes" was only true if you reloaded the page:
  nothing re-read the scores. Now it polls, the same way the draft board
  does, and stops as soon as the list it paints leaves the DOM.

  ONLY the list is replaced. A full page re-render every 15 seconds would
  close the admin cards mid-edit and reset a select somebody was using.

  A failed read is ignored on purpose - out of signal the right thing to show
  is the last board we had, not an error where the standings were.
*/
function startLeaderPoll(view,outing){stopLeaderPoll();
if(!view.querySelector("[data-leader-list]"))return;

const tick=async()=>{
  const node=view.querySelector("[data-leader-list]");
  if(!node||!document.body.contains(node))return stopLeaderPoll();
  /* A backgrounded tab is a phone in a pocket. Don't spend its battery or
     its data on standings nobody is looking at. */
  if(document.hidden)return;
  const [teamsRes,scoresRes,holesRes]=await Promise.all([
    db().from("golf_teams").select("*").eq("outing_id",outing.id).order("sort_order"),
    db().from("golf_scores").select("*").eq("outing_id",outing.id),
    db().from("golf_holes").select("hole,par").eq("outing_id",outing.id).order("hole")]);
  if(teamsRes.error||scoresRes.error||holesRes.error)return;
  const fresh=view.querySelector("[data-leader-list]");
  if(fresh)fresh.innerHTML=leaderRows(teamsRes.data||[],scoresRes.data||[],holesRes.data||[],outing);
};

leaderTimer=setInterval(tick,LEADER_POLL_MS);
/* Coming back to the app is the moment you most want the truth, and it is
   also the moment the numbers are most likely to be stale - the pocket
   skipped every tick. Refresh now rather than up to 15 seconds from now. */
onLeaderVisible=()=>{if(!document.hidden)tick();};
document.addEventListener("visibilitychange",onLeaderVisible);}

/* Saves should feel like edits to the card in front of you, not navigation.
   Keep the old page painted while fresh rows load, then put the same control
   back at the same screen position. The queue also prevents two quick edits
   from racing two whole-page paints against one another. */
function stableRefresh(view,rerender){let queue=Promise.resolve();return(target=document.activeElement)=>{
  const element=target instanceof Element?target:document.activeElement;
  const card=element?.closest?.("[data-collapse]");
  const attrs=["data-move","data-lock","data-team-name","data-save-name","data-drop-player","data-rename-player","data-team-mode"];
  const attr=attrs.find(name=>element?.hasAttribute?.(name));
  const value=attr?element.getAttribute(attr):"";
  const selector=element?.id?`#${element.id}`:attr?`[${attr}="${String(value).replaceAll('"','\\"')}"]`:"";
  const saved={selector,collapse:card?.dataset.collapse||"",top:element?.getBoundingClientRect?.().top??card?.getBoundingClientRect?.().top??0,cardTop:card?.getBoundingClientRect?.().top??0,scrollY:window.scrollY};
  queue=queue.catch(()=>{}).then(async()=>{
    await rerender();
    const restore=()=>{const exact=saved.selector&&view.querySelector(saved.selector);const anchor=exact||(saved.collapse&&view.querySelector(`[data-collapse="${saved.collapse}"]`));
      if(anchor){window.scrollBy(0,anchor.getBoundingClientRect().top-(exact?saved.top:saved.cardTop));if(exact&&anchor.matches("button,select,input"))anchor.focus({preventScroll:true});}
      else window.scrollTo(0,saved.scrollY);};
    restore();
    requestAnimationFrame(()=>requestAnimationFrame(restore));
    setTimeout(restore,120);
  });
  return queue;
};}
/*
  HOW MANY HOLES THE DAY IS.

  One extra read of one tiny table, and it is here rather than handed over
  from golf-matches.js on purpose: this header sits above the team scorecard
  and the 2v2 card as well as the event page, and neither of those boots the
  tournament module - so a figure published from there would have been right
  on one screen out of three.

  The read can fail on an event whose matches migration has not been run.
  That is not an error worth a page for: rounds:[] falls the total back to
  the outing's own hole count, exactly as it did before any of this.

  The arithmetic is NOT here. tournamentHoles() in golf-battle.js owns it,
  the same file that owns every other fact derived from the rounds.
*/
async function renderOuting(view,id,teamId,matchId,quiet=false){
if(!quiet)view.innerHTML=loading();
const outRes=await db().from("golf_outings").select("*").eq("id",id).maybeSingle();
if(outRes.error||!outRes.data){view.innerHTML=`<h1>DFL Golf</h1>${errorBox(outRes.error||new Error("Golf event not found"))}`;return;}
const outing=outRes.data;
const classic=new URLSearchParams((location.hash.split("?")[1]||"")).get("classic")==="1";
if(outing.event_type==="tournament_beta"&&!classic){view.innerHTML=`<div id="golf-outing" class="golf-event"><div class="tb-route-loading" aria-label="Loading Tournament Beta"></div></div>`;window.dispatchEvent(new CustomEvent("dfl:tournament-beta-route"));return;}
if(outing.event_type==="quick"){view.innerHTML=`<div id="golf-outing" class="golf-event"><div class="gqm-route-loading" role="status"><span>Quick Round</span><strong>Opening scorecard…</strong></div></div>`;window.dispatchEvent(new CustomEvent("dfl:quick-round-route"));return;}
const [partsRes,teamsRes,ranksRes,scoresRes,holesRes,roundsRes,matchCountRes,members]=await Promise.all([db().from("golf_participants").select("*").eq("outing_id",id).order("sort_order"),db().from("golf_teams").select("*").eq("outing_id",id).order("sort_order"),db().from("golf_rankings").select("member_id,rating"),db().from("golf_scores").select("*").eq("outing_id",id),db().from("golf_holes").select("hole,par").eq("outing_id",id).order("hole"),db().from("golf_rounds").select("id,holes").eq("outing_id",id).then(r=>r,()=>({data:[],error:null})),db().from("golf_matches").select("id",{count:"exact",head:true}).eq("outing_id",id).then(r=>r,()=>({count:0,error:null})),loadMembers().catch(()=>[])]);
const supportError=partsRes.error||teamsRes.error||scoresRes.error||holesRes.error;
if(supportError){view.innerHTML=`<h1>DFL Golf</h1>${errorBox(supportError)}<div class="card"><div class="card-body muted">The event loaded, but a golf supporting table could not be read. Check the golf schema and reload.</div></div>`;return;}
const parts=partsRes.data||[],teams=teamsRes.data||[],membersList=members||[],byId=new Map(membersList.map(m=>[String(m.id),m])),rating=new Map((ranksRes.data||[]).map(r=>[String(r.member_id),Number(r.rating)])),rate=id=>rating.get(String(id))??DEFAULT_RATING,selected=teams.find(t=>String(t.id)===String(teamId));nameMap=memberNames(membersList);
/* The tournament's length, not the course's. A day of three nines is 27
   holes; golf_outings.holes says 9, because that is the nine they play. */
const dayHoles=tournamentHoles(roundsRes?.error?[]:(roundsRes?.data||[]),outing.holes||18);
/*
  WHICH LIVE BOARD THIS OUTING GETS, decided once, here.

  A day with rounds AND matches is scored per side in golf_match_scores, and
  the board that can read it is golf-live.js: team or singles, cycled by
  round. This page just leaves the hole and that module fills it.

  A day with neither is scored on the team card in golf_scores, which is a
  different table and a different question. That board stays exactly as it
  was - including the tap-a-team-to-enter-strokes link, which is the only
  way to score an outing played that way, so it cannot simply be dropped.

  The two never both appear. Two live boards showing different numbers for
  the same day is worse than either one alone.
*/
const hasTournament=!!(roundsRes?.data||[]).length&&Number(matchCountRes?.count||0)>0;
if(teamId&&!selected){location.hash=`#/golf?id=${id}`;return;}/*
  Up ONE level, never all the way out.

  This header sits above the team scorecard and the 2v2 card as well as the
  event itself, and it used to say "← Golf" and go to the events list from all
  three. So the most obvious button on a scorecard threw you out of the event
  entirely - and worse, the card below it had its own back link going somewhere
  else, so two arrows a thumb apart disagreed about what "back" meant.

  On a sub-screen this goes to the event; only the event page itself goes out
  to the list.
*/
const deep=!!(selected||matchId),backHref=deep?`#/golf?id=${id}`:"#/golf",backText=deep?"← Back":"← Golf";
const title=`<header class="page-head golf-event-head"><a class="backlink" href="${backHref}">${backText}</a><div><h1>${esc(outing.name)}</h1><div class="golf-meta">${outing.course?`<span>${esc(outing.course)}</span>`:""}${outing.event_date?`<span>· ${esc(fmtWhen(outing.event_date,outing.event_time))}</span>`:""}<span>· ${dayHoles} holes</span></div></div></header>`;if(selected){view.innerHTML=`${title}<div id="golf-outing"><div class="golf-scorecard-page"></div></div>`;return;}
/* One 2v2, filled in by golf-match.js. Same arrangement as the team card:
   this page leaves a hole and does not need to know what goes in it. */
if(matchId){view.innerHTML=`${title}<div id="golf-outing"><div class="golf-match-page"></div></div>`;return;}
/*
  THE EVENT PAGE, IN PRIORITY ORDER.

  The DOM order below is the ACTIVE-EVENT order - tournament points, live
  leaderboard, matches, teams, then the setup tools - because that is what
  the page is for on the day. The two hero boards come first and the draft
  board, which used to be the first thing on the page whatever the state,
  drops below the teams.

  Before anybody tees off that is the wrong page, so #golf-outing is a flex
  column and css/golf.css re-orders it from data-golf-state: in "upcoming"
  the draft and the rosters come back to the top and the empty boards go
  under them. THE STATE IS NOT DECIDED HERE. golf-matches.js sets the
  attribute from outingState() in golf-battle.js, which is the app's one
  answer to "what state is this outing in" - a second opinion computed from
  outing.status alone is exactly the disagreement that helper exists to
  stop. Until it answers, the active order stands.
*/
view.innerHTML=`${title}${guestStrip(outing)}<div id="golf-outing" class="golf-event"><div class="golf-board-page ge-board"></div>${hasTournament?`<div class="golf-live-page ge-live"></div>`:leaderboard(teams,scoresRes.data||[],holesRes.data||[],outing)}<div class="golf-matches-page ge-matches"></div>${teamsCard(outing,parts,teams,byId)}<div class="golf-draft-page ge-draft"></div>${outingOverview(outing,parts,teams,byId,(scoresRes.data||[]).length,dayHoles)}</div>`;if(!hasTournament)startLeaderPoll(view,outing);const refresh=stableRefresh(view,()=>render(view,{quiet:true}));wireGuest(view,outing,refresh);wireGuestCode(view,outing);if(canEdit()){wireLineup(view,outing,parts,membersList,refresh);wireTeams(view,outing,parts,teams,rate,refresh);wireTeamNames(view,outing,teams,refresh);wireGolfNames(view,outing,parts,nameMap,refresh);wireTeamMode(view,outing,parts,teams,refresh);}}
/* =====================================================================
   THE TEAMS SECTION - a roster, and nothing else
   ---------------------------------------------------------------------
   This used to be a scorecard menu wearing a roster's clothes: the whole
   team card was one anchor to that team's scorecard, ending in "View
   scorecard →", under a subtitle telling you to pick a team to open one.
   So the informational part of the page was also the app's main scoring
   navigation, every player's name sat inside a link, and reading who was
   on a team meant being one mis-tap from a different screen.

   Scoring did not live here uniquely and never needed to: the live
   leaderboard rows go to exactly the same scorecards, beside the live
   numbers, which is where somebody about to enter strokes already is. So
   this is reference information now - team, colour, captain, players -
   and nothing in it navigates.

   The captain goes through playerName() like every other golf name rather
   than reading display_name off the member row, so a captain who has set
   a golf name is called the same thing here as on the scorecard, the
   draft board and the shared image.

   SHARE TEAMS is the one action on the card. The button is not rendered
   here: this leaves a slot and golf-matches.js fills it once it has the
   rosters, the captains and the pairings, because a share button drawn
   before there is anything to draw is a dead control.
   ===================================================================== */
function teamsCard(outing,parts,teams,byId){
  const roster=team=>{const players=parts.filter(p=>String(p.team_id)===String(team.id));
    /* golf_teams.captain_member_id is a real column behind a migration, so a
       team without one says so rather than inventing a leader. */
    const cap=team.captain_member_id!=null&&byId.has(String(team.captain_member_id))
      ?playerName({member_id:team.captain_member_id},nameMap):"";
    return `<div class="gteam" style="--racer:${esc(teamInk(team.color, team.sort_order))}">
      <header class="gteam-head"><span class="gteam-name">${esc(team.name||"Team")}</span><span class="gteam-count">${players.length} player${players.length===1?"":"s"}</span></header>
      <div class="gteam-body">
        <div class="gteam-block"><span class="gteam-label">Captain</span>${cap?`<span class="gteam-captain"><svg class="ico-sm" aria-hidden="true"><use href="#i-medal"></use></svg>${esc(cap)}</span>`:`<span class="gteam-captain is-none">Not named yet</span>`}</div>
        <div class="gteam-block"><span class="gteam-label">Players</span>${players.length?`<ul class="gteam-roster">${players.map(p=>`<li>${esc(playerName(p,nameMap))}</li>`).join("")}</ul>`:`<span class="muted tiny">No players assigned</span>`}</div>
      </div></div>`;};
  const unassigned=parts.filter(p=>p.team_id==null);
  return `<section class="card golf-teams-card ge-teams" data-collapse="golf-teams" data-collapse-title="Teams"><div class="card-title-row"><div><div class="card-title">Teams</div><p class="muted tiny">Who is on which team, and who is running it.</p></div><span class="gteam-share" data-teamshare></span></div>${teams.length?`<div class="gteams">${teams.map(roster).join("")}</div>`:`<div class="golf-empty-teams">${canEdit()?"Generate teams below to get started.":"Teams have not been generated yet."}</div>`}${unassigned.length?`<div class="gteam is-spare"><header class="gteam-head"><span class="gteam-name">Unassigned</span><span class="gteam-count">${unassigned.length}</span></header><div class="gteam-body"><ul class="gteam-roster">${unassigned.map(p=>`<li>${esc(playerName(p,nameMap))}</li>`).join("")}</ul></div></div>`:""}</section>`;}
/* The event's own facts, then every admin tool in one block so the page
   order only has to move one thing to demote all of them. */
function outingOverview(outing,parts,teams,byId,scoreCount,dayHoles){return `<div class="card golf-event-summary ge-facts"><div class="setup-figures">${figure(parts.length,parts.length===1?"player":"players")}${figure(dayHoles,"holes")}${figure(teams.length,teams.length===1?"team":"teams")}</div>${outing.notes?`<p class="muted golf-notes">${esc(outing.notes)}</p>`:""}</div>${canEdit()?`<div class="ge-admin"><section class="card golf-admin-card" data-collapse="golf-teamsetup"><div class="card-title-row"><div><div class="card-title">How teams are decided</div><p class="muted tiny">${teamMode(outing)==="random"?"The generator deals every player out — at random, or evenly by rating with locked players staying put.":teamMode(outing)==="draft"?"Captains pick their players one at a time on the draft board.":"Build random or balanced teams. Locked players stay together."}</p></div><span class="admin-badge">Organizer</span></div>${teamAdminControls(outing,parts,teams,scoreCount,parts.filter(p=>p.pick_number!=null).length)}</section>${guestCodeCard(outing)}${rosterCard(outing,parts,teams,byId)}${lineupCard(outing,parts,teams,byId)}</div>`:""}`;}
/* An admin-only write that the database REFUSES does not come back as an
   error: row level security makes it match zero rows and PostgREST returns
   a cheerful 204. Without asking for the changed rows back, a member with no
   admin token sees "Team renamed" and a name that never changed. */
async function mustWrite(query,what){const{data,error}=await query.select("id");if(error)throw error;if(!data||!data.length)throw new Error(`The database refused to ${what}. Sign in as admin and try again.`);return data;}
function figure(value,label){return `<div class="setup-figure"><span class="sf-v">${esc(value)}</span><span class="sf-l">${esc(label)}</span></div>`;}
/* A player's team, said in colour AND in words - the dot alone is no use to
   anybody who cannot separate the two teams' colours, and the words alone are
   what you have to read one at a time. */
const teamOf=(p,teams)=>teams.find(t=>String(t.id)===String(p.team_id));
function teamDot(p,teams){const team=teamOf(p,teams);
return team?`<i class="tdot" style="--racer:${esc(teamInk(team.color, team.sort_order))}"></i>`:`<i class="tdot is-none" title="No team yet"></i>`;}
function teamLabel(p,teams){const team=teamOf(p,teams);
return `<small class="tteam${team?"":" muted"}">${esc(team?.name||"no team")}</small>`;}
function lineupCard(outing,parts,teams,byId){const names=[...byId.values()],spare=names.filter(m=>!parts.some(p=>String(p.member_id)===String(m.id)));return `<section class="card golf-lineup-card" data-collapse="golf-players" data-collapse-default="folded"><div class="card-title-row"><div><div class="card-title">Players</div><p class="muted tiny">Add or remove players from this event. The colour is their team.</p></div></div>${parts.length?`<div class="glist">${parts.map(p=>{
        /* The DFL name in brackets when the golf name hides it. Two people
           called "Nick" on a tee sheet is the duplicate-name problem this
           screen exists to settle, so the commissioner can always see who a
           golf name actually belongs to. */
        const behind=realName(p,nameMap);
        return `<div class="grow gname-row">
        <span class="gname">${teamDot(p,teams)}${esc(playerName(p,nameMap))}${isGuest(p)?`<small class="muted"> · guest</small>`:behind?`<small class="muted"> · ${esc(behind)}</small>`:""}${teamLabel(p,teams)}</span>
        <button class="btn ghost small" data-rename-player="${p.id}" data-member="${p.member_id??""}" aria-label="Edit golf name for ${esc(playerName(p,nameMap))}">Name</button>
        <button class="btn ghost small" data-drop-player="${p.id}" aria-label="Remove player">×</button>
      </div>`}).join("")}`:`<p class="muted tiny">Nobody is signed up yet.</p>`}<div class="arena-admin">${spare.length?`<select id="golf-add-member"><option value="">— add a member —</option>${spare.map(m=>`<option value="${m.id}">${esc(m.display_name)}</option>`).join("")}`:`<span class="muted tiny">Every member is playing.</span>`}<button class="btn ghost small" id="golf-add-all" ${spare.length?"":"disabled"}>Add everyone</button></div><div class="arena-admin"><input id="golf-new-guest" type="text" maxlength="80" placeholder="Guest name" inputmode="text"><button class="btn small" id="golf-add-guest">Add a guest</button></div><p class="muted tiny">A guest plays this event only. They are <strong>not</strong> added to the league, so they never turn up in the “Who are you?” picker, the keepers or any member list — but they can be drafted, paired and scored like anybody else. Somebody else enters their strokes, since a guest has no device of their own in the app.</p></section>`;}
/* The generator, then the one control that throws scores away. It is kept
   below a rule and labelled with the exact number of strokes it deletes,
   because "Reset" next to "Random teams" is how a round gets wiped at the
   turn by a mis-tap. */
/*
  How this outing decides its teams, and only the controls for the mode it is
  actually in.

  Manual is the default and the two modes are mutually exclusive on screen,
  because the failure mode otherwise is a real one: "Random teams" sitting a
  thumb's width from a draft in progress silently reassigns everybody and
  throws the picks away.

  team_mode arrives with golf_draft_schema.sql. Until that is run it is
  undefined, and an outing with no mode behaves exactly as it did before -
  generator visible, no draft - so nothing breaks while the migration waits.
*/
function teamMode(outing){return outing.team_mode==null?"legacy":outing.team_mode==="random"?"random":"draft";}
function teamAdminControls(outing,parts,teams,scoreCount,pickCount){const mode=teamMode(outing);
const modeSwitch=mode==="legacy"?"":`<div class="golf-mode" role="group" aria-label="How teams are decided">
  <button type="button" class="gm-opt ${mode==="draft"?"is-on":""}" data-team-mode="draft" aria-pressed="${mode==="draft"}">Captains draft<small>pick one at a time</small></button>
  <button type="button" class="gm-opt ${mode==="random"?"is-on":""}" data-team-mode="random" aria-pressed="${mode==="random"}">Random<small>deal them out</small></button>
</div>`;
const generator=`<div class="golf-generator"><label class="gcount">Teams (2–6) <input type="number" id="golf-team-count" min="2" max="6" value="${teams.length||2}"></label><button class="btn small" id="golf-random" ${parts.length<2?"disabled":""}>Random teams</button><button class="btn small" id="golf-balanced" ${parts.length<2?"disabled":""}>Balanced teams</button><button class="btn ghost small" id="golf-clear" ${teams.length?"":"disabled"}>Clear teams</button></div>`;
// In draft mode the empty teams still have to come from somewhere, so making
// them stays - it is dealing the PLAYERS out that would trample the draft.
const draftControls=`<div class="golf-generator"><label class="gcount">Teams (2–6) <input type="number" id="golf-team-count" min="2" max="6" value="${teams.length||2}"></label><button class="btn small" id="golf-make-teams" ${teams.length?"disabled":""}>Create the teams</button><button class="btn ghost small" id="golf-clear" ${teams.length?"":"disabled"}>Clear teams</button></div><p class="muted tiny">Create 2–6 empty teams, then name the captains on the draft board above. Nobody is assigned for you.</p>`;
return modeSwitch+(mode==="draft"?draftControls:generator)+`<div class="golf-danger"><div class="golf-danger-text"><strong>Reset all scorecards</strong><p class="muted tiny">${scoreCount?`Deletes all ${scoreCount} stroke${scoreCount===1?"":"s"} for every team in this event. Teams, players and pars stay.`:"No strokes have been entered yet."}</p></div><button class="btn small danger" id="golf-reset-scores" ${scoreCount?"":"disabled"}>Reset all</button></div>`;}

/* Rename a team and shuffle who is on it, in one place.

   The Teams section is a read-only roster on purpose, so a select and two
   buttons do not belong on it - moving somebody between teams is an admin
   job and it lives with the other admin jobs. Locking matters here because
   the generator honours it: a locked player keeps their team when you
   regenerate. */
function rosterCard(outing,parts,teams,byId){const options=(p)=>`<option value="">— unassigned —</option>${teams.map(t=>`<option value="${t.id}" ${String(t.id)===String(p.team_id)?"selected":""}>${esc(t.name||"Team")}</option>`).join("")}`;
const row=(p)=>`<div class="grow gedit-row ${p.locked?"is-locked":""}"><span class="gname">${esc(playerName(p,nameMap))}</span><select class="gmove" data-move="${p.id}" data-was="${p.team_id??""}" aria-label="Move player to another team">${options(p)}</select><button type="button" class="btn ghost small glock" data-lock="${p.id}" data-on="${p.locked?"1":"0"}" title="${p.locked?"Unlock":"Lock to this team"}" aria-label="${p.locked?"Unlock":"Lock to this team"}">${icon(p.locked?"lock":"unlock",{size:15})}</button></div>`;
const block=(t)=>{const mine=parts.filter(p=>String(p.team_id)===String(t.id));return `<div class="gedit" style="--racer:${esc(teamInk(t.color, t.sort_order))}"><div class="gedit-head"><input class="gedit-name" type="text" maxlength="40" value="${esc(t.name||"Team")}" data-team-name="${t.id}" aria-label="Team name"><button type="button" class="btn small" data-save-name="${t.id}">Save</button></div><div class="glist">${mine.length?mine.map(row).join(""):`<div class="grow"><span class="muted tiny">Nobody on this team yet</span></div>`}</div></div>`};
const loose=parts.filter(p=>p.team_id==null);
return `<section class="card golf-roster-card" data-collapse="golf-roster" data-collapse-default="folded"><div class="card-title-row"><div><div class="card-title">Team editor</div><p class="muted tiny">Rename a team, move players between teams, and lock anyone who should stay put through a regenerate.</p></div><span class="admin-badge">Organizer</span></div>${teams.length?`<div class="gedits">${teams.map(block).join("")}${loose.length?`<div class="gedit is-spare"><div class="gedit-head"><span class="gedit-title">Unassigned</span></div><div class="glist">${loose.map(row).join("")}</div></div>`:""}</div>`:`<div class="golf-empty-teams">Generate teams first.</div>`}</section>`;}
function wireLineup(view,outing,parts,members,refresh){const root=view.querySelector("#golf-outing");root.addEventListener("change",async e=>{const add=e.target.closest("#golf-add-member");if(!add||!add.value)return;try{await insertRow("golf_participants",{outing_id:outing.id,member_id:Number(add.value),sort_order:parts.length});refresh();}catch(err){toast(err.message||"Could not add that player",true);}});root.addEventListener("click",async e=>{const drop=e.target.closest("[data-drop-player]"),all=e.target.closest("#golf-add-all"),create=e.target.closest("#golf-add-guest");if(drop){try{const{error}=await db().from("golf_participants").delete().eq("id",drop.dataset.dropPlayer);if(error)throw error;refresh();}catch(err){toast(err.message||"Could not remove that player",true);}}if(all){all.disabled=true;const have=new Set(parts.map(p=>String(p.member_id)));try{const rows=members.filter(m=>!have.has(String(m.id))).map((m,i)=>({outing_id:outing.id,member_id:m.id,sort_order:parts.length+i}));if(rows.length){const result=await db().from("golf_participants").insert(rows);if(result.error)throw result.error;}refresh();}catch(err){toast(err.message||"Could not fill the line-up",true);all.disabled=false;}}/* A guest is a golf_participants row and nothing else.
   This used to create a members row, which is how a stranger ended up in the
   "Who are you?" picker and every member dropdown in the app for good. */
if(create){const input=root.querySelector("#golf-new-guest"),name=input?.value?.trim();if(!name)return toast("Enter the guest's name",true);create.disabled=true;try{await insertRow("golf_participants",{outing_id:outing.id,guest_name:name,sort_order:parts.length});toast(`${name} added to this event`);refresh();}catch(err){toast(err.message||"Could not add that guest",true);create.disabled=false;}}});}
/* Names are typed in the field that already shows the current one, so you
   can see what you are changing - a prompt() box shows you nothing else on
   the card. Enter saves, because that is what Enter does in a text field. */
/*
  GOLF NAMES, from the commissioner's side.

  A member's golf name lives on their member row and is theirs; an admin can
  set it for them, which is what "resolve duplicate or mistyped names" needs.
  A guest has no member row, so their name IS golf_participants.guest_name
  and that is what gets corrected.

  Two different columns, one button, because from this screen they are the
  same job: fix what this person is called at golf. Neither write can reach
  display_name, team_name or anything Sleeper - see golf_identity_schema.sql.
*/
function wireGolfNames(view,outing,parts,nameMap,refresh){
  const root=view.querySelector("#golf-outing");
  root?.addEventListener("click",async e=>{
    const btn=e.target.closest("[data-rename-player]");
    if(!btn)return;
    const part=parts.find(p=>String(p.id)===String(btn.dataset.renamePlayer));
    if(!part)return;
    const current=playerName(part,nameMap);
    const next=prompt(part.member_id!=null
      ? `Golf name for ${current}.

This is the name golf uses. Their DFL and Sleeper names are not touched.
Leave blank to go back to their DFL name.`
      : `Name for this guest.`, current);
    if(next===null)return;                       // cancelled
    const clean=String(next).trim();
    if(part.member_id==null&&!clean)return toast("A guest needs a name",true);
    if(clean.length>40)return toast("That name is too long",true);
    try{
      if(part.member_id!=null){
        await mustWrite(db().from("members").update({golf_name:clean}).eq("id",part.member_id),"set that golf name");
        /* The member cache holds the old golf name, and every golf screen
           reads names out of it. */
        await refreshMember().catch(()=>{});
      }else{
        await mustWrite(db().from("golf_participants").update({guest_name:clean}).eq("id",part.id),"rename that guest");
      }
      toast(clean?`Now “${clean}” at golf`:"Back to their DFL name");
      refresh();
    }catch(err){
      toast(/golf_name|column/.test(err.message||"")
        ? "Run golf_identity_schema.sql in Supabase"
        : (err.message||"Could not set that name"),true);
    }
  });
}

function wireTeamNames(view,outing,teams,refresh){const root=view.querySelector("#golf-outing");
const save=async(id,value)=>{const clean=String(value||"").trim();if(!clean)return toast("Team name cannot be blank",true);const team=teams.find(t=>String(t.id)===String(id));if(team&&team.name===clean)return;try{await mustWrite(db().from("golf_teams").update({name:clean}).eq("id",id),"rename that team");toast("Team renamed");refresh();}catch(err){toast(err.message||"Could not rename team",true);}};
root.addEventListener("click",e=>{const btn=e.target.closest("[data-save-name]");if(!btn)return;const input=root.querySelector(`[data-team-name="${btn.dataset.saveName}"]`);if(input)save(btn.dataset.saveName,input.value);});
root.addEventListener("keydown",e=>{const input=e.target.closest("[data-team-name]");if(!input||e.key!=="Enter")return;e.preventDefault();save(input.dataset.teamName,input.value);});}
function wireTeams(view,outing,parts,teams,rate,refresh){const root=view.querySelector("#golf-outing");root.addEventListener("change",async e=>{const move=e.target.closest("[data-move]");if(!move)return;try{await mustWrite(db().from("golf_participants").update({team_id:move.value?Number(move.value):null}).eq("id",move.dataset.move),"move that player");refresh();}catch(err){toast(err.message||"Could not move that player",true);move.value=move.dataset.was||"";}});root.addEventListener("click",async e=>{const rnd=e.target.closest("#golf-random"),bal=e.target.closest("#golf-balanced"),clr=e.target.closest("#golf-clear"),lock=e.target.closest("[data-lock]"),reset=e.target.closest("#golf-reset-scores");
if(lock){try{await mustWrite(db().from("golf_participants").update({locked:lock.dataset.on!=="1"}).eq("id",lock.dataset.lock),"lock that player");refresh();}catch(err){toast(err.message||"Could not lock that player",true);}return;}
/* Two gates on the same button, and the count is in the sentence: this
   deletes the whole event's strokes and there is no undo. */
if(reset){if(!confirm(`Reset every scorecard in this event?\n\nThis deletes all strokes for all teams. Teams, players and pars stay. This cannot be undone.`))return;if(!confirm("Last check - the strokes are gone for good. Reset all scorecards?"))return;reset.disabled=true;
/* Queued strokes on THIS device go too, or the first flush after the reset
   would put some of them straight back. */
dropPending(outing.id);
try{const gone=await mustWrite(db().from("golf_scores").delete().eq("outing_id",outing.id),"reset the scorecards");toast(`All scorecards reset — ${gone.length} stroke${gone.length===1?"":"s"} cleared`);refresh();}catch(err){toast(err.message||"Could not reset the scorecards",true);reset.disabled=false;}return;}if(clr){if(!confirm("Clear the teams? Players stay in the outing."))return;try{const a=await db().from("golf_participants").update({team_id:null}).eq("outing_id",outing.id);if(a.error)throw a.error;const b=await db().from("golf_teams").delete().eq("outing_id",outing.id);if(b.error)throw b.error;refresh();}catch(err){toast(err.message||"Could not clear the teams",true);}return;}if(rnd||bal){const want=Math.max(2,Math.min(6,Number(view.querySelector("#golf-team-count")?.value)||2));
/* Dealing the players out discards every pick that has been made. Say so with
   the number in it rather than quietly reassigning a half-finished draft. */
const picked=parts.filter(p=>p.pick_number!=null).length;
if(picked&&!confirm(`This deals every player out again and throws away the ${picked} pick${picked===1?"":"s"} already made. Carry on?`))return;
e.target.disabled=true;try{await generateTeams(outing,parts,teams,rate,want,bal?"balanced":"random");toast(bal?"Balanced teams generated":"Random teams generated");refresh();}catch(err){toast(err.message||"Could not generate teams",true);e.target.disabled=false;}}});}

/*
  The mode switch, and making empty teams for a draft to fill.

  Switching to Random does not itself move anybody - it just puts the
  generator on screen - so it only warns when there are picks that pressing
  the generator would then destroy.
*/
function wireTeamMode(view,outing,parts,teams,refresh){const root=view.querySelector("#golf-outing");
root.addEventListener("click",async e=>{const opt=e.target.closest("[data-team-mode]"),make=e.target.closest("#golf-make-teams");

if(opt){const want=opt.dataset.teamMode;
/* Only ever the two real values, and compared against the RAW stored value so
   a bad one that got in previously is corrected rather than read as a match. */
if(want!=="draft"&&want!=="random")return;
if(want===outing.team_mode)return;
const picked=parts.filter(p=>p.pick_number!=null).length;
if(want==="random"&&picked&&!confirm(`Switch to Random? The ${picked} pick${picked===1?"":"s"} already made stay${picked===1?"s":""} for now, but generating teams will replace ${picked===1?"it":"them"}.`))return;
try{await updateRow("golf_outings",outing.id,{team_mode:want});refresh();}
catch(err){toast(err.message||"Could not switch mode",true);}
return;}

if(make){const want=Math.max(2,Math.min(6,Number(view.querySelector("#golf-team-count")?.value)||2));
make.disabled=true;
try{const rows=Array.from({length:want},(_,i)=>({outing_id:outing.id,name:TEAM_NAMES[i%TEAM_NAMES.length],color:newTeamColor(i),sort_order:i,draft_order:i}));const result=await db().from("golf_teams").insert(rows);if(result.error)throw result.error;
toast(`${want} empty teams created`);refresh();}
catch(err){toast(err.message||"Could not create the teams",true);make.disabled=false;}}});}
async function generateTeams(outing,parts,existingTeams,rate,want,mode){const teams=[...existingTeams];while(teams.length<want){const i=teams.length;teams.push(await insertRow("golf_teams",{outing_id:outing.id,name:TEAM_NAMES[i%TEAM_NAMES.length],color:newTeamColor(i),sort_order:i}));}while(teams.length>want){const gone=teams.pop();const{error}=await db().from("golf_teams").delete().eq("id",gone.id);if(error)throw error;}const locked=parts.filter(p=>p.locked&&p.team_id!=null),pool=parts.filter(p=>!(p.locked&&p.team_id!=null)),load=new Map(teams.map(t=>[String(t.id),0]));locked.forEach(p=>{const k=String(p.team_id);if(load.has(k))load.set(k,load.get(k)+1);});if(mode==="balanced")pool.sort((a,b)=>rate(b.member_id)-rate(a.member_id));else for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}for(const p of pool){let best=teams[0],bestLoad=Infinity;for(const t of teams){const l=load.get(String(t.id));if(l<bestLoad){bestLoad=l;best=t;}}load.set(String(best.id),bestLoad+1);/* Clear the pick as well as setting the team. A generated assignment is not
   a pick, and leaving an old pick_number behind would have the draft board
   reporting picks that nobody ever made. */
/* The fallback is for a database without pick_number/picked_at. A REFUSED
   write is not that, and retrying it with fewer columns just refuses again -
   so it is rethrown rather than reported as a missing column. */
await updateRow("golf_participants",p.id,{team_id:best.id,pick_number:null,picked_at:null})
  .catch(err=>{if(err?.refused)throw err;return updateRow("golf_participants",p.id,{team_id:best.id});});}}

/* =====================================================================
   GUEST ACCESS
   ---------------------------------------------------------------------
   Half the field is not in the league. Those people are already on the
   event as golf_participants rows with a guest_name and no member_id -
   they simply had no way to prove it, so every score policy said no and a
   member had to keep their card.

   A guest types the event code once, picks their own name off the roster,
   and can then score their own team. The pass is kept on the phone so
   nobody types it again on the 14th tee, and it is worth nothing on its
   own: every write carries it to Postgres, which re-checks it against a
   hash the API cannot read.

   The whole thing is one strip at the top of the event, and it is not
   drawn at all for a signed-in league member - they already have a
   member id and this would be a second sign-in for nothing.
   ===================================================================== */

function guestStrip(outing) {
  const pass = passFor(outing.id);
  if (pass) {
    return `<div class="card guest-strip is-on">
      <div>
        <span class="card-title">Scoring as</span>
        <strong class="guest-who">${esc(pass.name)}</strong>
        ${pass.teamName ? `<span class="muted tiny">${esc(pass.teamName)}</span>` : ""}
      </div>
      <button type="button" class="btn ghost small" data-guest-out>Sign out</button>
    </div>`;
  }
  return `<div class="card guest-strip" data-guest-prompt>
    <div>
      <span class="card-title">Playing today?</span>
      <p class="muted tiny">Not in the league? Enter the event code to score your own team.</p>
    </div>
    <button type="button" class="btn small" data-guest-in>Enter code</button>
  </div>`;
}

/*
  Sign-in, in two steps and one card: the code, then which of these people
  you are. The roster comes back from the same RPC that checks the code, so
  a correct code costs one round trip rather than two.
*/
function wireGuest(view, outing, refresh) {
  const strip = view.querySelector(".guest-strip");
  if (!strip) return;

  strip.querySelector("[data-guest-out]")?.addEventListener("click", () => {
    clearGolfPass();
    toast("Signed out of this event");
    refresh();
  });

  /* One join flow, shared with the door on the welcome overlay - see
     golf-join.js. This used to be a second hand-rolled code form here, which
     is two places to get the same four steps wrong. */
  strip.querySelector("[data-guest-in]")?.addEventListener("click", () => {
    mountJoin(strip, {
      outingId: outing.id,
      onDone: refresh,
      onCancel: refresh,
    });
  });
}

/* =====================================================================
   GUEST ACCESS, from the commissioner's side
   ---------------------------------------------------------------------
   The code has to be settable from the app. Without this the only way to
   let a guest score was to run SQL, which is not a thing anybody is doing
   on a golf course - and a feature that needs a laptop to switch on is a
   feature nobody uses.

   The code itself is NEVER read back. It cannot be: the hash lives in a
   table with no policies and the app has no way to reach it. So this shows
   whether a code exists and lets an admin set or clear one, and that is
   deliberately all it can do. If the commissioner forgets it, they set a
   new one - which is the right trade for a code that unlocks nothing but
   one afternoon's scorecards.
   ===================================================================== */
function guestCodeCard(outing) {
  /*
    THE THREE DEEP ADMIN TOOLS - this, the team editor and the player list -
    start folded. Each is a full screen of controls that a commissioner
    reaches for once and then never again that day, and stacking all three
    open under the scores is most of why the event page was so long.

    "How teams are decided" is deliberately NOT folded: it is small, and it
    is the one an admin needs while the day is still being built.

    A default only, and only until the commissioner opens it once - see
    collapse.js. No event state is consulted here, because outingState()
    lives with the battles in golf-matches.js and a second opinion computed
    from outing.status is exactly what that helper exists to prevent.
  */
  return `<section class="card golf-guest-admin" data-collapse="golf-guestcode" data-collapse-default="folded">
    <div class="card-title-row">
      <div>
        <div class="card-title">Guest access</div>
        <p class="muted tiny">A code for people who are not in the league. They pick their
          own name and can score their own team — nothing else.</p>
      </div>
<span class="admin-badge">Organizer</span>
    </div>
    <div class="guest-code-state muted tiny" data-code-state>Checking…</div>
    <form class="guest-code-form" data-code-form>
      <label for="gc-code">Event code</label>
      <div class="guest-row">
        <input id="gc-code" name="code" type="text" autocomplete="off" autocapitalize="characters"
               spellcheck="false" placeholder="e.g. ROLLA26" minlength="4">
        <button class="btn small" type="submit">Set code</button>
      </div>
      <p class="muted tiny">Four characters or more. Setting a new one replaces the old
        immediately; clearing it locks every guest out.</p>
      <div class="row-end"><button type="button" class="btn ghost small danger" data-code-clear>Clear code</button></div>
    </form>
  </section>`;
}

function wireGuestCode(view, outing) {
  const card = view.querySelector(".golf-guest-admin");
  if (!card) return;
  const state = card.querySelector("[data-code-state]");
  const form = card.querySelector("[data-code-form]");

  const paint = async () => {
    const has = await eventHasCode(db(), outing.id);
    state.textContent = has
      ? "A code is set for this event. Guests can sign in now."
      : "No code set — guests cannot score this event yet.";
    state.className = has ? "guest-code-state tiny" : "guest-code-state muted tiny";
  };
  paint();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = form.code.value.trim();
    if (code.length < 4) { toast("Four characters or more", true); return; }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const { error } = await db().rpc("golf_set_event_code", { p_outing_id: Number(outing.id), p_code: code });
      if (error) throw error;
      form.code.value = "";
      toast(`Code set — tell the field: ${code}`);
      paint();
    } catch (err) {
      toast(err.message || "Could not set the code", true);
    }
    btn.disabled = false;
  });

  card.querySelector("[data-code-clear]").addEventListener("click", async () => {
    if (!confirm("Clear the code? Every guest loses access to this event straight away.")) return;
    try {
      const { error } = await db().rpc("golf_set_event_code", { p_outing_id: Number(outing.id), p_code: "" });
      if (error) throw error;
      toast("Code cleared");
      paint();
    } catch (err) {
      toast(err.message || "Could not clear the code", true);
    }
  });
}

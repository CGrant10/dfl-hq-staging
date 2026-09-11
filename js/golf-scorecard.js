/* =====================================================================
   DFL Golf - ONE scorecard per team. Mobile-first.
   ---------------------------------------------------------------------
   Scores are shared per team: one row in golf_scores per
   (outing_id, team_id, hole), member_id null. Any member of the team can
   write their own team's card; admins can write anybody's. Postgres is
   what enforces that - see golf_schema.sql.

   The card is laid out the way a golf app is: the marks and the strip at
   the top are paper-scorecard shorthand, kept exactly.

     THE STRIP    holes across, par under, the score in its mark, OUT and
                  IN on the end. The whole round at a glance, read-only.
     THE ROWS     one hole per row down the page: yardage, par, and the
                  strokes. This is where scores go in.

     A MARK       circle = under par, square = over, a second ring = by
                  two or more. Shape carries the meaning so the card still
                  reads in a screenshot or in the sun; the colour and the
                  word beside it agree with the shape rather than being
                  the only signal.

   Strokes go in two ways on purpose: the +/- pair, which is what you use
   one-handed on a tee box, and typing into the number, which is faster
   when you are catching up on three holes at the turn. The number IS the
   mark - it is a round input for a birdie and a square one for a bogey.

   Rolla is a 9-hole course, so holes 10-18 are the second time around and
   par/yardage for hole 12 comes from hole 3.
   ===================================================================== */
import { db, isAdmin } from "./supabase.js";
import { currentMember, loadMembers } from "./members.js";
import { passFor } from "./golf-guest.js";
import { queueScore, pendingFor, pendingCount, dropPending, onQueueChange,
         cacheCard, cachedCard, dropCachedCard, flush, refusals,
         MIN_STROKES, MAX_STROKES } from "./golf-offline.js";
import { holeResult } from "./golf-score-result.js";
const esc=v=>String(v??"").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;","\>":"&gt;",'"':"&quot;"}[c]));
const num=v=>Number.isFinite(Number(v))?Number(v):0;
/* Long enough that + + + is one write, short enough that a save always
   beats the walk to the next tee. */
const SAVE_DELAY=600;
/* Exported from here rather than copied into the 2v2 card: one place decides
   what a birdie is called and what shape it wears, so the team card, the
   pair card and the boards can never disagree about the same round. */
export const fmtToPar=(score,par)=>{if(!score)return"—";const d=score-par;return d===0?"E":d>0?`+${d}`:`${d}`;};
/*
  One place decides what a score is called, what shape it wears and what
  colour it is, so the strip, the row and the label can never disagree.
*/
export { holeResult };
function styles(){if(document.getElementById("dfl-team-scorecard-style"))return;const s=document.createElement("style");s.id="dfl-team-scorecard-style";s.textContent=`
/* overflow:clip, NOT hidden. Both clip the head's square corners, but
   'hidden' makes this card a scroll container and silently kills the sticky
   bar inside it. The pair is deliberate: a browser without clip support
   keeps hidden and simply gets a bar that scrolls away - the numbers are
   still there, they just do not follow you. */
.dfl-team-card{overflow:hidden;overflow:clip}
.dfl-team-head{border-radius:13px 13px 0 0}

/* Sits under the fixed 56px topbar (+1px border), and under the notch. */
.dfl-live{position:sticky;top:calc(57px + env(safe-area-inset-top));z-index:5;display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border-bottom:1px solid var(--line);box-shadow:0 6px 14px rgba(0,0,0,.28)}
.dfl-live-cell{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:7px 6px;background:var(--bg-3)}
.dfl-live-cell small{font-size:8.5px;text-transform:uppercase;letter-spacing:.1em;font-weight:900;color:var(--muted)}
.dfl-live-cell b{font-size:17px;font-weight:950;font-variant-numeric:tabular-nums;line-height:1.1}
.dfl-live-topar{color:var(--accent)}
@media (max-height:480px) and (orientation:landscape) and (max-width:899px){.dfl-live{top:calc(49px + env(safe-area-inset-top))}.dfl-live-cell{padding:5px 6px}.dfl-live-cell b{font-size:15px}}
.dfl-team-head{padding:14px;border-bottom:1px solid var(--line);background:var(--bg-3)}.dfl-team-head-top{display:flex;align-items:center;gap:10px}.dfl-team-head h2{margin:0;font-size:20px}.dfl-team-kicker{font-size:9px;letter-spacing:.14em;font-weight:900;color:var(--accent);display:block;margin-bottom:2px}.dfl-team-roster{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px}.dfl-team-roster span{font-size:10px;padding:4px 7px;border:1px solid var(--line);border-radius:999px;background:var(--bg-2)}.dfl-score-status{padding:8px 14px;font-size:11px;color:var(--muted);border-bottom:1px solid var(--line)}.dfl-sync-wait{color:var(--sc-over);font-weight:900}.dfl-score-status:has(.dfl-sync-fail){background:var(--danger-bg)}.dfl-sync-fail{color:var(--danger-ink);font-weight:900}.dfl-sync-why{display:block;color:var(--muted)}.dfl-admin-actions{display:flex;justify-content:flex-end;padding:8px 10px;border-bottom:1px solid var(--line)}.dfl-clear-scorecard{border:1px solid var(--danger-line);border-radius:8px;padding:7px 10px;background:var(--danger-bg);color:var(--danger-ink);font-weight:900;font-size:11px}

/* ---- the strip: the whole round at a glance ---- */
.dfl-strip{margin:10px;border:1px solid var(--line);border-radius:10px;background:var(--bg-2);overflow:hidden}
.dfl-strip-title{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 12px;background:var(--bg-3);border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:900;color:var(--muted)}
.dfl-strip-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.dfl-strip-tbl{border-collapse:separate;border-spacing:0;width:100%;min-width:100%;font-variant-numeric:tabular-nums;table-layout:fixed}
.dfl-strip-tbl th,.dfl-strip-tbl td{padding:0;height:28px;text-align:center;border-bottom:1px solid var(--line-soft);font-size:11px;font-weight:800}
.dfl-strip-tbl th.lbl{width:42px;text-align:left;padding-left:11px;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.06em;border-right:1px solid var(--line)}
.dfl-strip-tbl .row-h td{background:var(--bg-3);color:var(--muted);font-size:10px}
.dfl-strip-tbl .row-p td{color:var(--muted);font-size:10px;height:24px}
.dfl-strip-tbl .row-s td{height:34px}
.dfl-strip-tbl .sub{border-left:1px solid var(--line);background:var(--hover-soft);width:34px}
.dfl-strip-tbl tr:last-child td,.dfl-strip-tbl tr:last-child th{border-bottom:0}
.dfl-strip-tbl td[data-ov-hole]{cursor:pointer}
.ovm{display:inline-grid;place-items:center;width:24px;height:24px;font-size:12px;font-weight:900;line-height:1}

/* ---- one hole, one row ---- */
.dfl-nine{margin:10px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--bg-2)}.dfl-nine-title{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg-3);border-bottom:1px solid var(--line)}
/* minmax(0,1fr) on the result column, never a bare 1fr. A bare 1fr keeps its
   min-content floor - the width of the word DOUBLE - so on a 320px phone the
   row over-commits and .dfl-nine's overflow:hidden quietly shears the column
   off instead of letting it shrink. */
.dfl-hole-grid{display:grid;grid-template-columns:62px 34px 132px minmax(0,1fr);align-items:center}
.dfl-hole-grid>div{min-height:44px;padding:5px 6px;border-bottom:1px solid var(--line-soft);border-right:1px solid var(--line-soft)}.dfl-hole-grid>div:not(.score):not(.result){display:flex;align-items:center}.dfl-hole-grid .hdr{min-height:30px;background:var(--bg-3);font-size:9px;text-transform:uppercase;font-weight:900;color:var(--muted)}
/* The hole cell is the one stacked cell on the card, so it opts out of the
   centred flex row above rather than the other way round. */
.dfl-hole-grid .hole{flex-direction:column;align-items:flex-start;justify-content:center;gap:0}
.hole-n{font-size:16px;font-weight:900;line-height:1.15;font-variant-numeric:tabular-nums}
.hole-again{font-size:12px;font-weight:800;color:var(--muted);margin-left:2px}
.hole .yards{font-size:12px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap;line-height:1.15}
.dfl-hole-grid .par{justify-content:center;color:var(--muted);font-weight:800}
.dfl-hole-grid .score{display:flex;align-items:center;justify-content:center;gap:5px;background:var(--hover-soft)}
.dfl-hole-grid .result{display:flex;align-items:center;justify-content:center;text-align:center;font-size:13px;font-weight:900;letter-spacing:.02em}
.result-eagle{color:var(--sc-under)}.result-birdie{color:var(--sc-under)}.result-par{color:var(--text)}.result-bogey{color:var(--sc-over)}.result-double{color:var(--sc-bad)}.result-empty{color:var(--muted);font-weight:700}
.dfl-hole-grid .is-now{background:rgba(47,191,95,.07)}

/* A thumb in a golf glove needs 40px+, and the two buttons must not be so
   close together that a mis-tap costs a stroke. */
.sbtn{width:38px;height:40px;flex:0 0 38px;border:1px solid var(--line);border-radius:9px;background:var(--bg-3);color:var(--text);font-size:20px;font-weight:900;line-height:1;padding:0}
.sbtn:active{background:var(--bg-2)}
.sbtn:disabled{opacity:.35}

/* ---- the mark: the number wears its own result ---- */
/* The input IS the shape - a round field for a birdie, a square one for a
   bogey - so typing and the paper shorthand are the same object. */
.mark{display:inline-grid;place-items:center;flex:0 0 auto}
.dfl-hole-grid input,.mark input{box-sizing:border-box;width:42px;height:42px;padding:0;border:2px solid var(--control-line);border-radius:9px;background:var(--bg-2);color:var(--text);text-align:center;font-size:19px;font-weight:950;line-height:1}
.dfl-hole-grid input:focus{outline:3px solid var(--accent);outline-offset:2px;background:var(--bg-3)}
.dfl-hole-grid input[type=number]::-webkit-inner-spin-button,.dfl-hole-grid input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.m-none input{border-style:dashed;color:var(--muted)}
.m-par input{border-color:var(--control-line)}
.m-birdie input,.m-eagle input{border-radius:50%;border-color:var(--sc-under);color:var(--sc-under)}
.m-eagle input{box-shadow:0 0 0 2px var(--bg-2),0 0 0 4px var(--sc-under)}
.m-bogey input,.m-dbl input{border-radius:7px;border-color:var(--sc-over)}
.m-dbl input{border-color:var(--sc-bad);box-shadow:0 0 0 2px var(--bg-2),0 0 0 4px var(--sc-bad)}
.m-eagle,.m-dbl{margin:0 3px}
.ovm.m-birdie,.ovm.m-eagle{border:1.5px solid var(--sc-under);border-radius:50%;color:var(--sc-under)}
.ovm.m-eagle{box-shadow:0 0 0 1.5px var(--bg-2),0 0 0 3px var(--sc-under)}
.ovm.m-bogey{border:1.5px solid var(--sc-over);border-radius:3px}
.ovm.m-dbl{border:1.5px solid var(--sc-bad);border-radius:3px;color:var(--sc-bad);box-shadow:0 0 0 1.5px var(--bg-2),0 0 0 3px var(--sc-bad)}
.ovm.m-none{color:var(--line)}

.dfl-final small{display:block;font-size:8px;text-transform:uppercase;color:var(--muted);font-weight:900}.dfl-final{margin:10px;padding:12px;border:2px solid var(--line);border-radius:10px;background:var(--bg-3);display:grid;grid-template-columns:repeat(4,1fr);text-align:center;gap:8px}.dfl-final b{display:block;font-size:18px;margin-top:2px}.dfl-score-help{padding:0 12px 10px;font-size:10px;color:var(--muted)}
/* On a wide screen the slack goes to the hole column, not the label - one
   centred word floating in 400px of empty column looks like a mistake. */
@media(min-width:700px){.dfl-hole-grid{grid-template-columns:minmax(76px,1fr) 44px 148px 100px}.dfl-nine,.dfl-final,.dfl-strip{margin:12px 14px}.ovm{width:26px;height:26px;font-size:13px}.dfl-hole-grid .result{font-size:14px}}
@media(max-width:520px){.dfl-final{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){.dfl-team-head{padding:12px}
.dfl-hole-grid{grid-template-columns:58px 28px 124px minmax(0,1fr)}
.dfl-hole-grid>div{min-height:48px;padding:5px 4px}
.sbtn{width:34px;flex:0 0 34px;height:40px;font-size:19px}
.dfl-hole-grid .score{gap:3px}
.dfl-hole-grid input,.mark input{width:40px;height:40px;font-size:18px}
.dfl-hole-grid .result{font-size:12.5px;letter-spacing:0}
.dfl-strip-tbl th.lbl{width:34px;padding-left:8px}.dfl-strip-tbl .sub{width:30px}.ovm{width:22px;height:22px;font-size:11px}
.dfl-score-help{font-size:9px;padding-bottom:12px}}
/* An SE-sized phone: 232px of grid to divide. Everything gives up a few px so
   the label still gets ~60 and DOUBLE fits without shearing. */
@media(max-width:359px){.dfl-hole-grid{grid-template-columns:44px 20px 106px minmax(0,1fr)}
.sbtn{width:30px;flex:0 0 30px;height:38px;font-size:18px}
.dfl-hole-grid input,.mark input{width:36px;height:38px;font-size:17px}
.dfl-hole-grid .result{font-size:11.5px}.hole .yards{font-size:11px}.hole-n{font-size:15px}}`;
document.head.appendChild(s);}
async function fetchCard(outingId,teamId){const [team,parts,holes,scores,outing,members]=await Promise.all([db().from("golf_teams").select("*").eq("id",teamId).eq("outing_id",outingId).maybeSingle(),db().from("golf_participants").select("id,member_id,team_id").eq("outing_id",outingId).eq("team_id",teamId).order("sort_order"),db().from("golf_holes").select("hole,par").eq("outing_id",outingId).order("hole"),db().from("golf_scores").select("id,outing_id,team_id,hole,strokes").eq("outing_id",outingId).eq("team_id",teamId),db().from("golf_outings").select("id,course_id,course,holes").eq("id",outingId).maybeSingle(),loadMembers().catch(()=>[])]);const error=team.error||parts.error||holes.error||scores.error||outing.error;if(error)throw error;let courseHoles=[];const courseId=outing.data?.course_id;if(courseId){const ch=await db().from("golf_course_holes").select("hole,yardage_men,yardage_women,par,handicap").eq("course_id",courseId).order("hole");if(!ch.error)courseHoles=ch.data||[];}return{team:team.data,parts:parts.data||[],holes:holes.data||[],scores:scores.data||[],outing:outing.data,members:members||[],courseHoles};}

/*
  The card from the network if it can be had, and from this device if not.

  A scorecard opened in a dead zone used to be an error page, which is the
  worst possible moment for one - you are standing on a tee with a score to
  write down. The last good copy is kept on the device, so out of signal you
  get the round as you last saw it and can carry on scoring into the queue.
*/
async function loadCard(outingId,teamId){
  try{
    const card=await fetchCard(outingId,teamId);
    cacheCard(outingId,teamId,card);
    return {...card,stale:false};
  }catch(err){
    const cached=cachedCard(outingId,teamId);
    if(!cached)throw err;
    return {...cached,stale:true};
  }
}

/*
  Server rows with the queue laid over the top. Anything waiting to be sent
  is newer than what came back from Supabase by definition, so it wins - and
  a queued clear (null) removes the hole rather than reading as a zero.
*/
function scoreMap(scores,pending){const map=new Map(scores.map(s=>[Number(s.hole),s]));
if(pending)for(const [hole,strokes] of pending){if(strokes==null)map.delete(hole);else map.set(hole,{...(map.get(hole)||{}),hole,strokes});}
return map;}
function total(map,start,end){let t=0;for(let h=start;h<=end;h++)t+=num(map.get(h)?.strokes);return t;}
/*
  Which hole of the COURSE hole h is.

  A 9-hole course played twice stores the second lap as 10-18, so hole 12 is
  the 3rd tee and takes its par and yardage. This used to wrap unconditionally,
  which was harmless while every round was a nine played twice - and became a
  real bug the moment rounds could be 18, because on an actual 18-hole course
  it would have given hole 12 the 3rd's par. Only wrap when the course really
  is nine holes.
*/
export function courseHole(holes,h){return (holes?.length&&holes.length<=9&&h>9)?h-9:h}
/** True when this course is being played round twice. */
export function wrapsAround(holes){return !!(holes?.length&&holes.length<=9)}
export function holePar(holes,h){const n=courseHole(holes,h);return Number(holes.find(x=>Number(x.hole)===n)?.par)||4}
export function holeYards(courseHoles,h){const n=courseHole(courseHoles,h);return Number(courseHoles.find(x=>Number(x.hole)===n)?.yardage_men)||Number(courseHoles.find(x=>Number(x.hole)===n)?.yardage_women)||0}
function playedPar(map,holes,start,end){let p=0;for(let h=start;h<=end;h++)if(map.has(h))p+=holePar(holes,h);return p}
function thruCount(map,start,end){let n=0;for(let h=start;h<=end;h++)if(num(map.get(h)?.strokes))n++;return n}

/*
  Where you stand, pinned under the header while you scroll.

  Standing on hole 7 you want to know you are +3 through 6 - and until this
  bar existed that number lived at the very bottom of a card 2.2 screens
  tall, so the one figure the round is about was the one figure never on
  screen while scoring. It sticks below the fixed topbar and costs no
  layout: it replaces nothing and pushes nothing aside.
*/
function liveBar(map,holes,holeCount){const thru=thruCount(map,1,holeCount),strokes=total(map,1,holeCount),par=playedPar(map,holes,1,holeCount);
return `<div class="dfl-live"><span class="dfl-live-cell"><small>Thru</small><b data-live-thru>${thru||"—"}</b></span><span class="dfl-live-cell"><small>+/−</small><b class="dfl-live-topar" data-live-topar>${fmtToPar(strokes,par)}</b></span><span class="dfl-live-cell"><small>Strokes</small><b data-live-strokes>${strokes||"—"}</b></span></div>`}

/*
  The strip. Nine columns of a nine, so it never needs to scroll on a phone,
  and the score sits in the same mark it wears in its row. Tapping a hole
  jumps to that row rather than trying to be a second place to score - one
  place to type is the whole reason the rows exist.
*/
function stripNine(label,start,holes,map){const nums=Array.from({length:9},(_,i)=>start+i),par=nums.reduce((a,h)=>a+holePar(holes,h),0),score=total(map,start,start+8);
return `<table class="dfl-strip-tbl"><tr class="row-h"><th class="lbl">Hole</th>${nums.map(h=>`<td>${h}</td>`).join("")}<td class="sub">${label}</td></tr>
<tr class="row-p"><th class="lbl">Par</th>${nums.map(h=>`<td>${holePar(holes,h)}</td>`).join("")}<td class="sub">${par}</td></tr>
<tr class="row-s"><th class="lbl">Score</th>${nums.map(h=>{const v=num(map.get(h)?.strokes),r=holeResult(v,holePar(holes,h));return `<td data-ov-hole="${h}"><span class="ovm ${r.mark}" data-ov-mark="${h}">${v||"·"}</span></td>`}).join("")}<td class="sub" data-ov-sub="${start}">${score||"—"}</td></tr></table>`}

function strip(holes,map,holeCount=18){return `<section class="dfl-strip"><header class="dfl-strip-title"><span>Scorecard</span><span>Tap a hole to jump to it</span></header><div class="dfl-strip-scroll">${stripNine("OUT",1,holes,map)}${holeCount>9?stripNine("IN",10,holes,map):""}</div></section>`}

/*
  One hole, one row: hole and its yardage in one column, par, the strokes,
  the result.

  Yardage rides UNDER the hole number as its caption rather than in a column
  of its own - you read "hole 3, 413 yards" as one fact, and the ~46px that
  buys hands the result label a readable size. It was 9.5px, the smallest
  type on a card that gets read outdoors in the sun.

  No per-nine tally and no "Par 36" in the header: the strip at the top of
  the card carries OUT, IN and the pars, and the sticky bar carries the
  running total. Printing them a third time only made the card longer.
*/
function nine(title,start,holes,courseHoles,map,editable){const holeNums=Array.from({length:9},(_,i)=>start+i),
/* A 9-hole course played twice stores the second lap as holes 10-18, so the
   card says 12 while you are standing on the 3rd tee looking at the 3rd
   tee's yardage. Name the hole you are actually playing. */
repeats=holes.length>0&&holes.length<=9,
rows=holeNums.map(h=>{const p=holePar(holes,h),yards=holeYards(courseHoles,h),v=map.get(h)?.strokes??"",r=holeResult(v,p),again=repeats&&h>9?`<span class="hole-again">(${courseHole(holes,h)})</span>`:"";return `<div class="hole" data-score-hole-row="${h}"><span class="hole-n">${h}${again}</span><span class="yards">${yards?`${yards} yd`:"—"}</span></div><div class="par">${p}</div><div class="score">${editable?`<button type="button" class="sbtn" data-step="-1" data-hole="${h}" aria-label="One fewer on hole ${h}">−</button>`:""}<span class="mark ${r.mark}" data-mark="${h}"><input data-team-score data-hole="${h}" data-par="${p}" type="text" pattern="[0-9]*" inputmode="numeric" enterkeyhint="done" autocomplete="off" placeholder="—" value="${esc(v)}" maxlength="2" ${editable?"":"disabled"} aria-label="Strokes hole ${h}"></span>${editable?`<button type="button" class="sbtn" data-step="1" data-hole="${h}" aria-label="One more on hole ${h}">+</button>`:""}</div><div class="result ${r.cls}" data-result="${h}">${r.label}</div>`}).join("");return `<section class="dfl-nine"><header class="dfl-nine-title"><strong>${title}</strong></header><div class="dfl-hole-grid"><div class="hdr">Hole</div><div class="hdr">Par</div><div class="hdr">Strokes</div><div class="hdr">Result</div>${rows}</div></section>`}

/*
  Every number on the card recomputed from the inputs, in the DOM, without a
  round trip. A stroke changes the mark, the word, the strip, the nine's
  tally and the final score at once - waiting on Supabase to see the effect
  of your own tap is what makes an app feel broken.
*/
function recalc(root){const inputs=[...root.querySelectorAll("input[data-team-score]")],val=new Map(),par=new Map();
for(const i of inputs){const h=Number(i.dataset.hole),p=Number(i.dataset.par)||4,v=Number(i.value);par.set(h,p);val.set(h,Number.isFinite(v)&&v>0?v:0);
const r=holeResult(val.get(h),p);
const mark=root.querySelector(`[data-mark="${h}"]`);if(mark)mark.className="mark "+r.mark;
const res=root.querySelector(`[data-result="${h}"]`);if(res){res.textContent=r.label;res.className="result "+r.cls}
const ov=root.querySelector(`[data-ov-mark="${h}"]`);if(ov){ov.textContent=val.get(h)||"·";ov.className="ovm "+r.mark}}
const range=(a,b)=>{let s=0,p=0,n=0;for(let h=a;h<=b;h++){const v=val.get(h)||0;if(!v)continue;s+=v;p+=par.get(h)||0;n++}return{s,p,n}};
// OUT and IN live in the strip now - the per-nine tally blocks are gone.
for(const start of [1,10]){const {s}=range(start,start+8);
const sub=root.querySelector(`[data-ov-sub="${start}"]`);if(sub)sub.textContent=s||"—"}
const all=range(1,18);
const front=range(1,9),back=range(10,18);
const ff=root.querySelector("[data-final-front]");if(ff)ff.textContent=front.s||"—";
const fb=root.querySelector("[data-final-back]");if(fb)fb.textContent=back.s||"—";
const fs=root.querySelector("[data-final-score]");if(fs)fs.textContent=all.s||"—";
const ft=root.querySelector("[data-final-topar]");if(ft)ft.textContent=fmtToPar(all.s,all.p);
const lt=root.querySelector("[data-live-thru]");if(lt)lt.textContent=all.n||"—";
const lp=root.querySelector("[data-live-topar]");if(lp)lp.textContent=fmtToPar(all.s,all.p);
const ls=root.querySelector("[data-live-strokes]");if(ls)ls.textContent=all.s||"—"}

/*
  What the server has, said in the line that promises the card saves itself -
  because that promise is exactly what a dead zone breaks, and a silent
  failure is what used to cost holes.
*/
function syncLine(outingId,teamId,editable,stale){
  if(!editable)return "Read-only — this team's players and admins can edit. Playing today? Enter the event code on the event page.";
  /* A REFUSAL OUTRANKS EVERYTHING. It is the only one of these states where
     a stroke is gone rather than on its way, so it is said first and it names
     the hole - somebody has to walk back and re-enter it. */
  const bad=refusals(outingId).filter(f=>f.teamId===String(teamId));
  if(bad.length){
    const holes=[...new Set(bad.map(f=>f.hole))].sort((a,b)=>a-b);
    return `<b class="dfl-sync-fail">Hole${holes.length===1?"":"s"} ${holes.join(", ")} ${holes.length===1?"was":"were"} not saved</b> — the database refused ${holes.length===1?"it":"them"}. Enter ${holes.length===1?"it":"them"} again. <span class="dfl-sync-why">${esc(bad[bad.length-1].message)}</span>`;
  }
  const waiting=pendingCount(outingId,teamId);
  if(waiting)return `<b class="dfl-sync-wait">${waiting} hole${waiting===1?"":"s"} not saved yet</b> — kept on this phone, sent the moment you have signal.`;
  if(stale)return "Showing the last copy saved on this phone — it will refresh when you have signal.";
  return "Tap − and + to add strokes, or type the number.";
}

/* One watcher at a time: a re-render replaces the line it was painting. */
let stopWatch=null;
function watchSync(root,outingId,teamId,editable,stale){
  stopWatch?.();
  const paint=()=>{const node=root.querySelector("[data-sync-status]");if(!node){stopWatch?.();return}node.innerHTML=syncLine(outingId,teamId,editable,stale)};
  const off=onQueueChange(paint);
  addEventListener("online",paint);addEventListener("offline",paint);
  stopWatch=()=>{off();removeEventListener("online",paint);removeEventListener("offline",paint);stopWatch=null};
  paint();
  /* Opening the card is as good a moment as any to try the backlog again. */
  flush();
}

async function clearScorecard(outingId,teamId){if(!isAdmin())throw Error("Admin access required");
/* The queue goes first. A stroke still waiting to be sent would otherwise go
   out after the delete and refill the card a moment after it was wiped. */
dropPending(outingId,teamId);
const {error}=await db().from("golf_scores").delete().eq("outing_id",outingId).eq("team_id",teamId);if(error)throw error;
dropCachedCard(outingId,teamId)}
async function render(root,outingId,teamId){styles();const c=await loadCard(outingId,teamId);if(!c.team)throw Error("Team not found");const me=String(currentMember()?.id||"");/* A guest signed in to THIS event, whose participant sits on THIS team,
   may keep this card. Postgres decides for real; this only opens the boxes. */
const pass=passFor(outingId),guestHere=!!pass&&String(pass.teamId)===String(teamId);
const admin=isAdmin(),editable=admin||guestHere||c.parts.some(p=>String(p.member_id)===me),map=scoreMap(c.scores,pendingFor(outingId,teamId)),front=total(map,1,9),back=total(map,10,18),played=playedPar(map,c.holes,1,18),complete=front+back,names=c.parts.map(p=>c.members.find(m=>String(m.id)===String(p.member_id))?.display_name||"Unknown");root.innerHTML=`<section class="card dfl-team-card"><header class="dfl-team-head"><div class="dfl-team-head-top"><a class="backlink" href="#/golf?id=${outingId}">← Teams</a><div><span class="dfl-team-kicker">TEAM SCORECARD</span><h2>${esc(c.team.name||"Team")}</h2></div></div><div class="dfl-team-roster">${names.map(n=>`<span>${esc(n)}</span>`).join("")}</div></header>${liveBar(map,c.holes,18)}<div class="dfl-score-status" data-sync-status>${syncLine(outingId,teamId,editable,c.stale)}</div>${admin?`<div class="dfl-admin-actions"><button type="button" class="dfl-clear-scorecard" data-clear-scorecard>Clear Scorecard</button></div>`:""}${strip(c.holes,map)}${nine("Front 9",1,c.holes,c.courseHoles,map,editable)}${nine("Back 9 · second time around",10,c.holes,c.courseHoles,map,editable)}<div class="dfl-final"><div><small>Front 9</small><b data-final-front>${front||"—"}</b></div><div><small>Back 9</small><b data-final-back>${back||"—"}</b></div><div><small>+/−</small><b data-final-topar>${fmtToPar(complete,played)}</b></div><div><small>Total 18</small><b data-final-score>${complete||"—"}</b></div></div><div class="dfl-score-help">Circles are under par, squares are over — a double ring means by two or more. Course yardage comes from the selected course; Rolla is a 9-hole course, so the Back 9 repeats holes 1–9.</div></section>`;wire(root,outingId,teamId,editable);watchSync(root,outingId,teamId,editable,c.stale);if(admin){const clear=root.querySelector("[data-clear-scorecard]");clear?.addEventListener("click",async()=>{if(!confirm(`Clear every stroke for ${c.team.name||"this team"}? This cannot be undone.`))return;clear.disabled=true;try{await clearScorecard(outingId,teamId);await render(root,outingId,teamId)}catch(err){clear.disabled=false;alert(err.message||"Could not clear scorecard")}})}}
/*
  One timer per hole. Tapping + four times queues 4, not 1,2,3,4 - and the
  value is read when the timer fires so the last tap always wins.

  The stroke goes into the queue on this device and the network is somebody
  else's problem (golf-offline.js). Nothing here re-renders the card on a
  failure: re-rendering is what used to wipe out the number you had just
  typed the moment a save failed, which on a course with no bars is every
  save. A queued stroke shows in the status line until it lands.
*/
const timers=new Map();
function queueSave(root,outingId,teamId,input){const hole=Number(input.dataset.hole),key=`${teamId}:${hole}`;clearTimeout(timers.get(key));timers.set(key,setTimeout(()=>{timers.delete(key);
try{queueScore(outingId,teamId,hole,input.value.trim())}
/* Only a value the field itself should have prevented gets here. Say so and
   leave what was typed alone - it is still on screen to be corrected. */
catch(err){alert(err.message||"Could not save team score")}},SAVE_DELAY))}

export function wireScorecardControls(root,editable,onScoreChange){if(!editable||root.dataset.scoreWire==="1")return;root.dataset.scoreWire="1";
// The strip is a jump list, not a second place to score.
root.addEventListener("click",e=>{const jump=e.target.closest("[data-ov-hole]");if(!jump)return;const row=root.querySelector(`[data-score-hole-row="${jump.dataset.ovHole}"]`);if(!row)return;row.scrollIntoView({block:"center",behavior:"smooth"});root.querySelectorAll(".dfl-hole-grid .is-now").forEach(el=>el.classList.remove("is-now"));row.classList.add("is-now")});
/*
  The first tap on an empty hole lands on PAR, not on 1. Par is the score
  entered most often, so it is one tap instead of four - and from there the
  buttons do exactly what they look like.
*/
root.addEventListener("click",e=>{const btn=e.target.closest("[data-step]");if(!btn)return;const input=root.querySelector(`input[data-team-score][data-hole="${btn.dataset.hole}"]`);if(!input)return;const par=Number(input.dataset.par)||4,now=Number(input.value);input.value=String(!Number.isFinite(now)||now<1?par:Math.max(MIN_STROKES,Math.min(MAX_STROKES,now+Number(btn.dataset.step))));recalc(root);onScoreChange?.(input)});
/* Typing: digits only, so a stray letter can never become a save that fails.
   Leading zeros go too - "0" is not a score, and stripping it here means a
   half-typed field clears the hole instead of becoming a value the queue has
   to reject. */
root.addEventListener("input",e=>{const input=e.target.closest("input[data-team-score]");if(!input)return;const clean=input.value.replace(/\D/g,"").replace(/^0+/,"").slice(0,2);if(clean!==input.value)input.value=clean;if(Number(clean)>MAX_STROKES)input.value=String(MAX_STROKES);recalc(root);onScoreChange?.(input)});
root.addEventListener("keydown",e=>{const input=e.target.closest("input[data-team-score]");if(!input||e.key!=="Enter")return;e.preventDefault();input.blur()})}
function wire(root,outingId,teamId,editable){wireScorecardControls(root,editable,input=>queueSave(root,outingId,teamId,input))}
export {styles as ensureScorecardStyles,liveBar as scorecardLiveBar,strip as scorecardStrip,nine as scorecardNine,recalc as recalcScorecard};
function boot(){styles();const run=()=>{const root=document.querySelector("#golf-outing"),q=new URLSearchParams(location.hash.split("?")[1]||""),outingId=q.get("id"),teamId=q.get("team");if(!root||!outingId||!teamId||!root.querySelector(".golf-scorecard-page"))return;render(root,outingId,teamId).catch(err=>{root.innerHTML=`<div class="card"><div class="card-body"><strong>Could not load team scorecard.</strong><p class="muted">${esc(err.message)}</p></div></div>`})};new MutationObserver(run).observe(document.body,{childList:true,subtree:true});run()}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();

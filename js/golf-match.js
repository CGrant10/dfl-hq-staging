/* =====================================================================
   golf-match.js - one match of one round, both sides on one card
   ---------------------------------------------------------------------
   The side is what gets scored here, not the team of six: one ball per
   side, so one number per side per hole. In rounds 1 and 2 a side is a
   pair; in round 3 it is one player. The card does not care which - it
   draws whatever names are on the side - which is why the singles nine
   needed no second screen.

   Both sides share the card on purpose. Four people walking the same hole
   are not going to open two apps, and whoever is holding the phone on the
   green writes down both numbers. Two further reasons it has to work this
   way: a guest has no member id at all, so a "your own side only" rule
   would leave their card unscoreable, and the database enforces the same
   thing (golf_matches_schema.sql).

   A ROUND IS NINE HOLES, and the card takes that count from the round
   rather than assuming it. Measuring a nine against 18 would never award
   its point; measuring 18 against 9 would award it at the turn.

   THE SCORING COMES FROM THE ROUND TOO - stroke play or match play. Same
   strokes either way; the difference is what they add up to, so match play
   gains the running UP/DN row a paper card carries and an outcome that can
   arrive on the 7th hole (3&2) instead of the 9th.

   ONE HOLE, ONE BLOCK
     head       the hole, its yardage, its par
     two rows   each side, its strokes, what the hole was worth to them

   The number IS the mark, exactly as on the team card - a round field for a
   birdie, a square one for a bogey - and the vocabulary is imported from
   golf-scorecard.js rather than copied, so the two cards can never end up
   calling the same score different things.

   Strokes go through the same offline queue as everything else: typed
   first, sent when the course has signal. See golf-offline.js.
   ===================================================================== */
import { db, isAdmin } from "./supabase.js";
import { currentMember, loadMembers } from "./members.js";
import { esc, toast } from "./ui.js";
import { passFor } from "./golf-guest.js";
import { holeResult, fmtToPar, holePar, holeYards, courseHole, wrapsAround } from "./golf-scorecard.js";
import { SCORING_NAMES, battleResult, standingLine, marginLabel, roundHoles,
         pairName } from "./golf-battle.js";
import { memberNames, playerName } from "./golf-people.js";
import { teamInk } from "./brand-ink.js";
import { individualMatchLabel, individualResult, individualStanding } from "./golf-individual.js";
import { queueSideScore, pendingForSide, pendingCountSides, dropPendingSides,
         onQueueChange, cacheMatch, cachedMatch, dropCachedMatch, flush, refusals,
         MIN_STROKES, MAX_STROKES } from "./golf-offline.js";

const SAVE_DELAY = 600;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const holeCount = (card) => roundHoles(card.round);
const scoringOf = (card) => (card.round?.scoring === "match" ? "match" : "strokes");
const INDIVIDUAL_INK = ["#f4c430", "#c73a33", "#f3efe2", "#171717", "#5f7f55", "#d98935"];
const isIndividual = (card) => card.sides.length > 2 || card.sides.some((side) => side.team_id == null);
const resultFor = (card, maps) => isIndividual(card)
  ? individualResult(maps, holeCount(card))
  : battleResult(maps[0], maps[1], holeCount(card), scoringOf(card));

/*
  Match play, hole by hole, from side 1's point of view - the running state a
  paper match-play card carries down its middle. Only holes both sides have
  posted move it, so a card being caught up at the turn does not read as a
  collapse.
*/
function running(maps, holes) {
  const state = new Map();
  let up = 0;
  for (let h = 1; h <= holes; h++) {
    const x = num(maps[0].get(h)), y = num(maps[1].get(h));
    if (!x || !y) continue;
    if (x < y) up++; else if (y < x) up--;
    state.set(h, up);
  }
  return state;
}
const upLabel = (v) => (v === 0 ? "AS" : `${Math.abs(v)}${v > 0 ? "UP" : "DN"}`);

function styles() {
  if (document.getElementById("dfl-battle-style")) return;
  const s = document.createElement("style");
  s.id = "dfl-battle-style";
  s.textContent = `
.dfl-battle-card{overflow:hidden;overflow:clip}
.dfl-battle-head{padding:14px;border-bottom:1px solid var(--line);background:var(--bg-3);border-radius:13px 13px 0 0}
.dfl-battle-head-top{display:flex;align-items:center;gap:10px}
.dfl-battle-kicker{font-size:9px;letter-spacing:.14em;font-weight:900;color:var(--accent);display:block;margin-bottom:2px}
.dfl-battle-head h2{margin:0;font-size:19px}

/* ---- where the match stands: two rows and a line, no promo ----
   The figure has its OWN column. It never sits above a name, which is how
   a level match used to print "AS" where a surname goes. */
.dfl-battle-state{padding:11px 14px;border-bottom:1px solid var(--line)}
.gm-sides{display:grid;gap:4px}
.gm-side{display:grid;grid-template-columns:9px minmax(0,1fr) auto;align-items:center;gap:9px;padding:5px 0}
.gm-dot{width:9px;height:9px;border-radius:50%;background:var(--racer,var(--accent))}
.gm-who{min-width:0;display:grid;gap:1px}
.gm-who b{font-size:15px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gm-who small{font-size:9.5px;font-weight:900;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gm-fig{display:grid;justify-items:end;gap:1px;font-size:20px;font-weight:950;font-variant-numeric:tabular-nums;color:var(--muted);white-space:nowrap}
.gm-fig small{font-size:9.5px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.gm-side.is-up .gm-fig{color:var(--accent)}
.gm-vs{font-size:9px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);padding-left:18px}
.gm-stand{margin-top:9px;padding-top:9px;border-top:1px solid var(--line-soft);font-size:12.5px;font-weight:900;color:var(--muted)}
.gm-stand.is-done{color:var(--accent)}

/* Same perch as the team card's bar: under the fixed 56px topbar. */
.dfl-battle-live{position:sticky;top:calc(57px + env(safe-area-inset-top));z-index:5;display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:var(--line);border-bottom:1px solid var(--line);box-shadow:0 6px 14px rgba(0,0,0,.28)}
.dfl-battle-live span{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:7px 6px;background:var(--bg-3);min-width:0}
.dfl-battle-live small{font-size:8.5px;text-transform:uppercase;letter-spacing:.1em;font-weight:900;color:var(--muted)}
.dfl-battle-live b{font-size:15px;font-weight:950;line-height:1.15;text-align:center;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dfl-battle-standing{color:var(--accent)}
@media (max-height:480px) and (orientation:landscape) and (max-width:899px){.dfl-battle-live{top:calc(49px + env(safe-area-inset-top))}}

.dfl-battle-status{padding:8px 14px;font-size:11px;color:var(--muted);border-bottom:1px solid var(--line)}
.dfl-battle-wait{color:var(--sc-over);font-weight:900}
.dfl-battle-status:has(.dfl-battle-fail){background:var(--danger-bg)}
.dfl-battle-fail{color:var(--danger-ink);font-weight:900}
.dfl-battle-why{display:block;color:var(--muted)}
.dfl-battle-admin{display:flex;justify-content:flex-end;padding:8px 10px;border-bottom:1px solid var(--line)}
.dfl-battle-clear{border:1px solid var(--danger-line);border-radius:8px;padding:7px 10px;background:var(--danger-bg);color:var(--danger-ink);font-weight:900;font-size:11px}

/* ---- the paper card: hole, par, a row per side ---- */
.dfl-battle-strip{margin:10px;border:1px solid var(--line);border-radius:10px;background:var(--bg-2);overflow:hidden}
.dfl-battle-strip-title{display:flex;justify-content:space-between;gap:8px;padding:9px 12px;background:var(--bg-3);border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:900;color:var(--muted)}
.dfl-battle-tbl{border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed;font-variant-numeric:tabular-nums}
.dfl-battle-tbl th,.dfl-battle-tbl td{padding:0;height:27px;text-align:center;border-bottom:1px solid var(--line-soft);font-size:11px;font-weight:800}
.dfl-battle-tbl th.lbl{width:56px;text-align:left;padding-left:10px;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.05em;border-right:1px solid var(--line);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dfl-battle-tbl .row-h td{background:var(--bg-3);color:var(--muted);font-size:10px}
.dfl-battle-tbl .row-p td{color:var(--muted);font-size:10px;height:23px}
/* "2UP" has to fit a ~29px column on a 375px phone, so it runs smaller than
   the strokes above it - and reads as a state rather than a score. */
.dfl-battle-tbl .row-m td{font-size:9.5px;font-weight:900;color:var(--accent);height:24px}
.dfl-battle-tbl .row-m th.lbl{color:var(--accent)}
.dfl-battle-tbl .sub{border-left:1px solid var(--line);background:var(--hover-soft);width:34px}
.dfl-battle-tbl tr:last-child td,.dfl-battle-tbl tr:last-child th{border-bottom:0}
.dfl-battle-tbl td[data-jump]{cursor:pointer}
.dfl-battle-tbl .won{color:var(--sc-under)}

/* ---- one hole, one block, a row per side ---- */
.dfl-holes{margin:10px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--bg-2)}
.bh+.bh{border-top:1px solid var(--line)}
.bh-head{display:flex;align-items:baseline;gap:8px;padding:5px 10px;background:var(--bg-3);font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:900}
.bh-head b{font-size:15px;color:var(--text);font-variant-numeric:tabular-nums}
.bh-head .again{font-weight:800;color:var(--muted);font-size:11px}
.bh-head .par{margin-left:auto}
/* minmax(0,1fr) on the name, never a bare 1fr: a long pair of names must be
   allowed to ellipsis rather than shove the input off the card. */
.bh-row{display:grid;grid-template-columns:minmax(0,1fr) auto 60px;align-items:center;gap:6px;padding:6px 10px;min-height:52px}
.bh-row+.bh-row{border-top:1px solid var(--line-soft)}
.bh-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:800}
.bh-name i{display:block;font-style:normal;font-size:9px;font-weight:900;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.bh-entry{display:flex;align-items:center;gap:5px}
.bh-res{font-size:10.5px;font-weight:900;text-align:center;letter-spacing:.02em}
.bh-row.is-low{background:rgba(47,191,95,.07)}
.dfl-battle-final{margin:10px;padding:12px;border:2px solid var(--line);border-radius:10px;background:var(--bg-3);display:grid;gap:8px}
.dfl-battle-final-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:baseline}
.dfl-battle-final-row b{font-size:18px;font-variant-numeric:tabular-nums}
.dfl-battle-final-row small{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:900}
.dfl-battle-outcome{margin:0 10px 10px;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg-2);font-size:12.5px;font-weight:900;text-align:center}
.dfl-battle-help{padding:0 12px 12px;font-size:10px;color:var(--muted)}
@media(max-width:359px){.bh-row{grid-template-columns:minmax(0,1fr) auto 52px;padding:6px 7px}.bh-res{font-size:9.5px}.dfl-battle-tbl th.lbl{width:46px;padding-left:7px}}`;
  document.head.appendChild(s);
}

// ------------------------------------------------------------------- data

async function fetchMatch(matchId) {
  const m = await db().from("golf_matches").select("id,outing_id,match_number,round_id")
    .eq("id", matchId).maybeSingle();
  if (m.error) throw m.error;
  if (!m.data) throw new Error("Match not found");
  const outingId = m.data.outing_id;

  const [sidesRes, roundRes] = await Promise.all([
    db().from("golf_match_sides").select("id,team_id,slot").eq("match_id", matchId).order("slot"),
    m.data.round_id
      ? db().from("golf_rounds").select("id,round_number,name,format,holes,scoring").eq("id", m.data.round_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (sidesRes.error) throw sidesRes.error;
  const sides = sidesRes.data || [];
  const sideIds = sides.map((s) => s.id);
  const none = { data: [], error: null };

  const [playersRes, scoresRes, teamsRes, holesRes, partsRes, outingRes, members] = await Promise.all([
    sideIds.length ? db().from("golf_match_players").select("id,side_id,participant_id").in("side_id", sideIds) : none,
    sideIds.length ? db().from("golf_match_scores").select("side_id,hole,strokes").in("side_id", sideIds) : none,
    db().from("golf_teams").select("id,name,color").eq("outing_id", outingId),
    db().from("golf_holes").select("hole,par").eq("outing_id", outingId).order("hole"),
    db().from("golf_participants").select("id,member_id,guest_name,team_id").eq("outing_id", outingId),
    db().from("golf_outings").select("id,name,course_id").eq("id", outingId).maybeSingle(),
    loadMembers().catch(() => []),
  ]);
  const err = playersRes.error || scoresRes.error || teamsRes.error || holesRes.error
           || partsRes.error || outingRes.error;
  if (err) throw err;

  let courseHoles = [];
  const courseId = outingRes.data?.course_id;
  if (courseId) {
    const ch = await db().from("golf_course_holes")
      .select("hole,par,yardage_men,yardage_women").eq("course_id", courseId).order("hole");
    if (!ch.error) courseHoles = ch.data || [];
  }

  const names = memberNames(members);
  const byPart = new Map((partsRes.data || []).map((p) => [String(p.id), p]));
  const teamById = new Map((teamsRes.data || []).map((t) => [String(t.id), t]));

  /* Scores as a plain object, not a Map: this payload gets cached as JSON so
     the card still opens out of signal, and a Map serialises to {}. */
  const scores = {};
  for (const row of scoresRes.data || []) {
    (scores[String(row.side_id)] ||= {})[Number(row.hole)] = Number(row.strokes);
  }

  return {
    match: m.data,
    round: roundRes?.data || null,
    outing: outingRes.data,
    holes: holesRes.data || [],
    courseHoles,
    scores,
    sides: sides.map((s, i) => {
      const mine = (playersRes.data || []).filter((p) => String(p.side_id) === String(s.id));
      const team = teamById.get(String(s.team_id));
      return {
        id: s.id, team_id: s.team_id, slot: Number(s.slot),
        teamName: team?.name || (s.team_id == null ? "Individual" : "Team"),
        color: team ? teamInk(team.color, team.sort_order ?? i) : INDIVIDUAL_INK[i % INDIVIDUAL_INK.length],
        players: mine.map((p) => {
          const part = byPart.get(String(p.participant_id));
          return {
            participant_id: p.participant_id,
            member_id: part?.member_id ?? null,
            name: playerName(part, names),
          };
        }),
      };
    }),
  };
}

async function loadMatch(matchId) {
  try {
    const card = await fetchMatch(matchId);
    cacheMatch(matchId, card);
    return { ...card, stale: false };
  } catch (err) {
    const cached = cachedMatch(matchId);
    if (!cached) throw err;
    return { ...cached, stale: true };
  }
}

/* Server rows with this device's queue over the top, same rule as the team
   card: anything still waiting to be sent is newer than what came back. */
function strokeMap(card, sideId) {
  const map = new Map(Object.entries(card.scores?.[String(sideId)] || {})
    .map(([hole, strokes]) => [Number(hole), Number(strokes)]));
  for (const [hole, strokes] of pendingForSide(sideId)) {
    if (strokes == null) map.delete(hole); else map.set(hole, strokes);
  }
  return map;
}

// ------------------------------------------------------------------ views

/*
  WHERE THE MATCH STANDS.

  This was the broadcast marquee - the same fight-poster block the Arena
  uses - and it billed one 2v2 of one nine like a title fight. Two things
  were wrong with that, and the first is the reason this file changed:

  THE MARQUEE STACKS EACH SIDE'S FIGURE DIRECTLY ABOVE ITS NAME. With the
  match level, sideFigure() handed it "AS" for BOTH sides, so the card read

      AS            AS
      Brando   vs   Cim Cim

  "AS" is the state of the match. It is not part of anybody's name, and it
  cannot be, because it was the same word on both sides. Fixed twice over:
  the figure now sits in its own column beside the name rather than on top
  of it, and a level match gives both sides a dash and says "All square
  thru 4" once, underneath, in words - which is what standingLine() has
  always returned and is perfectly good match-play English.

  The second thing: a match is a DETAIL screen. It answers who is playing,
  which team they are on, where it stands, what each hole did, and who won.
  The promotion belongs to the event - the tournament board and the team
  sheet - not to one nine. So this is quiet: two rows and a line.

  Nothing here computes a score. r is the battleResult the card was already
  drawn from.
*/
function matchState(card, names, r, scoring) {
  if (isIndividual(card)) {
    return `<div class="gm-sides">${card.sides.map((side, i) => {
      const score = r.sides[i];
      return `<div class="gm-side ${r.leaders.includes(i) ? "is-up" : ""}" style="--racer:${esc(side.color || "")}">
        <i class="gm-dot"></i><span class="gm-who"><b>${esc(names[i])}</b><small>Individual</small></span>
        <span class="gm-fig">${score?.total || "—"}<small>${score?.posted ? `thru ${score.posted}` : "not started"}</small></span>
      </div>`;
    }).join("")}</div><div class="gm-stand ${r.complete ? "is-done" : ""}">${esc(individualStanding(r, names))}</div>`;
  }
  const lead = scoring === "match" ? (r.up || 0) : (r.lead || 0);
  // r.diff < 0 means slot 1 is ahead - the same test standingLine() uses.
  const leader = !lead ? -1 : (r.diff < 0 ? 0 : 1);
  return `<div class="gm-sides">${card.sides.map((side, i) => `
      <div class="gm-side ${leader === i ? "is-up" : ""}" style="--racer:${esc(side.color || "")}">
        <i class="gm-dot"></i>
        <span class="gm-who"><b>${esc(names[i])}</b><small>${esc(side.teamName)}</small></span>
        <span class="gm-fig">${esc(sideFigure(r, i, scoring))}${
          strokeAside(r, i, scoring) ? `<small>${esc(strokeAside(r, i, scoring))}</small>` : ""
        }</span>
      </div>`).join(`<div class="gm-vs">vs</div>`)}</div>
    <div class="gm-stand ${r.complete ? "is-done" : ""}">${esc(standingLine(r, names[0], names[1]))}</div>`;
}

/*
  WHAT NUMBER GOES BESIDE EACH SIDE.

  STROKE PLAY SHOWS THE STROKES, WHICH IT WAS NOT DOING. This read
  r.postedA / r.postedB, and those are HOLE COUNTS - how many holes the
  side has written down - not the score. Two pairs seven holes into a nine
  both showed "7" while one of them was seven shots clear. r.a and r.b are
  the totals, and they always were; nothing else on the card printed them.

  MATCH PLAY SHOWS THE MARGIN, because a match is 2 up, not 2-1: taking a
  hole is worth the same whether by one shot or by five, so the totals are
  not the result. But they are still the numbers everybody standing there
  just counted, so they go underneath in strokeAside() rather than nowhere
  at all - the card used to print the margin against the leader and a bare
  dash against the other side, so one of the two pairs had no number on it
  anywhere on the screen.

  A LEVEL MATCH GIVES BOTH SIDES A DASH, not "AS". "AS" is one fact about
  the match, and printing it twice, once against each contestant, turned a
  state into a prefix on two names. The state is said once by
  standingLine() underneath: "All square thru 4".

  Reading r, never recomputing it.
*/
function sideFigure(r, i, scoring) {
  if (scoring !== "match") return (i === 0 ? r.a : r.b) || "—";
  const up = r.up || 0;
  if (!up) return "—";
  const leader = r.diff < 0 ? 0 : 1;
  return i === leader ? `${up}${r.complete && r.closedOut && r.remaining > 0 ? `&${r.remaining}` : " UP"}` : "—";
}

/*
  The strokes, small, under the margin - match play only. In stroke play
  the figure above IS the strokes and repeating them would be noise.

  Deliberately silent until the side has posted something: "0" against a
  pair that has not teed off reads as a score rather than as an absence.
*/
function strokeAside(r, i, scoring) {
  if (scoring !== "match") return "";
  const strokes = i === 0 ? r.a : r.b;
  const holes = i === 0 ? r.postedA : r.postedB;
  if (!holes || !strokes) return "";
  return `${strokes} thru ${holes}`;
}

function statusLine(sides, editable, stale) {
  if (!editable) return "Read-only — the players in this match and admins can score it.";
  /* Said first, and it names the hole: a refused stroke is gone rather than on
     its way, so somebody has to enter it again. */
  const want = new Set(sides.map((s) => String(s.id)));
  const bad = refusals().filter((f) => f.sideId && want.has(f.sideId));
  if (bad.length) {
    const holes = [...new Set(bad.map((f) => f.hole))].sort((a, b) => a - b);
    const one = holes.length === 1;
    return `<b class="dfl-battle-fail">Hole${one ? "" : "s"} ${holes.join(", ")} ${one ? "was" : "were"} not saved</b> — the database refused ${one ? "it" : "them"}. Enter ${one ? "it" : "them"} again. <span class="dfl-battle-why">${esc(bad[bad.length - 1].message)}</span>`;
  }
  const waiting = pendingCountSides(sides.map((s) => s.id));
  if (waiting) return `<b class="dfl-battle-wait">${waiting} hole${waiting === 1 ? "" : "s"} not saved yet</b> — kept on this phone, sent the moment you have signal.`;
  if (stale) return "Showing the last copy saved on this phone — it will refresh when you have signal.";
  return sides.length > 2 || sides.some((side) => side.team_id == null)
    ? "Each player can edit their own scorecard." : "Both sides share this card.";
}

/* The paper card: a row per side, tap a hole to jump to it. The lower score
   of the two is tinted so the round reads off it at a glance. */
function stripTable(card, maps, names, start, end, label) {
  const nums = [];
  for (let h = start; h <= end; h++) nums.push(h);
  const par = nums.reduce((a, h) => a + holePar(card.holes, h), 0);
  const state = maps.length === 2 && scoringOf(card) === "match" ? running(maps, holeCount(card)) : new Map();

  const row = (map, i) => {
    const sum = nums.reduce((a, h) => a + num(map.get(h)), 0);
    return `<tr class="row-s"><th class="lbl" title="${esc(names[i])}">${esc(names[i])}</th>${nums.map((h) => {
      const v = num(map.get(h));
      const posted = maps.map((other) => num(other.get(h))).filter(Boolean);
      const low = posted.length > 1 && v === Math.min(...posted);
      return `<td data-jump="${h}" class="${low ? "won" : ""}">${v || "·"}</td>`;
    }).join("")}<td class="sub" data-sub="${i}:${start}">${sum || "—"}</td></tr>`;
  };
  /* Match play gets the row a paper card would have: where the match stood
     after each hole. Without it the card is a wall of numbers with no way to
     see that somebody went three up at the 5th. */
  const matchRow = maps.length !== 2 || scoringOf(card) !== "match" ? "" : `<tr class="row-m"><th class="lbl">Match</th>${nums.map((h) => {
    const v = state.get(h);
    return `<td data-mp="${h}">${v == null ? "·" : upLabel(v)}</td>`;
  }).join("")}<td class="sub"></td></tr>`;

  return `<table class="dfl-battle-tbl">
    <tr class="row-h"><th class="lbl">Hole</th>${nums.map((h) => `<td>${h}</td>`).join("")}<td class="sub">${label}</td></tr>
    <tr class="row-p"><th class="lbl">Par</th>${nums.map((h) => `<td>${holePar(card.holes, h)}</td>`).join("")}<td class="sub">${par}</td></tr>
    ${maps.map((map, i) => row(map, i)).join("")}${matchRow}</table>`;
}

/*
  Nine columns at a time, never eighteen.

  Eighteen columns on a phone is either unreadable or a sideways scroll, and
  a scorecard has had two halves with their own totals since long before
  anybody put one on a screen. So a full round is drawn as OUT and IN, the
  same as the team card.
*/
function strip(card, maps, names) {
  const holes = holeCount(card);
  if (holes <= 9) return stripTable(card, maps, names, 1, holes, "TOT");
  return stripTable(card, maps, names, 1, 9, "OUT")
       + stripTable(card, maps, names, 10, holes, "IN");
}

/** The halves the strip is split into - also what recalc has to keep in step. */
const nineStarts = (holes) => (holes <= 9 ? [1] : [1, 10]);

function holeBlock(h, card, maps, names, canEditSide) {
  const par = holePar(card.holes, h);
  const yards = holeYards(card.courseHoles, h);
  const rows = maps.map((map, i) => {
    const v = map.get(h) ?? "";
    const posted = maps.map((other) => num(other.get(h))).filter(Boolean);
    const r = holeResult(v, par);
    const low = posted.length > 1 && num(v) === Math.min(...posted);
    const editable = canEditSide(i);
    return `<div class="bh-row ${low ? "is-low" : ""}" data-row="${i}:${h}">
      <span class="bh-name">${esc(names[i])}<i>${esc(card.sides[i].teamName)}</i></span>
      <span class="bh-entry">${editable ? `<button type="button" class="sbtn" data-step="-1" data-side="${i}" data-hole="${h}" aria-label="One fewer for ${esc(names[i])} on hole ${h}">−</button>` : ""}
        <span class="mark ${r.mark}" data-mark="${i}:${h}"><input data-battle-score data-side="${i}" data-hole="${h}" data-par="${par}" type="text" pattern="[0-9]*" inputmode="numeric" enterkeyhint="done" autocomplete="off" placeholder="—" value="${esc(v)}" maxlength="2" ${editable ? "" : "disabled"} aria-label="${esc(names[i])} strokes hole ${h}"></span>
        ${editable ? `<button type="button" class="sbtn" data-step="1" data-side="${i}" data-hole="${h}" aria-label="One more for ${esc(names[i])} on hole ${h}">+</button>` : ""}</span>
      <span class="bh-res ${r.cls}" data-res="${i}:${h}">${r.label}</span>
    </div>`;
  }).join("");
  /* On a nine played twice, say which tee you are actually standing on: the
     card reads 12 while the sign on the tee says 3. */
  const again = h > 9 && wrapsAround(card.holes) ? `<span class="again">(${courseHole(card.holes, h)})</span>` : "";
  return `<div class="bh" id="bhole-${h}"><div class="bh-head"><b>${h}</b>${again}<span>${yards ? `${yards} yd` : ""}</span><span class="par">Par ${par}</span></div>${rows}</div>`;
}

function finalBlock(maps, names, card, r) {
  const totals = maps.map((m) => {
    let s = 0, p = 0;
    for (let h = 1; h <= holeCount(card); h++) if (num(m.get(h))) { s += num(m.get(h)); p += holePar(card.holes, h); }
    return { s, p };
  });
  return `<div class="dfl-battle-final">${totals.map((t, i) => `
    <div class="dfl-battle-final-row"><span class="bh-name">${esc(names[i])}</span>
      <span><small>Strokes</small> <b data-total="${i}">${t.s || "—"}</b></span>
      <span><small>+/−</small> <b data-topar="${i}">${fmtToPar(t.s, t.p)}</b></span></div>`).join("")}
  </div>
  <div class="dfl-battle-outcome" data-outcome>${esc(outcomeText(r, names, isIndividual(card)))}</div>`;
}

/* What the match is worth, said plainly. The point only exists once both
   cards are full, so an unfinished match says what is missing instead of
   implying somebody has won. */
function outcomeText(r, names, individual = false) {
  if (individual) return individualStanding(r, names);
  const leader = r.diff < 0 ? names[0] : names[1];
  if (r.complete) {
    if (r.halved) return `All square after ${r.holes} — no point to either team`;
    return `${leader} win ${marginLabel(r)} — 1 point`;
  }
  /* Match play can be over before the card is full, so it counts down what is
     left to play rather than what is left to write down. */
  if (r.scoring === "match") {
    if (!r.thru) return "No point until both sides start scoring";
    if (!r.up) return `All square with ${r.remaining} to play`;
    return `${leader} ${r.up} up with ${r.remaining} to play`;
  }
  const left = [r.holes - r.postedA, r.holes - r.postedB];
  if (left[0] === r.holes && left[1] === r.holes) return "No point until both cards are filled in";
  return `${left[0] ? `${names[0]}: ${left[0]} to go. ` : ""}${left[1] ? `${names[1]}: ${left[1]} to go.` : ""}`.trim();
}

// ----------------------------------------------------------------- render

function recalc(root, card) {
  const holes = holeCount(card);
  const inputs = [...root.querySelectorAll("input[data-battle-score]")];
  const maps = card.sides.map(() => new Map());
  for (const input of inputs) {
    const i = Number(input.dataset.side), h = Number(input.dataset.hole), v = num(input.value);
    if (v > 0) maps[i].set(h, v);
  }
  for (const input of inputs) {
    const i = Number(input.dataset.side), h = Number(input.dataset.hole);
    const par = Number(input.dataset.par) || 4;
    const v = num(input.value);
    const posted = maps.map((other) => num(other.get(h))).filter(Boolean);
    const r = holeResult(v, par);
    const mark = root.querySelector(`[data-mark="${i}:${h}"]`);
    if (mark) mark.className = "mark " + r.mark;
    const res = root.querySelector(`[data-res="${i}:${h}"]`);
    if (res) { res.textContent = r.label; res.className = "bh-res " + r.cls; }
    const row = root.querySelector(`[data-row="${i}:${h}"]`);
    if (row) row.classList.toggle("is-low", posted.length > 1 && v === Math.min(...posted));
    /* One row per side for each hole, in row order, so the ith cell for that
       hole belongs to this side. */
    const cell = root.querySelectorAll(`[data-jump="${h}"]`)[i];
    if (cell) { cell.textContent = v || "·"; cell.className = posted.length > 1 && v === Math.min(...posted) ? "won" : ""; }
  }
  for (let i = 0; i < maps.length; i++) {
    // Each half of the card carries its own total, so each is recomputed.
    for (const start of nineStarts(holes)) {
      let nine = 0;
      for (let h = start; h <= Math.min(start + 8, holes); h++) nine += num(maps[i].get(h));
      const sub = root.querySelector(`[data-sub="${i}:${start}"]`);
      if (sub) sub.textContent = nine || "—";
    }
    let s = 0, p = 0;
    for (let h = 1; h <= holes; h++) if (num(maps[i].get(h))) { s += num(maps[i].get(h)); p += holePar(card.holes, h); }
    const tot = root.querySelector(`[data-total="${i}"]`);
    if (tot) tot.textContent = s || "—";
    const tp = root.querySelector(`[data-topar="${i}"]`);
    if (tp) tp.textContent = fmtToPar(s, p);
  }
  if (maps.length === 2 && scoringOf(card) === "match") {
    const state = running(maps, holes);
    for (let h = 1; h <= holes; h++) {
      const cell = root.querySelector(`[data-mp="${h}"]`);
      if (cell) cell.textContent = state.has(h) ? upLabel(state.get(h)) : "·";
    }
  }
  const names = card.sides.map((s) => pairName(s.players.map((p) => p.name)));
  const r = resultFor(card, maps);
  /* Repainted whole rather than field by field: which side leads, both
     figures and the standing line all move together, and three separate
     textContent writes is how they get out of step. */
  const stateEl = root.querySelector("[data-match-state]");
  if (stateEl) stateEl.innerHTML = matchState(card, names, r, scoringOf(card));
  const outcome = root.querySelector("[data-outcome]");
  if (outcome) outcome.textContent = outcomeText(r, names, isIndividual(card));
}

let stopWatch = null;
function watchSync(root, card, editable) {
  stopWatch?.();
  const paint = () => {
    const node = root.querySelector("[data-battle-status]");
    if (!node) { stopWatch?.(); return; }
    node.innerHTML = statusLine(card.sides, editable, card.stale);
  };
  const off = onQueueChange(paint);
  addEventListener("online", paint); addEventListener("offline", paint);
  stopWatch = () => { off(); removeEventListener("online", paint); removeEventListener("offline", paint); stopWatch = null; };
  paint();
  flush();
}

async function render(root, matchId) {
  styles();
  const card = await loadMatch(matchId);
  const back = `#/golf?id=${card.match.outing_id}`;
  if (card.sides.length < 2) {
    root.innerHTML = `<div class="card"><div class="card-body"><a class="backlink" href="${back}">← Rounds</a><p><strong>This match has no sides yet.</strong></p><p class="muted tiny">An admin needs to finish setting up this round.</p></div></div>`;
    return;
  }
  const holes = holeCount(card);
  const maps = card.sides.map((s) => strokeMap(card, s.id));
  const names = card.sides.map((s) => pairName(s.players.map((p) => p.name)));
  const me = String(currentMember()?.id || "");
  const admin = isAdmin();
  /* Anyone in the match may write either side - that is the format, not a
     shortcut, and a guest has no member id to check against at all. */
  /*
    WHO MAY WRITE WHICH SIDE.

    A member in the match writes EITHER side - that is the format, not a
    shortcut: one person keeps the card for the foursome, and it is how this
    has always worked.

    A GUEST WRITES THEIR OWN SIDE ONLY, which is tighter, and matches what
    the database will actually allow - the guest policy is scoped to their
    team. Disabling the other side's inputs is not the security (Postgres is)
    but typing into a box that is going to be refused is a worse experience
    than not having the box.
  */
  const pass = passFor(card.match.outing_id);
  const memberIn = !!me && card.sides.some((s) =>
    s.players.some((p) => p.member_id != null && String(p.member_id) === me));
  const individual = isIndividual(card);
  const guestSide = pass?.teamId
    ? card.sides.findIndex((s) => String(s.team_id) === String(pass.teamId))
    : -1;
  const editable = admin || memberIn || guestSide > -1;
  // A predicate rather than a boolean, so one side can be open and the other shut.
  const canEditSide = (i) => admin || (individual
    ? card.sides[i].players.some((player) => player.member_id != null && String(player.member_id) === me)
    : memberIn || guestSide === i);
  const scoring = scoringOf(card);
  const r = resultFor(card, maps);
  const singles = card.round?.format === "singles";
  /* The scoring is in the kicker because it changes what the numbers on this
     card mean, and it can be switched between rounds. */
  const roundLabel = card.round
    ? `${(card.round.name || `ROUND ${card.round.round_number}`).toUpperCase()} · ${individual ? individualMatchLabel(card.sides.length).toUpperCase() : singles ? "SINGLES" : "2V2"} · ${SCORING_NAMES[individual ? "strokes" : scoring].toUpperCase()} · MATCH ${card.match.match_number}`
    : `MATCH ${card.match.match_number}`;

  root.innerHTML = `<section class="card dfl-battle-card">
    <header class="dfl-battle-head">
      <div class="dfl-battle-head-top"><a class="backlink" href="${back}">← Rounds</a>
        <div><span class="dfl-battle-kicker">${esc(roundLabel)}</span><h2>${esc(names.join(" vs "))}</h2></div></div>
    </header>
    <div class="dfl-battle-state" data-match-state>${matchState(card, names, r, scoring)}</div>
    <div class="dfl-battle-status" data-battle-status>${statusLine(card.sides, editable, card.stale)}</div>
    ${admin ? `<div class="dfl-battle-admin"><button type="button" class="dfl-battle-clear" data-clear-battle>Clear this match</button></div>` : ""}
    <section class="dfl-battle-strip"><header class="dfl-battle-strip-title"><span>The card</span><span>${!individual && scoring === "match" ? `UP/DN is ${esc(names[0])}` : "Tap a hole to jump to it"}</span></header>
      <div style="overflow-x:auto">${strip(card, maps, names)}</div></section>
    <div class="dfl-holes">${Array.from({ length: holes }, (_, i) => holeBlock(i + 1, card, maps, names, canEditSide)).join("")}</div>
    ${finalBlock(maps, names, card, r)}
    <div class="dfl-battle-help">${individual
      ? `Individual stroke play: every golfer has a separate card in the same match. The lowest total after ${holes} holes wins; tied low totals share the result.`
      : scoring === "match"
      ? `Match play: whoever takes a hole goes one up, and a big number on one hole costs no more than a small one. The match is over as soon as somebody is up by more holes than are left — 3&amp;2 means three up with two to play. All square after ${holes} is worth nothing to either side.`
      : `Stroke play: fewest strokes over these ${holes} holes wins the match and puts one point on that team's board. Level is worth nothing to either side.`}</div>
  </section>`;

  wire(root, card, editable);
  watchSync(root, card, editable);

  /*
    NO SHARE BUTTON HERE, on purpose.

    Every individual match used to offer "Share the match card", which built
    a full-bleed fight poster for one 2v2 of one nine. That is promotional
    weight on the most detailed screen in Golf, and twelve of them a day.

    The poster infrastructure in golf-share.js is untouched - the tournament
    board and the team sheet are built by the same file, and matchPosterCanvas
    and shareMatchPoster are still exported for whatever wants them. What has
    gone is the exposure: sharing is an EVENT-level action now, on the
    tournament scoreboard and the Teams card.
  */

  if (admin) {
    const clear = root.querySelector("[data-clear-battle]");
    clear?.addEventListener("click", async () => {
      if (!confirm(`Clear every stroke in ${names.join(" vs ")}? This cannot be undone.`)) return;
      clear.disabled = true;
      try {
        dropPendingSides(card.sides.map((s) => s.id));
        const { error } = await db().from("golf_match_scores").delete()
          .in("side_id", card.sides.map((s) => s.id));
        if (error) throw error;
        dropCachedMatch(matchId);
        await render(root, matchId);
      } catch (err) { clear.disabled = false; toast(err.message || "Could not clear the match", true); }
    });
  }
}

// ------------------------------------------------------------------- wire

const timers = new Map();
function queueSave(card, input) {
  const i = Number(input.dataset.side), hole = Number(input.dataset.hole);
  const sideId = card.sides[i].id, key = `${sideId}:${hole}`;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    try { queueSideScore(card.match.outing_id, sideId, hole, input.value.trim()); }
    catch (err) { toast(err.message || "Could not save that score", true); }
  }, SAVE_DELAY));
}

function wire(root, card, editable) {
  /* The strip is a jump list, not a second place to score. */
  root.addEventListener("click", (e) => {
    const jump = e.target.closest("[data-jump]");
    if (!jump) return;
    root.querySelector(`#bhole-${jump.dataset.jump}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  if (!editable || root.dataset.battleWire === "1") return;
  root.dataset.battleWire = "1";

  /* First tap on an empty hole lands on par - the most common score, one tap
     instead of four. Same behaviour as the team card. */
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-step]");
    if (!btn) return;
    const input = root.querySelector(`input[data-battle-score][data-side="${btn.dataset.side}"][data-hole="${btn.dataset.hole}"]`);
    if (!input) return;
    const par = Number(input.dataset.par) || 4, now = num(input.value);
    input.value = String(now < 1 ? par : Math.max(MIN_STROKES, Math.min(MAX_STROKES, now + Number(btn.dataset.step))));
    recalc(root, card);
    queueSave(card, input);
  });

  root.addEventListener("input", (e) => {
    const input = e.target.closest("input[data-battle-score]");
    if (!input) return;
    const clean = input.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 2);
    if (clean !== input.value) input.value = clean;
    if (Number(clean) > MAX_STROKES) input.value = String(MAX_STROKES);
    recalc(root, card);
    queueSave(card, input);
  });

  root.addEventListener("keydown", (e) => {
    const input = e.target.closest("input[data-battle-score]");
    if (input && e.key === "Enter") { e.preventDefault(); input.blur(); }
  });
}

// -------------------------------------------------------------------- boot

function boot() {
  const run = () => {
    const root = document.querySelector("#golf-outing");
    const q = new URLSearchParams(location.hash.split("?")[1] || "");
    const matchId = q.get("match");
    if (!root || !matchId || !root.querySelector(".golf-match-page")) return;
    render(root, matchId).catch((err) => {
      root.innerHTML = `<div class="card"><div class="card-body"><strong>Could not load this match.</strong><p class="muted">${esc(err.message)}</p></div></div>`;
    });
  };
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
  run();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

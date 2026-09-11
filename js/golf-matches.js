/* =====================================================================
   golf-matches.js - the tournament: the board, the rounds, the matches
   ---------------------------------------------------------------------
   Sits on the outing page and answers the only question the format asks:
   WHO IS WINNING THE DAY.

     THE BOARD    team points, big, added up across every round, with each
                  round's own tally under it so the nine just played is
                  still readable after the next one starts.
     A ROUND      one card per nine: its matches, where each stands, and a
                  tap through to the card. Fold it away when it is done.
     ADMIN        add a round, build its pairs in draft order or add
                  matches by hand, and move anybody between seats.

   WHY ROUNDS ARE ROWS AND NOT A COUNTER
   Round 2's pairs are frequently nothing like round 1's, and round 3 is
   singles. If a round were rebuilt in place, the previous nine's strokes
   would either be deleted or silently re-read as the new pairing's - so
   each nine gets its own matches, its own sides and its own strokes, and
   the board adds them up. Nothing is overwritten.

   Boots off the .golf-matches-page placeholder the way the draft board and
   the scorecards do, so pages/golf.js does not have to know how any of
   this works - it just leaves a hole in the page.

   Every point is decided in golf-battle.js. Nothing here decides what a
   point is worth.
   ===================================================================== */
import { db, isAdmin } from "./supabase.js";
import { esc, empty, toast } from "./ui.js";
import { loadMembers } from "./members.js";
import { SCORING_NAMES, battleResult, standingLine, teamPoints, roundHoles,
         dayPoints, halvedNote, pairName, outingState } from "./golf-battle.js";
import { memberNames, playerName } from "./golf-people.js";
import { shareBoard, shareTeamSheet } from "./golf-share.js";
import { teamInk } from "./brand-ink.js";
import { nextTeamPair } from "./golf-matchups.js";
import { individualMatchLabel, individualResult, individualStanding } from "./golf-individual.js";

const POLL_MS = 15000;
const INDIVIDUAL_INK = ["#f4c430", "#c73a33", "#f3efe2", "#171717", "#5f7f55", "#d98935"];
/*
  TWO HOSTS, one module.

  The tournament points board and the rounds used to be drawn into the same
  placeholder, which pinned the board to wherever the rounds sat - buried
  under a draft board and above nothing in particular. They are different
  altitudes of information: the board is the score of the whole day and the
  rounds are the detail behind it, so the event page leaves two holes and
  the board goes in the top one, above the live leaderboard.

  Both are still drawn from ONE load() and one result set, so they cannot
  disagree about the same round.
*/
let host = null, boardHost = null, timer = 0, outingId = null;

function styles() {
  if (document.getElementById("dfl-battles-style")) return;
  const s = document.createElement("style");
  s.id = "dfl-battles-style";
  s.textContent = `
/* ---- THE TOURNAMENT SCOREBOARD: the biggest thing on the event page ----
   Points from the rounds, which is a different question to the live golf
   leaderboard underneath it - that one is strokes against par. Both are
   hero content; this one is the score of the day, so it goes first and it
   is the only place on the page carrying figures this size. */
.golf-points{padding:0;overflow:hidden;border-color:var(--accent-dim)}
.gp-kicker{display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 13px 0;font-size:10px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
.gp-live{display:flex;align-items:center;justify-content:center;gap:8px;padding:9px 13px;font-size:10px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.golf-points-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));align-items:stretch;gap:8px;padding:12px 13px 17px}
.gp-team{min-width:0;display:grid;gap:5px;justify-items:center;text-align:center}
.gp-team b{font-family:var(--font-display);font-size:15px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.gp-team span{font-size:clamp(52px,17vw,76px);font-weight:950;line-height:.9;font-variant-numeric:tabular-nums;color:var(--racer,var(--accent))}
.gp-team small{font-size:9px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.gp-dash{font-size:20px;font-weight:900;color:var(--muted)}
.golf-points-rounds{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;padding:0 13px 12px}
.gpr{display:flex;align-items:baseline;gap:5px;padding:5px 9px;border:1px solid var(--line);border-radius:999px;background:var(--bg-2);font-size:10.5px;font-weight:900}
.gpr small{color:var(--muted);letter-spacing:.06em;text-transform:uppercase;font-size:9px}
.gpr.is-open{border-style:dashed;color:var(--muted)}
.golf-points-foot{padding:0 13px 12px;text-align:center;font-size:10.5px;color:var(--muted)}
.golf-points-lead{padding:10px 13px;border-top:1px solid var(--line-soft);text-align:center;font-size:13px;font-weight:900;letter-spacing:.05em;text-transform:uppercase;background:var(--bg-3)}
.gp-share{padding:10px 13px;border-top:1px solid var(--line-soft);display:flex;flex-wrap:wrap;gap:8px;justify-content:center}

.golf-round{padding:0;overflow:hidden}
.gr-head{display:flex;align-items:center;gap:9px;padding:12px 13px;border-bottom:1px solid var(--line);background:var(--bg-3)}
.gr-head-main{min-width:0;flex:1}
.gr-head-main strong{display:block;font-size:14px}
.gr-head-main small{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;font-weight:900}
.gr-score{font-size:15px;font-weight:950;font-variant-numeric:tabular-nums;white-space:nowrap}
.gb-list{display:grid}
.gb-row{display:grid;grid-template-columns:26px 1fr 16px;align-items:center;gap:9px;padding:11px 13px;border-top:1px solid var(--line-soft);text-decoration:none;color:inherit;min-height:52px}
.gb-row:first-child{border-top:0}
.gb-row:hover{background:var(--bg-3)}
.gb-n{font-weight:900;color:var(--muted);text-align:center;font-variant-numeric:tabular-nums}
.gb-mid{min-width:0;display:grid;gap:3px}
.gb-pair{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;font-weight:800}
.gb-pair i{width:8px;height:8px;border-radius:50%;background:var(--racer,var(--accent));flex:0 0 8px}
.gb-pair span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gb-pair em{font-style:normal;margin-left:auto;padding-left:8px;font-variant-numeric:tabular-nums;color:var(--muted);font-weight:900}
.gb-pair.is-low em{color:var(--sc-under)}
.gb-stand{font-size:10.5px;color:var(--muted);font-weight:800}
.gb-stand.is-done{color:var(--accent)}
.gb-arrow{font-size:20px;color:var(--muted);text-align:right}
.gb-admin{padding:12px 13px;border-top:1px solid var(--line)}
.gr-scoring{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:11px}
.gs-opt{display:grid;gap:2px;padding:9px 8px;border:1px solid var(--line);border-radius:9px;background:var(--bg-2);color:var(--text);font:inherit;font-size:12px;font-weight:900;text-align:center;min-height:46px}
.gs-opt small{font-size:9px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
/* The chosen one is filled, not merely outlined: two outlined buttons side by
   side never say which is the state and which is the offer. */
.gs-opt.is-on{border-color:var(--accent);background:var(--hover-soft);box-shadow:inset 0 0 0 1px var(--accent)}
.gs-opt.is-on small{color:var(--accent)}
.gb-seats{display:grid;gap:9px;margin-top:9px}
.gb-seat-group{border:1px solid var(--line);border-radius:9px;padding:9px;background:var(--bg-2)}
.gb-seat-head{display:flex;align-items:center;gap:8px}
.gb-seat-head strong{flex:1;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.gb-drop{border:1px solid var(--danger-line);border-radius:7px;background:var(--danger-bg);color:var(--danger-ink);font-weight:900;font-size:10px;padding:4px 8px}
.gb-seat{display:grid;grid-template-columns:1fr;gap:6px;margin-top:7px}
.gb-seat select{height:38px;padding:0 9px;border:1px solid var(--line);border-left:3px solid var(--racer,var(--line));border-radius:7px;background:var(--bg-2);color:var(--text);font:inherit;min-width:0}
@media(min-width:560px){.gb-seat.is-pairs{grid-template-columns:1fr 1fr}}
/* One team, one block: its colour down the edge, its name over the top. */
.gb-side{border-left:3px solid var(--racer,var(--accent));border-radius:0 8px 8px 0;padding:7px 9px;background:var(--bg-3)}
.gb-side-head{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.gb-side-head i{flex:0 0 9px;width:9px;height:9px;border-radius:50%;background:var(--racer,var(--accent))}
.gb-side-head span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gb-vs{padding:5px 0;text-align:center;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}
.gt-add{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.gm-add{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:7px;align-items:center;margin-top:10px}
.gm-add select{min-width:0;height:40px;padding:0 8px;border:1px solid var(--line);border-radius:8px;background:var(--bg-2);color:var(--text);font:inherit;font-size:12px;font-weight:800}
.gm-add-vs{font-size:9px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.gm-add .btn{grid-column:1/-1;justify-self:start}
@media(max-width:420px){.gm-add{grid-template-columns:1fr}.gm-add-vs{display:none}.gm-add .btn{grid-column:auto;width:100%}}`;
  document.head.appendChild(s);
}

// ------------------------------------------------------------------- data

/* One rule for "how long is this round", shared with the match card and
   with the tournament total - see roundHoles() in golf-battle.js. */
const holesOf = roundHoles;
const seatsOf = (round) => (round?.format === "singles" ? 1 : 2);
/* Rounds created before scoring was a choice read as stroke play, which is
   what they were. */
const scoringOf = (round) => (round?.scoring === "match" ? "match" : "strokes");

async function load(id) {
  const none = { data: [], error: null };
  const [roundsRes, matchesRes, teamsRes, partsRes, members, outingRes] = await Promise.all([
    db().from("golf_rounds").select("id,round_number,name,format,holes,scoring").eq("outing_id", id).order("round_number"),
    db().from("golf_matches").select("id,match_number,round_id").eq("outing_id", id).order("match_number"),
    /* captain_member_id is read for the board and the shared team sheet.
       Without it teamSheet()'s captainOf() had nothing to resolve, so the
       captain line silently never appeared on the picture people share. */
    db().from("golf_teams").select("id,name,color,sort_order,captain_member_id").eq("outing_id", id).order("sort_order"),
    db().from("golf_participants").select("id,member_id,guest_name,team_id,pick_number,sort_order").eq("outing_id", id),
    loadMembers().catch(() => []),
    /* The shared image's headline, plus status - outingState() needs it to
       decide what the event page should be leading with. */
    db().from("golf_outings").select("id,name,course,event_date,status").eq("id", id).maybeSingle(),
  ]);
  if (roundsRes.error || matchesRes.error || teamsRes.error || partsRes.error) {
    throw roundsRes.error || matchesRes.error || teamsRes.error || partsRes.error;
  }

  const matches = matchesRes.data || [];
  const matchIds = matches.map((m) => m.id);
  const sidesRes = matchIds.length
    ? await db().from("golf_match_sides").select("id,match_id,team_id,slot").in("match_id", matchIds).order("slot")
    : none;
  if (sidesRes.error) throw sidesRes.error;

  const sides = sidesRes.data || [];
  const sideIds = sides.map((s) => s.id);
  const [playersRes, scoresRes] = await Promise.all([
    sideIds.length ? db().from("golf_match_players").select("id,side_id,participant_id,round_id").in("side_id", sideIds) : none,
    sideIds.length ? db().from("golf_match_scores").select("side_id,hole,strokes").in("side_id", sideIds) : none,
  ]);
  if (playersRes.error || scoresRes.error) throw playersRes.error || scoresRes.error;

  const names = memberNames(members);
  const byPart = new Map((partsRes.data || []).map((p) => [String(p.id), p]));
  const strokes = new Map();
  for (const row of scoresRes.data || []) {
    const key = String(row.side_id);
    if (!strokes.has(key)) strokes.set(key, new Map());
    strokes.get(key).set(Number(row.hole), Number(row.strokes));
  }

  const buildMatch = (m, round) => {
    const mine = sides.filter((s) => String(s.match_id) === String(m.id))
      .sort((a, b) => Number(a.slot) - Number(b.slot));
    const built = mine.map((s, i) => {
      const rows = (playersRes.data || []).filter((p) => String(p.side_id) === String(s.id));
      const team = (teamsRes.data || []).find((t) => String(t.id) === String(s.team_id));
      const players = rows.map((r) => ({
        row_id: r.id,
        participant_id: r.participant_id,
        name: playerName(byPart.get(String(r.participant_id)), names),
      }));
      return {
        ...s,
        teamName: team?.name || (s.team_id == null ? "Individual" : "Team"),
        color: team ? teamInk(team.color, team.sort_order ?? i) : INDIVIDUAL_INK[i % INDIVIDUAL_INK.length],
        players,
        strokes: strokes.get(String(s.id)) || new Map(),
      };
    });
    return {
      ...m,
      sides: built,
      result: built.length === 2
        ? battleResult(built[0].strokes, built[1].strokes, holesOf(round), scoringOf(round))
        : null,
    };
  };

  const rounds = (roundsRes.data || []).map((round) => ({
    round,
    battles: matches.filter((m) => String(m.round_id) === String(round.id)).map((m) => buildMatch(m, round)),
  }));

  /* Which participants are spoken for, PER ROUND. One seat per round is the
     rule - a player is in all three rounds, just not twice in one - so a
     single flat set would have made round 2 unfillable. */
  const takenByRound = new Map();
  for (const row of playersRes.data || []) {
    const key = String(row.round_id);
    if (!takenByRound.has(key)) takenByRound.set(key, new Map());
    takenByRound.get(key).set(String(row.participant_id), row);
  }

  return {
    rounds,
    teams: teamsRes.data || [],
    parts: partsRes.data || [],
    names,
    takenByRound,
    outing: outingRes?.data || null,
  };
}

// ------------------------------------------------------------------ views

function board(data) {
  const teams = data.teams || [];
  if (!teams.length || !data.rounds.length) return "";
  const { total, per } = dayPoints(data.rounds);
  const values = teams.map((t) => total.get(String(t.id)) || 0);
  const allBattles = data.rounds.flatMap((r) => r.battles.filter((b) => b.sides.length === 2));
  /* Halved matches only. "9 still out" used to sit here too, which put a
     progress report on the one card that is supposed to answer a single
     question - what is the score - and it was the loudest thing on it before
     anybody had teed off. The round cards below already say, per match,
     exactly what is unfinished. */
  const foot = halvedNote(allBattles);
  const best = Math.max(...values);
  const leaders = teams.filter((_, index) => values[index] === best);
  const lead = !allBattles.some((b) => b.result?.complete) ? ""
    : leaders.length === 1 ? `${esc(leaders[0].name)} lead`
    : leaders.length === teams.length ? "All square"
    : `${leaders.length} teams tied for the lead`;

  /* Each round's own tally, which is the history the day is played for -
     "we lost the first nine 2-1" survives the next two nines. */
  const chips = per.map(({ round, points }) => {
    const open = data.rounds.find((r) => String(r.round.id) === String(round.id))
      ?.battles.some((b) => !b.result?.complete);
    return `<span class="gpr ${open ? "is-open" : ""}"><small>R${round.round_number}</small>${teams.map((t) => `${esc(t.name)} ${points.get(String(t.id)) || 0}`).join(" · ")}</span>`;
  }).join("");

  const anyLive = data.rounds.some((r) => r.battles.some((b) => b.result && b.result.thru > 0 && !b.result.complete));
  /* The captain under the team name, because this board is also the thing
     that gets shared - and "TEAM CHAOS / CAPTAIN CIM CIM" is the billing.
     Nothing is printed for a team with no captain set. */
  const caps = teams.map((t) => (t.captain_member_id != null
    ? playerName({ member_id: t.captain_member_id }, data.names) : ""));
  return `<section class="card golf-points" data-collapse="golf-points" data-collapse-title="Tournament" data-collapse-badge="${values.join(" — ")}">
    <div class="gp-kicker">Tournament</div>
    ${anyLive ? `<div class="gp-live"><span class="badge live">Live</span><span>A round is under way</span></div>` : ""}
    <div class="golf-points-grid">
      ${teams.map((t, i) => `<div class="gp-team" style="--racer:${esc(teamInk(t.color, i))}"><span>${values[i]}</span><b>${esc(t.name)}</b>${caps[i] ? `<small>Captain ${esc(caps[i])}</small>` : ""}</div>`).join("")}
    </div>
    ${chips ? `<div class="golf-points-rounds">${chips}</div>` : ""}
    ${foot ? `<div class="golf-points-foot">${esc(foot)}</div>` : ""}
    ${lead ? `<div class="golf-points-lead">${lead}</div>` : ""}
    ${teams.length === 2 ? `<div class="gp-share"><button class="btn ghost small" data-share-board>Share tournament</button></div>` : ""}
  </section>`;
}

function matchRow(b, round) {
  const names = b.sides.map((s) => pairName(s.players.map((p) => p.name)));
  if (b.sides.length < 2) {
    return `<div class="gb-row"><span class="gb-n">${b.match_number}</span><div class="gb-mid"><div class="gb-stand">Sides not built yet</div></div><span class="gb-arrow"></span></div>`;
  }
  const totals = b.sides.map((s) => {
    let t = 0;
    for (let h = 1; h <= holesOf(round); h++) t += Number(s.strokes.get(h)) || 0;
    return t;
  });
  if (b.sides.length > 2) {
    const r = individualResult(b.sides.map((side) => side.strokes), holesOf(round));
    return `<a class="gb-row" href="#/golf?id=${outingId}&match=${b.id}">
      <span class="gb-n">${b.match_number}</span><div class="gb-mid">
        ${b.sides.map((s, i) => `<div class="gb-pair ${r.leaders.includes(i) ? "is-low" : ""}" style="--racer:${esc(s.color || "")}"><i></i><span>${esc(names[i])}</span><em>${totals[i] || "—"}</em></div>`).join("")}
        <div class="gb-stand ${r.complete ? "is-done" : ""}">${esc(individualStanding(r, names))}</div>
      </div><span class="gb-arrow">›</span></a>`;
  }
  const r = b.result;
  const low = r.thru && r.diff !== 0 ? (r.diff < 0 ? 0 : 1) : -1;
  return `<a class="gb-row" href="#/golf?id=${outingId}&match=${b.id}">
    <span class="gb-n">${b.match_number}</span>
    <div class="gb-mid">
      ${b.sides.map((s, i) => `<div class="gb-pair ${low === i ? "is-low" : ""}" style="--racer:${esc(s.color || "")}"><i></i><span>${esc(names[i])}</span><em>${totals[i] || "—"}</em></div>`).join("")}
      <div class="gb-stand ${r.complete ? "is-done" : ""}">${esc(standingLine(r, names[0], names[1]))}${r.complete && !r.halved && r.lead >= (r.scoring === "match" ? 5 : 8) ? " · BEATDOWN" : ""}</div>
    </div>
    <span class="gb-arrow">›</span></a>`;
}

/*
  The seat pickers: one select per seat, listing that team's players.

  This is what "change the pairs on the fly" means in practice - no
  regenerating, no SQL, and round 2's pairs can bear no resemblance to
  round 1's. Two seats per side for a 2v2, one for singles.
*/
function seats(data, entry) {
  const { round, battles } = entry;
  const taken = data.takenByRound.get(String(round.id)) || new Map();
  const perSide = seatsOf(round);

  return battles.filter((b) => b.sides.length === 2).map((b) => `
    <div class="gb-seat-group">
      <div class="gb-seat-head"><strong>Match ${b.match_number}</strong>
        <button type="button" class="gb-drop" data-drop-match="${b.id}">Delete</button></div>
      ${b.sides.map((s) => {
        const pool = data.parts.filter((p) => String(p.team_id) === String(s.team_id))
          .sort((a, b2) => (a.pick_number ?? 9999) - (b2.pick_number ?? 9999) || (a.sort_order ?? 0) - (b2.sort_order ?? 0));
        const seat = (player, index) => `
          <select data-seat="${round.id}:${s.id}" data-row="${player?.row_id ?? ""}" aria-label="Player ${index + 1} for ${esc(s.teamName)} in match ${b.match_number}">
            <option value="">— empty —</option>
            ${pool.map((p) => {
              const held = taken.get(String(p.id));
              const elsewhere = held && String(held.side_id) !== String(s.id);
              return `<option value="${p.id}" ${String(p.id) === String(player?.participant_id) ? "selected" : ""}>${esc(playerName(p, data.names))}${elsewhere ? " (already in this round)" : ""}</option>`;
            }).join("")}
          </select>`;
        /* The team's colour down the side and its name over the top. Two rows
           of bare dropdowns gave no clue which was which, so pairing people up
           meant remembering who was on whose team - and the pool of each
           dropdown is already that team's players only, which is impossible to
           see until you open it. The name carries the same information as the
           colour, for anybody the colours do not work for. */
        return `<div class="gb-side" style="--racer:${esc(s.color || "var(--accent)")}">
          <div class="gb-side-head"><i></i><span>${esc(s.teamName)}</span></div>
          <div class="gb-seat ${perSide > 1 ? "is-pairs" : ""}">${Array.from({ length: perSide }, (_, i) => seat(s.players[i], i)).join("")}</div>
        </div>`;
      }).join(`<div class="gb-vs">versus</div>`)}
    </div>`).join("");
}

function roundCard(data, entry) {
  const { round, battles } = entry;
  const admin = isAdmin();
  const singles = round.format === "singles";
  const individual = singles && battles.some((battle) => battle.sides.length > 2 || battle.sides.some((side) => side.team_id == null));
  const scoring = scoringOf(round);
  const pts = teamPoints(battles.filter((b) => b.sides.length === 2));
  const teams = data.teams || [];
  const scored = battles.some((b) => b.sides.some((s) => s.strokes.size));
  const label = round.name || `Round ${round.round_number}`;

  /*
    Stroke play or match play, switchable at any time - including mid-round.
    Both are read off the same strokes, so flipping it re-reads the nine
    rather than editing anything, and switching back is free.
  */
  const scoringSwitch = individual ? `<p class="muted tiny">Individual fields use stroke play so every golfer can be ranked together.</p>` : `<div class="gr-scoring" role="group" aria-label="How ${esc(label)} is won">
    ${Object.entries(SCORING_NAMES).map(([key, name]) => `
      <button type="button" class="gs-opt ${scoring === key ? "is-on" : ""}" data-scoring="${round.id}:${key}" aria-pressed="${scoring === key}">${name}
        <small>${key === "match" ? "hole by hole" : "fewest strokes"}</small></button>`).join("")}
  </div>`;

  /*
    Nine or eighteen, per round. A scramble tends to be a full round while
    the singles are a nine, and either way it is the round that decides -
    every card and every result reads its hole count from here.
  */
  const holesSwitch = `<div class="gr-scoring" role="group" aria-label="How many holes ${esc(label)} is">
    ${[9, 18].map((n) => `
      <button type="button" class="gs-opt ${holesOf(round) === n ? "is-on" : ""}" data-holes="${round.id}:${n}" aria-pressed="${holesOf(round) === n}">${n} holes
        <small>${n === 9 ? "a nine" : "the full round"}</small></button>`).join("")}
  </div>`;

  const suggested = nextTeamPair(teams, battles);
  const teamOptions = (selected) => teams.map((team) => `<option value="${team.id}" ${String(team.id) === String(selected) ? "selected" : ""}>${esc(team.name || "Team")}</option>`).join("");
  const addMatch = singles ? `<div class="gm-add" style="grid-template-columns:1fr"><button class="btn small" data-sync-individual="${round.id}">${battles.length ? "Sync individual field" : "Build individual match"}</button></div>` : teams.length < 2 ? `<p class="muted tiny">Create at least two teams before adding matches.</p>` : `<div class="gm-add">
    <select data-match-team-a="${round.id}" aria-label="First team for the new match">${teamOptions(suggested[0])}</select>
    <span class="gm-add-vs">versus</span>
    <select data-match-team-b="${round.id}" aria-label="Second team for the new match">${teamOptions(suggested[1])}</select>
    <button class="btn ghost small" data-add-match="${round.id}">Add ${singles ? "singles " : ""}match</button>
  </div>`;

  const adminBlock = !admin ? "" : `<div class="gb-admin">
    ${holesSwitch}
    ${scoringSwitch}
    <div class="arena-admin">
      ${singles || teams.length !== 2 ? "" : `<button class="btn small" data-build-pairs="${round.id}">${battles.length ? "Rebuild the pairs" : "Build the pairs"}</button>`}
      ${scored ? `<button class="btn ghost small danger" data-clear-round="${round.id}">Clear this round's strokes</button>` : ""}
      <button class="btn ghost small danger" data-drop-round="${round.id}">Delete round</button>
    </div>
    ${addMatch}
    <p class="muted tiny">${singles
      ? "Every golfer in the event gets one side in the same match — three golfers play 1v1v1. Add or remove people from the lineup, then sync the field. No teams are required."
      : teams.length === 2
        ? "“Build the pairs” pairs each team in draft order and puts pair 1 against pair 1. Or add matches and fill them in yourself — picking somebody already in this round swaps the two."
        : "Choose the two teams for each match, then fill two seats on each side. This keeps multi-team rounds explicit and avoids assigning the wrong opponent."}${scored ? " Rebuilding is blocked until this round's strokes are cleared." : ""}</p>
    ${!singles && battles.length ? `<div class="gb-seats">${seats(data, entry)}</div>` : ""}
  </div>`;

  /* The badge rides on the fold bar, so a round folded away still shows what
     it finished - which is the whole point of folding a finished nine. */
  const badge = teams.length ? teams.map((t) => pts.get(String(t.id)) || 0).join(" – ") : "";

  /*
    A DECIDED NINE FOLDS ITSELF.

    Every match in it is over, its two points are on the fold bar, and the
    only thing left in the card is a list of finished matches between the
    reader and the round they are actually playing. It stays one tap away,
    and one tap is all it takes to keep it open for good - see collapse.js.

    Read off the results that are already computed here; nothing new is
    worked out and no round is ever folded on the reader's behalf twice.
  */
  const playable = battles.filter((b) => b.sides.length >= 2);
  const decided = playable.length > 0 && playable.every((b) => b.sides.length === 2
    ? b.result?.complete
    : individualResult(b.sides.map((side) => side.strokes), holesOf(round)).complete);
  const field = individual && battles[0] ? individualMatchLabel(battles[0].sides.length) : "";

  return `<section class="card golf-round" data-collapse="golf-round-${round.round_number}" data-collapse-title="${esc(label)}" data-collapse-badge="${esc(badge)}"${decided ? ` data-collapse-default="folded"` : ""}>
    <div class="gr-head">
      <div class="gr-head-main"><strong>${esc(label)}</strong>
        <small>${individual ? field : singles ? "Singles" : "2v2"} · ${esc(individual ? SCORING_NAMES.strokes : SCORING_NAMES[scoring])} · ${holesOf(round)} holes · ${battles.length} match${battles.length === 1 ? "" : "es"}</small></div>
    </div>
    <div class="gb-list">${battles.length ? battles.map((b) => matchRow(b, round)).join("") : empty(admin ? "No matches in this round yet." : "Not set up yet.")}</div>
    ${adminBlock}
  </section>`;
}

function view(data) {
  const admin = isAdmin();
  const addRound = !admin ? "" : `<section class="card"><div class="card-body">
    <div class="card-title">Add a round</div>
    <p class="muted tiny">The day is three nines: two rounds of 2v2s and a nine of singles. Each round keeps its own matches and strokes, so adding one never disturbs the last.</p>
    <div class="gt-add"><button class="btn small" data-add-round="pairs">Add a 2v2 round</button>
      <button class="btn small" data-add-round="singles">Add a singles round</button></div>
  </div></section>`;

  if (!data.rounds.length) {
    return `${admin ? addRound : ""}${admin ? "" : `<section class="card"><div class="card-body muted tiny">The tournament has not been set up yet.</div></section>`}`;
  }

  /* The board is NOT in here any more - it is drawn into its own host at the
     top of the event page. This is the detail level: the rounds. */
  return `${data.rounds.map((entry) => roundCard(data, entry)).join("")}${addRound}`;
}

// ----------------------------------------------------------------- actions

/*
  Move a player into a seat.

  One seat per player per round, so "put Dave here" where Dave is already
  in this round is a SWAP, not an assignment. Doing it as two updates would
  break the unique index halfway through - both rows holding the same
  participant for an instant - so the pair of rows is deleted and
  re-inserted the other way round instead.
*/
async function assignSeat(data, roundId, sideId, rowId, participantId) {
  const client = db();
  const taken = data.takenByRound.get(String(roundId)) || new Map();
  const held = participantId ? taken.get(String(participantId)) : null;

  if (!participantId) {
    if (!rowId) return;
    const { error } = await client.from("golf_match_players").delete().eq("id", rowId);
    if (error) throw error;
    return;
  }

  if (held && String(held.id) !== String(rowId)) {
    /* Whoever is in the seat being filled goes where the incoming player
       came from. If the seat was empty, nobody swaps back. */
    const outgoing = rowId ? [...taken.values()].find((r) => String(r.id) === String(rowId)) : null;
    const del = await client.from("golf_match_players").delete()
      .in("id", [held.id, ...(rowId ? [rowId] : [])]);
    if (del.error) throw del.error;
    const rows = [{ side_id: sideId, participant_id: Number(participantId) }];
    if (outgoing) rows.push({ side_id: held.side_id, participant_id: outgoing.participant_id });
    const ins = await client.from("golf_match_players").insert(rows);
    if (ins.error) throw ins.error;
    return;
  }

  if (rowId) {
    const { error } = await client.from("golf_match_players")
      .update({ participant_id: Number(participantId) }).eq("id", rowId);
    if (error) throw error;
    return;
  }
  const { error } = await client.from("golf_match_players")
    .insert({ side_id: sideId, participant_id: Number(participantId) });
  if (error) throw error;
}

/* Add one two-sided match without the old RPC's exactly-two-teams rule.
   The two teams are explicit, so a tournament can have any field size while
   each match keeps the two-side shape the scorecard requires. Re-read the
   next match number on a collision so two quick taps cannot corrupt a round. */
async function createMatch(roundId, firstTeamId, secondTeamId) {
  if (!firstTeamId || !secondTeamId) throw new Error("Choose two teams for this match.");
  if (String(firstTeamId) === String(secondTeamId)) throw new Error("A team cannot play itself. Choose a different opponent.");
  const client = db();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await client.from("golf_matches").select("match_number")
      .eq("round_id", roundId).order("match_number", { ascending: false }).limit(1);
    if (latest.error) throw latest.error;
    const matchNumber = Number(latest.data?.[0]?.match_number || 0) + 1;
    const made = await client.from("golf_matches").insert({
      outing_id: Number(outingId), round_id: Number(roundId), match_number: matchNumber,
    }).select("id").single();
    if (made.error?.code === "23505" && attempt < 2) continue;
    if (made.error) throw made.error;
    if (!made.data?.id) throw new Error("The match was not created. Sign in as admin and try again.");
    const sides = await client.from("golf_match_sides").insert([
      { match_id: made.data.id, team_id: Number(firstTeamId), slot: 1 },
      { match_id: made.data.id, team_id: Number(secondTeamId), slot: 2 },
    ]);
    if (!sides.error) return made.data.id;
    await client.from("golf_matches").delete().eq("id", made.data.id);
    throw sides.error;
  }
  throw new Error("Another match was added at the same time. Try once more.");
}

// ---------------------------------------------------------------- lifecycle

let data = null;

function rememberPosition(target) {
  const element = target instanceof Element ? target : document.activeElement;
  const card = element?.closest?.("[data-collapse]");
  const stable = ["data-seat", "data-add-match", "data-build-pairs", "data-drop-match", "data-scoring", "data-holes"]
    .find((attr) => element?.hasAttribute?.(attr));
  const value = stable ? element.getAttribute(stable) : "";
  return {
    scrollY: window.scrollY,
    selector: stable ? `[${stable}="${String(value).replaceAll('"', '\\"')}"]` : "",
    collapse: card?.dataset.collapse || "",
    top: element?.getBoundingClientRect?.().top ?? card?.getBoundingClientRect?.().top ?? 0,
    cardTop: card?.getBoundingClientRect?.().top ?? 0,
  };
}

async function restorePosition(saved) {
  if (!saved) return;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const exact = saved.selector && host?.querySelector(saved.selector);
  const anchor = exact || (saved.collapse && document.querySelector(`[data-collapse="${saved.collapse}"]`));
  if (anchor) {
    window.scrollBy(0, anchor.getBoundingClientRect().top - (exact ? saved.top : saved.cardTop));
    if (saved.selector && anchor.matches("button,select,input")) anchor.focus({ preventScroll: true });
  } else {
    window.scrollTo(0, saved.scrollY);
  }
}

/*
  WHAT THE EVENT PAGE SHOULD BE LEADING WITH.

  outingState() in golf-battle.js is the app's single answer to "what state
  is this outing in", and it already takes exactly the [{round, battles}]
  shape load() produces. It is asked here rather than in pages/golf.js
  because this is the only module that has the battles - and asking it in
  two places from two different sets of facts is how the app ends up with
  two states that disagree.

  The attribute is all that is set. css/golf.css does the re-ordering.
*/
function paintState(state) {
  const page = document.querySelector("#golf-outing");
  if (page) page.dataset.golfState = state;
}

/*
  SHARE TEAMS lives on the Teams card, which pages/golf.js draws - so that
  card leaves an empty slot and this fills it. It is filled from here
  because this is where the rosters, the captains and the pairings are: one
  team sheet, drawn by golf-share.js, from the one set of data.
*/
function paintTeamShare() {
  const slot = document.querySelector("#golf-outing [data-teamshare]");
  if (!slot) return;
  const want = data && data.teams.length
    ? `<button class="btn ghost small" data-share-teams>Share teams</button>` : "";
  if (slot.innerHTML !== want) slot.innerHTML = want;
}

async function draw(savedPosition = null) {
  if (!host) return;
  try {
    data = await load(outingId);
  } catch (err) {
    /* Before the migration is run these tables do not exist. Only the person
       who can actually run it is given the homework. */
    host.innerHTML = isAdmin()
      ? `<section class="card"><div class="card-body muted tiny">The tournament needs one migration: run <strong>golf_matches_schema.sql</strong> in Supabase.<br>${esc(err.message || String(err))}</div></section>`
      : "";
    if (boardHost) boardHost.innerHTML = "";
    paintState("upcoming");
    paintTeamShare();
    return;
  }
  styles();
  host.innerHTML = view(data);
  if (boardHost) boardHost.innerHTML = board(data);
  paintState(outingState(data.outing, data.rounds).state);
  paintTeamShare();
  await restorePosition(savedPosition);
}

/*
  THE TWO SHARE BUTTONS, wired once on the document.

  They are no longer in the same element - Share tournament rides the points
  board and Share teams is on the Teams card, which a different module
  draws - so a listener per host would be two listeners to keep in step and
  one of them attached to a card this file does not own.

  Deliberately NOT async, and registered ONCE. navigator.share has to be
  called in the same task as the tap that asked for it, and an async handler
  that awaits anything on the way there spends the gesture - on iOS that is
  the difference between the share sheet opening and a NotAllowedError. See
  the note at the top of share.js.
*/
let shareWired = false;
function wireShare() {
  if (shareWired) return;
  shareWired = true;
  document.addEventListener("click", (e) => {
    const wantBoard = e.target.closest("[data-share-board]");
    const wantTeams = e.target.closest("[data-share-teams]");
    if (!wantBoard && !wantTeams) return;
    if (!data) return void toast("The tournament is still loading", true);
    toast(wantBoard ? shareBoard(data, data.outing) : shareTeamSheet(data, data.outing));
  });
}

/* Every admin button on the card, and a redraw after each one. */
function wire() {
  host.addEventListener("change", async (e) => {
    const matchup = e.target.closest("[data-match-team-a],[data-match-team-b]");
    if (matchup) {
      const roundId = matchup.dataset.matchTeamA || matchup.dataset.matchTeamB;
      const other = host.querySelector(matchup.hasAttribute("data-match-team-a")
        ? `[data-match-team-b="${roundId}"]` : `[data-match-team-a="${roundId}"]`);
      if (other?.value === matchup.value) {
        const alternative = [...other.options].find((option) => option.value !== matchup.value);
        if (alternative) other.value = alternative.value;
      }
      return;
    }
    const select = e.target.closest("[data-seat]");
    if (!select) return;
    const savedPosition = rememberPosition(select);
    const [roundId, sideId] = select.dataset.seat.split(":");
    select.disabled = true;
    try {
      await assignSeat(data, roundId, sideId, select.dataset.row || "", select.value);
    } catch (err) {
      toast(err.message || "Could not move that player", true);
    }
    await draw(savedPosition);
  });

  host.addEventListener("click", async (e) => {
    const el = (attr) => e.target.closest(`[${attr}]`);
    const scoring = el("data-scoring");
    const holes = el("data-holes");
    const addRound = el("data-add-round");
    const build = el("data-build-pairs");
    const addMatch = el("data-add-match");
    const clearRound = el("data-clear-round");
    const dropRound = el("data-drop-round");
    const dropMatch = el("data-drop-match");
    const syncIndividual = el("data-sync-individual");
    const button = scoring || holes || addRound || build || addMatch || syncIndividual || clearRound || dropRound || dropMatch;
    if (!button) return;

    const run = async (fn) => {
      const savedPosition = rememberPosition(button);
      button.disabled = true;
      try { await fn(); } catch (err) { toast(err.message || "That did not work", true); }
      await draw(savedPosition);
    };

    if (holes) {
      const [roundId, want] = holes.dataset.holes.split(":");
      const entry = data.rounds.find((r) => String(r.round.id) === String(roundId));
      if (holesOf(entry?.round) === Number(want)) return;         // already that long
      /*
        Strokes are never touched by this, but what they ADD UP TO changes, so
        say so rather than silently moving the goalposts: stretching a finished
        nine to 18 takes its point back until the second nine is in, and
        shortening a round leaves holes 10-18 in the database, ignored.
      */
      const scored = entry?.battles.some((b) => b.sides.some((s) => s.strokes.size));
      if (scored && !confirm(Number(want) === 18
        ? `Make ${entry?.round.name || "this round"} 18 holes? The strokes already entered stay, but nothing is decided until both sides have all 18 — so any point already awarded goes back on the table.`
        : `Make ${entry?.round.name || "this round"} 9 holes? Anything entered for holes 10–18 stays in the database but stops counting.`)) return;
      return run(async () => {
        const { data: rows, error } = await db().from("golf_rounds")
          .update({ holes: Number(want) }).eq("id", roundId).select("id");
        if (error) throw error;
        if (!rows?.length) throw new Error("The database refused that. Sign in as admin and try again.");
        toast(`${entry?.round.name || "Round"} is now ${want} holes`);
      });
    }

    if (scoring) {
      const [roundId, want] = scoring.dataset.scoring.split(":");
      const entry = data.rounds.find((r) => String(r.round.id) === String(roundId));
      if (scoringOf(entry?.round) === want) return;      // already how it is read
      return run(async () => {
        /* select("id") back, because row level security turns a refused write
           into zero rows and a cheerful 204 - without asking for the row we
           would report a change that never happened. */
        const { data: rows, error } = await db().from("golf_rounds")
          .update({ scoring: want }).eq("id", roundId).select("id");
        if (error) throw error;
        if (!rows?.length) throw new Error("The database refused that. Sign in as admin and try again.");
        toast(`${entry?.round.name || "Round"} is now ${SCORING_NAMES[want].toLowerCase()}`);
      });
    }

    if (addRound) {
      return run(async () => {
        const { data: roundId, error } = await db().rpc("golf_add_round", {
          p_outing_id: Number(outingId), p_format: addRound.dataset.addRound,
        });
        if (error) throw error;
        if (addRound.dataset.addRound === "singles") {
          const synced = await db().rpc("golf_sync_individual_match", { p_round_id: Number(roundId) });
          if (synced.error) throw synced.error;
          toast("Individual match ready");
        } else toast("2v2 round added");
      });
    }

    if (syncIndividual) {
      const entry = data.rounds.find((r) => String(r.round.id) === String(syncIndividual.dataset.syncIndividual));
      const scored = entry?.battles.some((battle) => battle.sides.some((side) => side.strokes.size));
      if (scored) return void toast("Clear this round's strokes before changing the field", true);
      return run(async () => {
        const { error } = await db().rpc("golf_sync_individual_match", { p_round_id: Number(syncIndividual.dataset.syncIndividual) });
        if (error) throw error;
        toast(`${data.parts.length}-golfer individual match ready`);
      });
    }

    if (build) {
      const entry = data.rounds.find((r) => String(r.round.id) === String(build.dataset.buildPairs));
      if (entry?.battles.length && !confirm("Rebuild this round's pairs from scratch? Any pairing you set by hand will be replaced.")) return;
      return run(async () => {
        const { data: made, error } = await db().rpc("golf_build_pairs", { p_round_id: Number(build.dataset.buildPairs) });
        if (error) throw error;
        toast(`${made} match${made === 1 ? "" : "es"} built`);
      });
    }

    if (addMatch) {
      return run(async () => {
        const roundId = addMatch.dataset.addMatch;
        const first = host.querySelector(`[data-match-team-a="${roundId}"]`)?.value;
        const second = host.querySelector(`[data-match-team-b="${roundId}"]`)?.value;
        await createMatch(roundId, first, second);
        toast("Match added — pick the players below");
      });
    }

    if (clearRound) {
      const entry = data.rounds.find((r) => String(r.round.id) === String(clearRound.dataset.clearRound));
      if (!confirm(`Delete every stroke entered in ${entry?.round.name || "this round"}? This cannot be undone.`)) return;
      return run(async () => {
        const sideIds = (entry?.battles || []).flatMap((b) => b.sides.map((s) => s.id));
        if (!sideIds.length) return;
        const { error } = await db().from("golf_match_scores").delete().in("side_id", sideIds);
        if (error) throw error;
        toast("Round cleared");
      });
    }

    if (dropRound) {
      const entry = data.rounds.find((r) => String(r.round.id) === String(dropRound.dataset.dropRound));
      if (!confirm(`Delete ${entry?.round.name || "this round"} entirely — its matches, its pairs and its strokes? This cannot be undone.`)) return;
      return run(async () => {
        const { error } = await db().from("golf_rounds").delete().eq("id", dropRound.dataset.dropRound);
        if (error) throw error;
        toast("Round deleted");
      });
    }

    if (dropMatch) {
      if (!confirm("Delete this match, along with any strokes in it?")) return;
      return run(async () => {
        const { error } = await db().from("golf_matches").delete().eq("id", dropMatch.dataset.dropMatch);
        if (error) throw error;
      });
    }
  });
}

function stop() { clearInterval(timer); timer = 0; host = null; boardHost = null; }

function boot() {
  wireShare();
  const find = () => {
    const el = document.querySelector("#golf-outing .golf-matches-page");
    if (!el) { if (host) stop(); return; }
    /* The board host is optional: a page that leaves no hole for it simply
       does not get a board, rather than this refusing to draw the rounds. */
    boardHost = document.querySelector("#golf-outing .golf-board-page");
    if (el === host) return;
    const q = new URLSearchParams(location.hash.split("?")[1] || "");
    outingId = q.get("id");
    if (!outingId) return;
    host = el;
    wire();
    draw();
    clearInterval(timer);
    timer = setInterval(() => {
      if (!document.body.contains(host)) return stop();
      /* Don't redraw under somebody's thumb: an admin with a seat picker open
         would have it closed and reset mid-choice. */
      if (document.hidden || host.contains(document.activeElement)) return;
      draw();
    }, POLL_MS);
  };
  new MutationObserver(find).observe(document.body, { childList: true, subtree: true });
  find();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

/* =====================================================================
   golf-live.js - the live leaderboard, off the tournament's own strokes
   ---------------------------------------------------------------------
   WHO IS PLAYING BEST RIGHT NOW. Not who is winning the day - that is
   points, and golf-matches.js owns it. This is strokes against par, which
   is the question somebody standing on a tee actually asks.

   TWO UNITS, AND THE DATA DECIDES WHICH ONE IS HONEST
     TEAM      every ball that team has in the selected round(s), added up.
               One number per team: who is playing the best golf.
     SINGLES   one row per player - but only where a player HAS a number of
               their own. A 2v2 nine records ONE ball per pair, so in those
               rounds the row is the pair, said out loud as a pair. Calling
               a shared ball an individual score would be inventing data.

   THE ROUND SELECTOR
     The day is three nines with their own matches and their own strokes
     (see golf_matches_schema.sql), so "the leaderboard" was always
     ambiguous. All rounds is the running total; a single round is the nine
     just played, which stays readable after the next one starts.

   WHY NOT golf_scores
     That table is one row per (outing, team, hole) - a single card for a
     whole team of six. It is a different scoring system to the tournament,
     and a board built on it cannot answer either question above. It is
     still the right board for an outing played that way, so pages/golf.js
     keeps it and only leaves this hole once rounds and matches exist.

   Boots off the .golf-live-page placeholder, the way the draft board, the
   scorecards and the tournament board do.
   ===================================================================== */
import { db } from "./supabase.js";
import { esc, empty } from "./ui.js";
import { loadMembers } from "./members.js";
import { roundLabel, roundShort, roundBoard, groupLabel, currentRound,
         label, tone, progress, strokeLine } from "./golf-board.js";
import { memberNames, playerName } from "./golf-people.js";
import { pendingForSide, onQueueChange } from "./golf-offline.js";
import { teamInk } from "./brand-ink.js";

const POLL_MS = 15000;

let host = null, outingId = null, timer = 0, dropQueueWatch = null, data = null;

/* ------------------------------------------------------------------ state

   WHICH ROUND SURVIVES THE POLL, AND THAT IS THE WHOLE REASON IT IS
   STORED. A 15s tick that repaints the rows must not throw somebody back
   to round 1 while they are reading round 3 - and it would, because the
   tick rebuilds the list from data, not from the DOM. Per outing, because
   "round 2" means nothing on a different day.

   Empty means "not chosen yet", which is not the same as round 1: an
   unchosen board opens on the round being played (currentRound), and only
   a deliberate tap pins it.
*/
const stateKey = (id) => `dfl.golfLive.${id}`;
function readState(id) {
  try {
    const raw = localStorage.getItem(stateKey(id)) || "";
    /* Migrating past the first shape of this card, which stored
       {unit, round} with round possibly "all". Neither exists now. */
    const value = raw.startsWith("{") ? String(JSON.parse(raw).round || "") : raw;
    const chosen = value && value !== "all" ? value : "";
    if (chosen && data?.rounds?.some((r) => String(r.id) === chosen)) return chosen;
    return data ? String(currentRound(data.rounds, data.balls)?.id ?? "") : chosen;
  } catch {
    return data ? String(currentRound(data.rounds, data.balls)?.id ?? "") : "";
  }
}
function writeState(id, chosen) {
  try { localStorage.setItem(stateKey(id), String(chosen)); } catch { /* private mode */ }
}

// ------------------------------------------------------------------- load

async function load(id) {
  const none = { data: [], error: null };
  const [roundsRes, matchesRes, teamsRes, partsRes, holesRes, members] = await Promise.all([
    db().from("golf_rounds").select("id,round_number,name,format,holes,scoring").eq("outing_id", id).order("round_number"),
    db().from("golf_matches").select("id,round_id,match_number").eq("outing_id", id).order("match_number"),
    db().from("golf_teams").select("id,name,color,sort_order").eq("outing_id", id).order("sort_order"),
    db().from("golf_participants").select("id,member_id,guest_name").eq("outing_id", id),
    db().from("golf_holes").select("hole,par").eq("outing_id", id).order("hole"),
    loadMembers().catch(() => []),
  ]);
  if (roundsRes.error || matchesRes.error) throw roundsRes.error || matchesRes.error;

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

  const names = memberNames(members || []);
  const byPart = new Map((partsRes.data || []).map((p) => [String(p.id), p]));
  const teamById = new Map((teamsRes.data || []).map((t) => [String(t.id), t]));
  const roundById = new Map((roundsRes.data || []).map((r) => [String(r.id), r]));
  const matchById = new Map(matches.map((m) => [String(m.id), m]));

  const posted = new Map();
  for (const row of scoresRes.data || []) {
    const key = String(row.side_id);
    if (!posted.has(key)) posted.set(key, new Map());
    posted.get(key).set(Number(row.hole), Number(row.strokes));
  }

  /*
    ONE BALL. Everything below reads a side, never a score row, because a
    side is what the format actually scores: a pair in rounds 1-2 and a
    person in round 3.
  */
  const balls = sides.map((s, i) => {
    const match = matchById.get(String(s.match_id));
    const round = match ? roundById.get(String(match.round_id)) : null;
    const team = teamById.get(String(s.team_id));
    const mine = (playersRes.data || []).filter((p) => String(p.side_id) === String(s.id));
    return {
      id: s.id,
      matchId: s.match_id,
      matchNumber: match?.match_number ?? 0,
      round,
      teamId: s.team_id,
      teamName: team?.name || "Team",
      teamOrder: team?.sort_order ?? i,
      color: teamInk(team?.color, team?.sort_order ?? i),
      players: mine.map((p) => ({
        participantId: p.participant_id,
        name: playerName(byPart.get(String(p.participant_id)), names),
      })),
      /* raw is what the database says; strokes is that plus anything this
         device still has queued. Keeping both means a queue that drains is
         recomputed from the truth rather than patched in place. */
      raw: posted.get(String(s.id)) || new Map(),
      get strokes() { return withPending(this.id, this.raw); },
    };
  });

  return {
    rounds: roundsRes.data || [],
    teams: teamsRes.data || [],
    holes: holesRes.data || [],
    balls,
  };
}

/*
  A stroke this device has typed but not yet managed to send counts on the
  board too. The alternative is your own pair reading a hole behind while
  you stand there looking at the number you just entered - the same reason
  the team-card board folds its queue in. See golf-offline.js.
*/
function withPending(sideId, rows) {
  const pend = pendingForSide(sideId);
  if (!pend.size) return rows;
  const map = new Map(rows);
  for (const [hole, strokes] of pend) {
    if (strokes == null) map.delete(hole);
    else map.set(Number(hole), Number(strokes));
  }
  return map;
}

/* The arithmetic, the ranking and the round scoping all live in
   golf-board.js - no DOM, and a test runner can load it. */

// ----------------------------------------------------------------- render

function rowMarkup(row, i, href) {
  const lead = i === 0 && !!row.thru;
  const inner = `
  <span class="gl-pos">${lead ? `<svg class="ico-sm" aria-hidden="true"><use href="#i-trophy"></use></svg>` : ""}<b>${i + 1}</b></span>
  <span class="gl-team"><strong>${esc(row.name)}</strong><small class="glv-team">${esc(row.teamName || "")}</small></span>
  <span class="gl-score" data-tone="${tone(row)}">${esc(label(row))}</span>
  <span class="gl-thru"><b>${esc(progress(row))}</b><small>${esc(strokeLine(row))}</small></span>`;
  const aria = `${row.name}, ${label(row)}, ${progress(row)}`;
  return href
    ? `<a class="gl-row${lead ? " is-leader" : ""}" style="--racer:${esc(row.color || "")}" href="${esc(href)}" aria-label="${esc(aria)} — open this card">${inner}</a>`
    : `<div class="gl-row${lead ? " is-leader" : ""}" style="--racer:${esc(row.color || "")}" aria-label="${esc(aria)}">${inner}</div>`;
}

/* One pill per round and nothing else. There is no unit toggle: what a row
   means is a fact about the round, not a thing to choose. */
function controls(chosen) {
  return `<div class="glv-controls">
    <div class="glv-rounds" aria-label="Which round">${data.rounds.map((r) => `
      <button type="button" class="glv-pill${String(r.id) === chosen ? " on" : ""}" data-round="${esc(String(r.id))}"
        title="${esc(roundLabel(r))}" aria-pressed="${String(r.id) === chosen}">${esc(roundShort(r))}</button>`).join("")}
    </div>
  </div>`;
}

function round(chosen) {
  return data.rounds.find((r) => String(r.id) === chosen) || data.rounds[0] || null;
}

function body(chosen) {
  const r = round(chosen);
  if (!r) return { note: "", list: empty("No rounds yet.") };
  const groups = roundBoard(data, r);
  if (!groups.length) return { note: "", list: empty(`${roundLabel(r)} has no matches yet.`) };

  /* Only a mixed round needs headings; a round that is all pairs or all
     singles says so once in the note and lets the rows be the card. */
  const mixed = groups.length > 1;
  const note = mixed
    ? `${roundLabel(r)} — pairs and singles ranked separately.`
    : groups[0].kind === "pairs"
      ? `${roundLabel(r)} is 2v2 — each pair shares one ball, ranked against par.`
      : `${roundLabel(r)} is singles — each player ranked against par.`;

  const list = groups.map(({ kind, rows }) => `${
    mixed ? `<div class="glv-group">${esc(groupLabel(kind))}</div>` : ""
  }${rows.map((row, i) => rowMarkup(row, i, `#/golf?id=${outingId}&match=${row.matchId}`)).join("")}`).join("");
  return { note, list };
}

/* Folded, the card is one line, so that line has to be the answer: who is
   leading the round and by what. Same badge the tournament board carries. */
function foldBadge(chosen) {
  const groups = roundBoard(data, round(chosen));
  const top = groups.flatMap((g) => g.rows).find((row) => row.thru);
  return top ? `${top.name} ${label(top)}` : "";
}

function paint() {
  if (!host || !data) return;
  const chosen = readState(outingId);
  const { note, list } = body(chosen);
  host.innerHTML = `<section class="card golf-live ge-live" data-collapse="golf-live" data-collapse-title="Live leaderboard" data-collapse-badge="${esc(foldBadge(chosen))}">
    <div class="gl-head">
      <div><span class="gl-kicker">Live leaderboard</span><p class="muted tiny">Against par, this round.</p></div>
      <span class="badge live">Live</span>
    </div>
    ${controls(chosen)}
    ${note ? `<p class="glv-note">${esc(note)}</p>` : ""}
    <div class="golf-leader-list" data-live-list>${list}</div>
  </section>`;
}

/* Only the rows and the note. Rebuilding the card would drop the round
   pills out from under the thumb of anybody pressing one as the poll landed. */
function repaintList() {
  if (!host || !data) return;
  const list = host.querySelector("[data-live-list]");
  if (!list) return paint();
  const chosen = readState(outingId);
  const built = body(chosen);
  list.innerHTML = built.list;
  const note = host.querySelector(".glv-note");
  if (note) note.textContent = built.note;
}

// ------------------------------------------------------------------- wire

function onClick(event) {
  const pill = event.target.closest("[data-round]");
  if (!pill) return;
  writeState(outingId, pill.dataset.round);
  paint();
}

/*
  A failed read is ignored on purpose: out of signal the right thing to
  show is the last board we had, not an error where the standings were.
*/
async function tick() {
  if (!host?.isConnected) return stop();
  try {
    data = await load(outingId);
    repaintList();
  } catch { /* keep the last good board */ }
}

function stop() {
  clearInterval(timer);
  timer = 0;
  dropQueueWatch?.();
  dropQueueWatch = null;
  host = null;
  data = null;
}

/*
  THE PLACEHOLDER IS THE DECISION.

  pages/golf.js only leaves a .golf-live-page hole once it has seen rounds
  AND matches. An outing with neither keeps the old team-card board, so the
  fallback needs no flag passed down here and no second opinion about which
  board an outing should get - there is exactly one place that chooses, and
  the DOM carries the answer.
*/
function boot() {
  const find = () => {
    const el = document.querySelector("#golf-outing .golf-live-page");
    if (!el) { if (host && !host.isConnected) stop(); return; }
    if (el === host) return;
    const q = new URLSearchParams(location.hash.split("?")[1] || "");
    const id = q.get("id");
    if (!id) return;
    stop();
    host = el;
    outingId = String(id);
    host.addEventListener("click", onClick);
    void start();
  };
  new MutationObserver(find).observe(document.body, { childList: true, subtree: true });
  find();
}

async function start() {
  const mine = host;
  let loaded;
  try {
    loaded = await load(outingId);
  } catch (err) {
    /* No board rather than a broken one. Reaching here means the reads fell
       over, not that the day has no tournament - that case never mounts. */
    console.warn("golf: live leaderboard unavailable", err);
    if (host === mine && host) host.innerHTML = "";
    return;
  }
  if (host !== mine || !host?.isConnected) return;
  data = loaded;
  paint();
  clearInterval(timer);
  timer = setInterval(tick, POLL_MS);
  /* Typing a stroke on a card should move this board now, not in 15s. */
  /* The strokes getter already folds the queue in, so a change just repaints. */
  dropQueueWatch = onQueueChange(() => { if (data) repaintList(); });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

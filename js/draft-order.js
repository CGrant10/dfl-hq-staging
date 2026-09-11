// =====================================================================
// draft-order.js - where every team picks from, this year
// ---------------------------------------------------------------------
// The app already knew what round a player went in. It did not know the
// question everybody actually asks in August: WHERE DO I PICK.
//
// Those are different facts living in different places. A pick's draft_slot
// only exists once the pick has been made, so a draft still in pre_draft
// has nothing to read. The order lives on the draft OBJECT -
// /draft/<id> -> draft_order ({sleeper_user_id: slot}) and slot_to_roster_id
// - which is why js/sleeper.js gained draft() alongside draftPicks().
//
// THREE STATES, ALL OF THEM TOLD HONESTLY
//   order set        the board, with your slot called out
//   order not set    the commissioner has not shuffled it yet. Sleeper
//                    returns draft_order: null, and null is the truth here,
//                    not a sync failure. The card says so.
//   no draft at all  no card. Nothing is invented.
//
// THIS FILE IS PURE, and draft-order.spec.js covers all of it. The database
// read lives next door in draft-order-data.js for the same reason
// bottomline-routes.js exists: supabase.js pulls the Supabase client off a
// CDN over https, which the test runner's ESM loader cannot follow, so a
// module a spec imports must not reach it.
// =====================================================================

import { esc } from "./ui.js";

export function ordinal(n) {
  /* Number(null) is 0, which would print "0th" for an absent slot. Nothing
     is an empty string here, not a rank. */
  if (n === null || n === undefined || n === "") return "";
  const num = Number(n);
  if (!Number.isFinite(num)) return "";
  const r = num % 100;
  if (r >= 11 && r <= 13) return `${num}th`;
  return num + (["th", "st", "nd", "rd"][num % 10] || "th");
}

// ---------------------------------------------------------------------
// Reading the order out of Sleeper
// ---------------------------------------------------------------------

/**
 * Slots from the draft object's own order.
 * `draft_order` is {sleeper_user_id: slot} and `slot_to_roster_id` is
 * {slot: roster_id}. Either can be null on a draft nobody has ordered.
 * @param {object} draft  a Sleeper draft object
 * @returns {{draft_slot:number, roster_id:number|null, sleeper_user_id:string|null}[]}
 */
export function slotsFromOrder(draft) {
  const order = draft?.draft_order || null;
  const toRoster = draft?.slot_to_roster_id || null;
  if (!order && !toRoster) return [];

  const bySlot = new Map();
  for (const [slot, rosterId] of Object.entries(toRoster || {})) {
    const n = Number(slot);
    if (!Number.isFinite(n)) continue;
    bySlot.set(n, { draft_slot: n, roster_id: Number(rosterId) || null, sleeper_user_id: null });
  }
  for (const [userId, slot] of Object.entries(order || {})) {
    const n = Number(slot);
    if (!Number.isFinite(n)) continue;
    const row = bySlot.get(n) || { draft_slot: n, roster_id: null, sleeper_user_id: null };
    row.sleeper_user_id = String(userId);
    bySlot.set(n, row);
  }
  return [...bySlot.values()].sort((a, b) => a.draft_slot - b.draft_slot);
}

/**
 * Slots recovered from a draft that has already happened.
 *
 * Round one IS the order: the round-one pick at draft_slot 1 belongs to the
 * team picking first, and so on. This is what fills in 2020-2025, whose
 * drafts finished long before the app stored an order, and it costs no extra
 * request because sync.js already has the picks in hand.
 * @param {object[]} picks  rows from /draft/<id>/picks
 */
export function slotsFromPicks(picks) {
  const first = (picks || []).filter((p) => Number(p?.round) === 1 && p?.draft_slot != null);
  const bySlot = new Map();
  for (const p of first) {
    const n = Number(p.draft_slot);
    if (!Number.isFinite(n) || bySlot.has(n)) continue;
    bySlot.set(n, {
      draft_slot: n,
      roster_id: p.roster_id ?? null,
      sleeper_user_id: p.picked_by || null,
    });
  }
  return [...bySlot.values()].sort((a, b) => a.draft_slot - b.draft_slot);
}

// ---------------------------------------------------------------------
// The card's model
// ---------------------------------------------------------------------

const STATUS_TEXT = {
  pre_draft: "Not started",
  drafting: "On the clock",
  complete: "Complete",
  paused: "Paused",
};

const TYPE_TEXT = { snake: "Snake", linear: "Linear", auction: "Auction" };

/** Has the league moved beyond draft night, even if a sync left status stale? */
export function draftFinished(draft, { slots = [], picks = [], leagueStatus = "", now = Date.now() } = {}) {
  if (!draft) return false;
  if (draft.status === "complete") return true;
  if (["in_season", "post_season", "complete"].includes(String(leagueStatus))) return true;
  const rounds = Number(draft.rounds);
  const teams = slots.length || new Set(picks.map(p => p?.roster_id).filter(v => v != null)).size;
  const expected = rounds * teams;
  if (Number.isFinite(expected) && expected > 0 && picks.length >= expected) return true;
  /* A missed sync must not pin yesterday's order to Home forever. Twelve
     hours leaves room for a long draft and overnight pauses. `drafting` is
     deliberately exempt: an actually active room always wins over the clock. */
  const start = Number(draft.start_time_ms);
  return draft.status !== "drafting" && Number.isFinite(start) && start > 0 && now >= start + 12 * 60 * 60 * 1000;
}

/** Is this draft still worth the front page? */
export function stillCurrent(draft, now = Date.now(), evidence = {}) {
  if (!draft) return false;
  return !draftFinished(draft, { ...evidence, now });
}

/**
 * Fold the two tables and the member list into what the card draws.
 * @returns {null|object} null when there is nothing worth showing.
 */
export function draftView({ draft = null, slots = [], picks = [], members = [], meSleeperId = null, leagueStatus = "", now = Date.now() } = {}) {
  if (!stillCurrent(draft, now, { slots, picks, leagueStatus })) return null;

  const nameOf = (uid) => {
    if (!uid) return "";
    const m = members.find((x) => String(x.sleeper_user_id) === String(uid));
    return m?.team_name || m?.display_name || "";
  };

  const board = [...slots]
    .filter((s) => Number.isFinite(Number(s?.draft_slot)))
    .sort((a, b) => Number(a.draft_slot) - Number(b.draft_slot))
    .map((s) => ({
      slot: Number(s.draft_slot),
      /* An unnamed slot is a real thing: a roster whose Sleeper account was
         deleted, or an order set before the app knew the member. It gets a
         dash rather than being dropped, because dropping it would silently
         renumber the board. */
      name: nameOf(s.sleeper_user_id) || "—",
      mine: !!meSleeperId && String(s.sleeper_user_id) === String(meSleeperId),
    }));

  const mine = board.find((r) => r.mine) || null;
  const startMs = Number(draft.start_time_ms);

  return {
    season: Number(draft.season) || null,
    status: draft.status || "",
    statusText: STATUS_TEXT[draft.status] || "",
    /* The raw value as well as the label: pickNumbers() turns the board
       around on a snake and does not on a linear, and "Snake" is a word for
       a reader rather than something to branch on. */
    type: draft.draft_type || "",
    typeText: TYPE_TEXT[draft.draft_type] || "",
    rounds: Number(draft.rounds) || null,
    startAt: Number.isFinite(startMs) && startMs > 0 ? new Date(startMs) : null,
    orderKnown: board.length > 0,
    teams: board.length,
    board,
    mySlot: mine ? mine.slot : null,
  };
}

/** The post-draft league field that replaces the order on Home. */
export function seasonTeamsView({ draft = null, slots = [], picks = [], members = [], meSleeperId = null, leagueStatus = "" } = {}) {
  if (!draftFinished(draft, { slots, picks, leagueStatus })) return null;
  const memberBySleeper = new Map(members.filter(m => m?.sleeper_user_id).map(m => [String(m.sleeper_user_id), m]));
  const countsByRoster = new Map();
  const countsBySleeper = new Map();
  picks.forEach(pick => {
    if (pick?.roster_id != null) countsByRoster.set(String(pick.roster_id), (countsByRoster.get(String(pick.roster_id)) || 0) + 1);
    if (pick?.sleeper_user_id) countsBySleeper.set(String(pick.sleeper_user_id), (countsBySleeper.get(String(pick.sleeper_user_id)) || 0) + 1);
  });
  const source = slots.length ? slots : [...new Map(picks.filter(p => p?.roster_id != null).map(p => [String(p.roster_id), p])).values()];
  const teams = source.map((slot, index) => {
    const sleeperId = slot?.sleeper_user_id == null ? "" : String(slot.sleeper_user_id);
    const member = memberBySleeper.get(sleeperId);
    const rosterId = slot?.roster_id == null ? String(index + 1) : String(slot.roster_id);
    return {
      id: rosterId,
      sleeperId,
      name: member?.team_name || member?.display_name || `Team ${index + 1}`,
      owner: member?.display_name || "Unassigned owner",
      players: countsByRoster.get(rosterId) || countsBySleeper.get(sleeperId) || 0,
      mine: !!meSleeperId && sleeperId === String(meSleeperId),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { season: Number(draft.season) || null, pickCount: picks.length, teams };
}

export function seasonTeamsCard(view) {
  if (!view?.teams?.length) return "";
  const season = view.season ? `<span class="sf-season">${esc(String(view.season))}</span>` : "";
  return `<section class="block season-field">
    <h2 class="section-title">The League Is Set${season}<a class="section-link" href="#/analyzer">Team Analyzer &rarr;</a></h2>
    <div class="card sf-card"><div class="sf-lead">
      <div><small>ROSTERS LOCKED</small><strong>${view.teams.length}</strong><span>${view.pickCount ? `${view.pickCount} players selected` : "Teams are ready for the season"}</span></div>
      <p>Draft night is over. Compare every roster, find the strongest position groups and shop possible trades.</p>
      <a class="btn primary small" href="#/analyzer">Open Analyzer</a>
    </div><div class="sf-grid">${view.teams.map(team => `<a href="#/analyzer?${team.sleeperId ? `owner=${encodeURIComponent(team.sleeperId)}` : `team=${encodeURIComponent(team.id)}`}" class="sf-team ${team.mine ? "is-me" : ""}">
      <span class="sf-avatar">${esc((Array.from(team.name.trim())[0] || "D").toUpperCase())}</span><span><strong>${esc(team.name)}</strong><small>${esc(team.owner)}${team.players ? ` · ${team.players} players` : ""}</small></span>${team.mine ? `<b>YOU</b>` : ""}
    </a>`).join("")}</div></div>
  </section>`;
}

/**
 * The overall pick numbers this slot owns, round by round.
 *
 * This is the fact a draft board is actually consulted for, and it is pure
 * arithmetic the app already had everything it needed to do. On a twelve-team
 * SNAKE, slot 7 picks 7th, then 18th, then 31st - the board turns around at
 * the end of every round, so an odd round counts from the left and an even
 * one from the right. A LINEAR draft never turns, so the same slot picks 7th,
 * 19th, 31st.
 *
 * An auction has no board and no slots, so it gets nothing rather than three
 * meaningless numbers.
 */
export function pickNumbers({ slot, teams, rounds = 3, type = "snake" } = {}) {
  if (!slot || !teams || teams < 1 || slot > teams) return [];
  if (type === "auction") return [];

  const out = [];
  for (let round = 1; round <= rounds; round += 1) {
    const leftToRight = type !== "snake" || round % 2 === 1;
    const inRound = leftToRight ? slot : teams - slot + 1;
    out.push((round - 1) * teams + inRound);
  }
  return out;
}

/** "Snake - 15 rounds - Thu, Aug 27, 7:00 PM": only the parts we know. */
export function metaLine(view) {
  if (!view) return "";
  const bits = [];
  if (view.typeText) bits.push(view.typeText);
  if (view.rounds) bits.push(`${view.rounds} rounds`);
  if (view.startAt) {
    bits.push(view.startAt.toLocaleString([], {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    }));
  } else if (view.statusText) {
    bits.push(view.statusText);
  }
  return bits.join(" · ");
}

// ---------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------

export function draftCard(view) {
  if (!view) return "";

  const season = view.season ? `<span class="do-season">${esc(String(view.season))}</span>` : "";
  const head = `<h2 class="section-title">The Draft${season}<a class="section-link" href="#/keepers">Keepers &rarr;</a></h2>`;
  const meta = metaLine(view);

  if (!view.orderKnown) {
    return `<section class="block draft-order">${head}
      <div class="card do-card"><div class="card-body">
        <div class="state"><span class="state-title">Order not set</span>
        <span>Sleeper has the draft${meta ? ` &mdash; ${esc(meta)}` : ""}, but the order has not been set yet.</span></div>
      </div></div></section>`;
  }

  return `<section class="block draft-order">${head}
    <div class="card do-card"><div class="card-body">
      ${hero(view)}
      ${picks(view)}
      <ol class="do-board">${view.board.map(row).join("")}</ol>
    </div></div></section>`;
}

/*
  THE HERO. One figure, and it is the reader's own slot - the only reason
  this card exists. Somebody with no team on the board gets the board's size
  instead, which is a fact rather than a placeholder.
*/
function hero(view) {
  const figure = view.mySlot ? ordinal(view.mySlot) : String(view.teams);
  const label  = view.mySlot ? "Your pick" : "Teams";
  const meta   = metaLine(view);
  const of     = view.mySlot ? `of ${view.teams}` : "";

  return `<div class="do-hero">
    <b class="do-figure">${esc(figure)}</b>
    <span class="do-hero-text">
      <span class="do-label">${label}${of ? ` &middot; ${of}` : ""}</span>
      ${meta ? `<span class="do-meta">${esc(meta)}</span>` : ""}
    </span>
  </div>`;
}

/*
  WHEN YOU ARE ACTUALLY ON THE CLOCK, which is the question the hero raises
  and does not answer. Three rounds is the useful horizon - far enough to see
  the turn on a snake, short enough to stay one glance.

  Drawn only for a reader with a slot, and only when the draft has the rounds
  to fill it: a two-round draft gets two cells, not three with a fiction in
  the third.
*/
function picks(view) {
  if (!view.mySlot) return "";
  const rounds = Math.min(3, view.rounds || 3);
  const numbers = pickNumbers({
    slot: view.mySlot, teams: view.teams, rounds, type: view.type,
  });
  if (!numbers.length) return "";

  return `<div class="do-picks">${numbers.map((n, i) => `
    <div class="do-pick">
      <span class="do-pick-round">R${i + 1}</span>
      <span class="do-pick-no">${n}</span>
    </div>`).join("")}</div>`;
}

function row(r) {
  return `<li class="do-row${r.mine ? " is-me" : ""}">
    <span class="do-slot">${r.slot}</span>
    <span class="do-team">${esc(r.name)}</span>
    ${r.mine ? `<span class="do-you">You</span>` : ""}
  </li>`;
}

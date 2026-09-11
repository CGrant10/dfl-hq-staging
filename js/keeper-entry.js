// =====================================================================
// keeper-entry.js - the commissioner picks a member, then a player
// ---------------------------------------------------------------------
// WHAT THIS REPLACES
//
// Recording a keeper meant opening the generic inline editor and typing a
// team name, a player name and a round by hand - four free-text fields for
// facts the app already holds. That is where the legacy rows came from:
// `team` holding "Shawn" and `player` holding "Puka", because a person in a
// hurry types what they call somebody. Those rows cannot be joined to
// anything, which is why tenure could not be calculated from them.
//
// So the normal path is now: choose a member, see THEIR roster, tap a player,
// review what the rules engine worked out, save. Nothing is typed that can be
// looked up, and every new row carries member_id and player_id.
//
// THREE STEPS IN ONE SHEET
//
//   member   the canonical league list, with team names
//   player   that member's newest populated roster, searchable, grouped by
//            whether the rules say they can actually be kept
//   review   the autofilled row, with the one field a commissioner may need
//            to overrule and a note field
//
// Back is always available and the sheet never loses what was chosen.
//
// IDENTITY IS NEVER A STRING. The roster is fetched by
// members.sleeper_user_id and the row is written with member_id and
// player_id. `team` and `player` are still written, as the display snapshot
// they always were, so a row reads correctly years later - but nothing keys
// off them.
//
// THE RULES ENGINE IS THE ONLY CALCULATION. Eligibility, tenure and the
// proposed round all come from evaluate() in keeper-rules.js, the same call
// the Advisor makes. There is no second formula in this file.
// =====================================================================

import { db, insertRow } from "./supabase.js";
import { esc, toast } from "./ui.js";
import { loadMembers } from "./members.js";
import { loadPlayers } from "./sleeper.js";
import { trapFocus } from "./focus-trap.js";
import { configFor, describeRules, evaluate, priorSeasonDraftRound,
         priorKeeperSeasons, ruleExample } from "./keeper-rules.js";

/**
 * Open the keeper entry sheet.
 *
 * @param {Object} input
 * @param {number} input.season      the keeper season being recorded
 * @param {Function} input.onSaved   called after a successful save
 */
export async function openKeeperEntry({ season, onSaved = () => {} } = {}) {
  const host = document.createElement("div");
  host.className = "overlay ke-overlay";
  host.innerHTML = `
    <div class="overlay-card wide ke-card" role="dialog" aria-modal="true"
         aria-labelledby="ke-title">
      <header class="ke-head">
        <div>
          <span class="eyebrow">Record a keeper</span>
          <h2 id="ke-title">${esc(season ?? "")} keepers</h2>
          <p class="muted tiny" data-ke-rules></p>
        </div>
        <button type="button" class="btn ghost small" data-ke-close>Close</button>
      </header>
      <div class="ke-body" data-ke-body>
        <p class="muted tiny">Loading the league…</p>
      </div>
    </div>`;
  document.body.appendChild(host);

  /* The existing helper, not a new one. The sheet fills itself in after it
     opens, so the landing point is a function - see focus-trap.js. */
  const release = trapFocus(host.querySelector(".ke-card"), {
    initial: () => host.querySelector("[data-ke-search]")
                || host.querySelector("[data-ke-member]")
                || host.querySelector("[data-ke-close]"),
  });

  const close = () => {
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("hashchange", close);
    release();
    host.remove();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  /* Navigating away must not strand the sheet over the next page - the same
     rule the inline editor follows. */
  window.addEventListener("hashchange", close);
  host.addEventListener("click", (e) => { if (e.target === host) close(); });
  host.querySelector("[data-ke-close]").addEventListener("click", close);

  const body = host.querySelector("[data-ke-body]");
  let data;
  try {
    data = await loadEntryData(season);
  } catch (err) {
    body.innerHTML = `<p class="muted">Could not load the league. ${esc(err.message || "")}</p>`;
    return;
  }

  /*
    THE RULE, AND A WORKED EXAMPLE IN REAL SEASONS.

    "Previous season's draft -1 round" is the rule; "a player drafted in Round
    8 in 2025 would cost Round 7 as a 2026 keeper" is the sentence a
    commissioner can check against their own memory. Both come from the stored
    configuration - see ruleExample().
  */
  const rulesLine = describeRules(data.rules);
  const worked = ruleExample(data.rules, { targetSeason: data.season });
  host.querySelector("[data-ke-rules]").textContent = rulesLine
    ? `${season} rules · ${rulesLine}${worked ? ` — ${worked.text}` : ""}`
    : "No keeper rules are configured for this season";

  /* Sheet state. `member` and `pick` survive stepping backwards, so choosing
     the wrong player does not mean choosing the member again. */
  const state = { step: "member", member: null, pick: null, search: "" };

  const rerender = () => {
    if (state.step === "member") body.innerHTML = memberStep(data);
    else if (state.step === "player") body.innerHTML = playerStep(data, state);
    else body.innerHTML = reviewStep(data, state);
    wire();
  };

  function wire() {
    body.querySelector("[data-ke-back]")?.addEventListener("click", () => {
      state.step = state.step === "review" ? "player" : "member";
      if (state.step === "member") state.pick = null;
      rerender();
    });

    body.querySelectorAll("[data-ke-member]").forEach((el) => {
      el.addEventListener("click", async () => {
        state.member = data.members.find((m) => String(m.id) === el.dataset.keMember) || null;
        state.search = "";
        state.step = "player";
        rerender();
        /* The roster is fetched per member rather than all twelve up front:
           one member is one read, and the commissioner usually wants one. */
        await ensureRoster(data, state.member);
        if (state.step === "player") rerender();
      });
    });

    const search = body.querySelector("[data-ke-search]");
    if (search) {
      search.addEventListener("input", () => {
        state.search = search.value;
        const list = body.querySelector("[data-ke-list]");
        if (list) list.innerHTML = candidateGroups(data, state);
        wirePlayerButtons();
      });
    }
    wirePlayerButtons();

    /* Say so the moment the number stops matching the calculation, rather
       than after saving. §AC: if a field is overridden, make it obvious. */
    const roundInput = body.querySelector("[data-ke-form] input[name=round]");
    if (roundInput) {
      const hint = body.querySelector("[data-ke-override]");
      const proposed = state.pick?.standing?.calculatedRound ?? null;
      roundInput.addEventListener("input", () => {
        const entered = Number(roundInput.value);
        const differs = proposed != null && Number.isFinite(entered) && entered !== proposed;
        hint.textContent = differs
          ? `Override — the rules calculate R${proposed}. This will be saved as R${entered}.`
          : proposed != null
            ? `Calculated R${proposed}. Change it only to overrule the rules.`
            : `No calculated value — the round you enter is the record.`;
        hint.classList.toggle("is-override", differs);
      });
    }

    body.querySelector("[data-ke-form]")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await save(e.currentTarget);
    });
    body.querySelector("[data-ke-next]")?.addEventListener("click", () => {
      state.step = "member";
      state.member = null;
      state.pick = null;
      rerender();
    });
  }

  function wirePlayerButtons() {
    body.querySelectorAll("[data-ke-player]").forEach((el) => {
      el.addEventListener("click", () => {
        const roster = data.rosters.get(String(state.member.id));
        state.pick = roster?.candidates.find((c) => c.playerId === el.dataset.kePlayer) || null;
        if (!state.pick) return;
        state.step = "review";
        rerender();
      });
    });
  }

  /* The first paint. Everything above only DEFINED how to draw. */
  rerender();

  async function save(form) {
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    const pick = state.pick;
    const entered = Number(form.round.value);
    const proposed = pick.standing.calculatedRound;
    const overridden = Number.isFinite(entered) && entered !== proposed;

    /*
      WHAT GETS WRITTEN, and why both shapes are here.

      member_id + player_id are the identity: everything that has to be
      reliable later keys off them. team/player are the SNAPSHOT - what these
      people were called on the day - so a row still reads correctly after a
      rename, exactly as the legacy rows do.

      basis_round + basis_season record WHICH DRAFT the cost was measured
      from, which is the whole thing v1.107.0 got wrong: it wrote a round into
      `original_round` with no season beside it, so a row could not be checked
      afterwards. New rows name the season. `original_round` is left alone and
      left NULL - the old column keeps meaning what it meant on the rows that
      already carry it, and nothing rewrites those.
    */
    const row = {
      year: data.season,
      member_id: state.member.id,
      player_id: pick.playerId,
      team: state.member.team_name || state.member.display_name,
      player: pick.name || `Player ${pick.playerId}`,
      player_name: pick.name || null,
      player_pos: pick.position || null,
      player_team: pick.nflTeam || null,
      team_snapshot: state.member.team_name || null,
      basis_round: pick.standing.basisRound,
      basis_season: pick.standing.basisSeason,
      keeper_year: pick.standing.keeperYear,
      calculated_round: proposed,
      round_cost: Number.isFinite(entered) ? entered : proposed,
      round_overridden: overridden,
      rules_season: data.rules?.effective_season ?? null,
      notes: form.notes.value.trim(),
    };

    try {
      await insertRow("keepers", row);
      toast(overridden
        ? `Saved ${row.player} at R${row.round_cost} (override)`
        : `Saved ${row.player} at R${row.round_cost}`);
      /* Keep the sheet open on the member step so the commissioner can walk
         the league without reopening it every time. */
      data.taken.set(`${data.season}:${pick.playerId}`, true);
      data.existing.push(row);
      /*
        DROP THIS MEMBER'S CACHED ROSTER, or the next visit shows the player
        just saved as still available and the database refuses the second
        insert with a 23505 the commissioner did not deserve. Recomputing also
        picks up the tenure that row just added, so a player who has now used
        their final keeper year reads correctly straight away.
      */
      data.rosters.delete(String(state.member.id));
      state.step = "member";
      state.member = null;
      state.pick = null;
      rerender();
      onSaved();
    } catch (err) {
      button.disabled = false;
      body.querySelector("[data-ke-error]").textContent = saveError(err);
    }
  }
}

/* The two failures worth naming. 23505 is the partial unique index on
   (year, player_id) from keeper_rules_schema.sql doing its job. */
function saveError(err) {
  if (err?.code === "23505") return "That player is already recorded as a keeper this season.";
  const msg = err?.message || "Could not save that keeper";
  if (/member_id|player_id|column/.test(msg)) {
    return "Run keeper_rules_schema.sql then keeper_basis_correction.sql in Supabase to enable keeper entry.";
  }
  return msg;
}

// ------------------------------- data --------------------------------

async function loadEntryData(season) {
  /*
    THE EARLIEST SYNCED SEASON IS NO LONGER READ, and that read is gone with
    it. It existed to warn that a player's first pick might predate the synced
    history, which mattered only while the basis was their earliest pick. A
    2026 keeper asks one question - is there a 2025 pick - and 2019 has no
    bearing on the answer.
  */
  const [members, rulesRes, keepersRes] = await Promise.all([
    loadMembers(),
    db().from("keeper_rules")
      .select("effective_season, max_keeper_seasons, cost_basis, round_adjustment, progression")
      .order("effective_season", { ascending: false }),
    db().from("keepers").select("year, member_id, player_id, player_name, team, player, round_cost"),
  ]);

  const existing = keepersRes.error ? [] : (keepersRes.data || []);
  /* Already recorded for this season, so the picker can say so rather than
     letting the database refuse the save afterwards. */
  const taken = new Map();
  for (const row of existing) {
    if (row.player_id != null && Number(row.year) === Number(season)) {
      taken.set(`${season}:${row.player_id}`, true);
    }
  }

  return {
    season: Number(season),
    members,
    rules: configFor(rulesRes.error ? [] : (rulesRes.data || []), season),
    existing, taken,
    rosters: new Map(),      // memberId -> { season, candidates } , filled lazily
    players: null,
  };
}

/** That member's newest POPULATED roster, evaluated against the rules. */
async function ensureRoster(data, member) {
  const key = String(member.id);
  if (data.rosters.has(key)) return;
  if (!member.sleeper_user_id) {
    data.rosters.set(key, { season: null, candidates: [], noLink: true });
    return;
  }

  const rosterRes = await db().from("sleeper_rosters")
    .select("season, players, team_name")
    .eq("sleeper_user_id", member.sleeper_user_id)
    .order("season", { ascending: false }).limit(4);
  const rows = rosterRes.data || [];
  /* The same rule the Advisor follows: a pre-draft season has a roster for
     everybody and nobody on it. */
  const roster = rows.find((r) => (r.players || []).length) || rows[0] || null;
  const ids = Array.isArray(roster?.players) ? roster.players.map(String) : [];

  if (!ids.length) {
    data.rosters.set(key, { season: roster?.season ?? null, candidates: [], empty: true });
    return;
  }

  const [players, picksRes] = await Promise.all([
    data.players ? Promise.resolve(data.players) : loadPlayers().catch(() => ({})),
    db().from("sleeper_draft_picks")
      .select("season, player_id, round, pick_no, sleeper_user_id")
      .in("player_id", ids),
  ]);
  data.players = players;
  const picks = picksRes.error ? [] : (picksRes.data || []);

  const candidates = ids.map((id) => {
    const meta = players[id] || null;
    /* The keeper basis: this league's draft round in the season BEFORE the one
       being recorded. Not the earliest pick - see priorSeasonDraftRound(). */
    const basis = priorSeasonDraftRound(picks, id, { targetSeason: data.season });
    const prior = priorKeeperSeasons(data.existing, {
      playerId: id, memberId: member.id, beforeSeason: data.season });
    const standing = evaluate({ config: data.rules, targetSeason: data.season,
                                basisRound: basis.round, basisSeason: basis.season,
                                priorKeeperSeasons: prior });
    return {
      playerId: id,
      name: meta?.n || null,
      position: meta?.p || "",
      nflTeam: meta?.t || "",
      basis, standing,
      alreadyKept: data.taken.has(`${data.season}:${id}`),
    };
  });

  /* Skill positions first within each group - a commissioner recording a
     keeper is nearly always looking at one - but nothing is hidden, because
     this is a data-entry tool and an unusual selection has to be possible. */
  const order = { QB: 0, RB: 1, WR: 2, TE: 3 };
  candidates.sort((a, b) =>
    (order[a.position] ?? 9) - (order[b.position] ?? 9) ||
    String(a.name || a.playerId).localeCompare(String(b.name || b.playerId)));

  data.rosters.set(key, { season: roster?.season ?? null, candidates });
}

// ------------------------------- steps -------------------------------

function memberStep(data) {
  return `
    <p class="ke-hint">Choose the member recording a keeper.</p>
    <div class="ke-members">
      ${data.members.map((m) => {
        const mine = data.existing.filter((r) =>
          Number(r.year) === data.season && String(r.member_id) === String(m.id));
        return `
        <button type="button" class="ke-member" data-ke-member="${m.id}">
          <span class="ke-member-main">
            <strong>${esc(m.display_name)}</strong>
            ${m.team_name ? `<span class="muted tiny">${esc(m.team_name)}</span>` : ""}
          </span>
          <span class="ke-member-state">${mine.length
            ? `${mine.length} recorded`
            : `<span class="muted">none yet</span>`}</span>
        </button>`;
      }).join("")}
    </div>`;
}

function playerStep(data, state) {
  const roster = data.rosters.get(String(state.member.id));
  return `
    <div class="ke-step-head">
      <button type="button" class="btn ghost small" data-ke-back>← Members</button>
      <div>
        <strong>${esc(state.member.display_name)}</strong>
        ${roster?.season ? `<span class="muted tiny"> · ${esc(roster.season)} roster</span>` : ""}
      </div>
    </div>
    ${!roster ? `<p class="muted tiny">Reading the roster…</p>` : ""}
    ${roster?.noLink ? `<p class="muted">${esc(state.member.display_name)} is not linked to a
      Sleeper account, so there is no roster to choose from. An admin can link it
      on the Admin page.</p>` : ""}
    ${roster?.empty ? `<p class="muted">No synced season has any players on this roster yet.
      Run <strong>Sync Sleeper</strong> on the Admin page.</p>` : ""}
    ${roster?.candidates?.length ? `
      <label class="ke-search">
        <span class="sr-only">Search this roster</span>
        <input type="search" data-ke-search placeholder="Search ${esc(state.member.display_name)}’s roster"
               value="${esc(state.search)}" autocomplete="off">
      </label>
      <div class="ke-list" data-ke-list>${candidateGroups(data, state)}</div>` : ""}`;
}

/*
  AVAILABLE / NEEDS REVIEW / UNAVAILABLE, and nothing is hidden.

  Seeing WHY somebody cannot be picked is the useful part - "keeper limit
  reached" answers a question the commissioner would otherwise have to work
  out. Unavailable players are listed and not clickable; review players ARE
  clickable, because a missing original round is exactly what a commissioner
  is there to fill in.
*/
function candidateGroups(data, state) {
  const roster = data.rosters.get(String(state.member.id));
  const q = state.search.trim().toLowerCase();
  const match = (c) => !q
    || String(c.name || "").toLowerCase().includes(q)
    || String(c.position || "").toLowerCase() === q
    || String(c.nflTeam || "").toLowerCase() === q;

  const all = (roster?.candidates || []).filter(match);
  const groups = [
    ["Available", all.filter((c) => c.standing.state === "eligible" && !c.alreadyKept)],
    ["Needs review", all.filter((c) => c.standing.state === "review" && !c.alreadyKept)],
    ["Unavailable", all.filter((c) =>
      c.alreadyKept || c.standing.state === "unavailable" || c.standing.state === "no-rules")],
  ];

  if (!all.length) return `<p class="muted tiny">Nobody on this roster matches that search.</p>`;

  return groups.filter(([, list]) => list.length).map(([label, list]) => `
    <div class="ke-group">
      <div class="ke-group-head">${esc(label)}<span class="count">${list.length}</span></div>
      ${list.map((c) => playerRow(c, label === "Unavailable", data.season)).join("")}
    </div>`).join("");
}

function playerRow(c, locked, season) {
  const who = c.name || `Player ${c.playerId}`;
  const where = [c.position, c.nflTeam].filter(Boolean).join(" · ");
  /* SEASON-SPECIFIC, always: "2025 Draft R8 · 2026 Keeper R7". A bare "R8"
     is the ambiguity that let the wrong draft basis survive a release. */
  const line = c.alreadyKept
    ? "Already recorded this season"
    : c.standing.state === "eligible"
      ? `${c.standing.basisSeason} Draft R${c.standing.basisRound} · ${
          season} Keeper R${c.standing.calculatedRound} · ${
          c.standing.finalKeeperYear ? "FINAL YEAR"
            : `Year ${c.standing.keeperYear} of ${c.standing.maxKeeperYears}`}`
      : c.standing.reason;

  return `
    <${locked ? "div" : "button type=\"button\""} class="ke-player ${locked ? "is-locked" : ""}"
        ${locked ? "" : `data-ke-player="${esc(c.playerId)}"`}>
      <span class="ke-player-main">
        <span class="ke-player-name">${esc(who)}</span>
        ${where ? `<span class="ke-player-where">${esc(where)}</span>` : ""}
        <span class="ke-player-line">${esc(line)}</span>
      </span>
      ${c.standing.calculatedRound != null && !c.alreadyKept
        ? `<span class="ke-player-round">R${c.standing.calculatedRound}</span>` : ""}
    </${locked ? "div" : "button"}>`;
}

function reviewStep(data, state) {
  const c = state.pick;
  const s = c.standing;
  const who = c.name || `Player ${c.playerId}`;
  const proposed = s.calculatedRound;

  return `
    <div class="ke-step-head">
      <button type="button" class="btn ghost small" data-ke-back>← ${esc(state.member.display_name)}’s roster</button>
    </div>
    <form data-ke-form class="ke-review">
      <div class="ke-review-who">
        <strong>${esc(who)}</strong>
        <span class="muted tiny">${esc([c.position, c.nflTeam].filter(Boolean).join(" · "))}</span>
        <span class="muted tiny">${esc(state.member.display_name)}${
          state.member.team_name ? ` · ${esc(state.member.team_name)}` : ""} · ${data.season}</span>
      </div>

      <dl class="ke-facts">
        <div><dt>${esc(s.basisSeason ?? "Previous season")} DFL draft</dt><dd>${s.basisRound != null
          ? `Round ${s.basisRound}`
          : `<span class="muted">not found</span>`}</dd></div>
        <div><dt>Keeper year</dt><dd>${s.keeperYear != null
          ? `${s.keeperYear} of ${s.maxKeeperYears}${s.finalKeeperYear ? " · final" : ""}`
          : `<span class="muted">—</span>`}</dd></div>
        <div><dt>${esc(data.season)} keeper cost</dt><dd>${proposed != null
          ? `Round ${proposed}` : `<span class="muted">not calculable</span>`}</dd></div>
      </dl>

      ${s.basisRound == null ? `<p class="ke-warn">${esc(s.reason)}. Enter the keeper
        round yourself to record this one.${c.basis.otherSeasons.length
          ? ` For reference only, this league drafted them in
              ${esc(c.basis.otherSeasons.map((o) => `${o.season} R${o.round}`).join(", "))} —
              none of which is the ${esc(s.basisSeason ?? "")} basis.` : ""}</p>` : ""}

      <label class="ke-field">
        <span>Keeper round</span>
        <input name="round" type="number" min="1" max="40" inputmode="numeric"
               value="${proposed ?? ""}" required>
        <small class="muted tiny" data-ke-override>${proposed != null
          ? `Calculated R${proposed}. Change it only to overrule the rules.`
          : `No calculated value — the round you enter is the record.`}</small>
      </label>

      <label class="ke-field">
        <span>Notes <span class="muted tiny">optional</span></span>
        <input name="notes" type="text" maxlength="120" autocomplete="off"
               placeholder="Why this was overruled, if it was">
      </label>

      <p class="ke-error" data-ke-error role="alert"></p>
      <div class="row-end">
        <button type="button" class="btn ghost small" data-ke-back>Back</button>
        <button type="submit" class="btn">Save keeper</button>
      </div>
    </form>`;
}

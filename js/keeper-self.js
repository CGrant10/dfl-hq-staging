// =====================================================================
// keeper-self.js - a member chooses their own keeper.
// ---------------------------------------------------------------------
// Until now the commissioner entered every keeper for every member by hand
// (keeper-entry.js, and that flow is untouched - a commissioner may still
// enter anybody's, and may still override a round, which a member may not).
//
// THIS FILE DECIDES NOTHING. Every rule lives in keeper_self_entry_schema.sql
// and is enforced server-side: your own keeper, from your own roster, season
// not locked, and the cost computed from the rules rather than accepted from
// here. That is deliberate - a member write that trusted the browser for its
// own price would be a keeper you could set to round 20.
//
// So this module asks the database what it may do (keeper_self_status), draws
// that, and posts the choice (keeper_set_self). When the migration has not
// been run the RPCs 404 and the card simply does not appear, which is the same
// way the rest of the app degrades.
// =====================================================================

import { db } from "./supabase.js";
import { keeperTenure } from "./keeper-rules.js";
import { esc, toast } from "./ui.js";
import { verifiedPin } from "./member-lock.js";

const MISSING = /keeper_self_status|keeper_set_self|keeper_clear_self|does not exist|not find the function|schema cache/i;

/**
 * What this member may do with their keeper this season.
 *
 * Returns null when the migration is absent, which the caller treats as "do
 * not draw the card at all" rather than as an error - a league that has not
 * run it has not opted into member entry.
 */
export async function selfStatus(season) {
  try {
    const { data, error } = await db().rpc("keeper_self_status", { target_season: Number(season) });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row || null;
  } catch (err) {
    if (MISSING.test(err?.message || "")) return null;
    throw err;
  }
}

/** This member's own keeper rows for the season, newest first. */
export async function myKeepers(season, memberId) {
  if (!memberId) return [];
  const { data, error } = await db()
    .from("keepers")
    .select("id,player_id,player_name,player_pos,player_team,round_cost,basis_round,basis_season,self_submitted,created_at")
    .eq("year", Number(season))
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

/*
  WHICH PLAYERS THE PICKER OFFERS.

  Only `eligible` candidates, because the other classes cannot be priced and
  the server would refuse them with a sentence the member cannot act on. A
  player whose basis round is missing is exactly the case that still needs the
  commissioner, and the card says so rather than offering a button that fails.

  The Advisor has already computed all of this for the same member and the same
  season - this reuses its candidate list rather than reading the roster again.
*/
export function pickable(candidates = []) {
  return candidates.filter((c) => c.standing === "eligible" && c.keeperCost != null);
}

function costLine(c) {
  const basis = c.basisSeason && c.basisRound ? `${c.basisSeason} R${c.basisRound}` : "no draft round";
  return `${basis} → R${c.keeperCost}`;
}

/*
  WHO ENTERED IT IS WORTH SAYING. IT IS NOT WORTH BLOCKING ON.

  This card used to refuse when the row came from the commissioner - no picker,
  no Remove, just "ask them to change it". Wrong model: the member always has a
  say. It is their roster and their keeper, and a commissioner entering one on
  their behalf is a convenience rather than a decision taken away from them.

  So the row is still LABELLED with where it came from, which is useful - "I
  did not choose this" is a real thing to notice - and every control stays
  live. The commissioner's override is the season lock, not row ownership.
*/

/*
  THE HOLD, AS A COUNTER RATHER THAN A SENTENCE.

  A keeper is a three-season allowance and the thing a manager actually wants
  to know is how much of it is gone. "Year 2 of 3" answers it in four words;
  the pips answer it without reading. Both are shown, because the pips alone
  are a puzzle and the words alone are easy to skim past.

  The final season is called out. Running out of keeper years on a player is a
  roster decision with a deadline, and finding out by counting is too late.
*/
function tenureBadge(tenure) {
  if (!tenure || !tenure.max) return "";
  const pips = Array.from({ length: tenure.max }, (_, index) =>
    `<i class="${index < tenure.year ? "is-used" : ""}"></i>`).join("");
  const left = tenure.left === 0
    ? "final season"
    : `${tenure.left} season${tenure.left === 1 ? "" : "s"} left`;
  return `<span class="ks-tenure ${tenure.final ? "is-final" : ""}">
    <span class="ks-pips" aria-hidden="true">${pips}</span>
    <b>Year ${tenure.year}/${tenure.max}</b>
    <em>${esc(left)}${tenure.firstSeason ? ` · kept since ${tenure.firstSeason}` : ""}</em>
  </span>`;
}

function currentList(mine, season, { keeperRows = [], maxKeeperSeasons = null, memberId = null } = {}) {
  if (!mine.length) {
    return `<p class="ks-none">You have not chosen a keeper for ${season} yet.</p>`;
  }
  return `<ul class="ks-mine">${mine.map((row) => {
    const tenure = keeperTenure(keeperRows, {
      playerId: row.player_id, memberId, season, max: maxKeeperSeasons,
    });
    return `
    <li>
      <div class="ks-line">
        <strong>${esc(row.player_name || row.player_id)}</strong>
        ${row.player_pos ? `<span class="ks-pos">${esc(row.player_pos)}</span>` : ""}
        <span class="ks-cost">R${row.round_cost ?? "—"}</span>
      </div>
      ${tenureBadge(tenure)}
      <div class="ks-line ks-sub">
        ${row.basis_season && row.basis_round
          ? `<span class="ks-basis">from ${row.basis_season} R${row.basis_round}</span>` : ""}
        ${row.self_submitted === false
          ? `<span class="ks-basis">entered by the commissioner &middot; you can change it</span>` : ""}
      </div>
    </li>`;
  }).join("")}</ul>`;
}

/**
 * The card. Draws one of three things and never a disabled button with no
 * explanation beside it.
 */
export function selfCard({ season, status, mine = [], options = [],
                           keeperRows = [], maxKeeperSeasons = null }) {
  if (!status) return "";
  /*
    ONLY ASK FOR WHAT WE DO NOT ALREADY HAVE.

    A member who unlocked the app on the way in has already proved this PIN
    once this session, and member-lock.js keeps it precisely so this card does
    not have to ask again. It still goes to the server on every write and is
    still verified against the stored hash there - what changed is that the
    person is not re-typing a secret they typed four seconds ago.

    The field comes back if the PIN is not held: a reload in a tab that never
    saw the lock, or a member who set a PIN after unlocking.
  */
  const held = status.member_id ? verifiedPin(status.member_id) : null;
  const askForPin = !!status.needs_pin && !held;

  if (!status.member_id) {
    return `<section class="card keeper-self"><div class="card-body">
      <h3 class="card-heading">Your ${season} keeper</h3>
      <p class="muted">Pick your name in the top right to choose your keeper.</p>
    </div></section>`;
  }

  /*
    LOCKED IS NOT AN ERROR, it is the commissioner having closed the season -
    so it still shows what you chose, because that is the thing you want to see
    once you can no longer change it.
  */
  if (status.locked) {
    return `<section class="card keeper-self is-locked"><div class="card-body">
      <h3 class="card-heading">Your ${season} keeper</h3>
      ${currentList(mine, season, { keeperRows, maxKeeperSeasons, memberId: status.member_id })}
      <p class="ks-locked">Keepers for ${season} are locked. Ask the commissioner if
        something is wrong.</p>
    </div></section>`;
  }

  const slots = Number(status.max_keepers) || 1;
  const used = Number(status.used_slots) || 0;

  return `<section class="card keeper-self"><div class="card-body">
    <h3 class="card-heading">Your ${season} keeper</h3>
    ${currentList(mine, season, { keeperRows, maxKeeperSeasons, memberId: status.member_id })}

    ${options.length ? `
      <form class="ks-form" data-keeper-self-form autocomplete="off">
        <label for="ks-player">${used >= slots && slots === 1 ? "Change to" : "Keep"}</label>
        <select id="ks-player" name="player" required>
          <option value="">Choose a player…</option>
          ${options.map((c) => `
            <option value="${esc(c.playerId)}"
                    data-name="${esc(c.name || "")}"
                    data-pos="${esc(c.position || "")}"
                    data-team="${esc(c.nflTeam || "")}">
              ${esc(c.name || c.playerId)}${c.position ? ` (${esc(c.position)})` : ""} — ${esc(costLine(c))}
            </option>`).join("")}
        </select>

        ${askForPin ? `
          <label for="ks-pin">Your Profile PIN</label>
          <input id="ks-pin" name="pin" type="text" inputmode="numeric" pattern="[0-9]*"
                 minlength="4" maxlength="6" autocomplete="one-time-code"
                 autocapitalize="off" spellcheck="false" required
                 style="-webkit-text-security:disc">
` : ""}

        <div class="row-end">
          ${mine.length ? `<button type="button" class="btn ghost small" data-keeper-self-clear>Remove</button>` : ""}
          <button type="submit" class="btn">${mine.length ? "Change my keeper" : "Save my keeper"}</button>
        </div>
        <p class="ks-error" data-keeper-self-error></p>
      </form>
      ${slots > 1 ? `<p class="muted tiny">The league allows ${slots} keepers.
        Choosing more than that replaces your oldest.</p>` : ""}
    ` : `
      <p class="muted tiny">None of the players on your roster can be priced automatically
        yet - the ${season - 1} draft round is missing for them. The commissioner enters
        those by hand.</p>`}
  </div></section>`;
}

/**
 * Wire the card. `onSaved` re-renders whatever is showing the keeper board.
 */
export function wireSelfCard(host, { season, memberId = null, options = [], onSaved = () => {} } = {}) {
  if (!host) return;
  const byId = new Map(options.map((c) => [String(c.playerId), c]));

  const fail = (form, message) => {
    const box = form.querySelector("[data-keeper-self-error]");
    if (box) box.textContent = message;
    else toast(message, true);
  };

  host.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-keeper-self-form]");
    if (!form) return;
    e.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const box = form.querySelector("[data-keeper-self-error]");
    if (box) box.textContent = "";

    const id = form.player?.value;
    const pick = byId.get(String(id));
    if (!pick) { fail(form, "Choose a player first."); return; }

    button.disabled = true;
    try {
      const { error } = await db().rpc("keeper_set_self", {
        target_season: Number(season),
        pick_player_id: String(pick.playerId),
        pick_name: pick.name || null,
        pick_pos: pick.position || null,
        pick_nfl_team: pick.nflTeam || null,
        attempted_pin: form.pin?.value || verifiedPin(memberId) || null,
      });
      if (error) throw error;
      /*
        The round is NOT read back from `pick` for this message. The server
        priced it, and quoting the client's own number here would be the one
        place the two could disagree in public.
      */
      toast(`${pick.name || "Your keeper"} saved`);
      onSaved();
    } catch (err) {
      button.disabled = false;
      fail(form, err?.message || "That could not be saved.");
    }
  });

  host.addEventListener("click", async (e) => {
    const clear = e.target.closest("[data-keeper-self-clear]");
    if (!clear) return;
    const form = clear.closest("[data-keeper-self-form]");
    if (!confirm(`Remove your ${season} keeper?`)) return;
    clear.disabled = true;
    try {
      const { error } = await db().rpc("keeper_clear_self", {
        target_season: Number(season),
        attempted_pin: form?.pin?.value || verifiedPin(memberId) || null,
      });
      if (error) throw error;
      toast("Your keeper was removed");
      onSaved();
    } catch (err) {
      clear.disabled = false;
      fail(form, err?.message || "That could not be removed.");
    }
  });
}

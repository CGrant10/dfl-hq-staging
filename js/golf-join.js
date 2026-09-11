/* =====================================================================
   golf-join.js - getting into a golf event without a league profile
   ---------------------------------------------------------------------
   THE BUG THIS EXISTS TO FIX.

   Opening the app with no member selected raised "Who are you?" over
   everything, and that overlay could not be dismissed - app.js asked for a
   cancellable one, but the cancel button it looked for had never existed in
   index.html. So the only way past it was to tap somebody's name.

   For half the golf field that is not a nuisance, it is impersonation with
   consequences: picking a name writes dfl.memberId, which is the header the
   golf RLS policies read, so a guest who tapped "DaGrapeApe" to get in
   acquired DaGrapeApe's write access to DaGrapeApe's scorecard.

   So a guest now has their own door, and it never touches member identity.
   No member is selected, no username is registered, no fake member row is
   created. What they get is an event pass: an outing, the participant they
   said they are, and the code - all three re-checked by Postgres on every
   single write. See golf-guest.js and golf_guest_schema.sql.

   THE FLOW, and it is deliberately four taps:

     JOIN        which event (skipped when there is only one)
     CODE        the code off the tee sheet
     NAME        which of these people are you - from the event's OWN
                 roster, because that roster is what the database will
                 authorise against
     CONFIRM     your team, then in

   WHY THE NAME IS PICKED AND NOT TYPED. A typed name authorises nothing.
   Authorisation is a golf_participants row, and only the commissioner can
   create those - that is event configuration, which a guest must not touch.
   So somebody whose name is not on the list is told to ask the
   commissioner rather than being allowed to invent themselves.

   This module is UI only. It is deliberately NOT part of golf-guest.js,
   because supabase.js imports that for the request headers and must not
   end up pulling a wizard in with it.
   ===================================================================== */

import { esc, toast, fmtWhen } from "./ui.js";
import { db } from "./supabase.js";
import { verifyCode, saveGolfPass } from "./golf-guest.js";

/** Events a guest could plausibly be standing at: anything not finished. */
export async function joinableEvents() {
  const { data, error } = await db()
    .from("golf_outings")
    .select("id,name,course,event_date,event_time,status")
    .neq("status", "final")
    .order("event_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Mount the join flow into an element.
 *
 * @param {HTMLElement} host
 * @param {object}  opts
 * @param {number}  [opts.outingId]  skip the event step
 * @param {Function} opts.onDone     (pass) => void, once they are in
 * @param {Function} [opts.onCancel] shows a back door out of the flow
 */
export function mountJoin(host, { outingId = null, onDone, onCancel } = {}) {
  const state = { outing: null, code: "", roster: [], autoPicked: false };

  const shell = (title, sub, body, back) => {
    host.innerHTML = `
      <div class="gj">
        <div class="gj-head">
          <span class="gj-kicker">DFL Golf</span>
          <strong class="gj-title">${esc(title)}</strong>
          ${sub ? `<p class="gj-sub">${esc(sub)}</p>` : ""}
        </div>
        ${body}
        ${back ? `<div class="gj-back"><button type="button" class="linkbtn" data-gj-back>${esc(back)}</button></div>` : ""}
      </div>`;
  };

  // ------------------------------------------------------------- step 1
  async function pickEvent() {
    shell("Join the event", "Which one are you at?", `<div class="gj-list" data-gj-events>
      <div class="state is-loading">Looking for events…</div></div>`,
      onCancel ? "Not here for golf" : "");
    host.querySelector("[data-gj-back]")?.addEventListener("click", () => onCancel?.());

    let events = [];
    try { events = await joinableEvents(); }
    catch { host.querySelector("[data-gj-events]").innerHTML =
      `<div class="state is-error">Could not reach the league. Try again when you have signal.</div>`; return; }

    if (!events.length) {
      host.querySelector("[data-gj-events]").innerHTML =
        `<div class="state"><span class="state-title">No event running</span>
         <span>There is no golf event open to join right now.</span></div>`;
      return;
    }
    if (events.length === 1) {
      /* One event is not a choice. Skipping the step is right, but then "back"
         cannot mean "pick a different event" - there is no other one, and the
         first cut bounced straight into the code step again with no way out to
         the member picker. */
      state.outing = events[0];
      state.autoPicked = true;
      return askCode();
    }

    host.querySelector("[data-gj-events]").innerHTML = events.map((e) => `
      <button type="button" class="memberbtn" data-gj-event="${esc(e.id)}">
        <span class="memberbtn-text">
          <strong>${esc(e.name)}</strong>
          ${e.course || e.event_date ? `<span class="muted tiny">${esc([e.course, e.event_date ? fmtWhen(e.event_date, e.event_time) : null].filter(Boolean).join(" · "))}</span>` : ""}
        </span>
      </button>`).join("");
    host.querySelector("[data-gj-events]").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-gj-event]");
      if (!b) return;
      state.outing = events.find((e) => String(e.id) === b.dataset.gjEvent);
      askCode();
    });
  }

  /* True when there was never an event to choose - either the caller named
     one, or there was only one to find. */
  const skippedEventStep = () => !!outingId || state.autoPicked;

  // ------------------------------------------------------------- step 2
  function askCode() {
    shell("Event code", state.outing?.name || "", `
      <form class="gj-form" data-gj-code>
        <label for="gj-code">Enter the code</label>
        <input id="gj-code" name="code" type="text" inputmode="text" autocomplete="off"
               autocapitalize="characters" spellcheck="false" enterkeyhint="go"
               placeholder="e.g. ROLLA26" required>
        <p class="gj-msg muted tiny" data-gj-msg>Whoever set the event up has it.</p>
        <button class="btn" type="submit">Continue</button>
      </form>`, skippedEventStep() ? (onCancel ? "Not here for golf" : "") : "Pick a different event");

    const form = host.querySelector("[data-gj-code]");
    const msg = host.querySelector("[data-gj-msg]");
    host.querySelector("[data-gj-back]")?.addEventListener("click",
      () => (skippedEventStep() ? onCancel?.() : pickEvent()));
    /* No autofocus. Raising the keyboard the instant a screen appears hides
       the thing somebody is trying to read. */

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = form.code.value.trim();
      if (!code) return;
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true; btn.textContent = "Checking…";
      const fail = (text) => {
        msg.textContent = text;
        msg.className = "gj-msg warntext tiny";
        btn.disabled = false; btn.textContent = "Continue";
      };
      let roster;
      try { roster = await verifyCode(db(), state.outing.id, code); }
      catch (err) {
        console.warn(err);
        return fail("Guest access is not switched on for this event yet.");
      }
      if (!roster.length) return fail("That code is not right for this event.");
      state.code = code;
      state.roster = roster;
      askName();
    });
  }

  // ------------------------------------------------------------- step 3
  function askName() {
    shell("What's your name?", state.outing?.name || "", `
      <div class="gj-list" data-gj-names>
        ${state.roster.map((r) => `
          <button type="button" class="memberbtn" data-gj-part="${esc(r.participant_id)}">
            <span class="memberbtn-text">
              <strong>${esc(r.display_name)}</strong>
              ${r.team_name ? `<span class="muted tiny">${esc(r.team_name)}</span>` : ""}
            </span>
          </button>`).join("")}
      </div>
      <p class="muted tiny gj-note">Not on the list? Whoever runs the event has to add you
        to a team first — nobody can add themselves.</p>`, "Back");

    host.querySelector("[data-gj-back]").addEventListener("click", askCode);
    host.querySelector("[data-gj-names]").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-gj-part]");
      if (!b) return;
      const row = state.roster.find((r) => String(r.participant_id) === b.dataset.gjPart);
      if (row) confirmTeam(row);
    });
  }

  // ------------------------------------------------------------- step 4
  function confirmTeam(row) {
    const hasTeam = row.team_id != null;
    shell("You're on", row.display_name, `
      <div class="gj-confirm">
        <span class="gj-confirm-label">Your team</span>
        <strong class="gj-confirm-team">${esc(hasTeam ? (row.team_name || "Team") : "Not on a team yet")}</strong>
        <p class="muted tiny">${hasTeam
          ? "You can score this team's card and watch the rest. You cannot change anybody else's."
          : "You can watch the event. Once somebody puts you on a team you can score its card."}</p>
      </div>
      <button class="btn" type="button" data-gj-go>Enter DFL Golf</button>`, "Not me");

    host.querySelector("[data-gj-back]").addEventListener("click", askName);
    host.querySelector("[data-gj-go]").addEventListener("click", () => {
      const pass = {
        outing: String(state.outing.id),
        participant: String(row.participant_id),
        code: state.code,
        name: row.display_name,
        teamId: row.team_id != null ? String(row.team_id) : null,
        teamName: row.team_name || "",
      };
      saveGolfPass(pass);
      toast(`You're in — scoring as ${row.display_name}`);
      onDone?.(pass);
    });
  }

  if (outingId) {
    /* Straight to the code when the event is already known - somebody who
       tapped "join" on an event page has answered that question. */
    state.outing = { id: outingId, name: "" };
    joinableEvents()
      .then((all) => { state.outing = all.find((e) => String(e.id) === String(outingId)) || state.outing; })
      .catch(() => {})
      .finally(askCode);
  } else {
    pickEvent();
  }
}

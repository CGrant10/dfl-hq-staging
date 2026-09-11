// =====================================================================
// Calendar - two tabs:
//   Events      draft date, keeper deadline, trade deadline, gatherings
//   Side Events March Madness, pick'em, survivor pools, whatever else
// =====================================================================

import { db, insertRow } from "../supabase.js";
import { esc, empty, fmtDate, fmtWhen, relDate, toast, errorBox, loading } from "../ui.js";
import { currentMember } from "../members.js";
import { addControl, editControls, wireInline, canEdit, visible, hiddenClass } from "../inline.js";

let tab = "events";

export async function render(view) {
  view.innerHTML = `
    <h1>Calendar</h1>
    <div class="tabs" id="cal-tabs">
      <button data-tab="events" class="${tab === "events" ? "on" : ""}">Events</button>
      <button data-tab="side"   class="${tab === "side" ? "on" : ""}">Side Events</button>
    </div>
    <div id="cal-body"></div>
  `;

  const body = view.querySelector("#cal-body");

  // #cal-body is new on every render and survives paint(), which only
  // replaces what is inside it - so one listener, never doubled.
  wireInline(body, () => paint(body, view));

  view.querySelector("#cal-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (!btn) return;
    tab = btn.dataset.tab;
    view.querySelectorAll("#cal-tabs button")
        .forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    paint(body, view);
  });

  paint(body, view);
}

async function paint(body, view) {
  body.innerHTML = loading();
  try {
    if (tab === "events") await paintEvents(body);
    else                  await paintSide(body, view);
  } catch (err) {
    body.innerHTML = errorBox(err);
  }
}

// ---------------------------------------------------------------- events

async function paintEvents(body) {
  const { data, error } = await db().from("events").select("*")
    .order("event_date", { ascending: true });
  if (error) throw error;

  const today    = new Date().toISOString().slice(0, 10);
  const shown    = visible("events", data);
  const upcoming = shown.filter((e) => e.event_date >= today);
  const past     = shown.filter((e) => e.event_date < today).reverse();

  /*
    ONLY THE NEAREST EVENT IS "NEXT".

    Every upcoming row used to get the .next class, which carries the accent
    rule down its left edge - so a schedule with six things on it had six
    events all claiming to be the next one, and the one question this page
    exists to answer ("what is happening next?") took reading the dates to
    work out. The class now goes to upcoming[0] and nothing else. The list
    is already sorted by event_date ascending, so index 0 IS the nearest:
    no new date arithmetic, and the sort is untouched.
  */
  body.innerHTML = `
    ${upcoming.length
      ? `<div class="card schedule">${upcoming.map((e, i) => eventRow(e, true, i === 0)).join("")}</div>`
      : empty("Nothing on the schedule.")}
    ${canEdit() ? `<div class="row-end">${addControl("events", "Add event")}</div>` : ""}
    ${past.length ? `
      <h2 class="section-title">Past<span class="count">${past.length}</span></h2>
      <div class="card schedule is-past">${past.map((e) => eventRow(e, false, false)).join("")}</div>` : ""}
  `;
}

/**
 * One line per event: the date as a stacked block on the left, the title and
 * details on the right. Scans like a schedule, which is how anybody actually
 * reads this page - "when is the draft" should not need a card each.
 *
 * `isNext` marks the nearest upcoming event and nothing else. It is a
 * modest emphasis on purpose - a stronger surface, a firmer date block and
 * one small label - rather than a hero card, because the value of this list
 * is that the whole season fits on a phone screen.
 */
function eventRow(e, upcoming, isNext = false) {
  const d = new Date(String(e.event_date).length === 10
    ? e.event_date + "T12:00:00" : e.event_date);
  const month = isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short" });
  const day   = isNaN(d) ? "?" : d.getDate();

  return `
    <div class="evrow ${isNext ? "next" : ""} ${hiddenClass("events", e)}">
      <div class="evdate" aria-hidden="true">
        <span class="evmon">${esc(month)}</span>
        <span class="evday">${esc(day)}</span>
      </div>
      <div class="evbody">
        <div class="evtop">
          ${isNext ? `<span class="ev-next-tag">Next</span>` : ""}
          <span class="evtitle">${esc(e.title)}</span>
          <span class="pill ${upcoming ? "green" : "grey"}">${esc(relDate(e.event_date))}</span>
        </div>
        <div class="evwhen">${esc(fmtWhen(e.event_date, e.event_time))}</div>
        ${e.description ? `<div class="evnote">${esc(e.description)}</div>` : ""}
        ${editControls("events", e, { compact: true })}
      </div>
    </div>`;
}

// ----------------------------------------------------------- side events

/*
  A SIGN-UP BELONGS TO A MEMBER.

  This page used to identify people by getUsername() - the free-text league
  name from before the member picker existed - and match them with
  `people.includes(username)`. Three things were wrong with it and all three
  were invisible until they bit:

    * renaming a member orphaned every sign-up they had
    * "Grant" and "grant" were two different people
    * whether the page recognised you depended on a localStorage MIRROR of
      your display name, written by selectMember(), rather than on the member
      you had actually selected - so identity here could disagree with
      identity on Polls, which has used member_id for a while

  It is member_id now, the same canonical identity Polls, Golf, the Arena and
  Profile all use, and display names are resolved from `members` at paint
  time. Nothing on this page stores a person's name.

  See side_events_member_schema.sql.
*/

/* Set when the database still predates side_events_member_schema.sql.
   Joining cannot work in that state, so the tab says so rather than failing
   to load. Same shape as the notice Polls shows for polls_schema.sql. */
let needsMigration = false;

/**
 * Sign-ups, with member_id when the column is there.
 *
 * A database that has not had side_events_member_schema.sql run against it
 * yet is exactly the state somebody is in the moment they pull this version,
 * and a missing column is a 42703 that would take the whole tab down.
 */
async function loadSignups() {
  const withMember = await db().from("side_event_signups")
    .select("side_event_id, member_id, username");
  if (!withMember.error) { needsMigration = false; return withMember; }
  if (!/member_id/.test(withMember.error.message || "")) return withMember;

  needsMigration = true;
  return db().from("side_event_signups").select("side_event_id, username");
}

/**
 * Who a sign-up is: the member profile first, the stored legacy name after.
 *
 * Rows the migration could not map safely keep their username and a NULL
 * member_id - it preserves them rather than deleting them - so those still
 * show the name they were created with.
 */
function signupName(signup, members) {
  const m = signup.member_id != null ? members.get(String(signup.member_id)) : null;
  return m?.display_name || signup.username || "Someone";
}

/** Whether a sign-up row belongs to `me`. Legacy rows fall back to the name. */
function isMine(signup, me) {
  if (!me) return false;
  if (signup.member_id != null) return String(signup.member_id) === String(me.id);
  return String(signup.username || "").trim().toLowerCase()
      === String(me.display_name || "").trim().toLowerCase();
}

async function paintSide(body, view) {
  const me = currentMember();

  const [eventsRes, signupsRes, membersRes] = await Promise.all([
    db().from("side_events").select("*").order("created_at", { ascending: false }),
    loadSignups(),
    db().from("members").select("id, display_name"),
  ]);
  if (eventsRes.error || signupsRes.error) throw eventsRes.error || signupsRes.error;

  const events  = visible("side_events", eventsRes.data || []);
  const signups = signupsRes.data || [];
  const members = new Map((membersRes.data || []).map((m) => [String(m.id), m]));

  const addRow = canEdit()
    ? `<div class="row-end">${addControl("side_events", "Add side event")}</div>` : "";

  if (!events.length) {
    body.innerHTML =
      empty("No side events yet.") + addRow;
    return;
  }

  const notices = `
    ${needsMigration ? `<div class="card note">
        <div class="card-body">Joining is not switched on yet. Run
        <strong>side_events_member_schema.sql</strong> in the Supabase SQL editor, then reload.</div>
      </div>` : ""}
    ${me || needsMigration ? "" : `<div class="card note">
        <div class="card-body">Pick your name in the top right to join a side event.</div>
      </div>`}`;

  const cards = events.map((ev) => {
    const mine   = signups.filter((s) => s.side_event_id === ev.id);
    const people = mine.map((s) => signupName(s, members));
    const joined = mine.some((s) => isMine(s, me));
    const open   = ev.status === "Open";

    return `
      <div class="card ${open ? "accent" : ""} ${hiddenClass("side_events", ev)}">
        <div class="card-title">${esc(ev.title)}</div>
        <div class="card-meta" style="margin:0 0 8px">
          <span class="pill">${esc(ev.kind)}</span>
          <span class="pill ${open ? "green" : "grey"}">${esc(ev.status)}</span>
          · ${people.length} in
        </div>
        ${ev.description ? `<div class="card-body">${esc(ev.description)}</div>` : ""}
        ${ev.link ? `<div style="margin-top:8px"><a href="${esc(ev.link)}" target="_blank" rel="noopener">Open bracket / pool →</a></div>` : ""}
        ${people.length ? `<div class="card-meta">Playing: ${esc(people.join(", "))}</div>` : ""}
        ${open ? `<div class="row-end">
          <button class="btn small ${joined ? "ghost" : ""}" data-join="${ev.id}" ${joined ? "disabled" : ""}>
            ${joined ? "You're in" : "Count me in"}
          </button>
        </div>` : ""}
        ${editControls("side_events", ev)}
      </div>`;
  }).join("");

  // Wrapped in a fresh element so the click listener is never doubled up.
  body.innerHTML = `<div id="side-list">${notices}${cards}${addRow}</div>`;

  body.querySelector("#side-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-join]");
    if (!btn) return;
    /* No member, no sign-up. There is deliberately no fall back to a typed
       name here: an anonymous row is a row nobody can ever be recognised as,
       and the database refuses it now anyway. */
    if (!me) { toast("Pick your name in the top right to join", true); return; }

    btn.disabled = true;
    try {
      await insertRow("side_event_signups", {
        side_event_id: Number(btn.dataset.join),
        member_id: Number(me.id),
      });
      toast("You're in");
      paint(body, view);
    } catch (err) {
      btn.disabled = false;
      toast(joinError(err), true);
    }
  });
}

/**
 * The two failures worth naming: joining twice, and a database that has not
 * had the migration run. Everything else says what Postgres said.
 */
function joinError(error) {
  if (error.code === "23505") return "You already joined";
  const msg = error.message || "Could not join";
  if (/member_id|42703|schema cache/i.test(msg) || error.code === "42703") {
    return "Run side_events_member_schema.sql in Supabase to enable joining";
  }
  if (error.code === "42501" || /row-level security/i.test(msg)) {
    return "Pick your name in the top right, then try again";
  }
  return msg;
}

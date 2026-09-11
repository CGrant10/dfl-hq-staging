// =====================================================================
// DFL Arena - the league's general purpose settling-of-arguments machine.
//
// An Arena event is "a set of members and an ordered result". Draft order,
// golf teams, playoff seeding, who buys the beer, awards, a week 8
// punishment - the engine does not know which, and deliberately so.
//
//   #/arena          the events list and the history
//   #/arena?id=12    one event: line-up, race control, the result
//   #/broadcast?id=12  THE RACE VIEW - where the race is actually watched
//
// THIS PAGE PREPARES AND CONTROLS A RACE. IT DOES NOT PLAY ONE.
//
// It used to do both, and the Race View played the same recording at the
// same time off the same seed. Two playback loops, two cameras, two finish
// lines - one for whoever happened to be the commissioner and one for
// everybody else. They drifted, which is what two implementations of one
// thing do.
//
// So there is one race and one viewer. Start writes the shared clock and
// sends the commissioner to the Race View with everyone else; members are
// taken there by watchSharedRace(); an OBS browser source parked on that URL
// simply starts running. The Race View is not an OBS feature - it is the
// race.
//
// Members watch and read. The commissioner creates, sets the line-up,
// starts the race and saves the result. The database enforces that; the
// buttons are hidden as a convenience.
// =====================================================================

import { db, insertRow, updateRow } from "../supabase.js";
import { esc, empty, errorBox, toast, fmtDate, loading } from "../ui.js";
import { icon } from "../icons.js";
import { loadMembers } from "../members.js";
/* The DFL Pet is a member's racer sprite - here only to draw the winner on
   the result card. The RACER sprites are the Race View's business. */
import { getReduceRaceMotion, setReduceRaceMotion } from "../store.js";
import { addControl, editControls, wireInline, canEdit, visible, hiddenClass } from "../inline.js";
import { currentMember } from "../members.js";
import { themeLabel, slotsFor, assignSprites, spriteMarkup,
         toSpritePng, MAX_SPRITE_UPLOAD } from "../arena/sprites.js";
/*
  simulate() is still here, and ONLY as arithmetic: "Finish now" needs to know
  where the last racer crosses, and "Save result" needs the order. Neither
  draws anything. Every presentation import this file used to carry - the pixi
  runtime, the racer-view emitter, dramatize/visualEvents/boardState and the
  camera helpers - went with runRace(); pages/broadcast.js imports them now.
*/
import { simulate, newSeed, ticksFor, raceSeconds } from "../arena/race-forward-shim.js";
import { persistResult } from "../arena/results.js";
import { ensureBroadcastStyles } from "../lazy-css.js";
/* The Arena page draws the .bc-* console and board. */
ensureBroadcastStyles();

const applyRaceMotionClass = (element, reduced = getReduceRaceMotion()) => {
  element?.classList.toggle("race-motion-reduced", reduced);
  element?.classList.toggle("race-motion-full", !reduced);
};

/*
  A MEMBER'S ARENA PAGE IS THE WAITING ROOM.

  The clean 16:9 broadcast route already owns the realtime subscription and
  the polling fallback. Reusing that viewer keeps one shared clock and one
  playback loop. While an event is idle, members can inspect the line-up here;
  the moment the commissioner starts, this watcher moves them into the shared
  viewer automatically.
*/
let sharedWatch = null;

function stopSharedWatch() {
  if (!sharedWatch) return;
  clearInterval(sharedWatch.poll);
  sharedWatch.channel?.unsubscribe?.();
  sharedWatch = null;
}

function enterSharedRace(event) {
  if (!event || !["running", "paused", "finished"].includes(event.bc_state)) return false;
  stopSharedWatch();
  location.hash = `#/broadcast?id=${event.id}`;
  return true;
}

function watchSharedRace(eventId) {
  stopSharedWatch();

  const accept = (event) => enterSharedRace(event);
  const channel = db().channel(`arena-wait-${eventId}`)
    .on("postgres_changes", {
      event: "UPDATE", schema: "public", table: "arena_events",
      filter: `id=eq.${eventId}`,
    }, (payload) => accept(payload.new))
    .subscribe();

  const poll = setInterval(async () => {
    try {
      const { data } = await db().from("arena_events")
        .select("id,bc_state").eq("id", eventId).maybeSingle();
      accept(data);
    } catch { /* Realtime is primary; the next poll can try again. */ }
  }, 1500);

  sharedWatch = { channel, poll };
}

export function leave() {
  stopSharedWatch();
}

export async function render(view) {
  const id = new URLSearchParams(location.hash.split("?")[1] || "").get("id");
  if (id) return renderEvent(view, id);
  return renderList(view);
}

// ============================== the list ==============================

async function renderList(view) {
  view.innerHTML = loading();

  const [eventsRes, resultsRes, members] = await Promise.all([
    db().from("arena_events").select("*").order("created_at", { ascending: false }),
    db().from("arena_results").select("event_id, member_id, place").eq("place", 1),
    loadMembers().catch(() => []),
  ]);

  if (eventsRes.error) {
    view.innerHTML = `<h1>DFL Arena</h1>` + errorBox(eventsRes.error) +
      `<div class="card"><div class="card-body muted">If the tables are missing, run
       <strong>arena_schema.sql</strong> in the Supabase SQL editor.</div></div>`;
    return;
  }

  const events  = visible("arena_events", eventsRes.data || []);
  const winners = new Map((resultsRes.data || []).map((r) => [r.event_id, r.member_id]));
  const byId    = new Map(members.map((m) => [String(m.id), m]));

  const open = events.filter((e) => e.status !== "complete");
  const done = events.filter((e) => e.status === "complete");

  view.innerHTML = `
    <div id="arena-wrap">
      <header class="page-head">
        <h1>DFL Arena</h1>
        ${addControl("arena_events", "New event")}
      </header>
      ${events.length ? "" : empty("No Arena events yet.")}

      ${open.length ? `
        <h2 class="section-title">Ready to run<span class="count">${open.length}</span></h2>
        ${open.map((e) => eventCard(e, null, byId)).join("")}` : ""}

      ${done.length ? `
        <h2 class="section-title">Arena history<span class="count">${done.length}</span></h2>
        ${done.map((e) => eventCard(e, winners.get(e.id), byId)).join("")}` : ""}
    </div>
  `;

  wireInline(view.querySelector("#arena-wrap"), () => render(view));
}

function eventCard(e, winnerId, byId) {
  const winner = winnerId != null ? byId.get(String(winnerId)) : null;
  return `
    <article class="card arena-card ${hiddenClass("arena_events", e)}">
      <a class="arena-link" href="#/arena?id=${e.id}">
        <div class="arena-top">
          <h3 class="card-heading">${esc(e.name)}</h3>
          <span class="pill ${e.status === "complete" ? "grey" : "green"}">
            ${e.status === "complete" ? "Final" : "Ready"}
          </span>
        </div>
        <div class="arena-meta">
          <span>${esc(themeLabel(e.theme))}</span>
          ${e.event_date ? `<span>· ${esc(fmtDate(e.event_date))}</span>` : ""}
          ${winner ? `<span class="arena-winner">· ${icon("trophy", { size: 13 })} ${esc(winner.display_name)}</span>` : ""}
        </div>
        ${e.description ? `<div class="card-body">${esc(e.description)}</div>` : ""}
      </a>
      ${editControls("arena_events", e, { compact: true })}
    </article>`;
}

// ============================== one event =============================

async function renderEvent(view, id) {
  view.innerHTML = loading();

  const [eventRes, partsRes, resultsRes, members] = await Promise.all([
    db().from("arena_events").select("*").eq("id", id).maybeSingle(),
    db().from("arena_participants").select("*").eq("event_id", id).order("sort_order"),
    db().from("arena_results").select("*").eq("event_id", id).order("place"),
    loadMembers().catch(() => []),
  ]);

  if (eventRes.error || !eventRes.data) {
    view.innerHTML = `<h1>DFL Arena</h1>` + errorBox(eventRes.error || new Error("Event not found"));
    return;
  }

  const event   = eventRes.data;
  const parts   = partsRes.data || [];
  const results = resultsRes.data || [];
  const byId    = new Map(members.map((m) => [String(m.id), m]));

  // A member opening an already-live event goes straight to the shared view.
  if (!canEdit() && enterSharedRace(event)) return;

  view.innerHTML = `
    <header class="page-head">
      <a class="backlink" href="#/arena">← Arena</a>
      <h1>${esc(event.name)}</h1>
      ${event.description ? `<p class="page-sub">${esc(event.description)}</p>` : ""}
    </header>

    <div id="arena-event">
      <div class="card arena-setup">
        <div class="arena-figures">
          ${figure(parts.length, parts.length === 1 ? "racer" : "racers")}
          ${figure(themeLabel(event.theme), "theme")}
          ${figure(raceSeconds(event.race_length, event.length_ticks) + "s", "length")}
        </div>
        ${event.notes ? `<div class="card-body">${esc(event.notes)}</div>` : ""}
      </div>

      ${results.length ? resultsCard(results, byId, event) : ""}

      ${broadcastCard(event, parts)}

      ${waitingCard(parts, results, event)}

      ${lineupCard(event, parts, byId, members)}
    </div>
  `;

  /*
    REPLAY, which is now the same thing as a race.

    It reuses the stored seed so it is the identical recording, writes the
    shared clock exactly as Start does, and then goes and watches it in the
    Race View. It used to play a private local copy - "Replay locally" - which
    is precisely the second presentation this page no longer owns.
  */
  view.querySelector("#arena-event").addEventListener("click", async (e) => {
    const replay = e.target.closest("#arena-replay");
    const clear  = e.target.closest("#arena-clear");

    if (clear) return clearResult(view, event);
    if (!replay) return;

    if (parts.length < 2) { toast("An Arena race needs at least two racers", true); return; }

    const seed = event.seed ? Number(event.seed) : newSeed();
    try {
      await updateRow("arena_events", event.id, {
        seed,
        bc_state: "running",
        bc_started_at: new Date(Date.now() + COUNTDOWN_MS).toISOString(),
        bc_offset_ms: 0,
      });
      event.seed = seed;
    } catch (err) {
      toast(err.message || "Only the commissioner can replay a race", true);
      return;
    }
    location.hash = `#/broadcast?id=${event.id}`;
  });

  /* The line-up wiring is no longer admin-only, because a member now has one
     control in it: the picker on their own lane. Everything else inside
     wireLineup is still guarded - the add, remove, colour, PNG and re-roll
     controls are not RENDERED for a non-admin, and the database refuses them
     regardless. Gating the listener as well meant the member's own picker
     silently did nothing. */
  wireLineup(view, event, parts, members, () => render(view));
  if (canEdit()) {
    wireBroadcast(view, event, parts, byId, () => render(view));
  } else {
    watchSharedRace(event.id);
  }
}

/*
  THE WAITING ROOM, for everybody who is not the commissioner.

  This page no longer draws a race, so what used to be an empty stage waiting
  to be filled is just a line telling a member what is about to happen: the
  watcher above moves them into the Race View the moment the commissioner
  starts, and they do not have to do anything.

  Nothing for an admin - Race control is directly above and says more.
*/
function waitingCard(parts, results, event) {
  if (canEdit() || results.length) return "";
  return `
    <div class="arena-ready is-waiting" role="status">
      <strong>${parts.length < 2 ? "Waiting on the line-up" : "Waiting for the commissioner"}</strong>
      <span>${parts.length < 2
        ? "This race needs at least two racers."
        : "The Race View opens here automatically the moment the race starts."}</span>
      ${parts.length < 2 ? "" : `
        <!-- Standing on the grid early is allowed, and it is no longer a
             different picture from the one OBS is showing: the Race View is
             idle until the commissioner presses Start race in there. -->
        <a class="btn ghost small" href="#/broadcast?id=${event.id}">Wait on the starting grid</a>`}
    </div>`;
}

function figure(value, label) {
  return `<div class="setup-figure">
            <span class="sf-v">${esc(value)}</span><span class="sf-l">${esc(label)}</span>
          </div>`;
}

// ------------------------------- line-up ------------------------------

function lineupCard(event, parts, byId, members) {
  const admin = canEdit();
  /* YOUR OWN LANE. Choosing what you look like is the fun of the Arena and
     it used to be one person's job for twelve people. A member gets the
     picker on their own row only - and the database agrees, because the
     write goes through arena_pick_racer() which will only ever touch the
     calling member's row. The UI is the convenience; the RPC is the rule. */
  const meId = String(currentMember()?.id || "");
  const inRace = new Set(parts.map((p) => String(p.member_id)));
  const spare  = members.filter((m) => !inRace.has(String(m.id)));

  return `
    <div class="card">
      <div class="card-title">Line-up</div>

      ${parts.length ? `<div class="lanes-list">${parts.map((p, i) => {
        const m = byId.get(String(p.member_id));
        return `
          <div class="lane-row">
            <span class="lane-no">${p.number ?? i + 1}</span>
            <span class="lane-sprite" style="--racer:${esc(p.color || laneColor(i))}">
              ${spriteMarkup(event.theme, p.sprite, p.color || laneColor(i), p.sprite_image)}
            </span>
            <span class="lane-name">${esc(m?.display_name || "Unknown")}</span>
            ${!admin && meId && String(p.member_id) === meId ? `
              <select class="lane-pick" data-my-sprite="${p.id}" data-event="${event.id}"
                      aria-label="Pick your racer">
                <option value="">— pick your racer —</option>
                ${slotsFor(event.theme).map((sl) =>
                  `<option value="${esc(sl.key)}" ${sl.key === p.sprite ? "selected" : ""}>${esc(sl.label)}</option>`).join("")}
              </select>` : ""}
            ${admin ? `
              <select class="lane-pick" data-sprite-for="${p.id}">
                <option value="">— sprite —</option>
                ${slotsFor(event.theme).map((s) =>
                  `<option value="${esc(s.key)}" ${s.key === p.sprite ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
              </select>
              <input type="file" accept="image/*" class="hidden" data-pngfile="${p.id}">
              <button class="btn ghost small" data-png="${p.id}"
                      title="${p.sprite_image ? "Replace this racer's picture" : "Upload a PNG for this racer"}">
                ${p.sprite_image ? "PNG ✓" : "PNG"}
              </button>
              ${p.sprite_image
                ? `<button class="btn ghost small" data-pngclear="${p.id}" title="Back to the drawn sprite">↺</button>`
                : ""}
              <button class="btn ghost small" data-drop-racer="${p.id}" aria-label="Remove">&times;</button>
            ` : ""}
          </div>`;
      }).join("")}</div>` : `<p class="muted tiny">No racers yet.</p>`}

      ${admin ? `
        <div class="arena-admin">
          ${spare.length ? `
            <select id="arena-add-member">
              <option value="">— add a racer —</option>
              ${spare.map((m) => `<option value="${m.id}">${esc(m.display_name)}</option>`).join("")}
            </select>` : `<span class="muted tiny">Every member is in this race.</span>`}
          <button class="btn ghost small" id="arena-add-all" ${spare.length ? "" : "disabled"}>Add everyone</button>
          <button class="btn ghost small" id="arena-roll-sprites" ${parts.length ? "" : "disabled"}>Random sprites</button>
        </div>` : ""}
    </div>`;
}

const LANE_COLORS = [
  "#2fbf5f", "#4aa3ff", "#f0a742", "#e0574a", "#b07cf0", "#3ecfcf",
  "#f2e05a", "#ff7fb0", "#8fd14f", "#ff9a4a", "#7f8cff", "#d6b254",
];
const laneColor = (i) => LANE_COLORS[i % LANE_COLORS.length];

function wireLineup(view, event, parts, members, refresh) {
  const root = view.querySelector("#arena-event");

  root.addEventListener("change", async (e) => {
    const add = e.target.closest("#arena-add-member");
    const sprite = e.target.closest("[data-sprite-for]");
    const mine = e.target.closest("[data-my-sprite]");

    /*
      A member picking their own racer. Not updateRow(): that writes to
      arena_participants, which is admin-write, so it would be refused - and
      row level security refuses by matching zero rows rather than by
      erroring, so it would have been refused SILENTLY and the picker would
      have looked like it worked. The RPC returns how many rows it changed
      and 0 is reported as the failure it is.
    */
    if (mine) {
      const select = mine;
      select.disabled = true;
      try {
        const { data, error } = await db().rpc("arena_pick_racer", {
          p_event_id: Number(select.dataset.event),
          p_sprite: select.value || null,
        });
        if (error) throw error;
        if (!data) throw new Error("You are not in this race.");
        toast(select.value ? "Racer picked" : "Back to the default racer");
        refresh();
      } catch (err) {
        toast(/function|does not exist/i.test(err.message || "")
          ? "Run arena_pick_racer_schema.sql in Supabase"
          : (err.message || "Could not pick that racer"), true);
        select.disabled = false;
      }
      return;
    }

    if (add && add.value) {
      try {
        await insertRow("arena_participants", {
          event_id: event.id,
          member_id: Number(add.value),
          sort_order: parts.length,
          color: laneColor(parts.length),
          number: parts.length + 1,
        });
        refresh();
      } catch (err) { toast(err.message || "Could not add that racer", true); }
    }

    if (sprite) {
      try {
        await updateRow("arena_participants", sprite.dataset.spriteFor, { sprite: sprite.value });
        toast("Sprite set");
        refresh();
      } catch (err) { toast(err.message || "Could not set the sprite", true); }
    }
  });

  // A picked file never touches the network as-is: it is redrawn to a small
  // PNG first, so what reaches the database is a few kilobytes.
  root.addEventListener("change", async (e) => {
    const picker = e.target.closest("[data-pngfile]");
    if (!picker) return;
    const file = picker.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) { toast("That is not an image", true); return; }
    if (file.size > MAX_SPRITE_UPLOAD)   { toast("That image is too large", true); return; }

    try {
      const dataUrl = await toSpritePng(file);
      await updateRow("arena_participants", picker.dataset.pngfile, { sprite_image: dataUrl });
      toast("Racer picture set");
      refresh();
    } catch (err) {
      toast(/sprite_image|column/.test(err.message || "")
        ? "Run arena_sprites_schema.sql in Supabase"
        : (err.message || "Could not read that image"), true);
    }
  });

  root.addEventListener("click", async (e) => {
    const drop = e.target.closest("[data-drop-racer]");
    const all  = e.target.closest("#arena-add-all");
    const roll = e.target.closest("#arena-roll-sprites");
    const png  = e.target.closest("[data-png]");
    const wipe = e.target.closest("[data-pngclear]");

    if (png) {
      root.querySelector(`[data-pngfile="${png.dataset.png}"]`)?.click();
      return;
    }

    if (wipe) {
      try {
        await updateRow("arena_participants", wipe.dataset.pngclear, { sprite_image: null });
        toast("Back to the drawn sprite");
        refresh();
      } catch (err) { toast(err.message || "Could not clear the picture", true); }
      return;
    }

    if (drop) {
      try {
        const { error } = await db().from("arena_participants").delete().eq("id", drop.dataset.dropRacer);
        if (error) throw error;
        refresh();
      } catch (err) { toast(err.message || "Could not remove that racer", true); }
    }

    if (all) {
      all.disabled = true;
      const have = new Set(parts.map((p) => String(p.member_id)));
      try {
        let n = parts.length;
        for (const m of members) {
          if (have.has(String(m.id))) continue;
          await insertRow("arena_participants", {
            event_id: event.id, member_id: m.id, sort_order: n,
            color: laneColor(n), number: n + 1,
          });
          n++;
        }
        toast("Line-up filled");
        refresh();
      } catch (err) { toast(err.message || "Could not fill the line-up", true); all.disabled = false; }
    }

    if (roll) {
      roll.disabled = true;
      try {
        const keys = assignSprites(event.theme, parts.length);
        for (let i = 0; i < parts.length; i++) {
          await updateRow("arena_participants", parts[i].id, { sprite: keys[i] });
        }
        toast("Sprites rolled");
        refresh();
      } catch (err) { toast(err.message || "Could not roll sprites", true); roll.disabled = false; }
    }
  });
}

// ============================ broadcast mode ==========================

/*
  The commissioner's control panel for the shared race.

  Nothing here draws a race - it only writes state to the event row, and the
  broadcast page (and any phone watching) derives everything from that. So
  the panel works from anywhere with signal, including a phone in a bar, and
  the machine running OBS never needs to be touched once the scene is set.

  The browser-source URL stays copyable for one-time OBS setup. The operator
  controls the shared race here; there is no second "Open broadcast" action
  competing with those controls.
*/
function broadcastCard(event, parts) {
  if (!canEdit()) return "";

  const url = `${location.origin}${location.pathname}#/broadcast?id=${event.id}`;
  const state = event.bc_state || "idle";
  const running = state === "running";
  const paused = state === "paused";
  const finished = state === "finished";
  const ready = parts.length >= 2;
  const statusLabel = running ? "Race live" : paused ? "Race paused" : finished ? "Race finished" : "Ready to race";
  const statusHelp = !ready ? "Add at least two racers to begin." :
    running ? "The Race View is live on every viewer." :
    paused ? "Viewers are holding on the same frame." :
    finished ? "" :
    "Start the race from the Race View.";

  /*
    ONE ACTION, AND IT DOES NOT START THE RACE.

    It used to. "Start race" wrote bc_state, bc_started_at and a new seed and
    THEN navigated, so the shared countdown was already running while the
    Race View was still loading members, building the simulation and mounting
    Pixi. The commissioner - the person who pressed it - reliably arrived
    somewhere around "1", with no chance to rotate the phone, go fullscreen,
    or check that OBS was actually live.

    Entering the view and starting the clock are two different actions and
    they are two different buttons now. This one only opens the canonical
    Race View, which draws the starting grid while the event is idle. The
    START control lives in there, next to the picture, where the person
    pressing it can see what everybody else is seeing.

    It writes NOTHING. That is deliberate beyond the countdown: this panel is
    reachable at any time, including in the middle of a live race, and a
    launch action that reset or re-seeded anything on the way past would be a
    way to wipe a race by navigating. Reset race and Save result are still
    here, explicit, below.
  */
  return `
    <section class="card bc-panel" aria-labelledby="bc-console-title">
      <header class="bc-console-head">
        <div>
          <span class="eyebrow">Commissioner console</span>
          <h2 id="bc-console-title">Race control</h2>
          <p class="muted tiny">${esc(statusHelp)}</p>
        </div>
        <div class="bc-state bc-state--${esc(state)}" role="status">
          <span class="bc-state-dot" aria-hidden="true"></span>
          <span>${esc(statusLabel)}</span>
        </div>
      </header>

      <div class="bc-command">
        <button class="btn bc-primary" id="bc-start" ${ready ? "" : "disabled"}>
          <span>${running || paused ? "Go to the live race" : "Go to Race View"}</span>
          <small>${ready
            ? (running || paused
                ? `${parts.length} racers · already running`
                : `${parts.length} racers · then press Start race in there`)
            : "Lineup incomplete"}</small>
        </button>
        <div class="bc-transport" aria-label="Race transport controls">
          <button class="btn ghost" id="bc-pause" ${running || paused ? "" : "disabled"}>${paused ? "Resume race" : "Pause race"}</button>
          <button class="btn ghost" id="bc-skip" ${running || paused ? "" : "disabled"}>Finish now</button>
        </div>
      </div>

      <div class="bc-console-foot">
        <fieldset class="bc-view-options">
          <legend>Viewer display</legend>
          <label><input type="checkbox" id="bc-board-t" ${event.bc_show_board === false ? "" : "checked"}> Leaderboard</label>
          <label><input type="checkbox" id="bc-timer-t" ${event.bc_show_timer === false ? "" : "checked"}> Race clock</label>
          <label><input type="checkbox" id="bc-motion-t" ${getReduceRaceMotion() ? "checked" : ""}> Reduce race motion/effects</label>
        </fieldset>
        <div class="bc-result-actions">
          <!--
            Enabled for any race that has been started, not only a "finished"
            one. The Race View saves the result itself when the celebration
            begins, but a race that ran to its end without an admin watching
            leaves bc_state on "running" - and that used to leave this button
            greyed out, with no way to store a race that had genuinely
            happened. It writes the same deterministic rows either way.
          -->
          <button class="btn ghost small" id="bc-save" ${state !== "idle" && ready && event.seed ? "" : "disabled"}>Save result</button>
          <button class="btn ghost small danger" id="bc-reset" ${state === "idle" ? "disabled" : ""}>Reset race</button>
        </div>
      </div>

      <details class="bc-setup">
        <summary>Race View link (OBS)</summary>
        <p class="muted tiny">Point an OBS browser source at this once and leave it there. It shows
          the starting grid while the event is idle and runs the race the moment you press
          <strong>Start race</strong> inside the Race View — merely opening the view changes nothing
          in the capture. Anyone can open it; no profile required.</p>
        <div class="bc-url">
          <input id="bc-url" type="text" readonly aria-label="Public race viewer URL" value="${esc(url)}">
          <button class="btn ghost small" id="bc-copy">Copy link</button>
        </div>
      </details>
    </section>`;
}

/** Seconds of countdown before the racers move. */
const COUNTDOWN_MS = 2700;

/*
  Race control: the shared row is the only thing this panel writes. It never
  draws a race - the Race View does that for everyone, the commissioner
  included - so there is no stage to hand in here any more.
*/
function wireBroadcast(view, event, parts, byId, refresh) {
  const panel = view.querySelector(".bc-panel");
  if (!panel) return;

  const ticks = ticksFor(event.race_length, event.length_ticks);

  /* Elapsed race time right now, from the row - the same formula the
     broadcast uses, so pausing lands on the identical frame everywhere. */
  const elapsedNow = () => {
    if (!event.bc_started_at || event.bc_state === "idle") return 0;
    if (event.bc_state === "paused") return event.bc_offset_ms || 0;
    return Date.now() - Date.parse(event.bc_started_at) + (event.bc_offset_ms || 0);
  };

  const updateSharedEvent = async (patch) => {
    const { data, error } = await db().from("arena_events")
      .update(patch).eq("id", event.id).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Shared race update was rejected. Re-run arena_schema.sql and sign in as commissioner.");
    Object.assign(event, data);
    return data;
  };

  const write = async (patch, note) => {
    try {
      await updateSharedEvent(patch);
      if (note) toast(note);
      refresh();
    } catch (err) {
      toast(/bc_state|column/.test(err.message || "")
        ? "Run arena_broadcast_schema.sql in Supabase"
        : (err.message || "Could not update the broadcast"), true);
    }
  };

  panel.addEventListener("click", async (e) => {
    const t = e.target;

    if (t.closest("#bc-copy")) {
      const input = panel.querySelector("#bc-url");
      try {
        await navigator.clipboard.writeText(input.value);
        toast("Broadcast URL copied");
      } catch {
        // Clipboard needs a secure context; selecting it is the fallback.
        input.removeAttribute("readonly");
        input.select();
        toast("Copy the highlighted URL");
      }
      return;
    }

    if (t.closest("#bc-start")) {
      /*
        GO AND WATCH IT. Nothing else.

        The write that used to be here - seed, bc_state running, bc_started_at
        now + COUNTDOWN_MS - has moved to the Start race button inside the
        Race View, which is the only control that owns the shared clock now.
        See the note on this panel above, and #bc-go in pages/broadcast.js.

        Opening a race that is already running is the same navigation: the
        Race View derives elapsed time from bc_started_at, so a mid-race join
        lands on the correct shared frame rather than restarting anything.
      */
      if (parts.length < 2) { toast("An Arena race needs at least two racers", true); return; }
      location.hash = `#/broadcast?id=${event.id}`;
      return;
    }

    if (t.closest("#bc-pause")) {
      try {
        const resuming = event.bc_state === "paused";
        await updateSharedEvent(resuming ? {
          bc_state: "running",
          bc_started_at: new Date().toISOString(),
          bc_offset_ms: event.bc_offset_ms || 0,
        } : {
          bc_state: "paused",
          bc_offset_ms: Math.max(0, Math.round(elapsedNow())),
        });
        const button = panel.querySelector("#bc-pause");
        if (button) button.textContent = resuming ? "Pause race" : "Resume race";
        const state = panel.querySelector(".bc-state");
        if (state) {
          state.className = `bc-state bc-state--${event.bc_state}`;
          state.querySelector("span:last-child").textContent = resuming ? "Race live" : "Race paused";
        }
        toast(resuming ? "Resumed" : "Paused");
      } catch (err) {
        toast(err.message || "Could not update the race", true);
      }
      return;
    }

    if (t.closest("#bc-skip")) {
      // Jump the clock past the last finish, which puts every lane on the
      // line and triggers the winner card on every viewer at once.
      const racers = parts.map((p) => ({ id: p.member_id }));
      const sim = simulate(racers, ticks, Number(event.seed) || 1);
      const end = (sim.order.at(-1)?.finishMs ?? 0) + 400;
      return write({
        bc_state: "finished",
        bc_started_at: new Date().toISOString(),
        bc_offset_ms: end,
      }, "Skipped to the finish");
    }

    if (t.closest("#bc-reset")) {
      return write({ bc_state: "idle", bc_started_at: null, bc_offset_ms: 0 }, "Broadcast reset");
    }

    /*
      THE EXPLICIT SAVE, and the same rows the Race View would have written:
      simulate() on the event's stored seed, so pressing this after the Race
      View already saved stores byte-identical places and times rather than a
      second, different race.
    */
    if (t.closest("#bc-save")) {
      const seed = Number(event.seed) || 1;
      const racers = parts.map((p) => ({
        id: p.member_id,
        name: byId.get(String(p.member_id))?.display_name || "Unknown",
      }));
      try {
        await persistResult(event.id, simulate(racers, ticks, seed), seed);
        toast("Result saved");
      } catch (err) {
        toast(err.message || "Could not save the result", true);
      }
      refresh();
    }
  });

  panel.addEventListener("change", (e) => {
    if (e.target.id === "bc-board-t") write({ bc_show_board: e.target.checked });
    if (e.target.id === "bc-timer-t") write({ bc_show_timer: e.target.checked });
    if (e.target.id === "bc-motion-t") {
      setReduceRaceMotion(e.target.checked);
      view.querySelectorAll(".bc-stage").forEach((el) => applyRaceMotionClass(el, e.target.checked));
      toast(e.target.checked ? "Race effects reduced on this device" : "Full race effects restored");
    }
  });
}

/* =====================================================================
   THE RACE USED TO BE PLAYED HERE. IT IS NOT ANY MORE.
   ---------------------------------------------------------------------
   runRace() and countdown() lived at this point: ~565 lines that built an
   .arena-track-wrap stage, mounted a second Pixi renderer, and ran their own
   requestAnimationFrame loop with their own camera, finish line, reactions,
   run-out and winner reveal.

   They were a SECOND camera on the same recording. The shared row already
   drove /broadcast off the identical seed, so the commissioner watched one
   implementation while every member, every shared link and OBS watched
   another. Two implementations of one presentation is a drift machine, and
   it had already drifted: the finish-line sweep behaved differently on the
   two screens because each had its own copy of it.

   The Race View owns the presentation now - for the commissioner too. This
   page prepares and controls the race; #/broadcast plays it.

   Deleted with it, because nothing else on this page used them:
     runRace(), countdown(), the #arena-stage host and the .arena-ready
     stage filler.
   The pixi runtime, race.js theatre helpers and racer-view emitter are all
   still imported by pages/broadcast.js - only this page's copy is gone.
   ===================================================================== */

// ------------------------------- results ------------------------------

function resultsCard(results, byId, event, { fresh = false } = {}) {
  const rows = [...results].sort((a, b) => a.place - b.place);
  const win  = rows[0];
  const winner = win ? byId.get(String(win.member_id)) : null;

  return `
    <div class="card results-card ${fresh ? "reveal" : ""}">
      <div class="card-title">Result</div>

      ${winner ? `
        <div class="winner-block">
          <span class="winner-trophy">${icon("trophy", { size: 30 })}</span>
          <span class="winner-name">${esc(winner.display_name)}</span>
          <span class="winner-label">Winner${event?.name ? " · " + esc(event.name) : ""}</span>
        </div>` : ""}

      <div class="order-head" aria-hidden="true">
        <span>Pos</span><span>Racer</span><span class="oh-r">Time</span>
      </div>
      <div class="order-list">
        ${rows.map((r, i) => {
          const m = byId.get(String(r.member_id));
          return `
            <div class="order-row ${r.place === 1 ? "first" : ""}" style="--i:${i}">
              <span class="order-place">${r.place === 1 ? "1st" : ordinal(r.place)}</span>
              <span class="order-name">${esc(m?.display_name || "Unknown")}</span>
              <span class="order-time">${r.finish_ms != null ? (r.finish_ms / 1000).toFixed(2) + "s" : ""}</span>
            </div>`;
        }).join("")}
      </div>

      <div class="row-end">
        <a class="btn ghost small" href="#/arena">Back to Arena</a>
        ${canEdit() ? `<button class="btn ghost small" id="arena-replay">Replay in Race View</button>` : ""}
        ${canEdit() ? `<button class="btn danger small" id="arena-clear">Clear result</button>` : ""}
      </div>
    </div>`;
}

function ordinal(n) {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return n + (["th", "st", "nd", "rd"][n % 10] || "th");
}

/**
 * Throw away a result and put the event back on the start line.
 *
 * For the case this exists for - "that run was a test" - the seed goes too,
 * so the next race is a genuinely new one rather than a replay of the test.
 * The broadcast is reset in the same breath, otherwise a winner card would
 * still be sitting on the OBS scene for an event that no longer has a result.
 *
 * The participants and their sprites are untouched: clearing a result must
 * not cost you the line-up you spent ten minutes setting up.
 */
async function clearResult(view, event) {
  if (!confirm("Delete this race result? The line-up and sprites are kept.")) return;

  try {
    /*
      The delete is asked to name what it removed. A delete RLS refuses matches
      zero rows and returns no error, exactly like a refused update - so a
      commissioner without the Broadcast permission got "Result cleared" and a
      result still sitting on the screen.

      Zero rows is only WRONG if there was something to remove, which is why
      this reports through the event update below rather than guessing here: a
      race whose result was already gone legitimately deletes nothing.
    */
    const { error } = await db().from("arena_results").delete().eq("event_id", event.id).select("id");
    if (error) throw error;

    const back = { status: "setup", seed: null, completed_at: null };
    try {
      // Reset the broadcast too, where those columns exist.
      await updateRow("arena_events", event.id,
        { ...back, bc_state: "idle", bc_started_at: null, bc_offset_ms: 0 });
    } catch (err) {
      /*
        This fallback exists for a database that predates the bc_ columns. A
        REFUSAL is not that, and retrying the same refused write with fewer
        columns just refuses again - so it has to be told apart, or a
        permissions problem is reported as a schema problem.
      */
      if (err?.refused) throw err;
      await updateRow("arena_events", event.id, back);
    }

    toast("Result cleared");
    render(view);
  } catch (err) {
    toast(err.message || "Could not clear the result", true);
  }
}

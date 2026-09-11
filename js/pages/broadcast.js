// =====================================================================
// DFL Broadcast - the OBS Browser Source view.
//
//   #/broadcast?id=12
//
// Point OBS at that URL at 1920x1080 and it fills the frame. There is no
// Twitch integration here and there should not be: OBS does the streaming,
// this just has to look like a broadcast and never blink.
//
// It is a VIEWER. It starts nothing and saves nothing - the commissioner
// drives from the Arena page on their phone. All this does is read one row
// and draw the consequences, which is why it can be left open on a scene
// for an hour without touching the database.
//
// The sync is free: an Arena race is a deterministic simulation, so given
// the seed and the start time this page computes the same race the phone is
// computing, frame for frame, with no position data crossing the wire.
// See the comment at the top of arena_broadcast_schema.sql.
// =====================================================================

import { db, isAdmin } from "../supabase.js";
import { esc, errorBox, toast } from "../ui.js";
import { backgroundMotion, createArenaRenderer, createFinishPresentation, createReactionTimeline, presentationRacerFrame, presentationScreenRatio } from "../arena/pixi-runtime-finish.js";
import { getReduceRaceMotion, onReduceRaceMotionChange, setReduceRaceMotion } from "../store.js";
import { loadMembers } from "../members.js";
import { spriteMarkup, themeLabel } from "../arena/sprites.js";
/* The same emitter the Arena stage uses. */
import { racerLanes } from "../arena/racer-view.js";
import { simulate, dramatize, visualEvents, intensityAt, boardState, newSeed, ticksFor, TICK_MS,
         finishTrajectories, presentFinish, raceShot } from "../arena/race-forward-shim.js";
import { claimFinish, persistResult, finalOffsetMs } from "../arena/results.js";
import { ensureBroadcastStyles } from "../lazy-css.js";
/* The OBS view is nothing but .bc-* furniture. */
ensureBroadcastStyles();

const LANE_COLORS = [
  "#2fbf5f", "#4aa3ff", "#f0a742", "#e0574a", "#b07cf0", "#3ecfcf",
  "#f2e05a", "#ff7fb0", "#8fd14f", "#ff9a4a", "#7f8cff", "#d6b254",
];

const raceMotionClass = () => getReduceRaceMotion() ? "race-motion-reduced" : "race-motion-full";
const applyRaceMotionClass = (element, reduced = getReduceRaceMotion()) => {
  element?.classList.toggle("race-motion-reduced", reduced);
  element?.classList.toggle("race-motion-full", !reduced);
};

// Everything this view owns, so teardown is one call. Leaving a stray rAF
// loop or a live channel behind would keep drawing over the next scene.
let live = null;

export async function render(view) {
  teardown();

  const id = new URLSearchParams(location.hash.split("?")[1] || "").get("id");
  if (!id) {
    view.innerHTML = `<h1>DFL Broadcast</h1>
      <div class="card"><div class="card-body">
        This is the clean OBS and shared-viewer route. Copy its URL from an
        Arena event's <strong>OBS setup</strong>, or add an event id to the
        address: <code>#/broadcast?id=12</code>
      </div></div>`;
    return;
  }

  const [eventRes, partsRes, members] = await Promise.all([
    db().from("arena_events").select("*").eq("id", id).maybeSingle(),
    db().from("arena_participants").select("*").eq("event_id", id).order("sort_order"),
    loadMembers().catch(() => []),
  ]);

  if (eventRes.error || !eventRes.data) {
    view.innerHTML = errorBox(eventRes.error || new Error("Event not found")) +
      `<div class="card"><div class="card-body muted">If the broadcast columns are
       missing, run <strong>arena_broadcast_schema.sql</strong>.</div></div>`;
    return;
  }

  const byId  = new Map(members.map((m) => [String(m.id), m]));
  const parts = partsRes.data || [];

  const racers = parts.map((p, i) => {
    /*
      THE RACER IS ITS PARTICIPANT ROW. The sprite key, the picture and the
      lane colour all come from arena_participants, and simulate() sees none
      of them - so the winner, the finish times and the order are byte for
      byte what they were.

      This used to layer the member's DFL Pet on top when they had made one.
      The pet is gone, and removing its export from profile-dfl.js while this
      import was still here took the whole Broadcast page down with it: a
      missing named export is a module-level failure, not a quiet undefined.
      The compatibility stub added to cover that is no longer needed.
    */
    return {
      id: p.member_id,
      name: byId.get(String(p.member_id))?.display_name || "Unknown",
      sprite: p.sprite,
      image: p.sprite_image,
      color: p.color || LANE_COLORS[i % LANE_COLORS.length],
      pet: null,
      number: p.number ?? i + 1,
    };
  });

  document.body.classList.add("broadcasting");
  paint(view, eventRes.data, racers);
  watch(view, id, racers);
  wireBar(view, id, racers);
}

/*
  The control bar.

  The broadcast was built as a pure viewer on the assumption the
  commissioner would drive it from their phone. That was wrong in the one
  case that matters: somebody opens this on the machine running OBS, in
  fullscreen, and there is then no way to start the race and no way back
  out of a page that has deliberately hidden the header and the tab bar.

  It behaves like a video player - visible on pointer movement, gone after a
  few idle seconds. OBS never moves a pointer, so the capture never sees it.
  It writes the same state the Arena panel writes, so either can drive.
*/
const COUNTDOWN_MS = 2700;
const BAR_IDLE_MS = 2600;
/*
  Longer while the race has not started, because the bar is now the thing the
  commissioner has come here to press. It still hides itself, so an OBS
  browser source pointed at this URL settles to a clean starting grid - OBS
  never moves a pointer, so the capture never brings it back.
*/
const BAR_STANDBY_MS = 7000;

function wireBar(view, id, racers) {
  const bar = view.querySelector("#bc-bar");
  if (!bar) return;

  /*
    Members lose the RACE controls, not the bar.

    Removing the whole thing would take Exit with it, and this page hides the
    header and the tab bar - so a member who opened the broadcast would have
    no way back into the app at all. Getting out is not an admin privilege.
  */
  const memberSafe = !isAdmin();
  if (memberSafe) {
    bar.querySelectorAll("#bc-go, #bc-hold, #bc-end, #bc-zero, .bc-bar-hint")
       .forEach((el) => el.remove());
  }

  const stage = view.querySelector("#bc-stage");
  let hideTimer = 0;
  const standingBy = () => {
    const state = live?.state?.bc_state;
    return !state || state === "idle";
  };
  /*
    GETTING OUT IS NOT ALLOWED TO TIME OUT.

    The bar's resting state is opacity 0, translated 130% down and
    pointer-events:none - so when the auto-hide fired it took EXIT with it, and
    Exit is the only way back into an app whose header and tab bar this page
    hides. For a member it is worse still: the block above removes every race
    control, so their bar contains Exit and almost nothing else, and hiding it
    hides the entire point of it.

    A member's bar therefore never hides. There is nothing on it that needs to
    get out of an OBS shot, because nobody is broadcasting a member's screen.
    Commissioners keep the auto-hide - a control bar across the bottom of the
    broadcast is exactly what it exists to avoid - and get Escape as well.
  */
  const show = () => {
    bar.classList.add("on");
    clearTimeout(hideTimer);
    if (memberSafe) return;
    hideTimer = setTimeout(() => bar.classList.remove("on"),
                           standingBy() ? BAR_STANDBY_MS : BAR_IDLE_MS);
  };
  stage.addEventListener("pointermove", show);
  stage.addEventListener("pointerdown", show);
  /* Touch-only browsers that do not synthesise pointer events would otherwise
     have no way to bring a hidden bar back at all. */
  stage.addEventListener("touchstart", show, { passive: true });
  /* And a keyboard route out that does not depend on finding the bar first. */
  const exitHref = bar.querySelector("a.bc-btn[href]")?.getAttribute("href");
  const onKey = (e) => {
    if (e.key !== "Escape" || !exitHref) return;
    if (document.fullscreenElement) return;   // Escape belongs to fullscreen first
    location.hash = exitHref;
  };
  document.addEventListener("keydown", onKey);
  if (live) live.stopBarKeys = () => document.removeEventListener("keydown", onKey);
  show();

  const row = () => live?.state;

  const write = async (patch, note) => {
    try {
      /*
        ASK FOR THE ROW BACK. THIS IS NOT DEFENSIVENESS, IT IS THE BUG.

        updateRow() runs .update().eq("id") with no .select(), so a write that
        RLS refuses matches zero rows and comes back with no error at all - a
        cheerful 204. This function then took that as success, ran the
        optimistic local apply below, and toasted "Countdown".

        So the commissioner's own screen started counting down while the shared
        row still said idle, and one second later the poll read the real row
        back and the countdown STOPPED. Reset behaved the same way: toast said
        "Reset", the result stayed on screen. Both looked like the race engine
        was broken when the truth was that the write never happened.

        The same trap is already documented for the keeper rules editor. Any
        privileged write in this app has to ask for the row back and report a
        zero-row result, because the database's way of saying "no" is silence.
      */
      const { data, error } = await db()
        .from("arena_events").update(patch).eq("id", id).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(
        "That was refused. A commissioner needs the Broadcast permission, and arena_commissioner_policy.sql has to have been run.");
      /*
        DRAW IT HERE IMMEDIATELY, rather than waiting to be told about it.

        This screen learns about the shared row from realtime, with a 1s poll
        behind it. That was fine while the race was started from somewhere
        else - this view was loading, and read the row on the way in. Now that
        START is here, the commissioner's own screen was the one waiting for a
        round trip to hear about its own button, and on the poll path it could
        lose a second of a 2.7s countdown before it drew anything.

        The patch is the same shape the realtime message carries, so this is
        the message arriving instantly for the one client that already knows.
        Every other viewer is unaffected and still counts down to the same
        bc_started_at.
      */
      if (live?.state) live.apply?.({ ...live.state, ...patch });
      if (note) toast(note);
    } catch (err) {
      toast(/bc_state|column/.test(err.message || "")
        ? "Run arena_broadcast_schema.sql in Supabase"
        : (err.message || "Could not change the broadcast"), true);
    }
  };

  bar.addEventListener("click", async (e) => {
    const r = row();
    show();

    if (e.target.closest("#bc-go")) {
      /*
        THIS IS THE START OF THE RACE, AND IT IS THE ONLY ONE.

        The event page used to write this row and then navigate here, which
        meant the countdown was already running while this view was still
        loading its members, building its simulation and mounting Pixi. The
        commissioner arrived somewhere between "2" and "GO". Nobody had time
        to rotate a phone, go fullscreen or check that OBS was live.

        The event page now only opens this view. Entering is not starting.
        The shared clock is written HERE, by a human pressing this button
        while looking at the starting grid, and every viewer - phones, other
        admins, the OBS browser source - counts down to the same
        bc_started_at from their own clock.

        A NEW SEED EVERY TIME, because this is "run a race". Watching a
        stored race again is a different action with different semantics and
        it still lives on the event page as Replay, which reuses the saved
        seed. Rolling here as well would have quietly turned the one
        same-seed flow into a re-roll.
      */
      return write({
        seed: newSeed(),
        bc_state: "running",
        bc_started_at: new Date(Date.now() + COUNTDOWN_MS).toISOString(),
        bc_offset_ms: 0,
      }, "Countdown");
    }

    if (e.target.closest("#bc-hold")) {
      if (r?.bc_state === "paused") {
        return write({
          bc_state: "running",
          bc_started_at: new Date().toISOString(),
          bc_offset_ms: r.bc_offset_ms || 0,
        }, "Resumed");
      }
      const now = r?.bc_started_at
        ? Date.now() - Date.parse(r.bc_started_at) + (r.bc_offset_ms || 0) : 0;
      return write({ bc_state: "paused", bc_offset_ms: Math.max(0, Math.round(now)) }, "Paused");
    }

    if (e.target.closest("#bc-end")) {
      const sim = simulate(racers, ticksFor(r?.race_length, r?.length_ticks), Number(r?.seed) || 1);
      return write({
        bc_state: "finished",
        bc_started_at: new Date().toISOString(),
        bc_offset_ms: (sim.order.at(-1)?.finishMs ?? 0) + 400,
      }, "Skipped to the finish");
    }

    if (e.target.closest("#bc-zero")) {
      return write({ bc_state: "idle", bc_started_at: null, bc_offset_ms: 0 }, "Reset");
    }

    if (e.target.closest("#bc-full")) {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch { toast("Fullscreen was refused by the browser", true); }
    }
  });

  bar.addEventListener("change", (e) => {
    if (e.target.id !== "bc-motion") return;
    setReduceRaceMotion(e.target.checked);
    applyRaceMotionClass(stage, e.target.checked);
    show();
    toast(e.target.checked ? "Race effects reduced on this device" : "Full race effects restored");
  });
}

/** Called by the router when leaving the page. */
export function leave() {
  teardown();
  document.body.classList.remove("broadcasting");
  // Never strand somebody in fullscreen on a page they have navigated away from.
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function teardown() {
  if (!live) return;
  cancelAnimationFrame(live.raf);
  clearInterval(live.poll);
  live.stopMotionWatch?.();
  live.stopBarKeys?.();
  live.resizeObserver?.disconnect?.();
  live.channel?.unsubscribe?.();
  live.pixi?.destroy?.();
  live = null;
}

// ------------------------------- the stage ----------------------------

function paint(view, event, racers) {
  view.innerHTML = `
    <div class="bc-stage cinematic-race ${raceMotionClass()}" id="bc-stage" data-theme="${esc(event.theme || "stadium")}">
      <header class="bc-head">
        <div class="bc-brand">
          <span class="bc-brand-mark">DFL <span>HQ</span></span>
          <span class="bc-brand-sub">Arena</span>
        </div>
        <div class="bc-title">
          <h1 class="bc-event">${esc(event.name)}</h1>
          <p class="bc-sub">${esc(event.description || themeLabel(event.theme) + " race")}</p>
        </div>
        <div class="bc-clock" id="bc-clock">0.0</div>
      </header>

      <div class="bc-body">
        <div class="bc-track" id="bc-track">
          <!--
            THE SCENERY LIVES INSIDE THE TRACK NOW, AND THAT IS THE FIX.

            It used to be a sibling of the header and the footer, pinned to
            the whole stage, so its percentages measured the WINDOW while the
            lanes measured the TRACK. Two coordinate systems, nothing keeping
            them in step: the horizon landed around the middle of the field
            and the top five or six racers ran through the sky, with the
            crowd down by the bottom lane's feet.

            In here, 0% and 100% are the top and bottom of the racers' own
            box. The course band below LANE_BAND_TOP is the running surface,
            everything above it is the world behind the course, and a racer
            cannot be drawn outside the band - so "planted on the course" is
            structural rather than a coincidence of two sets of numbers.
          -->
          <div class="race-scenery" aria-hidden="true">
            <svg class="arena-effect-defs" width="0" height="0" focusable="false" aria-hidden="true">
              <filter id="arena-motion-blur" x="-12%" y="-4%" width="124%" height="108%" color-interpolation-filters="sRGB">
                <feGaussianBlur data-arena-motion-blur stdDeviation="0 0" edgeMode="duplicate"></feGaussianBlur>
              </filter>
            </svg>
            <div class="race-sky"></div>
            <div class="race-hills far"></div>
            <div class="race-hills near"></div>
            <div class="race-stands"></div>
            <div class="race-crowd"></div>
            <div class="race-banners">
              <span>DFL</span><span>ARENA</span><span>DFL</span><span>ARENA</span>
              <span>DFL</span><span>ARENA</span><span>DFL</span><span>ARENA</span>
            </div>
            <div class="race-rail"></div>
            <div class="race-course"></div>
            <div class="race-verge"></div>
          </div>
          <div class="race-start-gate" aria-hidden="true"></div>
          <div class="bc-finish"></div>
          <!--
            THE LINE TIMES THEM AS THEY TOUCH IT. Rides the same --finish-x as
            the structure so it cannot drift off the line it is reporting, and
            it is the one part of this that IS a graphic - a time with a racer
            standing on it is not a timing display, so it sits above the
            racer plane while the structure sits below it.
          -->
          <div class="bc-finish-stamp" aria-hidden="true"><span class="bc-stamp-place"></span><span class="bc-stamp-time"></span></div>
          ${racerLanes(racers, { theme: event.theme, prefix: "bc", idPrefix: "bc-runner-" })}
        </div>

        <aside class="bc-board" id="bc-board">
          <div class="bc-board-head">Standings</div>
          <ol class="bc-board-list" id="bc-board-list">
            ${racers.map((r) => `
              <li><span class="bc-pos"></span><span class="bc-who">${esc(r.name)}</span><span class="bc-time"></span></li>`).join("")}
          </ol>
        </aside>
      </div>

      <div class="bc-overlay hidden" id="bc-overlay">
        <div class="bc-count" id="bc-count">3</div>
      </div>

      <div class="bc-winner hidden" id="bc-winner">
        <div class="bc-winner-inner">
          <span class="bc-winner-kicker">Winner</span>
          <span class="bc-winner-art" id="bc-winner-art" aria-hidden="true"></span>
          <span class="bc-winner-name" id="bc-winner-name"></span>
          <span class="bc-winner-event">${esc(event.name)}</span>
        </div>
      </div>

      <div class="bc-bar" id="bc-bar">
        <a class="bc-btn" href="#/arena?id=${event.id}" title="Leave broadcast">Exit</a>
        <button class="bc-btn bc-btn-go" id="bc-go" title="Start the race - writes the shared countdown for every viewer">Start race</button>
        <button class="bc-btn" id="bc-hold" title="Pause / resume">Pause</button>
        <button class="bc-btn" id="bc-end" title="Skip to finish">Skip</button>
        <button class="bc-btn" id="bc-zero" title="Reset to the start line">Reset</button>
        <button class="bc-btn" id="bc-full" title="Fullscreen">Fullscreen</button>
        <label class="bc-motion-setting" title="Use gentler race effects on this device"><input type="checkbox" id="bc-motion" ${getReduceRaceMotion() ? "checked" : ""}> Reduce race motion/effects</label>
        <span class="bc-bar-hint">Admin only · hides itself while streaming. Press <strong>Start race</strong> when everyone is watching.</span>
      </div>

      <footer class="bc-foot">
        <span class="bc-foot-left">${esc(themeLabel(event.theme))} · ${racers.length} racers</span>
        <span class="bc-foot-right" id="bc-status">Standing by</span>
      </footer>
    </div>
  `;
}

// ------------------------------ the loop ------------------------------

/**
 * Subscribe to the event row, then draw whatever it says.
 *
 * The simulation is rebuilt only when the seed or the length changes, not on
 * every state change - pausing must not re-roll the race.
 */
function watch(view, id, racers) {
  live = { raf: 0, poll: 0, channel: null, resizeObserver: null, pixi: null,
    /* Per-frame write guards. A rewound clock resets them with everything
       else, so seeking backwards cannot leave a stale stamp on the line. */
    lastGroundRatio: null, lastStampKey: "", lastStampFade: 0,
    trackWidth: 1, sim: null, simKey: "", state: null, sceneryBlurX: 0,
    saveTried: false,
    reduceMotionEffects: getReduceRaceMotion(), stopMotionWatch: null };

  const els = {
    runners: racers.map((_, i) => view.querySelector(`#bc-runner-${i}`)),
    clock:   view.querySelector("#bc-clock"),
    status:  view.querySelector("#bc-status"),
    board:   view.querySelector("#bc-board"),
    body:    view.querySelector(".bc-body"),
    list:    view.querySelector("#bc-board-list"),
    track:   view.querySelector("#bc-track"),
    scenery: view.querySelector(".race-scenery"),
    finish:  view.querySelector(".bc-finish"),
    stamp:   view.querySelector(".bc-finish-stamp"),
    stampPlace: view.querySelector(".bc-stamp-place"),
    stampTime:  view.querySelector(".bc-stamp-time"),
    sceneryBlur: view.querySelector("[data-arena-motion-blur]"),
    stage:   view.querySelector("#bc-stage"),
    go:      view.querySelector("#bc-go"),
    hold:    view.querySelector("#bc-hold"),
    overlay: view.querySelector("#bc-overlay"),
    count:   view.querySelector("#bc-count"),
    winner:  view.querySelector("#bc-winner"),
    winName: view.querySelector("#bc-winner-name"),
    winArt:  view.querySelector("#bc-winner-art"),
  };

  const session = live;
  applyRaceMotionClass(els.stage, live.reduceMotionEffects);
  live.stopMotionWatch = onReduceRaceMotionChange((reduced) => {
    if (live !== session) return;
    live.reduceMotionEffects = reduced;
    applyRaceMotionClass(els.stage, reduced);
    const checkbox = view.querySelector("#bc-motion");
    if (checkbox) checkbox.checked = reduced;
  });
  createArenaRenderer(els.track, racers).then((renderer) => {
    if (live !== session) { renderer?.destroy(); return; }
    live.pixi = renderer;
  });
  live.trackWidth = Math.max(1, els.track?.clientWidth || 1);
  if (typeof ResizeObserver === "function" && els.track) {
    live.resizeObserver = new ResizeObserver((entries) => {
      if (!live) return;
      live.trackWidth = Math.max(1, entries[0]?.contentRect?.width || els.track.clientWidth || 1);
    });
    live.resizeObserver.observe(els.track);
  }
  for (const runner of els.runners) {
    runner?.style.setProperty("--race-x", `${(live.trackWidth * .03).toFixed(2)}px`);
    runner?.classList.add("is-positioned");
  }

  const apply = (row) => {
    if (!row) return;
    /* A race that is back at the start line, or has been re-rolled onto a new
       seed, is a race whose result has not been written yet - so the one-shot
       save latch has to come off with it. Without this a "Run race again" in
       the same session would finish and quietly save nothing. */
    if (row.bc_state === "idle" || (live.state && row.seed !== live.state.seed)) live.saveTried = false;
    live.state = row;

    const ticks = ticksFor(row.race_length, row.length_ticks);
    const key = `${row.seed}:${ticks}:${racers.length}`;
    if (key !== live.simKey) {
      live.sim = simulate(racers, ticks, Number(row.seed) || 1);
      /*
        THE SAME THEATRE THE EVENT PAGE USES. This screen was still drawing
        raw sim.samples, which is why the OBS broadcast had none of the
        movement, none of the events and no split times - all of that lived
        in pages/arena.js and stopped at its own door. Same functions, same
        seed, so the two screens show the same race.
      */
      const drama = dramatize(live.sim, Number(row.seed) || 1);
      live.shown = drama.shown;
      live.events = drama.events;
      live.visuals = visualEvents(live.sim, live.shown, racers);
      live.pixiTimeline = createReactionTimeline(live.events, live.visuals, racers.length);
      live.nextVisual = 0;
      live.nextEvent = 0;
      live.expiry = [];
      live.lastElapsed = -1;
      live.official = new Map(live.sim.order.map((o) => [o.index, o.finishMs]));
      /* Finishing place, for the post-finish parking spots. */
      live.placeOf = new Map(live.sim.order.map((o) => [o.index, o.place]));
      live.trajectory = finishTrajectories(live.sim);
      live.leaderLane = null;
      live.lastLeadChangeMs = null;
      live.winnerMs = live.sim.order[0]?.finishMs ?? 0;
      live.homed = new Set();
      live.simKey = key;

      /*
        Finish time per LANE, and the last one of all.

        sim.order is sorted by finish, so it has to be turned back into
        lane order to be useful while drawing. Both are needed to stop the
        board and the clock at the right moment.
      */
      live.finishAt = new Array(racers.length).fill(Infinity);
      for (const o of live.sim.order) live.finishAt[o.index] = o.finishMs;
      live.lastFinish = live.sim.order.at(-1)?.finishMs ?? 0;
    }

    const hideBoard = row.bc_show_board === false;
    els.board.classList.toggle("hidden", hideBoard);
    // The track takes the freed column rather than leaving a gap.
    els.body.classList.toggle("no-board", hideBoard);
    els.clock.classList.toggle("hidden", row.bc_show_timer === false);
  };

  /* The control bar writes the shared row and then hands the patch straight
     to this, so the commissioner's own screen never waits for the round trip
     to react to its own button. See write() in wireBar. */
  live.apply = apply;

  // Initial read, then realtime, with polling as the safety net.
  const fetchRow = async () => {
    const { data } = await db().from("arena_events").select("*").eq("id", id).maybeSingle();
    if (data) apply(data);
  };
  fetchRow();

  try {
    live.channel = db()
      .channel(`arena-bc-${id}`)
      .on("postgres_changes",
          { event: "UPDATE", schema: "public", table: "arena_events", filter: `id=eq.${id}` },
          (payload) => apply(payload.new))
      .subscribe();
  } catch {
    /* realtime unavailable - the poll below covers it */
  }

  // Cheap, and it means a missed realtime message costs at most a second.
  live.poll = setInterval(fetchRow, 1000);

  // ---- draw ----
  let lastBoard = 0;

  const frame = () => {
    const row = live.state;
    if (row && live.sim) {
      const sim = live.sim;
      const elapsed = elapsedMs(row);
      const state = row.bc_state;

      /*
        The countdown is not a state, it is a negative clock. The
        commissioner sets bc_started_at a few seconds into the future and
        every viewer counts down to it independently - so ONE write starts
        the race and nothing has to flip a flag when the countdown ends.
      */
      if (elapsed < 0 && state !== "idle") {
        const left = Math.ceil(-elapsed / 1000);
        els.overlay.classList.remove("hidden");
        els.count.textContent = left > 0 ? String(left) : "GO!";
        els.count.classList.toggle("go", left <= 0);
        els.status.textContent = left > 0 ? "Set" : "Away!";
      } else if (state === "running" && elapsed >= 0 && elapsed < 650) {
        els.overlay.classList.remove("hidden");
        els.count.textContent = "GO!";
        els.count.classList.add("go");
      } else {
        els.overlay.classList.add("hidden");
      }

      const t = Math.max(0, Math.min(sim.frames, elapsed / TICK_MS));
      const lo = Math.floor(t), hi = Math.min(sim.frames, lo + 1), mix = t - lo;

      const src = live.shown || sim.samples;
      let leaderProgress = 0;
      for (const samples of src) {
        const progress = (samples[lo] ?? 0) + ((samples[hi] ?? samples[lo] ?? 0) - (samples[lo] ?? 0)) * mix;
        leaderProgress = Math.max(leaderProgress, progress);
      }
      const finishPresentation = createFinishPresentation({
        elapsedMs: Math.max(0, elapsed), leaderProgress, order: sim.order, racers,
      });
      /*
        PHOTO FINISH IS PRESENTATION ONLY, AND IT IS NOW OFF.

        Close races use the exact same clock and finish object as every other
        race. The generated runtime may still know how to draw its old photo
        treatment, but this viewer never hands that branch to Pixi and never
        lets it remap visual time. The stripe records the crossing; it does not
        alter how somebody gets there.
      */
      const racerElapsed = Math.max(0, elapsed);
      const firstFinishMs = sim.order[0]?.finishMs ?? Infinity;
      finishPresentation.visualElapsedMs = racerElapsed;
      finishPresentation.crossingShownMs = firstFinishMs;
      finishPresentation.crossingShown = racerElapsed >= firstFinishMs;
      if ("photoFinish" in finishPresentation) delete finishPresentation.photoFinish;

      const visualT = Math.max(0, Math.min(sim.frames, racerElapsed / TICK_MS));
      const visualLo = Math.floor(visualT);
      const visualHi = Math.min(sim.frames, visualLo + 1);
      const visualMix = visualT - visualLo;
      els.stage.dataset.camera = finishPresentation.camera.state;
      els.stage.style.setProperty("--finish-camera", finishPresentation.camera.mix.toFixed(4));
      const heat = intensityAt(src, lo);
      const band = heat > .66 ? "3" : heat > .33 ? "2" : heat > 0 ? "1" : "0";
      if (els.track && els.track.dataset.heat !== band) els.track.dataset.heat = band;
      const pixiRacers = [];
      for (let i = 0; i < els.runners.length; i++) {
        const s = src[i];
        const pixiRacer = presentationRacerFrame({
          id: racers[i].id, lane: i, samples: s, lo: visualLo, hi: visualHi, mix: visualMix,
          elapsedMs: racerElapsed, officialFinishMs: live.official?.get(i), timeline: live.pixiTimeline,
        });

        /*
          THE AHEAD-OF-TRUTH CLAMP WAS REMOVED HERE, and it was measured rather
          than judged.

          It restricted how far ahead of truth a racer could be drawn past 70%
          progress, tightening to 1.5% by 82%. The problem it was aimed at - a
          slow racer drawn at 95-99% while its real race was far from the line -
          was caused by the engine's maxTicks guard freezing samples at 98%, and
          that was fixed properly in the engine (1.6x -> 3.1x plus a speed
          floor). With truth actually reaching the line, the theatre converges on
          its own: measured across four seeds, the earliest any racer is drawn at
          the line is 80ms before its own finish, and the longest spell drawn at
          >=99.5% is 120ms. Three frames. Nothing to clamp.

          What the clamp DID do was make things worse where it mattered most. A
          ceiling that tightens as truth rises subtracts from a rising value, so
          a small collapse becomes a large backward step. Past 70% truth:

            raw theatre     went backwards by at most 0.61% of the track
            with the clamp  up to 5.80% - an order of magnitude more

          At 5.8% of progress that is roughly 24px of visible backward lurch on a
          785px track, arriving in the second the race is decided. The specs in
          theatre.spec.ts now assert both properties, so neither the original bug
          nor this cure can come back unnoticed.
        */
        const p = pixiRacer.progress;
        /* Same coast the Arena applies - one implementation in race.js, so
           the two cameras cannot disagree about where a finisher parks. */
        presentFinish(pixiRacer, racerElapsed,
                      live.trajectory?.[i], finishPresentation.celebrationActive);
        const phase = pixiRacer.phase;
        const screenRatio = presentationScreenRatio(pixiRacer.displayProgress, finishPresentation.camera);
        els.runners[i].style.setProperty("--race-x", `${(live.trackWidth * screenRatio).toFixed(2)}px`);
        if (els.runners[i].dataset.phase !== phase) els.runners[i].dataset.phase = phase;
        pixiRacers.push(pixiRacer);
      }
      const pixiLeader = pixiRacers.reduce((best, item) => item.progress > best.progress ? item : best, pixiRacers[0]);
      if (pixiLeader) pixiLeader.leading = true;
      /* A genuine change of hands, for the camera. The first leader of the
         race is not a change - nobody held it before them. */
      if (pixiLeader && pixiLeader.lane !== live.leaderLane) {
        if (live.leaderLane != null) live.lastLeadChangeMs = Math.max(0, elapsed);
        live.leaderLane = pixiLeader.lane;
      }
      /* The 2D camera, same states and same rules as the Arena stage. */
      const shot = raceShot({
        leaderProgress,
        celebrating: finishPresentation.celebrationActive,
      });
      if (els.stage.dataset.shot !== shot) els.stage.dataset.shot = shot;
      /*
        THE FINISH STRUCTURE'S POSITION ON THE COURSE.

        A ratio of the frame in the RACERS' own coordinate system, so the
        structure and the field are placed by one map and the structure can be
        drawn beneath the racer plane where the ground is. Time-derived, so a
        racer falling backwards cannot drag the scenery back with them, and
        anchored to the WINNER'S finish rather than to the middle of the whole
        finish window - which is what used to leave it offscreen at the exact
        moment the race was decided. It rolls at ground speed and comes to rest
        on progress 1.0. See finishGroundRatio().
      */
      /*
        A NUMBER, WHATEVER THE BUNDLE SAYS.

        finish.groundRatio arrives from js/arena/pixi-runtime.js, which is a
        COMMITTED build artefact - so a client running new page code against an
        older cached bundle gets undefined here, and `undefined.toFixed()`
        throws inside the animation frame. That kills the rAF loop, which stops
        the race dead after the countdown and stops anything from redrawing,
        including a reset. It is not hypothetical: a stale APP_SHELL entry kept
        the service worker from installing for three releases, so clients were
        held on exactly that kind of skew.

        This app already survives a partial DATABASE rather than white-screening.
        A partial cache is the same problem. A missing value parks the structure
        off-frame and the race still runs.
      */
      const groundRatio = Number.isFinite(finishPresentation.groundRatio)
        ? finishPresentation.groundRatio : 1.02;
      if (groundRatio !== live.lastGroundRatio) {
        els.stage.style.setProperty("--finish-x", groundRatio.toFixed(5));
        live.lastGroundRatio = groundRatio;
      }
      /*
        AND THE TIME OF WHOEVER IS ON IT. One slot: crossings can arrive
        120ms apart and two times overlapping at one structure is unreadable,
        so finishStamp() hands the slot to the racer who is on the line now.
        The board keeps the full order - this is the touch.
      */
      const stamp = finishPresentation.stamp;
      const stampKey = stamp ? `${stamp.index}:${stamp.finishMs}` : "";
      if (stampKey !== live.lastStampKey) {
        live.lastStampKey = stampKey;
        if (stamp && els.stampPlace && els.stampTime) {
          /* "P1", not "1" - the place and the time sit side by side and a
             bare digit ran straight into the seconds as "110.17s". */
          els.stampPlace.textContent = `P${stamp.place}`;
          /* Same formatting as the board's winner time, from the same
             authoritative finishMs - the stamp and the board cannot disagree
             about what a racer's time was. */
          els.stampTime.textContent = `${(stamp.finishMs / 1000).toFixed(2)}s`;
        }
      }
      const stampFade = stamp ? stamp.fade : 0;
      if (Math.abs(stampFade - live.lastStampFade) > 0.004 || (stampFade === 0) !== (live.lastStampFade === 0)) {
        els.stage.style.setProperty("--stamp-fade", stampFade.toFixed(3));
        live.lastStampFade = stampFade;
      }
      const pixiState = finishPresentation.celebrationActive ? "finished" : state === "paused" ? "paused" : state === "idle" ? "idle" : "running";
      /* Standing by, counting down, racing or done - the stylesheet needs to
         know so the starting grid can present itself and the control bar can
         stay put while nothing is happening. */
      const shownState = state === "idle" ? "idle" : elapsed < 0 ? "countdown" : pixiState;
      if (els.stage.dataset.raceState !== shownState) {
        els.stage.dataset.raceState = shownState;
        /*
          THE BUTTON SAYS WHAT IT WILL DO.

          #bc-hold was labelled "Pause" permanently, so a paused race offered
          "Pause" next to "Start race" and the obvious thing to press was
          Start. Start is not resume: it rolls a NEW SEED and begins a
          different race, which is a genuinely destructive thing to hand
          somebody who only wanted to carry on.

          So the label follows the state, and Start is disabled outright while
          paused - the way out of a pause is Resume, and if somebody really
          does want a fresh race there is Reset first. Guarded for null
          because a member's bar has had these removed entirely.
        */
        const paused = shownState === "paused";
        if (els.hold) {
          const label = paused ? "Resume" : "Pause";
          if (els.hold.textContent !== label) els.hold.textContent = label;
          els.hold.title = paused ? "Resume the race where it stopped" : "Pause the race for every viewer";
        }
        if (els.go) {
          els.go.disabled = paused;
          els.go.title = paused
            ? "Paused - press Resume to carry on. Starting would roll a new seed and run a different race."
            : "Start the race - writes the shared countdown for every viewer";
        }
      }
      live.pixi?.render({
        elapsedMs: Math.max(0, elapsed),
        state: elapsed < 0 ? "idle" : pixiState,
        heat: Number(band),
        racers: pixiRacers,
        countdownMs: elapsed < 0 ? Math.abs(elapsed) : 0,
        winnerId: sim.order[0]?.racer?.id,
        finish: finishPresentation,
        reduceMotionEffects: live.reduceMotionEffects,
      });
      /*
        THE COURSE STOPS WHEN THE LINE IS HOME.

        Once the structure is standing on the crossing point the world has
        arrived: the pan HOLDS at whatever it had reached and the motion blur
        comes off, so the only thing still moving is the racers running through.
        From a fixed camera that is the difference between "the line reached us"
        and "the line is sliding past while we run".

        The pan is held rather than reset - snapping the scenery back to 0 at the
        moment of the finish would be a jump cut into the most important second
        of the race. It is also latched off the presentation's own clock, so a
        racer collapsing cannot make the background start moving again.
      */
      const courseStopped = finishPresentation.courseStopped === true;
      if (els.scenery && !courseStopped) {
        els.scenery.style.setProperty("--race-pan", Math.min(1, leaderProgress).toFixed(4));
      }
      if (els.stage.dataset.courseStopped !== String(courseStopped)) {
        els.stage.dataset.courseStopped = String(courseStopped);
      }
      const backdrop = courseStopped
        ? { blurX: 0, blurY: 0, intensity: 0 }
        : backgroundMotion(elapsed < 0 ? "idle" : pixiState, heat,
            finishPresentation.celebrationActive, live.reduceMotionEffects);
      live.sceneryBlurX += (backdrop.blurX - live.sceneryBlurX) * .16;
      els.sceneryBlur?.setAttribute("stdDeviation", `${live.sceneryBlurX.toFixed(2)} ${backdrop.blurY.toFixed(2)}`);
      els.stage?.style.setProperty("--arena-motion", backdrop.intensity.toFixed(3));

      /*
        EVENTS AND REACTIONS.

        The clock here is shared and seekable - a commissioner can restart
        or the page can be opened mid-race - so the queue index is reset
        whenever the clock goes backwards rather than assuming it only ever
        moves forward like the event page's does.
      */
      if (elapsed < live.lastElapsed) {
        live.nextVisual = 0; live.nextEvent = 0; live.homed.clear();
        for (const [el, cls] of live.expiry) el.classList.remove(cls, "is-hot");
        live.expiry.length = 0;
        for (const el of els.runners) el.classList.remove("is-surge","is-stumble","is-jump","is-duel","is-near","is-hot","is-home","is-finished","is-winner","is-leading");
        /* The camera is seekable too: a rewound clock must not keep
           holding a low shot for a lead change that has not happened yet. */
        live.leaderLane = null;
        live.lastLeadChangeMs = null;
        for (const el of els.runners) delete el.dataset.phase;
      }
      live.lastElapsed = elapsed;

      const track = els.track;
      if (state === "running" && elapsed >= 0 && !finishPresentation.allExited) {
        track?.classList.add("is-running");
        els.stage?.classList.add("is-racing");
      } else {
        track?.classList.remove("is-running");
        els.stage?.classList.remove("is-racing");
      }

      while (live.nextEvent < (live.events?.length || 0) && elapsed >= live.events[live.nextEvent].ms) {
        const ev = live.events[live.nextEvent++];
        const el = els.runners[ev.racer];
        if (el) {
          el.classList.remove("is-surge", "is-stumble");
          el.classList.add(ev.kind === "stumble" ? "is-stumble" : "is-surge");
          live.expiry.push([el, ev.kind === "stumble" ? "is-stumble" : "is-surge", elapsed + ev.durMs]);
        }
      }

      while (live.nextVisual < (live.visuals?.length || 0) && elapsed >= live.visuals[live.nextVisual].ms) {
        const ev = live.visuals[live.nextVisual++];
        const hot = ev.intensity >= 0.6;
        const touch = (i, cls) => {
          const el = els.runners[i];
          if (!el) return;
          el.classList.add(cls);
          if (hot) el.classList.add("is-hot");
          live.expiry.push([el, cls, elapsed + ev.durMs]);
        };
        if (ev.kind === "jump") touch(ev.racer, "is-jump");
        else if (ev.kind === "swap") { touch(ev.racer, "is-duel"); touch(ev.other, "is-duel"); }
        else if (ev.kind === "near") { touch(ev.racer, "is-near"); touch(ev.other, "is-near"); }
      }

      for (let k = live.expiry.length - 1; k >= 0; k--) {
        if (elapsed >= live.expiry[k][2]) {
          live.expiry[k][0].classList.remove(live.expiry[k][1], "is-hot");
          live.expiry.splice(k, 1);
        }
      }

      /* Individual finishes, so the stream shows people arriving one by
         one rather than the field simply stopping. */
      for (let i = 0; i < els.runners.length; i++) {
        const ms = live.official?.get(i);
        if (ms == null || live.homed.has(i) || elapsed < ms) continue;
        live.homed.add(i);
        const el = els.runners[i];
        el?.classList.remove("is-surge", "is-stumble", "is-duel");
        el?.classList.add("is-finished");
      }

      if (finishPresentation.celebrationActive) {
        const winner = els.runners[sim.order[0].index];
        winner?.classList.remove("is-finished");
        winner?.classList.add("is-winner");
      }

      if (row.bc_show_timer !== false) {
        // Frozen at the last finish: a race clock that carries on counting
        // after everybody is home is just a stopwatch nobody stopped.
        const shown = Math.min(Math.max(0, elapsed), live.lastFinish);
        els.clock.textContent = (shown / 1000).toFixed(1);
      }

      // The board is text: 6 updates a second is plenty and keeps the main
      // thread free for the lanes.
      const now = performance.now();
      if (now - lastBoard > 160) {
        lastBoard = now;
        drawBoard(els.list, racers, sim, t, elapsed, live.finishAt, live.shown, live.winnerMs);
      }

      const finishMs = sim.order.at(-1)?.finishMs ?? 0;
      const done = finishPresentation.celebrationActive;

      if (done) {
        /*
          THE RACE IS OVER, SO THE RESULT GETS WRITTEN - here, once.

          This used to be the Arena page's job, because the Arena page ran
          its own copy of the race and knew when its own copy ended. It does
          not run one any more: this view IS the race, for the commissioner
          as much as for everybody else, so the moment the celebration starts
          is the only place that actually knows the race finished.

          claimFinish() is a compare-and-set, not a flag on this page. Two
          admins watching - a phone and the OBS machine - reach this frame
          together, and only the one whose update actually flips bc_state
          goes on to write the rows. See arena/results.js.

          Never awaited into the frame loop and never retried: a failed save
          must not stutter the winner presentation, and the commissioner
          still has "Save result" on the event page.
        */
        if (!live.saveTried && isAdmin()) {
          live.saveTried = true;
          const seed = Number(row.seed) || 1;
          (async () => {
            if (!(await claimFinish(id, finalOffsetMs(sim)))) return;   // somebody else has it
            await persistResult(id, sim, seed);
            toast("Result saved");
          })().catch((err) => toast(err.message || "Could not save the result", true));
        }
        const win = sim.order[0];
        els.winName.textContent = win?.racer.name || "";
        if (win && els.winArt && !els.winArt.dataset.racer) {
          const art = els.runners[win.index]?.querySelector(".bc-runner-art");
          els.winArt.innerHTML = art?.innerHTML || "";
          els.winArt.dataset.racer = String(win.index);
        }
        els.stage?.classList.add("is-finished");
        els.winner.classList.remove("hidden");
        els.status.textContent = "Final";
      } else {
        els.winner.classList.add("hidden");
        els.stage?.classList.remove("is-finished");
        if (els.winArt) { els.winArt.innerHTML = ""; delete els.winArt.dataset.racer; }
        if (state === "running") {
          els.status.textContent = elapsed > finishMs * 0.82 ? "Final stretch" : "Racing";
        } else if (state === "paused")  els.status.textContent = "Paused";
        else if (state === "idle")      els.status.textContent = "Standing by on the starting grid";
      }
    }
    live.raf = requestAnimationFrame(frame);
  };
  live.raf = requestAnimationFrame(frame);
}

/*
  Elapsed race time from the row alone, so a refresh on either machine lands
  in exactly the same place.

  A negative value is the countdown: the commissioner sets bc_started_at a
  few seconds into the future, and every viewer counts down to it together
  without a single message being exchanged.
*/
function elapsedMs(row) {
  if (!row.bc_started_at) return 0;
  if (row.bc_state === "idle") return 0;
  const started = Date.parse(row.bc_started_at);
  if (Number.isNaN(started)) return 0;

  // While paused, bc_offset_ms already holds the frozen elapsed time.
  if (row.bc_state === "paused") return row.bc_offset_ms || 0;
  return Date.now() - started - 0 + (row.bc_offset_ms || 0);
}


/**
 * Live standings.
 *
 * A placing is SET when it is earned. Ordering purely by distance looked
 * right until somebody crossed: a finished racer sits at exactly 1.0, so
 * every finisher tied with every other finisher and the tie-break reshuffled
 * them - 1st and 2nd could swap after both were home, and once the whole
 * field was in, the board showed lane order instead of the result.
 *
 * So: anybody home is ranked by WHEN they got home, always ahead of anybody
 * still running, and the still-running are ranked by distance with lane
 * order as the tie-break (which is what stops a standing start flickering).
 */
function drawBoard(list, racers, sim, t, elapsed, finishAt, shown, winnerMs = 0) {
  /* ONE authority - the same boardState() the Arena page calls, with the
     same arguments. The two boards cannot disagree about order, gaps or
     who is home, because there is only one implementation of the rule. */
  const state = boardState(sim, shown, elapsed);
  const done = (i) => state.find((x) => x.index === i)?.done;
  const rows = state.map((x) => ({ r: racers[x.index], i: x.index, label: x.label }));

  const items = list.children;
  for (let i = 0; i < items.length; i++) {
    const li = items[i];
    const row = rows[i];
    if (!row) continue;
    // Only write when the text actually changes - this runs six times a
    // second and the DOM should not be touched for nothing.
    const pos = String(i + 1);
    if (li.firstElementChild.textContent !== pos) li.firstElementChild.textContent = pos;
    /*
      .bc-who BY NAME, NOT lastElementChild.

      The row gained a third span for the split time, which made the TIME
      cell the last child - so this wrote every racer's name into the time
      column and never updated the name column at all. That is the broken
      broadcast leaderboard. Ask for the element that is meant.
    */
    const who = li.querySelector(".bc-who");
    const name = row.r.name;
    if (who && who.textContent !== name) {
      who.textContent = name;
      li.classList.remove("bc-move");
      void li.offsetWidth;
      li.classList.add("bc-move");
    }
    li.style.setProperty("--racer", row.r.color);
    li.classList.toggle("leader", i === 0);

    /*
      THE SPLIT. The winner's own time, then the gap to them - straight off
      the authoritative finishMs, never measured from the animation.
    */
    const time = li.querySelector(".bc-time");
    if (time && time.textContent !== row.label) time.textContent = row.label;
    li.classList.toggle("is-home", done(row.i));
  }
}

// =====================================================================
// arena/race.js - the simulation. No DOM in this file.
// ---------------------------------------------------------------------
// The race is simulated to completion BEFORE anything animates, and the
// renderer then plays back the recording. That split buys three things:
//
//   * the finish order is known and fair, decided by the model rather than
//     by frame timing on whatever phone is watching
//   * a slow device drops frames instead of changing who wins
//   * the same seed replays the same race, so a saved event can be watched
//     again and it is the real one, not a re-roll
//
// HOW IT LOOKS LIKE A RACE
// Constant speeds are a progress bar, and pure per-frame randomness is
// teleportation. What reads as a race is momentum: each racer eases toward
// a target speed that itself drifts, so movement is smooth but never
// uniform. On top of that:
//
//   talent        a small fixed edge, so form is not pure noise
//   bursts        short accelerations that visibly pass people
//   stumbles      brief slowdowns, the same thing in reverse
//   drafting      a gentle pull toward the pack, which keeps the field
//                 together, manufactures lead changes, and is what makes
//                 photo finishes happen instead of a runaway
//   clutch        a final-stretch surge, per racer, so the last 20% of the
//                 track actually decides something
// =====================================================================
/*
  THE SIMULATION HAS MOVED to ./race-sim.js.

  Not for tidiness: this file re-exports finish helpers from
  pixi-runtime-finish.js, which pulls in the whole PixiJS runtime. Anything
  wanting only the maths had to load a WebGL renderer to get it, which is what
  made the parity spec time out. The names below are unchanged, so every caller
  and the forward shim carry on as before - but a caller that needs just the
  numbers should import ./race-sim.js directly and skip the graphics entirely.
*/
export { newSeed, TICK_MS, LENGTHS, ticksFor, raceSeconds, simulate } from "./race-sim.js";
/* The callout, event and board helpers below still tick in TICK_MS. */
import { TICK_MS } from "./race-sim.js";

/* =====================================================================
   THE THEATRE LAYER HAS MOVED.
   ---------------------------------------------------------------------
   dramatize() and everything that shaped it - the launch, the arcs, the
   waves, the closing convergence, the allowances - now live in
   src/arena/theatre.ts, typed and covered by src/arena/theatre.spec.ts.

   It moved because it was the most consequential code in the Arena and the
   least protected: a thousand lines of untyped JavaScript with no unit
   test, where every bug found in it was caught by a browser probe that did
   not persist. The invariants are specs now - no early crossing, bounded
   backslide, deterministic replay, smooth motion - so the next change to
   it either keeps them or fails.

   It is re-exported from here so callers do not care where it lives.
   ===================================================================== */
export { dramatize, crossingSpeeds } from "./pixi-runtime-finish.js";

const VERB = {
  surge:     (n) => `🔥 ${n} surges`,
  stumble:   (n) => `😬 ${n} stalls`,
  breakaway: (n) => `🚀 ${n} breaks away`,
  comeback:  (n) => `👀 ${n} is closing`,
  push:      (n) => `💨 ${n} makes a move`,
};

/**
 * The commentary. Real events and real positions only.
 *
 * There is no points data in an Arena event - it is a race, not a
 * scoreboard - so nothing here talks about swings or margins in points.
 * The gap at the line is in seconds, because seconds is what was measured.
 */
export function callouts(sim, shown, racers, events = []) {
  const n = shown.length;
  if (n < 2) return [];
  const out = [];
  const nameOf = (i) => racers[i]?.name || `Racer ${i + 1}`;

  for (const e of events) {
    const say = VERB[e.kind];
    if (say) out.push({ ms: e.ms, text: say(nameOf(e.racer)) });
  }

  // Lead changes, read off the drawing - what the viewer actually sees.
  let leader = -1;
  for (let t = 0; t <= sim.frames; t++) {
    let top = 0;
    for (let i = 1; i < n; i++) if (shown[i][t] > shown[top][t]) top = i;
    if (top !== leader) {
      if (leader >= 0 && shown[top][t] < 0.95) {
        out.push({ ms: t * TICK_MS, text: `⚔️ ${nameOf(top)} takes the lead`, strong: true });
      }
      leader = top;
    }
  }

  const first = sim.order[0], second = sim.order[1];
  if (first && second) {
    const gap = (second.finishMs - first.finishMs) / 1000;
    out.push({ ms: Math.max(0, first.finishMs - 1500), text: "🏁 Final push" });
    out.push({ ms: first.finishMs, strong: true,
      text: gap <= 0.25 ? `🏆 Photo finish — ${gap.toFixed(2)}s` : `🏆 ${nameOf(first.index)} wins` });
  }

  /*
    THINNED, NOT SPAMMED. Every line above is a real moment, but six of
    them inside four seconds is a wall of text rather than commentary. A
    lead change and the result always survive; anything else needs 2.5
    seconds of clear air.
  */
  out.sort((a, b) => a.ms - b.ms);
  const kept = [];
  let lastMs = -9999;
  for (const c of out) {
    if (c.strong || c.ms - lastMs >= 2500) { kept.push(c); lastMs = c.ms; }
  }
  return kept;
}

/* =====================================================================
   VISUAL EVENTS - computed ONCE, before a single frame is drawn.
   ---------------------------------------------------------------------
   The brief worried about per-frame pairwise comparison across twelve
   racers. It is not needed: `shown` is a finished recording by the time
   playback starts, so the entire race can be scanned in one pass here and
   the render loop only has to walk a sorted queue.

   That is the difference between O(n^2) sixty times a second forever and
   O(n^2) once over a few hundred ticks - and it means every effect has a
   known start, duration and intensity before anything animates.

   FOUR KINDS, all derived from real movement:

     jump   a racer gained 2+ places in a short window
     swap   the same pair traded places repeatedly - escalating
     near   two racers came within a whisker of each other
     (final-stretch intensity is not an event; it is a curve the renderer
      reads off progress, because it applies to everything at once)

   NOTHING HERE CAN CHANGE THE RACE. It only reads `shown`, which is
   already only the drawing, and returns a list of things to animate.
   ===================================================================== */

/** Ranking at one tick, from the drawn positions. */
function placesAt(shown, t) {
  const n = shown.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => shown[b][t] - shown[a][t]);
  const place = new Array(n);
  for (let p = 0; p < n; p++) place[idx[p]] = p;
  return place;
}

/** How close the nearest rival is, used for the near-miss sparks. */
const NEAR = 0.012;          // ~1% of the track
const JUMP_WINDOW = 25;      // ticks (~1s) over which a "jump" is measured

/**
 * Everything worth animating, in playback order.
 *
 * @returns {Array<{ms,kind,racer,other,places,intensity,durMs,text}>}
 */
export function visualEvents(sim, shown, racers) {
  const n = shown.length;
  if (n < 2) return [];
  const frames = sim.frames;
  const nameOf = (i) => racers[i]?.name || `Racer ${i + 1}`;
  const out = [];

  /* Sampled rather than every tick: a place cannot meaningfully change in
     40ms, and this keeps the whole scan to a few hundred iterations. */
  const STEP = 5;
  let prev = placesAt(shown, 0);
  const history = [{ t: 0, place: prev }];

  /* Pair bookkeeping for swap escalation and near-miss throttling. Keyed
     by the pair, so one close duel cannot spawn hundreds of effects. */
  const swaps = new Map();     // "a:b" -> { count, lastMs }
  const lastJump = new Array(n).fill(-9999);   // per racer
  /*
    GLOBAL COOLDOWNS, AND THEY ARE THE DIFFERENCE BETWEEN DRAMA AND NOISE.

    Twelve racers is 66 pairs. Throttling per pair looked reasonable and
    produced 556 events a race with 66 landing in a single second - every
    racer flashing constantly, which reads as a broken screen rather than
    a close race. The budget is now global: at most one near-miss and one
    duel beat in play at a time, and the CLOSEST pair wins the slot.
  */
  let lastNearMs = -9999, lastSwapMs = -9999;

  for (let t = STEP; t <= frames; t += STEP) {
    const place = placesAt(shown, t);
    const ms = t * TICK_MS;

    // ---- multi-position jumps ------------------------------------------
    const back = history.find((h) => t - h.t <= JUMP_WINDOW) || history[history.length - 1];
    for (let i = 0; i < n; i++) {
      const gained = back.place[i] - place[i];
      /* 2+ places, and only once the racer has settled there - measured
         against the window rather than the previous sample, so a single
         wobble across a boundary is not a "jump". */
      /*
        NOT OFF THE LINE. Everybody starts level, so the first couple of
        seconds are the field sorting itself out from a dead heat - which
        generated a burst of "+2" callouts at 0.2s that meant nothing.
        A jump has to happen in an established race to be a jump.
      */
      if (gained >= 2 && shown[i][t] > 0.12 && shown[i][t] < 0.97) {
        /* Per RACER, not "the last event pushed" - the first cut compared
           against whatever was most recently added, so two racers jumping
           in turn each cleared the other's cooldown. */
        if (ms - lastJump[i] > 3500) {
          lastJump[i] = ms;
          out.push({
            ms, kind: "jump", racer: i, places: gained,
            intensity: Math.min(1, gained / 4),
            durMs: 1200,
            text: place[i] === 0 ? `⚔️ ${nameOf(i)} takes the lead`
                                 : `⬆️ ${nameOf(i)} +${gained}`,
          });
        }
      }
    }

    // ---- rapid swaps, and the proximity that goes with them -------------
    let closest = { gap: Infinity, a: -1, b: -1 };
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const key = `${a}:${b}`;
        const swapped = (prev[a] < prev[b]) !== (place[a] < place[b]);
        if (swapped) {
          const rec = swaps.get(key) || { count: 0, lastMs: -9999 };
          /* Only count it as part of a RUN if it happened soon after the
             last one; otherwise the pair starts fresh. That is what makes
             a genuine back-and-forth escalate and two unrelated passes
             twenty seconds apart stay calm. */
          rec.count = ms - rec.lastMs < 4000 ? rec.count + 1 : 1;
          rec.lastMs = ms;
          swaps.set(key, rec);
          if (rec.count >= 2 && ms - lastSwapMs > 1500) {
            lastSwapMs = ms;
            out.push({
              ms, kind: "swap", racer: a, other: b,
              intensity: Math.min(1, rec.count / 4),
              durMs: 900,
            });
          }
        }

        // The closest pair at this sample, for the one near-miss slot.
        const gap = Math.abs(shown[a][t] - shown[b][t]);
        if (gap < NEAR && shown[a][t] < 0.97 && gap < closest.gap) closest = { gap, a, b };
      }
    }

    /* One spark at a time, for whichever pair is actually tightest. */
    if (closest.a >= 0 && ms - lastNearMs > 1200) {
      lastNearMs = ms;
      out.push({ ms, kind: "near", racer: closest.a, other: closest.b, intensity: 0.4, durMs: 600 });
    }

    prev = place;
    history.push({ t, place });
    if (history.length > 12) history.shift();
  }

  out.sort((a, b) => a.ms - b.ms);
  return out;
}

/**
 * How intense the presentation should be at a given moment, 0 to 1.
 *
 * A CURVE, NOT A SWITCH. The brief asked for the final stretch to ramp
 * rather than flip at a threshold, so this is a smooth rise across the
 * last 30% of the leader's progress. The renderer multiplies its effects
 * by it; nothing about the race changes, and the racers are not moving
 * any faster - it only looks like more is at stake, which by then it is.
 */
export function intensityAt(shown, t) {
  let lead = 0;
  for (let i = 0; i < shown.length; i++) if (shown[i][t] > lead) lead = shown[i][t];
  if (lead <= 0.7) return 0;
  const x = Math.min(1, (lead - 0.7) / 0.3);
  return x * x;                     // slow start, strong finish
}


/* The finish trajectory lives in src/arena/theatre.ts with the rest of the
   theatre, precomputed once per race and covered by theatre.spec.ts. */
export { finishTrajectories, presentFinish, coastProgress, settleOffset } from "./pixi-runtime-finish.js";

/* =====================================================================
   THE SHOT. A 2D camera, chosen once per frame.
   ---------------------------------------------------------------------
   The Arena is a flat 2D race and stays one. This picks WHICH framing the
   wrapper should be wearing; the CSS does the rest with a transform on the
   track, so no racer's progress is touched by any of it.

   Deliberately few states, and each one has to earn its place: a camera
   that changes every second is not dramatic, it is unwatchable.
   ===================================================================== */
/*
  THREE STATES, DOWN FROM FIVE.

  The launch push and the ground-level hold on a lead change are gone. A
  camera that moves whenever anything happens competes with the racers for
  the eye, and the racers are the thing worth watching. What is left is a
  stable shot for four fifths of the race, a barely-there tightening as the
  leader reaches the last stretch, and a small push for the arrivals.
*/
export function raceShot({ leaderProgress, celebrating }) {
  if (celebrating) return "finish";
  if (leaderProgress >= 0.80) return "final";
  return "wide";
}

/* =====================================================================
   THE LEADERBOARD, WORKED OUT IN ONE PLACE.
   ---------------------------------------------------------------------
   Both views used to sort their own board inline, with the same rules
   written twice - which is exactly how two screens end up disagreeing
   about who is third. There is one implementation now and both call it.

   THE RULE, and the second half is the part that matters:

     still running   ranked by the DRAWN position, so the board agrees
                     with what is on screen
     finished        pinned by OFFICIAL finishMs, because once a pack is
                     all sitting at 1.0 the drawn positions are level and
                     would sort arbitrarily - the board could contradict
                     the result in its final seconds

   Nothing here computes a time. finishMs comes from simulate(); this only
   decides the order to show them in and does the subtraction for the gap.
   ===================================================================== */
export function boardState(sim, shown, elapsedMs) {
  const src = shown || sim.samples;
  const n = src.length;
  const tick = Math.max(0, Math.min(sim.frames, Math.round(elapsedMs / TICK_MS)));
  const finish = new Array(n);
  for (const o of sim.order) finish[o.index] = o.finishMs;
  const winnerMs = sim.order[0]?.finishMs ?? 0;

  const rows = Array.from({ length: n }, (_, i) => ({
    index: i,
    finishMs: finish[i],
    done: elapsedMs >= finish[i],
    progress: src[i][tick],
  }));

  rows.sort((a, b) => {
    if (a.done && b.done) return a.finishMs - b.finishMs;
    if (a.done) return -1;
    if (b.done) return 1;
    return (b.progress - a.progress) || (a.index - b.index);
  });

  return rows.map((r, place) => {
    /*
      gap is a LOCAL, not a sibling property. Reading r.gapMs inside the
      same object literal that defines gapMs reads the ORIGINAL row, which
      has no such field - so every label came out "+NaN" while the numbers
      beside it were perfectly correct.
    */
    const gap = r.finishMs - winnerMs;
    return {
      ...r,
      place,
      gapMs: gap,
      /* The winner shows a time, everybody else the gap to them. */
      label: !r.done ? ""
        : gap === 0 ? `${(r.finishMs / 1000).toFixed(2)}s`
        : `+${(gap / 1000).toFixed(2)}`,
    };
  });
}

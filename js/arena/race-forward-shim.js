// Arena novelty-race compatibility shim.
// Re-export the existing utilities, but own the actual race movement and the
// finish run-through here. Nothing in legacy theatre may reposition a racer.
export * from "./race.js?legacy=1";

import { simulateForwardRace } from "./duck-physics.js";
import { normalizeRaceTime } from "./race-time-normalize.js";

/*
  DURATION MEANS WATCH TIME.

  The dramatic story model needs a longer INTERNAL course so breakaways,
  comebacks and fades have room to develop. The old fix used a hard-coded
  multiplier of six and then treated that internal clock as real time, so a
  requested 60-second race could run for roughly 100 seconds depending on the
  seed.

  Keep the long internal simulation, then normalize the completed recording so
  P1 crosses at the human-requested duration. That preserves the exact seeded
  race story and finish order while making 60 seconds actually mean 60 seconds.
*/
const STORY_INTERNAL_LENGTH = 6;

export function simulate(racers, ticks, seed) {
  const requestedTicks = Math.max(1, Math.round(Number(ticks) || 1));
  const internalTicks = Math.max(1, Math.round(requestedTicks * STORY_INTERNAL_LENGTH));
  const internal = simulateForwardRace(racers, internalTicks, seed);
  return normalizeRaceTime(internal, requestedTicks);
}

/*
  DELIBERATELY A PASS-THROUGH.

  The real dramatize() lives in src/arena/theatre.ts, takes (sim, seed) and is
  covered by theatre.spec.ts - but it RESHAPES positions, and the whole point
  of this shim is that the recorded simulation is truth. The story now comes
  from the physics itself (pickStories in duck-physics.js), so the samples go
  to the renderer untouched and the ticker gets its beats from visualEvents().

  The seed is accepted and ignored so the signature matches the call in
  pages/broadcast.js. It used to be declared with one parameter, which meant
  the caller silently handed a seed to nothing - and made it look, to anyone
  reading broadcast.js, as though the legacy theatre were still running.
*/
export function dramatize(sim, _seed) {
  return { shown: sim.samples, events: [] };
}

/* Keep result presentation on an overlay plane, but never over the controls. */
if (typeof document !== "undefined" && !document.getElementById("arena-novelty-overrides")) {
  const style = document.createElement("style");
  style.id = "arena-novelty-overrides";
  style.textContent = `
    .bc-stage.cinematic-race .bc-winner {
      position: absolute !important;
      inset: 0 !important;
      z-index: 12 !important;
      margin: 0 !important;
    }
    .bc-stage.cinematic-race .bc-bar {
      position: fixed !important;
      z-index: 30 !important;
    }
  `;
  document.head.appendChild(style);
}

/* Run through the line without any finish-state brake. */
export function presentFinish(racerFrame, elapsedMs, trajectory, celebrating = false) {
  if (!racerFrame) return racerFrame;
  if (!trajectory || elapsedMs < trajectory.finishMs) {
    racerFrame.displayProgress = racerFrame.progress;
    racerFrame.phase = "racing";
    return racerFrame;
  }
  const age = Math.max(0, elapsedMs - trajectory.finishMs);
  const crossSpeed = Math.max(0.000001, Number(trajectory.crossSpeed) || 0.0001);
  racerFrame.displayProgress = 1 + age * crossSpeed * 7.5;
  racerFrame.phase = celebrating ? "celebrating" : "coasting";
  return racerFrame;
}

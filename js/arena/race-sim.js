// =====================================================================
// arena/race-sim.js - the simulation, and nothing else.
// ---------------------------------------------------------------------
// Split out of race.js so it can be imported without dragging in PixiJS.
//
// race.js re-exports two groups of finish helpers from
// pixi-runtime-finish.js, which in turn does `export * from
// pixi-runtime.js`. Those are pure re-exports - the simulation never calls
// any of them - but a re-export still evaluates the module, so importing
// race.js meant loading the whole WebGL renderer and its chunk graph.
//
// That is what made the engine.ts parity spec flaky. The maths it checks
// takes 2ms; the import in front of it measured 564ms alone and 3491ms
// under full-suite load, against a 5000ms test timeout. It always failed on
// the first seed and never the later ones, because those reuse the module
// already in memory. Nothing was ever wrong with the race.
//
// So anything that only needs the numbers imports this file. race.js still
// re-exports every name below, so existing callers and the forward shim are
// unaffected.
//
// No DOM in this file, and no graphics. Same seed, same race, every time.
// =====================================================================


/** Deterministic RNG (mulberry32). Same seed, same race, every time. */
function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newSeed() {
  return Math.floor(Math.random() * 2147483647) + 1;
}

/** Tick length. 40ms = 25 simulated steps a second, plenty for smooth playback. */
export const TICK_MS = 40;

export const LENGTHS = {
  short:  { label: "Short",  ticks: 300 },   // ~12s
  medium: { label: "Medium", ticks: 550 },   // ~22s
  long:   { label: "Long",   ticks: 900 },   // ~36s
};

export function ticksFor(lengthKey, customTicks) {
  if (lengthKey === "custom") {
    const n = Number(customTicks);
    return Number.isFinite(n) && n > 60 ? Math.min(n, 3000) : LENGTHS.medium.ticks;
  }
  return (LENGTHS[lengthKey] || LENGTHS.medium).ticks;
}

/** Seconds a race of this length will take to watch. */
export function raceSeconds(lengthKey, customTicks) {
  return Math.round((ticksFor(lengthKey, customTicks) * TICK_MS) / 1000);
}

/**
 * Run the whole race.
 *
 * @param {Array} racers  objects with an `id` (used only to label output)
 * @param {number} ticks  race length
 * @param {number} seed
 * @returns {{samples: Float32Array[], order: Array, ticks: number, finishTick: number}}
 *   samples[i][t] is racer i's progress (0..1) at tick t.
 */
export function simulate(racers, ticks, seed) {
  const n = racers.length;
  const rand = rng(seed);
  if (!n) return { samples: [], order: [], ticks, finishTick: 0 };

  // A racer's fixed character, drawn once so it is stable for this seed.
  const talent = [], clutch = [], jitter = [];
  for (let i = 0; i < n; i++) {
    talent.push(0.98 + rand() * 0.04);   // 0.98 - 1.02, tight: grade below sets the field
    clutch.push(0.90 + rand() * 0.26);   // who shows up at the end
    jitter.push(0.55 + rand() * 0.9);    // how erratic they are
  }

  /*
    THE FRONT PACK, AND THE BREAK BEHIND IT.

    The old model gave every racer the same job and then rubber-banded them
    together, so a twelve-runner field finished inside 1.6-3.9 seconds and
    the last eight arrived in a wall. That is not a close race, it is no
    race: there was nothing to see once the leader was decided.

    So the day now has a SHAPE, drawn from the seed like everything else:

      packSize   2-4 racers who genuinely contest the finish
      brk        how far the rest start behind them, as a speed handicap
      tail       how much further back each one after that sits

    grade[] is a per-racer speed multiplier and nothing else. It does not
    decide who wins - talent, bursts, stumbles and the run-in still do, and a
    graded racer on a burst can and does break into the pack. It decides how
    far apart the field ARRIVES, which is the thing that was broken.

    6.5-10.5% off the pace over a twenty-second race is the 1-2 seconds the
    break is meant to be; the tail spreads the rest behind that naturally.
  */
  const packSize = Math.min(n, 2 + Math.floor(rand() * 3));
  const seeding = Array.from({ length: n }, () => rand())
    .map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  const brk  = 0.065 + rand() * 0.040;
  const tail = 0.012 + rand() * 0.020;
  const grade = new Float64Array(n).fill(1);
  seeding.forEach((idx, pos) => {
    if (pos >= packSize) grade[idx] = 1 - brk - tail * (pos - packSize);
  });

  // Distance is abstract: everybody covers 1.0, and the speed scale is set
  // so an average racer arrives near the final tick.
  const BASE = 1 / ticks;

  const progress = new Float64Array(n);
  const speed    = new Float64Array(n).fill(BASE);
  const target   = new Float64Array(n).fill(BASE);
  const burst    = new Int16Array(n);        // ticks of burst remaining
  const stumble  = new Int16Array(n);

  /*
    EVERY RACER MUST ACTUALLY CROSS.

    `ticks` is where an AVERAGE racer arrives. The old 1.6x emergency guard
    was too close to the slowest legitimate pace, so an unlucky racer could
    hit it at 98-99%. Their samples then froze beside the stripe while only
    their estimated finish clock continued, which looked exactly like a racer
    waiting at the line and then being ranked behind somebody who arrived
    later on screen.

    The speed floor below guarantees forward motion. 3.1x is only an
    emergency guard far beyond any normal finish: the race is unchanged up
    to the old cutoff, and a slow racer simply keeps running until they cross.
  */
  const maxTicks = Math.ceil(ticks * 3.1);
  const samples = Array.from({ length: n }, () => new Float32Array(maxTicks + 1));
  const finishTick = new Float64Array(n).fill(-1);

  let done = 0;
  let t = 0;

  for (; t <= maxTicks && done < n; t++) {
    // The pack, for drafting. Only racers still running count.
    let sum = 0, live = 0;
    for (let i = 0; i < n; i++) {
      if (finishTick[i] < 0) { sum += progress[i]; live++; }
    }
    const packMean = live ? sum / live : 0;

    for (let i = 0; i < n; i++) {
      if (finishTick[i] >= 0) { samples[i][t] = 1; continue; }

      // --- events ---
      if (burst[i] === 0 && stumble[i] === 0) {
        const roll = rand();
        if (roll < 0.012)      burst[i]   = 12 + Math.floor(rand() * 26);
        else if (roll < 0.024) stumble[i] = 10 + Math.floor(rand() * 22);
      }
      if (burst[i] > 0)   burst[i]--;
      if (stumble[i] > 0) stumble[i]--;

      // --- the speed this racer is currently aiming for ---
      const frac = progress[i];
      let want = BASE * talent[i] * grade[i];

      // drifting noise, scaled by how erratic they are
      want *= 1 + (rand() - 0.5) * 0.22 * jitter[i];

      if (burst[i] > 0)   want *= 1.35;
      if (stumble[i] > 0) want *= 0.72;

      /*
        Drafting FADES OUT over the run. It is what keeps the field racing
        each other early, and it was also what pulled everybody back together
        at the line: a restoring force toward the pack mean, applied every
        tick right up to the finish, erases exactly the gaps the race just
        spent twenty seconds earning. Past 80% it is gone and the order they
        have earned is the order that arrives.
      */
      want *= 1 + (packMean - frac) * 0.55 * Math.max(0, 1 - frac / 0.8);

      // Final stretch, last 20%.
      if (frac > 0.8) want *= 1 + (frac - 0.8) * 1.6 * clutch[i];

      // --- momentum: ease toward the target rather than snapping ---
      target[i] = want;
      speed[i] += (target[i] - speed[i]) * 0.16;
      if (speed[i] < BASE * 0.35) speed[i] = BASE * 0.35;   // nobody stops dead

      progress[i] += speed[i];

      if (progress[i] >= 1) {
        // Interpolate within the tick so two racers on the same tick still
        // separate - this is where a 0.04 second finish comes from.
        const over = (progress[i] - 1) / speed[i];
        finishTick[i] = t - over;
        progress[i] = 1;
        done++;
      }
      samples[i][t] = progress[i];
    }
  }

  // t has already been incremented past the last tick the loop wrote, so the
  // last WRITTEN index is t-1. Padding from t would copy a tick that was
  // never filled, leaving the tail of every lane at zero.
  const lastWritten = Math.max(0, Math.min(t - 1, maxTicks));

  // This remains a pathological emergency fallback only. With the 3.1x guard
  // and the positive speed floor, legitimate racers should always cross first.
  for (let i = 0; i < n; i++) {
    if (finishTick[i] < 0) finishTick[i] = maxTicks + (1 - progress[i]) * ticks;
    const held = samples[i][lastWritten];
    for (let k = lastWritten + 1; k <= maxTicks; k++) samples[i][k] = held;
  }

  const order = racers
    .map((r, i) => ({ racer: r, index: i, finishMs: Math.round(finishTick[i] * TICK_MS) }))
    .sort((a, b) => a.finishMs - b.finishMs)
    .map((row, idx) => ({ ...row, place: idx + 1 }));

  // `frames` is the highest index the renderer may read. It is NOT `ticks`:
  // the race can legitimately have run past that.
  return { samples, order, ticks, frames: maxTicks, finishTick: Math.max(...finishTick) };
}

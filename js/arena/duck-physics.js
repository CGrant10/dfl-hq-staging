// =====================================================================
// DFL Arena — equal-racer novelty race backbone
// =====================================================================
export const DUCK_TICK_MS = 40;

function randomSource(seed) {
  let a = (Number(seed) || 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function shuffle(values, rand) {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/*
  ROLES ARE DEALT FROM THE CURRENT ORDER, NOT FROM A FIXED SCRIPT.

  The old model picked three or four attackers and three or four faders at
  random, up front, for all 21 phases. Random selection from twelve means the
  leader is usually not among the faders, so whoever got ahead early tended to
  stay ahead: measured across eight seeds, a twelve-second race averaged 4.9
  lead changes and the gap between first and second averaged 19px on a phone
  track. The field was spread - 149px on average - but all of the spread was
  behind the leader, where nobody is looking.

  So roles are dealt during the race, from where everybody actually is: the
  front of the field supplies the fades, the back supplies the attacks. That is
  what produces a big gap that then closes and inverts, over and over, instead
  of a procession with a scattered tail.

  THE LAST STRETCH IS EXEMPT. From FREE_RUN_FROM the bias switches off and
  everybody runs their own pace. Dragging the leader back near the line is
  exactly the manufactured photo finish this is meant not to do - whoever has
  earned the front by then goes and wins it.
*/
const FREE_RUN_FROM = 0.88;

/*
  ROLES EXPIRE PER RACER, NOT IN LOCKSTEP.

  A single global phase length cannot give both things at once, and the
  measurements say so plainly. Sweeping it: short phases (3-5.5% of the race)
  gave 10 lead changes and 44 churn/s but bunched the field to 60px, because
  nobody holds a surge long enough to open daylight. Long phases (6-10%) gave
  130px of spread and only 3.8 lead changes - a procession again.

  So the two are decoupled. Each racer carries its own role with its own
  expiry: a surge lasts long enough to open a real gap, a slump lasts long
  enough to lose one, and because the expiries are staggered, somebody is
  always mid-surge while somebody else is cracking. Roles turn over constantly
  without the whole field turning over together.
*/
const ATTACK_LO = 4.1, ATTACK_HI = 7.4;
const FADE_LO = 0.06, FADE_HI = 0.26;
const CRUISE_LO = 0.80, CRUISE_HI = 1.70;

/* Role lifetimes, as a fraction of the race. Surges outlive slumps, which
   outlive cruising - that asymmetry is what leaves gaps standing. */
const ATTACK_HOLD = [0.032, 0.058];
const FADE_HOLD = [0.020, 0.038];
const CRUISE_HOLD = [0.020, 0.040];

const span = (band, rand) => band[0] + rand() * (band[1] - band[0]);

/*
  Draw a role for one racer from where it currently sits.

  Weighted, not mechanical: the front four are the likeliest to crack and the
  back five the likeliest to attack, but every racer can draw anything, so it
  never reads as a scripted see-saw.
*/
function drawRole(rank, n, rand, freeRun, decided = false) {
  if (freeRun) return { mult: CRUISE_LO + rand() * (CRUISE_HI - CRUISE_LO), hold: CRUISE_HOLD };
  /*
    The winner is home. Nobody gets handed a fresh slump from here - a racer
    that drew one at the wrong moment used to crawl in while everyone watched,
    which is how the tail reached 11.7s. This is not the old forced parity:
    speeds still differ, they just are not newly sabotaged.
  */
  if (decided) {
    return rand() < 0.72
      ? { mult: ATTACK_LO + rand() * (ATTACK_HI - ATTACK_LO), hold: ATTACK_HOLD }
      : { mult: CRUISE_LO + rand() * (CRUISE_HI - CRUISE_LO), hold: CRUISE_HOLD };
  }
  const nearFront = rank < Math.max(4, Math.round(n * 0.34));
  const nearBack = rank >= n - Math.max(5, Math.round(n * 0.42));
  const roll = rand();
  /*
    The racer actually in front is singled out, not just lumped into the front
    group. Without this the churn was back-loaded: on seed 7 one racer held the
    lead for the first eight seconds of a twelve-second race and every lead
    change happened in the last third. Early on the whole field is bunched near
    the start, so a front-group bias barely touches the leader; naming rank 0
    explicitly is what keeps the front unstable from the gun.
  */
  const fadeChance = rank === 0 ? 0.74 : nearFront ? 0.60 : nearBack ? 0.10 : 0.30;
  const attackChance = rank === 0 ? 0.08 : nearBack ? 0.66 : nearFront ? 0.12 : 0.34;
  if (roll < fadeChance) return { mult: FADE_LO + rand() * (FADE_HI - FADE_LO), hold: FADE_HOLD };
  if (roll < fadeChance + attackChance) return { mult: ATTACK_LO + rand() * (ATTACK_HI - ATTACK_LO), hold: ATTACK_HOLD };
  return { mult: CRUISE_LO + rand() * (CRUISE_HI - CRUISE_LO), hold: CRUISE_HOLD };
}

export function simulateForwardRace(racers, ticks, seed) {
  const n = racers.length;
  if (!n) return { samples: [], order: [], ticks, frames: 0, finishTick: 0 };

  const rand = randomSource(seed);
  const base = 1 / Math.max(1, Number(ticks) || 1);
  const maxTicks = Math.ceil(Math.max(1, ticks) * 5);
  const progress = new Float64Array(n);
  const speed = new Float64Array(n);
  const target = new Float64Array(n);
  const retargetAt = new Int32Array(n);
  const finishTick = new Float64Array(n).fill(-1);
  const samples = Array.from({ length: n }, () => new Float32Array(maxTicks + 1));
  const roleMult = new Float64Array(n);
  const roleUntil = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const role = drawRole(i, n, rand, false);
    roleMult[i] = role.mult;
    /* Staggered from the start, so the field never flips as one block. */
    roleUntil[i] = Math.max(2, Math.round(ticks * span(role.hold, rand) * rand()));
    const initial = base * roleMult[i];
    speed[i] = initial;
    target[i] = initial;
    retargetAt[i] = 1 + Math.floor(rand() * 3);
  }

  let done = 0;
  let winnerTick = -1;
  let lastWritten = 0;

  for (let t = 0; t <= maxTicks && done < n; t++) {
    lastWritten = t;
    const raceFraction = t / Math.max(1, Number(ticks) || 1);

    /*
      NOTHING HAPPENS WHEN P1 CROSSES.

      This used to hand every unfinished racer one identical speed, chosen so
      the field cleared the line in a flat three seconds. It was well meant -
      it carried the gaps through rather than collapsing them into a pack - but
      it was still a forced parity: measured, the straggler speed spread was
      exactly 0, twelve racers moving as one, for a 7.3 second tail after the
      race was decided.

      Now the winner crossing is not an event. Everybody carries on at their
      own pace and finishes when they get there, which is shorter, uneven, and
      over.
    */
    /* Anybody whose role has run out draws a new one from where they now sit. */
    let ranks = null;
    for (let i = 0; i < n; i++) {
      if (finishTick[i] >= 0 || t < roleUntil[i]) continue;
      if (!ranks) {
        const standings = Array.from({ length: n }, (_, k) => k)
          .sort((a, b) => progress[b] - progress[a]);
        ranks = new Int32Array(n);
        standings.forEach((id, idx) => { ranks[id] = idx; });
      }
      const role = drawRole(ranks[i], n, rand, raceFraction >= FREE_RUN_FROM, winnerTick >= 0);
      roleMult[i] = role.mult;
      roleUntil[i] = t + Math.max(2, Math.round(ticks * span(role.hold, rand)));
      retargetAt[i] = t;
    }

    for (let i = 0; i < n; i++) {
      if (finishTick[i] >= 0) { samples[i][t] = 1; continue; }

      {
        if (t >= retargetAt[i]) {
          target[i] = base * roleMult[i] * (0.985 + rand() * 0.03);
          retargetAt[i] = t + 1 + Math.floor(rand() * 3);

          // This is the feel change: hit the new phase NOW. Taking 94% of the
          // target delta on the retarget frame turns a fade into a visible
          // stumble and a surge into a visible launch instead of a slow glide.
          speed[i] += (target[i] - speed[i]) * 0.94;
        } else {
          // Finish the transition almost immediately, but leave a hair of
          // inertia so the sprite still reads as running rather than teleporting.
          speed[i] += (target[i] - speed[i]) * 0.84;
        }
        speed[i] = clamp(speed[i], base * 0.004, base * 6.4);
      }

      const before = progress[i];
      progress[i] += speed[i];

      if (progress[i] >= 1) {
        const fraction = speed[i] > 0 ? (1 - before) / speed[i] : 1;
        finishTick[i] = (t - 1) + Math.max(0, Math.min(1, fraction));
        progress[i] = 1;
        done++;
        if (winnerTick < 0) {
          winnerTick = finishTick[i];
          /* Expire everybody's role on the spot. Waiting for a slump to run
             its course left a racer crawling home at 6% pace long after the
             result was settled - the 10.7s tail. Each unfinished racer draws
             a fresh role next tick, individually, from the decided branch. */
          for (let k = 0; k < n; k++) if (finishTick[k] < 0) roleUntil[k] = t;
        }
      }
      samples[i][t] = progress[i];
    }
  }

  for (let i = 0; i < n; i++) {
    if (finishTick[i] < 0) {
      const remaining = Math.max(0, 1 - progress[i]);
      finishTick[i] = lastWritten + remaining / Math.max(speed[i], base * 0.04);
    }
    for (let t = lastWritten + 1; t <= maxTicks; t++) samples[i][t] = 1;
  }

  const order = racers
    .map((r, index) => ({ racer: r, index, finishMs: Math.round(finishTick[index] * DUCK_TICK_MS) }))
    .sort((a, b) => a.finishMs - b.finishMs || a.index - b.index)
    .map((row, i) => ({ ...row, place: i + 1 }));
  return { samples, order, ticks, frames: maxTicks, finishTick: Math.max(...finishTick) };
}

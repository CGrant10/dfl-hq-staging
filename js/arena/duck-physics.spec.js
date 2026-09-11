import { describe, expect, it } from "vitest";
import { DUCK_TICK_MS, simulateForwardRace } from "./duck-physics.js";

describe("Arena forward race", () => {
  it("gives the full field visible separation throughout P1's run", () => {
    const racers = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 }));
    const sim = simulateForwardRace(racers, 1500, 90210);
    const winnerTick = Math.max(1, Math.round(sim.order[0].finishMs / DUCK_TICK_MS));
    const checkpoints = [0.2, 0.4, 0.6, 0.8];

    for (const frac of checkpoints) {
      const tick = Math.min(sim.frames, Math.round(winnerTick * frac));
      const positions = sim.samples.map((lane) => lane[tick]);
      const spread = Math.max(...positions) - Math.min(...positions);
      expect(spread).toBeGreaterThan(0.03);
    }
  });

  it("does not equalise the field once the winner is home", () => {
    const racers = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 }));
    const sim = simulateForwardRace(racers, 1500, 424242);
    const winnerMs = sim.order[0].finishMs;
    const lastMs = sim.order.at(-1).finishMs;
    const winnerTick = Math.round(winnerMs / DUCK_TICK_MS);

    /*
      This test used to assert the opposite: that the tail landed inside a
      1.8-3.4s window, produced by handing every unfinished racer one identical
      speed the moment P1 crossed. That was a forced parity - measured, the
      straggler speed spread was exactly 0, twelve racers moving as one - and it
      was removed deliberately. Nothing happens when the winner crosses now
      except that no racer is handed a fresh slump.

      So the assertion is inverted. The stragglers must NOT be travelling at a
      single speed, which is what would come back if anybody reintroduced a
      clear sweep.
    */
    const speeds = [];
    for (const lane of sim.samples) {
      const a = lane[Math.min(sim.frames, winnerTick + 4)];
      const b = lane[Math.min(sim.frames, winnerTick + 12)];
      if (a < 1 && b <= 1) speeds.push((b - a) / 8);
    }
    if (speeds.length > 2) {
      const mean = speeds.reduce((x, y) => x + y, 0) / speeds.length;
      const spread = Math.sqrt(speeds.reduce((a, v) => a + (v - mean) ** 2, 0) / speeds.length) / mean;
      expect(spread).toBeGreaterThan(0.05);
    }

    /* Still bounded - they hustle in rather than crawling - and still ordered. */
    expect(lastMs - winnerMs).toBeGreaterThan(0);
    expect(lastMs - winnerMs).toBeLessThan(winnerMs);
    for (let i = 1; i < sim.order.length; i++) {
      expect(sim.order[i].finishMs).toBeGreaterThanOrEqual(sim.order[i - 1].finishMs);
    }
    expect(winnerMs).toBeGreaterThan(0);
    expect(DUCK_TICK_MS).toBe(40);
  });

  it("keeps the order churning, not just the field spread", () => {
    const racers = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 }));
    /*
      The old model dealt attacker and fader roles at random from all twelve, up
      front, for the whole race - so the leader was rarely the one who cracked
      and whoever got ahead early stayed there. Roles are drawn from the live
      standings now. This is the regression guard: a procession would pass the
      spread test above and fail this one.
    */
    let leadChanges = 0;
    for (const seed of [90210, 424242, 7, 1234]) {
      const sim = simulateForwardRace(racers, 1500, seed);
      const winnerTick = Math.max(1, Math.round(sim.order[0].finishMs / DUCK_TICK_MS));
      let leader = -1;
      for (let t = 0; t <= Math.min(sim.frames, winnerTick); t += 4) {
        let best = -1, bestP = -1;
        sim.samples.forEach((lane, i) => { if (lane[t] > bestP) { bestP = lane[t]; best = i; } });
        if (best !== leader) { if (leader !== -1) leadChanges++; leader = best; }
      }
    }
    expect(leadChanges).toBeGreaterThanOrEqual(12);
  });
});

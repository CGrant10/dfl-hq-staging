import { describe, expect, it } from "vitest";
import { P, GENERATOR_LABELS, GENERATOR_BASE, generatorStanding, weightToPass } from "./broadcast-order.js";

describe("broadcast running order", () => {
  it("gives every switchable generator a base position", () => {
    /*
      THE INVARIANT. A generator needs a LABEL or the Admin panel cannot switch
      it off, and a BASE POSITION or the panel cannot order it. Adding one
      without deciding either produces an unswitchable, unmovable source - so
      this fails instead.

      identity is in BASE and deliberately not in LABELS: it is the floor
      buildDeck() falls back to, and offering a switch would offer a blank
      front page.
    */
    for (const id of GENERATOR_LABELS.keys()) {
      expect(GENERATOR_BASE.has(id), `${id} has no base position`).toBe(true);
    }
    expect(GENERATOR_BASE.has("identity")).toBe(true);
    expect(GENERATOR_LABELS.has("identity")).toBe(false);
  });

  it("puts the bands in the order the priority table declares", () => {
    expect(GENERATOR_BASE.get("myMatchup")).toBeGreaterThan(GENERATOR_BASE.get("poll"));
    expect(GENERATOR_BASE.get("champion")).toBeGreaterThan(GENERATOR_BASE.get("seasonStat"));
    expect(GENERATOR_BASE.get("seasonStat")).toBeGreaterThan(GENERATOR_BASE.get("records"));
    // The floor is the floor.
    for (const [id, v] of GENERATOR_BASE) {
      if (id !== "identity") expect(v).toBeGreaterThan(GENERATOR_BASE.get("identity"));
    }
  });

  it("mirrors applyOverride's arithmetic for weight and featured", () => {
    const base = GENERATOR_BASE.get("records");
    expect(generatorStanding("records", null)).toBe(base);
    expect(generatorStanding("records", { weight: 25 })).toBe(base + 25);
    expect(generatorStanding("records", { weight: -25 })).toBe(base - 25);
    /* featured lifts to the featured band and weight is added on top - the same
       two branches applyOverride() takes. */
    expect(generatorStanding("records", { featured: true })).toBe(P.FEATURED);
    expect(generatorStanding("records", { featured: true, weight: 5 })).toBe(P.FEATURED + 5);
    expect(generatorStanding("nonexistent", { weight: 3 })).toBe(3);
  });

  it("computes a weight that actually passes the neighbour", () => {
    // The arrow's whole job: one point past, in the asked-for direction.
    const id = "records";
    const above = weightToPass(id, 500, { above: true });
    expect(generatorStanding(id, { weight: above })).toBeGreaterThan(500);
    const below = weightToPass(id, 500, { above: false });
    expect(generatorStanding(id, { weight: below })).toBeLessThan(500);
  });

  it("reorders a real pair rather than only moving a number", () => {
    /* End to end on two generators that start level: lore and records both sit
       on P.HISTORY, so registry order decides between them - and one arrow has
       to be able to break that tie. */
    expect(GENERATOR_BASE.get("lore")).toBe(GENERATOR_BASE.get("records"));
    const w = weightToPass("lore", generatorStanding("records", null), { above: true });
    expect(generatorStanding("lore", { weight: w }))
      .toBeGreaterThan(generatorStanding("records", null));
  });
});

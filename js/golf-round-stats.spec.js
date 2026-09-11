import { describe, expect, it } from "vitest";
import { averagePuttsLabel, roundDetailStats } from "./golf-round-stats.js";

describe("roundDetailStats", () => {
  it("totals putts and either drop field across scored holes", () => {
    expect(roundDetailStats([
      { strokes: 4, putts: 2, drop_shots: 1 },
      { strokes: 5, putts: 1, drops: 2 },
      { strokes: 0, putts: 9, drops: 9 },
    ])).toEqual({ holes: 2, putts: 3, drops: 3, averagePutts: 1.5, tracked: true });
  });

  it("does not claim untracked history has detail data", () => {
    expect(roundDetailStats([{ strokes: 4 }]).tracked).toBe(false);
    expect(averagePuttsLabel(5 / 3)).toBe("1.7");
  });
});

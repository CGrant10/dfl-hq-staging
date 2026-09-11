import { describe, expect, it } from "vitest";
import {
  TREND_SLOPE, buildHistories, direction, historyFor, marketSignal, seasonLine, slopeOf,
} from "./player-history.js";

/* Full PPR, the league's own setting. rec:1 keeps the fixtures readable -
   "rec: 170 over 17 games" is a clean 10 points per game. */
const PPR = { rec: 1 };
const line = (rec, gp) => ({ rec, gp });

describe("seasonLine", () => {
  it("scores a season and reports the per-game rate", () => {
    const out = seasonLine(line(170, 17), 2025, PPR);
    expect(out).toEqual({ year: 2025, points: 170, games: 17, perGame: 10 });
  });

  /* The rule that keeps an injury from reading as a decline. */
  it("rates a half season on its rate, not its total", () => {
    const full = seasonLine(line(170, 17), 2025, PPR);
    /* 99 over 9 is 11.0 a game against the full season's 10.0. */
    const half = seasonLine(line(99, 9), 2025, PPR);
    expect(half.points).toBeLessThan(full.points);
    expect(half.perGame).toBeGreaterThan(full.perGame);
  });

  it("has nothing to say about a season with no games", () => {
    expect(seasonLine(line(0, 0), 2025, PPR)).toBeNull();
    expect(seasonLine(null, 2025, PPR)).toBeNull();
  });
});

describe("direction", () => {
  const series = rates => rates.map((perGame, i) => ({ year: 2020 + i, perGame }));

  it("refuses to call a trend from one season, or none", () => {
    expect(direction([])).toBe("insufficient");
    expect(direction(series([12]))).toBe("insufficient");
  });

  it("calls a steady climb rising and a slide falling", () => {
    expect(direction(series([8, 11, 14]))).toBe("rising");
    expect(direction(series([14, 11, 8]))).toBe("falling");
  });

  it("calls small drift steady rather than inventing a direction", () => {
    expect(direction(series([12, 12.3, 12.5]))).toBe("steady");
  });

  it("uses the slope threshold as its boundary", () => {
    /* Two seasons: the slope IS the difference. */
    expect(direction(series([10, 10 + TREND_SLOPE + 0.1]))).toBe("rising");
    expect(direction(series([10, 10 + TREND_SLOPE - 0.1]))).toBe("steady");
  });
});

describe("slopeOf", () => {
  it("is points per game per season", () => {
    const s = slopeOf([{ perGame: 10 }, { perGame: 12 }, { perGame: 14 }]);
    expect(s).toBeCloseTo(2, 5);
  });

  it("is null when there is nothing to fit", () => {
    expect(slopeOf([{ perGame: 10 }])).toBeNull();
    expect(slopeOf([])).toBeNull();
  });
});

describe("historyFor", () => {
  const seasons = [
    { year: 2023, stats: line(136, 17) },  // 8.0
    { year: 2024, stats: line(187, 17) },  // 11.0
    { year: 2025, stats: line(238, 17) },  // 14.0
  ];

  it("orders oldest first and reads the climb", () => {
    const h = historyFor({ seasons, scoringSettings: PPR });
    expect(h.seasons.map(s => s.year)).toEqual([2023, 2024, 2025]);
    expect(h.direction).toBe("rising");
    expect(h.slope).toBeCloseTo(3, 5);
    expect(h.peak.year).toBe(2025);
  });

  it("reports swing so a big average cannot hide a wild record", () => {
    const steadyish = historyFor({
      seasons: [{ year: 2024, stats: line(170, 17) }, { year: 2025, stats: line(187, 17) }],
      scoringSettings: PPR,
    });
    const wild = historyFor({
      seasons: [{ year: 2024, stats: line(34, 17) }, { year: 2025, stats: line(323, 17) }],
      scoringSettings: PPR,
    });
    expect(wild.swing).toBeGreaterThan(steadyish.swing);
  });

  it("tracks availability separately from scoring", () => {
    const h = historyFor({
      seasons: [{ year: 2024, stats: line(90, 9) }, { year: 2025, stats: line(80, 8) }],
      scoringSettings: PPR,
    });
    expect(h.availability).toBeLessThan(0.55);
    /* Missing half of two seasons must not read as a scoring decline. */
    expect(h.direction).toBe("steady");
  });

  it("skips the seasons a player did not play, without gaps breaking it", () => {
    const h = historyFor({
      seasons: [
        { year: 2023, stats: line(136, 17) },
        { year: 2024, stats: null },
        { year: 2025, stats: line(238, 17) },
      ],
      scoringSettings: PPR,
    });
    expect(h.seasons.map(s => s.year)).toEqual([2023, 2025]);
    expect(h.direction).toBe("rising");
  });

  it("says insufficient for a player with no completed seasons", () => {
    const h = historyFor({ seasons: [{ year: 2025, stats: null }], scoringSettings: PPR });
    expect(h.direction).toBe("insufficient");
    expect(h.seasons).toEqual([]);
    expect(h.peak).toBeNull();
  });
});

describe("buildHistories", () => {
  it("builds one entry per player from the whole-league stat maps", () => {
    const statsBySeason = [
      { year: 2025, stats: { "1": line(238, 17), "2": line(85, 17) } },
      { year: 2023, stats: { "1": line(136, 17), "2": line(170, 17) } },
    ];
    const out = buildHistories({ playerIds: ["1", "2", "3"], statsBySeason, scoringSettings: PPR });
    expect(out.get("1").direction).toBe("rising");
    expect(out.get("2").direction).toBe("falling");
    /* A player nobody has a line for still gets an entry, saying so. */
    expect(out.get("3").direction).toBe("insufficient");
  });
});

describe("marketSignal", () => {
  const trending = adds => ({ adds: new Map(adds), drops: new Map() });

  it("calls a heavily added player hot", () => {
    expect(marketSignal("1", trending([["1", 50000]])).tone).toBe("hot");
  });

  it("calls a heavily dropped player cold", () => {
    const t = { adds: new Map(), drops: new Map([["1", 40000]]) };
    expect(marketSignal("1", t).tone).toBe("cold");
  });

  it("stays quiet about a player nobody is moving", () => {
    expect(marketSignal("1", trending([]))).toBeNull();
    /* Small numbers are noise, not a signal. */
    expect(marketSignal("1", trending([["1", 12]])).tone).toBe("mixed");
  });
});

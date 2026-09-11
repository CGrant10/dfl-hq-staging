import { describe, expect, it } from "vitest";
import {
  LEAGUE_WEEKLY_SD, REGULAR_SEASON_WEEKS, outlookSentence, projectSeason,
} from "./season-outlook.js";

/* A twelve-team league spread the way the DFL actually is: a median weekly
   score near 117 and a few points between neighbours. */
const league = (means) => means.map((mean, i) => ({ id: `t${i + 1}`, mean }));
const EVEN = league(Array.from({ length: 12 }, () => 117.5));
const SPREAD = league([135, 130, 126, 123, 120, 118, 116, 113, 110, 106, 101, 95]);

describe("projectSeason", () => {
  it("gives every team a projection", () => {
    const out = projectSeason({ teams: SPREAD, runs: 400 });
    expect(out.size).toBe(12);
  });

  it("spends a full season of games on each team", () => {
    const out = projectSeason({ teams: SPREAD, runs: 400 });
    for (const p of out.values()) {
      /* A record is whole games and must add up to the season it describes. */
      expect(Number.isInteger(p.wins)).toBe(true);
      expect(Number.isInteger(p.losses)).toBe(true);
      expect(p.wins + p.losses).toBe(REGULAR_SEASON_WEEKS);
    }
  });

  it("ranks the strongest team first on every measure", () => {
    const out = projectSeason({ teams: SPREAD, runs: 1200 });
    const best = out.get("t1"), worst = out.get("t12");
    expect(best.wins).toBeGreaterThan(worst.wins);
    expect(best.titleOdds).toBeGreaterThan(worst.titleOdds);
    expect(best.playoffOdds).toBeGreaterThan(worst.playoffOdds);
    /* The Chip Eater is the punishment at the bottom, so the worst roster
       must be likeliest to take it. */
    expect(worst.lastOdds).toBeGreaterThan(best.lastOdds);
  });

  it("hands an even league even odds, near .500", () => {
    const out = projectSeason({ teams: EVEN, runs: 1200 });
    for (const p of out.values()) {
      /* 14 weeks splits evenly, so an even league sits on 7. */
      expect(p.wins).toBe(7);
      /* 14 splits evenly, so identical teams sit on exactly half. */
      expect(p.expectedWins).toBeCloseTo(7, 0);
      /* Twelve identical teams, eight berths: two thirds each. */
      expect(p.playoffOdds).toBeGreaterThan(.5);
      expect(p.playoffOdds).toBeLessThan(.8);
    }
  });

  it("keeps the probabilities honest", () => {
    const out = projectSeason({ teams: SPREAD, runs: 800 });
    let title = 0, last = 0;
    for (const p of out.values()) {
      expect(p.titleOdds).toBeGreaterThanOrEqual(0);
      expect(p.titleOdds).toBeLessThanOrEqual(1);
      title += p.titleOdds; last += p.lastOdds;
    }
    /* Exactly one champion and one last place per simulated season. */
    expect(title).toBeCloseTo(1, 2);
    expect(last).toBeCloseTo(1, 2);
  });

  /* Odds that move on every refresh look broken and invite re-rolling until
     the answer is liked. */
  it("is deterministic for the same league", () => {
    const a = projectSeason({ teams: SPREAD, runs: 500 });
    const b = projectSeason({ teams: SPREAD, runs: 500 });
    for (const [id, p] of a) expect(b.get(id)).toEqual(p);
  });

  it("moves when a roster actually changes", () => {
    const before = projectSeason({ teams: SPREAD, runs: 800 }).get("t12");
    const improved = SPREAD.map(t => (t.id === "t12" ? { ...t, mean: 140 } : t));
    const after = projectSeason({ teams: improved, runs: 800 }).get("t12");
    expect(after.expectedWins).toBeGreaterThan(before.expectedWins);
  });

  /* Variance is the whole reason a projection is not a ranking. */
  it("lets the underdog win sometimes", () => {
    const out = projectSeason({ teams: SPREAD, runs: 1500 });
    expect(out.get("t5").titleOdds).toBeGreaterThan(0);
    expect(out.get("t1").titleOdds).toBeLessThan(.6);
  });

  it("returns nothing when there is no league to project", () => {
    expect(projectSeason({ teams: [] }).size).toBe(0);
    expect(projectSeason({ teams: [{ id: "a", mean: 100 }] }).size).toBe(0);
    expect(projectSeason({ teams: [{ id: "a", mean: null }, { id: "b", mean: null }] }).size).toBe(0);
  });

  it("uses the league's measured spread by default", () => {
    expect(LEAGUE_WEEKLY_SD).toBeCloseTo(22.9, 1);
  });
});

describe("outlookSentence", () => {
  it("says something different at each tier", () => {
    const said = new Set([
      outlookSentence({ wins: 11, losses: 3, playoffOdds: .97, titleOdds: .3 }),
      outlookSentence({ wins: 9, losses: 5, playoffOdds: .85, titleOdds: .1 }),
      outlookSentence({ wins: 8, losses: 6, playoffOdds: .6, titleOdds: .05 }),
      outlookSentence({ wins: 6, losses: 8, playoffOdds: .3, titleOdds: .02 }),
      outlookSentence({ wins: 4, losses: 10, playoffOdds: .05, titleOdds: 0 }),
    ]);
    expect(said.size).toBe(5);
  });

  it("admits it cannot say without a projection", () => {
    expect(outlookSentence(null)).toMatch(/not enough/i);
  });
});

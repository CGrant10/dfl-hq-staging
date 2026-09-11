import { describe, expect, it } from "vitest";
import { readWinners, readLastPlace } from "./sleeper-bracket.js";

/*
  THE REAL DFL LOSERS BRACKETS, verbatim from api.sleeper.app, alongside the Chip
  Eaters the commissioner supplied independently. These are the fixtures because
  I got this rule wrong twice from invented ones:

    sleeper_standings.rank    worst regular-season record - the table going INTO
                              the playoffs, not the finish coming out of it
    loser of the highest `p`   read losers-bracket `p` as an overall placement.
                              Scored 0 of 4 against these seasons.

  roster_id -> owner is resolved by the sync; these tests work in roster ids and
  the mapping is asserted in the comment beside each season.
*/
const DFL = {
  // p:1 winner is roster 1 = CimmeronG
  2022: { bracket: [{ r: 1, m: 1, t1: 12, t2: 3, w: 12, l: 3 }, { r: 1, m: 2, t1: 1, t2: 8, w: 1, l: 8 }, { r: 2, m: 3, p: 1, t1: 12, t2: 1, w: 1, l: 12 }, { r: 2, m: 4, p: 3, t1: 3, t2: 8, w: 8, l: 3 }], chipEater: 1, who: "CimmeronG" },
  // p:1 winner is roster 8 = sheyg2014
  2023: { bracket: [{ r: 1, m: 1, t1: 12, t2: 8, w: 8, l: 12 }, { r: 1, m: 2, t1: 9, t2: 5, w: 5, l: 9 }, { r: 2, m: 3, p: 1, t1: 8, t2: 5, w: 8, l: 5 }, { r: 2, m: 4, p: 3, t1: 12, t2: 9, w: 9, l: 12 }], chipEater: 8, who: "sheyg2014" },
  // p:1 winner is roster 10 = azhee28
  2024: { bracket: [{ r: 1, m: 1, t1: 10, t2: 8, w: 10, l: 8 }, { r: 1, m: 2, t1: 3, t2: 12, w: 3, l: 12 }, { r: 2, m: 3, p: 1, t1: 10, t2: 3, w: 10, l: 3 }, { r: 2, m: 4, p: 3, t1: 8, t2: 12, w: 8, l: 12 }], chipEater: 10, who: "azhee28" },
  // p:1 winner is roster 4 = Martin77
  2025: { bracket: [{ r: 1, m: 1, t1: 5, t2: 1, w: 5, l: 1 }, { r: 1, m: 2, t1: 9, t2: 4, w: 4, l: 9 }, { r: 2, m: 3, p: 1, t1: 5, t2: 4, w: 4, l: 5 }, { r: 2, m: 4, p: 3, t1: 1, t2: 9, w: 9, l: 1 }], chipEater: 4, who: "Martin77" },
};

describe("Sleeper bracket placements", () => {
  it("names the real DFL Chip Eater for every season on record", () => {
    for (const [season, { bracket, chipEater, who }] of Object.entries(DFL)) {
      expect(readLastPlace(bracket), `${season} should be ${who}`).toBe(chipEater);
    }
  });

  it("does NOT take the loser of the highest placement game", () => {
    /*
      The rule this replaced, kept as an assertion so it cannot come back. In
      every one of the four seasons it names somebody who is not the Chip Eater.
    */
    for (const [season, { bracket, chipEater }] of Object.entries(DFL)) {
      const highestP = bracket
        .filter((g) => Number.isFinite(Number(g.p)))
        .reduce((worst, g) => (Number(g.p) > Number(worst.p) ? g : worst));
      expect(highestP.l, `${season}`).not.toBe(chipEater);
    }
  });

  it("takes the winner of the consolation final, not its loser", () => {
    // p:1 in the LOSERS bracket is a placement within the toilet bowl. Winning
    // it is how you finish last in the league.
    const b = DFL[2025].bracket;
    const final = b.find((g) => g.p === 1);
    expect(readLastPlace(b)).toBe(final.w);
    expect(readLastPlace(b)).not.toBe(final.l);
  });

  it("reads the champion from the WINNERS bracket p:1 game", () => {
    // Same field, opposite meaning: in the winners bracket p:1 is the title.
    const b = [{ r: 3, m: 9, p: 1, w: 4, l: 7 }, { r: 3, m: 10, p: 3, w: 2, l: 5 }];
    expect(readWinners(b)).toEqual({ championRoster: 4, runnerUpRoster: 7 });
  });

  it("falls back to the deepest round only when it is unambiguous", () => {
    // No placements configured: the deepest round decides, if it is one game.
    expect(readLastPlace([{ r: 1, m: 1, w: 3, l: 6 }, { r: 2, m: 2, w: 8, l: 3 }])).toBe(8);
    // Two games tied for deepest: which decides last place is not knowable.
    expect(readLastPlace([{ r: 2, m: 1, w: 3, l: 6 }, { r: 2, m: 2, w: 4, l: 8 }])).toBe(null);
    expect(readWinners([{ r: 1, m: 1, w: 4, l: 8 }, { r: 2, m: 5, w: 4, l: 2 }]).championRoster).toBe(4);
  });

  it("declines rather than guessing", () => {
    expect(readLastPlace(null)).toBe(null);
    expect(readLastPlace([])).toBe(null);
    expect(readLastPlace(undefined)).toBe(null);
    /* An unfinished consolation final has no winner. A placeholder Chip Eater
       becomes permanent the moment somebody screenshots it. */
    expect(readLastPlace([{ r: 2, m: 1, p: 1, w: null, l: null }])).toBe(null);
    expect(readWinners([])).toEqual({ championRoster: null, runnerUpRoster: null });
  });
});

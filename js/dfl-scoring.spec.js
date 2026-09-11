import { describe, expect, it } from "vitest";
import {
  ADVISOR_POSITIONS, describeScoring, isAdvisorPosition, isExcludedPosition,
  positionalFinish, scorePlayer, scoringFormat, seasonTotals,
} from "./dfl-scoring.js";

/*
  THE LEAGUE'S REAL SCORING SETTINGS, read from sleeper_leagues for 2025.

  Trimmed to the keys a skill player can score, and kept verbatim otherwise -
  including the two things that make DFL not "PPR": pass_int is -2 rather than
  -1, and there are yardage bonuses.
*/
const DFL = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fum_lost: -2,
  bonus_pass_yd_300: 1, bonus_pass_yd_400: 2,
  bonus_rush_yd_100: 1, bonus_rush_yd_200: 2,
  bonus_rec_yd_100: 1, bonus_rec_yd_200: 2,
  /* Defensive and points-allowed keys a running back never scores. Present
     because the real settings object has them, and they must contribute
     nothing rather than break anything. */
  sack: 1, int: 2, def_td: 6, pts_allow_0: 10,
};

describe("scorePlayer is the league's own scoring, not a preset", () => {
  it("scores a receiving back the way DFL scores one", () => {
    /* 1,000 rushing yards, 8 rushing TDs, 60 catches for 500 yards and 2 TDs,
       three 100-yard rushing games, one fumble lost. */
    const stats = {
      rush_yd: 1000, rush_td: 8, rec: 60, rec_yd: 500, rec_td: 2,
      bonus_rush_yd_100: 3, fum_lost: 1, gp: 16,
    };
    /* 100 + 48 + 60 + 50 + 12 + 3 - 2 */
    expect(scorePlayer(stats, DFL)).toBe(271);
  });

  it("scores a quarterback, including the -2 interception DFL actually uses", () => {
    const stats = { pass_yd: 4200, pass_td: 30, pass_int: 12,
                    rush_yd: 300, rush_td: 3, bonus_pass_yd_300: 5, gp: 17 };
    /* 168 + 120 - 24 + 30 + 18 + 5 */
    expect(scorePlayer(stats, DFL)).toBe(317);
    /* Generic PPR would score the interceptions at -1 and skip the bonus,
       which is 17 points of difference on one season. Naming that number
       "DFL points" is the thing this function exists to prevent. */
    const generic = { ...DFL, pass_int: -1, bonus_pass_yd_300: 0 };
    expect(scorePlayer(stats, generic)).toBe(324);
  });

  it("scores a receiver, with reception points at the league's own value", () => {
    const stats = { rec: 100, rec_yd: 1400, rec_td: 10,
                    bonus_rec_yd_100: 6, bonus_rec_yd_200: 1, gp: 17 };
    /* 100 + 140 + 60 + 6 + 2 */
    expect(scorePlayer(stats, DFL)).toBe(308);
    /* Half PPR is fifty points lighter on the same season. */
    expect(scorePlayer(stats, { ...DFL, rec: 0.5 })).toBe(258);
  });

  it("scores a tight end", () => {
    const stats = { rec: 70, rec_yd: 820, rec_td: 6, bonus_rec_yd_100: 2, gp: 16 };
    /* 70 + 82 + 36 + 2 */
    expect(scorePlayer(stats, DFL)).toBe(190);
  });

  it("rounds to the cent, the way Sleeper reports it", () => {
    expect(scorePlayer({ rec_yd: 1433 }, DFL)).toBe(143.3);
    expect(scorePlayer({ pass_yd: 4111 }, DFL)).toBe(164.44);
  });

  it("ignores settings keys the player never scored, rather than counting zero", () => {
    const rb = { rush_yd: 500, rush_td: 4 };
    expect(scorePlayer(rb, DFL)).toBe(74);
  });

  it("returns null rather than 0 when there is nothing to score", () => {
    /* "Scored nothing last year" and "we do not know what they scored" are
       different claims and the card draws them differently. */
    expect(scorePlayer(null, DFL)).toBeNull();
    expect(scorePlayer({}, DFL)).toBeNull();
    expect(scorePlayer({ gp: 0 }, null)).toBeNull();
    expect(scorePlayer({ pos_rank_ppr: 4 }, DFL)).toBeNull();
  });

  it("is pure: the same input always gives the same number", () => {
    const stats = { rec: 50, rec_yd: 600, rec_td: 4 };
    expect(scorePlayer(stats, DFL)).toBe(scorePlayer(stats, DFL));
  });
});

describe("the league's scoring format, for asking a market the right question", () => {
  it("reads DFL as full PPR, because a reception scores 1", () => {
    expect(scoringFormat(DFL)).toBe("ppr");
    expect(describeScoring(DFL)).toBe("DFL scoring · full PPR");
  });

  it("reads half and standard from the same field", () => {
    expect(scoringFormat({ ...DFL, rec: 0.5 })).toBe("half_ppr");
    expect(scoringFormat({ ...DFL, rec: 0 })).toBe("std");
  });

  it("falls back to Sleeper's own default rather than guessing wrong", () => {
    expect(scoringFormat(null)).toBe("ppr");
    expect(scoringFormat({})).toBe("ppr");
    expect(describeScoring(null)).toBeNull();
  });
});

describe("the four positions the Advisor evaluates, and no others", () => {
  it("names exactly QB, RB, WR and TE", () => {
    expect(ADVISOR_POSITIONS).toEqual(["QB", "RB", "WR", "TE"]);
    for (const p of ADVISOR_POSITIONS) expect(isAdvisorPosition(p)).toBe(true);
  });

  it("refuses kickers and every spelling of a team defence", () => {
    for (const p of ["K", "DEF", "DST", "D/ST", "def", "dst"]) {
      expect(isAdvisorPosition(p)).toBe(false);
      expect(isExcludedPosition(p)).toBe(true);
    }
  });

  it("refuses an empty or unknown position rather than letting it through", () => {
    expect(isAdvisorPosition("")).toBe(false);
    expect(isAdvisorPosition(null)).toBe(false);
    expect(isAdvisorPosition("FB")).toBe(false);
  });
});

describe("positional finish under DFL scoring", () => {
  /*
    A small league of players, with the DFL point totals their stat lines
    produce. Two receivers are deliberately tied.
  */
  const players = {
    rb1: { n: "Back One",   p: "RB", t: "DET" },
    rb2: { n: "Back Two",   p: "RB", t: "ATL" },
    rb3: { n: "Back Three", p: "RB", t: "GB"  },
    wr1: { n: "Wide One",   p: "WR", t: "LAR" },
    wr2: { n: "Wide Two",   p: "WR", t: "CIN" },
    qb1: { n: "Passer One", p: "QB", t: "BUF" },
    te1: { n: "End One",    p: "TE", t: "KC"  },
    k1:  { n: "Boot",       p: "K",  t: "BAL" },
    SF:  { n: "SF",         p: "DEF", t: "SF" },
  };
  const stats = {
    rb1: { rush_yd: 1200, rush_td: 12, rec: 60, rec_yd: 500, gp: 17 },
    rb2: { rush_yd: 900,  rush_td: 6,  rec: 40, rec_yd: 300, gp: 16 },
    rb3: { rush_yd: 300,  rush_td: 1,  rec: 10, rec_yd: 80,  gp: 9  },
    wr1: { rec: 90, rec_yd: 1300, rec_td: 9, gp: 17 },
    wr2: { rec: 90, rec_yd: 1300, rec_td: 9, gp: 17 },   // an exact tie
    qb1: { pass_yd: 4500, pass_td: 34, pass_int: 9, gp: 17 },
    te1: { rec: 80, rec_yd: 900, rec_td: 7, gp: 17 },
    k1:  { fgm: 30, xpm: 40, gp: 17 },
    SF:  { sack: 45, int: 18, def_td: 3, gp: 17 },
  };
  const finish = positionalFinish({ stats, players, scoringSettings: DFL });

  it("ranks each position on its own DFL totals", () => {
    expect(finish.get("rb1")).toMatchObject({ position: "RB", positionRank: 1, label: "RB1" });
    expect(finish.get("rb2")).toMatchObject({ positionRank: 2, label: "RB2" });
    expect(finish.get("rb3")).toMatchObject({ positionRank: 3, label: "RB3" });
    expect(finish.get("qb1").label).toBe("QB1");
    expect(finish.get("te1").label).toBe("TE1");
  });

  it("gives a tie the same rank", () => {
    expect(finish.get("wr1").positionRank).toBe(1);
    expect(finish.get("wr2").positionRank).toBe(1);
    expect(finish.get("wr1").points).toBe(finish.get("wr2").points);
  });

  it("carries the DFL points that produced the rank", () => {
    expect(finish.get("rb1").points).toBe(scorePlayer(stats.rb1, DFL));
    expect(finish.get("rb1").positionCount).toBe(3);
  });

  it("RANKS NO KICKER AND NO DEFENCE, at all", () => {
    expect(finish.has("k1")).toBe(false);
    expect(finish.has("SF")).toBe(false);
    for (const entry of finish.values()) {
      expect(ADVISOR_POSITIONS).toContain(entry.position);
      expect(entry.label).not.toMatch(/^(K|DEF|DST)/);
    }
  });

  it("can hold a games-played floor, so a one-game cameo does not lead", () => {
    const cameo = { ...stats, rb4: { rush_yd: 200, rush_td: 4, gp: 1 } };
    const withCameo = { ...players, rb4: { n: "One Week", p: "RB", t: "NYJ" } };
    const loose = positionalFinish({ stats: cameo, players: withCameo, scoringSettings: DFL });
    expect(loose.has("rb4")).toBe(true);
    const strict = positionalFinish({ stats: cameo, players: withCameo,
                                      scoringSettings: DFL, minGames: 8 });
    expect(strict.has("rb4")).toBe(false);
    expect(strict.get("rb1").positionRank).toBe(1);
  });

  it("skips a player the map does not know rather than ranking them as blank", () => {
    const withGhost = { ...stats, ghost: { rush_yd: 5000, rush_td: 50 } };
    const out = positionalFinish({ stats: withGhost, players, scoringSettings: DFL });
    expect(out.has("ghost")).toBe(false);
    expect(out.get("rb1").positionRank).toBe(1);
  });

  it("returns an empty map with no scoring settings, rather than zeros", () => {
    expect(positionalFinish({ stats, players, scoringSettings: null }).size).toBe(0);
  });
});

describe("seasonTotals fills in a roster", () => {
  const players = { "1": { n: "A", p: "RB", t: "DET" }, "2": { n: "B", p: "WR", t: "LAR" } };
  const stats = { "1": { rush_yd: 500, rush_td: 4, gp: 15 } };

  it("scores what it has and reports null for what it does not", () => {
    const out = seasonTotals({ playerIds: ["1", "2"], stats, players, scoringSettings: DFL });
    expect(out.get("1")).toMatchObject({ points: 74, games: 15, position: "RB" });
    expect(out.get("2")).toMatchObject({ points: null, games: null, position: "WR" });
  });

  it("covers every id it was asked about", () => {
    const out = seasonTotals({ playerIds: ["1", "2", "9"], stats, players, scoringSettings: DFL });
    expect([...out.keys()]).toEqual(["1", "2", "9"]);
  });
});

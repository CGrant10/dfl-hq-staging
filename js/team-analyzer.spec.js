import { describe, expect, it } from "vitest";
import { ANALYZER_UNITS, analyzeLeague, buildPlayerPool, compareTeams, evaluateTrade, optimalLineup, suggestTrades } from "./team-analyzer.js";

const scoring = { pass_yd: .04, pass_td: 4, rush_yd: .1, rush_td: 6, rec: 1, rec_yd: .1, rec_td: 6 };
const players = {
  q1: { n: "Alpha QB", p: "QB", t: "KC" }, q2: { n: "Beta QB", p: "QB", t: "BUF" },
  r1: { n: "Star RB", p: "RB", t: "DET" }, r2: { n: "Good RB", p: "RB", t: "GB" },
  r3: { n: "Bench RB", p: "RB", t: "NYJ" }, r4: { n: "Other RB", p: "RB", t: "MIA" },
  w1: { n: "Star WR", p: "WR", t: "MIN" }, w2: { n: "Good WR", p: "WR", t: "LAR" },
  w3: { n: "Bench WR", p: "WR", t: "CHI" }, w4: { n: "Other WR", p: "WR", t: "DAL" },
  t1: { n: "Alpha TE", p: "TE", t: "SF" }, t2: { n: "Beta TE", p: "TE", t: "BAL" },
  j1: { n: "Junk One", p: "WR", t: "FA" }, j2: { n: "Junk Two", p: "RB", t: "FA" },
};
const projection = (player_id, adp, stats) => ({ player_id, player: { position: players[player_id].p }, stats: { adp_ppr: adp, ...stats } });
const projections = [
  projection("q1", 18, { pass_yd: 4400, pass_td: 34 }), projection("q2", 28, { pass_yd: 4100, pass_td: 29 }),
  projection("r1", 4, { rush_yd: 1350, rush_td: 13, rec: 55, rec_yd: 420 }),
  projection("r2", 30, { rush_yd: 900, rush_td: 8, rec: 38, rec_yd: 280 }),
  projection("r3", 96, { rush_yd: 450, rush_td: 3, rec: 20, rec_yd: 130 }),
  projection("r4", 42, { rush_yd: 780, rush_td: 7, rec: 32, rec_yd: 240 }),
  projection("w1", 7, { rec: 105, rec_yd: 1450, rec_td: 10 }),
  projection("w2", 34, { rec: 78, rec_yd: 980, rec_td: 7 }),
  projection("w3", 110, { rec: 45, rec_yd: 520, rec_td: 3 }),
  projection("w4", 46, { rec: 69, rec_yd: 850, rec_td: 6 }),
  projection("t1", 48, { rec: 70, rec_yd: 790, rec_td: 7 }), projection("t2", 72, { rec: 55, rec_yd: 610, rec_td: 5 }),
  projection("j1", 250, { rec: 8, rec_yd: 70 }), projection("j2", 240, { rush_yd: 80 }),
];
const rosters = [
  { roster_id: 1, team_name: "A Team", players: ["q1", "r1", "r3", "w2", "w3", "t2", "j1"] },
  { roster_id: 2, team_name: "B Team", players: ["q2", "r2", "r4", "w1", "w4", "t1", "j2"] },
];
const pool = buildPlayerPool({ rosters, players, projections, scoringSettings: scoring });

describe("team analyzer", () => {
  it("builds the best legal lineup and reports depth separately", () => {
    const lineup = optimalLineup(rosters[0].players, pool);
    expect(lineup.starters.filter(player => player.position === "QB")).toHaveLength(1);
    expect(lineup.starters.filter(player => player.position === "TE")).toHaveLength(1);
    expect(lineup.score).toBe(lineup.starterPoints);
    expect(lineup.depthScore).toBe(0);
    expect(pool.get("r1")).toMatchObject({ positionRank: 1, positionCount: 5 });
    expect(pool.get("r1").expectedPerGame).toBeGreaterThan(0);
  });

  it("ranks every team and explains its strongest and weakest position", () => {
    const teams = analyzeLeague({ rosters, pool });
    expect(teams.map(team => team.rank)).toEqual([1, 2]);
    expect(teams.every(team => team.grade && team.starterGrade && team.depthGrade && team.overallGrade && team.strength)).toBe(true);
    expect(teams[0].positionGrades.QB.leagueRank).toBeGreaterThanOrEqual(1);
    expect(teams[0].positionGrades.QB.leagueSize).toBe(2);
    expect(compareTeams(teams[0], teams[1]).positions).toHaveLength(5);
    expect(teams.every(team => team.positionGrades.FLEX.starters.length === 1)).toBe(true);
    const strongTe = teams.find(team => team.positionGrades.TE.leagueRank === 1);
    expect(strongTe.need).not.toBe("TE");
  });

  it("uses the submitted offensive starters instead of letting a bench player inflate the grade", () => {
    const roster = { roster_id: 3, players: ["q1", "r1", "r2", "r3", "w1", "w2", "w3", "t1"], starters: ["q1", "r2", "r3", "w2", "w3", "t1", "w1"] };
    const lineup = optimalLineup(roster.players, pool, { starterIds: roster.starters });
    expect(lineup.source).toBe("set");
    expect(lineup.starters.map(player => player.id)).toContain("r3");
    expect(lineup.bench.map(player => player.id)).toContain("r1");
    expect(lineup.score).toBe(lineup.starterPoints);
  });

  it("pace-adjusts proven production and gives rookies a new outlook", () => {
    const paced = buildPlayerPool({ rosters, players, projections, scoringSettings: scoring,
      previousStats: { r1: { gp: 17, rush_yd: 3400 }, j1: { gp: 0 } } });
    expect(paced.get("r1")).toMatchObject({ priorPace: 340, trend: "down" });
    expect(paced.get("j1")).toMatchObject({ priorPace: null, trend: "new" });
    expect(paced.get("r1")).not.toHaveProperty("confidence");
  });

  it("derives the starter grade from the five visible unit grades", () => {
    const teams = analyzeLeague({ rosters, pool });
    for (const team of teams) {
      const visibleAverage = ANALYZER_UNITS.reduce((sum, unit) => sum + team.positionGrades[unit].percentile, 0) / ANALYZER_UNITS.length;
      expect(team.starterPercentile).toBeCloseTo(visibleAverage, 10);
      expect(team.positionGrades.FLEX.starters).toHaveLength(1);
    }
  });

  it("does not let one high-scoring unit overpower the visible starter grades", () => {
    const unitPool = new Map();
    const roster = (id, label, points) => {
      const positions = ["QB", "RB", "RB", "WR", "WR", "TE", "WR"];
      const ids = points.map((expectedPoints, index) => {
        const playerId = `${id}-${index}`;
        unitPool.set(playerId, { id: playerId, name: playerId, position: positions[index], expectedPoints, tradeValue: 50 });
        return playerId;
      });
      return { roster_id: id, team_name: label, players: ids, starters: ids };
    };
    const sample = [
      roster("balanced", "Balanced", [300, 200, 200, 230, 230, 180, 200]),
      roster("spike", "RB Spike", [290, 300, 300, 180, 180, 150, 190]),
      roster("baseline", "Baseline", [280, 190, 190, 170, 170, 140, 160]),
    ];
    const teams = analyzeLeague({ rosters: sample, pool: unitPool });
    const balanced = teams.find(team => team.id === "balanced");
    const spike = teams.find(team => team.id === "spike");
    expect(spike.lineup.starterPoints).toBeGreaterThan(balanced.lineup.starterPoints);
    expect(balanced.starterGrade).toBe("A");
    expect(spike.starterGrade).toBe("B");
    expect(balanced.starterPercentile).toBeGreaterThan(spike.starterPercentile);
  });

  it("values a trade by the lineup it changes", () => {
    const teams = analyzeLeague({ rosters, pool });
    const result = evaluateTrade({ teamA: teams.find(team => team.id === "1"), teamB: teams.find(team => team.id === "2"), sendA: ["r1"], sendB: ["w1"], pool });
    expect(result).toMatchObject({ sendA: ["r1"], sendB: ["w1"] });
    expect(result.fairness).toBeGreaterThan(0);
    expect(Number.isFinite(result.deltaA)).toBe(true);
  });

  it("does not let extra worthless players inflate a package", () => {
    const teams = analyzeLeague({ rosters, pool });
    const a = teams.find(team => team.id === "1"), b = teams.find(team => team.id === "2");
    const one = evaluateTrade({ teamA: a, teamB: b, sendA: ["r1"], sendB: ["w1"], pool });
    const junk = evaluateTrade({ teamA: a, teamB: b, sendA: ["r1"], sendB: ["w1", "j2"], pool });
    expect(junk.valueToA).toBeLessThanOrEqual(one.valueToA + 5);
  });

  it("shops a selected player only in legal, roster-aware offers", () => {
    const teams = analyzeLeague({ rosters, pool });
    const offers = suggestTrades({ teams, teamId: "1", playerId: "r1", pool });
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every(offer => offer.sendA.includes("r1") && offer.other.id === "2")).toBe(true);
    expect(offers.every(offer => offer.fairness >= 66)).toBe(true);
  });

  it("shops a two-player package from either side", () => {
    const teams = analyzeLeague({ rosters, pool });
    const mine = suggestTrades({ teams, teamId: "1", playerIds: ["r1", "w2"], partnerId: "2", pool });
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every(offer => offer.sendA.includes("r1") && offer.sendA.includes("w2") && offer.other.id === "2")).toBe(true);
    const theirs = suggestTrades({ teams, teamId: "1", anchorTeamId: "2", playerIds: ["r2", "w4"], partnerId: "2", pool });
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every(offer => offer.sendB.includes("r2") && offer.sendB.includes("w4") && offer.other.id === "2")).toBe(true);
  });
});

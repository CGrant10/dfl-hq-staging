import { describe, expect, it } from "vitest";
import {
  SWAP_THRESHOLD, bestWeeklyLineup, buildWeeklyPool, defenseDifficulty,
  matchupNote, startSitAdvice,
} from "./weekly-outlook.js";

/* Points come straight from scorePlayer, so the fixtures use plain PPR stats
   and assert on relative outcomes rather than exact scoring maths. */
const row = (id, position, { pts = 10, team = "AAA", opponent = "ZZZ", status = null,
                             gp = 1, week = 1 } = {}) => ({
  player_id: id,
  week,
  team,
  opponent,
  injury_status: status,
  player: { first_name: `P${id}`, last_name: position, position },
  /* pts_ppr is not read directly - scorePlayer works off the stat line - so
     the fixture expresses points as receptions, which PPR scores 1:1. */
  stats: { gp, rec: pts, rec_yd: 0 },
});

const poolOf = (rows) => buildWeeklyPool(rows, { rec: 1 });

describe("buildWeeklyPool", () => {
  it("keeps team, opponent and injury status alongside the projection", () => {
    const pool = poolOf([row("1", "RB", { team: "SEA", opponent: "NE", status: "Questionable" })]);
    const player = pool.get("1");
    expect(player.team).toBe("SEA");
    expect(player.opponent).toBe("NE");
    expect(player.isRisky).toBe(true);
    expect(player.isOut).toBe(false);
    expect(player.points).toBeGreaterThan(0);
  });

  /* Real data: of 3,114 week-1 rows only ~400 carry a projection, and those
     are exactly the rows naming an opponent. The rest score 0 against nobody
     and must not be startable. */
  it("treats a row with no opponent and no gp as not scheduled", () => {
    const pool = buildWeeklyPool([{
      player_id: "1", player: { position: "RB", first_name: "No", last_name: "Game" },
      opponent: null, stats: { rec: 0 },
    }], { rec: 1 });
    expect(pool.get("1").hasGame).toBe(false);
    expect(bestWeeklyLineup(["1"], pool).slots.find(s => s.position === "RB").player).toBeNull();
  });

  it("marks ruled-out players out, and gp:0 as no game", () => {
    const pool = poolOf([row("1", "RB", { status: "Out" }), row("2", "WR", { gp: 0 })]);
    expect(pool.get("1").isOut).toBe(true);
    expect(pool.get("2").hasGame).toBe(false);
  });
});

describe("a player with no projection", () => {
  /* The rule that matters most: absent must never be treated as zero. */
  it("is absent from the pool rather than scored zero", () => {
    const pool = poolOf([row("1", "RB")]);
    expect(pool.has("99")).toBe(false);
    expect(pool.get("99")).toBeUndefined();
  });

  it("never displaces a projected starter", () => {
    const pool = poolOf([row("1", "RB", { pts: 4 })]);
    const { slots } = bestWeeklyLineup(["1", "99"], pool);
    const rbs = slots.filter(slot => slot.position === "RB");
    expect(rbs[0].player.id).toBe("1");
    expect(rbs[1].player).toBeNull();
  });
});

describe("bestWeeklyLineup", () => {
  const roster = [
    row("qb1", "QB", { pts: 20 }), row("qb2", "QB", { pts: 12 }),
    row("rb1", "RB", { pts: 18 }), row("rb2", "RB", { pts: 14 }), row("rb3", "RB", { pts: 13 }),
    row("wr1", "WR", { pts: 16 }), row("wr2", "WR", { pts: 11 }),
    row("te1", "TE", { pts: 9 }),
  ];

  it("fills dedicated slots before the flex", () => {
    const pool = poolOf(roster);
    const { slots } = bestWeeklyLineup(roster.map(r => r.player_id), pool);
    const byPosition = slots.filter(s => s.position === "RB").map(s => s.player.id);
    expect(byPosition).toEqual(["rb1", "rb2"]);
    /* rb3 at 13 beats wr2 at 11, so the flex takes him. */
    expect(slots.find(s => s.position === "FLEX").player.id).toBe("rb3");
  });

  it("never starts one player in two slots", () => {
    const pool = poolOf(roster);
    const { slots } = bestWeeklyLineup(roster.map(r => r.player_id), pool);
    const ids = slots.map(s => s.player?.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /* Regression: a 12% haircut on "Questionable" reordered the lineup silently
     and started Juwan Johnson (10.43) over Tucker Kraft (10.86) in week 1. A
     flag a human should weigh is not a number the tool may quietly move. */
  it("does not demote a questionable player below a lower projection", () => {
    const pool = poolOf([
      row("kraft", "TE", { pts: 10.86, status: "Questionable" }),
      row("juwan", "TE", { pts: 10.43 }),
    ]);
    const { slots } = bestWeeklyLineup(["kraft", "juwan"], pool);
    expect(slots.find(s => s.position === "TE").player.id).toBe("kraft");
  });

  it("leaves a slot empty rather than starting an out player", () => {
    const pool = poolOf([row("te1", "TE", { pts: 30, status: "Out" })]);
    const { slots } = bestWeeklyLineup(["te1"], pool);
    expect(slots.find(s => s.position === "TE").player).toBeNull();
  });
});

describe("startSitAdvice", () => {
  const base = [
    row("qb1", "QB", { pts: 20 }),
    row("rb1", "RB", { pts: 18 }), row("rb2", "RB", { pts: 14 }),
    row("wr1", "WR", { pts: 16 }), row("wr2", "WR", { pts: 11 }),
    row("te1", "TE", { pts: 9 }), row("flex", "RB", { pts: 12 }),
  ];
  const ids = base.map(r => r.player_id);

  it("says nothing when the submitted lineup is already optimal", () => {
    const pool = poolOf(base);
    const advice = startSitAdvice({ playerIds: ids, starterIds: ids, weekly: pool });
    expect(advice.swaps).toEqual([]);
    expect(advice.pointsOnBench).toBeCloseTo(0, 5);
  });

  it("ignores a difference too small to be real", () => {
    const rows = [...base, row("wr3", "WR", { pts: 11 + (SWAP_THRESHOLD - 0.5) })];
    const pool = poolOf(rows);
    const starters = ids;
    const advice = startSitAdvice({ playerIds: [...ids, "wr3"], starterIds: starters, weekly: pool });
    expect(advice.swaps).toEqual([]);
  });

  it("recommends a swap once the margin clears the threshold", () => {
    const rows = [...base, row("wr3", "WR", { pts: 11 + SWAP_THRESHOLD + 2 })];
    const pool = poolOf(rows);
    const advice = startSitAdvice({ playerIds: [...ids, "wr3"], starterIds: ids, weekly: pool });
    expect(advice.swaps.length).toBeGreaterThan(0);
    expect(advice.swaps[0].in.id).toBe("wr3");
    expect(advice.swaps[0].gain).toBeGreaterThanOrEqual(SWAP_THRESHOLD);
  });

  it("flags an out starter regardless of the margin, and marks it urgent", () => {
    const rows = [
      row("qb1", "QB", { pts: 20 }),
      row("rb1", "RB", { pts: 18, status: "Out" }), row("rb2", "RB", { pts: 14 }),
      row("wr1", "WR", { pts: 16 }), row("wr2", "WR", { pts: 11 }),
      row("te1", "TE", { pts: 9 }), row("bench", "RB", { pts: 1 }),
    ];
    const pool = poolOf(rows);
    const starters = ["qb1", "rb1", "rb2", "wr1", "wr2", "te1"];
    const advice = startSitAdvice({
      playerIds: rows.map(r => r.player_id), starterIds: starters, weekly: pool,
    });
    expect(advice.alarms.map(a => a.player.id)).toContain("rb1");
    /* A 1-point replacement is a loss on paper, and still the right call. */
    expect(advice.swaps.some(swap => swap.out.id === "rb1" && swap.urgent)).toBe(true);
  });

  it("reports the points left on the bench", () => {
    const rows = [...base, row("wr3", "WR", { pts: 25 })];
    const pool = poolOf(rows);
    const advice = startSitAdvice({ playerIds: [...ids, "wr3"], starterIds: ids, weekly: pool });
    expect(advice.pointsOnBench).toBeGreaterThan(0);
    expect(advice.bestTotal).toBeGreaterThan(advice.submittedTotal);
  });
});

describe("defenseDifficulty", () => {
  it("ranks the most generous defense first and phrases the matchup", () => {
    const pool = poolOf([
      row("a", "RB", { pts: 30, opponent: "SOFT" }),
      row("b", "WR", { pts: 25, opponent: "SOFT" }),
      row("c", "RB", { pts: 3, opponent: "HARD" }),
      row("d", "WR", { pts: 2, opponent: "HARD" }),
    ]);
    const defense = defenseDifficulty(pool);
    expect(defense.get("SOFT").rank).toBe(1);
    expect(defense.get("HARD").rank).toBe(2);
    expect(matchupNote(pool.get("a"), defense).tone).toBe("great");
    expect(matchupNote(pool.get("c"), defense).tone).toBe("brutal");
  });

  it("has no opinion when the opponent is unknown", () => {
    const pool = poolOf([row("a", "RB", { opponent: null })]);
    expect(matchupNote(pool.get("a"), defenseDifficulty(pool))).toBeNull();
  });
});

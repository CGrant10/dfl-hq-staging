import { describe, expect, it } from "vitest";
import {
  STALE_AFTER_DAYS,
  expectedRound, formatRoundValue, marketFreshness, normalizeName,
  normalizeSleeperMarket, playerIndex, resolveProviderPlayer, roundValue,
} from "./keeper-market.js";

/*
  Rows shaped exactly like the live Sleeper projections feed, verified against
  https://api.sleeper.app/projections/nfl/2026?season_type=regular&order_by=adp_ppr
  - a `stats` object with adp_std / adp_half_ppr / adp_ppr, a nested `player`
  with the position, and `last_modified` in milliseconds.
*/
const AUG_18 = Date.parse("2026-08-18T12:00:00Z");
const row = (id, position, adp, extra = {}) => ({
  player_id: id,
  player: { position, first_name: "First", last_name: "Last" },
  stats: { adp_ppr: adp, adp_half_ppr: adp + 1, adp_std: adp + 3, ...extra },
  last_modified: AUG_18,
});

const FEED = [
  row("9221", "RB", 1.7),
  row("9509", "RB", 2.4),
  row("7564", "WR", 3.1),
  row("9493", "WR", 4.0),
  row("4984", "QB", 40.2),
  row("8130", "TE", 25.5),
  /* The two the Advisor must never see. */
  row("K1", "K", 150.0),
  row("SF", "DEF", 160.0),
  /* Sleeper's sentinel for "no ADP", which is not a null. */
  row("nobody", "WR", 999.0),
];

describe("ADP becomes a round of THIS league's draft", () => {
  it("divides by the actual league size", () => {
    expect(expectedRound(1, 12)).toBe(1);
    expect(expectedRound(12, 12)).toBe(1);
    expect(expectedRound(13, 12)).toBe(2);
    expect(expectedRound(24, 12)).toBe(2);
    expect(expectedRound(25, 12)).toBe(3);
    expect(expectedRound(36, 12)).toBe(3);
    expect(expectedRound(18, 12)).toBe(2);
  });

  it("gives a ten-team league different answers than a twelve", () => {
    /* Which is the reason league size is required rather than defaulted. */
    expect(expectedRound(18, 10)).toBe(2);
    expect(expectedRound(110, 10)).toBe(11);
    expect(expectedRound(110, 12)).toBe(10);
  });

  it("returns null rather than a bogus round", () => {
    expect(expectedRound(null, 12)).toBeNull();
    expect(expectedRound(0, 12)).toBeNull();
    expect(expectedRound(-3, 12)).toBeNull();
    expect(expectedRound(18, null)).toBeNull();
    expect(expectedRound(18, 1)).toBeNull();
    expect(expectedRound("x", 12)).toBeNull();
  });
});

describe("the round-value formula", () => {
  it("is keeper round minus expected round, so bigger is better", () => {
    expect(roundValue(7, 2)).toBe(5);
    expect(roundValue(4, 4)).toBe(0);
    expect(roundValue(3, 7)).toBe(-4);
    expect(roundValue(1, 1)).toBe(0);
    expect(roundValue(14, 1)).toBe(13);
  });

  it("is null when either side is unknown, and never zero", () => {
    expect(roundValue(null, 2)).toBeNull();
    expect(roundValue(7, null)).toBeNull();
    expect(roundValue(null, null)).toBeNull();
    expect(roundValue(undefined, 4)).toBeNull();
  });

  it("prints with a sign and the right plural", () => {
    expect(formatRoundValue(5)).toBe("+5 rounds");
    expect(formatRoundValue(1)).toBe("+1 round");
    expect(formatRoundValue(0)).toBe("0 rounds");
    expect(formatRoundValue(-1)).toBe("−1 round");
    expect(formatRoundValue(-4)).toBe("−4 rounds");
    expect(formatRoundValue(null)).toBeNull();
  });
});

describe("normalising the Sleeper feed", () => {
  const out = normalizeSleeperMarket(FEED, { leagueSize: 12, scoringFormat: "ppr", season: 2026 });
  const byId = (id) => out.find((r) => r.playerId === id);

  it("produces only the normalised contract, with no provider fields", () => {
    expect(Object.keys(byId("9221")).sort()).toEqual([
      "adp", "playerId", "position", "positionRank", "projectedRound",
      "rank", "scoringFormat", "source", "updatedAt",
    ]);
    expect(JSON.stringify(out)).not.toMatch(/adp_ppr|last_modified|week_shard/);
  });

  it("reads the ADP for the league's own scoring format", () => {
    expect(byId("9221").adp).toBe(1.7);
    const half = normalizeSleeperMarket(FEED, { leagueSize: 12, scoringFormat: "half_ppr" });
    expect(half.find((r) => r.playerId === "9221").adp).toBe(2.7);
    const std = normalizeSleeperMarket(FEED, { leagueSize: 12, scoringFormat: "std" });
    expect(std.find((r) => r.playerId === "9221").adp).toBe(4.7);
  });

  it("ranks overall by ADP and separately within each position", () => {
    expect(byId("9221")).toMatchObject({ rank: 1, positionRank: 1, position: "RB" });
    expect(byId("9509")).toMatchObject({ rank: 2, positionRank: 2, position: "RB" });
    expect(byId("7564")).toMatchObject({ rank: 3, positionRank: 1, position: "WR" });
    expect(byId("9493")).toMatchObject({ rank: 4, positionRank: 2, position: "WR" });
    expect(byId("8130")).toMatchObject({ rank: 5, positionRank: 1, position: "TE" });
    expect(byId("4984")).toMatchObject({ rank: 6, positionRank: 1, position: "QB" });
  });

  it("turns each ADP into an expected round for this league", () => {
    expect(byId("9221").projectedRound).toBe(1);
    expect(byId("8130").projectedRound).toBe(3);    // ADP 25.5 of 12
    expect(byId("4984").projectedRound).toBe(4);    // ADP 40.2 of 12
  });

  it("DROPS every kicker and defence before anything else sees them", () => {
    expect(byId("K1")).toBeUndefined();
    expect(byId("SF")).toBeUndefined();
    expect(out.every((r) => ["QB", "RB", "WR", "TE"].includes(r.position))).toBe(true);
  });

  it("drops Sleeper's no-ADP sentinel rather than calling it pick 999", () => {
    expect(byId("nobody")).toBeUndefined();
  });

  it("carries the source and the timestamp on every row", () => {
    expect(byId("9221").source).toBe("Sleeper ADP · 2026");
    expect(byId("9221").scoringFormat).toBe("ppr");
    expect(byId("9221").updatedAt).toBe(new Date(AUG_18).toISOString());
  });

  it("survives a malformed or empty feed", () => {
    expect(normalizeSleeperMarket([], { leagueSize: 12 })).toEqual([]);
    expect(normalizeSleeperMarket(null, { leagueSize: 12 })).toEqual([]);
    expect(normalizeSleeperMarket([{}, { player_id: null }, { player_id: "1" }],
      { leagueSize: 12 })).toEqual([]);
  });

  it("still ranks when the league size is unknown, with no expected round", () => {
    const noSize = normalizeSleeperMarket(FEED, { leagueSize: null, scoringFormat: "ppr" });
    expect(noSize[0].rank).toBe(1);
    expect(noSize[0].projectedRound).toBeNull();
  });
});

describe("market freshness is shown, and staleness is admitted", () => {
  const day = 86400000;
  const stamp = new Date(AUG_18).toISOString();

  it("reports the age and the date", () => {
    const fresh = marketFreshness(stamp, { now: AUG_18 + day });
    expect(fresh.ageDays).toBe(1);
    expect(fresh.stale).toBe(false);
    expect(fresh.label).toMatch(/^Updated /);
  });

  it("calls it stale past the threshold and says so in the label", () => {
    const old = marketFreshness(stamp, { now: AUG_18 + STALE_AFTER_DAYS * day });
    expect(old.stale).toBe(true);
    expect(old.label).toMatch(/may be stale$/);
    const older = marketFreshness(stamp, { now: AUG_18 + 30 * day });
    expect(older.ageDays).toBe(30);
    expect(older.stale).toBe(true);
  });

  it("is honest about not knowing, rather than claiming fresh", () => {
    expect(marketFreshness(null)).toMatchObject({ unknown: true, stale: false, label: null });
    expect(marketFreshness("not a date")).toMatchObject({ unknown: true, label: null });
  });
});

// =====================================================================
// PROVIDER ID MAPPING
// Not needed by the Sleeper feed, which carries Sleeper ids. Tested because
// the day a name-keyed provider arrives is the wrong day to design this.
// =====================================================================

describe("mapping a provider's players to Sleeper ids", () => {
  const players = {
    "1": { n: "Ja'Marr Chase",       p: "WR", t: "CIN" },
    "2": { n: "Michael Pittman Jr.", p: "WR", t: "IND" },
    "3": { n: "Kenneth Walker III",  p: "RB", t: "SEA" },
    "4": { n: "Kenneth Walker",      p: "RB", t: "FA"  },   // the ambiguity
    "5": { n: "Josh Allen",          p: "QB", t: "BUF" },
    "6": { n: "Josh Allen",          p: "LB", t: "JAX" },   // same name, other position
  };
  const index = playerIndex(players);

  it("normalises punctuation, case, accents and generational suffixes", () => {
    expect(normalizeName("Ja'Marr Chase")).toBe("jamarr chase");
    expect(normalizeName("Michael Pittman Jr.")).toBe("michael pittman");
    expect(normalizeName("Kenneth Walker III")).toBe("kenneth walker");
    expect(normalizeName("Marvin Harrison Jr")).toBe("marvin harrison");
    expect(normalizeName("  DEEBO   SAMUEL  ")).toBe("deebo samuel");
    expect(normalizeName(null)).toBe("");
  });

  it("PREFERS the provider's explicit cross-reference id over any name", () => {
    const out = resolveProviderPlayer(
      { sleeper_id: "1", name: "Totally Different Person", position: "WR" }, index);
    expect(out).toMatchObject({ playerId: "1", how: "provider-id" });
  });

  it("matches a straightforward player by exact name and position", () => {
    const out = resolveProviderPlayer({ name: "Ja'Marr Chase", position: "WR" }, index);
    expect(out).toMatchObject({ playerId: "1", how: "name" });
  });

  it("matches across a suffix the two providers disagree about", () => {
    expect(resolveProviderPlayer({ name: "Michael Pittman", position: "WR" }, index).playerId).toBe("2");
    expect(resolveProviderPlayer({ name: "Michael Pittman Jr.", position: "WR" }, index).playerId).toBe("2");
    expect(resolveProviderPlayer({ first_name: "Michael", last_name: "Pittman Jr", position: "WR" },
      index).playerId).toBe("2");
  });

  it("LEAVES AN AMBIGUOUS NAME UNRESOLVED rather than guessing", () => {
    /* Two Kenneth Walkers at RB after the suffix is stripped. A keeper valued
       off the wrong one is worse than a keeper with no market line. */
    const out = resolveProviderPlayer({ name: "Kenneth Walker III", position: "RB" }, index);
    expect(out.playerId).toBeNull();
    expect(out.reason).toMatch(/Ambiguous/);
  });

  it("keeps two players with the same name apart by position", () => {
    expect(resolveProviderPlayer({ name: "Josh Allen", position: "QB" }, index).playerId).toBe("5");
    expect(resolveProviderPlayer({ name: "Josh Allen", position: "LB" }, index).playerId).toBe("6");
  });

  it("reports a missing mapping rather than inventing one", () => {
    const out = resolveProviderPlayer({ name: "Nobody At All", position: "WR" }, index);
    expect(out.playerId).toBeNull();
    expect(out.reason).toMatch(/No Sleeper player/);
    const bare = resolveProviderPlayer({ name: "", position: "" }, index);
    expect(bare.playerId).toBeNull();
    expect(bare.reason).toMatch(/no name and position/);
  });

  it("records the ambiguity in the index rather than silently keeping one", () => {
    expect(index.get("kenneth walker|RB")).toEqual(["3", "4"]);
    expect(index.get("jamarr chase|WR")).toEqual(["1"]);
  });
});

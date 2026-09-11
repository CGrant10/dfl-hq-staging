import { describe, expect, it } from "vitest";
import { completedTrades, rankTradeFleeces, tradeSides } from "./trade-fleeces.js";

const scoring = new Map([[2023, { rec: 1 }], [2024, { rec: 1 }]]);
const stats = new Map([
  [2023, { star: { rec: 100 }, bench: { rec: 20 } }],
  [2024, { star: { rec: 80 }, bench: { rec: 10 } }],
]);
const players = { star: { p: "WR" }, bench: { p: "WR" } };
const trade = { season: 2022, week: 6, type: "trade", status: "complete", details: {
  status: "complete", roster_ids: [1, 2], adds: { star: 1, bench: 2 }, drops: { star: 2, bench: 1 },
} };

describe("historical trade fleeces", () => {
  it("keeps only explicitly completed trade transactions", () => {
    expect(completedTrades([trade, { ...trade, status: "pending" }, { ...trade, type: "waiver" }])).toEqual([trade]);
  });

  it("groups acquired players by their destination roster", () => {
    expect(tradeSides(trade)).toEqual([
      { rosterId: "1", playerIds: ["star"] },
      { rosterId: "2", playerIds: ["bench"] },
    ]);
  });

  it("ranks starter impact over the next completed seasons", () => {
    const [result] = rankTradeFleeces({ trades: [trade], latestSeason: 2024, statsBySeason: stats, scoringBySeason: scoring, players });
    expect(result.winner.rosterId).toBe("1");
    expect(result.winner.outcome).toBe(76.3);
    expect(result.loser.outcome).toBe(0);
    expect(result.gap).toBe(76.3);
  });

  it("grades a trade from the latest completed season", () => {
    const recentTrade = { ...trade, season: 2025 };
    const [result] = rankTradeFleeces({
      trades: [recentTrade], latestSeason: 2025,
      statsBySeason: new Map([[2025, { star: { rec: 100 }, bench: { rec: 20 } }]]),
      scoringBySeason: new Map([[2025, { rec: 1 }]]), players,
    });
    expect(result.trade.season).toBe(2025);
    expect(result.winner.rosterId).toBe("1");
    expect(result.gap).toBe(80);
  });

  it("values one elite starter above three replacement-level package fillers", () => {
    const seasonStats = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`wr${index + 1}`, { rec: 200 - index * 4 }]));
    Object.assign(seasonStats, { elite: { rec: 280 }, filler1: { rec: 90 }, filler2: { rec: 70 }, filler3: { rec: 50 } });
    const seasonPlayers = Object.fromEntries(Object.keys(seasonStats).map(id => [id, { p: "WR" }]));
    const uneven = { ...trade, details: { ...trade.details, adds: { elite: 1, filler1: 2, filler2: 2, filler3: 2 } } };
    const [result] = rankTradeFleeces({
      trades: [uneven], latestSeason: 2023,
      statsBySeason: new Map([[2023, seasonStats]]), scoringBySeason: new Map([[2023, { rec: 1 }]]), players: seasonPlayers,
    });
    expect(result.winner.rosterId).toBe("1");
    expect(result.winner.outcome).toBeGreaterThan(result.loser.outcome);
    expect(result.loser.outcome).toBe(0);
  });

  it("still rewards a package containing several genuinely strong starters", () => {
    const seasonStats = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`wr${index + 1}`, { rec: 200 - index * 4 }]));
    Object.assign(seasonStats, { star: { rec: 280 }, strong1: { rec: 260 }, strong2: { rec: 250 }, strong3: { rec: 240 } });
    const seasonPlayers = Object.fromEntries(Object.keys(seasonStats).map(id => [id, { p: "WR" }]));
    const deep = { ...trade, details: { ...trade.details, adds: { star: 1, strong1: 2, strong2: 2, strong3: 2 } } };
    const [result] = rankTradeFleeces({
      trades: [deep], latestSeason: 2023,
      statsBySeason: new Map([[2023, seasonStats]]), scoringBySeason: new Map([[2023, { rec: 1 }]]), players: seasonPlayers,
    });
    expect(result.winner.rosterId).toBe("2");
  });

  it("keeps the two known prank reversals out of the fleece ranking", () => {
    const prank = id => ({ ...trade, details: { ...trade.details, transaction_id: id } });
    const results = rankTradeFleeces({
      trades: [prank("907844411101487104"), prank("907840843644805120"), trade],
      latestSeason: 2024,
      statsBySeason: stats,
      scoringBySeason: scoring,
      players,
    });
    expect(results).toHaveLength(1);
    expect(results[0].trade).toBe(trade);
  });
});

import { describe, expect, it, vi } from "vitest";
import { collectLeagueChain } from "./sleeper-sync-scope.js";

const leagues = {
  current: { league_id: "current", season: "2026", name: "DFL 2026", previous_league_id: "old" },
  old: { league_id: "old", season: "2025", name: "DFL 2025", previous_league_id: "older" },
  older: { league_id: "older", season: "2024", name: "DFL 2024", previous_league_id: null },
};

describe("collectLeagueChain", () => {
  it("reads only the configured current season by default", async () => {
    const getLeague = vi.fn(async (id) => leagues[id]);
    const rows = await collectLeagueChain("current", { getLeague });

    expect(rows.map((row) => row.season)).toEqual(["2026"]);
    expect(getLeague).toHaveBeenCalledTimes(1);
  });

  it("walks and orders all linked seasons for an explicit history repair", async () => {
    const getLeague = vi.fn(async (id) => leagues[id]);
    const rows = await collectLeagueChain("current", { includeHistory: true, getLeague });

    expect(rows.map((row) => row.season)).toEqual(["2024", "2025", "2026"]);
    expect(getLeague).toHaveBeenCalledTimes(3);
  });

  it("reports an invalid current league id", async () => {
    await expect(collectLeagueChain("missing", { getLeague: async () => null }))
      .rejects.toThrow("Sleeper has no league with ID missing");
  });
});


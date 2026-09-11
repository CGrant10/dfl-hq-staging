import { describe, expect, it } from "vitest";
import { powerPulseCard, powerPulseView } from "./power-pulse.js";

const analysis = {
  state: "ready", projectionSeason: 2026,
  teams: [
    { id: "1", rank: 1, sleeper_user_id: "u1", team_name: "Alpha", strength: "WR", weakness: "RB", lineup: { score: 1720, weeklyPoints: 101.2 } },
    { id: "2", rank: 2, sleeper_user_id: "u2", team_name: "Beta", strength: "QB", weakness: "TE", lineup: { score: 1640, weeklyPoints: 96.4 } },
    { id: "3", rank: 3, sleeper_user_id: "u3", team_name: "Gamma", strength: "RB", weakness: "WR", lineup: { score: 1560, weeklyPoints: 91.7 } },
  ],
};

describe("Home power pulse", () => {
  it("uses the reader's real analyzer rank and compares with prior standings", () => {
    const view = powerPulseView({ analysis, meSleeperId: "u2", standings: [
      { season: 2025, sleeper_user_id: "u1", rank: 2 },
      { season: 2025, sleeper_user_id: "u2", rank: 3 },
      { season: 2025, sleeper_user_id: "u3", rank: 1 },
    ] });
    expect(view.focus.team_name).toBe("Beta");
    expect(view.movement).toBe(1);
    expect(view.movementLabel).toBe("VS 2025");
    expect(Number(view.ratings[view.teams[0].id])).toBeGreaterThan(Number(view.ratings[view.teams[1].id]));
    expect(powerPulseCard(view)).toContain("#2");
    expect(powerPulseCard(view)).toContain("+1 VS 2025");
  });

  it("uses current standings after games have been played", () => {
    const view = powerPulseView({ analysis, meSleeperId: "u1", standings: [
      { season: 2026, sleeper_user_id: "u1", rank: 3, wins: 1, losses: 0 },
      { season: 2026, sleeper_user_id: "u2", rank: 1, wins: 1, losses: 0 },
    ] });
    expect(view.movement).toBe(2);
    expect(view.movementLabel).toBe("VS STANDINGS");
  });

  it("escapes team names and never invents movement without a baseline", () => {
    const changed = { ...analysis, teams: [{ ...analysis.teams[0], team_name: "<script>" }, ...analysis.teams.slice(1)] };
    const html = powerPulseCard(powerPulseView({ analysis: changed, meSleeperId: "u1" }));
    expect(html).toContain("NEW MODEL");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("the projected record on the home panel", () => {
  const teams = Array.from({ length: 12 }, (_, i) => ({
    id: String(i + 1), roster_id: i + 1, sleeper_user_id: `u${i + 1}`,
    team_name: `Team ${i + 1}`, rank: i + 1,
    lineup: { score: 2000 - i * 40, weeklyPoints: 130 - i * 3 },
    strength: "RB", need: "WR",
  }));
  const analysis = { state: "ready", projectionSeason: 2026, teams, league: { playoff_teams: 8 } };

  it("projects a whole-game record for the viewer's own team", () => {
    const view = powerPulseView({ analysis, meSleeperId: "u3", standings: [] });
    expect(view.record).toBeTruthy();
    expect(Number.isInteger(view.record.wins)).toBe(true);
    expect(view.record.wins + view.record.losses).toBe(view.weeks);
  });

  it("gives the stronger roster the better projection", () => {
    const top = powerPulseView({ analysis, meSleeperId: "u1", standings: [] }).record;
    const bottom = powerPulseView({ analysis, meSleeperId: "u12", standings: [] }).record;
    expect(top.wins).toBeGreaterThan(bottom.wins);
    expect(top.titleOdds).toBeGreaterThan(bottom.titleOdds);
  });

  /* The block it replaced was about somebody else's team. */
  it("no longer reports a biggest riser", () => {
    const view = powerPulseView({ analysis, meSleeperId: "u3", standings: [] });
    expect(view.riser).toBeUndefined();
    expect(powerPulseCard(view)).not.toMatch(/riser/i);
  });

  it("renders the record and the odds on the card", () => {
    const view = powerPulseView({ analysis, meSleeperId: "u3", standings: [] });
    const html = powerPulseCard(view);
    expect(html).toContain("PROJECTED RECORD");
    expect(html).toContain(`${view.record.wins}-${view.record.losses}`);
    expect(html).toMatch(/% playoffs/);
  });
});

import { describe, expect, it } from "vitest";
import {
  PRIMARY_SEASON_ROUTES,
  SECONDARY_SEASON_ROUTES,
  primarySeasonNavMarkup,
  secondarySeasonNavMarkup,
} from "./season-nav.js";

describe("regular-season navigation", () => {
  it("puts the analyzer in the primary bar with the weekly league tools", () => {
    expect(PRIMARY_SEASON_ROUTES.map((item) => item.route))
      .toEqual(["home", "trade", "analyzer", "facts", "finances"]);
    expect(PRIMARY_SEASON_ROUTES.find((item) => item.lead)?.route).toBe("analyzer");
  });

  /* Rules gave up its slot to the trade desk - a reference you read once a
     season against a decision with a clock on it. It must still be reachable. */
  it("moves Rules to More rather than losing it", () => {
    expect(PRIMARY_SEASON_ROUTES.map((item) => item.route)).not.toContain("rules");
    expect(SECONDARY_SEASON_ROUTES.map((item) => item.route)).toContain("rules");
    expect(secondarySeasonNavMarkup()).toContain('href="#/rules"');
  });

  it("gives the trade desk and the analyzer distinct icons", () => {
    const icons = PRIMARY_SEASON_ROUTES.map((item) => item.icon);
    expect(new Set(icons).size).toBe(icons.length);
    expect(PRIMARY_SEASON_ROUTES.find((i) => i.route === "trade").icon).toBe("trade");
    expect(PRIMARY_SEASON_ROUTES.find((i) => i.route === "analyzer").icon).toBe("analyzer");
  });

  it("keeps completed-season and occasional tools in More", () => {
    const secondary = SECONDARY_SEASON_ROUTES.map((item) => item.route);
    expect(secondary).toEqual(expect.arrayContaining(["keepers", "golf", "polls", "admin"]));
    expect(secondary).not.toContain("analyzer");
  });

  it("renders unique routes and a More control", () => {
    const routes = [...PRIMARY_SEASON_ROUTES, ...SECONDARY_SEASON_ROUTES].map((item) => item.route);
    expect(new Set(routes).size).toBe(routes.length);
    expect(primarySeasonNavMarkup()).toContain('id="more-btn"');
    expect(primarySeasonNavMarkup()).toContain('data-route="analyzer"');
    expect(primarySeasonNavMarkup()).toContain("Analyzer");
    expect(secondarySeasonNavMarkup()).toContain('href="#/golf"');
  });
});


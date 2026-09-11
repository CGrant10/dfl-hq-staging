import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { tradeDeskMarkup } from "./trade-desk.js";

const mine = { id: "mine", team_name: "My Team", playerIds: [] };
const theirs = { id: "theirs", team_name: "Their Team", playerIds: [] };
const teams = [mine, theirs];
const pool = new Map();

describe("trade analyzer layout", () => {
  it("opens the trade builder first and renders its result immediately below", () => {
    const markup = tradeDeskMarkup(mine, teams, pool, { memberIds: [], sends: [new Set(), new Set()] });

    expect(markup).toContain('<details class="td-builder" open>');
    expect(markup).toContain("Build your trade");
    expect(markup.indexOf('class="td-builder"')).toBeLessThan(markup.indexOf("data-td-verdict"));
  });

  it("renders suggestions as a disclosure that starts closed", () => {
    const source = readFileSync(new URL("./pages/trade.js", import.meta.url), "utf8");

    expect(source).toContain('<details class="ta-report-section ta-trades"${shop.expanded ? " open" : ""}>');
    expect(source).toContain('expanded: false');
  });

  it("scrolls a loaded suggestion to its analysis result", () => {
    const source = readFileSync(new URL("./pages/trade.js", import.meta.url), "utf8");

    expect(source).toContain('body.querySelector("[data-td-verdict]")?.scrollIntoView');
    expect(source).not.toContain('body.querySelector("[data-trade-desk]")?.scrollIntoView');
  });
});

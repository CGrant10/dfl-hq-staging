import { describe, expect, it } from "vitest";
import { suppressedOn } from "./bottomline-routes.js";

describe("where the BottomLine is allowed to appear", () => {
  it("appears on the ordinary pages", () => {
    for (const r of ["home", "keepers", "polls", "calendar", "history", "facts",
                     "finances", "profile", "rules"]) {
      expect(suppressedOn(r, `#/${r}`)).toBe(false);
    }
  });

  it("stays off the focused and live surfaces", () => {
    expect(suppressedOn("broadcast", "#/broadcast")).toBe(true);
    expect(suppressedOn("arena", "#/arena")).toBe(true);
    expect(suppressedOn("admin", "#/admin")).toBe(true);
  });

  it("stays off a golf scorecard and a match control screen only", () => {
    /* The golf list and an event page are normal pages; a card somebody is
       tapping between holes is not. */
    expect(suppressedOn("golf", "#/golf")).toBe(false);
    expect(suppressedOn("golf", "#/golf?id=3")).toBe(false);
    expect(suppressedOn("golf", "#/golf?id=3&team=7")).toBe(true);
    expect(suppressedOn("golf", "#/golf?id=3&match=12")).toBe(true);
  });

  it("does not throw on a missing or odd hash", () => {
    expect(suppressedOn("golf")).toBe(false);
    expect(suppressedOn("golf", "")).toBe(false);
    expect(suppressedOn("home", "#/home?x=1")).toBe(false);
    expect(suppressedOn("", "")).toBe(false);
  });
});

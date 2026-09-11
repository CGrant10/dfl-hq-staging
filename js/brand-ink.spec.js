import { describe, expect, it } from "vitest";
import { SHARE_INK, TEAM_INKS, newTeamColor, teamInk } from "./brand-ink.js";

describe("the Medicine identity replaces Golf's own brand", () => {
  it("hands out Medicine inks to new teams, in order", () => {
    expect(newTeamColor(0)).toBe(TEAM_INKS[0]);
    expect(newTeamColor(1)).toBe(TEAM_INKS[1]);
    expect(newTeamColor(6)).toBe(TEAM_INKS[0]);          // wraps
    expect(newTeamColor(-1)).toBe(TEAM_INKS[1]);
    expect(newTeamColor(undefined)).toBe(TEAM_INKS[0]);
  });

  it("translates every one of the six old Golf colours", () => {
    const legacy = ["#2fbf5f", "#4aa3ff", "#f0a742", "#e0574a", "#b07cf0", "#3ecfcf"];
    legacy.forEach((old, i) => {
      expect(teamInk(old, 99)).toBe(TEAM_INKS[i]);
      expect(teamInk(old.toUpperCase(), 99)).toBe(TEAM_INKS[i]);
    });
  });

  it("keeps the translated teams distinguishable from each other", () => {
    const legacy = ["#2fbf5f", "#4aa3ff", "#f0a742", "#e0574a", "#b07cf0", "#3ecfcf"];
    const mapped = legacy.map((c) => teamInk(c));
    expect(new Set(mapped).size).toBe(legacy.length);
  });

  it("passes a colour somebody chose by hand straight through", () => {
    expect(teamInk("#123456")).toBe("#123456");
    expect(teamInk("#ABC")).toBe("#abc");
  });

  it("falls back on the index when a team has no colour at all", () => {
    expect(teamInk(null, 2)).toBe(TEAM_INKS[2]);
    expect(teamInk("", 3)).toBe(TEAM_INKS[3]);
    expect(teamInk("var(--accent)", 1)).toBe(TEAM_INKS[1]);
    expect(teamInk(undefined)).toBe(TEAM_INKS[0]);
  });

  it("never returns anything but a usable colour", () => {
    for (const input of [null, "", "nonsense", "#fff", "#2fbf5f", 42]) {
      expect(teamInk(input, 0)).toMatch(/^#[0-9a-f]{3,8}$/i);
    }
  });

  it("holds the share palette in ONE place, as fixed values", () => {
    expect(SHARE_INK.BG).toBe("#0b0b0c");
    expect(SHARE_INK.INK).toBe("#f4f2ee");
    expect(SHARE_INK.CREST_RED).toBe("#E5011B");
    /* Constants, not the live theme: nothing here may read the DOM. */
    for (const v of Object.values(SHARE_INK)) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

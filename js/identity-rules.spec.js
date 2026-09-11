import { describe, expect, it } from "vitest";
import {
  ACCENTS, DEFAULT_ACCENT, accentOf, isChampionTitle, ordinalPlace,
  titleChoices, achievementChoices, achievementOptions, displayAchievement,
  ringCount, MAX_RINGS,
} from "./identity-rules.js";

const CAREER = { titles: [2021, 2023], runnerUps: [2020], playoffs: [2020, 2021, 2023] };
const EXTREMES = { bestSeason: { rank: 1 }, highWeek: { score: 184.23 }, streak: { win: { run: 6 } } };

describe("a ring is claimed in the title and nowhere else", () => {
  /* The bug this exists to prevent: a two-time winner picking "DFL
     Champion" as a title AND "2x DFL Champion" as a featured achievement,
     saying the same thing twice in a four-word byline. */
  it("never offers a championship as a featured achievement", () => {
    const rich = achievementChoices(CAREER, EXTREMES, ["2019"]);
    expect(rich.filter((a) => /champion/i.test(a))).toEqual([]);
    /* Even for somebody whose ONLY distinction is winning. */
    expect(achievementChoices({ titles: [2021, 2022, 2023] }, {}, [])
      .filter((a) => /champion/i.test(a))).toEqual([]);
  });

  it("offers the ring, and its count, only as a title", () => {
    const titles = titleChoices({ championships: 2 }, CAREER, EXTREMES, []);
    expect(titles).toContain("DFL Champion");
    expect(titles).toContain("2× DFL Champion");
    expect(titles).toContain("Multi-Time Champion");
  });

  it("counts a ring from either source, and does not invent one", () => {
    /* championships on the member row and titles from the derived career
       are two views of the same fact; the higher wins. */
    expect(titleChoices({ championships: 3 }, {}, {}, [])).toContain("3× DFL Champion");
    expect(titleChoices({}, { titles: [1, 2, 3, 4] }, {}, [])).toContain("4× DFL Champion");
    const none = titleChoices({ championships: 0 }, { titles: [] }, {}, []);
    expect(none.filter((t) => /champion/i.test(t))).toEqual([]);
  });

  it("does not offer a count to a single winner", () => {
    const one = titleChoices({ championships: 1 }, {}, {}, []);
    expect(one).toContain("DFL Champion");
    expect(one).not.toContain("1× DFL Champion");
    expect(one).not.toContain("Multi-Time Champion");
  });
});

describe("champion detection drives the gold treatment", () => {
  it("says yes to every phrasing titleChoices can mint", () => {
    for (const t of titleChoices({ championships: 4 }, {}, {}, [])) {
      if (/champion/i.test(t)) expect(isChampionTitle(t)).toBe(true);
    }
    expect(isChampionTitle("DFL Champion")).toBe(true);
    expect(isChampionTitle("2× DFL Champion")).toBe(true);
    expect(isChampionTitle("Multi-Time Champion")).toBe(true);
  });

  it("says no to the near misses, which is the whole point", () => {
    /* A finalist lost the final. Gold is for winning it. */
    for (const t of ["DFL Finalist", "Playoff Regular", "Certified Heater",
                     "Chip Eater Survivor", "DFL Original", "", null, undefined]) {
      expect(isChampionTitle(t)).toBe(false);
    }
  });
});

describe("featured achievements are the small, specific ones", () => {
  it("reads as facts with numbers in them", () => {
    expect(achievementChoices(CAREER, EXTREMES, ["2019"])).toEqual([
      "Runner-up ×1",
      "3 playoff berths",
      "Best finish 1st",
      "High week 184.2 pts",
      "6-game win streak",
      "Ate the chip 2019",
    ]);
  });

  it("does not separate chip seasons with the byline's own glyph", () => {
    /* A diamond in the value would read as two achievements once the
       byline joined the items with the same glyph. */
    const chip = achievementChoices({}, {}, ["2019", "2021"]).find((a) => /chip/i.test(a));
    expect(chip).toBe("Ate the chip 2019, 2021");
    expect(chip).not.toContain("◆");
  });

  it("says nothing rather than zero", () => {
    expect(achievementChoices({}, {}, [])).toEqual([]);
    expect(achievementChoices(null, null, [])).toEqual([]);
  });

  it("keeps a berth singular when there is one", () => {
    expect(achievementChoices({ playoffs: [2021] }, {}, [])).toContain("1 playoff berth");
    expect(achievementChoices({ playoffs: [1, 2] }, {}, [])).toContain("2 playoff berths");
  });
});

describe("ordinal places", () => {
  it("handles the teens, which is where naive code breaks", () => {
    expect(["", 1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111]
      .slice(1).map(ordinalPlace)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th",
      "21st", "22nd", "23rd", "101st", "111th",
    ]);
  });
  it("passes a non-number straight through", () => {
    expect(ordinalPlace("n/a")).toBe("n/a");
  });
});

describe("the accent colour", () => {
  it("takes a valid hex and nothing else", () => {
    expect(accentOf({ accent_color: "#4AA3FF" })).toBe("#4AA3FF");
    expect(accentOf({ accent_color: "#4aa3ff" })).toBe("#4aa3ff");
  });

  /* The value is interpolated into a style attribute on every one of that
     member's posts, so anything malformed has to fall back rather than
     reach the DOM. The database has a matching check constraint. */
  it("falls back for anything that is not a six-digit hex", () => {
    for (const bad of ["red", "#fff", "#12345", "#1234567", "", null, undefined,
                       "javascript:alert(1)", "#fff; background:url(x)", "rgb(0,0,0)"]) {
      expect(accentOf({ accent_color: bad })).toBe(DEFAULT_ACCENT);
    }
    expect(accentOf(null)).toBe(DEFAULT_ACCENT);
  });

  it("ships a palette that is all valid and all distinct", () => {
    expect(ACCENTS.length).toBeGreaterThan(0);
    for (const c of ACCENTS) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(ACCENTS.map((c) => c.toLowerCase())).size).toBe(ACCENTS.length);
    /* Every swatch must survive accentOf, or the picker could offer a
       colour that silently reverts on save. */
    for (const c of ACCENTS) expect(accentOf({ accent_color: c })).toBe(c);
  });
});

describe("data saved by older releases", () => {
  /* The phrasing changed in this pass: "4 playoff trips" became "4 playoff
     berths". A member who had chosen the old wording must not open the
     editor to find "None" selected and lose it on the next save. */
  it("keeps a stored value the generated list no longer produces", () => {
    const opts = achievementOptions(
      { featured_achievement: "4 playoff trips" }, CAREER, EXTREMES, []);
    expect(opts[0]).toBe("4 playoff trips");
    expect(opts).toContain("3 playoff berths");
  });

  it("does not duplicate a stored value that is still generated", () => {
    const opts = achievementOptions(
      { featured_achievement: "Best finish 1st" }, CAREER, EXTREMES, []);
    expect(opts.filter((o) => o === "Best finish 1st")).toHaveLength(1);
  });

  /* Older releases DID offer "2x DFL Champion" as a featured achievement.
     The title owns every ring now, so a legacy value like that is neither
     offered again nor rendered - otherwise this pass would have removed the
     duplicate claim for new members only. */
  it("refuses to carry a legacy championship forward", () => {
    const stored = { featured_achievement: "2× DFL Champion" };
    expect(achievementOptions(stored, CAREER, EXTREMES, []))
      .not.toContain("2× DFL Champion");
    expect(displayAchievement(stored)).toBe("");
  });

  it("still displays an ordinary stored achievement", () => {
    expect(displayAchievement({ featured_achievement: "4 playoff trips" }))
      .toBe("4 playoff trips");
    expect(displayAchievement({ featured_achievement: "  padded  " })).toBe("padded");
    expect(displayAchievement({})).toBe("");
    expect(displayAchievement(null)).toBe("");
  });
});

describe("ringCount", () => {
  it("is zero for a title that is not a ring", () => {
    expect(ringCount({ profile_title: "DFL Finalist", championships: 3 })).toBe(0);
    expect(ringCount({ profile_title: "", championships: 3 })).toBe(0);
  });
  it("reads the count out of the title first", () => {
    expect(ringCount({ profile_title: "3× DFL Champion", championships: 1 })).toBe(3);
    expect(ringCount({ profile_title: "2x DFL Champion" })).toBe(2);
  });
  it("falls back to the member's championship count", () => {
    expect(ringCount({ profile_title: "DFL Champion", championships: 2 })).toBe(2);
    expect(ringCount({ profile_title: "DFL Champion" })).toBe(1);
  });
  it("caps the row so a pill cannot fill with glyphs", () => {
    expect(ringCount({ profile_title: "DFL Champion", championships: 40 })).toBe(MAX_RINGS);
  });
});

import { describe, expect, it } from "vitest";
import { boardData, boardText } from "./keeper-board.js";
import { DEFAULT_RULES, validateConfig } from "./keeper-rules.js";

const rules = validateConfig(DEFAULT_RULES).config;

/* The league, in canonical order, with two members who have not submitted. */
const members = [
  { id: 1, display_name: "Grant",  team_name: "Team Lafountain" },
  { id: 2, display_name: "Shawn",  team_name: "Klutch Sports Group" },
  { id: 3, display_name: "Izzy",   team_name: "" },
  { id: 4, display_name: "Noah",   team_name: "Out of Order" },
];

const players = {
  "4866": { n: "Saquon Barkley", p: "RB", t: "PHI" },
  "7564": { n: "Ja'Marr Chase",  p: "WR", t: "CIN" },
  "999":  { n: "Retired Guy",    p: "RB", t: "FA"  },
};

const keeperRows = [
  /* A canonical row, with its own snapshots. */
  { year: 2026, member_id: 1, player_id: "4866", player: "Saquon Barkley",
    player_name: "Saquon Barkley", player_pos: "RB", player_team: "PHI", round_cost: 1 },
  /* A canonical row with NO snapshots - enrichment comes from the player map. */
  { year: 2026, member_id: 2, player_id: "7564", player: "Ja'Marr Chase", round_cost: 1 },
  /* A legacy nickname row: no player_id, a first name in `team`. */
  { year: 2026, team: "Izzy", player: "NA", round_cost: null },
  /* Another season, which must not appear on a 2026 board. */
  { year: 2025, member_id: 4, player_id: "4866", player: "Saquon Barkley", round_cost: 3 },
];

describe("the keeper board shows the whole league", () => {
  const board = boardData({ season: 2026, members, keeperRows, players, rules });

  it("has a row for EVERY member, submitted or not", () => {
    expect(board.rows).toHaveLength(4);
    expect(board.rows.map((r) => r.member)).toEqual(["Grant", "Shawn", "Izzy", "Noah"]);
    expect(board.total).toBe(4);
  });

  it("says how many have actually submitted, so it cannot look complete", () => {
    expect(board.submitted).toBe(3);              // Grant, Shawn, Izzy's legacy row
    expect(board.rows.find((r) => r.member === "Noah").keepers).toEqual([]);
  });

  it("keeps members in league order rather than by who submitted", () => {
    expect(board.rows[3].member).toBe("Noah");
  });

  it("only shows the selected season", () => {
    expect(board.rows.find((r) => r.member === "Noah").keepers).toHaveLength(0);
    const last = boardData({ season: 2025, members, keeperRows, players, rules });
    expect(last.submitted).toBe(1);
    expect(last.rows.find((r) => r.member === "Noah").keepers[0].name).toBe("Saquon Barkley");
  });
});

describe("what each keeper row shows", () => {
  const board = boardData({ season: 2026, members, keeperRows, players, rules });
  const of = (name) => board.rows.find((r) => r.member === name).keepers[0];

  it("prefers the row's own snapshot over the live player map", () => {
    /* The snapshot is what the player WAS on the day, which is the honest
       thing on a historical board. */
    expect(of("Grant")).toMatchObject({ name: "Saquon Barkley", where: "RB · PHI", round: 1 });
  });

  it("enriches a row that has no snapshot, from the player map", () => {
    expect(of("Shawn")).toMatchObject({ name: "Ja'Marr Chase", where: "WR · CIN", round: 1 });
  });

  it("still shows a LEGACY nickname row, exactly as typed", () => {
    expect(of("Izzy")).toMatchObject({ name: "NA", legacy: true, round: null, where: "" });
  });

  it("matches a legacy row to its member by the stored team string", () => {
    /* The only handle those rows have. It is a display-time join for a board,
       never identity - nothing is written from it. */
    expect(board.rows.find((r) => r.member === "Izzy").keepers).toHaveLength(1);
    expect(board.also).toEqual([]);
  });

  it("places a legacy first name against exactly one member, or not at all", () => {
    const shey = [{ id: 9, display_name: "sheyg2014", team_name: "Deadly" }];
    const one = boardData({ season: 2026, members: shey, players, rules,
      keeperRows: [{ year: 2026, team: "Shey", player: "Achane", round_cost: 8 }] });
    expect(one.rows[0].keepers[0].name).toBe("Achane");
    expect(one.also).toEqual([]);

    /* Two members it could be is NOT a match. */
    const both = [{ id: 9, display_name: "sheyg2014" }, { id: 10, display_name: "sheybaby" }];
    const ambiguous = boardData({ season: 2026, members: both, players, rules,
      keeperRows: [{ year: 2026, team: "Shey", player: "Achane", round_cost: 8 }] });
    expect(ambiguous.also).toHaveLength(1);
    expect(ambiguous.rows.every((r) => !r.keepers.length)).toBe(true);

    /* And nothing under three characters gets to guess. */
    const tiny = boardData({ season: 2026, members: shey, players, rules,
      keeperRows: [{ year: 2026, team: "Sh", player: "Achane", round_cost: 8 }] });
    expect(tiny.also).toHaveLength(1);
  });

  it("never drops a row it cannot place - it lists it separately", () => {
    const orphan = boardData({ season: 2026, members,
      keeperRows: [{ year: 2026, team: "Nobody Here At All", player: "Mystery", round_cost: 9 }],
      players, rules });
    expect(orphan.also).toHaveLength(1);
    expect(orphan.also[0]).toMatchObject({ name: "Mystery", round: 9, legacy: true });
    expect(orphan.submitted).toBe(0);
  });

  it("omits an unhelpful NFL team rather than printing FA", () => {
    const gone = boardData({ season: 2026, members,
      keeperRows: [{ year: 2026, member_id: 1, player_id: "999", player: "Retired Guy", round_cost: 4 }],
      players, rules });
    expect(gone.rows[0].keepers[0].where).toBe("RB");
  });

  it("carries more than one keeper for a member, if a league allows it", () => {
    const two = boardData({ season: 2026, members, players, rules, keeperRows: [
      { year: 2026, member_id: 1, player_id: "4866", player_name: "Saquon Barkley", player_pos: "RB", player_team: "PHI", round_cost: 1 },
      { year: 2026, member_id: 1, player_id: "7564", player_name: "Ja'Marr Chase", player_pos: "WR", player_team: "CIN", round_cost: 1 },
    ] });
    expect(two.rows[0].keepers).toHaveLength(2);
    expect(two.submitted).toBe(1);
  });
});

describe("the rule summary and the text fallback", () => {
  it("carries the configured rule line, and null when nothing is configured", () => {
    expect(boardData({ season: 2026, members, keeperRows, players, rules }).rulesLine)
      .toMatch(/Previous season's draft -1 round/);
    expect(boardData({ season: 2026, members, keeperRows, players, rules: null }).rulesLine)
      .toBeNull();
  });

  it("writes a text version that names everybody, including the gaps", () => {
    const text = boardText(boardData({ season: 2026, members, keeperRows, players, rules }));
    expect(text).toMatch(/^DFL 2026 keepers — 3 of 4 submitted/);
    expect(text).toMatch(/Team Lafountain: Saquon Barkley \(R1\)/);
    expect(text).toMatch(/Out of Order: no keeper submitted/);
    expect(text).not.toMatch(/undefined|NaN/);
  });

  it("survives an empty league and an empty season", () => {
    expect(boardData({ season: 2026, members: [], keeperRows: [] }))
      .toMatchObject({ submitted: 0, total: 0, also: [] });
    expect(boardText(boardData({ season: 2026, members, keeperRows: [] })))
      .toMatch(/0 of 4 submitted/);
    expect(boardText(null)).toBe("");
  });
});

describe("the hold on the shared board", () => {
  const members = [{ id: 1, display_name: "Grant", team_name: "Team G" }];
  const rows = [
    { year: 2024, member_id: 1, player_id: "7", player_name: "Kept Guy", round_cost: 8, team: "Team G" },
    { year: 2025, member_id: 1, player_id: "7", player_name: "Kept Guy", round_cost: 7, team: "Team G" },
    { year: 2026, member_id: 1, player_id: "7", player_name: "Kept Guy", round_cost: 7, team: "Team G" },
    { year: 2026, member_id: 1, player_id: null, player: "Legacy Name", round_cost: 5, team: "Team G" },
  ];
  const board = boardData({
    season: 2026, members, keeperRows: rows, players: {},
    rules: { max_keeper_seasons: 3 },
  });
  const kept = board.rows[0].keepers.find((k) => k.name === "Kept Guy");

  it("counts the season being served and what started it", () => {
    expect(kept.tenure.year).toBe(3);
    expect(kept.tenure.max).toBe(3);
    expect(kept.tenure.firstSeason).toBe(2024);
    expect(kept.tenure.final).toBe(true);
  });

  it("gives a legacy row no counter rather than a wrong one", () => {
    const legacy = [...board.rows[0].keepers, ...board.also]
      .find((k) => k.name === "Legacy Name");
    expect(legacy.tenure).toBeNull();
  });

  it("says the year in the text share too", () => {
    expect(boardText(board)).toContain("yr 3/3");
  });
});

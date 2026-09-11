import { describe, expect, it } from "vitest";
import {
  draftCard, draftFinished, draftView, metaLine, ordinal, pickNumbers,
  seasonTeamsCard, seasonTeamsView, slotsFromOrder, slotsFromPicks, stillCurrent,
} from "./draft-order.js";

const MEMBERS = [
  { id: 1, display_name: "Grant", team_name: "The Hammer", sleeper_user_id: "u1" },
  { id: 2, display_name: "Dave", team_name: "", sleeper_user_id: "u2" },
  { id: 3, display_name: "Gone", team_name: "Ghost", sleeper_user_id: "u9" },
];

/* Sleeper's own shape: order is keyed by USER and points at a slot, while
   slot_to_roster_id goes the other way. */
const SLEEPER_DRAFT = {
  draft_id: "d1",
  status: "pre_draft",
  type: "snake",
  settings: { rounds: 15, pick_timer: 120 },
  start_time: 1_756_339_200_000,
  draft_order: { u1: 3, u2: 1 },
  slot_to_roster_id: { 1: 7, 2: 4, 3: 9 },
};

describe("reading the order off a Sleeper draft", () => {
  it("joins draft_order and slot_to_roster_id, in slot order", () => {
    expect(slotsFromOrder(SLEEPER_DRAFT)).toEqual([
      { draft_slot: 1, roster_id: 7, sleeper_user_id: "u2" },
      { draft_slot: 2, roster_id: 4, sleeper_user_id: null },
      { draft_slot: 3, roster_id: 9, sleeper_user_id: "u1" },
    ]);
  });

  it("gives nothing for a draft nobody has ordered yet", () => {
    expect(slotsFromOrder({ ...SLEEPER_DRAFT, draft_order: null, slot_to_roster_id: null })).toEqual([]);
    expect(slotsFromOrder(null)).toEqual([]);
  });

  it("still works when only one half of the pair is present", () => {
    expect(slotsFromOrder({ draft_order: { u1: 2 }, slot_to_roster_id: null })).toEqual([
      { draft_slot: 2, roster_id: null, sleeper_user_id: "u1" },
    ]);
  });
});

describe("recovering the order from a draft that already happened", () => {
  const picks = [
    { round: 1, pick_no: 1, draft_slot: 1, roster_id: 7, picked_by: "u2" },
    { round: 1, pick_no: 2, draft_slot: 2, roster_id: 4, picked_by: "u1" },
    /* Round two is the snake coming back; it must not overwrite round one. */
    { round: 2, pick_no: 3, draft_slot: 2, roster_id: 4, picked_by: "u1" },
    { round: 2, pick_no: 4, draft_slot: 1, roster_id: 7, picked_by: "u2" },
  ];

  it("takes round one as the board", () => {
    expect(slotsFromPicks(picks)).toEqual([
      { draft_slot: 1, roster_id: 7, sleeper_user_id: "u2" },
      { draft_slot: 2, roster_id: 4, sleeper_user_id: "u1" },
    ]);
  });

  it("gives nothing for a draft with no picks", () => {
    expect(slotsFromPicks([])).toEqual([]);
    expect(slotsFromPicks(null)).toEqual([]);
  });

  it("carries a deleted account through as no owner rather than dropping the slot", () => {
    expect(slotsFromPicks([{ round: 1, draft_slot: 1, roster_id: 7, picked_by: null }]))
      .toEqual([{ draft_slot: 1, roster_id: 7, sleeper_user_id: null }]);
  });
});

describe("what earns the front page", () => {
  const started = Date.parse("2026-08-27T19:00:00Z");

  it("keeps a draft that has not happened", () => {
    expect(stillCurrent({ status: "pre_draft" }, started)).toBe(true);
    expect(stillCurrent({ status: "drafting" }, started)).toBe(true);
  });

  it("removes a finished draft immediately", () => {
    const done = { status: "complete", start_time_ms: started };
    expect(stillCurrent(done, started)).toBe(false);
    expect(stillCurrent(done, started + 6 * 86_400_000)).toBe(false);
    expect(stillCurrent(done, started + 8 * 86_400_000)).toBe(false);
  });

  it("drops a finished draft with no start time, and a missing draft", () => {
    expect(stillCurrent({ status: "complete", start_time_ms: null }, started)).toBe(false);
    expect(stillCurrent(null, started)).toBe(false);
  });

  it("recognizes a full board even when the stored status is stale", () => {
    const draft = { status: "pre_draft", rounds: 2 };
    const slots = [{ roster_id: 1 }, { roster_id: 2 }];
    const picks = Array.from({ length: 4 }, (_, i) => ({ pick_no: i + 1, roster_id: (i % 2) + 1 }));
    expect(draftFinished(draft, { slots, picks })).toBe(true);
    expect(stillCurrent(draft, started, { slots, picks })).toBe(false);
  });

  it("recognizes the in-season phase without waiting on draft status", () => {
    expect(draftFinished({ status: "pre_draft", rounds: 15 }, { leagueStatus: "in_season" })).toBe(true);
  });

  it("retires a stale scheduled board after twelve hours but keeps an active draft", () => {
    const later = started + 12 * 60 * 60 * 1000;
    expect(stillCurrent({ status: "pre_draft", start_time_ms: started }, later)).toBe(false);
    expect(stillCurrent({ status: "drafting", start_time_ms: started }, later + 86_400_000)).toBe(true);
  });
});

describe("the post-draft league field", () => {
  const draft = { season: 2026, status: "pre_draft", rounds: 2 };
  const slots = [
    { draft_slot: 1, roster_id: 11, sleeper_user_id: "u1" },
    { draft_slot: 2, roster_id: 12, sleeper_user_id: "u2" },
  ];
  const picks = [
    { pick_no: 1, roster_id: 11, sleeper_user_id: "u1" },
    { pick_no: 2, roster_id: 12, sleeper_user_id: "u2" },
    { pick_no: 3, roster_id: 12, sleeper_user_id: "u2" },
    { pick_no: 4, roster_id: 11, sleeper_user_id: "u1" },
  ];

  it("replaces the order with named teams and roster counts", () => {
    const view = seasonTeamsView({ draft, slots, picks, members: MEMBERS, meSleeperId: "u1" });
    expect(view.pickCount).toBe(4);
    expect(view.teams).toEqual([
      expect.objectContaining({ id: "12", name: "Dave", players: 2, mine: false }),
      expect.objectContaining({ id: "11", name: "The Hammer", players: 2, mine: true }),
    ]);
    const html = seasonTeamsCard(view);
    expect(html).toContain("The League Is Set");
    expect(html).toContain("#/analyzer?owner=u1");
    expect(html).toContain("YOU");
  });

  it("does not show before the draft is actually finished", () => {
    expect(seasonTeamsView({ draft, slots, picks: picks.slice(0, 3), members: MEMBERS })).toBe(null);
    expect(seasonTeamsCard(null)).toBe("");
  });
});

describe("the card's model", () => {
  const draft = {
    season: 2026, draft_id: "d1", status: "pre_draft", draft_type: "snake",
    rounds: 15, start_time_ms: 4_000_000_000_000, order_known: true,
  };
  const slots = [
    { draft_slot: 2, sleeper_user_id: "u2" },
    { draft_slot: 1, sleeper_user_id: "u1" },
    { draft_slot: 3, sleeper_user_id: "nobody" },
  ];

  it("orders the board, names the teams and finds the reader", () => {
    const view = draftView({ draft, slots, members: MEMBERS, meSleeperId: "u1" });
    expect(view.board.map((r) => r.slot)).toEqual([1, 2, 3]);
    expect(view.board.map((r) => r.name)).toEqual(["The Hammer", "Dave", "—"]);
    expect(view.mySlot).toBe(1);
    expect(view.teams).toBe(3);
    expect(view.orderKnown).toBe(true);
  });

  it("has no slot for a reader who is not in the league", () => {
    expect(draftView({ draft, slots, members: MEMBERS, meSleeperId: null }).mySlot).toBe(null);
    expect(draftView({ draft, slots, members: MEMBERS, meSleeperId: "u404" }).mySlot).toBe(null);
  });

  it("says the order is unknown rather than inventing one", () => {
    const view = draftView({ draft, slots: [], members: MEMBERS, meSleeperId: "u1" });
    expect(view.orderKnown).toBe(false);
    expect(view.board).toEqual([]);
  });

  it("is null when there is no draft at all", () => {
    expect(draftView({ draft: null })).toBe(null);
    expect(draftView()).toBe(null);
  });
});

describe("the meta line", () => {
  it("names only what is known", () => {
    expect(metaLine({ typeText: "Snake", rounds: 15, startAt: null, statusText: "Not started" }))
      .toBe("Snake · 15 rounds · Not started");
    expect(metaLine({ typeText: "", rounds: null, startAt: null, statusText: "" })).toBe("");
    expect(metaLine(null)).toBe("");
  });
});

describe("when you are actually on the clock", () => {
  /* The board turns around at the end of every round, so slot 7 of 12 picks
     7th, then 6th-from-the-other-end (18th), then 7th again (31st). */
  it("follows the snake back and forth", () => {
    expect(pickNumbers({ slot: 7, teams: 12, rounds: 3, type: "snake" })).toEqual([7, 18, 31]);
    expect(pickNumbers({ slot: 1, teams: 12, rounds: 3, type: "snake" })).toEqual([1, 24, 25]);
    expect(pickNumbers({ slot: 12, teams: 12, rounds: 3, type: "snake" })).toEqual([12, 13, 36]);
  });

  it("runs straight down a linear board", () => {
    expect(pickNumbers({ slot: 7, teams: 12, rounds: 3, type: "linear" })).toEqual([7, 19, 31]);
  });

  it("gives an auction nothing, because an auction has no board", () => {
    expect(pickNumbers({ slot: 7, teams: 12, type: "auction" })).toEqual([]);
  });

  it("refuses nonsense rather than computing it", () => {
    expect(pickNumbers({ slot: 13, teams: 12 })).toEqual([]);
    expect(pickNumbers({ slot: null, teams: 12 })).toEqual([]);
    expect(pickNumbers()).toEqual([]);
  });
});

describe("the card", () => {
  const draft = { season: 2026, status: "pre_draft", draft_type: "snake", rounds: 15, start_time_ms: null };
  const twelve = Array.from({ length: 12 }, (_, i) => ({ draft_slot: i + 1, sleeper_user_id: `u${i + 1}` }));
  const roster = Array.from({ length: 12 }, (_, i) => ({ team_name: `Team ${i + 1}`, sleeper_user_id: `u${i + 1}` }));

  it("leads with the reader's own pick and says when they are up", () => {
    const html = draftCard(draftView({ draft, slots: twelve, members: roster, meSleeperId: "u7" }));
    expect(html).toContain("7th");
    expect(html).toContain("of 12");
    expect(html).toContain("is-me");
    /* The snake, on the card: 7th, then 18th, then 31st. */
    expect(html).toContain(">18<");
    expect(html).toContain(">31<");
  });

  it("shows only as many rounds as the draft actually has", () => {
    const html = draftCard(draftView({
      draft: { ...draft, rounds: 2 }, slots: twelve, members: roster, meSleeperId: "u7",
    }));
    expect((html.match(/do-pick-round/g) || []).length).toBe(2);
  });

  it("draws no pick cells for an auction", () => {
    const html = draftCard(draftView({
      draft: { ...draft, draft_type: "auction" }, slots: twelve, members: roster, meSleeperId: "u7",
    }));
    expect(html).not.toContain("do-picks");
    expect(html).toContain("is-me");
  });

  it("falls back to the board size for a reader it cannot place", () => {
    const html = draftCard(draftView({ draft, slots: twelve, members: roster, meSleeperId: null }));
    expect(html).toContain("Teams");
    expect(html).not.toContain("is-me");
    expect(html).not.toContain("do-picks");
  });

  it("says so plainly when the order is not set", () => {
    const html = draftCard(draftView({ draft, slots: [], members: roster }));
    expect(html).toContain("Order not set");
    expect(html).not.toContain("do-board");
  });

  it("draws nothing at all when there is no draft", () => {
    expect(draftCard(draftView({ draft: null }))).toBe("");
  });

  it("escapes a team name", () => {
    const html = draftCard(draftView({
      draft, slots: [{ draft_slot: 1, sleeper_user_id: "x" }],
      members: [{ team_name: "<script>", sleeper_user_id: "x" }],
    }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  /* The card must never name a colour. Six themes plus a palette per team
     mean anything hardcoded here is wrong on five of them. */
  it("carries no colour of its own", () => {
    const html = draftCard(draftView({ draft, slots: twelve, members: roster, meSleeperId: "u7" }));
    expect(html).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(html).not.toMatch(/style=/i);
  });
});

describe("ordinal", () => {
  it("handles the teens and the rest", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal))
      .toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st"]);
    expect(ordinal(null)).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { toPar, rank, roundBoard, groupLabel, currentRound,
         label, tone, progress } from "./golf-board.js";

/* A flat par-4 nine, which makes every expectation below readable: a 4 is
   level, a 3 is one under, a 5 is one over. */
const NINE = Array.from({ length: 9 }, (_, i) => ({ hole: i + 1, par: 4 }));

const R1 = { id: 1, round_number: 1, format: "pairs", holes: 9 };
const R2 = { id: 2, round_number: 2, format: "pairs", holes: 9 };
const R3 = { id: 3, round_number: 3, format: "singles", holes: 9 };

const card = (...strokes) => new Map(strokes.map((s, i) => [i + 1, s]));

let nextSide = 0;
function ball(round, teamId, players, strokes, extra = {}) {
  nextSide += 1;
  return {
    id: nextSide,
    matchId: extra.matchId ?? nextSide,
    matchNumber: extra.matchNumber ?? 1,
    round, teamId, teamName: `Team ${teamId}`, teamOrder: teamId, color: "#fff",
    players: players.map((name) => ({ participantId: name, name })),
    strokes,
  };
}

describe("to par", () => {
  it("counts only the holes actually written down", () => {
    /* Three holes in at one under. The six unplayed holes owe nothing. */
    expect(toPar(card(4, 3, 4), NINE, R1)).toEqual({ diff: -1, total: 11, thru: 3, of: 9 });
  });

  it("does not credit par for a hole with no score", () => {
    const played = toPar(card(4, 4, 4), NINE, R1);
    const blank = toPar(new Map(), NINE, R1);
    expect(played.diff).toBe(0);
    expect(blank).toEqual({ diff: 0, total: 0, thru: 0, of: 9 });
    /* Both read "level", which is why thru has to break the tie and why
       rank() puts an unstarted row last rather than in front. */
    expect(rank([{ ...blank, order: 0 }, { ...played, order: 1 }])[0].thru).toBe(3);
  });

  it("ignores a zero or a nonsense stroke instead of counting the hole", () => {
    expect(toPar(card(4, 0, 4), NINE, R1).thru).toBe(2);
    expect(toPar(new Map([[1, 4], [2, null]]), NINE, R1).thru).toBe(1);
  });

  it("reads an 18-hole round as eighteen", () => {
    expect(toPar(card(4), NINE, { ...R1, holes: 18 }).of).toBe(18);
  });
});

describe("ranking", () => {
  const row = (diff, thru, order) => ({ diff, thru, of: 9, total: 0, order });

  it("puts the best score to par first", () => {
    expect(rank([row(2, 9, 1), row(-3, 9, 2), row(0, 9, 3)]).map((r) => r.diff)).toEqual([-3, 0, 2]);
  });

  it("breaks a tie with whoever has played more holes", () => {
    /* -1 thru 9 is a better round than -1 thru 3, and the board has to say
       so or a pair one hole in tops it until everybody catches up. */
    expect(rank([row(-1, 3, 1), row(-1, 9, 2)])[0].thru).toBe(9);
  });

  it("puts anybody yet to tee off last, whatever the field is doing", () => {
    const out = rank([row(0, 0, 1), row(9, 9, 2), row(0, 0, 3)]);
    expect(out[0].diff).toBe(9);
    expect(out.slice(1).every((r) => r.thru === 0)).toBe(true);
  });
});

describe("a round's board", () => {
  it("ranks a 2v2 round by each PAIR's differential", () => {
    const data = {
      holes: NINE,
      balls: [
        ball(R1, 1, ["Ann", "Bo"], card(4, 4, 4), { matchId: 10, matchNumber: 1 }),   //  E
        ball(R1, 2, ["Eve", "Fay"], card(3, 3, 3), { matchId: 10, matchNumber: 1 }),  // -3
        ball(R1, 1, ["Cal", "Dee"], card(5, 5, 5), { matchId: 11, matchNumber: 2 }),  // +3
        ball(R1, 2, ["Gus", "Hal"], card(4, 3, 4), { matchId: 11, matchNumber: 2 }),  // -1
      ],
    };
    const groups = roundBoard(data, R1);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("pairs");
    /* Ranked across the whole round, not within each match: the point of
       the board is seeing your pair against every other pair. */
    expect(groups[0].rows.map((r) => [r.name, r.diff])).toEqual([
      ["Eve & Fay", -3], ["Gus & Hal", -1], ["Ann & Bo", 0], ["Cal & Dee", 3],
    ]);
  });

  it("ranks a singles round by each PLAYER's differential", () => {
    const data = {
      holes: NINE,
      balls: [
        ball(R3, 1, ["Ann"], card(5, 5), { matchId: 30 }),   // +2
        ball(R3, 2, ["Eve"], card(3, 4), { matchId: 30 }),   // -1
        ball(R3, 1, ["Cal"], card(4, 4), { matchId: 31 }),   //  E
      ],
    };
    const groups = roundBoard(data, R3);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("singles");
    expect(groups[0].rows.map((r) => r.name)).toEqual(["Eve", "Cal", "Ann"]);
    expect(groups[0].rows.every((r) => r.shared)).toBe(false);
  });

  it("ranks remote golfers against the par on their own course", () => {
    const parThree = NINE.map((hole) => ({ ...hole, par: 3 }));
    const ann = ball(R3, 1, ["Ann"], card(4, 4));
    const eve = ball(R3, 2, ["Eve"], card(3, 3));
    ann.holes = NINE; ann.courseName = "Center"; // level
    eve.holes = parThree; eve.courseName = "Rolla"; // level
    const rows = roundBoard({ holes: NINE, balls: [ann, eve] }, R3)[0].rows;
    expect(rows.map((row) => [row.name, row.diff, row.courseName])).toEqual([
      ["Ann", 0, "Center"], ["Eve", 0, "Rolla"],
    ]);
  });

  it("only shows the round it was asked for", () => {
    const data = {
      holes: NINE,
      balls: [
        ball(R1, 1, ["Ann", "Bo"], card(3, 3, 3)),
        ball(R2, 1, ["Ann", "Cal"], card(5, 5, 5)),
      ],
    };
    /* Round 2's +3 must not follow Ann into round 1's board. */
    expect(roundBoard(data, R1)[0].rows[0].diff).toBe(-3);
    expect(roundBoard(data, R2)[0].rows[0].diff).toBe(3);
  });

  it("splits a round that somehow holds both shapes, ranked separately", () => {
    /* A seat left with one player in a 2v2 round. A shared ball and a solo
       ball are not comparable, so they must not share a ranking. */
    const data = {
      holes: NINE,
      balls: [
        ball(R1, 1, ["Ann", "Bo"], card(4, 4, 4), { matchNumber: 1 }),
        ball(R1, 2, ["Eve"], card(3, 3, 3), { matchNumber: 1 }),
      ],
    };
    const groups = roundBoard(data, R1);
    expect(groups.map((g) => g.kind)).toEqual(["pairs", "singles"]);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[1].rows).toHaveLength(1);
    /* Eve is three under and still not ranked above the pair, because she
       is not in the same list. */
    expect(groups[0].rows[0].name).toBe("Ann & Bo");
  });

  it("gives every row the card it is scored on", () => {
    const data = { holes: NINE, balls: [ball(R3, 1, ["Ann"], card(4), { matchId: 77 })] };
    expect(roundBoard(data, R3)[0].rows[0].matchId).toBe(77);
  });

  it("is empty for a round with no matches", () => {
    expect(roundBoard({ holes: NINE, balls: [] }, R1)).toEqual([]);
  });

  it("names the groups the way the card heads them", () => {
    expect(groupLabel("pairs")).toBe("Pairs");
    expect(groupLabel("singles")).toBe("Singles");
  });
});

describe("which round the board opens on", () => {
  const rounds = [R1, R2, R3];

  it("opens on the round being played", () => {
    const balls = [
      ball(R1, 1, ["Ann", "Bo"], card(4, 4, 4)),
      ball(R2, 1, ["Ann", "Cal"], card(4)),
    ];
    /* Round 1 is done and round 2 has a stroke in it, so round 2 is live. */
    expect(currentRound(rounds, balls)).toBe(R2);
  });

  it("opens on the first round before anybody tees off", () => {
    const balls = [ball(R1, 1, ["Ann", "Bo"], new Map())];
    expect(currentRound(rounds, balls)).toBe(R1);
  });

  it("survives a day with no rounds at all", () => {
    expect(currentRound([], [])).toBe(null);
  });
});

describe("how a row reads", () => {
  it("says E for level and never +0", () => {
    expect(label({ diff: 0, thru: 3 })).toBe("E");
    expect(label({ diff: 2, thru: 3 })).toBe("+2");
    expect(label({ diff: -2, thru: 3 })).toBe("-2");
    expect(label({ diff: 0, thru: 0 })).toBe("—");
  });

  it("tints under, level and over the way the scorecard does", () => {
    expect(tone({ diff: -1, thru: 1 })).toBe("under");
    expect(tone({ diff: 1, thru: 1 })).toBe("over");
    expect(tone({ diff: 0, thru: 1 })).toBe("even");
    expect(tone({ diff: 0, thru: 0 })).toBe("none");
  });

  it("only says Finished once every hole of the round is in", () => {
    expect(progress({ thru: 0, of: 9 })).toBe("Not started");
    expect(progress({ thru: 8, of: 9 })).toBe("Thru 8");
    expect(progress({ thru: 9, of: 9 })).toBe("Finished");
  });
});

import { describe, expect, it } from "vitest";
import { battleResult, standingLine } from "./golf-battle.js";

describe("match-play card totals", () => {
  it("keeps the official closeout result while counting every scored hole", () => {
    const winner = new Map(Array.from({ length: 9 }, (_, i) => [i + 1, 3]));
    const opponent = new Map(Array.from({ length: 9 }, (_, i) => [i + 1, 4]));
    const result = battleResult(winner, opponent, 9, "match");

    expect(standingLine(result, "Winner", "Opponent")).toBe("Winner won 5&4");
    expect([result.cardWonA, result.cardWonB]).toEqual([9, 0]);
  });
});

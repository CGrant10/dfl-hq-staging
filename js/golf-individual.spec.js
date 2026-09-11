import { describe, expect, it } from "vitest";
import { individualMatchLabel, individualResult, individualStanding } from "./golf-individual.js";

const card = (...strokes) => new Map(strokes.map((value, index) => [index + 1, value]));

describe("individual tournament matches", () => {
  it("labels three golfers as a 1v1v1", () => {
    expect(individualMatchLabel(3)).toBe("1v1v1");
    expect(individualMatchLabel(5)).toBe("1v1v1v1v1");
  });

  it("does not declare a winner until every card is complete", () => {
    const result = individualResult([card(4, 4, 4), card(3, 4), card(5, 4, 4)], 3);
    expect(result.complete).toBe(false);
    expect(result.leaders).toEqual([]);
    expect(individualStanding(result, ["A", "B", "C"])).toBe("2 of 3 cards complete");
  });

  it("ranks all golfers together and supports ties", () => {
    const result = individualResult([card(4, 4, 4), card(3, 4, 5), card(5, 3, 4)], 3);
    expect(result.complete).toBe(true);
    expect(result.leaders).toEqual([0, 1, 2]);
    expect(individualStanding(result, ["A", "B", "C"])).toBe("A & B & C tied for the win");
  });

  it("finds the lowest complete score", () => {
    const result = individualResult([card(4, 4, 4), card(3, 3, 4), card(5, 4, 4)], 3);
    expect(result.leaders).toEqual([1]);
    expect(individualStanding(result, ["A", "B", "C"])).toBe("B wins");
  });
});

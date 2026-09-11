import { describe, expect, it } from "vitest";
import { recommendClub } from "./golf-club-recommendation.js";

const bag = [
  { club: "Driver", yards: 235 },
  { club: "7 iron", yards: 155 },
  { club: "Pitching wedge", yards: 115 },
];

describe("recommendClub", () => {
  it("chooses the closest personal carry distance", () => {
    expect(recommendClub(bag, 160)).toEqual({ club: "7 iron", yards: 155 });
    expect(recommendClub(bag, 220)).toEqual({ club: "Driver", yards: 235 });
  });

  it("prefers the longer club when two carries are equally close", () => {
    expect(recommendClub([{ club: "8 iron", yards: 140 }, { club: "7 iron", yards: 150 }], 145))
      .toEqual({ club: "7 iron", yards: 150 });
  });

  it("ignores incomplete bag rows and invalid yardages", () => {
    expect(recommendClub([{ club: "Putter", yards: null }, { club: "", yards: 100 }], 100)).toBeNull();
    expect(recommendClub(bag, 0)).toBeNull();
  });
});

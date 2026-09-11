import { describe, expect, it } from "vitest";
import { nextTeamPair } from "./golf-matchups.js";

const teams = [1, 2, 3, 4].map((id) => ({ id }));
const battle = (a, b) => ({ sides: [{ team_id: a }, { team_id: b }] });

describe("multi-team golf matchups", () => {
  it("still defaults a two-team event to its only matchup", () => {
    expect(nextTeamPair(teams.slice(0, 2), [])).toEqual(["1", "2"]);
  });

  it("cycles through every pairing in a three-team field before repeating", () => {
    const played = [];
    const sequence = [];
    for (let i = 0; i < 3; i += 1) {
      const pair = nextTeamPair(teams.slice(0, 3), played);
      sequence.push(pair);
      played.push(battle(...pair));
    }
    expect(sequence).toEqual([["1", "2"], ["1", "3"], ["2", "3"]]);
  });

  it("balances team appearances while choosing unused pairs", () => {
    const played = [battle(1, 2), battle(1, 3)];
    /* Team 4 has not appeared yet, so it is brought in before 2-3 even
       though both pairs are new. */
    expect(nextTeamPair(teams, played)).toEqual(["2", "4"]);
  });

  it("requires two teams", () => {
    expect(nextTeamPair(teams.slice(0, 1), [])).toEqual([]);
  });
});

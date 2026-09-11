import { describe, expect, it } from "vitest";
import { quickCourseGroups, quickCourseHoleMap, quickCourseId, quickHolesFor } from "./golf-quick-courses.js";

describe("multi-course Quick Rounds", () => {
  const round = { course_id: 10 };
  const players = [{ id: 1, course_id: null }, { id: 2, course_id: 20 }];

  it("uses the round course unless a golfer has an override", () => {
    expect(quickCourseId(round, players[0])).toBe(10);
    expect(quickCourseId(round, players[1])).toBe(20);
  });

  it("keeps each golfer on that course's pars and yardages", () => {
    const map = quickCourseHoleMap([
      { course_id: 10, hole: 1, par: 4 },
      { course_id: 20, hole: 1, par: 5 },
    ]);
    expect(quickHolesFor(round, players[0], map)[0].par).toBe(4);
    expect(quickHolesFor(round, players[1], map)[0].par).toBe(5);
  });

  it("groups a shared scorecard by course", () => {
    const groups = quickCourseGroups(round, players, [{ id: 10, name: "Center" }, { id: 20, name: "Rolla" }]);
    expect(groups.map(group => [group.name, group.players.map(player => player.id)])).toEqual([
      ["Center", [1]], ["Rolla", [2]],
    ]);
  });
});

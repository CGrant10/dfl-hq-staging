import { describe, expect, it } from "vitest";
import { capHoleDistance, distanceYards, holeZoom, isOutsideHole, nearestTeeHole } from "./golf-gps-distance.js";

describe("hole GPS distance handling", () => {
  it("never displays more than the selected hole's maximum yardage", () => {
    expect(capHoleDistance(3000, 352)).toBe(352);
    expect(capHoleDistance(146, 352)).toBe(146);
  });

  it("keeps a missing GPS fix missing instead of converting it to zero", () => {
    expect(capHoleDistance(null, 352)).toBeNull();
    expect(isOutsideHole(null, 352)).toBe(false);
  });

  it("recognizes fixes well outside the hole corridor", () => {
    expect(isOutsideHole(500, 352)).toBe(true);
    expect(isOutsideHole(410, 352)).toBe(false);
  });

  it("zooms progressively as the player approaches the green", () => {
    expect(holeZoom(350)).toBe(17);
    expect(holeZoom(200)).toBe(18);
    expect(holeZoom(100)).toBe(19);
    expect(holeZoom(40)).toBe(20);
  });

  it("detects a selected hole only when the player is near its tee", () => {
    const tees = {
      1: { lat: 48.894, lng: -99.683 },
      2: { lat: 48.897, lng: -99.681 },
    };
    expect(nearestTeeHole({ lat: 48.89405, lng: -99.683 }, tees)).toMatchObject({ hole: 1 });
    expect(nearestTeeHole({ lat: 48.9, lng: -99.69 }, tees, 30)).toBeNull();
    expect(distanceYards(tees[1], tees[1])).toBe(0);
  });
});

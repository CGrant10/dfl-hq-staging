import { describe, expect, it } from "vitest";
import {
  PRESETS, QUALITY_LADDER,
  containBox, coverSquare, dataUriBytes, describeValue, fmtBytes, isDataUri,
} from "./image-shrink.js";

describe("sizing a picked image", () => {
  it("scales the long edge down to the cap and keeps the shape", () => {
    expect(containBox(4000, 3000, 720)).toEqual({ w: 720, h: 540 });
    expect(containBox(3000, 4000, 720)).toEqual({ w: 540, h: 720 });
  });

  it("never enlarges a small picture", () => {
    /*
      THE ONE THAT MATTERS FOR CRESTS AND LOGOS. Upscaling a 120px mark to 720
      spends bytes to add no detail and makes a crisp shape look soft. A picture
      already inside the cap comes through untouched.
    */
    expect(containBox(120, 90, 720)).toEqual({ w: 120, h: 90 });
    expect(containBox(720, 720, 720)).toEqual({ w: 720, h: 720 });
  });

  it("returns nothing for a picture it could not measure", () => {
    /* createImageBitmap on a corrupt file can hand back zero dimensions, and a
       zero here would otherwise become a canvas of width NaN. */
    expect(containBox(0, 500, 720)).toEqual({ w: 0, h: 0 });
    expect(containBox(500, 500, 0)).toEqual({ w: 0, h: 0 });
  });

  it("crops an avatar from the middle, not the corner", () => {
    /* A portrait photo cropped from the top-left is a picture of somebody's
       forehead. The offset centres the square on both axes. */
    expect(coverSquare(1000, 600)).toEqual({ sx: 200, sy: 0, side: 600 });
    expect(coverSquare(600, 1000)).toEqual({ sx: 0, sy: 200, side: 600 });
    expect(coverSquare(800, 800)).toEqual({ sx: 0, sy: 0, side: 800 });
  });
});

describe("measuring what would be stored", () => {
  it("reads the decoded size out of a base64 data URI", () => {
    /* Four base64 characters carry three bytes, less one per '=' of padding. */
    expect(dataUriBytes("data:image/webp;base64,AAAA")).toBe(3);
    expect(dataUriBytes("data:image/webp;base64,AAA=")).toBe(2);
    expect(dataUriBytes("data:image/webp;base64,AA==")).toBe(1);
  });

  it("counts nothing for a link, because a link costs the row nothing", () => {
    expect(dataUriBytes("https://example.com/a.png")).toBe(0);
    expect(dataUriBytes("")).toBe(0);
    expect(dataUriBytes(null)).toBe(0);
  });

  it("tells a stored picture apart from a link", () => {
    expect(isDataUri("data:image/webp;base64,AAAA")).toBe(true);
    expect(isDataUri("data:image/svg+xml;base64,AAAA")).toBe(true);
    expect(isDataUri("https://example.com/a.png")).toBe(false);
    /* Not base64 - a plain-text data URI is not something this app writes, and
       treating it as one would report a nonsense size. */
    expect(isDataUri("data:image/svg+xml,%3Csvg/%3E")).toBe(false);
  });

  it("describes a value the way the form has to explain it", () => {
    /*
      The two cases behave completely differently and the admin needs to know
      which they have: a link breaks when somebody else's server goes down, a
      stored picture counts against every read of the row.
    */
    expect(describeValue("https://example.com/a.png")).toBe("A link to another site");
    expect(describeValue("")).toBe("");
    expect(describeValue(`data:image/webp;base64,${"A".repeat(28000)}`)).toMatch(/^2[01] KB, stored on the row$/);
    /* Rounds up, never to "0 KB" - a picture that exists is at least 1KB to a
       reader, and "0 KB" reads as "nothing was saved". */
    expect(describeValue("data:image/webp;base64,AAAA")).toBe("1 KB, stored on the row");
  });

  it("writes byte counts the way the error message needs them", () => {
    expect(fmtBytes(16 * 1024 * 1024)).toBe("16.0 MB");
    expect(fmtBytes(40 * 1024)).toBe("40 KB");
    expect(fmtBytes(10)).toBe("1 KB");
  });
});

describe("the presets and the ladder", () => {
  it("keeps the avatar square and the backdrop not", () => {
    expect(PRESETS.avatar.square).toBe(true);
    expect(PRESETS.backdrop.square).toBe(false);
  });

  it("budgets an avatar smaller than a backdrop", () => {
    /* An avatar is drawn at 96px and every member's is loaded together on the
       Members screen; a backdrop is one picture at a time, full width. */
    expect(PRESETS.avatar.budget).toBeLessThan(PRESETS.backdrop.budget);
    expect(PRESETS.avatar.maxPx).toBeLessThan(PRESETS.backdrop.maxPx);
  });

  it("walks quality downwards, so the first rung that fits is the best one", () => {
    /* encodeAt() returns on the first rung inside budget, which is only the
       highest-quality fit if the ladder descends. */
    const sorted = [...QUALITY_LADDER].sort((a, b) => b - a);
    expect(QUALITY_LADDER).toEqual(sorted);
    expect(QUALITY_LADDER.every((q) => q > 0 && q <= 1)).toBe(true);
  });
});

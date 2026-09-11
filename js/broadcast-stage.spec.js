import { describe, expect, it } from "vitest";
import { fitSize, focusShouldPause, shouldRun, STAGE_CONTROL } from "./broadcast-stage.js";

/* A stand-in for a DOM node: only closest() is used, and only against the
   control selector, so this is the whole surface the decision touches. */
const el = (matches) => ({ closest: (sel) => (sel === STAGE_CONTROL && matches ? {} : null) });

describe("broadcast stage autoplay", () => {
  it("does NOT pause when focus lands on a nav control", () => {
    /*
      THE BUG. Clicking the next arrow focuses that arrow. focusin fired, the
      "focus" soft pause went on, and focusout only clears it when focus leaves
      the stage entirely - which it never does, because the button you just
      pressed is inside the stage. One arrow press killed the rotation for the
      rest of the visit, on every device.
    */
    expect(focusShouldPause(el(true))).toBe(false);
  });

  it("still pauses when focus is on the slide itself", () => {
    // The reason the pause exists: a keyboard user reading a slide should not
    // be yanked to the next one.
    expect(focusShouldPause(el(false))).toBe(true);
  });

  it("guards a missing element, and treats an unrecognisable one as content", () => {
    // No element, nothing to pause for.
    expect(focusShouldPause(null)).toBe(false);
    expect(focusShouldPause(undefined)).toBe(false);
    /*
      A target with no closest() is not a control, so it counts as content and
      pauses. That is the safe direction and it cannot re-create the latch: a
      thing that is not an element cannot hold focus, so there is nothing for
      focusout to fail to clear.
    */
    expect(focusShouldPause({})).toBe(true);
  });

  it("runs only with more than one slide and nothing holding it", () => {
    expect(shouldRun({ count: 4 })).toBe(true);
    expect(shouldRun({ count: 1 })).toBe(false);
    expect(shouldRun({ count: 0 })).toBe(false);
    expect(shouldRun()).toBe(false);
  });

  it("stops for any single reason, and needs all of them clear", () => {
    expect(shouldRun({ count: 4, dead: true })).toBe(false);
    expect(shouldRun({ count: 4, userPaused: true })).toBe(false);
    /* softSize covers hover, focus and hidden. A hidden tab is why this whole
       decision cannot be observed in a headless browser - the page correctly
       refuses to rotate, so a test that drives a real stage proves nothing. */
    expect(shouldRun({ count: 4, softSize: 1 })).toBe(false);
    expect(shouldRun({ count: 4, softSize: 3 })).toBe(false);
    expect(shouldRun({ count: 4, dead: false, userPaused: false, softSize: 0 })).toBe(true);
  });
});

describe("fitting a team name onto one line", () => {
  it("leaves a name that already fits completely alone", () => {
    /* null means "do not touch it". A headline that fits must keep the size the
       stylesheet gave it, or every short name would be silently rewritten in an
       inline style and stop responding to the type scale. */
    expect(fitSize(40, 180, 300)).toBe(null);
    expect(fitSize(40, 300, 300)).toBe(null);
  });

  it("shrinks by the exact ratio it is over by", () => {
    /* 600px of text in a 300px box is twice too wide, so half the size - less a
       hair, because a font-size that lands exactly on the boundary re-wraps on
       a fractional-pixel layout. */
    const got = fitSize(40, 600, 300);
    expect(got).toBeLessThan(20);
    expect(got).toBeGreaterThan(19.5);
  });

  it("gives up rather than shrink a name into a caption", () => {
    /*
      THE CASE THAT MATTERS. A three-word team name on a narrow phone can be
      four times too wide; fitting it would mean 10px type. Returning null hands
      wrapping back, because two readable lines beat one unreadable one - the
      fix for wrapping must not be worse than the wrapping.
    */
    expect(fitSize(40, 1600, 300)).toBe(null);
  });

  it("refuses to divide by a measurement it did not get", () => {
    /* A slide measured while hidden reports zeros. Every one of these would
       otherwise produce NaN or Infinity and be written straight into a style. */
    expect(fitSize(0, 600, 300)).toBe(null);
    expect(fitSize(40, 0, 300)).toBe(null);
    expect(fitSize(40, 600, 0)).toBe(null);
  });
});

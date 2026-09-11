import { describe, expect, it } from "vitest";
import {
  artworkSettings, artworkStyle, displayedSize, focusPercent,
  overflowPx, panFocus, slideBackground, zoomAbout, zoomFactor,
} from "./broadcast-artwork.js";

describe("broadcast artwork framing", () => {
  it("keeps a slide that was never framed on the historic cover/centre", () => {
    expect(artworkSettings({})).toEqual({ imageFit: "cover", imageX: 50, imageY: 50, imageZoom: 1 });
  });

  it("reads the old keywords as the percentages they always meant", () => {
    /* Nine framings existed before the crop tool. Every one of them has to land
       exactly where it sat, or running the migration would move slides. */
    expect(artworkSettings({ image_position_x: "left", image_position_y: "top" }))
      .toMatchObject({ imageX: 0, imageY: 0 });
    expect(artworkSettings({ image_position_x: "right", image_position_y: "bottom" }))
      .toMatchObject({ imageX: 100, imageY: 100 });
    expect(artworkSettings({ image_position_x: "center", image_position_y: "center" }))
      .toMatchObject({ imageX: 50, imageY: 50 });
  });

  it("positions and scales about the SAME point", () => {
    /* This is the whole feel of the control: the bit you framed is the fixed
       point of the zoom, so pushing in tightens on the face. */
    expect(artworkStyle({ imageFit: "cover", imageX: 32.5, imageY: 18, imageZoom: 2.4 }))
      .toBe("object-fit:cover;object-position:32.5% 18%;transform-origin:32.5% 18%;--bx-zoom:2.4");
  });

  it("leads with object-fit, which stage.css selects on", () => {
    expect(artworkStyle({ imageFit: "contain" })).toMatch(/^object-fit:contain;/);
  });

  it("rejects arbitrary stored CSS values", () => {
    expect(artworkStyle({ imageFit: "url(bad)", imageX: "10%;color:red", imageY: 120, imageZoom: "1;evil" }))
      .toBe("object-fit:cover;object-position:50% 100%;transform-origin:50% 100%;--bx-zoom:1");
  });

  it("holds the zoom between covering the stage and running out of pixels", () => {
    expect(zoomFactor(0.4)).toBe(1);
    expect(zoomFactor(99)).toBe(4);
    expect(zoomFactor(1.667)).toBe(1.67);
    expect(zoomFactor(undefined)).toBe(1);
  });

  it("clamps a focal point to the picture", () => {
    expect(focusPercent(-20)).toBe(0);
    expect(focusPercent(180)).toBe(100);
    expect(focusPercent("nonsense")).toBe(50);
  });
});

describe("dragging a picture into place", () => {
  /* A 2000x1000 picture in a 400x300 box: cover scales it to 600x300, so there
     are 200px of picture to slide across horizontally and none vertically. */
  const natural = { w: 2000, h: 1000 };
  const box = { w: 400, h: 300 };

  it("sizes the picture the way object-fit does", () => {
    expect(displayedSize(natural, box, "cover")).toEqual({ w: 600, h: 300 });
    expect(displayedSize(natural, box, "contain")).toEqual({ w: 400, h: 200 });
  });

  it("knows how much there is to pan, and how the zoom changes it", () => {
    const d = displayedSize(natural, box, "cover");
    expect(overflowPx(d, box, 1)).toEqual({ x: 200, y: 0 });
    expect(overflowPx(d, box, 2)).toEqual({ x: 800, y: 300 });
  });

  it("moves the picture with the finger", () => {
    /* Dragging right reveals what is to the LEFT, so the focal percentage
       falls. Half the overflow is half the range. */
    expect(panFocus(50, 100, 200)).toBe(0);
    expect(panFocus(50, -100, 200)).toBe(100);
  });

  it("cannot be dragged past an edge", () => {
    expect(panFocus(50, 9999, 200)).toBe(0);
    expect(panFocus(50, -9999, 200)).toBe(100);
  });

  it("does not move an axis with nothing to pan", () => {
    /* The vertical axis of that picture ends exactly where the box does. A
       naive divide here is what would send the framing to NaN. */
    expect(panFocus(50, 40, 0)).toBe(50);
    expect(Number.isFinite(panFocus(50, 40, 0))).toBe(true);
  });

  it("holds the pinched point still while zooming", () => {
    /* Whatever is under the fingers before the pinch is under them after it.
       Checked by asking where that part of the picture ends up: with the
       returned focal percentage, the same fraction sits at the same place. */
    const displayed = 600, boxW = 400, at = 0.25;
    const from = 1, to = 2;
    const u0 = 50 / 100;
    const held = u0 + (at * boxW - u0 * boxW) / (displayed * from);

    const next = zoomAbout(50, at, displayed, boxW, from, to) / 100;
    const landsAt = next * boxW + displayed * to * (held - next);
    expect(landsAt).toBeCloseTo(at * boxW, 6);
  });

  it("gives up gracefully when the new zoom leaves nothing to choose", () => {
    expect(zoomAbout(50, 0.25, 400, 400, 1, 1)).toBe(50);
  });
});

describe("a hand-written slide that has a picture", () => {
  it("shows it, without the commissioner also switching the plate", () => {
    /*
      THE BUG. The picture field and the Background select were two separate
      decisions, fifteen fields apart behind "More options", and choosing only
      the picture produced a slide with no picture on it.
    */
    expect(slideBackground({ image: "data:image/png;base64,xx", background: "default" })).toBe("image");
  });

  it("infers it for a row saved before the column existed", () => {
    expect(slideBackground({ image: "https://example.test/a.jpg" })).toBe("image");
  });

  it("leaves a plate the commissioner actually chose alone", () => {
    expect(slideBackground({ image: "data:image/png;base64,xx", background: "dark" })).toBe("dark");
    expect(slideBackground({ image: "data:image/png;base64,xx", background: "logo" })).toBe("logo");
  });

  it("stays on the house look when there is no picture", () => {
    expect(slideBackground({ background: "default" })).toBe("default");
    expect(slideBackground({})).toBe("default");
  });

  it("degrades an unknown stored plate to the house look", () => {
    expect(slideBackground({ background: "neon" })).toBe("default");
  });
});

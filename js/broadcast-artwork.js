/* =====================================================================
   broadcast-artwork.js - where a slide's picture sits, and how far in.
   ---------------------------------------------------------------------
   Pure, and no imports, which is why the crop tool in image-field.js and
   the stage in broadcast-stage.js can both borrow it. One arithmetic, one
   style string: the control cannot offer a framing the stage will not draw.

   THE MODEL IS object-position PLUS A SCALE ABOUT THAT SAME POINT.

     x, y    0-100, the object-position percentage. Its definition is "line
             the x% point of the PICTURE up with the x% point of the BOX",
             which is the whole reason the framing is stored this way: it is
             relative to whatever overflow actually exists, so a slide framed
             on one shape of screen cannot show an edge on another. The stage
             is 52svh of full-bleed width - its shape is the phone's.

     zoom    1 and up. transform-origin is set to the SAME x% y%, so the
             point that was framed is the fixed point of the scale: pushing
             in tightens around the face rather than around the middle.

   Legacy keywords - left/center/right, top/center/bottom - read as 0/50/100
   because that is exactly what they meant, so a row saved before the crop
   tool existed lands where it always sat.
   ===================================================================== */

export const IMAGE_FITS = new Set(["cover", "contain"]);

/* The floor is 1 because below it the picture stops covering the stage. The
   ceiling is where a phone-sized photo has run out of pixels. Both match the
   CHECK in broadcast_artwork_zoom_schema.sql. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;

const LEGACY_X = { left: 0, center: 50, right: 100 };
const LEGACY_Y = { top: 0, center: 50, bottom: 100 };

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** A stored focal percentage, a legacy keyword, or nothing at all -> 0-100. */
export function focusPercent(value, legacy = LEGACY_X) {
  if (typeof value === "string" && value in legacy) return legacy[value];
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  /* One decimal is finer than any finger and keeps the column narrow. */
  return Math.round(clamp(n, 0, 100) * 10) / 10;
}

/** A stored zoom -> a factor the stage will honour. */
export function zoomFactor(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return ZOOM_MIN;
  return Math.round(clamp(n, ZOOM_MIN, ZOOM_MAX) * 100) / 100;
}

export function artworkSettings(row = {}) {
  return {
    imageFit: IMAGE_FITS.has(row.image_fit) ? row.image_fit : "cover",
    imageX: focusPercent(row.image_position_x, LEGACY_X),
    imageY: focusPercent(row.image_position_y, LEGACY_Y),
    imageZoom: zoomFactor(row.image_zoom),
  };
}

/*
  Every value below has been through the allow-list or through Number(), so
  this string carries no arbitrary database content into a style attribute.

  object-fit LEADS, because stage.css selects on `[style*="object-fit:contain"]`
  to give the letterboxed mode its dark plate.

  The zoom travels as a custom property rather than as `transform: scale()`,
  because the stage also animates the artwork - see bx-drift - and an inline
  transform would simply lose that fight. The keyframes multiply by it instead.
*/
export function artworkStyle(item = {}) {
  const s = artworkSettings({
    image_fit: item.imageFit,
    image_position_x: item.imageX,
    image_position_y: item.imageY,
    image_zoom: item.imageZoom,
  });
  const focus = `${s.imageX}% ${s.imageY}%`;
  return `object-fit:${s.imageFit};object-position:${focus};transform-origin:${focus};--bx-zoom:${s.imageZoom}`;
}

/*
  THE ARITHMETIC OF DRAGGING, and it is here rather than in the crop tool so
  it can be checked without a browser.

  Cover sizes the picture so it fills the box; contain so it fits inside it.
  Either way `over` is how much longer the picture is than the box on that
  axis, once the zoom is applied - negative under contain, where the picture
  is shorter and the percentage positions it in the empty space instead.

  Moving the focal point by one percent moves the picture by over/100 pixels,
  in the opposite direction: raising x% slides the picture LEFT, because it is
  a later part of the picture being pulled to the same place in the box.
*/
export function displayedSize(natural, box, fit = "cover") {
  const nw = Number(natural?.w) || 0, nh = Number(natural?.h) || 0;
  if (!nw || !nh || !box?.w || !box?.h) return null;
  const k = fit === "contain"
    ? Math.min(box.w / nw, box.h / nh)
    : Math.max(box.w / nw, box.h / nh);
  return { w: nw * k, h: nh * k };
}

/** How many pixels of picture the focal percentage has to travel across. */
export function overflowPx(displayed, box, zoom = 1) {
  if (!displayed || !box) return { x: 0, y: 0 };
  return { x: displayed.w * zoom - box.w, y: displayed.h * zoom - box.h };
}

/**
 * A drag, in pixels, applied to a focal percentage.
 *
 * An axis with no overflow cannot pan - the picture already ends exactly where
 * the box does - and the guard is what stops that dividing by zero and sending
 * the framing to NaN.
 */
export function panFocus(percent, deltaPx, over) {
  if (!Number.isFinite(over) || Math.abs(over) < 0.5) return focusPercent(percent);
  return focusPercent(focusPercent(percent) - (deltaPx * 100) / over);
}

/**
 * Zoom while holding one point of the picture still.
 *
 * `at` is where on the box the fingers are, 0-1. Pinching about the midpoint
 * and rolling a wheel over the cursor are the same operation: work out which
 * part of the picture is under that point now, then solve for the focal
 * percentage that still puts it there at the new zoom.
 *
 * Returns the focal percentage; the caller keeps the zoom it asked for.
 */
export function zoomAbout(percent, at, displayed, box, fromZoom, toZoom) {
  const u = focusPercent(percent) / 100;
  if (!displayed || !box) return focusPercent(percent);
  const D = displayed * fromZoom, D2 = displayed * toZoom;
  /* Which fraction of the picture sits under that point right now. */
  const held = u + (at * box - u * box) / (D || 1);
  const denom = box - D2;
  /* No overflow at the new zoom means there is nothing left to choose. */
  if (Math.abs(denom) < 0.5) return 50;
  return focusPercent(((at * box - D2 * held) / denom) * 100);
}

// -------------------------------------------------------------- the plate

/** The background modes broadcast-stage.js knows how to draw. */
export const BACKGROUNDS = new Set(["default", "light", "dark", "image", "logo"]);

/*
  A PICTURE ON A SLIDE MEANS THE SLIDE HAS A PICTURE.

  backdrop() in broadcast-stage.js only draws artwork when background is
  'image', so a commissioner who chose a picture and left the plate alone got
  a slide with no picture on it and nothing on screen to say why. Every other
  path already pairs the two - applyOverride() and the champion generators in
  broadcast-deck.js all set background:"image" the moment they have art - so
  this is the hand-written row catching up rather than a new rule.

  An explicit choice still wins: dark, light or crest was a decision and is
  left alone. 'default' is what the column says when nobody decided, and so it
  is the only value a picture is allowed to answer for.
*/
export function slideBackground(row = {}) {
  const chosen = BACKGROUNDS.has(row.background) ? row.background : "default";
  if (chosen === "default" && row.image) return "image";
  return chosen;
}

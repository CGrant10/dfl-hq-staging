// =====================================================================
// image-shrink.js - the arithmetic of getting a photo down to kilobytes.
// ---------------------------------------------------------------------
// PURE ON PURPOSE. No imports, no canvas, no DOM. js/image-field.js does
// the drawing and encoding; everything that decides HOW BIG lives here so
// it can be tested without a layout engine or a network - the same split
// as form-layout.js, broadcast-order.js and ticker-lines.js.
//
// WHY THIS EXISTS AT ALL
//
// Every image in this app is stored as a TEXT COLUMN on the row that uses
// it - members.profile_image, broadcast_items.image. That was fine while
// they held URLs to somebody else's server. The moment an upload writes the
// picture itself into that column, the column IS the storage, and a 4MB
// phone photo becomes a 5.3MB base64 string that every member downloads on
// every page load that touches that row.
//
// So the rule is: shrink first, ask questions later. A profile picture is
// displayed at 96px and never needs more than 256px of pixels; a broadcast
// backdrop is displayed at most 720px wide. Encoded as WebP at those sizes
// a photograph lands in the 8-40KB range, which is a normal row.
// =====================================================================

/**
 * The largest FILE a person may hand over before we refuse to even decode it.
 *
 * Generous, because the point is not to police the input - it is shrunk on the
 * device a moment later either way. It exists so a mis-picked video does not
 * get handed to createImageBitmap().
 */
export const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

/**
 * How wide each kind of picture is allowed to be, and the byte budget it aims
 * at. The budget is a TARGET, not a guarantee: the ladder below walks quality
 * down towards it and stops when it runs out of rungs.
 *
 *   avatar     a square headshot. 256px because that is twice the largest
 *              size it is ever drawn at, which covers a 2x screen.
 *   backdrop   a stage or slide background. Drawn up to 720px wide by
 *              .bx-crest / .bx-art, so 720 is the honest cap.
 */
export const PRESETS = {
  avatar:   { maxPx: 256, budget:  40 * 1024, square: true },
  backdrop: { maxPx: 720, budget: 120 * 1024, square: false },
};

/**
 * Quality rungs, tried in order until the result fits the budget.
 *
 * Starts at 0.82 rather than 0.9 because above about 0.85 WebP spends bytes on
 * detail that a 256px avatar does not have, and stops at 0.36 because below
 * that a face acquires visible blocking - past that point the right move is
 * fewer pixels, not worse ones, which is what the second pass in shrink() does.
 */
export const QUALITY_LADDER = [0.82, 0.7, 0.58, 0.46, 0.36];

/**
 * Fit `w`x`h` inside a `maxPx` box, preserving the aspect ratio.
 *
 * NEVER UPSCALES. A 120px logo handed to a 720px preset stays 120px: enlarging
 * it would cost bytes to add no detail, and would make a small crisp mark look
 * soft on the stage.
 *
 * @returns {{w:number,h:number}} whole pixels, at least 1 each
 */
export function containBox(w, h, maxPx) {
  const sw = Number(w) || 0;
  const sh = Number(h) || 0;
  const cap = Number(maxPx) || 0;
  if (sw <= 0 || sh <= 0 || cap <= 0) return { w: 0, h: 0 };
  const scale = Math.min(1, cap / Math.max(sw, sh));
  return { w: Math.max(1, Math.round(sw * scale)), h: Math.max(1, Math.round(sh * scale)) };
}

/**
 * The centred square crop of a `w`x`h` image.
 *
 * An avatar is drawn in a circle, so cropping to a square on the way in is
 * what stops a portrait photo being squashed by the CSS instead.
 *
 * @returns {{sx:number,sy:number,side:number}} source rectangle
 */
export function coverSquare(w, h) {
  const sw = Number(w) || 0;
  const sh = Number(h) || 0;
  if (sw <= 0 || sh <= 0) return { sx: 0, sy: 0, side: 0 };
  const side = Math.min(sw, sh);
  return { sx: Math.round((sw - side) / 2), sy: Math.round((sh - side) / 2), side };
}

/**
 * How many bytes a data URI actually costs, from its base64 tail.
 *
 * Used to decide whether to try the next quality rung, so it has to measure the
 * STRING that will be stored rather than the decoded image: base64 is 4 characters
 * per 3 bytes, and it is the string that goes down the wire into a text column.
 *
 * Returns the DECODED size, which is the fair number to compare a budget
 * against - the transport overhead is a constant 4/3 either way.
 */
export function dataUriBytes(uri) {
  const s = String(uri || "");
  const at = s.indexOf(",");
  if (!s.startsWith("data:") || at < 0) return 0;
  const b64 = s.slice(at + 1);
  const pad = (b64.endsWith("==") && 2) || (b64.endsWith("=") && 1) || 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

/** True for a value the app stored itself rather than a link to somewhere else. */
export function isDataUri(value) {
  return /^data:image\/[a-z.+-]+;base64,/i.test(String(value || ""));
}

/**
 * A short, human description of a stored image value.
 *
 * The admin form shows this under the preview, because "42 KB, stored here" and
 * "a link to another site" behave completely differently - one breaks when
 * somebody else's server goes down, and the other counts against the row.
 */
export function describeValue(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (!isDataUri(v)) return "A link to another site";
  const kb = Math.max(1, Math.round(dataUriBytes(v) / 1024));
  return `${kb} KB, stored on the row`;
}

/**
 * Human bytes, for the "too large" message.
 */
export function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

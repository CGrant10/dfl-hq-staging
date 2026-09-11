// =====================================================================
// team-theme.js - a club's colours as a DFL HQ palette.
// ---------------------------------------------------------------------
// WHY THE FIRST ATTEMPT AT THIS FAILED. theme.js's header records it: the
// picker fed NFL team ids into a map that only held theme ids, so every
// choice collapsed to the default. The fix is not a bigger map - it is
// generating the palette from the club's colours, so there is nothing to
// look up and nothing to fall out of sync.
//
// THE PROBLEM THIS FILE ACTUALLY SOLVES.
//
// A team colour is chosen to look good on a helmet, not to be read as
// text on a black card. Nine clubs have a primary that is essentially
// black - the Raiders' #101820 is 1.2:1 on this ground, the Bears' navy
// #0B162A is 1.1:1 - and using those raw would produce an app with
// invisible links. Meanwhile the Steelers' #FFB612 needs no help at all.
//
// So a raw team colour is never used as text. liftForText() walks the
// colour's own hue up in lightness until it clears the contrast bar
// theme.js holds itself to, which is exactly what the dark, light and
// medicine palettes already do by hand in that file's comments - here it
// is arithmetic instead of taste, because it has to work for 32 clubs.
//
// THE THREE COLOURS, as asked for: primary, secondary and white. The
// surfaces are Medicine Wheel's, unchanged - this is a dark palette and
// only the accents move. Statuses are deliberately NOT recoloured: "paid"
// and "unpaid" have to stay tellable apart on the fees screen no matter
// which club somebody supports, and the occasion gold that marks a
// champion is not a team colour either.
// =====================================================================

/* ----------------------------------------------------------- colour math */

/** "#rrggbb" -> {r,g,b} 0-255. Tolerates a missing hash and short form. */
export function hexToRgb(hex) {
  let h = String(hex || "").trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

export function rgbToHex({ r, g, b }) {
  return "#" + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("");
}

/** WCAG relative luminance. */
export function luminance(hex) {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const f = [c.r, c.g, c.b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}

/** WCAG contrast ratio between two hex colours. 1 to 21. */
export function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function rgbToHsl({ r, g, b }) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
  else if (max === G) h = ((B - R) / d + 2) / 6;
  else h = ((R - G) / d + 4) / 6;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }) {
  if (!s) { const v = l * 255; return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    let u = t;
    if (u < 0) u += 1;
    if (u > 1) u -= 1;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return { r: hue(h + 1 / 3) * 255, g: hue(h) * 255, b: hue(h - 1 / 3) * 255 };
}

/*
  LIFT A COLOUR UNTIL IT CAN BE READ.

  Hue is preserved and lightness is walked in 1% steps, so the result is
  recognisably the club's colour rather than a generic pastel. Saturation
  gets a floor as it climbs: a near-black navy has so little of it that
  lifting lightness alone produces grey, and grey is not the Bears.

  There is a cap. A few clubs cannot reach the text bar without going white
  - and going white is worse than being slightly under it, because then
  every team looks the same. When the walk runs out the best result found is
  returned, which is still the most readable version of that hue available.
*/
export function liftForText(hex, bg, target = 6) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  if (contrast(hex, bg) >= target) return normalizeHex(hex);

  const hsl = rgbToHsl(rgb);
  const bgLum = luminance(bg);
  /* Which way is "more readable" depends on the ground, so this works for a
     light palette too even though only dark ones use it today. */
  const up = bgLum < 0.5;
  let best = normalizeHex(hex);
  let bestRatio = contrast(hex, bg);

  for (let i = 1; i <= 100; i++) {
    const l = up
      ? Math.min(0.97, hsl.l + i * 0.01)
      : Math.max(0.03, hsl.l - i * 0.01);
    /* Keep some colour in it. A desaturated lift reads as grey, which
       defeats the point of a team palette. */
    const s = hsl.s < 0.35 && hsl.s > 0.02 ? Math.min(0.55, hsl.s + i * 0.006) : hsl.s;
    const candidate = rgbToHex(hslToRgb({ h: hsl.h, s, l }));
    const ratio = contrast(candidate, bg);
    if (ratio > bestRatio) { bestRatio = ratio; best = candidate; }
    if (ratio >= target) return candidate;
    if (up && l >= 0.97) break;
    if (!up && l <= 0.03) break;
  }
  return best;
}

/*
  A FILL ONLY HAS TO BE SEEN, NOT READ, so it keeps the club's true colour
  wherever possible - that is the whole point of the fill/text split in
  theme.js. But a fill that matches the card it sits on is not a fill, and
  the Raiders', Jaguars' and Saints' #101820 is very nearly this palette's
  #141416 card. Those get lifted just far enough to have an edge.
*/
export function ensureFill(hex, bg, min = 1.9) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  if (contrast(hex, bg) >= min) return normalizeHex(hex);
  return liftForText(hex, bg, min);
}

/** Black or white, whichever can be read on top of this fill. */
export function inkOn(hex) {
  return contrast(hex, "#ffffff") >= contrast(hex, "#000000") ? "#FFFFFF" : "#0A0A0A";
}

function normalizeHex(hex) {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(rgb) : null;
}

/** Shortest distance between two hues on the wheel, 0 to 0.5. */
function hueGap(a, b) {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
}

/*
  WOULD A READER TAKE THESE TWO FOR THE SAME COLOUR?

  Both tests have to agree before the answer is yes:

    brightness   contrast below 1.35 - they read at the same weight
    hue          within ~25 degrees  - AND they are the same colour

  Either one alone is not enough. Two colours of equal brightness and
  opposite hue (salmon and grey-green) are trivially distinguishable, and
  two shades of the same hue at very different brightness are as well. A
  colour with almost no saturation has no meaningful hue, so a grey is
  compared on brightness alone.
*/
function sameColour(a, b) {
  if (!a || !b) return true;
  if (contrast(a, b) >= 1.35) return false;
  const A = rgbToHsl(hexToRgb(a)), B = rgbToHsl(hexToRgb(b));
  const greyish = A.s < 0.12 || B.s < 0.12;
  if (greyish) return true;                    // no hue to tell them apart by
  return hueGap(A.h, B.h) < 0.07;              // ~25 degrees
}

/* ------------------------------------------------------------- the palette */

/*
  MEDICINE WHEEL'S SURFACES, VERBATIM.

  "Keep it on dark mode, how we have the medicine wheel" - so the ground,
  dividers, hovers and control plates are that palette's, and a team theme
  differs from it only in the accents.

  THIS IS THE SINGLE DEFINITION. theme.js imports it and builds its own
  Medicine Wheel entry on top, so the two cannot drift - the first cut of
  this file copied these values and left two places to edit the same thing.
*/
export const MEDICINE_GROUND = Object.freeze({
  bg: "#0b0b0c", bg2: "#141416", bg3: "#1d1d20",
  line: "#2f2f34", lineSoft: "#212125",
  text: "#f4f2ee", muted: "#a8a096", chalk: "#ffffff",
  bodyText: "#ddd8d0",
  hover: "#1d1d20", hoverSoft: "rgba(255,255,255,.03)",
  controlLine: "#736b60", controlBg: "rgba(24,24,27,.74)",
  /*
    STATUSES ARE NOT TEAM COLOURS. "Paid" and "unpaid" have to be tellable
    apart at a glance on the fees screen whichever club somebody supports,
    and a Dolphins fan whose ok-green and accent-teal were the same colour
    could not read that screen at all. These stay put.
  */
  ok: "#8fd6a4", okBg: "rgba(96,176,123,.13)", okLine: "#3f7a52",
  /* An amber, NOT the wheel's yellow. An earlier cut used #EFC94C for both
     this and milestone, which made an OPEN badge and a CHAMPION badge the
     same colour - and gold is the occasion colour, so warn is the one that
     had to move. */
  warnInk: "#E8A33D", warnBg: "rgba(232,163,61,.12)", warnLine: "#7a5a20",
  /* Lighter and pinker than any accent for the same reason: UNPAID and a
     plain accent link were coming out identical. */
  dangerInk: "#F5A39B", dangerBg: "rgba(200,16,46,.14)", dangerLine: "#7d2029",
  scUnder: "#7fd39a", scOver: "#f0897e", scBad: "#d93b3b",
  /* The bar keeps the crest's black banner, as it does in every palette. */
  topbarA: "#101012", topbarB: "#0b0b0c",
  heroA: "#17171a", heroWash: "rgba(255,255,255,.05)",
  toastBg: "#232327", onToast: "#f4f2ee",
  /* Gold is the occasion colour - a champion badge - and stays gold. */
  milestone: "#EFC94C",
  shadow: "0 1px 3px rgba(0,0,0,.42)",
});

/* Local alias so the rest of this file reads as it did. */
const GROUND = MEDICINE_GROUND;

/**
 * Build a full palette from a club's two colours.
 *
 * @param {{primary:string, secondary:string, name?:string}} team
 * @returns {object|null} a MODES-shaped palette, or null for a bad input
 */
export function teamPalette(team) {
  const primary = hexToRgb(team?.primary) ? team.primary : null;
  if (!primary) return null;
  const secondary = hexToRgb(team?.secondary) ? team.secondary : "#FFFFFF";

  /*
    THE TEXT PAIR IS DERIVED, THE FILL PAIR IS THEIRS. Same split the rest
    of theme.js uses, and the reason ~60 `color: var(--accent)` rules stay
    correct without being touched.
  */
  const accent = liftForText(primary, GROUND.bg2, 6);
  let accent2 = liftForText(secondary, GROUND.bg2, 6);

  /*
    A CLUB WHOSE TWO COLOURS LIFT TO THE SAME PLACE would give the app one
    accent and no second one - the Jets' green and white both land on
    near-white. Those fall back to the palette's own white, which is the
    third colour and exists for exactly this.

    BUT "THE SAME PLACE" IS NOT A CONTRAST RATIO. Contrast measures
    luminance only, so it called Atlanta's salmon and grey identical - they
    are the same brightness and obviously different colours. Judging
    distinctness that way whitened the secondary for twenty of the
    thirty-two clubs and threw away the colour this feature is about.
    sameColour() below asks about hue as well, and only a pair that matches
    on both counts is collapsed.
  */
  if (!accent2 || sameColour(accent, accent2)) {
    accent2 = sameColour(accent, "#FFFFFF") ? GROUND.text : "#FFFFFF";
  }

  const fill = ensureFill(primary, GROUND.bg2);
  const fill2 = ensureFill(secondary, GROUND.bg2);

  return {
    ...GROUND,
    accent,
    accent2: accent2 || GROUND.chalk,
    fill,
    fill2,
    /* Whatever sits on a filled button has to be readable on THAT colour,
       not on the page - a white label on the Steelers' gold is invisible. */
    onAccent: inkOn(fill),
  };
}

/** Every value a palette must define, so a test can prove none is missing. */
export const PALETTE_KEYS = Object.freeze([
  ...Object.keys(GROUND), "accent", "accent2", "fill", "fill2", "onAccent",
]);

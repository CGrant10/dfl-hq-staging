// =====================================================================
// brand-ink.js - the Medicine identity, as constants, with no DOM
// ---------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL
//
// Two problems, one cause.
//
//   1. Every share renderer had its OWN copy of the house palette.
//      golf-share.js, fact-share.js and anything new each declared INK,
//      MUTED, BG, CARD, LINE for themselves, so retuning the identity meant
//      finding five lists and hoping.
//
//   2. Golf had a SECOND BRAND. `TEAM_COLORS` in pages/golf.js was six
//      arbitrary hues - a spring green, a sky blue, an orange, a coral, a
//      violet and a teal - none of them from the Medicine palette. They are
//      written into `golf_teams.color`, so they reached the teams card, the
//      team dots, the roster editor, the draft board and every shared image.
//      Golf looked like a different product with a different logo.
//
// FIXED VALUES, NOT LIVE THEME VALUES, and that distinction is the whole
// reason this is constants rather than getComputedStyle(). A shared image
// lands in somebody else's chat on somebody else's phone: it must not change
// with whoever pressed share and must not go white because the sender had
// light mode on. Nothing in here touches the DOM, so nothing in here can.
//
// The values are the `medicine` entry in js/theme.js, copied by hand. Copied
// rather than imported for exactly the reason above - importing theme.js
// would make an export depend on the viewer's live theme. If Medicine Wheel
// is retuned, these move with it, and this is the ONE list to move.
//
//   BG    bg        #0b0b0c      CARD  bg2       #141416
//   LINE  line      #2f2f34      INK   text      #f4f2ee
//   MUTED muted     #a8a096      GOLD  accent2   #EFC94C
//   ACCENT accent   #F08279      OK    ok        #8fd6a4
//
// ACCENT is the theme's TEXT red, not its fill red. #C8102E is a fine block
// of colour and a poor letter; theme.js already keeps the pair separate.
// =====================================================================

export const FONT_STACK =
  'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

/** The house palette for anything painted onto a canvas. */
export const SHARE_INK = {
  BG: "#0b0b0c",
  CARD: "#141416",
  CARD_2: "#1d1d20",
  LINE: "#2f2f34",
  INK: "#f4f2ee",
  MUTED: "#a8a096",
  GOLD: "#EFC94C",
  ACCENT: "#F08279",
  OK: "#8fd6a4",
  /* The crest's own pair, for the brand rule at the top of a card. Fills, not
     letters - see the note above. */
  CREST_RED: "#E5011B",
  CREST_BLUE: "#003396",
};

/*
  TEAM INKS - the Medicine Wheel, not a rainbow.
  ---------------------------------------------------------------------
  A team colour has a real job: telling one team from another at a glance, on
  a dot, a card edge and a shared image. So this cannot collapse to a single
  red - it has to stay DISTINGUISHABLE. What it does not have to be is a
  different colour scheme from the rest of the app.

  So these are the wheel's own four - red, yellow, white, stone - plus the
  crest blue lifted until it reads on the dark ground (#003396 is nearly
  invisible on #0b0b0c), plus the lifted red for a sixth team. Ordered so the
  first two teams, which is what most golf days actually have, are the crest's
  red and the wheel's yellow.

  ORDER IS IDENTITY. Team n is assigned TEAM_INKS[n % length], and the legacy
  map below is index-for-index against the old list, so an event generated last
  summer keeps its teams as distinct from each other as they were.
*/
export const TEAM_INKS = [
  "#C8102E",  // wheel red - the crest's fill red
  "#EFC94C",  // wheel yellow
  "#F4F2EE",  // wheel white
  "#5A82D6",  // crest blue, lifted to read on the dark ground
  "#A8A096",  // stone
  "#F08279",  // the lifted red, for a sixth team
];

/*
  The six hues pages/golf.js used to hand out, mapped index-for-index onto the
  list above.

  RENDER TIME ONLY. Nothing rewrites `golf_teams.color` - a stored colour is
  the team's data and this pass does not touch golf persistence. teamInk()
  below translates on the way to the screen, so existing events stop looking
  like a different product without a migration, and a colour somebody chose by
  hand still passes straight through.
*/
const LEGACY_TEAM_COLORS = {
  "#2fbf5f": TEAM_INKS[0],   // spring green
  "#4aa3ff": TEAM_INKS[1],   // sky blue
  "#f0a742": TEAM_INKS[2],   // orange
  "#e0574a": TEAM_INKS[3],   // coral
  "#b07cf0": TEAM_INKS[4],   // violet
  "#3ecfcf": TEAM_INKS[5],   // teal
};

/**
 * The ink to actually draw a team in.
 *
 * @param {string|null} stored  golf_teams.color, whatever is in the row
 * @param {number} [index]      the team's position, for a row with no colour
 * @returns {string} a hex colour
 */
export function teamInk(stored, index = 0) {
  const key = String(stored || "").trim().toLowerCase();
  if (LEGACY_TEAM_COLORS[key]) return LEGACY_TEAM_COLORS[key];
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(key)) return key;   // chosen by hand
  return TEAM_INKS[Math.abs(Number(index) || 0) % TEAM_INKS.length];
}

/** The colour to STORE for a newly generated team. */
export function newTeamColor(index = 0) {
  return TEAM_INKS[Math.abs(Number(index) || 0) % TEAM_INKS.length];
}

// =====================================================================
// broadcast-order.js - what plays first, and how a commissioner changes it.
// ---------------------------------------------------------------------
// PURE. broadcast-deck.js reads the database (loadBroadcastOverrides), the
// database pulls its client from a CDN over https, and the ESM test loader
// refuses that - so nothing importing it can be specced. This is the fourth
// module extracted for that reason after activity.js, form-layout.js and
// ticker-lines.js, and the rule is now simply house style: logic worth testing
// does not live in a file that talks to Supabase.
//
// The invariant this file exists to protect is small and easy to break: a new
// generator needs a LABEL (or the Admin panel cannot switch it off) and a BASE
// POSITION (or the panel cannot order it). broadcast-order.spec.js asserts both
// against the same key set, so adding a generator without deciding either one
// fails a test instead of quietly producing an unswitchable, unmovable source.
// =====================================================================

export const P = {
  FEATURED: 1000,
  LIVE:      900,
  MANUAL:    800,   // a human wrote it. Beats everything except a live game.
  RECENT:    700,
  MINE:      650,
  UPCOMING:  600,
  ACTIVITY:  500,   // open poll, fresh announcement
  CHAMPION:  400,   // always eligible - league identity, never drops out
  STAT:      300,
  HISTORY:   200,
  IDENTITY:  100,   // the floor. Always present, so a deck is never empty.
};

export const GENERATOR_LABELS = new Map([
  ["golf",          ["Golf day", "Live and upcoming golf outings"]],
  ["fantasy",       ["Fantasy matchups", "Scores from the Sleeper league"]],
  ["myMatchup",     ["Your matchup", "The signed-in member's own game"]],
  ["events",        ["Calendar events", "Draft night and anything else scheduled"]],
  ["poll",          ["Open polls", "Whatever the league is voting on"]],
  ["news",          ["Announcements", "Recent posts from the commissioner"]],
  ["champion",      ["Current champion", "The reigning title holder"]],
  ["pastChampions", ["Past champions", "Earlier title winners"]],
  ["chipEater",     ["Chip Eater", "Who came last, most recent season only"]],
  ["records",       ["Record book", "All-time highs and lows"]],
  ["seasonStat",    ["Season stats", "Figures from the current season"]],
  ["dues",          ["Dues", "What the league is owed"]],
  ["lore",          ["Moments", "Rivalries and league history"]],
  ["arena",         ["Arena", "Racer events"]],
  ["funfact",       ["Did you know?", "The day's fantasy fun fact"]],
]);

/*
  WHERE EACH GENERATOR SITS BEFORE ANYBODY MOVES IT.

  The priority each generator gives its items, written down once so the Admin
  panel can order the list the way the deck will actually play - and so a
  reorder can compute a weight that genuinely puts one source above another.

  It is a duplication of the numbers inside the generators, and it is a
  deliberate one: without it the panel can only offer a raw "weight" box, which
  is what it offered before and which nobody could use, because a weight means
  nothing until you know what it is being added to. broadcast-deck.spec.js
  asserts every registered generator has an entry, so a new generator cannot be
  added without deciding where it sits.

  These are BASE values. What plays also depends on what data exists that day,
  the decay on time-sensitive items, and the diversify() pass - so the panel
  says "running order" rather than promising positions.
*/
export const GENERATOR_BASE = new Map([
  ["golf",          P.UPCOMING],
  ["fantasy",       P.UPCOMING - 120],
  ["myMatchup",     P.MINE],
  /* Events range from P.LIVE on the day to P.UPCOMING beyond a week; the
     upcoming case is the one worth ordering against. */
  ["events",        P.UPCOMING + 50],
  ["poll",          P.ACTIVITY],
  ["news",          P.ACTIVITY],
  ["champion",      P.CHAMPION],
  ["seasonStat",    P.STAT],
  ["dues",          P.STAT - 50],
  ["funfact",       P.HISTORY + 20],
  ["pastChampions", P.HISTORY],
  /* Just above the past champions: the current Chip Eater is the only one of
     the historical slides that is about somebody's standing debt. */
  ["chipEater",     P.HISTORY + 10],
  ["records",       P.HISTORY],
  ["lore",          P.HISTORY],
  ["arena",         P.HISTORY],
  ["identity",      P.IDENTITY],
]);

/**
 * Effective standing of a generator, base plus whatever the commissioner did.
 *
 * Mirrors applyOverride()'s arithmetic: `featured` lifts it to the featured band
 * and weight is added on top; otherwise weight is a nudge against the base.
 */
export function generatorStanding(id, override) {
  const base = GENERATOR_BASE.get(id) ?? 0;
  const weight = Number(override?.weight) || 0;
  return override?.featured ? P.FEATURED + weight : base + weight;
}

/**
 * The weight that would put `id` immediately above or below `neighbour`.
 *
 * Returned rather than applied, so the panel can save one field and re-read.
 * A step of 1 past the neighbour is enough because the sort is a plain numeric
 * comparison - there is no need to leave gaps, and leaving them would make the
 * numbers drift upward every time somebody pressed an arrow.
 */
export function weightToPass(id, neighbourStanding, { above = true } = {}) {
  const base = GENERATOR_BASE.get(id) ?? 0;
  return Math.round(neighbourStanding + (above ? 1 : -1) - base);
}


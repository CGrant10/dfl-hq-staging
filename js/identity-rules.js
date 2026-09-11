// =====================================================================
// identity-rules.js - what a member has earned the right to say.
// ---------------------------------------------------------------------
// The decision logic behind the identity picker, deliberately kept out of
// a file that talks to Supabase - the same reason broadcast-order.js and
// ticker-lines.js exist. profile-identity.js imports these and does the
// rendering and the writing; this file is pure and has a spec.
//
// THE ONE RULE THAT MATTERS: a championship is claimed in the title and
// nowhere else. titleChoices() owns every phrasing of a ring, including
// the count. achievementChoices() will not emit one at all. Before this
// split a two-time winner could pick "DFL Champion" as their title AND
// "2x DFL Champion" as their featured achievement and say the same thing
// twice in a four-word byline.
// =====================================================================

const count = (value) => Array.isArray(value) ? value.length : Number(value) || 0;
const unique = (items) => [...new Set(items.filter(Boolean))];

/*
  THE ACCENT PALETTE IS A LIST, NOT A COLOUR WHEEL. A free <input
  type=color> lets somebody pick #111 on a dark card or #fff on a light one
  and make their own byline invisible. Every swatch here reads on both
  themes, and the database validates the format besides.
*/
export const ACCENTS = [
  "#C8102E", "#E5011B", "#FF7A45", "#EFC94C", "#2FBF5F",
  "#22C7A9", "#4AA3FF", "#0057D9", "#A06BE0", "#F06FA8",
  "#8B98AB", "#F4F2EE",
];
export const DEFAULT_ACCENT = "#8B98AB";

/** The member's chosen accent, validated, with a readable fallback. */
export function accentOf(member) {
  const raw = String(member?.accent_color || "").trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : DEFAULT_ACCENT;
}

/**
 * Is this title a championship? Decides who gets the gold treatment.
 *
 * Matched on the word rather than an exact list, so "3x DFL Champion",
 * "Multi-Time Champion" and a plain "DFL Champion" all qualify while
 * "DFL Finalist" and "Playoff Regular" - neither of which is a ring - do
 * not. titleChoices() is the only thing that mints these strings.
 */
export function isChampionTitle(title) {
  return /champion/i.test(String(title || ""));
}

/** 1 -> "1st", 12 -> "12th", 23 -> "23rd". */
export function ordinalPlace(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  const r = v % 100;
  if (r >= 11 && r <= 13) return `${v}th`;
  return v + (["th", "st", "nd", "rd"][v % 10] || "th");
}

/**
 * Titles the member has earned. THE ONLY PLACE A RING IS CLAIMED.
 *
 * The count belongs to the title, so a multiple winner picks the number
 * rather than describing it. "DFL Champion" stays on offer at any count -
 * somebody with four rings may still prefer the plain one.
 */
export function titleChoices(member, career, extremes, chipSeasons = []) {
  const out = [];
  const titles = Math.max(count(career?.titles), Number(member?.championships) || 0);
  const runnerUps = Math.max(count(career?.runnerUps), count(career?.seconds));
  const playoffs = count(career?.playoffs ?? career?.total?.playoffs);

  if (titles >= 1) out.push("DFL Champion");
  if (titles >= 2) out.push(`${titles}× DFL Champion`);
  if (titles >= 2) out.push("Multi-Time Champion");

  if (runnerUps >= 1) out.push("DFL Finalist");
  if (playoffs >= 1) out.push("Playoff Regular");
  if (Number(extremes?.streak?.win?.run) >= 5) out.push("Certified Heater");
  if (chipSeasons.length) out.push("Chip Eater Survivor");
  if (Number(member?.joined_year) && Number(member.joined_year) <= 2019) out.push("DFL Original");
  return unique(out);
}

/**
 * Featured achievements: the small, specific ones.
 *
 * Not "I won" - the title says that. These are the lines with a number in
 * them: where you finished, what you scored, how long you ran hot. Phrased
 * as facts rather than boasts, because they sit next to the title and two
 * boasts in a row is just noise.
 */
export function achievementChoices(career, extremes, chipSeasons = []) {
  const out = [];
  const playoffs = count(career?.playoffs ?? career?.total?.playoffs);
  const runnerUps = Math.max(count(career?.runnerUps), count(career?.seconds));

  /* Deliberately NO championship line. See titleChoices() above. */
  if (runnerUps) out.push(`Runner-up ×${runnerUps}`);
  if (playoffs) out.push(`${playoffs} playoff berth${playoffs === 1 ? "" : "s"}`);
  if (extremes?.bestSeason?.rank) out.push(`Best finish ${ordinalPlace(extremes.bestSeason.rank)}`);
  if (extremes?.highWeek?.score) out.push(`High week ${Number(extremes.highWeek.score).toFixed(1)} pts`);
  if (Number(extremes?.streak?.win?.run) > 1) out.push(`${extremes.streak.win.run}-game win streak`);
  if (chipSeasons.length) {
    /* Seasons joined with a comma, never the glyph the byline uses as its
       own separator - that read as two achievements rather than one. */
    out.push(`Ate the chip ${chipSeasons.join(", ")}`);
  }
  return unique(out);
}

/**
 * The achievement options to actually render in the picker.
 *
 * TWO THINGS THE GENERATED LIST CANNOT KNOW ABOUT.
 *
 * A value saved under an older release may no longer be generated - "4
 * playoff trips" became "4 playoff berths" in this pass. Left alone, the
 * select would show "None" for a member who had definitely chosen
 * something, and the next save would quietly throw it away. So a stored
 * value that is still absent is kept as an option.
 *
 * The exception is a championship. Older releases DID offer "2x DFL
 * Champion" as a featured achievement; the title owns every ring now, so a
 * legacy value like that is dropped rather than preserved. Keeping it would
 * reintroduce exactly the duplicate claim this pass removed.
 */
export function achievementOptions(member, career, extremes, chipSeasons = []) {
  const generated = achievementChoices(career, extremes, chipSeasons);
  const stored = String(member?.featured_achievement || "").trim();
  if (!stored || isChampionTitle(stored)) return generated;
  return generated.includes(stored) ? generated : [stored, ...generated];
}

/**
 * The featured achievement as it should be DISPLAYED.
 *
 * Returns "" for a legacy championship value, so the rule holds for data
 * already in the database and not just for new choices. A member who saved
 * "2x DFL Champion" as an achievement before this release keeps it in the
 * column but stops rendering it in two places at once.
 */
export function displayAchievement(member) {
  const stored = String(member?.featured_achievement || "").trim();
  return stored && !isChampionTitle(stored) ? stored : "";
}

/**
 * HOW MANY TROPHIES A TITLE IS WORTH.
 *
 * The title is the claim, so the title is read first: "3× DFL Champion"
 * says three whatever the member row holds. A plain "DFL Champion" falls
 * back to the championships column, because somebody with two rings who
 * prefers the unnumbered title has still won twice and the card should
 * show it.
 *
 * Capped, because a run of identical glyphs stops being a count and starts
 * being a texture - and the pill has a title to fit as well.
 */
export const MAX_RINGS = 5;
export function ringCount(member) {
  const title = String(member?.profile_title || "");
  if (!isChampionTitle(title)) return 0;
  const stated = title.match(/(\d+)\s*(?:×|x)/i);
  const n = stated ? Number(stated[1]) : Math.max(1, Number(member?.championships) || 0);
  return Math.min(Math.max(n, 1), MAX_RINGS);
}

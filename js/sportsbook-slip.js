// =====================================================================
// sportsbook-slip.js - what an entry costs and what it pays
// ---------------------------------------------------------------------
// Kept separate from the page for one reason: these four functions have to
// agree with sportsbook_entries_schema.sql to the SIN, and that is only
// checkable if they can be tested without a database or a DOM.
//
// WHY THE PRICE GOES THROUGH A WHOLE AMERICAN NUMBER
//
// A parlay's natural price is the product of its legs' decimal odds, and the
// natural payout is stake x that product. Doing it that way would mean this
// file reproducing Postgres numeric arithmetic in IEEE doubles, which it
// cannot, so the preview and the placed ticket would disagree by a SIN now
// and then - on the one screen in the app where a number being off by one is
// the whole complaint.
//
// So the product is rounded to six places, converted to a whole American
// number, and the payout comes off THAT with the same floor rule singles have
// always used. Both halves round the same value at the same place, and a
// one-pick entry prices exactly like a straight bet always did.
// =====================================================================

/** Keep the preview's integer rounding aligned with sportsbook_place_entry. */
export function parseStake(value, balance) {
  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const stake = Number(text);
  return Number.isSafeInteger(stake) && stake <= balance ? stake : null;
}

/** American to decimal. -150 -> 1.6667, +150 -> 2.5. */
export function decimalOdds(odds) {
  if (!Number.isInteger(odds) || Math.abs(odds) < 100) return null;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

/**
 * The combined American price of a set of legs. Mirrors
 * public.sportsbook_combine_odds() line for line, including the round(6).
 */
export function combineOdds(oddsList) {
  if (!Array.isArray(oddsList) || !oddsList.length) return null;
  let product = 1;
  for (const odds of oddsList) {
    const decimal = decimalOdds(odds);
    if (decimal === null) return null;
    product *= decimal;
  }
  product = Math.round(product * 1e6) / 1e6;
  const edge = product - 1;
  if (edge <= 0) return 100;
  if (product >= 2) return Math.max(100, Math.round(edge * 100));
  /* Under +100 the price is a favourite, which American odds write as a
     negative. Math.round is only ever handed a positive here, so it rounds
     the same way Postgres round() does. */
  return Math.min(-100, -Math.round(100 / edge));
}

/** What one whole American price returns on a stake, stake included. */
export function estimatedReturn(stake, odds) {
  if (!Number.isSafeInteger(stake) || stake < 1 || !Number.isInteger(odds) || Math.abs(odds) < 100) return null;
  const payout = stake + Math.floor(odds > 0 ? stake * odds / 100 : stake * 100 / Math.abs(odds));
  return Number.isSafeInteger(payout) ? payout : null;
}

/** The whole entry: combine the legs, then price the stake against them. */
export function entryReturn(stake, oddsList) {
  const combined = combineOdds(oddsList);
  return combined === null ? null : estimatedReturn(stake, combined);
}

/** Six is the ceiling, and it is the database's ceiling too. */
export const MAX_PICKS = 6;

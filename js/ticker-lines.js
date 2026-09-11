// =====================================================================
// ticker-lines.js - the hand-written half of the bottom ticker.
// ---------------------------------------------------------------------
// PURE, and separate from bottomline.js for the reason that keeps recurring:
// bottomline.js imports the database, the database pulls its client from a CDN
// over https, and the ESM test loader refuses that - so nothing importing it can
// be specced. This is the third module extracted for that reason
// (activity.js, form-layout.js), and the rule is now plain: logic worth testing
// does not live in a file that talks to Supabase.
// =====================================================================

/**
 * Turn ticker_items rows into ticker items.
 *
 * MANUAL LINES GO IN FRONT of the derived ones, and that ordering is the point
 * rather than a detail. Everything else in the ticker is the app NOTICING
 * something - a fixture, a poll, a champion. A line somebody typed is the league
 * SAYING something, and a reminder about Thursday's draw that queued behind the
 * reigning champion would be a reminder nobody read. The caller puts these
 * first; this function keeps them in weight order as the query returned them.
 *
 * The showing window is applied HERE rather than in SQL, so a row starting in
 * the future is simply skipped instead of needing two more query parameters and
 * a second ordering - and so the rule has one home rather than being half in a
 * query and half in a filter.
 *
 * @param {Array} rows   from ticker_items
 * @param {number} [now] injectable, so the window is testable
 */
export function manualTickerItems(rows, now = Date.now()) {
  const inWindow = (r) => {
    const from = r.starts_at ? Date.parse(r.starts_at) : null;
    const until = r.ends_at ? Date.parse(r.ends_at) : null;
    /* Number.isFinite rather than a truthiness check: an unparseable date is
       not a bound, and treating it as one would hide a line for ever over a
       typo. */
    if (Number.isFinite(from) && now < from) return false;
    if (Number.isFinite(until) && now > until) return false;
    return true;
  };
  return (rows || [])
    .filter((r) => r && r.text && r.active !== false && inWindow(r))
    .map((r) => ({
      label: r.label || "DFL",
      text: r.text,
      /* A route NAME, never a URL - the same contract the derived items use, so
         a typed value cannot become a link out of the app. */
      ...(r.route ? { route: r.route } : {}),
    }));
}

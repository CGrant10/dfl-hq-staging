// =====================================================================
// sleeper-bracket.js - reading placements out of a Sleeper playoff bracket.
// ---------------------------------------------------------------------
// Pure, and separate from sync.js on purpose: sync.js imports the database, so
// nothing in it can be spec'd. A bracket parser is exactly the sort of thing
// that should have tests - it is a guess about somebody else's data format, and
// the failure mode is a wrong name carved into league history.
//
// SLEEPER'S SHAPE. Both brackets are a flat list of games:
//
//   { r: round, m: match, t1, t2, w: winner_roster, l: loser_roster, p?: place }
//
// `p` appears on the games that DECIDE a placement, and it is scoped to ITS OWN
// bracket. In the winners bracket p:1 is the championship. In the losers bracket
// p:1 is the CONSOLATION final - a placement within the toilet bowl, not an
// overall finish - so its winner is last in the league. Reading losers-bracket
// `p` as an overall placement is the mistake this file exists to have already
// made. Not every league configures placement games, so nothing here assumes
// `p` exists.
// =====================================================================

/**
 * Champion and runner-up from the WINNERS bracket.
 *
 * The championship game is the one marked p:1; fall back to the final round
 * when a league has not configured placement games.
 */
export function readWinners(bracket) {
  if (!bracket?.length) return { championRoster: null, runnerUpRoster: null };

  let final = bracket.find((g) => g.p === 1);
  if (!final) {
    const lastRound = Math.max(...bracket.map((g) => g.r || 0));
    final = bracket.find((g) => g.r === lastRound);
  }
  if (!final || final.w == null) return { championRoster: null, runnerUpRoster: null };

  return { championRoster: final.w, runnerUpRoster: final.l ?? null };
}

/**
 * The Chip Eater: dead last, from the LOSERS bracket.
 *
 * IT IS THE WINNER OF THE p:1 GAME, AND THAT IS NOT A TYPO.
 *
 * Sleeper's losers bracket is a toilet bowl. Its `p` numbers are placements
 * WITHIN that bracket, not overall finishes - so `p:1` is the consolation
 * final, and winning the consolation final is how you end up last in the
 * league. Advancing through this bracket is the punishment.
 *
 * I got this wrong twice before settling it against the real league:
 *
 *   1. sleeper_standings.rank      worst regular-season record. That is the
 *                                  table going INTO the playoffs.
 *   2. loser of the highest `p`    read the bracket as if `p` were an overall
 *                                  placement and last place were a game you
 *                                  lose. Scored 0 out of 4.
 *
 * Checked against DFL 2022-2025, whose Chip Eaters the commissioner supplied
 * independently. The p:1 winner is right in all four; the fixtures in
 * sleeper-bracket.spec.js are those four brackets, verbatim from the API.
 *
 * FALLBACK, and its limit. With no `p` at all this takes the winner of the
 * deepest round, and only when that round holds exactly one game - two tied
 * for deepest and which one decides last place is not knowable, so it
 * declines. Every DFL season on record carries `p:1`, so that path is
 * reasoning rather than something the league has exercised. It returns null
 * rather than guessing, and a season with no answer shows no Chip Eater -
 * which is what the commissioner's "Correct season" override is for.
 */
export function readLastPlace(bracket) {
  if (!Array.isArray(bracket) || !bracket.length) return null;

  /* The consolation final. Its WINNER is last in the league. */
  const decider = bracket.find((g) => Number(g?.p) === 1)
    ?? (() => {
      const lastRound = Math.max(...bracket.map((g) => Number(g?.r) || 0));
      const finals = bracket.filter((g) => (Number(g?.r) || 0) === lastRound);
      return finals.length === 1 ? finals[0] : null;
    })();

  /* An unplayed game has no winner. Reporting a Chip Eater from a bracket that
     has not finished is how a placeholder becomes permanent. */
  const worst = decider?.w;
  return worst == null ? null : worst;
}

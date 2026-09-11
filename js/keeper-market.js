// =====================================================================
// keeper-market.js - what the upcoming draft is expected to cost
// ---------------------------------------------------------------------
// THE FINDING THAT SHAPED THIS FILE
//
// The keeper brief named FantasyPros as the preferred external provider, with
// a Supabase Edge Function to hold the API key. Before building that, the
// question it told us to ask first was whether Sleeper already publishes a
// usable ADP feed. IT DOES:
//
//   https://api.sleeper.app/projections/nfl/2026?season_type=regular
//                                              &order_by=adp_ppr
//                                              &position[]=QB&position[]=RB…
//
//   * one row per player, keyed on player_id - THE SLEEPER ID, so the mapping
//     problem the brief warned about does not exist here. No name matching,
//     no suffix ambiguity, no unresolved rows.
//   * adp_std, adp_half_ppr, adp_ppr, plus dynasty and 2QB variants, so the
//     league's own scoring format decides which number is read.
//   * last_modified / updated_at per row, which is what the card's freshness
//     line is built from.
//   * position[] filtering cuts an 8.6MB payload to 2.9MB.
//   * no key, no login, no server, no secret to leak. Same provider the app
//     already trusts for rosters, drafts and identity.
//
// So there is NO FantasyPros integration and no credential anywhere in this
// app - not in the bundle, not in a log, not in an Edge Function. The seam
// below is provider-shaped rather than Sleeper-shaped, so if this feed ever
// goes away a FantasyPros adapter is one function returning the same objects,
// and resolveProviderPlayer() is already here for the day a provider arrives
// with names instead of Sleeper ids.
//
// WHAT IS NORMALISED AWAY
//
// Nothing downstream sees `adp_ppr`, `last_modified` or `week_shard`. The
// Advisor consumes:
//
//   { playerId, rank, positionRank, adp, projectedRound,
//     source, scoringFormat, updatedAt }
//
// and that is the whole contract.
// =====================================================================

import { isAdvisorPosition } from "./dfl-scoring.js";

/** Sleeper marks a player it has no ADP for with a sentinel, not a null. */
const NO_ADP = 900;

/** How old a market read has to be before the card calls it stale. */
export const STALE_AFTER_DAYS = 4;

/**
 * ADP -> the round of THIS league's draft a player is expected to go in.
 *
 * ADP 1-12 is round 1 in a twelve-team league, 13-24 is round 2, and so on -
 * so it is a ceiling division by the actual league size. The league size is
 * required rather than defaulted: a twelve-team assumption applied to a
 * ten-team league is wrong by a round at the top of the board and by three at
 * the bottom, silently.
 *
 * The result is APPROXIMATE and the UI says so. It is an average draft
 * position turned into a round, not a prediction of where this league's
 * twelve managers will actually take somebody.
 */
export function expectedRound(adp, leagueSize) {
  const pick = Number(adp);
  const size = Number(leagueSize);
  if (!Number.isFinite(pick) || pick <= 0) return null;
  if (!Number.isFinite(size) || size < 2) return null;
  return Math.ceil(pick / size);
}

/**
 * THE VALUE OF A KEEPER, IN ROUNDS.
 *
 * The comparison the whole Advisor turns on: what the keeper costs against
 * what the upcoming draft is expected to cost.
 *
 *   keeper R7, expected R2  ->  +5   five rounds of value
 *   keeper R4, expected R4  ->   0   you are paying the market
 *   keeper R3, expected R7  ->  -4   the keeper is the expensive option
 *
 * Positive is better and larger is better. Null when either side is unknown,
 * which is a state the card has to draw rather than a zero.
 */
export function roundValue(keeperRound, expectedDraftRound) {
  /* Number(null) is 0, so an unknown side would come out as a confident
     "-2 rounds of value". Unknown is tested before coercion. */
  const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
  const keep = num(keeperRound);
  const market = num(expectedDraftRound);
  if (!Number.isFinite(keep) || !Number.isFinite(market)) return null;
  return keep - market;
}

/** +5 / 0 / -4, written the way it is printed. */
export function formatRoundValue(value) {
  if (value == null) return null;
  if (value === 0) return "0 rounds";
  const rounds = Math.abs(value) === 1 ? "round" : "rounds";
  return `${value > 0 ? "+" : "−"}${Math.abs(value)} ${rounds}`;
}

/**
 * Sleeper's projection rows -> the normalised market model.
 *
 * @param {Object[]} rows          raw rows from the projections endpoint
 * @param {Object} input
 * @param {number} input.leagueSize      this league's team count
 * @param {string} input.scoringFormat   "ppr" | "half_ppr" | "std"
 * @param {number} [input.season]        the market season, for the label
 * @returns {Array<{playerId:string, rank:number, positionRank:number,
 *                  adp:number, projectedRound:number|null, position:string,
 *                  source:string, scoringFormat:string, updatedAt:string|null}>}
 */
export function normalizeSleeperMarket(rows = [], { leagueSize, scoringFormat = "ppr",
                                                    season = null } = {}) {
  const key = `adp_${scoringFormat}`;
  const source = season ? `Sleeper ADP · ${season}` : "Sleeper ADP";

  const usable = [];
  for (const row of rows || []) {
    if (!row || row.player_id == null) continue;
    const position = String(row.player?.position || "").toUpperCase();
    /* The Advisor never evaluates a kicker or a defence, so there is no
       reason to carry one through the market model either - and leaving them
       out is what makes positionRank below mean something. */
    if (!isAdvisorPosition(position)) continue;
    const adp = Number(row.stats?.[key]);
    if (!Number.isFinite(adp) || adp <= 0 || adp >= NO_ADP) continue;
    const stamp = Number(row.last_modified ?? row.updated_at);
    usable.push({
      playerId: String(row.player_id), position, adp,
      updatedMs: Number.isFinite(stamp) ? stamp : null,
    });
  }

  usable.sort((a, b) => a.adp - b.adp || a.playerId.localeCompare(b.playerId));

  const positionSeen = new Map();
  return usable.map((entry, i) => {
    const seen = (positionSeen.get(entry.position) || 0) + 1;
    positionSeen.set(entry.position, seen);
    return {
      playerId: entry.playerId,
      rank: i + 1,
      positionRank: seen,
      adp: entry.adp,
      projectedRound: expectedRound(entry.adp, leagueSize),
      position: entry.position,
      source,
      scoringFormat,
      updatedAt: entry.updatedMs ? new Date(entry.updatedMs).toISOString() : null,
    };
  });
}

/**
 * How old the market read is, and whether to say so.
 *
 * ADP moves every day through August. A number from three weeks ago is not
 * wrong exactly, but presenting it as the current market is - so the card
 * carries the date and, past STALE_AFTER_DAYS, says it is stale rather than
 * hoping nobody checks.
 *
 * `now` is a parameter because a clock in a pure function is untestable.
 */
export function marketFreshness(updatedAt, { now = Date.now(),
                                             staleAfterDays = STALE_AFTER_DAYS } = {}) {
  const stamp = updatedAt ? Date.parse(updatedAt) : NaN;
  if (!Number.isFinite(stamp)) {
    return { updatedAt: null, ageDays: null, stale: false, unknown: true, label: null };
  }
  const ageDays = Math.floor((Number(now) - stamp) / 86400000);
  const when = new Date(stamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return {
    updatedAt, ageDays, unknown: false,
    stale: ageDays >= staleAfterDays,
    label: ageDays >= staleAfterDays ? `Updated ${when} · may be stale` : `Updated ${when}`,
  };
}

// ------------------------- provider id mapping -------------------------
/*
  NOT NEEDED BY SLEEPER, AND HERE ANYWAY.

  The Sleeper feed above already carries Sleeper player ids, so every row
  resolves exactly and nothing below runs in production today. It exists
  because the brief was specific about what a name-keyed provider must and
  must not do, and because building it after a provider arrives means building
  it in a hurry:

    * an explicit cross-reference id WINS, always
    * a name match must be exact after normalisation, and must agree on
      position
    * two candidates matching equally well is AMBIGUOUS, and ambiguous is
      left UNRESOLVED rather than guessed - a keeper valued off the wrong
      Kenneth Walker is worse than a keeper with no market line at all
*/

/**
 * Normalise a player name for comparison: case, punctuation and the generational
 * suffix all removed, because providers disagree about every one of them.
 */
export function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // Jose with an accent -> jose
    .replace(/[.'’`]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build the lookup a name-keyed provider would need, from the Sleeper map.
 *
 * Keyed on normalised name + position, and a key that more than one Sleeper id
 * answers to is recorded as ambiguous so it can be refused rather than
 * resolved to whichever one was seen first.
 *
 * @param {Object<string, {n:string, p:string, t:string}>} players
 */
export function playerIndex(players = {}) {
  const byNamePos = new Map();
  for (const [id, meta] of Object.entries(players || {})) {
    const name = normalizeName(meta?.n);
    if (!name) continue;
    const position = String(meta?.p || "").toUpperCase();
    const key = `${name}|${position}`;
    if (!byNamePos.has(key)) byNamePos.set(key, []);
    byNamePos.get(key).push(String(id));
  }
  return byNamePos;
}

/**
 * Resolve one provider row to a Sleeper player id.
 *
 * @param {Object} row              a provider row
 * @param {Map} index              from playerIndex()
 * @returns {{playerId:string|null, how:"provider-id"|"name"|null, reason:string}}
 */
export function resolveProviderPlayer(row, index) {
  const explicit = row?.sleeper_id ?? row?.sleeper_player_id ?? row?.player_id;
  if (explicit != null && String(explicit).trim() !== "") {
    return { playerId: String(explicit), how: "provider-id",
             reason: "Matched on the provider's Sleeper id" };
  }

  const name = normalizeName(row?.name ?? `${row?.first_name || ""} ${row?.last_name || ""}`);
  const position = String(row?.position || "").toUpperCase();
  if (!name || !position) {
    return { playerId: null, how: null, reason: "No id, and no name and position to match on" };
  }

  const hits = index?.get?.(`${name}|${position}`) || [];
  if (hits.length === 1) {
    return { playerId: hits[0], how: "name", reason: "Matched on an exact name and position" };
  }
  if (hits.length > 1) {
    return { playerId: null, how: null,
             reason: `Ambiguous — ${hits.length} ${position}s share that name; left unresolved` };
  }
  return { playerId: null, how: null, reason: "No Sleeper player with that name and position" };
}

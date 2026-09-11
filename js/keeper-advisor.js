// =====================================================================
// keeper-advisor.js - which keeper is actually worth keeping
// ---------------------------------------------------------------------
// WHAT CHANGED, AND WHY THE OLD HEADER HAD TO GO
//
// Until now this file could not answer "who is the best keeper" and said so
// at length: there was no market price to compare a cost against and no
// measure of how good anybody was, so every label was a bare fact ("drafted
// round 12 in 2025") and the ordering was "cheapest cost first". That made
// the advice systematically wrong in one direction - a 14th-round scrub with
// a cheap keeper price outranked an elite player - because cheap is not the
// same as valuable.
//
// Two of those gaps are now closed with real data, from the provider the app
// already trusts:
//
//   PRODUCTION   Sleeper's season stats, scored with the DFL's OWN
//                scoring_settings - see dfl-scoring.js, which reproduces the
//                league's real week-1 2025 matchup scores to the cent. Not
//                pts_ppr, which is a different scoring system with the same
//                name.
//   MARKET       Sleeper's ADP feed for the upcoming season, keyed on Sleeper
//                player ids - see keeper-market.js. No key, no scraping, no
//                secret, no server.
//
// THE THREE SEASONS, AND NOT MIXING THEM UP
//
// Every number on this card belongs to a specific season, and for a 2026
// decision they are not all the same season:
//
//   2025  production        what the player actually did
//   2025  draft basis       the round this league drafted them in
//   2026  market            what the upcoming draft is expected to cost
//   2026  keeper cost       what the rules charge, from the 2025 basis
//
// decisionContext() in keeper-rules.js is the only place those offsets are
// written down, and everything here takes them from it. The UI labels every
// figure with its season, because "R8" with no year on it is exactly the
// ambiguity that let the wrong-basis bug survive a release.
//
// FOUR POSITIONS, AND NO OTHERS
//
// QB, RB, WR and TE. A kicker or a team defence is never evaluated, ranked,
// badged, compared or mentioned - see isAdvisorPosition(). The
// commissioner's entry sheet is a data-entry tool and still lists them;
// an advisor recommending a keeper kicker is noise dressed as advice.
//
// NO BLACK-BOX SCORE
//
// Nothing here prints "Keeper Score 94". The ordering does use a weighted sum
// internally - a list has to have an order - but every component of it is
// shown on the card as its own fact with its own season, so a reader can
// disagree with the ranking for a stated reason. See rankCandidates().
// =====================================================================

import { decisionContext, evaluate, priorSeasonDraftRound,
         priorKeeperSeasons, KEEPER_ROUND_FLOOR } from "./keeper-rules.js";
import { ADVISOR_POSITIONS, isAdvisorPosition } from "./dfl-scoring.js";
import { formatRoundValue, marketFreshness, roundValue } from "./keeper-market.js";

/**
 * @typedef {Object} MarketValue    normalised in keeper-market.js
 * @property {string} playerId
 * @property {number} [rank]            overall ADP rank, 1 = first off the board
 * @property {number} [positionRank]    rank within the position
 * @property {number} [adp]             average draft position
 * @property {number} [projectedRound]  the round this league would spend
 * @property {string} source            who said so
 * @property {string} scoringFormat     which scoring the ADP is for
 * @property {string} updatedAt         ISO date, so the UI can show its age
 */

/**
 * Wrap normalised market rows in the shape the Advisor consumes.
 *
 * Provider-agnostic on purpose: this takes the objects keeper-market.js
 * produces and nothing in here or in any view knows the word "Sleeper".
 */
export function marketFrom(rows = [], { now = Date.now() } = {}) {
  const byId = new Map();
  for (const r of rows) {
    if (r && r.playerId != null) byId.set(String(r.playerId), r);
  }
  const first = rows[0] || null;
  return {
    available: byId.size > 0,
    /** @returns {MarketValue|null} */
    get: (playerId) => byId.get(String(playerId)) || null,
    source: first?.source || null,
    scoringFormat: first?.scoringFormat || null,
    updatedAt: first?.updatedAt || null,
    freshness: marketFreshness(first?.updatedAt || null, { now }),
    size: byId.size,
  };
}

/** The empty market: what the advisor falls back to when the feed is down. */
export const NO_MARKET = marketFrom([]);

/** The empty production set, for the same reason. */
export const NO_PRODUCTION = new Map();

/*
  THE FOUR CLASSES.

  KNOWN      the rules priced this keeper for this season
  NO_COST    a basis round exists but the rules produced no cost (no rules
             configured, most likely)
  NO_ROUND   no draft record in the season the basis comes from - the
             commissioner supplies the round
  UNKNOWN    the player id is not in the Sleeper player map at all
*/
export const CLASS = {
  KNOWN:    "cost-known",
  NO_COST:  "cost-unknown",
  NO_ROUND: "no-prior-round",
  UNKNOWN:  "unknown-player",
};

/*
  WHAT COUNTS AS A STRONG SEASON, BY POSITION.

  A points total cannot be compared across positions and a positional finish
  can: RB24 is a startable running back in a twelve-team league and QB24 is
  not a startable quarterback anywhere. These cutoffs are roughly "a player
  you would start", which is the honest threshold for calling production
  strong, and they are stated here rather than buried in a comparison so they
  can be argued with and tested.

  One starting quarterback and one tight end per team, two or three running
  backs and three or four receivers - twelve teams.
*/
export const STRONG_FINISH = { QB: 12, RB: 24, WR: 30, TE: 12 };

/*
  Number(null) is 0 and Number("") is 0, and 0 is inside every cutoff - so a
  player with NO production would have read as a strong season, and a missing
  stat line would have earned a "safe choice". Unknown is tested before
  coercion, which is the same trap evaluate() documents for draft rounds.
*/
function rankOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** Was this a season worth keeping a player for, at their position? */
export function isStrongFinish(position, positionRank) {
  const cutoff = STRONG_FINISH[String(position || "").toUpperCase()];
  const rank = rankOf(positionRank);
  if (!cutoff || rank == null) return false;
  return rank <= cutoff;
}

/**
 * Every EVALUATED player on the roster, with what is known about each.
 *
 * Kickers and defences are dropped here, at the front door, so nothing
 * downstream - ranking, badges, counts, comparison - can reintroduce one.
 *
 * @param {Object}   input
 * @param {string[]} input.playerIds        sleeper_rosters.players
 * @param {Object}   input.players          the Sleeper player map, {id:{n,p,t}}
 * @param {Object[]} input.draftPicks       sleeper_draft_picks rows
 * @param {string}   input.sleeperUserId    whose roster this is
 * @param {Object|null} input.rules         a validated rule set (keeper-rules.js)
 * @param {number}   input.targetSeason     the season being decided
 * @param {Object[]} [input.keeperRows]     existing keeper rows, for tenure
 * @param {number|string} [input.memberId]  whose keeper history to count
 * @param {Object}   [input.market]         from marketFrom()
 * @param {Map}      [input.production]     from positionalFinish()/seasonTotals()
 */
export function candidates({ playerIds = [], players = {}, draftPicks = [],
                             sleeperUserId = null, rules = null, targetSeason = null,
                             keeperRows = [], memberId = null,
                             market = NO_MARKET, production = NO_PRODUCTION }) {
  const ctx = decisionContext(targetSeason);

  return playerIds.map(String).filter((id) => {
    /*
      An id the player map does not recognise cannot be positionally filtered,
      so it is kept and classified as unknown - hiding it would mean a roster
      slot silently vanished. Everything the map DOES recognise must be one of
      the four positions.
    */
    const meta = players[id];
    return !meta || isAdvisorPosition(meta.p);
  }).map((id) => {
    const meta = players[id] || null;
    const value = market.get(id);
    const prod = production.get?.(id) || null;

    const name = meta?.n || null;
    const position = meta?.p || "";
    const nflTeam = meta?.t || "";

    /*
      A retired or released player still sits in a roster row until the next
      sync, and the Sleeper map marks them FA rather than dropping them. That
      is worth saying out loud on the card - it is exactly the player somebody
      would otherwise waste their keeper on.
    */
    const freeAgent = meta ? (!nflTeam || nflTeam === "FA") : false;

    /*
      THE BASIS: the round this league drafted them in the season before the
      one being decided. Not their earliest pick, not their most recent pick -
      that season's pick, or nothing. See priorSeasonDraftRound().
    */
    const basis = priorSeasonDraftRound(draftPicks, id, { targetSeason });
    /* Who spent that pick. Compared on Sleeper user ids, never on a name. */
    const basisPick = draftPicks.find((p) => p && String(p.player_id) === id
      && Number(p.season) === ctx.draftBasisSeason) || null;
    const draftedByMe = basisPick && sleeperUserId != null
      ? String(basisPick.sleeper_user_id) === String(sleeperUserId)
      : null;

    const prior = priorKeeperSeasons(keeperRows, {
      playerId: id, memberId, beforeSeason: targetSeason });
    const standing = evaluate({ config: rules, targetSeason,
                                basisRound: basis.round, basisSeason: basis.season,
                                priorKeeperSeasons: prior });

    let klass;
    if (!meta) klass = CLASS.UNKNOWN;
    else if (standing.state === "eligible") klass = CLASS.KNOWN;
    else if (basis.round == null) klass = CLASS.NO_ROUND;
    else klass = CLASS.NO_COST;

    const expected = value?.projectedRound ?? null;
    const rounds = roundValue(standing.calculatedRound, expected);

    return {
      playerId: id, name, position, nflTeam, freeAgent,
      /* The keeper basis, and the season it came from. */
      basisRound: basis.round, basisSeason: basis.season,
      basisFound: basis.found, basisReason: basis.reason,
      basisOtherSeasons: basis.otherSeasons,
      draftedByMe, draftPickNo: basisPick ? Number(basisPick.pick_no) : null,
      priorKeeperSeasons: prior,
      class: klass,
      keeperCost: standing.calculatedRound,
      keeperYear: standing.keeperYear,
      maxKeeperYears: standing.maxKeeperYears,
      finalKeeperYear: standing.finalKeeperYear,
      standing: standing.state,
      standingReason: standing.reason,
      reviewNeeded: standing.reviewNeeded,
      /* Last season, scored the way this league scores. */
      productionSeason: ctx.productionSeason,
      productionPoints: prod?.points ?? null,
      productionGames: prod?.games ?? null,
      positionRank: prod?.positionRank ?? null,
      positionFinish: prod?.label ?? null,
      strongProduction: isStrongFinish(position, prod?.positionRank),
      /* The upcoming draft. */
      marketSeason: ctx.marketSeason,
      marketAdp: value?.adp ?? null,
      marketRank: value?.rank ?? null,
      marketPositionRank: value?.positionRank ?? null,
      marketProjectedRound: expected,
      strongMarket: isStrongFinish(position, value?.positionRank),
      /* The comparison the whole card turns on. */
      roundValue: rounds,
      roundValueLabel: formatRoundValue(rounds),
      /*
        AT THE FLOOR, the keeper costs as little as the rules permit. Bijan
        Robinson went R1 in 2025, so he keeps at R1 and the market has him in
        round 1 too - a round value of zero. Calling that "poor value" is a
        criticism of the floor rule, not of the pick, and it is exactly wrong
        about the best player on the roster. Recorded here so badgesFor() can
        refuse to say it.
      */
      /* At the cheapest a keeper can ever be. The floor is a constant now, so
         this no longer depends on a rules row being present to be knowable. */
      atFloor: standing.calculatedRound != null
        && standing.calculatedRound <= KEEPER_ROUND_FLOOR,
    };
  });
}

/*
  WHAT THE DATA SUPPORTS SAYING - the four levels from the brief.

  The card must never blank itself and must never claim more than it can back.
  So the level is computed from what actually arrived, and the labels below are
  gated on it: "Best value" needs a market price to be a discount against, and
  "safe choice" needs to know the player is good.

    full            production + market + priced keepers
    no-market       production and keeper facts; no discount claims
    no-production   market and keeper facts; no quality claims
    facts-only      keeper facts alone, which is where v1.107.0 lived
*/
export function dataLevel(list = [], market = NO_MARKET) {
  const hasProduction = list.some((c) => c.productionPoints != null);
  const hasMarket = market.available
    && list.some((c) => c.marketProjectedRound != null);
  if (hasProduction && hasMarket) return { level: 1, name: "full", hasProduction, hasMarket };
  if (hasProduction)              return { level: 2, name: "no-market", hasProduction, hasMarket };
  if (hasMarket)                  return { level: 3, name: "no-production", hasProduction, hasMarket };
  return { level: 4, name: "facts-only", hasProduction, hasMarket };
}

/*
  HOW THE LIST IS ORDERED.

  Groups first, because a player who cannot be kept does not belong above one
  who can:

    0  eligible and priced
    1  needs review (the commissioner can supply the round)
    2  an id the player map does not recognise
    3  proven ineligible - a settled answer, listed last and never hidden

  Within the eligible group the order is a weighted sum of the three things the
  card prints, and nothing else:

    round value   4 points per round saved against the expected market round.
                  Weighted highest because it is the actual keeper question,
                  and it is what a manager is trading.
    production    how good last season was, as distance inside the positional
                  starter cutoff. RB4 scores more than RB18 by twenty.
    market        the same measure applied to where the upcoming draft has
                  them, so a player the market has cooled on is not carried
                  by one good year.

  It is deliberately NOT shown as a number. Every term is on the card as its
  own fact with its own season, so "why is he above him" always has an answer
  a reader can check - which a "94" never does. The weights are the argument;
  they are here, in one place, in the open.

  A free agent sinks within its group: keeping somebody who is not on an NFL
  roster is almost certainly a mistake regardless of what they cost.
*/
const VALUE_PER_ROUND = 4;
const FINISH_SPAN = 24;   // the common scale every position is mapped onto

/*
  A rank inside the position's starter cutoff, mapped onto one 0-24 scale.

  The scale has to be SHARED, or the position with the deepest cutoff wins by
  arithmetic: measuring "rounds inside the cutoff" directly gave a receiver up
  to 30 points and a quarterback at most 12, so QB1 scored less than WR18.

  It also has to be PROPORTIONAL rather than capped. The first cut clamped at
  24 and every receiver from WR1 to WR7 came out identical, which quietly made
  the order of the best players on a roster alphabetical - verified live, where
  it put Amon-Ra St. Brown above Jaxon Smith-Njigba despite worse production
  AND a worse market rank.

  Outside the cutoff scores nothing rather than going negative: "worse than a
  starter" is one fact, not a scale.
*/
function finishPoints(position, rank) {
  const r = rankOf(rank);
  if (r == null) return 0;
  const cutoff = STRONG_FINISH[String(position || "").toUpperCase()] || 0;
  if (!cutoff) return 0;
  const inside = cutoff - r + 1;
  if (inside <= 0) return 0;
  return Math.round(FINISH_SPAN * (inside / cutoff));
}

/** The internal ordering weight. Exported for tests, never for display. */
export function orderingWeight(c) {
  const value = c.roundValue == null ? 0 : c.roundValue * VALUE_PER_ROUND;
  return value
    + finishPoints(c.position, c.positionRank)
    + finishPoints(c.position, c.marketPositionRank);
}

export function rankCandidates(list = []) {
  const groupOf = (c) => c.standing === "unavailable" ? 3
                       : c.class === CLASS.KNOWN ? 0
                       : c.class === CLASS.UNKNOWN ? 2 : 1;
  return [...list].sort((a, b) => {
    const g = groupOf(a) - groupOf(b);
    if (g) return g;
    if (a.freeAgent !== b.freeAgent) return a.freeAgent ? 1 : -1;
    const w = orderingWeight(b) - orderingWeight(a);
    if (w) return w;
    /* With nothing to separate them - the facts-only fallback - a later basis
       round is the more likely bargain, which is the old ordering kept as the
       last tiebreak rather than as the whole rule. */
    if (a.keeperCost != null && b.keeperCost != null && a.keeperCost !== b.keeperCost) {
      return b.keeperCost - a.keeperCost;
    }
    return String(a.name || a.playerId).localeCompare(String(b.name || b.playerId));
  });
}

/*
  THE LABELS, and the exact condition each one needs.

  Every label is gated on the data that would make it true, so a missing
  market cannot produce a "Best value" and a missing stat line cannot produce
  a "Safe choice". The criteria are constants in this file and each has a test.
*/
export const LABELS = {
  BEST_VALUE:    "BEST VALUE",
  BEST_PLAYER:   "BEST PLAYER",
  SAFE_CHOICE:   "SAFE CHOICE",
  VALUE_PLAY:    "VALUE PLAY",
  FINAL_YEAR:    "FINAL-YEAR VALUE",
  POOR_VALUE:    "POOR VALUE",
  LIMIT_REACHED: "Keeper limit reached",
  NEEDS_REVIEW:  "Needs review",
  RETURNING:     "You drafted them",
  ACQUIRED:      "Acquired, not drafted",
  NOT_ON_NFL:    "Not on an NFL roster",
  UNKNOWN_ID:    "Not in the Sleeper player list",
};

/** A discount has to be worth a sentence before it earns a value label. */
export const MIN_VALUE_ROUNDS = 2;

/**
 * Which superlatives a candidate actually holds, worked out against the rest
 * of the list rather than asserted.
 *
 * @param {object} c
 * @param {object[]} all
 */
export function badgesFor(c, all = []) {
  if (c.class === CLASS.UNKNOWN) return [LABELS.UNKNOWN_ID];

  const out = [];
  const eligible = all.filter((x) => x.standing === "eligible");
  const withValue = eligible.filter((x) => x.roundValue != null);

  /* BEST VALUE - the biggest positive discount on a player who was actually
     good. A cheap keeper on a bad player is a VALUE PLAY, not best value.
     A superlative, so exactly one candidate can hold it: the largest saving,
     and on a tie the one the ordering already prefers. */
  const valuePool = withValue.filter((x) => x.roundValue >= MIN_VALUE_ROUNDS && x.strongProduction);
  if (valuePool.length && c.playerId === bestBy(valuePool,
        (x) => -(x.roundValue * 1000 + orderingWeight(x)))) {
    out.push(LABELS.BEST_VALUE);
  }

  /* BEST PLAYER - the strongest player on the roster by what the market and
     last season say, regardless of what keeping them costs. Needs one of the
     two to exist; with neither, nobody is called the best. */
  const strengthPool = eligible.filter((x) => x.marketRank != null || x.positionRank != null);
  if (c.standing === "eligible" && strengthPool.length > 1
      && c.playerId === bestBy(strengthPool, playerStrength)) {
    out.push(LABELS.BEST_PLAYER);
  }

  /* SAFE CHOICE - good last year, still valued by the market, and not paying
     over the odds. A player already at the rules' floor counts: there is no
     cheaper price available, so "no discount" is not a mark against them.
     No superlative, so several can hold it. */
  if (c.standing === "eligible" && c.strongProduction && c.strongMarket
      && c.roundValue != null && (c.roundValue > 0 || (c.atFloor && c.roundValue >= 0))) {
    out.push(LABELS.SAFE_CHOICE);
  }

  /* VALUE PLAY - a real discount on a player last season does not vouch for. */
  if (c.standing === "eligible" && c.roundValue != null
      && c.roundValue >= MIN_VALUE_ROUNDS && !c.strongProduction) {
    out.push(LABELS.VALUE_PLAY);
  }

  /* FINAL-YEAR VALUE - worth spending the last keeper season on. */
  if (c.standing === "eligible" && c.finalKeeperYear
      && c.roundValue != null && c.roundValue > 0) {
    out.push(LABELS.FINAL_YEAR);
  }

  /*
    POOR VALUE - and it needs all three of these, because the first cut said it
    far too readily.

      1. STRICTLY worse than the market, not merely level. Paying exactly what
         the draft would cost is par, not a mistake.
      2. NOT already at the rules' floor. A first-round keeper cannot be made
         cheaper by anybody, so the label would be complaining about the rule
         rather than the decision - and it landed on Bijan Robinson, who is the
         best keeper on the roster.
      3. NOT a player LAST SEASON rates. Overpaying by a round for a top-five
         finisher is a defensible choice; overpaying for one who finished QB29
         is the thing worth flagging.

    Market strength deliberately does NOT rescue a player here. Requiring both
    measures to be weak made the label disappear from the entire league -
    including a quarterback who finished 29th at his position and still costs
    two rounds more than drafting him would, which is precisely the case the
    label exists for.
  */
  if (c.standing === "eligible" && c.roundValue != null && c.roundValue < 0
      && !c.atFloor && !c.strongProduction) {
    out.push(LABELS.POOR_VALUE);
  }

  if (c.standing === "unavailable") out.push(LABELS.LIMIT_REACHED);
  if (c.reviewNeeded) out.push(LABELS.NEEDS_REVIEW);
  if (c.draftedByMe === true) out.push(LABELS.RETURNING);
  if (c.draftedByMe === false) out.push(LABELS.ACQUIRED);
  if (c.freeAgent) out.push(LABELS.NOT_ON_NFL);
  return out;
}

/*
  How good a player is, independent of what they cost.

  The market's overall rank is the better answer where it exists - it is a
  cross-position judgement, which a positional finish is not. Without it, fall
  back to how far inside their positional cutoff they finished. Lower is
  better, so both are expressed as a sort key where less wins.
*/
function playerStrength(c) {
  if (c.marketRank != null) return c.marketRank;
  const points = finishPoints(c.position, c.positionRank);
  return points ? 1000 - points : 9999;
}

/** The single winner of a superlative, decided deterministically. */
function bestBy(list, keyOf) {
  let best = null;
  let bestKey = Infinity;
  for (const c of [...list].sort((a, b) => String(a.playerId).localeCompare(String(b.playerId)))) {
    const key = keyOf(c);
    if (key < bestKey) { bestKey = key; best = c; }
  }
  return best?.playerId ?? null;
}

/**
 * The explanation printed under a name: the facts, each with its season.
 *
 * Deliberately not a sentence generator. Four labelled figures in a fixed
 * order read faster than prose and cannot imply a claim the data does not
 * support - a missing one is simply absent.
 */
export function factsFor(c) {
  if (c.class === CLASS.UNKNOWN) {
    return [{ label: "Player", value: LABELS.UNKNOWN_ID }];
  }
  const out = [];

  if (c.productionPoints != null) {
    out.push({
      label: `${c.productionSeason} performance`,
      value: `${c.productionPoints.toFixed(1)} DFL pts${c.positionFinish ? ` · ${c.positionFinish}` : ""}`,
    });
  }
  out.push({
    label: `${c.basisSeason ?? "Previous"} DFL draft`,
    value: c.basisRound != null ? `Round ${c.basisRound}` : "Not found — needs review",
  });
  if (c.keeperCost != null) {
    out.push({
      label: `${c.marketSeason ?? ""} keeper`.trim(),
      value: `Round ${c.keeperCost}${c.keeperYear != null && c.maxKeeperYears != null
        ? ` · Year ${c.keeperYear} of ${c.maxKeeperYears}` : ""}`,
    });
  } else if (c.standing === "unavailable") {
    out.push({ label: "Keeper", value: c.standingReason });
  }
  if (c.marketAdp != null) {
    out.push({
      label: `${c.marketSeason} market`,
      value: `ADP ${round1(c.marketAdp)}${c.marketProjectedRound != null
        ? ` · Expected Round ${c.marketProjectedRound}` : ""}`,
    });
  }
  if (c.roundValueLabel) {
    out.push({ label: "Draft value", value: c.roundValueLabel });
  }
  return out;
}

/**
 * WHY, in one sentence, and only from what is present.
 *
 * Each branch names the facts it is standing on. Nothing here reaches for a
 * reason it cannot show above it.
 */
export function whyFor(c) {
  if (c.class === CLASS.UNKNOWN) {
    return "This id is not in the Sleeper player list, so nothing can be said about them.";
  }
  if (c.standing === "unavailable") return c.standingReason;
  if (c.reviewNeeded) {
    return `${c.basisReason} — a commissioner can enter the keeper round to record this one.`;
  }

  const bits = [];
  if (c.productionPoints != null) {
    /*
      Three tiers rather than two. "Strong" for a WR26 is a stretch even though
      WR26 clears the starter cutoff and earns the label gating - so the top
      half of the cutoff is strong, the rest of it is startable, and below it
      is quieter. The gating is unchanged; only the adjective is graded.
    */
    const cutoff = STRONG_FINISH[String(c.position || "").toUpperCase()] || 0;
    const finish = c.positionFinish ? ` (${c.positionFinish})` : "";
    bits.push(!c.strongProduction
      ? `A quieter ${c.productionSeason}${finish}`
      : c.positionRank <= Math.ceil(cutoff / 2)
        ? `Strong ${c.productionSeason} production${finish}`
        : `A startable ${c.productionSeason}${finish}`);
  }
  if (c.marketProjectedRound != null) {
    bits.push(`an expected Round ${c.marketProjectedRound} price in ${c.marketSeason}`);
  }
  if (c.keeperCost != null) bits.push(`a Round ${c.keeperCost} keeper cost`);

  if (!bits.length) return c.standingReason;

  const sentence = bits.length === 1 ? bits[0]
    : `${bits.slice(0, -1).join(", ")} and ${bits.at(-1)}`;
  if (c.roundValue != null && c.roundValue > 0) {
    return `${sentence} — ${formatRoundValue(c.roundValue)} of draft value.`;
  }
  if (c.roundValue === 0) {
    return c.atFloor
      ? `${sentence} — the cheapest a keeper can cost under these rules.`
      : `${sentence} — keeping them costs exactly what drafting them would.`;
  }
  if (c.roundValue != null && c.roundValue < 0) {
    return `${sentence} — ${formatRoundValue(c.roundValue)}: the keeper is the`
         + ` more expensive way to get them.`;
  }
  if (c.marketProjectedRound == null) {
    return `${sentence}. No market price for ${c.marketSeason} yet, so this is not a value claim.`;
  }
  return `${sentence}.`;
}

/** The compare-all row: one object per candidate, every season named. */
export function comparisonRow(c) {
  return {
    player: c.name || `Player ${c.playerId}`,
    position: c.position,
    nflTeam: c.nflTeam,
    productionSeason: c.productionSeason,
    productionPoints: c.productionPoints,
    positionFinish: c.positionFinish,
    basisSeason: c.basisSeason,
    basisRound: c.basisRound,
    keeperSeason: c.marketSeason,
    keeperRound: c.keeperCost,
    keeperYear: c.keeperYear,
    maxKeeperYears: c.maxKeeperYears,
    marketSeason: c.marketSeason,
    marketAdp: c.marketAdp,
    expectedRound: c.marketProjectedRound,
    roundValue: c.roundValue,
    standing: c.standing,
  };
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

/**
 * Everything the page needs, in one call.
 *
 * `state` is what the UI switches on, so no view has to work out which of
 * the empty cases it is looking at:
 *
 *   no-member | no-sleeper-id | no-roster | no-players | ready
 */
export function advise(input) {
  const { member = null, sleeperUserId = null, roster = null,
          players = null, draftPicks = [], rules = null, targetSeason = null,
          keeperRows = [], maxKeepers = null,
          market = NO_MARKET, production = NO_PRODUCTION } = input || {};

  if (!member) return { state: "no-member" };
  if (!sleeperUserId) return { state: "no-sleeper-id", member };
  if (!roster) return { state: "no-roster", member, sleeperUserId };

  const playerIds = Array.isArray(roster.players) ? roster.players.map(String) : [];
  if (!playerIds.length) return { state: "no-players", member, sleeperUserId, roster };

  const list = rankCandidates(candidates({
    playerIds, players: players || {}, draftPicks, sleeperUserId,
    rules, targetSeason, keeperRows, memberId: member?.id, market, production,
  }));

  const ctx = decisionContext(targetSeason);
  const levels = dataLevel(list, market);

  return {
    state: "ready",
    member, sleeperUserId, roster, rules, targetSeason, maxKeepers,
    /* The keeper history, forwarded rather than re-fetched. The self card
       needs it to work out how long a hold has been running - see
       keeperTenure() - and it is already in hand here. */
    keeperRows,
    context: ctx,
    positions: ADVISOR_POSITIONS,
    data: levels,
    market: { available: market.available, source: market.source,
              scoringFormat: market.scoringFormat, updatedAt: market.updatedAt,
              freshness: market.freshness },
    candidates: list,
    counts: {
      /* Evaluated players only - a kicker was never a candidate, so counting
         one here would be counting something the card does not show. */
      total: list.length,
      costKnown: list.filter((c) => c.standing === "eligible").length,
      basisKnown: list.filter((c) => c.basisRound != null).length,
      noPriorRound: list.filter((c) => c.basisRound == null && c.class !== CLASS.UNKNOWN).length,
      unavailable: list.filter((c) => c.standing === "unavailable").length,
      needsReview: list.filter((c) => c.reviewNeeded && c.class !== CLASS.UNKNOWN).length,
      unknownPlayer: list.filter((c) => c.class === CLASS.UNKNOWN).length,
      withProduction: list.filter((c) => c.productionPoints != null).length,
      withMarket: list.filter((c) => c.marketProjectedRound != null).length,
    },
    /* How many rows to lead with. The allowance if Sleeper stated one, and
       never more than a screenful. */
    shortlist: Math.min(list.length, Math.max(3, (Number(maxKeepers) || 0) + 2)),
  };
}

// =====================================================================
// keeper-rules.js - the one place that decides what a keeper costs
// ---------------------------------------------------------------------
// THE RULE, STATED PLAINLY
//
// A keeper's cost is measured from the player's DFL draft round in the
// season IMMEDIATELY BEFORE the keeper season, then adjusted:
//
//   2026 keeper  ->  2025 DFL draft round
//   2027 keeper  ->  2026 DFL draft round
//   2028 keeper  ->  2027 DFL draft round
//
//   maximum tenure     3 keeper seasons
//   cost basis         the PREVIOUS SEASON's DFL draft round
//   round adjustment   1 round earlier
//   minimum            Round 1
//   progression        fixed from that season's basis; it does NOT compound
//
//   2025 R8 -> 2026 keeper R7 (and R7 again in years 2 and 3)
//   2025 R2 -> R1            2025 R1 -> R1 (the floor holds)
//
// WHY THIS FILE READS LIKE A CORRECTION
//
// v1.106.0 implemented the basis as the player's EARLIEST pick in DFL
// history - "the draft that first brought them into the league". That is a
// real house rule in some leagues and it is NOT the DFL rule, and it was
// materially wrong rather than academically wrong: 90 of the 178 slots on
// the league's 2025 rosters have an earliest round that differs from their
// 2025 round. Ja'Marr Chase went R8 in 2021 and R1 in 2025; the old code
// priced him at R7.
//
// So there is no "original round" concept in here any more. There is one
// question - what round did this league draft this player in, in the season
// before the one being decided - and priorSeasonDraftRound() answers it or
// says it cannot. It never reaches further back. A 2024 round is not a
// worse answer to a 2026 question, it is a different question, and quietly
// substituting it is how a keeper gets priced from a draft five years stale.
//
// SEASON-AWARE, AND THAT IS THE WHOLE POINT OF THE SHAPE
//
// A rule set is stamped with the season it takes effect from. Changing
// 2027's rules cannot alter what was recorded in 2026, because a saved
// keeper row is a FACT - what the commissioner approved - and this file only
// ever proposes. configFor() picks the newest rule set at or before a target
// season, so the past keeps being calculated the way it was calculated.
//
// EVERYTHING CONSUMES THIS. The Advisor, the commissioner's roster picker,
// autofill, eligibility badges, tenure labels and the rule summary all call
// evaluate(). There is no second copy of the arithmetic.
// =====================================================================

/*
  THE THREE SEASONS A KEEPER DECISION SPANS, named once so nothing has to
  re-derive them and no caller can quietly mix them up.

  For a 2026 keeper decision:

    production   2025 - what the player actually did last year
    draft basis  2025 - the round this league drafted them in last year
    market       2026 - what the upcoming draft is expected to cost

  The first two are the same season and the third is not, which is exactly
  the kind of thing that gets transposed in a hurry. Everything downstream
  takes its seasons from here.
*/
export function decisionContext(targetSeason) {
  /* Number(null) is 0, which would quietly make the year 0 the basis season
     and print "0 draft round not found" at the reader. Unknown is tested
     before coercion, here and everywhere else a season is read. */
  const season = targetSeason === null || targetSeason === undefined || targetSeason === ""
    ? NaN : Number(targetSeason);
  if (!Number.isFinite(season)) {
    return { targetSeason: null, productionSeason: null,
             draftBasisSeason: null, marketSeason: null };
  }
  return {
    targetSeason: season,
    productionSeason: season - 1,
    draftBasisSeason: season - 1,
    marketSeason: season,
  };
}

/*
  Progression modes. Only one exists today and it is the league's actual rule,
  but the field exists so that "cost climbs a round every year you keep him" -
  the other common house rule - is a config change rather than a rewrite.

  The commissioner never sees these strings; the editor shows a sentence.
*/
export const PROGRESSION = {
  /** Cost is fixed by the basis round, every keeper year. */
  FIXED_FROM_BASIS: "fixed_from_basis",
  /** Cost climbs by the adjustment again for each additional keeper year. */
  ESCALATES_PER_YEAR: "escalates_per_year",
};

/*
  Cost bases. One is supported and it is the league's actual rule.

  LEGACY_* are the strings v1.106.0 wrote into keeper_rules. They are accepted
  on the way IN and normalised, because production has already been migrated
  and refusing them would take the keeper page down over a wording change.
  Nothing writes them out again.
*/
export const COST_BASIS = {
  PREVIOUS_SEASON_DRAFT_ROUND: "previous_season_draft_round",
};
export const LEGACY_COST_BASIS = "original_draft_round";
export const LEGACY_PROGRESSION = "fixed_from_original";

/** The rules the commissioner supplied, as the seeded starting point. */
/*
  ROUND 1 IS THE FLOOR, AND IT IS NOT A SETTING.

  This used to be `min_keeper_round`, a configurable value between 1 and 40 with
  its own control in the rules editor. Nothing in the league ever wanted it to
  be anything but 1: it exists because a first-round keeper minus a round is
  R0, and R0 is not a round. That is arithmetic, not policy - a rule you cannot
  sensibly set to anything else is a rule that should not be asking.

  The column stays on keeper_rules (dropping it would be a destructive
  migration in a repo whose migrations are additive) and is neither read nor
  written any more. validateConfig() still ACCEPTS one so a row seeded with it
  keeps validating; it is ignored, like the v1.106.0 spellings.
*/
export const KEEPER_ROUND_FLOOR = 1;

export const DEFAULT_RULES = {
  effective_season: 2026,
  max_keeper_seasons: 3,
  cost_basis: COST_BASIS.PREVIOUS_SEASON_DRAFT_ROUND,
  round_adjustment: 1,
  progression: PROGRESSION.FIXED_FROM_BASIS,
};

/**
 * Validate and coerce a stored/edited rule set.
 *
 * Invalid configuration must not be allowed to leak NaN into a keeper round,
 * so this returns errors rather than a half-usable object. The UI shows them
 * and refuses to save.
 *
 * @returns {{ok:boolean, config:object|null, errors:string[]}}
 */
export function validateConfig(input) {
  const errors = [];
  const raw = input || {};
  const num = (key, { min, max, integer = true } = {}) => {
    const value = Number(raw[key]);
    if (raw[key] === "" || raw[key] == null || !Number.isFinite(value)) {
      errors.push(`${key} must be a number`);
      return null;
    }
    if (integer && !Number.isInteger(value)) { errors.push(`${key} must be a whole number`); return null; }
    if (min != null && value < min) { errors.push(`${key} must be at least ${min}`); return null; }
    if (max != null && value > max) { errors.push(`${key} must be no more than ${max}`); return null; }
    return value;
  };

  const season = num("effective_season", { min: 2000, max: 2100 });
  const maxSeasons = num("max_keeper_seasons", { min: 1, max: 20 });
  /* Zero is legal - a league can keep at the basis round - but negative is
     not: "minus -1 rounds" is a more expensive keeper written backwards, and
     it is exactly the sort of thing that should be a validation error rather
     than a surprise. */
  const adjustment = num("round_adjustment", { min: 0, max: 20 });
  /*
    min_keeper_round is deliberately NOT read. A stored row may still carry one
    - production does - and it is ignored rather than rejected, because the
    floor is KEEPER_ROUND_FLOOR now and a live database must keep validating.
  */

  /* The v1.106.0 spellings are read and forgotten, never written. A live
     database seeded before this correction keeps working. */
  const rawProgression = String(raw.progression || DEFAULT_RULES.progression);
  const progression = rawProgression === LEGACY_PROGRESSION
    ? PROGRESSION.FIXED_FROM_BASIS : rawProgression;
  if (!Object.values(PROGRESSION).includes(progression)) {
    errors.push(`progression must be one of: ${Object.values(PROGRESSION).join(", ")}`);
  }
  const rawBasis = String(raw.cost_basis || DEFAULT_RULES.cost_basis);
  const basis = rawBasis === LEGACY_COST_BASIS
    ? COST_BASIS.PREVIOUS_SEASON_DRAFT_ROUND : rawBasis;
  if (basis !== COST_BASIS.PREVIOUS_SEASON_DRAFT_ROUND) {
    errors.push(`cost_basis must be ${COST_BASIS.PREVIOUS_SEASON_DRAFT_ROUND}`);
  }

  if (errors.length) return { ok: false, config: null, errors };
  return {
    ok: true,
    errors: [],
    config: {
      effective_season: season,
      max_keeper_seasons: maxSeasons,
      cost_basis: basis,
      round_adjustment: adjustment,
      progression,
      updated_at: raw.updated_at || null,
    },
  };
}

/**
 * The rule set that governs a season: the newest one effective at or before it.
 *
 * A 2027 rule change therefore leaves 2026 alone, and a season earlier than
 * any configuration returns null so callers can say "no rules configured"
 * instead of quietly inventing some.
 */
export function configFor(ruleSets = [], targetSeason) {
  const season = Number(targetSeason);
  if (!Number.isFinite(season)) return null;
  const usable = (ruleSets || [])
    .map((r) => validateConfig(r))
    .filter((v) => v.ok)
    .map((v) => v.config)
    .filter((c) => c.effective_season <= season)
    .sort((a, b) => b.effective_season - a.effective_season);
  return usable[0] || null;
}

/**
 * What keeping a player costs, from their previous-season draft round.
 *
 * @param {number} basisRound   the previous season's DFL draft round
 * @param {object} config       a validated rule set
 * @param {number} [keeperYear] 1-based; only read by escalating leagues
 * @returns {number|null} the round, or null when the basis round is unknown
 */
export function keeperCost(basisRound, config, keeperYear = 1) {
  const round = Number(basisRound);
  if (!config || !Number.isFinite(round) || round < 1) return null;
  const years = Math.max(1, Number(keeperYear) || 1);
  const steps = config.progression === PROGRESSION.ESCALATES_PER_YEAR ? years : 1;
  const cost = round - config.round_adjustment * steps;
  /* The floor is a floor, not a wrap: a player taken in the first round
     stays R1 rather than becoming R0 or a negative round. */
  return Math.max(KEEPER_ROUND_FLOOR, cost);
}

/**
 * Everything the UI needs about one player's keeper standing for one season.
 *
 * @param {Object} input
 * @param {object}  input.config           a validated rule set (or null)
 * @param {number}  input.targetSeason     the season being decided
 * @param {number|null} input.basisRound   the PREVIOUS season's draft round
 * @param {number|null} [input.basisSeason] which season that round came from;
 *                                          defaults to targetSeason - 1
 * @param {number}  [input.priorKeeperSeasons]  how many seasons already kept
 * @returns {{
 *   state: "eligible"|"review"|"unavailable"|"no-rules",
 *   eligible: boolean, reviewNeeded: boolean,
 *   keeperYear: number|null, maxKeeperYears: number|null,
 *   finalKeeperYear: boolean, calculatedRound: number|null,
 *   basisRound: number|null, basisSeason: number|null, reason: string
 * }}
 */
export function evaluate({ config = null, targetSeason = null, basisRound = null,
                           basisSeason = null, priorKeeperSeasons = 0 } = {}) {
  /*
    Number(null) is 0 and Number("") is 0, so a plain isFinite() check called
    an unknown draft round "round zero" and walked straight past the review
    branch below into a keeperCost() of null reported as eligible. Unknown has
    to be tested before coercion.
  */
  const knownRound = basisRound !== null && basisRound !== undefined
    && basisRound !== "" && Number.isFinite(Number(basisRound))
    && Number(basisRound) >= 1
    ? Number(basisRound) : null;

  const ctx = decisionContext(targetSeason);
  /* Number(null) is 0 and Number("") is 0, so "not supplied" has to be tested
     before coercion here too - otherwise an omitted basisSeason becomes the
     year 0 and the review message reads "0 draft round not found". */
  const season = basisSeason !== null && basisSeason !== undefined && basisSeason !== ""
    && Number.isFinite(Number(basisSeason))
    ? Number(basisSeason) : ctx.draftBasisSeason;

  const base = {
    state: "review", eligible: false, reviewNeeded: true,
    keeperYear: null, maxKeeperYears: config?.max_keeper_seasons ?? null,
    finalKeeperYear: false, calculatedRound: null,
    basisRound: knownRound, basisSeason: season,
    reason: "",
  };

  if (!config) {
    return { ...base, state: "no-rules", reviewNeeded: true,
             reason: "No keeper rules are configured for this season" };
  }

  const prior = Math.max(0, Number(priorKeeperSeasons) || 0);
  const max = config.max_keeper_seasons;

  /* Tenure is checked BEFORE the round, because "you have already kept him
     three times" is true whether or not we know what he cost. Tenure and cost
     are two separate rules: tenure counts keeper history, cost reads one
     draft board. */
  if (prior >= max) {
    return { ...base, state: "unavailable", reviewNeeded: false,
             keeperYear: prior + 1, maxKeeperYears: max,
             reason: `Keeper limit reached — kept ${prior} season${prior === 1 ? "" : "s"} of ${max}` };
  }

  const keeperYear = prior + 1;
  const finalKeeperYear = keeperYear === max;

  if (base.basisRound == null) {
    /*
      The honest answer, and it names the ONE season that matters. It does not
      speculate about whether the player was in the league in 2019, because
      that has no bearing on a 2026 keeper cost - the only question is whether
      a 2025 draft record exists.
    */
    return { ...base, state: "review", reviewNeeded: true,
             keeperYear, maxKeeperYears: max, finalKeeperYear,
             reason: season != null
               ? `${season} draft round not found — needs commissioner review`
               : "Previous season's draft round not found — needs commissioner review" };
  }

  const calculatedRound = keeperCost(base.basisRound, config, keeperYear);
  /* A belt to the braces above: nothing reports eligible without a round to
     charge for it. If this ever fires, the cause is upstream and the honest
     answer is review rather than a card with a blank cost on it. */
  if (calculatedRound == null) {
    return { ...base, state: "review", reviewNeeded: true,
             keeperYear, maxKeeperYears: max, finalKeeperYear,
             reason: "Keeper cost could not be calculated — needs commissioner review" };
  }

  return {
    ...base,
    state: "eligible", eligible: true, reviewNeeded: false,
    keeperYear, maxKeeperYears: max, finalKeeperYear, calculatedRound,
    reason: finalKeeperYear
      ? `Final keeper season — year ${keeperYear} of ${max}`
      : `Year ${keeperYear} of ${max}`,
  };
}

/**
 * THE KEEPER BASIS: this league's draft round for a player in the season
 * immediately before the keeper season. That season and no other.
 *
 * For a 2026 keeper the question is "was this player drafted in the DFL in
 * 2025, and in which round". A 2024 pick does not answer it. Neither does the
 * player's first-ever DFL pick. Both are refused rather than substituted,
 * because a silent reach backwards is how a keeper ends up priced off a draft
 * board from five years ago - and it is not a theoretical risk: on the
 * league's own 2025 rosters, 90 of 178 slots have an earlier round that
 * differs from the 2025 one.
 *
 * A player with no pick in that season returns round null, which evaluate()
 * turns into "needs commissioner review". `otherSeasons` is returned so the
 * commissioner's review sheet can show what IS on record while being explicit
 * that none of it is the basis; nothing computes from it.
 *
 * @param {Array<{player_id:string|number, season:number|string, round:number|string}>} picks
 * @param {string|number} playerId
 * @param {{targetSeason:number|string}} opts
 * @returns {{round:number|null, season:number|null, found:boolean,
 *            otherSeasons:Array<{season:number, round:number}>, reason:string}}
 */
export function priorSeasonDraftRound(picks = [], playerId, { targetSeason } = {}) {
  const { draftBasisSeason } = decisionContext(targetSeason);
  const id = String(playerId);
  const mine = (picks || [])
    .filter((p) => p && String(p.player_id) === id)
    .map((p) => ({ season: Number(p.season), round: Number(p.round) }))
    .filter((p) => Number.isFinite(p.season) && Number.isFinite(p.round) && p.round >= 1)
    .sort((a, b) => a.season - b.season);

  if (draftBasisSeason == null) {
    return { round: null, season: null, found: false, otherSeasons: mine,
             reason: "No keeper season selected" };
  }

  const hit = mine.find((p) => p.season === draftBasisSeason);
  const otherSeasons = mine.filter((p) => p.season !== draftBasisSeason);

  if (!hit) {
    return {
      round: null, season: draftBasisSeason, found: false, otherSeasons,
      reason: `${draftBasisSeason} draft round not found`,
    };
  }
  return {
    round: hit.round, season: draftBasisSeason, found: true, otherSeasons,
    reason: `Drafted R${hit.round} in ${draftBasisSeason}`,
  };
}

/**
 * How many seasons a player has already been kept, from canonical keeper rows.
 *
 * TENURE IS A DIFFERENT RULE FROM COST. This reads keeper history; the cost
 * basis above reads one draft board. A player kept in 2025 and 2026 is in
 * their final year for 2027, and their 2027 cost still comes from the 2026
 * draft - the two calculations never feed each other.
 *
 * Counts only rows that carry a stable player_id, and only seasons BEFORE the
 * one being decided. Legacy nickname rows are deliberately not counted: the
 * audit found `team` holding first names and `player` holding nicknames, and
 * inventing tenure from a fuzzy name match would silently make somebody
 * ineligible. Where legacy rows might apply, callers surface review rather
 * than a number - see legacyKeeperNames().
 */
export function priorKeeperSeasons(keeperRows = [], { playerId, memberId, beforeSeason } = {}) {
  const pid = playerId == null ? null : String(playerId);
  const mid = memberId == null ? null : String(memberId);
  const cutoff = Number(beforeSeason);
  if (!pid || !Number.isFinite(cutoff)) return 0;

  const seasons = new Set();
  for (const row of keeperRows || []) {
    if (!row || row.player_id == null) continue;                 // legacy row
    if (String(row.player_id) !== pid) continue;
    if (mid != null && row.member_id != null && String(row.member_id) !== mid) continue;
    const year = Number(row.year ?? row.season);
    if (Number.isFinite(year) && year < cutoff) seasons.add(year);
  }
  return seasons.size;
}

/**
 * The full hold on a player: which year of the allowance this is, when it
 * started, and how much is left.
 *
 * NOTHING NEW IS STORED FOR THIS. priorKeeperSeasons() already counts the
 * seasons a player has been kept, so the season the hold STARTED is simply
 * the earliest of them - a column recording it would be a second copy of a
 * fact the keeper rows already carry, and the two would eventually disagree.
 *
 * `season` is the season being looked at. A player kept in that season is in
 * year prior+1; a player being CONSIDERED for it is in the same year, which
 * is why the advisor and the card can share this.
 *
 * @param {Object[]} keeperRows every keeper row the page has loaded
 * @param {Object} input
 * @param {string|number} input.playerId
 * @param {string|number} [input.memberId] scope to one manager's hold
 * @param {number} input.season            the season in question
 * @param {number} [input.max]             the league's max_keeper_seasons
 * @returns {{year:number, max:number|null, left:number|null,
 *            firstSeason:number|null, seasons:number[], final:boolean}}
 */
export function keeperTenure(keeperRows = [], { playerId, memberId, season, max = null } = {}) {
  const pid = playerId == null ? null : String(playerId);
  const mid = memberId == null ? null : String(memberId);
  const target = Number(season);
  /* Number(null) is 0 and Number("") is 0 - the same trap evaluate() documents
     above. An unconfigured maximum became a limit of ZERO, which reports every
     hold as final with nothing left. Not supplied has to be tested first. */
  const limit = max !== null && max !== undefined && max !== "" && Number.isFinite(Number(max))
    ? Number(max) : null;
  if (!pid || !Number.isFinite(target)) {
    return { year: 1, max: limit, left: limit == null ? null : limit - 1,
             firstSeason: null, seasons: [], final: limit === 1 };
  }

  const seasons = new Set();
  for (const row of keeperRows || []) {
    if (!row || row.player_id == null) continue;                 // legacy row
    if (String(row.player_id) !== pid) continue;
    if (mid != null && row.member_id != null && String(row.member_id) !== mid) continue;
    const year = Number(row.year ?? row.season);
    if (Number.isFinite(year) && year <= target) seasons.add(year);
  }

  const kept = [...seasons].sort((a, b) => a - b);
  const prior = kept.filter((year) => year < target).length;
  const year = prior + 1;
  /* The hold started at the earliest recorded season, or at this one if this
     is where it begins. */
  const firstSeason = kept.length ? kept[0] : target;
  return {
    year, max: limit,
    left: limit == null ? null : Math.max(0, limit - year),
    firstSeason, seasons: kept,
    final: limit != null && year >= limit,
  };
}

/**
 * Legacy rows that MIGHT be about this player, for an honest review prompt.
 *
 * Returns the stored nickname strings and nothing else - no matching, no
 * scoring, no guess. "Puka", "JJettas" and "NA" stay exactly as typed, and the
 * commissioner is the one who decides whether they count.
 */
export function legacyKeeperNames(keeperRows = [], { beforeSeason } = {}) {
  const cutoff = Number(beforeSeason);
  return (keeperRows || [])
    .filter((row) => row && row.player_id == null)
    .filter((row) => {
      const year = Number(row.year ?? row.season);
      return !Number.isFinite(cutoff) || (Number.isFinite(year) && year < cutoff);
    })
    .map((row) => ({ year: row.year ?? row.season ?? null,
                     team: row.team ?? "", player: row.player ?? "",
                     round_cost: row.round_cost ?? null }));
}

/**
 * Saved keeper rows whose recorded basis does not match the corrected rule.
 *
 * v1.107.0 wrote `original_round` from the player's EARLIEST pick. Some of
 * those rows are wrong now - not because the commissioner approved the wrong
 * thing, but because the engine proposed from the wrong season. This REPORTS
 * them and changes nothing: an approved keeper record is a historical fact,
 * and rewriting one automatically would replace a decision somebody made with
 * a number a migration guessed.
 *
 * A row the commissioner deliberately overrode is reported as such rather
 * than as a discrepancy to correct.
 *
 * @param {Object[]} keeperRows   rows from `keepers`
 * @param {Object[]} draftPicks   rows from `sleeper_draft_picks`
 * @param {Object[]} ruleSets     rows from `keeper_rules`
 * @returns {Array<{row:object, savedRound:number|null, savedBasis:number|null,
 *                  basisRound:number|null, basisSeason:number|null,
 *                  correctedRound:number|null, overridden:boolean, note:string}>}
 */
export function auditSavedBasis(keeperRows = [], draftPicks = [], ruleSets = []) {
  const out = [];
  for (const row of keeperRows || []) {
    if (!row || row.player_id == null) continue;      // legacy row: nothing to compare
    const season = Number(row.year ?? row.season);
    if (!Number.isFinite(season)) continue;

    const basis = priorSeasonDraftRound(draftPicks, row.player_id, { targetSeason: season });
    const config = configFor(ruleSets, season);
    const prior = priorKeeperSeasons(keeperRows, {
      playerId: row.player_id, memberId: row.member_id, beforeSeason: season });
    const standing = evaluate({ config, targetSeason: season, basisRound: basis.round,
                                basisSeason: basis.season, priorKeeperSeasons: prior });

    /*
      basis_round is the corrected-rule column; original_round is what
      v1.107.0 wrote from the earliest pick. A row carrying basis_round was
      saved under the right rule and only shows up here if the draft board has
      since changed under it.
    */
    const savedUnderCorrectedRule = row.basis_round != null;
    const savedBasis = row.basis_round ?? row.original_round ?? null;
    const savedRound = row.calculated_round ?? row.round_cost ?? null;
    const corrected = standing.calculatedRound;
    const overridden = row.round_overridden === true;

    const basisDiffers = savedBasis != null && basis.round != null && savedBasis !== basis.round;
    const roundDiffers = savedRound != null && corrected != null && savedRound !== corrected;
    const basisMissing = basis.round == null;
    if (!basisDiffers && !roundDiffers && !basisMissing) continue;

    out.push({
      row, savedRound, savedBasis, savedUnderCorrectedRule,
      basisRound: basis.round, basisSeason: basis.season,
      correctedRound: corrected, overridden,
      note: basisMissing
        ? `No ${basis.season} draft record — the corrected basis cannot be checked automatically`
        : overridden
          ? `Saved as an override (R${savedRound}); the ${basis.season} basis is R${basis.round}`
          : `Saved from R${savedBasis}; the ${basis.season} basis is R${basis.round}`,
    });
  }
  return out;
}

/**
 * The rule set as a sentence, for the page summary and the share board.
 *
 * Every value comes from configuration - there is no hard-coded "3-year" or
 * "-1" anywhere in the UI. Returns null when nothing is configured, so a
 * caller omits the line instead of printing a confusing half-sentence.
 */
export function describeRules(config) {
  if (!config) return null;
  const parts = [`${config.max_keeper_seasons}-year maximum`];
  parts.push(config.round_adjustment === 0
    ? "Previous season's draft round"
    : `Previous season's draft -${config.round_adjustment} round${config.round_adjustment === 1 ? "" : "s"}`);
  /* "Floor R1" was on this line. It said nothing a reader did not already
     assume, and it described the one value the rule could ever have. */
  if (config.progression === PROGRESSION.ESCALATES_PER_YEAR) parts.push("cost climbs each keeper year");
  return parts.join(" · ");
}

/** The commissioner-facing label for the configured cost basis. */
export function describeCostBasis(config) {
  if (!config) return null;
  return "Previous season's draft round";
}

/**
 * The worked example the rule editor shows, straight from the config and
 * stated in real seasons rather than in the abstract.
 *
 * "A player drafted in Round 8 in 2025 would cost Round 7 as a 2026 keeper"
 * is a sentence a commissioner can check against their own memory. "Original
 * draft round minus one" is not.
 */
export function ruleExample(config, { basisRound = 8, targetSeason = null } = {}) {
  if (!config) return null;
  const cost = keeperCost(basisRound, config, 1);
  if (cost == null) return null;
  const season = Number(targetSeason) || config.effective_season;
  const { draftBasisSeason } = decisionContext(season);
  return {
    basisRound, cost, targetSeason: season, basisSeason: draftBasisSeason,
    text: `A player drafted in Round ${basisRound} in ${draftBasisSeason} would cost `
        + `Round ${cost} as a ${season} keeper.`,
  };
}

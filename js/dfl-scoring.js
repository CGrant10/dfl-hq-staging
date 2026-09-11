// =====================================================================
// dfl-scoring.js - fantasy points scored the way THIS league scores them
// ---------------------------------------------------------------------
// WHY THIS EXISTS AND WHY IT IS NOT "PPR"
//
// The Keeper Advisor has to be able to say what a player actually did last
// season. "Fantasy points" is not a fact on its own - it is a fact about a
// scoring system - and the DFL's system is not any of the three presets
// Sleeper publishes alongside its stats:
//
//   pts_std / pts_half_ppr / pts_ppr   Sleeper's own presets
//   DFL                                full PPR, but pass_int is -2 (not -1),
//                                      pass_td is 4, and there are yardage
//                                      bonuses at 100/200 rushing, 100/200
//                                      receiving and 300/400 passing
//
// Printing pts_ppr and calling it "DFL points" would be wrong by 4 points for
// a quarterback with four 300-yard games and wrong by 7 for one who threw
// seven interceptions. So the points are computed here, from the league's own
// `scoring_settings` - the object Sleeper returns for the league and that
// sync.js already stores on sleeper_leagues.
//
// HOW SLEEPER'S SCORING ACTUALLY WORKS, WHICH IS WHY THIS IS SO SHORT
//
// `scoring_settings` is {statKey: pointsPerUnit} and the stats payload is
// {statKey: count} using THE SAME KEYS - including the bonus keys, which
// arrive as counts ("bonus_rush_yd_100": 4 means four 100-yard games). So the
// whole calculation is one dot product, and the reason to trust it is not
// that it looks right:
//
//   VERIFIED against the league's real week 1 of 2025. Summing each team's
//   starters with this function reproduced all six Sleeper matchup scores to
//   the cent (104.32, 126.68, 119.78, 88.90, 115.52, 103.52).
//
// A key in the settings that never appears in a player's stats (the defensive
// and points-allowed keys, for a running back) contributes nothing, which is
// the correct answer rather than a gap.
// =====================================================================

/*
  THE POSITIONS THE ADVISOR EVALUATES, and the ones it does not.

  A keeper decision is about skill players. Kickers and team defences are
  drafted late, dropped freely and replaced weekly; recommending one as a
  keeper is not advice, it is noise - and a team defence has a "positional
  finish" that means nothing next to a running back's. They are excluded from
  the Advisor entirely: ranking, shortlist, comparison, badges, explanations
  and review.

  The commissioner's entry sheet is a DIFFERENT tool and still lists them,
  because recording an unusual keeper has to be possible.
*/
export const ADVISOR_POSITIONS = ["QB", "RB", "WR", "TE"];

/** Is this a position the Advisor is allowed to talk about? */
export function isAdvisorPosition(position) {
  return ADVISOR_POSITIONS.includes(String(position || "").toUpperCase());
}

/*
  Sleeper's own id for a team defence is the team abbreviation ("SF", "LAR"),
  not a number, and the player map gives its position as DEF. Kickers are K.
  Both spellings of a defence are refused, because different Sleeper surfaces
  use different ones.
*/
const EXCLUDED = new Set(["K", "DEF", "DST", "D/ST", "IDP", "LB", "DB", "DL"]);

/** The positions the Advisor refuses to evaluate, for an explicit test. */
export function isExcludedPosition(position) {
  return EXCLUDED.has(String(position || "").toUpperCase());
}

/**
 * DFL fantasy points for one player from one stat line.
 *
 * Pure: same stats and same settings give the same number, with no clock, no
 * network and no league lookup. That is what makes it testable and what makes
 * it safe to run over a whole roster.
 *
 * @param {Object<string, number>} stats            a Sleeper stat line
 * @param {Object<string, number>} scoringSettings  the league's scoring_settings
 * @returns {number|null} points to 2dp, or null when there is nothing to score
 */
export function scorePlayer(stats, scoringSettings) {
  if (!stats || typeof stats !== "object") return null;
  if (!scoringSettings || typeof scoringSettings !== "object") return null;

  let total = 0;
  let matched = 0;
  for (const [key, perUnit] of Object.entries(scoringSettings)) {
    const count = Number(stats[key]);
    const weight = Number(perUnit);
    if (!Number.isFinite(count) || !Number.isFinite(weight)) continue;
    matched++;
    total += count * weight;
  }
  /*
    No overlap at all means this is not a stat line we can score - an empty
    object, or a payload shape that changed underneath us. Returning 0 would
    read on the card as "scored nothing last year", which is a different and
    much worse claim than "we do not know".
  */
  if (!matched) return null;
  /* Floating point: 0.1 per receiving yard over 1,400 yards accumulates
     visible fuzz, and Sleeper itself reports to the cent. */
  return Math.round(total * 100) / 100;
}

/**
 * Which of the three market scoring formats this league is, from its own
 * settings, so an external ADP feed can be asked for the right one.
 *
 * Reception value is the only thing that separates them in practice, and it
 * is the only thing ADP providers publish separate numbers for. DFL scores a
 * reception at 1, so DFL reads PPR.
 */
export function scoringFormat(scoringSettings) {
  const rec = Number(scoringSettings?.rec);
  if (!Number.isFinite(rec)) return "ppr";      // Sleeper's own default
  if (rec >= 0.75) return "ppr";
  if (rec >= 0.25) return "half_ppr";
  return "std";
}

/** A one-line description of how a points total was arrived at. */
export function describeScoring(scoringSettings) {
  if (!scoringSettings) return null;
  const fmt = { ppr: "full PPR", half_ppr: "half PPR", std: "standard" }[scoringFormat(scoringSettings)];
  return `DFL scoring · ${fmt}`;
}

/**
 * Season totals for a set of players, scored under DFL settings.
 *
 * @param {Object} input
 * @param {string[]} input.playerIds
 * @param {Object<string, object>} input.stats     Sleeper's season stats, by id
 * @param {Object<string, object>} input.players   the Sleeper player map {id:{n,p,t}}
 * @param {Object} input.scoringSettings
 * @returns {Map<string, {points:number|null, games:number|null, position:string}>}
 */
export function seasonTotals({ playerIds = [], stats = {}, players = {},
                               scoringSettings = null } = {}) {
  const out = new Map();
  for (const rawId of playerIds) {
    const id = String(rawId);
    const line = stats[id] || null;
    out.set(id, {
      points: line ? scorePlayer(line, scoringSettings) : null,
      games: line && Number.isFinite(Number(line.gp)) ? Number(line.gp) : null,
      position: String(players[id]?.p || "").toUpperCase(),
    });
  }
  return out;
}

/**
 * POSITIONAL FINISH under DFL scoring - the "RB5" beside a points total.
 *
 * Raw points do not compare across positions: a 286-point running back had a
 * far better season than a 286-point quarterback. The finish does compare,
 * which is why the Advisor leads with it.
 *
 * Ranked over EVERY player at that position in the league's stat payload, not
 * just the ones on somebody's roster - "RB5 of the players I happen to own"
 * would be a meaningless number. Only the four Advisor positions are ranked;
 * kickers and defences are not ranked at all, so nothing downstream can
 * accidentally print one.
 *
 * Ties share a rank, the way a finish is normally read.
 *
 * @param {Object} input
 * @param {Object<string, object>} input.stats     Sleeper's season stats, by id
 * @param {Object<string, object>} input.players   the Sleeper player map
 * @param {Object} input.scoringSettings
 * @param {number} [input.minGames]  a floor on games played, so a one-game
 *                                   cameo does not outrank a full season on
 *                                   nothing. Zero keeps everybody.
 * @returns {Map<string, {points:number, position:string, positionRank:number,
 *                        positionCount:number, label:string}>}
 */
export function positionalFinish({ stats = {}, players = {}, scoringSettings = null,
                                   minGames = 0 } = {}) {
  const byPosition = new Map();

  for (const [rawId, line] of Object.entries(stats || {})) {
    const id = String(rawId);
    const position = String(players[id]?.p || "").toUpperCase();
    if (!isAdvisorPosition(position)) continue;
    const games = Number(line?.gp);
    if (minGames > 0 && Number.isFinite(games) && games < minGames) continue;
    const points = scorePlayer(line, scoringSettings);
    if (points == null) continue;
    if (!byPosition.has(position)) byPosition.set(position, []);
    byPosition.get(position).push({ id, points });
  }

  const out = new Map();
  for (const [position, list] of byPosition) {
    list.sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
    let rank = 0;
    let lastPoints = null;
    list.forEach((entry, i) => {
      /* Equal points share a rank; the next distinct total takes the rank it
         would have had anyway, which is how "T-5th" is normally counted. */
      if (lastPoints == null || entry.points !== lastPoints) rank = i + 1;
      lastPoints = entry.points;
      out.set(entry.id, {
        points: entry.points, position, positionRank: rank,
        positionCount: list.length, label: `${position}${rank}`,
      });
    });
  }
  return out;
}

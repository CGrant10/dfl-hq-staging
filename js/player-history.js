// =====================================================================
// player-history.js - what a player has actually done, over years
// ---------------------------------------------------------------------
// The report's existing "trend" is a two-point comparison: this year's
// projection against last year's rate. That answers "is he expected to be
// better than last season" and nothing else. It cannot tell a player who
// has climbed three years running from one who collapsed and bounced, and
// those are different bets.
//
// This reads several completed seasons and reports the shape.
//
// PER GAME, NOT PER SEASON. A back who missed nine games has a small
// season total and may have been excellent; comparing totals would call
// him a decline. Every judgement here is on the per-game rate, and games
// played is carried separately so availability is its own fact rather
// than being smuggled into the scoring.
//
// AND IT SAYS WHEN IT DOES NOT KNOW. Two seasons is a line, not a trend.
// One is a dot. A rookie has no history at all, and "insufficient" is the
// honest answer for all of them - see direction(), which refuses rather
// than extrapolating from a single point.
//
// Pure functions. sleeper.js fetches, the panel renders.
// =====================================================================

import { scorePlayer } from "./dfl-scoring.js";

/* Below this, a slope is noise rather than a direction. Points per game,
   per season - roughly a fantasy point of change a year. */
export const TREND_SLOPE = 0.75;
const NFL_SEASON_GAMES = 17;

const num = value => (Number.isFinite(Number(value)) ? Number(value) : null);

/**
 * One player's line for one season, scored with the league's own settings.
 * @returns {{year:number, points:number, games:number, perGame:number}|null}
 */
export function seasonLine(stats, year, scoringSettings) {
  if (!stats) return null;
  const points = scorePlayer(stats, scoringSettings);
  const games = num(stats.gp);
  /* No games means no rate to report. Zero points across a real season is a
     fact; zero points across zero games is an absence. */
  if (points == null || !games || games <= 0) return null;
  return { year, points, games, perGame: points / games };
}

/**
 * Least-squares slope of per-game scoring across seasons, in points per
 * game per season. Positive is improving.
 */
export function slopeOf(series = []) {
  const points = series.filter(entry => Number.isFinite(entry?.perGame));
  if (points.length < 2) return null;
  const n = points.length;
  const meanX = points.reduce((sum, _, i) => sum + i, 0) / n;
  const meanY = points.reduce((sum, entry) => sum + entry.perGame, 0) / n;
  let top = 0, bottom = 0;
  points.forEach((entry, i) => {
    top += (i - meanX) * (entry.perGame - meanY);
    bottom += (i - meanX) ** 2;
  });
  return bottom === 0 ? null : top / bottom;
}

/** Rising, falling, steady - or an admission that we cannot say. */
export function direction(series = []) {
  if (series.length < 2) return "insufficient";
  const slope = slopeOf(series);
  if (slope == null) return "insufficient";
  if (slope >= TREND_SLOPE) return "rising";
  if (slope <= -TREND_SLOPE) return "falling";
  return "steady";
}

/**
 * A player's multi-season record.
 *
 * @param {Object} input
 * @param {Array<{year:number, stats:Object}>} input.seasons  oldest first
 * @param {Object} input.scoringSettings
 * @returns {{seasons:Array, direction:string, slope:number|null,
 *            peak:Object|null, swing:number|null, availability:number|null}}
 */
export function historyFor({ seasons = [], scoringSettings = null } = {}) {
  const series = seasons
    .map(({ year, stats }) => seasonLine(stats, year, scoringSettings))
    .filter(Boolean)
    .sort((a, b) => a.year - b.year);

  if (!series.length) {
    return { seasons: [], direction: "insufficient", slope: null,
             peak: null, swing: null, mean: null, volatility: null, availability: null };
  }
  const rates = series.map(entry => entry.perGame);
  const peak = series.reduce((best, entry) => (entry.perGame > best.perGame ? entry : best), series[0]);
  const mean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  return {
    seasons: series,
    direction: direction(series),
    slope: slopeOf(series),
    peak,
    /* How far the best and worst seasons sit apart, per game. A big swing is
       not a direction - it is a warning that the average is hiding something. */
    swing: series.length >= 2 ? Math.max(...rates) - Math.min(...rates) : null,
    mean,
    /*
      VOLATILITY IS RELATIVE, and it has to be.

      An absolute swing threshold tagged 73% of a real roster as volatile,
      which is a label that tells you nothing. Five points a game of spread is
      unremarkable on a 20-point quarterback and enormous on an 8-point third
      receiver - so the number that matters is the spread as a share of the
      player's own level, not the spread itself.
    */
    volatility: series.length >= 2 && mean > 0
      ? (Math.max(...rates) - Math.min(...rates)) / mean : null,
    availability: series.reduce((sum, entry) => sum + entry.games, 0)
                / (series.length * NFL_SEASON_GAMES),
  };
}

/**
 * Build histories for a set of players in one pass.
 *
 * @param {Object} input
 * @param {string[]} input.playerIds
 * @param {Array<{year:number, stats:Object}>} input.statsBySeason  each stats
 *        is Sleeper's whole { player_id: line } map for that year
 * @returns {Map<string, Object>}
 */
export function buildHistories({ playerIds = [], statsBySeason = [], scoringSettings = null } = {}) {
  const ordered = [...statsBySeason].sort((a, b) => a.year - b.year);
  const out = new Map();
  for (const id of playerIds.map(String)) {
    out.set(id, historyFor({
      seasons: ordered.map(({ year, stats }) => ({ year, stats: stats?.[id] || null })),
      scoringSettings,
    }));
  }
  return out;
}

/**
 * Where the market stands on a player, from Sleeper's global add/drop counts.
 *
 * Deliberately NOT folded into any projection. It is an opinion held by other
 * managers, not evidence about production, and the moment it is added to a
 * points total nobody can tell which of the two moved a number.
 */
export function marketSignal(id, trending) {
  const adds = trending?.adds?.get(String(id)) || 0;
  const drops = trending?.drops?.get(String(id)) || 0;
  if (!adds && !drops) return null;
  if (adds >= drops * 2 && adds >= 1000) return { tone: "hot", adds, drops, label: "being added" };
  if (drops >= adds * 2 && drops >= 1000) return { tone: "cold", adds, drops, label: "being dropped" };
  return { tone: "mixed", adds, drops, label: "mixed interest" };
}

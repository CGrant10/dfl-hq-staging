import { scorePlayer } from "./dfl-scoring.js";

const STARTER_CUTOFF = { QB: 12, RB: 24, WR: 30, TE: 12 };
const SEASON_WEIGHTS = [.5, .3, .2];
const PACKAGE_WEIGHTS = [1, .5, .25];

// Back-to-back 2022 Week 14 joke swaps. Keep them in the league transaction
// history, but do not let them distort the all-time fleece leaderboard.
const FLEECE_RANKING_EXCLUDED_IDS = new Set([
  "907844411101487104",
  "907840843644805120",
]);

export function completedTrades(rows = []) {
  return rows.filter(row => row?.type === "trade" && row?.status === "complete" && row?.details?.status === "complete");
}

export function tradeSides(row) {
  const sides = new Map();
  for (const rosterId of row?.details?.roster_ids || []) sides.set(String(rosterId), []);
  for (const [playerId, rosterId] of Object.entries(row?.details?.adds || {})) {
    const key = String(rosterId);
    if (!sides.has(key)) sides.set(key, []);
    sides.get(key).push(String(playerId));
  }
  return [...sides.entries()].map(([rosterId, playerIds]) => ({ rosterId, playerIds }));
}

function positionOf(players, playerId) {
  return String(players?.[playerId]?.p || players?.[playerId]?.position || "").toUpperCase();
}

function replacementLevels(year, statsBySeason, scoringBySeason, players) {
  const byPosition = new Map(Object.keys(STARTER_CUTOFF).map(position => [position, []]));
  for (const [playerId, stats] of Object.entries(statsBySeason.get(year) || {})) {
    const position = positionOf(players, playerId);
    if (!byPosition.has(position)) continue;
    const points = scorePlayer(stats, scoringBySeason.get(year));
    if (points != null) byPosition.get(position).push(points);
  }
  return new Map([...byPosition].map(([position, points]) => {
    points.sort((a, b) => b - a);
    const cutoff = STARTER_CUTOFF[position];
    return [position, points[cutoff - 1] ?? points.at(-1) ?? 0];
  }));
}

function packageOutcome(playerIds, tradeSeason, latestSeason, statsBySeason, scoringBySeason, players, replacementsBySeason) {
  const seasons = [];
  for (let year = Number(tradeSeason); year <= Math.min(Number(tradeSeason) + 2, latestSeason); year++) {
    if (statsBySeason.has(year) && scoringBySeason.has(year)) seasons.push(year);
  }
  if (!seasons.length) return null;

  const availableWeight = seasons.reduce((sum, _, index) => sum + SEASON_WEIGHTS[index], 0);
  const impacts = [];
  for (const playerId of playerIds) {
    const position = positionOf(players, playerId);
    if (!STARTER_CUTOFF[position]) {
      impacts.push(0);
      continue;
    }
    const impact = seasons.reduce((total, year, index) => {
      const points = scorePlayer(statsBySeason.get(year)?.[playerId], scoringBySeason.get(year)) || 0;
      const replacement = replacementsBySeason.get(year)?.get(position) || 0;
      return total + Math.max(0, points - replacement) * SEASON_WEIGHTS[index];
    }, 0) / availableWeight;
    impacts.push(impact);
  }
  impacts.sort((a, b) => b - a);
  const total = impacts.reduce((sum, impact, index) =>
    sum + impact * (PACKAGE_WEIGHTS[index] ?? .1), 0);
  return Math.round(total * 10) / 10;
}

export function rankTradeFleeces({ trades = [], latestSeason = 0, statsBySeason = new Map(), scoringBySeason = new Map(), players = {} } = {}) {
  const replacementsBySeason = new Map([...statsBySeason.keys()].map(year =>
    [year, replacementLevels(year, statsBySeason, scoringBySeason, players)]));
  return completedTrades(trades).filter(trade =>
    !FLEECE_RANKING_EXCLUDED_IDS.has(String(trade?.details?.transaction_id || ""))
  ).map(trade => {
    const sides = tradeSides(trade).map(side => ({
      ...side,
      outcome: packageOutcome(side.playerIds, trade.season, latestSeason, statsBySeason, scoringBySeason, players, replacementsBySeason),
    }));
    if (sides.length < 2 || sides.some(side => side.outcome == null || !side.playerIds.length)) return null;
    sides.sort((a, b) => b.outcome - a.outcome);
    return { trade, winner: sides[0], loser: sides.at(-1), gap: Math.round((sides[0].outcome - sides.at(-1).outcome) * 10) / 10 };
  }).filter(row => row && row.gap > 0).sort((a, b) => b.gap - a.gap);
}

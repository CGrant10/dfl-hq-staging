import { scorePlayer } from "./dfl-scoring.js";

export const ANALYZER_POSITIONS = ["QB", "RB", "WR", "TE"];
export const ANALYZER_UNITS = [...ANALYZER_POSITIONS, "FLEX"];
const STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1 };
const FLEX_POSITIONS = new Set(["RB", "WR", "TE"]);
const DEPTH_WEIGHTS = [1, .84, .68, .52, .36];
const round = (value, digits = 1) => {
  const scale = 10 ** digits;
  return Math.round((Number(value) || 0) * scale) / scale;
};
const finite = value => value == null || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const playerPosition = player => String(player?.p || player?.position || "").toUpperCase();
const projectionId = row => row?.player_id == null ? "" : String(row.player_id);

function adpFrom(row, scoringFormat = "ppr") {
  const stats = row?.stats || {};
  const keys = [`adp_${scoringFormat}`, "adp_ppr", "adp_half_ppr", "adp_std"];
  for (const key of keys) {
    const value = finite(stats[key]);
    if (value != null && value > 0 && value < 999) return value;
  }
  return null;
}

function percentileMap(entries, valueOf, { lowerIsBetter = false } = {}) {
  const usable = entries.filter(entry => finite(valueOf(entry)) != null)
    .sort((a, b) => lowerIsBetter ? valueOf(a) - valueOf(b) : valueOf(b) - valueOf(a));
  const out = new Map();
  usable.forEach((entry, index) => {
    const percentile = usable.length <= 1 ? 1 : 1 - index / (usable.length - 1);
    out.set(entry.id, percentile);
  });
  return out;
}

/**
 * One shared player model for every roster. Current projections lead, while
 * the completed season keeps one hot forecast from erasing proven production.
 */
export function buildPlayerPool({ rosters = [], players = {}, previousStats = {},
                                  projections = [], scoringSettings = null,
                                  scoringFormat = "ppr" } = {}) {
  const projectionById = new Map((projections || []).map(row => [projectionId(row), row]));
  const ids = [...new Set(rosters.flatMap(roster => Array.isArray(roster?.players) ? roster.players.map(String) : []))];
  const list = ids.map(id => {
    const meta = players[id] || projectionById.get(id)?.player || {};
    const position = playerPosition(meta);
    const priorLine = previousStats[id] || null;
    const projection = projectionById.get(id) || null;
    const lastPoints = priorLine ? scorePlayer(priorLine, scoringSettings) : null;
    const projectedPoints = projection?.stats ? scorePlayer(projection.stats, scoringSettings) : null;
    const games = finite(priorLine?.gp);
    const seasonGames = games != null && games > 0 ? Math.min(17, games) : 17;
    const hasPriorProduction = lastPoints != null && lastPoints > 0;
    const priorPace = hasPriorProduction ? lastPoints / Math.max(1, seasonGames) * 17 : null;
    const priorReliability = games == null ? 1 : Math.max(.25, Math.min(1, games / 17));
    const projectionWeight = .74 + (1 - priorReliability) * .14;
    const expectedPoints = projectedPoints != null && priorPace != null
      ? projectedPoints * projectionWeight + priorPace * (1 - projectionWeight)
      : projectedPoints ?? priorPace;
    return {
      id,
      name: meta?.n || meta?.full_name || id,
      position,
      nflTeam: meta?.t || meta?.team || "FA",
      lastPoints: finite(lastPoints),
      priorPace: finite(priorPace),
      projectedPoints: finite(projectedPoints),
      expectedPoints: finite(expectedPoints),
      adp: adpFrom(projection, scoringFormat),
      games,
      hasPriorProduction,
    };
  }).filter(player => ANALYZER_POSITIONS.includes(player.position));

  const productionPercentile = new Map();
  for (const position of ANALYZER_POSITIONS) {
    const positional = list.filter(player => player.position === position);
    for (const [id, value] of percentileMap(positional, player => player.expectedPoints)) productionPercentile.set(id, value);
  }
  const marketPercentile = percentileMap(list, player => player.adp, { lowerIsBetter: true });
  const positionRanks = new Map();
  for (const position of ANALYZER_POSITIONS) {
    const ordered = list.filter(player => player.position === position)
      .sort((a, b) => (b.expectedPoints || 0) - (a.expectedPoints || 0));
    ordered.forEach((player, index) => positionRanks.set(player.id, { rank: index + 1, count: ordered.length }));
  }

  const pool = new Map();
  for (const player of list) {
    const production = productionPercentile.get(player.id);
    const market = marketPercentile.get(player.id);
    const known = [production, market].filter(value => value != null);
    const value = known.length === 2 ? production * 0.68 + market * 0.32
      : known.length ? known[0] : 0;
    const expectedPerGame = (player.expectedPoints || 0) / 17;
    const lastPerGame = player.hasPriorProduction ? player.lastPoints / Math.max(1, player.games || 17) : null;
    pool.set(player.id, {
      ...player,
      expectedPoints: player.expectedPoints == null ? 0 : round(player.expectedPoints, 2),
      expectedPerGame: round(expectedPerGame, 2),
      lastPerGame: lastPerGame == null ? null : round(lastPerGame, 2),
      trend: lastPerGame == null ? "new" : expectedPerGame - lastPerGame > 1.25 ? "up"
        : lastPerGame - expectedPerGame > 1.25 ? "down" : "steady",
      positionRank: positionRanks.get(player.id)?.rank || null,
      positionCount: positionRanks.get(player.id)?.count || null,
      tradeValue: Math.max(1, Math.min(100, Math.round(value * 99 + 1))),
    });
  }
  return pool;
}

function sortedPlayers(ids, pool, position = null) {
  return (ids || []).map(String).map(id => pool.get(id)).filter(Boolean)
    .filter(player => !position || player.position === position)
    .sort((a, b) => b.expectedPoints - a.expectedPoints || b.tradeValue - a.tradeValue || a.name.localeCompare(b.name));
}

function setLineup(playerIds, starterIds, pool) {
  const roster = new Set((playerIds || []).map(String));
  const starters = (starterIds || []).map(String).filter(id => roster.has(id)).map(id => pool.get(id)).filter(Boolean)
    .filter(player => ANALYZER_POSITIONS.includes(player.position));
  const counts = Object.fromEntries(ANALYZER_POSITIONS.map(position => [position, starters.filter(player => player.position === position).length]));
  const legal = starters.length === 7 && counts.QB === 1 && counts.TE === 1 && counts.RB >= 2 && counts.WR >= 2;
  if (!legal) return null;
  const baseCounts = { QB: 0, RB: 0, WR: 0, TE: 0 };
  let flexId = null;
  for (const player of starters) {
    if (baseCounts[player.position] < STARTERS[player.position]) baseCounts[player.position]++;
    else if (FLEX_POSITIONS.has(player.position)) flexId = player.id;
  }
  return { starters, flexId };
}

export function optimalLineup(playerIds = [], pool = new Map(), { starterIds = [] } = {}) {
  const used = new Set();
  const set = setLineup(playerIds, starterIds, pool);
  const starters = set?.starters || [];
  let flexId = set?.flexId || null;
  if (set) starters.forEach(player => used.add(player.id));
  else {
    for (const position of ANALYZER_POSITIONS) {
      sortedPlayers(playerIds, pool, position).slice(0, STARTERS[position]).forEach(player => {
        used.add(player.id);
        starters.push(player);
      });
    }
    const flex = sortedPlayers(playerIds, pool).filter(player => FLEX_POSITIONS.has(player.position) && !used.has(player.id))[0];
    if (flex) { used.add(flex.id); starters.push(flex); flexId = flex.id; }
  }
  const bench = sortedPlayers(playerIds, pool).filter(player => !used.has(player.id));
  const starterPoints = starters.reduce((sum, player) => sum + player.expectedPoints, 0);
  /*
    SLEEPER'S OWN NUMBER, CARRIED SEPARATELY.

    expectedPoints is a blend - Sleeper's projection weighted against last
    season's pace - and that blend is this app's opinion, not Sleeper's. Where
    the two disagree is worth being able to see, so the unblended total rides
    alongside rather than replacing anything. Null-safe: a lineup of players
    Sleeper has not projected reports nothing rather than a hollow zero.
  */
  const projected = starters.map(player => player.projectedPoints).filter(value => value != null);
  const sleeperPoints = projected.length ? projected.reduce((sum, value) => sum + value, 0) : null;
  const depthScore = bench.slice(0, 5).reduce((sum, player, index) => sum + player.expectedPoints * DEPTH_WEIGHTS[index], 0);
  return {
    starters,
    bench,
    flexId,
    source: set ? "set" : "optimized",
    starterPoints: round(starterPoints),
    sleeperStarterPoints: sleeperPoints == null ? null : round(sleeperPoints),
    sleeperWeeklyPoints: sleeperPoints == null ? null : round(sleeperPoints / 17),
    sleeperProjectedCount: projected.length,
    depthScore: round(depthScore),
    score: round(starterPoints),
    weeklyPoints: round(starterPoints / 17),
  };
}

function grade(percentile) {
  if (percentile >= .92) return "A+";
  if (percentile >= .82) return "A";
  if (percentile >= .72) return "A−";
  if (percentile >= .62) return "B+";
  if (percentile >= .52) return "B";
  if (percentile >= .42) return "B−";
  if (percentile >= .32) return "C+";
  if (percentile >= .22) return "C";
  if (percentile >= .12) return "C−";
  return "D";
}

function percentileAt(sorted, value) {
  if (sorted.length <= 1) return 1;
  const below = sorted.filter(other => other < value).length;
  const tied = sorted.filter(other => other === value).length;
  return Math.max(0, Math.min(1, (below + Math.max(0, tied - 1) / 2) / (sorted.length - 1)));
}

export function analyzeLeague({ rosters = [], pool = new Map() } = {}) {
  const base = rosters.map(roster => {
    const ids = Array.isArray(roster.players) ? roster.players.map(String) : [];
    const lineup = optimalLineup(ids, pool, { starterIds: Array.isArray(roster.starters) ? roster.starters : [] });
    const unitScores = Object.fromEntries(ANALYZER_POSITIONS.map(position => {
      const options = lineup.starters.filter(player => player.position === position)
        .sort((a, b) => b.expectedPoints - a.expectedPoints).slice(0, STARTERS[position]);
      const score = options.reduce((sum, player) => sum + player.expectedPoints, 0);
      return [position, round(score)];
    }));
    unitScores.FLEX = round(lineup.starters.find(player => player.id === lineup.flexId)?.expectedPoints || 0);
    const rosterValue = sortedPlayers(ids, pool).slice(0, 12).reduce((sum, player) => sum + player.tradeValue, 0);
    return { ...roster, id: String(roster.roster_id ?? roster.id), playerIds: ids, lineup, positionScores: unitScores, rosterValue };
  });
  const depthScores = base.map(team => team.lineup.depthScore).sort((a, b) => a - b);
  const rosterValues = base.map(team => team.rosterValue).sort((a, b) => a - b);
  const positionDistributions = Object.fromEntries(ANALYZER_UNITS.map(position => [position,
    base.map(team => team.positionScores[position]).sort((a, b) => a - b)]));
  const rated = base.map(team => {
    /* A starter grade summarizes the five units members can inspect below.
       Equal unit weight prevents a high-scoring position such as RB or QB from
       overpowering several weaker units simply because its raw scale is larger. */
    const unitPercentiles = Object.fromEntries(ANALYZER_UNITS.map(position => [position,
      percentileAt(positionDistributions[position], team.positionScores[position])]));
    const starterPercentile = ANALYZER_UNITS.reduce((sum, position) => sum + unitPercentiles[position], 0) / ANALYZER_UNITS.length;
    const depthPercentile = percentileAt(depthScores, team.lineup.depthScore);
    const valuePercentile = percentileAt(rosterValues, team.rosterValue);
    return { ...team, unitPercentiles, starterPercentile, depthPercentile, valuePercentile,
      overallPercentile: starterPercentile * .72 + depthPercentile * .18 + valuePercentile * .1 };
  });
  const ordered = [...rated].sort((a, b) => b.lineup.starterPoints - a.lineup.starterPoints || a.id.localeCompare(b.id));
  return ordered.map((team, index) => {
    const positionGrades = Object.fromEntries(ANALYZER_UNITS.map(position => [position, {
      score: team.positionScores[position],
      leagueRank: 1 + base.filter(other => other.positionScores[position] > team.positionScores[position]).length,
      leagueSize: base.length,
      percentile: team.unitPercentiles[position],
      grade: grade(team.unitPercentiles[position]),
      starters: position === "FLEX"
        ? team.lineup.starters.filter(player => player.id === team.lineup.flexId)
        : team.lineup.starters.filter(player => player.position === position)
          .sort((a, b) => b.expectedPoints - a.expectedPoints).slice(0, STARTERS[position]),
      depth: position === "FLEX" ? [] : team.lineup.bench.filter(player => player.position === position).slice(0, 2),
    }]));
    const rankedPositions = ANALYZER_POSITIONS.map(position => ({ position, ...positionGrades[position] }))
      .sort((a, b) => b.percentile - a.percentile || a.leagueRank - b.leagueRank);
    const need = [...rankedPositions].reverse().find(unit => unit.percentile < .32)?.position || null;
    return {
      ...team,
      rank: index + 1,
      overallRank: 1 + rated.filter(other => other.overallPercentile > team.overallPercentile).length,
      grade: grade(team.starterPercentile),
      starterGrade: grade(team.starterPercentile),
      depthGrade: grade(team.depthPercentile),
      overallGrade: grade(team.overallPercentile),
      positionGrades,
      strength: rankedPositions[0]?.position || null,
      lowestUnit: rankedPositions.at(-1)?.position || null,
      weakness: need,
      need,
    };
  });
}

function packageValue(ids, recipientIds, pool) {
  const incoming = sortedPlayers(ids, pool).sort((a, b) => b.tradeValue - a.tradeValue);
  if (!incoming.length) return 0;
  const cutLine = sortedPlayers(recipientIds, pool).sort((a, b) => a.tradeValue - b.tradeValue);
  return round(incoming.reduce((sum, player, index) => {
    if (index === 0) return sum + player.tradeValue;
    const displaced = cutLine[index - 1]?.tradeValue || 0;
    return sum + Math.max(0, player.tradeValue - displaced) * .65;
  }, 0));
}

export function evaluateTrade({ teamA, teamB, sendA = [], sendB = [], pool = new Map() } = {}) {
  if (!teamA || !teamB || !sendA.length || !sendB.length) return null;
  const aSet = new Set(teamA.playerIds.map(String)), bSet = new Set(teamB.playerIds.map(String));
  if (sendA.some(id => !aSet.has(String(id))) || sendB.some(id => !bSet.has(String(id)))) return null;
  const nextA = teamA.playerIds.filter(id => !sendA.map(String).includes(String(id))).concat(sendB.map(String));
  const nextB = teamB.playerIds.filter(id => !sendB.map(String).includes(String(id))).concat(sendA.map(String));
  const beforeA = optimalLineup(teamA.playerIds, pool), beforeB = optimalLineup(teamB.playerIds, pool);
  const afterA = optimalLineup(nextA, pool), afterB = optimalLineup(nextB, pool);
  const valueToA = packageValue(sendB, nextA, pool), valueToB = packageValue(sendA, nextB, pool);
  const high = Math.max(valueToA, valueToB, 1);
  return {
    sendA: sendA.map(String), sendB: sendB.map(String),
    deltaA: round(afterA.score - beforeA.score),
    deltaB: round(afterB.score - beforeB.score),
    weeklyDeltaA: round((afterA.starterPoints - beforeA.starterPoints) / 17),
    weeklyDeltaB: round((afterB.starterPoints - beforeB.starterPoints) / 17),
    valueToA, valueToB,
    fairness: Math.max(0, Math.round(100 - Math.abs(valueToA - valueToB) / high * 100)),
  };
}

export function evaluateMultiTeamTrade({ teams = [], sends = [], pool = new Map() } = {}) {
  if (teams.length < 2 || teams.length !== sends.length || teams.some(team => !team || !Array.isArray(team.playerIds))
    || new Set(teams.map(team => String(team.id))).size !== teams.length) return null;
  const packages = sends.map(ids => (ids || []).map(String));
  if (packages.some(ids => !ids.length) || teams.some((team, index) => {
    const owned = new Set(team.playerIds.map(String));
    return packages[index].some(id => !owned.has(id));
  })) return null;
  const count = teams.length;
  const next = teams.map((team, index) => team.playerIds.filter(id => !packages[index].includes(String(id)))
    .concat(packages[(index + count - 1) % count]));
  const before = teams.map(team => optimalLineup(team.playerIds, pool));
  const after = next.map(ids => optimalLineup(ids, pool));
  const values = teams.map((_, index) => packageValue(packages[(index + count - 1) % count], next[index], pool));
  const high = Math.max(...values, 1), low = Math.min(...values);
  const weekly = teams.map((_, index) => round((after[index].starterPoints - before[index].starterPoints) / 17));
  return {
    sends: packages, values, weeklyDeltas: weekly,
    deltas: teams.map((_, index) => round(after[index].score - before[index].score)),
    fairness: Math.max(0, Math.round(low / high * 100)),
  };
}

export function evaluateThreeWayTrade({ teamA, teamB, teamC, sendA = [], sendB = [], sendC = [], pool = new Map() } = {}) {
  const result = evaluateMultiTeamTrade({ teams: [teamA, teamB, teamC], sends: [sendA, sendB, sendC], pool });
  if (!result) return null;
  return {
    ...result,
    sendA: result.sends[0], sendB: result.sends[1], sendC: result.sends[2],
    valueToA: result.values[0], valueToB: result.values[1], valueToC: result.values[2], valueOutA: result.values[1],
    weeklyDeltaA: result.weeklyDeltas[0], weeklyDeltaB: result.weeklyDeltas[1], weeklyDeltaC: result.weeklyDeltas[2],
    deltaA: result.deltas[0], deltaB: result.deltas[1], deltaC: result.deltas[2],
  };
}

/**
 * Search realistic one-for-one, one-for-two and two-for-one structures. A
 * package is judged after roster cuts; extra names do not receive free value.
 */
export function suggestTrades({ teams = [], teamId, playerId, playerIds, partnerId, anchorTeamId, pool = new Map(), limit = 6 } = {}) {
  const mine = teams.find(team => String(team.id) === String(teamId));
  if (!mine) return [];
  const anchorId = String(anchorTeamId ?? teamId);
  const anchorTeam = teams.find(team => String(team.id) === anchorId);
  const anchors = (playerIds?.length ? playerIds : [playerId]).filter(Boolean).map(String).slice(0, 2);
  if (!anchorTeam || !anchors.length || anchors.some(id => !anchorTeam.playerIds.map(String).includes(id))) return [];
  if (anchorId !== String(mine.id) && partnerId && String(partnerId) !== anchorId) return [];
  const partners = anchorId === String(mine.id)
    ? teams.filter(team => String(team.id) !== String(mine.id) && (!partnerId || String(team.id) === String(partnerId)))
    : [anchorTeam];
  const possibilities = [];
  for (const other of partners) {
    const targets = sortedPlayers(other.playerIds, pool).sort((a, b) => b.tradeValue - a.tradeValue).slice(0, 9);
    const mineTargets = sortedPlayers(mine.playerIds, pool).sort((a, b) => b.tradeValue - a.tradeValue).slice(0, 9);
    if (anchorId === String(mine.id)) {
      for (const target of targets) possibilities.push({ other, sendA: anchors, sendB: [target.id] });
      for (let i = 0; i < Math.min(7, targets.length); i++) {
        for (let j = i + 1; j < Math.min(7, targets.length); j++) possibilities.push({ other, sendA: anchors, sendB: [targets[i].id, targets[j].id] });
      }
    } else {
      for (const target of mineTargets) possibilities.push({ other, sendA: [target.id], sendB: anchors });
      for (let i = 0; i < Math.min(7, mineTargets.length); i++) {
        for (let j = i + 1; j < Math.min(7, mineTargets.length); j++) possibilities.push({ other, sendA: [mineTargets[i].id, mineTargets[j].id], sendB: anchors });
      }
    }
  }
  return possibilities.map(candidate => {
    const result = evaluateTrade({ teamA: mine, teamB: candidate.other, sendA: candidate.sendA, sendB: candidate.sendB, pool });
    if (!result) return null;
    const balancePenalty = Math.abs(result.deltaA - result.deltaB);
    const score = result.fairness + (result.deltaA + result.deltaB) * 2 - balancePenalty;
    return { ...candidate, ...result, score };
  }).filter(Boolean)
    /* A seasonal delta of 30 points is under two points per week. Keep that
       much negotiating room; stricter filtering made positional swaps vanish
       even when both packages were fairly valued. */
    .filter(result => result.fairness >= 66 && result.deltaA >= -30 && result.deltaB >= -30)
    .sort((a, b) => b.score - a.score || b.fairness - a.fairness)
    .filter((result, index, all) => index === all.findIndex(other => String(other.other.id) === String(result.other.id)
      && other.sendA.join(",") === result.sendA.join(",") && other.sendB.join(",") === result.sendB.join(",")))
    .slice(0, limit);
}

export function compareTeams(teamA, teamB) {
  if (!teamA || !teamB) return null;
  return {
    teamA, teamB,
    scoreEdge: round(teamA.lineup.score - teamB.lineup.score),
    weeklyEdge: round(teamA.lineup.weeklyPoints - teamB.lineup.weeklyPoints),
    positions: ANALYZER_UNITS.map(position => ({
      position,
      a: teamA.positionGrades[position],
      b: teamB.positionGrades[position],
      winner: teamA.positionGrades[position].score === teamB.positionGrades[position].score ? null
        : teamA.positionGrades[position].score > teamB.positionGrades[position].score ? "a" : "b",
    })),
  };
}

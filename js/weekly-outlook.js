// =====================================================================
// weekly-outlook.js - who to start THIS week, and why
// ---------------------------------------------------------------------
// team-analyzer.js answers "how good is this roster over a season". That is
// the right question in July and the wrong one on a Saturday, when the only
// thing that matters is which eleven names go in the lineup tomorrow.
//
// This module is season-blind on purpose. A season-long stud on a bye is
// worth nothing this week; a WR3 against the league's most generous
// secondary is worth a lot. Those two facts are invisible to a season model
// and decisive to a weekly one.
//
// WHAT IT WILL NOT DO IS PRETEND. Three rules, because a lineup tool that
// bluffs is worse than none:
//
//   1. A player with no projection for this week is UNKNOWN, never zero. A
//      missing row means Sleeper has not published one, not that he will
//      score nothing, and scoring it as zero would bench a healthy starter.
//   2. Advice is only given when the margin clears a threshold. Weekly
//      projections are not precise to a tenth of a point, so presenting a
//      0.2 gap as a start/sit call invents certainty nobody has.
//   3. Every recommendation carries its reason and its margin, so the
//      manager overrules it with better information than it had.
//
// Pure functions, no fetching and no DOM - see sleeper.js for the data and
// weekly-outlook-panel.js for the rendering.
// =====================================================================

import { scorePlayer } from "./dfl-scoring.js";

/* The lineup this league actually submits. Mirrors team-analyzer.js so the
   two cannot disagree about what a legal lineup is. */
export const WEEKLY_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1 };
export const FLEX_ELIGIBLE = new Set(["RB", "WR", "TE"]);

/* Below this, the projections are not telling us anything we should act on. */
export const SWAP_THRESHOLD = 1.5;

/* Sleeper's own words for "this man may not play". */
const OUT_STATUSES = new Set(["Out", "IR", "PUP", "Sus", "NA", "DNR"]);
const RISKY_STATUSES = new Set(["Questionable", "Doubtful"]);

const num = value => (Number.isFinite(Number(value)) ? Number(value) : null);
const idOf = row => (row?.player_id == null ? "" : String(row.player_id));

/**
 * Fold one week of Sleeper projection rows into a per-player view.
 *
 * @param {Object[]} rows            raw rows from loadWeeklyProjections()
 * @param {Object}   scoringSettings the league's own scoring
 * @returns {Map<string, Object>}
 */
export function buildWeeklyPool(rows = [], scoringSettings = null) {
  const pool = new Map();
  for (const row of rows || []) {
    const id = idOf(row);
    if (!id) continue;
    const meta = row.player || {};
    const position = String(meta.position || "").toUpperCase();
    const status = row.injury_status || meta.injury_status || null;
    /* gp is Sleeper's own "is he playing this week" flag, but it is absent
       for most rows: of 3,114 week-1 rows only ~400 carry a real projection,
       and those are exactly the ones naming an opponent. The rest score 0
       against nobody - filler that would otherwise sit in a lineup slot
       looking like advice. No opponent and no gp means not scheduled. */
    const games = num(row.stats?.gp);
    const opponent = row.opponent || null;
    pool.set(id, {
      id,
      position,
      name: [meta.first_name, meta.last_name].filter(Boolean).join(" ") || id,
      team: row.team || meta.team || null,
      opponent,
      week: num(row.week),
      points: row.stats ? scorePlayer(row.stats, scoringSettings) : null,
      injuryStatus: status,
      isOut: OUT_STATUSES.has(String(status)),
      isRisky: RISKY_STATUSES.has(String(status)),
      hasGame: games == null ? Boolean(opponent) : games > 0,
    });
  }
  return pool;
}

/**
 * How generous each defense is this week, in points conceded to the
 * positions we score.
 *
 * Derived from the same payload rather than a second source: every
 * projection names its opponent, so summing projections BY opponent is the
 * league's own consensus on how much that defense will give up. A defense
 * facing a good offense looks generous here, which is the honest reading -
 * it is a matchup rating, not a defensive grade.
 *
 * @returns {Map<string, {points:number, byPosition:Object, rank:number, count:number}>}
 */
export function defenseDifficulty(pool = new Map()) {
  const totals = new Map();
  for (const player of pool.values()) {
    if (!player.opponent || player.points == null || !player.hasGame) continue;
    const entry = totals.get(player.opponent)
      || { points: 0, byPosition: {}, opponent: player.opponent };
    entry.points += player.points;
    entry.byPosition[player.position] = (entry.byPosition[player.position] || 0) + player.points;
    totals.set(player.opponent, entry);
  }
  const ordered = [...totals.values()].sort((a, b) => b.points - a.points);
  const out = new Map();
  ordered.forEach((entry, index) => {
    out.set(entry.opponent, { ...entry, rank: index + 1, count: ordered.length });
  });
  return out;
}

/** A player's matchup, phrased for a human. Null when we cannot tell. */
export function matchupNote(player, defense = new Map()) {
  if (!player?.opponent) return null;
  const entry = defense.get(player.opponent);
  if (!entry || !entry.count) return null;
  /* Normalised position, not rank/count: with rank/count the best of two
     defenses scores 0.5 and reads "good" when it is the softest matchup on
     the board. This puts rank 1 at 0 and last at 1 whatever the sample. */
  const share = entry.count <= 1 ? 0 : (entry.rank - 1) / (entry.count - 1);
  const tone = share <= .25 ? "great" : share <= .5 ? "good" : share <= .75 ? "tough" : "brutal";
  return { tone, rank: entry.rank, count: entry.count, opponent: player.opponent };
}

/* A player we cannot rate is not a player worth benching somebody for. */
function playable(entry) {
  return !!entry && entry.points != null && entry.hasGame && !entry.isOut;
}

/**
 * Score a candidate for a slot.
 *
 * THE PROJECTION IS THE PROJECTION. This used to haircut Questionable and
 * Doubtful players by 12% before ranking them, which was wrong twice over:
 * Sleeper's projection already prices expected availability, so the discount
 * double-counted it with a cruder model than theirs - and it did so silently,
 * reordering the lineup behind the manager's back.
 *
 * It produced exactly the nonsense you would expect. In week 1, Tucker Kraft
 * projected 10.86 against Juwan Johnson's 10.43; the haircut took Kraft to
 * 9.56 and started Johnson. Kraft's "Questionable" carried no injury start
 * date at all - a soft preseason tag, not a gameday designation.
 *
 * So availability is now binary. A player who CANNOT play is excluded by
 * playable(); everyone else is ranked on the published number, and the flag is
 * surfaced next to them for a human to weigh. A tool that quietly moves a
 * projection is harder to trust than one that shows it and says "he is
 * questionable".
 */
function effectivePoints(entry) {
  if (!playable(entry)) return null;
  return entry.points;
}

function slotCandidates(playerIds, weekly, position) {
  return playerIds
    .map(id => weekly.get(String(id)))
    .filter(entry => entry && (position === "FLEX"
      ? FLEX_ELIGIBLE.has(entry.position)
      : entry.position === position))
    .map(entry => ({ entry, score: effectivePoints(entry) }))
    .filter(row => row.score != null)
    .sort((a, b) => b.score - a.score);
}

/**
 * The best legal lineup for this week, filled highest-scoring slot first so
 * a flex never steals a player a dedicated slot needed.
 *
 * @returns {{slots:Object[], total:number, unknown:Object[]}}
 */
export function bestWeeklyLineup(playerIds = [], weekly = new Map()) {
  const used = new Set();
  const slots = [];
  const take = (position) => {
    const pick = slotCandidates(playerIds, weekly, position)
      .find(row => !used.has(row.entry.id));
    if (pick) used.add(pick.entry.id);
    slots.push({ position, player: pick?.entry || null, score: pick?.score ?? null });
  };
  for (const [position, count] of Object.entries(WEEKLY_STARTERS)) {
    for (let i = 0; i < count; i += 1) take(position);
  }
  take("FLEX");
  const total = slots.reduce((sum, slot) => sum + (slot.score || 0), 0);
  const unknown = playerIds
    .map(id => weekly.get(String(id)))
    .filter(entry => entry && !playable(entry));
  return { slots, total, unknown };
}

/**
 * What to change about the lineup that is currently submitted.
 *
 * Compares the submitted starters against the best legal lineup and reports
 * only the moves worth making - see SWAP_THRESHOLD. Returns the swaps, the
 * points left on the bench, and anything in the lineup that cannot play.
 *
 * @param {Object} input
 * @param {string[]} input.playerIds   every player on the roster
 * @param {string[]} input.starterIds  the lineup as submitted
 * @param {Map} input.weekly           from buildWeeklyPool()
 * @param {Map} input.defense          from defenseDifficulty()
 */
export function startSitAdvice({ playerIds = [], starterIds = [], weekly = new Map(),
                                 defense = new Map() } = {}) {
  const roster = playerIds.map(String);
  const submitted = starterIds.map(String).filter(id => weekly.has(id));
  const best = bestWeeklyLineup(roster, weekly);

  const submittedTotal = submitted
    .reduce((sum, id) => sum + (effectivePoints(weekly.get(id)) || 0), 0);

  const bestIds = new Set(best.slots.map(slot => slot.player?.id).filter(Boolean));
  const submittedSet = new Set(submitted);

  /* Somebody in the lineup who cannot play is not a "close call" - it is the
     single most valuable thing this screen can tell a manager, so it is
     reported separately and never filtered by the margin. */
  const alarms = submitted
    .map(id => weekly.get(id))
    .filter(entry => entry && (entry.isOut || !entry.hasGame))
    .map(entry => ({
      player: entry,
      reason: !entry.hasGame ? "no game this week" : `listed ${entry.injuryStatus}`,
    }));

  const benchedGems = [...bestIds].filter(id => !submittedSet.has(id))
    .map(id => weekly.get(id)).filter(Boolean);
  const startersToSit = submitted.filter(id => !bestIds.has(id))
    .map(id => weekly.get(id)).filter(Boolean);

  /* Pair them off by slot value, best gain first. */
  const swaps = [];
  const outPool = [...startersToSit].sort((a, b) => (effectivePoints(a) || 0) - (effectivePoints(b) || 0));
  const inPool = [...benchedGems].sort((a, b) => (effectivePoints(b) || 0) - (effectivePoints(a) || 0));
  for (const incoming of inPool) {
    const slotFor = incoming.position;
    const index = outPool.findIndex(out =>
      out.position === slotFor || FLEX_ELIGIBLE.has(out.position) && FLEX_ELIGIBLE.has(slotFor));
    if (index === -1) continue;
    const outgoing = outPool.splice(index, 1)[0];
    const gain = (effectivePoints(incoming) || 0) - (effectivePoints(outgoing) || 0);
    const blocked = outgoing.isOut || !outgoing.hasGame;
    if (gain < SWAP_THRESHOLD && !blocked) continue;
    swaps.push({
      in: incoming, out: outgoing, gain,
      urgent: blocked,
      matchupIn: matchupNote(incoming, defense),
      matchupOut: matchupNote(outgoing, defense),
    });
  }

  return {
    swaps: swaps.sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.gain - a.gain),
    alarms,
    submittedTotal,
    bestTotal: best.total,
    pointsOnBench: Math.max(0, best.total - submittedTotal),
    lineup: best,
    lineupIsSet: submitted.length > 0,
  };
}

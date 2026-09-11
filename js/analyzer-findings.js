// =====================================================================
// analyzer-findings.js - what the report FOUND, as sentences
// ---------------------------------------------------------------------
// The Team Analyzer already knew everything on this page. It printed three
// grade cards, four KPIs and a top asset - eight numbers at the same size,
// none of them a headline - and then seven tables, and left the reader to
// do the ranking themselves. "Is my team good, and what is wrong with it"
// was answerable only by reading all of it.
//
// So this module does the ranking. It looks at the same team object the
// tables are drawn from and returns the four things most worth saying,
// each with the figure that supports it and a link to the evidence.
//
// THREE RULES IT KEEPS
//
//   1. NOTHING IS INVENTED. Every number in every sentence comes off the
//      team, the league or the simulation. Where a comparison is made -
//      "behind the league median" - the median is computed from the other
//      teams that are actually on screen, not from a constant.
//   2. A FINDING EARNS ITS PLACE. Each candidate carries a weight, they
//      are sorted, and four survive. A roster with no weak unit does not
//      get a made-up weakness; it gets whatever was true instead.
//   3. NO FINDING IS A SURPRISE. Every one of them is visible in a table
//      further down the page, and says which one. The briefing is a route
//      into the report, not a replacement for it.
//
// Pure: no DOM, no fetch, no formatting beyond the sentences themselves,
// so the ranking can be tested without a browser.
// =====================================================================

import { ANALYZER_UNITS } from "./team-analyzer.js";
import { DEFAULT_RUNS, REGULAR_SEASON_WEEKS } from "./season-outlook.js";

const pct = value => Math.round((Number(value) || 0) * 100);
const num = value => Number(value) || 0;
export const ordinal = value => {
  const n = Number(value), mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`;
};
const teamName = team => team?.team_name || team?.ownerName || `Team ${team?.roster_id || ""}`;
const unitWord = position => (position === "FLEX" ? "flex" : position);

/* The middle of the league for one starting unit, from the teams on screen
   rather than a constant - a 10-team league and a 14-team league do not have
   the same middle, and neither does the same league after a trade. */
function medianUnitScore(teams, position) {
  const scores = teams
    .map(team => Number(team?.positionGrades?.[position]?.score))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!scores.length) return null;
  const mid = Math.floor(scores.length / 2);
  return scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
}

function units(team) {
  return ANALYZER_UNITS
    .map(position => ({ position, ...(team?.positionGrades?.[position] || {}) }))
    .filter(unit => Number.isFinite(Number(unit.percentile)))
    .sort((a, b) => b.percentile - a.percentile);
}

/*
  THE ONE-LINE VERDICT.

  Two clauses, both earned: what the roster is, and what is holding it back.
  outlookSentence() in season-outlook.js already writes the season in this
  voice; this is the same idea about the ROSTER, which is what the analyzer
  is actually a report on.
*/
export function verdictLine(team, projection, weakest) {
  const shape = !projection ? "Not enough of the league has synced to place this roster"
    : projection.titleOdds >= .18 ? "A contender"
    : projection.playoffOdds >= .6 ? "A playoff roster"
    : projection.playoffOdds >= .3 ? "On the bubble"
    : projection.lastOdds >= .15 ? "In trouble"
    : "Outside the eight";
  if (!projection) return `${shape}.`;
  const held = weakest && weakest.percentile <= .4 ? `, held back by the ${unitWord(weakest.position)}` : "";
  return `${shape}${held}.`;
}

/**
 * The four things most worth saying about one roster.
 *
 * @returns {{verdict: string, findings: Array<{key,tone,title,copy,action}>}}
 */
export function buildFindings({ team, teams = [], projections = new Map(), limit = 4 } = {}) {
  if (!team) return { verdict: "", findings: [] };
  const all = units(team);
  const best = all[0], worst = all.at(-1);
  const projection = projections.get?.(String(team.id)) || null;
  const candidates = [];

  /* ---- the strength -------------------------------------------------- */
  if (best && best.percentile >= .68) {
    const star = best.starters?.[0];
    const first = best.leagueRank === 1;
    candidates.push({
      key: "strength",
      tone: "good",
      title: first
        ? `Your ${unitWord(best.position)} is the best in the league`
        : `Your ${unitWord(best.position)} is a real strength`,
      copy: `Grades ${best.grade} at the ${ordinal(pct(best.percentile))} percentile`
        + (star?.name && star?.positionRank
          ? ` — ${star.name} is ${star.position}${star.positionRank} of ${star.positionCount} rated.`
          : `, ${ordinal(best.leagueRank)} of ${best.leagueSize} in the league.`),
      action: { label: "See the unit grades", href: "#units" },
      /* Below the weakness band on purpose. A briefing exists to say what to
         DO, and the weak unit is the finding with an action attached - but a
         league-best unit will still outrank a merely marginal weakness, which
         is the right way round for a roster whose problem is small. */
      weight: 56 + best.percentile * 40 + (first ? 8 : 0),
    });
  }

  /* ---- the weakness, and what it costs -------------------------------- */
  if (worst && worst.percentile <= .42) {
    const median = medianUnitScore(teams, worst.position);
    const gap = median === null ? null : (median - num(worst.score)) / REGULAR_SEASON_WEEKS;
    candidates.push({
      key: "weakness",
      tone: worst.percentile <= .25 ? "bad" : "warn",
      title: `The ${unitWord(worst.position)} is the ${ordinal(pct(worst.percentile))} percentile`,
      copy: `Grades ${worst.grade}, ${ordinal(worst.leagueRank)} of ${worst.leagueSize}.`
        + (gap !== null && gap > .2
          ? ` It is about ${gap.toFixed(1)} points a week behind the league median.`
          : " It is the one starting slot where the league is beating you."),
      action: { label: `Shop for ${worst.position === "FLEX" ? "a flex" : `a ${worst.position}`}`, href: `#/trade?team=${team.id}` },
      weight: 78 + (1 - worst.percentile) * 40,
    });
  }

  /* ---- starters against depth ----------------------------------------- */
  const spread = num(team.starterPercentile) - num(team.depthPercentile);
  if (spread >= .22) {
    candidates.push({
      key: "thin",
      tone: "warn",
      title: `Depth is ${team.depthGrade} behind a ${team.starterGrade} starting lineup`,
      copy: "Fine while everyone plays. An injury to a starter costs more here than on most rosters in the league,"
        + ` because the bench grades in the ${ordinal(pct(team.depthPercentile))} percentile.`,
      action: { label: "See the full roster", href: "#roster" },
      weight: 50 + spread * 60,
    });
  } else if (num(team.depthPercentile) >= .78 && spread <= -.15) {
    candidates.push({
      key: "deep",
      tone: "good",
      title: `The bench grades ${team.depthGrade}, better than the starters`,
      copy: `Depth is in the ${ordinal(pct(team.depthPercentile))} percentile against a ${team.starterGrade} starting lineup.`
        + " There is a starter in here being left out, or a trade to make from surplus.",
      action: { label: "See the full roster", href: "#roster" },
      weight: 48 + num(team.depthPercentile) * 20,
    });
  }

  /* ---- what the simulation says --------------------------------------- */
  if (projection) {
    const ranked = [...projections.entries()].sort((a, b) => b[1].titleOdds - a[1].titleOdds);
    const titleRank = 1 + ranked.findIndex(([id]) => String(id) === String(team.id));
    const favourite = teams.find(other => String(other.id) === String(ranked[0]?.[0]));
    const leader = favourite && String(favourite.id) !== String(team.id)
      ? ` ${teamName(favourite)} leads at ${pct(ranked[0][1].titleOdds)}%.`
      : " Nobody in the league is better placed.";
    candidates.push({
      key: "title",
      tone: projection.titleOdds >= .18 ? "good" : "neutral",
      /* The rank clause only when the odds are worth ranking. In a small
         league a 1% roster can be "2nd best", which is true and reads as
         nonsense next to the 1%. */
      title: `${pct(projection.titleOdds)}% to win it${titleRank > 0 && titleRank <= 3 && projection.titleOdds >= .08 ? `, ${ordinal(titleRank)} best odds` : ""}`,
      copy: `${DEFAULT_RUNS.toLocaleString()} simulated ${REGULAR_SEASON_WEEKS}-week seasons put this roster at `
        + `${projection.wins}-${projection.losses} and the ${ordinal(Math.round(projection.seed))} seed.${leader}`,
      action: { label: "See the projected table", href: "#league" },
      /* A floor, because the odds are the model's headline output and a
         briefing that never mentions them is hiding the answer. */
      weight: 55,
    });

    if (projection.lastOdds >= .12) {
      candidates.push({
        key: "chip",
        tone: "bad",
        title: `${pct(projection.lastOdds)}% to finish last`,
        copy: `The Chip Eater is decided in the losers bracket, and this roster is ${pct(projection.lastOdds)}% to get there.`,
        action: { label: "See the projected table", href: "#league" },
        weight: 60 + projection.lastOdds * 80,
      });
    }
    if (projection.playoffOdds >= .85) {
      candidates.push({
        key: "lock",
        tone: "good",
        title: `${pct(projection.playoffOdds)}% to make the bracket`,
        copy: "The eight is close to a formality. Seeding is what is left to play for.",
        action: { label: "See the projected table", href: "#league" },
        weight: 46,
      });
    } else if (projection.playoffOdds <= .28) {
      candidates.push({
        key: "miss",
        tone: "bad",
        title: `Only ${pct(projection.playoffOdds)}% to make the bracket`,
        copy: "The eight is out of reach without a real upgrade to a starting unit.",
        action: { label: `Shop for help`, href: `#/trade?team=${team.id}` },
        weight: 58,
      });
    }
  }

  /* ---- the caveat that changes what every grade above means ----------- */
  if (team.lineup?.source !== "set") {
    candidates.push({
      key: "optimized",
      tone: "neutral",
      title: "These grades read an optimized lineup, not your submitted one",
      copy: "No complete legal lineup has been set, so the report starts every starting unit"
        + " from the best legal one it can build. Setting a lineup changes these numbers.",
      action: { label: "See the full roster", href: "#roster" },
      /* High enough to always be seen. It is not a finding about the roster,
         it is a caveat on every other number in the report. */
      weight: 68,
    });
  }

  /* ---- something true for a roster with no extremes ------------------- */
  const asset = (team.lineup?.starters || []).slice().sort((a, b) => num(b.tradeValue) - num(a.tradeValue))[0];
  if (asset?.name) {
    candidates.push({
      key: "asset",
      tone: "neutral",
      title: `${asset.name} is your most valuable asset`,
      copy: `${asset.position}${asset.positionRank ? `${asset.positionRank} of ${asset.positionCount} rated` : ""}`
        + `, ${Math.round(num(asset.expectedPoints))} expected points, trade value ${Math.round(num(asset.tradeValue))}.`,
      action: { label: "See the full roster", href: "#roster" },
      weight: 38,
    });
  }

  const findings = candidates.sort((a, b) => b.weight - a.weight).slice(0, limit);
  return { verdict: verdictLine(team, projection, worst), findings };
}

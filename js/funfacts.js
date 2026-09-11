/* =====================================================================
   funfacts.js - "Did you know?"
   ---------------------------------------------------------------------
   Real facts about the DFL, derived from the matchup rows the app has
   already loaded. Nothing here is written by hand and nothing is made up.

   IT COMPUTES NOTHING ITSELF. Every figure comes from lore.js - best(),
   margin(), toSides(), streaks(), headToHead(), the standings. That is
   the same house rule the broadcast deck follows: there is one fantasy
   stats engine in this app and this is not it. If a fact below needs a
   number lore.js cannot produce, the number belongs in lore.js.

   ONE FACT A DAY, AND THE SAME ONE FOR EVERYBODY.

   The fact is chosen by the DATE, not at random:

     index = days since the epoch, modulo the number of facts

   which means every member opening the app on the same day sees the same
   fact, it changes at local midnight, and a shared fact still matches
   what the group sees when they open the app. Math.random() would give
   all three of those away for nothing.

   EVERY FACT CARRIES ITS SEASON. A record with no year attached reads as
   something that happened recently, and most of these did not.
   ===================================================================== */

import {
  namer, toSides, played, margin, best, winnerSide, loserSide, streaks, titleGame, spanLabel,
  withOwner, headToHead, career,
} from "./lore.js";

const DAY = 86400000;

/** "A and B", "A, B and C" - a list a person would read out loud. */
function listOf(names) {
  if (names.length <= 1) return names[0] || "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Facts are cheap to build but not free; one build per lore load. */
let cached = null;
let cachedFor = null;

/**
 * Every fact the current data supports.
 *
 * A fact that cannot be established returns nothing rather than a
 * guess, so a sparse league gets a short list instead of a wrong one.
 *
 * @returns {Array<{id,headline,detail,season,figure,kind}>}
 */
export function funFacts(lore) {
  if (!lore || !lore.matchups?.length) return [];
  if (cached && cachedFor === lore) return cached;

  const name = namer(lore);
  /*
    "The Fighting Mongooses — Slaw", not "The Fighting Mongooses".

    These facts are mostly about seasons a newer member never saw, and the
    team name alone identifies nobody. The historical name is kept exactly
    as it was; the owner is appended. See withOwner() in lore.js.
  */
  const who = (u, s, r) => withOwner(name(u, s, r));
  const games = lore.matchups.filter(played);
  const out = [];
  const add = (id, kind, headline, detail, season, figure) => {
    if (!headline || !detail) return;
    out.push({ id, kind, headline, detail, season, figure });
  };

  // ---- the closest game ever ------------------------------------------
  const decided = games.filter((m) => margin(m) > 0);
  const closest = best(decided, (m) => -margin(m));
  if (closest) {
    const w = winnerSide(closest), l = loserSide(closest);
    add("closest", "nailbiter",
      `The closest game in DFL history was decided by ${margin(closest).toFixed(2)} points.`,
      `${who(w.user, closest.season, w.roster)} ${w.score.toFixed(2)} – ${l.score.toFixed(2)} ${who(l.user, closest.season, l.roster)}, ${closest.season} Week ${closest.week}.`,
      closest.season, margin(closest).toFixed(2));
  }

  // ---- the biggest beating --------------------------------------------
  const blow = best(decided, margin);
  if (blow) {
    const w = winnerSide(blow), l = loserSide(blow);
    add("blowout", "blowout",
      `The biggest blowout in league history was ${margin(blow).toFixed(2)} points.`,
      `${who(w.user, blow.season, w.roster)} put ${w.score.toFixed(2)} on ${who(l.user, blow.season, l.roster)} in ${blow.season} Week ${blow.week}.`,
      blow.season, margin(blow).toFixed(2));
  }

  // ---- the best and worst weeks anybody has had ------------------------
  const sides = toSides(games).filter((s) => s.score > 0);
  const high = best(sides, (s) => s.score);
  if (high) {
    add("high", "high",
      `The highest score ever put up in the DFL is ${high.score.toFixed(2)}.`,
      `${who(high.user, high.season, high.roster)} did it in ${high.season} Week ${high.week}.`,
      high.season, high.score.toFixed(2));
  }
  const low = best(sides, (s) => -s.score);
  if (low) {
    add("low", "low",
      `The lowest score anybody has survived a week with is ${low.score.toFixed(2)}.`,
      `${who(low.user, low.season, low.roster)}, ${low.season} Week ${low.week}. It happens to everybody.`,
      low.season, low.score.toFixed(2));
  }

  // ---- streaks ---------------------------------------------------------
  const runs = streaks(sides);
  /* streaks() calls the length `run`, and `from`/`to` are the side rows
     themselves rather than labels - spanLabel() is the function that turns
     that pair into "2021 · Wk 3-9". Both were guessed wrong the first time
     and produced "undefined games". */
  const bestWin = best(runs.filter((r) => r.win), (r) => r.win.run);
  if (bestWin?.win) {
    const span = spanLabel(bestWin.win.from, bestWin.win.to);
    add("streak", "streak",
      `The longest winning streak in DFL history is ${bestWin.win.run} games.`,
      `${who(bestWin.user)} ran it off${span ? `, ${span}` : ""}.`,
      bestWin.win.from?.season ?? null, bestWin.win.run);
  }
  const worstLoss = best(runs.filter((r) => r.loss), (r) => r.loss.run);
  if (worstLoss?.loss) {
    const span = spanLabel(worstLoss.loss.from, worstLoss.loss.to);
    add("skid", "streak",
      `The longest losing streak anybody has sat through is ${worstLoss.loss.run} games.`,
      `${who(worstLoss.user)}${span ? `, ${span}` : ""}. Character building.`,
      worstLoss.loss.from?.season ?? null, worstLoss.loss.run);
  }

  // ---- the league as a whole -------------------------------------------
  const seasons = [...new Set(games.map((m) => Number(m.season)))].sort();
  if (seasons.length > 1) {
    const points = sides.reduce((a, s) => a + s.score, 0);
    add("total", "volume",
      `The DFL has scored ${Math.round(points).toLocaleString()} fantasy points.`,
      `Across ${games.length.toLocaleString()} games and ${seasons.length} seasons, ${seasons[0]} to ${seasons[seasons.length - 1]}.`,
      null, Math.round(points));

    const avg = points / sides.length;
    add("average", "volume",
      `The average DFL score is ${avg.toFixed(2)} points.`,
      `Anything over that has beaten the league's own history. Most weeks it will not be enough.`,
      null, avg.toFixed(2));
  }

  // ---- the finals ------------------------------------------------------
  const finals = [];
  for (const l of lore.leagues) {
    const t = titleGame(lore, l.season);
    if (t) finals.push(t);
  }
  const tightest = best(finals, (t) => -t.margin);
  if (tightest) {
    add("final", "title",
      `The closest DFL final was decided by ${tightest.margin.toFixed(2)} points.`,
      `${who(tightest.champUser, tightest.season, tightest.champRoster)} beat ${who(tightest.runnerUser, tightest.season, tightest.runnerRoster)} ${tightest.champScore.toFixed(2)} – ${tightest.runnerScore.toFixed(2)} in the ${tightest.season} final.`,
      tightest.season, tightest.margin.toFixed(2));
  }

  // ---- repeat champions -------------------------------------------------
  const titles = new Map();
  for (const l of lore.leagues) {
    if (!l.champion_user_id) continue;
    titles.set(l.champion_user_id, (titles.get(l.champion_user_id) || 0) + 1);
  }
  /*
    TIES ARE THE NORMAL CASE IN A SMALL LEAGUE, and the first cut of this
    ignored them: it sorted, took the top row and said "more than anybody
    else in the league's history". Klutch Sports Group and DaGrapeApes
    both have two, so that fact was simply false - and a fun fact that is
    wrong about who is winning is worse than no fun fact.

    So the count is what gets ranked, and EVERYBODY holding it is named.
  */
  const topCount = Math.max(0, ...titles.values());
  if (topCount > 1) {
    const holders = [...titles.entries()].filter(([, n]) => n === topCount).map(([u]) => who(u));
    add("dynasty", "title",
      holders.length === 1
        ? `${holders[0]} has won the DFL ${topCount} times.`
        : `${listOf(holders)} have each won the DFL ${topCount} times.`,
      holders.length === 1
        ? `More than anybody else in the league's history.`
        : `They are tied at the top — nobody in the DFL has more.`,
      null, topCount);
  }

  /*
    ============================================================
    RIVALRIES AND CAREERS

    A ten-fact book cycles in ten days, which starts repeating
    before a season is out. These use headToHead() and career() -
    both already in lore.js - rather than counting anything here,
    which is the same rule the rest of this file follows.

    Everyone who has ever played, from the standings, because a
    member row can be missing for somebody whose account is gone.
    ============================================================
  */
  const users = [...new Set((lore.standings || []).map((r) => r.sleeper_user_id).filter(Boolean))];

  // ---- the most one-sided rivalry ---------------------------------------
  let lopsided = null, played_most = null;
  for (const u of users) {
    for (const r of headToHead(lore, u)) {
      if (r.meetings >= 5 && (!lopsided || (r.wins - r.losses) > (lopsided.r.wins - lopsided.r.losses))) {
        lopsided = { u, r };
      }
      /* Each meeting is counted from both sides, so the pair is seen
         twice - taking the max is the same answer either way. */
      if (!played_most || r.meetings > played_most.r.meetings) played_most = { u, r };
    }
  }
  if (lopsided && lopsided.r.wins > lopsided.r.losses) {
    add("rivalry", "streak",
      `${who(lopsided.u)} owns ${who(lopsided.r.user)} ${lopsided.r.wins}-${lopsided.r.losses}.`,
      `${lopsided.r.meetings} meetings and it has never really been close.`,
      null, lopsided.r.wins);
  }
  if (played_most && played_most.r.meetings >= 4) {
    const h = played_most.r;
    add("mostplayed", "volume",
      `${who(played_most.u)} and ${who(h.user)} have met ${h.meetings} times.`,
      `More than any other pair in the league. It stands ${h.wins}-${h.losses}${h.ties ? `-${h.ties}` : ""}.`,
      null, h.meetings);
  }

  // ---- careers -----------------------------------------------------------
  const careers = users.map((u) => ({ u, c: career(lore, u) })).filter((x) => x.c.games >= 20);
  const bestPct = best(careers, (x) => x.c.winPct);
  if (bestPct) {
    add("winpct", "high",
      `${who(bestPct.u)} has the best all-time record in the DFL.`,
      `${bestPct.c.total.wins}-${bestPct.c.total.losses}${bestPct.c.total.ties ? `-${bestPct.c.total.ties}` : ""} across ${bestPct.c.games} games — ${(bestPct.c.winPct * 100).toFixed(1)}%.`,
      null, (bestPct.c.winPct * 100).toFixed(1));
  }
  const mostPo = best(careers, (x) => x.c.total.playoffs);
  if (mostPo && mostPo.c.total.playoffs > 1) {
    add("playoffs", "streak",
      `${who(mostPo.u)} has made the playoffs ${mostPo.c.total.playoffs} times.`,
      `More than anybody else in the league.`, null, mostPo.c.total.playoffs);
  }
  /* The nearly man: finals lost, no title. Only worth saying if it is a
     real streak of bad luck rather than one unlucky year. */
  const cursed = best(careers.filter((x) => !x.c.titles.length && x.c.seconds.length),
                      (x) => x.c.seconds.length);
  if (cursed && cursed.c.seconds.length >= 1) {
    add("cursed", "title",
      `${who(cursed.u)} has reached ${cursed.c.seconds.length === 1 ? "a final" : `${cursed.c.seconds.length} finals`} and never won one.`,
      `Runner-up in ${cursed.c.seconds.join(", ")}. Still waiting.`,
      cursed.c.seconds[cursed.c.seconds.length - 1], cursed.c.seconds.length);
  }
  const mostPoints = best(careers, (x) => x.c.total.pf);
  if (mostPoints) {
    add("careerpoints", "volume",
      `${who(mostPoints.u)} has scored more points than anyone in DFL history.`,
      `${Math.round(mostPoints.c.total.pf).toLocaleString()} across ${mostPoints.c.seasons.length} seasons.`,
      null, Math.round(mostPoints.c.total.pf));
  }

  // ---- the best and worst single seasons ---------------------------------
  const seasonRows = (lore.standings || []).filter((r) => (r.wins + r.losses + r.ties) > 0);
  const bigSeason = best(seasonRows, (r) => Number(r.points_for) || 0);
  if (bigSeason) {
    add("bigseason", "high",
      `The most points scored in one DFL season is ${Math.round(Number(bigSeason.points_for)).toLocaleString()}.`,
      `${who(bigSeason.sleeper_user_id, bigSeason.season, bigSeason.roster_id)}, ${bigSeason.season}.`,
      bigSeason.season, Math.round(Number(bigSeason.points_for)));
  }
  /* Scored the most and still lost: the standings know both numbers, so
     this is a real thing that happened rather than a feeling. */
  const unlucky = best(seasonRows.filter((r) => r.losses > r.wins),
                       (r) => Number(r.points_for) || 0);
  if (unlucky) {
    add("unlucky", "low",
      `${who(unlucky.sleeper_user_id, unlucky.season, unlucky.roster_id)} scored ${Math.round(Number(unlucky.points_for)).toLocaleString()} in ${unlucky.season} and still finished under .500.`,
      `${unlucky.wins}-${unlucky.losses}${unlucky.ties ? `-${unlucky.ties}` : ""}. The schedule decides more than anybody admits.`,
      unlucky.season, Math.round(Number(unlucky.points_for)));
  }

  cached = out;
  cachedFor = lore;
  return out;
}

/**
 * Today's fact.
 *
 * Deterministic from the date, so every member sees the same one and a
 * shared fact matches what the group finds when they open the app. The
 * date is the LOCAL one - the fact turns over at midnight where you are,
 * which is what "today's fact" means to a person.
 */
export function factOfTheDay(lore, when = new Date()) {
  const all = funFacts(lore);
  if (!all.length) return null;
  const local = new Date(when.getFullYear(), when.getMonth(), when.getDate());
  const dayIndex = Math.floor(local.getTime() / DAY);
  return all[((dayIndex % all.length) + all.length) % all.length];
}

/** The sentence that gets shared. Kept here so the page and the stage agree. */
export function factLine(fact) {
  if (!fact) return "";
  return `DFL HQ — Did you know?\n\n${fact.headline}\n${fact.detail}`;
}

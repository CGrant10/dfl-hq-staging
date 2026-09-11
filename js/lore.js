// =====================================================================
// lore.js - what the DFL remembers
// ---------------------------------------------------------------------
// Sleeper knows what happened this week. This file knows what happened to
// this league, and it is the single place that decides it - so a moment,
// a career and a yearbook can never disagree about the same game.
//
// THE ONE RULE: NOTHING IN HERE IS INVENTED.
//
// Every figure below is read off a row that a sync actually wrote. Where
// the data cannot answer a question, the answer is nothing - not a guess,
// not a plausible-looking number. Two examples, both deliberate:
//
//   COMEBACKS         sleeper_matchups stores the FINAL score of a week and
//                     nothing else. There is no in-progress snapshot
//                     anywhere in the schema, so "biggest comeback" cannot
//                     be computed. It is not here, and it should not be
//                     added until something records a running score.
//
//   THE TITLE GAME    inferred - the last week of a season, champion's
//                     roster against the runner-up's. Verified against all
//                     seven completed seasons, and STILL guarded: if the
//                     champion did not win that game, the inference was
//                     wrong for that season and it returns nothing rather
//                     than printing a lie.
//
// WHY IT IS NOT A TABLE. Everything here is derived, and derived data in a
// table is a second copy that goes stale the moment a sync corrects a
// score. Commissioner-written moments ARE stored, because a person typed
// them and no query could ever reproduce them - and they already have a
// home in the `history` table, which has carried Champion / Runner Up /
// Award / Record / Moment since the beginning.
// =====================================================================

import { db } from "./supabase.js";

// ---------------------------------------------------------------- naming

/**
 * Names for anything historical.
 *
 * Moved here from pages/history.js, which is where it was written and the
 * only place it could be used. Careers, moments and yearbooks all have to
 * name the same people the same way - a rivalry that calls somebody by
 * this year's team name while the record book calls them by the name they
 * used in 2019 is two different stories about one person.
 *
 * Owners are matched on Sleeper user id ONLY, never on a name, because
 * names are exactly what change from year to year.
 *
 * `season` picks the name in use THAT year, from the standings snapshot.
 * Without a season it falls back to the person's current identity.
 * `rosterId` is the last resort: it names a team whose owner account no
 * longer exists, which is how the 2019 champion is still identifiable.
 */
export function namer(data) {
  const byMember  = new Map((data.members || []).map((m) => [m.sleeper_user_id, m]));
  const bySleeper = new Map((data.users || []).map((u) => [u.sleeper_user_id, u]));

  const snapshot = new Map();          // "season:userId"   -> team name
  const byRoster = new Map();          // "season:rosterId" -> team name
  for (const s of data.standings || []) {
    if (s.sleeper_user_id) snapshot.set(`${s.season}:${s.sleeper_user_id}`, s.team_name || "");
    byRoster.set(`${s.season}:${s.roster_id}`, s.team_name || "");
  }

  /* Team names arrive from Sleeper with whatever whitespace somebody typed,
     and several DFL teams carry a trailing space - which reads as a typo in
     the middle of a sentence ("Team Lafountain  by 1.04"). Trimmed for
     DISPLAY only; nothing is ever matched on a name, so this cannot affect
     which owner a row belongs to. */
  const clean = (v) => String(v ?? "").trim();

  return (userId, season = null, rosterId = null) => {
    const member = byMember.get(userId);
    const user   = bySleeper.get(userId);
    const person = member?.display_name || user?.display_name || null;

    const historic = season != null ? snapshot.get(`${season}:${userId}`) : null;

    if (person) {
      const label = clean(historic || member?.team_name || user?.team_name || person);
      return { label, sub: clean(person), memberId: member?.id ?? null };
    }

    // No owner: the Sleeper account was deleted. Use that season's team
    // name if we captured one, otherwise at least identify the roster, so
    // the season still appears instead of vanishing.
    const orphan = season != null && rosterId != null
      ? clean(byRoster.get(`${season}:${rosterId}`)) : null;
    if (orphan) return { label: orphan, sub: "account deleted", memberId: null };
    if (rosterId != null) return { label: `Roster ${rosterId}`, sub: "account deleted", memberId: null };
    return { label: "Unknown", sub: "", memberId: null };
  };
}

/*
  "THE FIGHTING MONGOOSES — SLAW"

  namer() has always returned both halves: `label` is the team name in use
  that season, `sub` is the person. Callers were taking .label and throwing
  the person away, which is fine on the History page where the owner is in
  the next column and useless everywhere else - a fun fact about "Irked by
  Kirk" tells a member who joined in 2024 nothing at all.

  THE HISTORICAL NAME IS NEVER REPLACED. It is the true name of that team
  in that year and renaming it to somebody's current team would be a lie
  about the record. The owner is appended, not substituted.

  Three cases where appending would be noise, and all three return the
  label alone:
    the team name IS the person ("Slaw" — "Slaw")
    the owner is unknown, so there is nothing to add
    the Sleeper account was deleted, which moments() already explains in
      its own words rather than in a dash-suffix
*/
export function withOwner(named) {
  if (!named) return "";
  const label = named.label || "";
  const sub = named.sub || "";
  if (!sub || sub === "account deleted") return label;
  if (sub.toLowerCase() === label.toLowerCase()) return label;
  return `${label} — ${sub}`;
}

// ------------------------------------------------------------- the data

/*
  ONE LOAD, SHARED. History's records tab already cached its own copy of the
  matchup table; profiles had no access to it at all and so could not show a
  head-to-head. Both read from here now, and 688 matchup rows are fetched
  once per visit rather than once per screen.
*/
let cache = null;

export async function loadLore({ force = false } = {}) {
  if (cache && !force) return cache;

  const [leagues, standings, users, members, matchups, manual, arenaEvents, arenaResults, golf, config] =
    await Promise.all([
      db().from("sleeper_leagues")
          .select("season,status,scoring_settings,champion_locked,last_place_user_id,last_place_locked,champion_user_id,runner_up_user_id,champion_roster_id,runner_up_roster_id,playoff_teams")
          .order("season", { ascending: false }),
      db().from("sleeper_standings")
          .select("season,roster_id,sleeper_user_id,team_name,wins,losses,ties,points_for,points_against,rank,made_playoffs"),
      db().from("sleeper_users").select("sleeper_user_id,display_name,team_name,hidden"),
      db().from("members").select("id,display_name,team_name,sleeper_user_id,championships,joined_year"),
      db().from("sleeper_matchups")
          .select("season,week,roster1,user1,score1,roster2,user2,score2,winner_roster_id")
          .order("season", { ascending: true }).order("week", { ascending: true }),
      db().from("history").select("id,year,category,winner,notes").order("year", { ascending: false }),
      db().from("arena_events").select("id,name,theme,status,event_date"),
      db().from("arena_results").select("event_id,member_id,place,finish_ms").order("place"),
      db().from("golf_outings").select("id,name,course,event_date,event_time,status"),
      /* WHEN THE FANTASY DATA WAS LAST PULLED. One row, one column, and it
         is the difference between "live" and "we have not looked since
         Tuesday" - see fantasyState() below. A missing config row is not an
         error; it just means nothing can be called live. */
      db().from("sleeper_config").select("last_synced_at").eq("id", 1).maybeSingle(),
    ]);

  const err = leagues.error || standings.error || matchups.error;

  cache = {
    error:     err || null,
    leagues:   leagues.data   || [],
    standings: standings.data || [],
    // people a sync found but an admin has hidden never appear
    users:     (users.data || []).filter((u) => u.hidden !== true),
    members:   members.data   || [],
    matchups:  matchups.data  || [],
    manual:    manual.data    || [],
    arenaEvents:  arenaEvents.data  || [],
    arenaResults: arenaResults.data || [],
    golf:      golf.data || [],
    syncedAt:  config?.data?.last_synced_at || null,
  };
  return cache;
}

/* =====================================================================
   IS FANTASY ACTUALLY HAPPENING RIGHT NOW
   ---------------------------------------------------------------------
   The reason this exists: sleeper_matchups holds only FINAL weekly scores,
   so "the latest week we have data for" is not "the week being played". In
   February the latest row is Week 17 of a season that ended in January.
   Anything that prints a bare "WEEK 17" is claiming something false.

   TWO SIGNALS, and it takes BOTH to say live:

     sleeper_leagues.status   Sleeper's own lifecycle value - pre_draft,
                              drafting, in_season, complete. Authoritative
                              about the SEASON.
     last_synced_at           when we last looked. Authoritative about the
                              DATA.

   A season can be in_season while the numbers on screen are five days old,
   because syncing here is a button somebody presses rather than a cron. So
   in_season with a stale sync is NOT live - it degrades to "recent", which
   is the honest description of numbers that were true when we fetched them
   and may have moved since.

   STATES

     live        in_season AND synced within FRESH_MS
     recent      in_season but the sync is stale
     upcoming    pre_draft or drafting - a season that has not started
     final       complete, and it is the newest season we hold
     historical  complete, and something newer exists
     none        no league rows at all

   `label` is the thing a caller should print, and it always carries the
   season. There is no code path here that returns a week without the year
   attached to it.
   ===================================================================== */

/** How old a sync may be before "in season" stops meaning "live". */
export const FRESH_MS = 24 * 60 * 60 * 1000;

/** The highest week we hold a played score for in a season, or 0. */
export function latestPlayedWeek(lore, season) {
  let top = 0;
  for (const m of lore?.matchups || []) {
    if (Number(m.season) !== Number(season)) continue;
    if (!played(m)) continue;
    if (Number(m.week) > top) top = Number(m.week);
  }
  return top;
}

export function fantasyState(lore, now = Date.now()) {
  const leagues = [...(lore?.leagues || [])]
    .sort((a, b) => (Number(b.season) || 0) - (Number(a.season) || 0));
  if (!leagues.length) {
    return { state: "none", season: null, status: "", week: 0, label: "",
             fresh: false, syncedAt: null, staleHours: null };
  }

  const league = leagues[0];
  const season = Number(league.season);
  const status = String(league.status || "").trim().toLowerCase();

  const syncedAt = lore.syncedAt ? Date.parse(lore.syncedAt) : NaN;
  const age = Number.isFinite(syncedAt) ? now - syncedAt : Infinity;
  const fresh = age <= FRESH_MS;
  const staleHours = Number.isFinite(age) ? Math.floor(age / 3600000) : null;

  const week = latestPlayedWeek(lore, season);
  const base = { season, status, week, fresh, syncedAt: lore.syncedAt || null, staleHours };

  if (status === "in_season") {
    /* A week number is only worth printing once somebody has played one. An
       in_season league on the Tuesday before week 1 has no scores yet. */
    const label = week ? `${season} · Week ${week}` : String(season);
    return { ...base, state: fresh ? "live" : "recent", label };
  }

  if (status === "pre_draft" || status === "drafting") {
    return { ...base, state: "upcoming", label: `${season} season` };
  }

  // complete, or a status Sleeper has that we do not recognise
  return {
    ...base,
    state: "final",
    label: week ? `${season} · Week ${week}` : String(season),
  };
}

/**
 * The state of a season that is NOT the newest one we hold.
 *
 * Split out because "final" and "historical" differ only by whether
 * anything newer exists, and callers asking about 2021 want the second.
 */
export function seasonState(lore, season) {
  const newest = Math.max(...(lore?.leagues || []).map((l) => Number(l.season) || 0), 0);
  if (Number(season) === newest) return fantasyState(lore).state;
  return "historical";
}

/** Drop the cache after an admin edits a moment, so the page redraws truth. */
export function clearLore() { cache = null; }

// ------------------------------------------------------- shared shaping

/**
 * A matchup row holds two teams. Most questions are about ONE team's week,
 * so flatten every game into two one-sided entries first.
 */
export function toSides(matchups) {
  const out = [];
  for (const m of matchups) {
    const tie = m.winner_roster_id == null;   // null on a tie: neither W nor L
    if (m.user1 || m.roster1 != null) {
      out.push({ season: m.season, week: m.week, user: m.user1, roster: m.roster1,
                 score: Number(m.score1) || 0, against: Number(m.score2) || 0,
                 opponent: m.user2, opponentRoster: m.roster2,
                 tie, won: m.winner_roster_id === m.roster1 });
    }
    if (m.user2 || m.roster2 != null) {
      out.push({ season: m.season, week: m.week, user: m.user2, roster: m.roster2,
                 score: Number(m.score2) || 0, against: Number(m.score1) || 0,
                 opponent: m.user1, opponentRoster: m.roster1,
                 tie, won: m.winner_roster_id === m.roster2 });
    }
  }
  return out;
}

export const margin = (m) => Math.abs(Number(m.score1) - Number(m.score2));

/** A game that was actually played. A 0-0 row is a week that has not happened. */
export const played = (m) => Number(m.score1) > 0 || Number(m.score2) > 0;

/** The row scoring highest on `score`. One pass, no sorting a big array. */
export function best(rows, score) {
  let top = null, topScore = -Infinity;
  for (const r of rows) {
    const s = score(r);
    if (s > topScore) { topScore = s; top = r; }
  }
  return top;
}

export function winnerSide(m) {
  const one = m.winner_roster_id === m.roster1;
  return { user: one ? m.user1 : m.user2, roster: one ? m.roster1 : m.roster2,
           score: Number(one ? m.score1 : m.score2) || 0 };
}
export function loserSide(m) {
  const one = m.winner_roster_id === m.roster1;
  return { user: one ? m.user2 : m.user1, roster: one ? m.roster2 : m.roster1,
           score: Number(one ? m.score2 : m.score1) || 0 };
}

// ------------------------------------------------------- the title game

/**
 * The championship game, or null.
 *
 * Sleeper does not flag a final. What it does record is who won the league
 * and who came second, and those two play each other in the last week of
 * the season - true in all seven DFL seasons on record.
 *
 * It is still an inference, so it is checked rather than trusted: the game
 * has to exist, and the champion has to have WON it. A season where that
 * does not hold gets no title game rather than a wrong one.
 */
export function titleGame(lore, season) {
  const league = lore.leagues.find((l) => Number(l.season) === Number(season));
  if (!league?.champion_roster_id || !league?.runner_up_roster_id) return null;

  const weeks = lore.matchups.filter((m) => m.season === season).map((m) => m.week);
  if (!weeks.length) return null;
  const last = Math.max(...weeks);

  const game = lore.matchups.find((m) => m.season === season && m.week === last &&
    ((m.roster1 === league.champion_roster_id && m.roster2 === league.runner_up_roster_id) ||
     (m.roster2 === league.champion_roster_id && m.roster1 === league.runner_up_roster_id)));
  if (!game) return null;

  const champIsOne = game.roster1 === league.champion_roster_id;
  const champScore  = Number(champIsOne ? game.score1 : game.score2) || 0;
  const runnerScore = Number(champIsOne ? game.score2 : game.score1) || 0;
  if (!(champScore > runnerScore)) return null;    // the inference failed: say nothing

  return {
    season, week: last, champScore, runnerScore,
    margin: champScore - runnerScore,
    champUser:  champIsOne ? game.user1 : game.user2,
    champRoster: league.champion_roster_id,
    runnerUser: champIsOne ? game.user2 : game.user1,
    runnerRoster: league.runner_up_roster_id,
  };
}

// ------------------------------------------------------------- streaks

/**
 * Longest run of wins and of losses per owner, across every season in order.
 * Streaks carry across a season boundary on purpose - the league remembers,
 * and "he lost eleven straight" is a better story for it. A tie ends both.
 */
export function streaks(sides) {
  const byUser = new Map();
  for (const s of sides) {
    if (!s.user || s.score <= 0) continue;
    if (!byUser.has(s.user)) byUser.set(s.user, []);
    byUser.get(s.user).push(s);
  }

  const runs = [];
  for (const [user, weeks] of byUser) {
    weeks.sort((a, b) => a.season - b.season || a.week - b.week);
    let runW = 0, runL = 0, startW = null, startL = null;
    let bestW = null, bestL = null;
    for (const w of weeks) {
      if (w.tie) { runW = runL = 0; startW = startL = null; continue; }
      if (w.won) {
        runL = 0; startL = null;
        if (!runW) startW = w;
        runW++;
        if (!bestW || runW > bestW.run) bestW = { user, run: runW, from: startW, to: w };
      } else {
        runW = 0; startW = null;
        if (!runL) startL = w;
        runL++;
        if (!bestL || runL > bestL.run) bestL = { user, run: runL, from: startL, to: w };
      }
    }
    runs.push({ user, win: bestW, loss: bestL });
  }
  return runs;
}

export function spanLabel(from, to) {
  if (!from) return "";
  return from.season === to.season
    ? `${from.season} · Wk ${from.week}–${to.week}`
    : `${from.season} Wk ${from.week} – ${to.season} Wk ${to.week}`;
}

// -------------------------------------------------------- head to head

/**
 * One owner's record against every owner they have ever played.
 *
 * Keyed on Sleeper user id, so a rivalry survives both people renaming
 * their teams five times. Weeks nobody played (0-0) are not meetings.
 */
export function headToHead(lore, userId) {
  const out = new Map();
  for (const m of lore.matchups) {
    if (!played(m)) continue;
    if (!m.user1 || !m.user2) continue;          // a deleted account's game
    let mine, theirs;
    if (m.user1 === userId)      { mine = 1; theirs = 2; }
    else if (m.user2 === userId) { mine = 2; theirs = 1; }
    else continue;

    const foe = m[`user${theirs}`];
    const myScore = Number(m[`score${mine}`]) || 0;
    const theirScore = Number(m[`score${theirs}`]) || 0;
    const myRoster = m[`roster${mine}`];

    if (!out.has(foe)) out.set(foe, { user: foe, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0,
                                      meetings: 0, last: null, biggest: null });
    const r = out.get(foe);
    r.meetings++;
    r.pf += myScore; r.pa += theirScore;
    if (m.winner_roster_id == null) r.ties++;
    else if (m.winner_roster_id === myRoster) r.wins++;
    else r.losses++;

    const game = { season: m.season, week: m.week, mine: myScore, theirs: theirScore,
                   margin: Math.abs(myScore - theirScore), won: m.winner_roster_id === myRoster };
    if (!r.last || m.season > r.last.season || (m.season === r.last.season && m.week > r.last.week)) r.last = game;
    if (!r.biggest || game.margin > r.biggest.margin) r.biggest = game;
  }
  return [...out.values()].sort((a, b) => b.meetings - a.meetings);
}

// ---------------------------------------------------------- one career

/**
 * Everything the league knows about one owner.
 *
 * Seasons come from standings, which carry that year's team name, so a
 * career timeline reads with the names the person actually used.
 */
export function career(lore, userId) {
  const seasons = lore.standings
    .filter((s) => s.sleeper_user_id === userId && (s.wins + s.losses + s.ties) > 0)
    .sort((a, b) => b.season - a.season);

  const titles = lore.leagues.filter((l) => l.champion_user_id === userId).map((l) => l.season).sort();
  const seconds = lore.leagues.filter((l) => l.runner_up_user_id === userId).map((l) => l.season).sort();

  const total = seasons.reduce((a, s) => ({
    wins: a.wins + (s.wins || 0), losses: a.losses + (s.losses || 0), ties: a.ties + (s.ties || 0),
    pf: a.pf + Number(s.points_for || 0), pa: a.pa + Number(s.points_against || 0),
    playoffs: a.playoffs + (s.made_playoffs ? 1 : 0),
  }), { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, playoffs: 0 });

  const games = total.wins + total.losses + total.ties;
  const ranked = seasons.filter((s) => s.rank != null);

  const mySides = toSides(lore.matchups).filter((s) => s.user === userId && s.score > 0);
  const myStreak = streaks(mySides).find((r) => r.user === userId) || { win: null, loss: null };

  return {
    userId, seasons, titles, seconds, total, games,
    winPct: games ? (total.wins + total.ties / 2) / games : 0,
    avgFinish: ranked.length ? ranked.reduce((a, s) => a + s.rank, 0) / ranked.length : null,
    // best and worst by finishing position, which is what an owner argues
    // about - not by points, which rewards a good team that lost every week
    bestSeason:  ranked.length ? ranked.reduce((a, s) => (s.rank < a.rank ? s : a)) : null,
    worstSeason: ranked.length ? ranked.reduce((a, s) => (s.rank > a.rank ? s : a)) : null,
    highWeek: best(mySides, (s) => s.score),
    lowWeek:  best(mySides, (s) => -s.score),
    streak: myStreak,
  };
}

// ------------------------------------------------------------- MOMENTS

/*
  A MOMENT IS A FACT WITH A DATE ON IT.

  Each one carries the season it belongs to, so the yearbook can ask for a
  season's moments and the moments page can group by year without a second
  derivation. `kind` decides the icon and nothing else.

  Ordering is by season, then by weight - and weight is a fixed rank of what
  the league cares about, not a score. A championship outranks a blowout
  every time; nothing is computed to decide that.
*/
const WEIGHT = {
  title: 100, championship: 95, commissioner: 90, golf: 70, arena: 65,
  streak: 55, heartbreak: 50, blowout: 45, nailbiter: 45, high: 40, low: 35, rivalry: 30,
};

function moment(kind, season, headline, detail, extra = {}) {
  return { kind, season, headline, detail, weight: WEIGHT[kind] ?? 10, ...extra };
}

/**
 * Everything the league remembers, newest first.
 *
 * `season` narrows it to one year, which is exactly what the yearbook wants.
 */
export function moments(lore, { season = null } = {}) {
  const name = namer(lore);
  /* Historical team name plus the person behind it - these lines are read
     by people who were not in the league in 2019. */
  const who = (u, s, r) => withOwner(name(u, s, r));
  const out = [];

  const games = lore.matchups.filter(played);
  const inSeason = (s) => season == null || Number(s) === Number(season);

  // ---- championships, and the game that decided them -------------------
  for (const l of lore.leagues) {
    if (!inSeason(l.season)) continue;
    if (!l.champion_user_id && !l.champion_roster_id) continue;

    const champWho = name(l.champion_user_id, l.season, l.champion_roster_id);
    const beat = l.runner_up_user_id || l.runner_up_roster_id
      ? `Beat ${who(l.runner_up_user_id, l.season, l.runner_up_roster_id)} in the final`
      : `${l.season} champions`;

    /* THE 2019 PROBLEM, SAID OUT LOUD. That title was won by a roster whose
       Sleeper account was deleted before any sync ran, so the team name is
       not in the database and cannot be - not in standings, not in rosters.
       "Roster 8 win the title" is accurate and reads like a bug; making a
       name up would be a lie. So the season keeps its place in the record
       and the headline explains the gap instead of papering over it. */
    const lost = !champWho.memberId && champWho.sub === "account deleted"
                 && /^Roster \d+$/.test(champWho.label);

    out.push(moment("championship", l.season,
      lost ? `The ${l.season} champion` : `${champWho.label} win the title`,
      lost ? `${champWho.label} — the Sleeper account was deleted before the team name was recorded. ${beat}`
           : beat,
      { user: l.champion_user_id, roster: l.champion_roster_id }));

    const t = titleGame(lore, l.season);
    if (t) {
      out.push(moment("title", l.season,
        `${t.champScore.toFixed(2)} – ${t.runnerScore.toFixed(2)}`,
        `${who(t.champUser, t.season, t.champRoster)} over ${who(t.runnerUser, t.season, t.runnerRoster)} ` +
        `by ${t.margin.toFixed(2)} · Week ${t.week} final`,
        { user: t.champUser, roster: t.champRoster, figure: t.margin }));
    }
  }

  // ---- the weeks worth remembering ------------------------------------
  const scope = season == null ? games : games.filter((m) => Number(m.season) === Number(season));
  if (scope.length) {
    const blow = best(scope, margin);
    if (blow && margin(blow) > 0) {
      const w = winnerSide(blow), l = loserSide(blow);
      out.push(moment("blowout", blow.season, `${margin(blow).toFixed(2)}-point beating`,
        `${who(w.user, blow.season, w.roster)} ${w.score.toFixed(2)} – ${l.score.toFixed(2)} ${who(l.user, blow.season, l.roster)} · Week ${blow.week}`,
        { figure: margin(blow) }));
    }

    const tight = scope.filter((m) => margin(m) > 0);
    const near = best(tight, (m) => -margin(m));
    if (near) {
      const w = winnerSide(near), l = loserSide(near);
      out.push(moment("nailbiter", near.season, `Won by ${margin(near).toFixed(2)}`,
        `${who(w.user, near.season, w.roster)} ${w.score.toFixed(2)} – ${l.score.toFixed(2)} ${who(l.user, near.season, l.roster)} · Week ${near.week}`,
        { figure: margin(near) }));
    }

    const sides = toSides(scope).filter((s) => s.score > 0);
    const high = best(sides, (s) => s.score);
    if (high) out.push(moment("high", high.season, `${high.score.toFixed(2)} points`,
      `${who(high.user, high.season, high.roster)} · Week ${high.week}`, { user: high.user, figure: high.score }));

    const low = best(sides, (s) => -s.score);
    if (low) out.push(moment("low", low.season, `${low.score.toFixed(2)} points`,
      `${who(low.user, low.season, low.roster)} · Week ${low.week}`, { user: low.user, figure: low.score }));

    /* THE BEST LOSS IN THE LEAGUE. Scoring 150 and going home is the most
       DFL thing that can happen to a person, and it is a real row: the
       highest score among sides that lost. */
    const beaten = sides.filter((s) => !s.won && !s.tie);
    const hardLuck = best(beaten, (s) => s.score);
    if (hardLuck) out.push(moment("heartbreak", hardLuck.season,
      `${hardLuck.score.toFixed(2)} and lost`,
      `${who(hardLuck.user, hardLuck.season, hardLuck.roster)} lost to ${who(hardLuck.opponent, hardLuck.season, hardLuck.opponentRoster)} ` +
      `${hardLuck.against.toFixed(2)} · Week ${hardLuck.week}`,
      { user: hardLuck.user, figure: hardLuck.score }));
  }

  // ---- streaks. All-time only: a streak is not a season's property -----
  if (season == null) {
    const runs = streaks(toSides(games));
    const longestWin  = best(runs.map((r) => r.win).filter(Boolean),  (r) => r.run);
    const longestLoss = best(runs.map((r) => r.loss).filter(Boolean), (r) => r.run);
    if (longestWin && longestWin.run >= 5) {
      out.push(moment("streak", longestWin.to.season, `${longestWin.run} straight wins`,
        `${who(longestWin.user)} · ${spanLabel(longestWin.from, longestWin.to)}`,
        { user: longestWin.user, figure: longestWin.run }));
    }
    if (longestLoss && longestLoss.run >= 5) {
      out.push(moment("streak", longestLoss.to.season, `${longestLoss.run} straight losses`,
        `${who(longestLoss.user)} · ${spanLabel(longestLoss.from, longestLoss.to)}`,
        { user: longestLoss.user, figure: longestLoss.run }));
    }

    /* RIVALRY MILESTONES, and only ones a threshold decides - a series that
       will not break, or one that has been entirely one-sided. No drama is
       manufactured for a 5-4 record. */
    for (const r of rivalryMilestones(lore)) out.push(r);
  }

  // ---- golf and arena, if either has ever finished ---------------------
  for (const g of lore.golf) {
    if (g.status !== "final" || !inSeason(seasonOf(g.event_date))) continue;
    out.push(moment("golf", seasonOf(g.event_date), g.name || "DFL Golf",
      [g.course, g.event_date].filter(Boolean).join(" · "), { href: `#/golf?id=${g.id}` }));
  }

  const byMember = new Map(lore.members.map((m) => [String(m.id), m]));
  for (const ev of lore.arenaEvents) {
    const winner = lore.arenaResults.find((r) => String(r.event_id) === String(ev.id) && r.place === 1);
    if (!winner) continue;                       // no result: nothing happened
    if (!inSeason(seasonOf(ev.event_date))) continue;
    const m = byMember.get(String(winner.member_id));
    out.push(moment("arena", seasonOf(ev.event_date),
      `${m?.display_name || "Somebody"} wins the Arena`,
      [ev.name, ev.theme].filter(Boolean).join(" · "), { href: `#/arena?id=${ev.id}` }));
  }

  // ---- what the commissioner wrote down -------------------------------
  for (const h of lore.manual) {
    if (!inSeason(h.year)) continue;
    out.push(moment("commissioner", h.year, h.winner || h.category, h.notes || "",
      { category: h.category, row: h }));
  }

  return out.sort((a, b) => (Number(b.season) || 0) - (Number(a.season) || 0) || b.weight - a.weight);
}

/* A golf outing or an Arena race belongs to the year it happened in. */
function seasonOf(date) {
  if (!date) return null;
  const y = Number(String(date).slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

/**
 * Rivalries that have earned the word.
 *
 *   deadlocked   ten or more meetings and dead level
 *   one-sided    six or more meetings and one of them has never won
 *
 * Both are thresholds, not judgements, and both count real meetings only.
 *
 * AND ONLY THE DEEPEST ONE OF EACH. Twelve owners make 88 pairs, and at
 * that many a level series is a coincidence rather than a rivalry - the
 * first cut of this printed NINE "cannot be separated" rows into a single
 * year and buried the championship underneath them. A moment that appears
 * nine times is not a moment. Every pair's record is still on both owners'
 * head-to-head tables, which is where a series belongs; this is only for
 * the one that has gone furthest without breaking.
 */
export function rivalryMilestones(lore) {
  const name = namer(lore);
  const pairs = new Map();
  for (const m of lore.matchups) {
    if (!played(m) || !m.user1 || !m.user2) continue;
    const key = [m.user1, m.user2].sort().join("|");
    if (!pairs.has(key)) pairs.set(key, { a: key.split("|")[0], b: key.split("|")[1], n: 0, aWins: 0, bWins: 0, last: 0 });
    const p = pairs.get(key);
    p.n++;
    p.last = Math.max(p.last, m.season);
    if (m.winner_roster_id == null) continue;    // a tie belongs to neither
    const winner = m.winner_roster_id === m.roster1 ? m.user1 : m.user2;
    if (winner === p.a) p.aWins++; else p.bWins++;
  }

  const all = [...pairs.values()];
  const label = (p) => [name(p.a).label, name(p.b).label];

  const out = [];
  const level = best(all.filter((p) => p.n >= 10 && p.aWins === p.bWins), (p) => p.n);
  if (level) {
    const [A, B] = label(level);
    out.push(moment("rivalry", level.last, `${level.aWins}–${level.bWins} after ${level.n}`,
      `${A} and ${B} cannot be separated`, { figure: level.n }));
  }

  const sweep = best(all.filter((p) => p.n >= 6 && (p.aWins === 0 || p.bWins === 0)), (p) => p.n);
  if (sweep) {
    const [A, B] = label(sweep);
    const up = sweep.aWins === 0 ? B : A, down = sweep.aWins === 0 ? A : B;
    out.push(moment("rivalry", sweep.last, `${Math.max(sweep.aWins, sweep.bWins)}–0`,
      `${up} has never lost to ${down} in ${sweep.n} meetings`, { figure: sweep.n }));
  }
  return out;
}

// ------------------------------------------------------------ YEARBOOK

/**
 * One completed season, as a story.
 *
 * Everything is pulled through the functions above, so a figure printed
 * here is the same figure printed on the moments page and on a career.
 * A season that has not been played returns `played: false` and the page
 * says so rather than drawing a book of dashes.
 */
export function yearbook(lore, season) {
  const rows = lore.standings.filter((s) => Number(s.season) === Number(season));
  const hasGames = rows.some((s) => (s.wins + s.losses + s.ties) > 0);
  const league = lore.leagues.find((l) => Number(l.season) === Number(season)) || null;
  const name = namer(lore);

  const ordered = [...rows].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const seasonGames = lore.matchups.filter((m) => Number(m.season) === Number(season) && played(m));
  const sides = toSides(seasonGames).filter((s) => s.score > 0);

  return {
    season, played: hasGames, league, standings: ordered, name,
    weeks: seasonGames.length ? Math.max(...seasonGames.map((m) => m.week)) : 0,
    games: seasonGames.length,
    champion: league && (league.champion_user_id || league.champion_roster_id)
      ? name(league.champion_user_id, season, league.champion_roster_id) : null,
    runnerUp: league && (league.runner_up_user_id || league.runner_up_roster_id)
      ? name(league.runner_up_user_id, season, league.runner_up_roster_id) : null,
    title: titleGame(lore, season),
    moments: moments(lore, { season }),
    // the season's own leaders, from its own rows
    mostPoints: best(rows.filter((s) => (s.wins + s.losses + s.ties) > 0), (s) => Number(s.points_for) || 0),
    highWeek: best(sides, (s) => s.score),
    lowWeek:  best(sides, (s) => -s.score),
  };
}

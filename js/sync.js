// =====================================================================
// sync.js - pull everything out of Sleeper and store it in Supabase
// ---------------------------------------------------------------------
// Runs in the admin's browser. Every write goes through db(), which is
// the admin client, so the database itself rejects the whole thing if the
// admin password is not present.
//
// Two rules this file is built around:
//
//   1. NEVER DESTROY HISTORY. Every table is keyed by season (and week
//      where relevant) and written with upsert. Re-syncing 2026 updates
//      2026 rows and cannot touch 2025.
//
//   2. NORMAL SYNCS TOUCH ONLY THE CURRENT SEASON. Sleeper makes a new
//      league id every season, so repeatedly walking previous_league_id
//      wastes dozens of requests on history that no longer changes. The
//      chain remains available as an explicit history-repair operation.
// =====================================================================

import { db } from "./supabase.js";
import { readWinners, readLastPlace } from "./sleeper-bracket.js";
import { sleeper } from "./sleeper.js";
import { slotsFromOrder, slotsFromPicks } from "./draft-order.js";
import { collectLeagueChain } from "./sleeper-sync-scope.js";

const MAX_WEEK    = 18;
const CONCURRENCY = 4;    // parallel week requests; polite to the API

/**
 * Sync the configured current league, or explicitly repair linked history.
 * @param {string} leagueId  the most recent Sleeper league id
 * @param {(msg:string)=>void} log  progress callback for the UI
 * @param {{includeHistory?:boolean}} options sync scope
 * @returns {Promise<{seasons:number[], counts:object}>}
 */
export async function syncSleeper(leagueId, log = () => {}, { includeHistory = false } = {}) {
  if (!leagueId) throw new Error("Enter a Sleeper league ID first.");

  const counts = { seasons: 0, users: 0, rosters: 0, matchups: 0, transactions: 0, draftPicks: 0 };

  // ---- 1. Resolve the requested scope ----
  const chain = await collectLeagueChain(leagueId, {
    includeHistory,
    getLeague: sleeper.league,
    log,
  });

  // ---- 2. Sync OLDEST FIRST ----
  // The order matters. sleeper_users holds one row per person with their
  // CURRENT team name, and each season's sync writes it. Running newest
  // first meant the oldest season had the last word, so everybody's
  // "current" team was really their 2019 team. Oldest first means the
  // newest season wins, which is what "current" should mean.
  const seasons = [];
  for (const league of chain) {
    const season = Number(league.season);
    log(`— syncing ${season}…`);

    const seasonCounts = await syncSeason(league, season, log);
    counts.users        += seasonCounts.users;
    counts.rosters      += seasonCounts.rosters;
    counts.matchups     += seasonCounts.matchups;
    counts.transactions += seasonCounts.transactions;
    counts.draftPicks   += seasonCounts.draftPicks;
    counts.seasons++;
    seasons.push(season);
  }
  seasons.reverse();   // report newest first

  await refreshMemberTeamNames(log);

  await db().from("sleeper_config").update({
    sleeper_league_id: String(leagueId).trim(),
    last_synced_at:    new Date().toISOString(),
    last_sync_note:    `${includeHistory ? "History repair" : "Current season"}: ${seasons.join(", ")}`,
  }).eq("id", 1);

  log(`Done. ${counts.seasons} season(s) synced.`);
  return { seasons, counts };
}

/**
 * Bring member profiles back in step with Sleeper's current team names.
 *
 * members.team_name was originally seeded from sleeper_users, which at the
 * time held the OLDEST season's name. Fixing the sync alone does not undo
 * that: the profile shows the member row, so it would keep displaying a
 * 2019 team forever.
 *
 * A name is only replaced when it is blank, or when it matches a team name
 * this owner used in some earlier season - i.e. it is stale imported data.
 * A name an admin typed by hand matches nothing historical and is left
 * alone, so custom names are never clobbered by a sync.
 */
async function refreshMemberTeamNames(log) {
  const [membersRes, usersRes, rostersRes] = await Promise.all([
    db().from("members").select("id, display_name, team_name, sleeper_user_id"),
    db().from("sleeper_users").select("sleeper_user_id, team_name"),
    db().from("sleeper_rosters").select("sleeper_user_id, team_name"),
  ]);

  if (membersRes.error || usersRes.error) return;   // members table is optional

  const currentName = new Map(
    (usersRes.data || []).map((u) => [u.sleeper_user_id, u.team_name || ""]));

  // every name each owner has ever used, to spot stale imported values
  const usedBefore = new Map();
  for (const r of rostersRes.data || []) {
    if (!r.sleeper_user_id || !r.team_name) continue;
    if (!usedBefore.has(r.sleeper_user_id)) usedBefore.set(r.sleeper_user_id, new Set());
    usedBefore.get(r.sleeper_user_id).add(r.team_name);
  }

  let changed = 0;
  for (const m of membersRes.data || []) {
    if (!m.sleeper_user_id) continue;

    const current = currentName.get(m.sleeper_user_id);
    if (!current || current === m.team_name) continue;

    const stale = !m.team_name || (usedBefore.get(m.sleeper_user_id)?.has(m.team_name) ?? false);
    if (!stale) continue;                      // admin typed it: leave it

    const { error } = await db().from("members")
      .update({ team_name: current }).eq("id", m.id);
    if (!error) changed++;
  }

  if (changed) log(`Updated ${changed} member team name(s) to the current season.`);
}

// ---------------------------------------------------------------------
// One season
// ---------------------------------------------------------------------

async function syncSeason(league, season, log) {
  const leagueId = league.league_id;
  const counts = { users: 0, rosters: 0, matchups: 0, transactions: 0 };

  const [users, rosters, bracket, losers] = await Promise.all([
    sleeper.users(leagueId),
    sleeper.rosters(leagueId),
    sleeper.winnersBracket(leagueId).catch(() => null),
    /* A league that runs no consolation bracket 404s here, and that is a valid
       league - last place is then simply unknown rather than guessed. */
    sleeper.losersBracket(leagueId).catch(() => null),
  ]);

  // roster_id -> owner user id, needed all over the place below
  const ownerOf = new Map((rosters || []).map((r) => [r.roster_id, r.owner_id]));

  // What each owner called themselves THIS season. Looked up by Sleeper
  // user id - never by name, because names are exactly what changes.
  const seasonNames = new Map((users || []).map((u) => [u.user_id, {
    team:    u.metadata?.team_name || "",
    display: u.display_name || u.username || "",
  }]));
  const nameFor = (userId) => seasonNames.get(userId) || { team: "", display: "" };

  // ---- people ----
  // One row per person holding their CURRENT identity. Because seasons are
  // synced oldest first, the newest season is the last to write here.
  if (users?.length) {
    await upsert("sleeper_users", users.map((u) => ({
      sleeper_user_id: u.user_id,
      username:        u.username || "",
      display_name:    u.display_name || u.username || "",
      team_name:       u.metadata?.team_name || "",
      avatar:          u.avatar || null,
      current_season:  season,
      updated_at:      new Date().toISOString(),
    })), "sleeper_user_id");
    counts.users = users.length;
  }

  // ---- rosters + standings ----
  // Both carry a snapshot of the name used that year, so history keeps
  // showing "Wolf Hunters" for 2019 even after the owner renames the team.
  if (rosters?.length) {
    await upsert("sleeper_rosters", rosters.map((r) => ({
      season,
      league_id:       leagueId,
      roster_id:       r.roster_id,
      sleeper_user_id: r.owner_id || null,
      team_name:       nameFor(r.owner_id).team,
      display_name:    nameFor(r.owner_id).display,
      players:         r.players  || [],
      starters:        r.starters || [],
      synced_at:       new Date().toISOString(),
    })), "season,roster_id");

    await upsert("sleeper_standings",
      buildStandings(rosters, season, league, leagueId, nameFor), "season,roster_id");
    counts.rosters = rosters.length;
  }

  // ---- champion / runner up from the playoff bracket ----
  const { championRoster, runnerUpRoster } = readBracket(bracket);
  /* DEAD LAST COMES FROM THE LOSERS BRACKET, never from the standings table.
     `rank` there is record then points for - what the table looked like going
     INTO the playoffs - and the Chip Eater is who came last coming out of them. */
  const lastPlaceRoster = readLastPlace(losers);

  /*
    A HUMAN'S ANSWER OUTRANKS THE BRACKET.

    champion_locked / last_place_locked mean "a commissioner set this by hand,
    leave it alone" - see season_result_override_schema.sql. The case that
    demanded it: sheyg2014 won 2019 and Sleeper has no record, because he was
    removed from the league that year. No amount of re-reading the API will
    ever produce that answer, so a sync that overwrote it would undo the
    correction every single time it ran.

    Read before the upsert rather than merged in SQL, because upsert() is a
    plain column write - putting the condition here keeps that helper dumb.
    A database without the migration has no columns to read and locks nothing,
    which is the old behaviour exactly.
  */
  let locks = { champion_locked: false, last_place_locked: false };
  try {
    const { data } = await db().from("sleeper_leagues")
      .select("champion_locked,last_place_locked")
      .eq("season", season).maybeSingle();
    if (data) locks = data;
  } catch { /* migration absent: nothing is locked */ }

  await upsert("sleeper_leagues", [{
    sleeper_league_id:  leagueId,
    season,
    name:               league.name || "",
    status:             league.status || "",
    scoring_settings:   league.scoring_settings || {},
    playoff_teams:      league.settings?.playoff_teams ?? null,
    /* Sleeper's own answer to "how many can I keep", rather than the app
       guessing or hard-coding one. Reads 1 for every DFL season on record. */
    max_keepers:        league.settings?.max_keepers ?? null,
    previous_league_id: league.previous_league_id || null,
    /* Locked columns are omitted from the patch entirely rather than written
       back with their current value - an upsert that names a column owns it,
       and not naming it is the only way to be sure a race cannot lose the
       commissioner's answer. */
    ...(locks.champion_locked ? {} : {
      champion_user_id: championRoster != null ? ownerOf.get(championRoster) ?? null : null,
    }),
    runner_up_user_id:  runnerUpRoster != null ? ownerOf.get(runnerUpRoster) ?? null : null,
    ...(locks.last_place_locked ? {} : {
      last_place_user_id: lastPlaceRoster != null ? ownerOf.get(lastPlaceRoster) ?? null : null,
    }),
    // Kept as well as the user id: a winner whose Sleeper account was
    // later deleted has no owner, and without this the season looks like
    // it has no champion at all. The roster still names the team.
    champion_roster_id:  championRoster ?? null,
    runner_up_roster_id: runnerUpRoster ?? null,
    synced_at:          new Date().toISOString(),
  }], "sleeper_league_id");

  // ---- weekly matchups and transactions ----
  const weeks = range(1, MAX_WEEK);

  const matchupRows = [];
  await inBatches(weeks, CONCURRENCY, async (week) => {
    const raw = await sleeper.matchups(leagueId, week);
    const rows = pairMatchups(raw, season, week, ownerOf, leagueId);
    if (rows.length) matchupRows.push(...rows);
  });
  if (matchupRows.length) {
    await upsert("sleeper_matchups", matchupRows, "season,week,matchup_id");
    counts.matchups = matchupRows.length;
    log(`   ${matchupRows.length} matchups`);
  }

  const txRows = [];
  await inBatches(weeks, CONCURRENCY, async (week) => {
    const raw = await sleeper.transactions(leagueId, week);
    for (const t of raw || []) {
      if (t.status === "failed") continue;         // rejected waiver claims
      txRows.push({
        sleeper_transaction_id: String(t.transaction_id),
        season,
        week:       t.leg ?? week,
        type:       t.type || "",
        status:     t.status || "",
        details:    t,
        created_ms: t.created ?? null,
      });
    }
  });
  if (txRows.length) {
    await upsert("sleeper_transactions", txRows, "sleeper_transaction_id");
    counts.transactions = txRows.length;
    log(`   ${txRows.length} transactions`);
  }

  counts.draftPicks = await syncDraft(leagueId, season, log);

  return counts;
}

/*
  THE DRAFT, for the one fact the Keeper Advisor cannot get anywhere else:
  the round a player actually went in, in this league.

  Deliberately quiet about the two normal ways this comes back empty. A
  season with no draft on Sleeper (2019, the league's first year) and a draft
  that has not happened yet (2026, still pre_draft) both give zero picks, and
  neither is a failure worth stopping a sync over - the advisor reads an
  absent round as absent and says so.

  Nothing is deleted. Upserting on (season, pick_no) means re-syncing a
  season rewrites only its own board, exactly like every other table here.
*/
async function syncDraft(leagueId, season, log) {
  let drafts;
  try {
    drafts = await sleeper.drafts(leagueId);
  } catch (err) {
    log(`   no draft data for ${season} (${err.message})`);
    return 0;
  }
  if (!drafts?.length) return 0;

  let written = 0;
  for (const draft of drafts) {
    const picks = await sleeper.draftPicks(draft.draft_id).catch(() => null);

    /* THE ORDER FIRST, and outside the early exit below. A draft still in
       pre_draft has zero picks but can perfectly well have an order, and
       that is the one season anybody wants it for. */
    await syncDraftOrder(draft, season, picks, log);

    if (!picks?.length) continue;

    const rows = picks
      /* A pick with no player is an unmade pick on a board still in
         progress. There is nothing to record about it. */
      .filter((p) => p.player_id != null && p.round != null && p.pick_no != null)
      .map((p) => ({
        season,
        draft_id:        String(draft.draft_id),
        pick_no:         Number(p.pick_no),
        round:           Number(p.round),
        draft_slot:      p.draft_slot ?? null,
        player_id:       String(p.player_id),
        roster_id:       p.roster_id ?? null,
        sleeper_user_id: p.picked_by || null,
        /* Carried faithfully. It is null on all 1080 DFL picks on record -
           this league runs keepers by hand - and the advisor treats a null
           as "not stated" rather than as "not a keeper". */
        is_keeper:       p.is_keeper ?? null,
        synced_at:       new Date().toISOString(),
      }));

    if (!rows.length) continue;
    await upsert("sleeper_draft_picks", rows, "season,pick_no");
    written += rows.length;
  }

  if (written) log(`   ${written} draft picks`);
  return written;
}

/*
  WHERE EACH TEAM PICKS FROM.

  Two facts, two tables. sleeper_drafts holds the event - type, rounds,
  status, start time - and sleeper_draft_slots holds one row per column of
  the board. Both keyed by season and written with upsert, so re-syncing a
  season rewrites its own board and cannot touch another year, exactly like
  every other table in this file.

  THREE WAYS THE ORDER ARRIVES, in order of trust:

    1. draft.draft_order on the object /league/<id>/drafts already returned.
    2. /draft/<draft_id>, fetched only when (1) came back empty. The list
       endpoint has been seen to omit the order that the single-draft
       endpoint carries, and one extra request per season is cheap.
    3. Round one of the picks. A completed draft IS its own order, so every
       season drafted before this table existed fills itself in without a
       request at all.

  AND ONE WAY IT DOES NOT ARRIVE. Before the commissioner shuffles the
  board, draft_order is null and there are no picks. That is a true state,
  not a failure: the draft row is written with order_known = false, no slots
  are stored, and the card says the order is not set. Nothing is guessed.
*/
async function syncDraftOrder(draft, season, picks, log) {
  let slots = slotsFromOrder(draft);

  if (!slots.length) {
    const full = await sleeper.draft(draft.draft_id).catch(() => null);
    if (full) slots = slotsFromOrder(full);
    if (full) draft = { ...draft, ...full };
  }
  if (!slots.length) slots = slotsFromPicks(picks);

  const now = new Date().toISOString();
  await upsert("sleeper_drafts", [{
    season,
    draft_id:      String(draft.draft_id),
    status:        draft.status || null,
    draft_type:    draft.type || null,
    rounds:        draft.settings?.rounds ?? null,
    /* Sleeper's start_time is epoch MILLISECONDS, and is null on a draft
       nobody has scheduled. */
    start_time_ms: draft.start_time ?? null,
    pick_timer_s:  draft.settings?.pick_timer ?? null,
    order_known:   slots.length > 0,
    synced_at:     now,
  }], "season");

  if (!slots.length) {
    log(`   draft order for ${season} is not set yet`);
    return 0;
  }

  await upsert("sleeper_draft_slots", slots.map((s) => ({
    season,
    draft_slot:      s.draft_slot,
    roster_id:       s.roster_id ?? null,
    sleeper_user_id: s.sleeper_user_id || null,
    synced_at:       now,
  })), "season,draft_slot");

  log(`   ${slots.length} draft slots`);
  return slots.length;
}

// ---------------------------------------------------------------------
// Shaping helpers
// ---------------------------------------------------------------------

/** Standings rows, ranked, with playoff qualification worked out. */
function buildStandings(rosters, season, league, leagueId, nameFor) {
  const playoffTeams = league.settings?.playoff_teams ?? 0;

  const rows = rosters.map((r) => {
    const s = r.settings || {};
    return {
      season,
      league_id:       leagueId,
      roster_id:       r.roster_id,
      sleeper_user_id: r.owner_id || null,
      team_name:       nameFor(r.owner_id).team,
      wins:            s.wins   || 0,
      losses:          s.losses || 0,
      ties:            s.ties   || 0,
      points_for:      points(s.fpts,         s.fpts_decimal),
      points_against:  points(s.fpts_against, s.fpts_against_decimal),
    };
  });

  // A season nobody has played yet has no standings. Ranking twelve 0-0
  // teams by nothing, and flagging half of them as playoff bound, would be
  // pure fiction - so leave rank empty until games have happened.
  const played = rows.some((r) => r.wins + r.losses + r.ties > 0);
  if (!played) {
    rows.forEach((row) => { row.rank = null; row.made_playoffs = false; });
    return rows;
  }

  // Sleeper's own tiebreaker: record first, then points for.
  rows.sort((a, b) =>
    (b.wins - a.wins) || (a.losses - b.losses) || (b.points_for - a.points_for));

  rows.forEach((row, i) => {
    row.rank = i + 1;
    row.made_playoffs = playoffTeams > 0 && row.rank <= playoffTeams;
  });

  return rows;
}

/** Sleeper splits points into whole and decimal parts. */
function points(whole, decimal) {
  return Number(whole || 0) + Number(decimal || 0) / 100;
}

/**
 * Sleeper returns one entry per TEAM per week, tied together by
 * matchup_id. Fold each pair into a single row.
 * Weeks that have not been played yet (everyone on 0) are skipped, so we
 * do not fill the table with empty future weeks.
 */
function pairMatchups(raw, season, week, ownerOf, leagueId) {
  if (!raw?.length) return [];
  if (!raw.some((m) => Number(m.points) > 0)) return [];   // not played yet

  const byMatchup = new Map();
  for (const m of raw) {
    if (m.matchup_id == null) continue;                    // bye / unmatched
    if (!byMatchup.has(m.matchup_id)) byMatchup.set(m.matchup_id, []);
    byMatchup.get(m.matchup_id).push(m);
  }

  const rows = [];
  for (const [matchupId, sides] of byMatchup) {
    const [a, b] = sides;
    const scoreA = a ? Number(a.points) : null;
    const scoreB = b ? Number(b.points) : null;

    let winner = null;
    if (scoreA != null && scoreB != null && scoreA !== scoreB) {
      winner = scoreA > scoreB ? a.roster_id : b.roster_id;
    }

    rows.push({
      season, week, matchup_id: matchupId, league_id: leagueId,
      roster1: a?.roster_id ?? null,
      user1:   a ? ownerOf.get(a.roster_id) ?? null : null,
      score1:  scoreA,
      roster2: b?.roster_id ?? null,
      user2:   b ? ownerOf.get(b.roster_id) ?? null : null,
      score2:  scoreB,
      winner_roster_id: winner,
    });
  }
  return rows;
}

/*
  readBracket() USED TO LIVE HERE.

  It moved to js/sleeper-bracket.js, unchanged, so it could be spec'd - sync.js
  imports the database and therefore cannot be. It went with a new sibling,
  readLastPlace(), which is the one this file actually needed and which had no
  home. Both now have tests, which matters for a guess about somebody else's
  data format whose failure mode is a wrong name carved into league history.
*/
const readBracket = readWinners;

// ---------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------

/*
  UPSERT IN CHUNKS, AND SURVIVE A TIMEOUT RATHER THAN DIE ON ONE.

  Supabase caps a statement at eight seconds for the anon role. Nothing here
  comes close except sleeper_transactions, which stores the whole Sleeper
  payload in a jsonb `details` column - two hundred of those in one statement
  is the heaviest write the sync makes, and the FIRST run of the day was
  reliably the one that lost the race, because a cold connection and a cold
  cache pay for themselves out of the same eight seconds. Re-running always
  worked, which is the signature of a size problem rather than a broken write.

  So a timeout is not treated as failure. The chunk is halved and both halves
  are tried - repeatedly, down to MIN_CHUNK - and only a chunk that is already
  small and still times out waits and retries, then finally gives up. Every
  other error is thrown immediately and untouched: a policy violation or a bad
  column will not get better for being tried again in smaller pieces.
*/
const CHUNK = 200;
const MIN_CHUNK = 20;
const RETRIES = 2;

/* Postgres 57014, which Supabase surfaces as a message rather than a code. */
const TIMEOUT = /statement timeout|canceling statement|57014/i;

async function upsert(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await writeChunk(table, rows.slice(i, i + CHUNK), onConflict);
  }
}

async function writeChunk(table, rows, onConflict, attempt = 0) {
  if (!rows.length) return;

  const { error } = await db().from(table).upsert(rows, { onConflict });
  if (!error) return;
  if (!TIMEOUT.test(error.message || "")) throw new Error(`${table}: ${error.message}`);

  /* Too big: split. Both halves go through the same path, so a chunk that is
     still too big after one halving simply halves again. */
  if (rows.length > MIN_CHUNK) {
    const half = Math.ceil(rows.length / 2);
    await writeChunk(table, rows.slice(0, half), onConflict);
    await writeChunk(table, rows.slice(half), onConflict);
    return;
  }

  /* Already small and still timing out: this is a slow database, not a big
     write. Wait, and give it two more goes before admitting defeat. */
  if (attempt < RETRIES) {
    await wait(500 * (attempt + 1));
    return writeChunk(table, rows, onConflict, attempt + 1);
  }

  throw new Error(`${table}: ${error.message}`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run an async job over a list, a few at a time. */
async function inBatches(items, size, job) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(job));
  }
}

function range(from, to) {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

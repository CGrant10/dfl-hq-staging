// =====================================================================
// sleeper.js - a thin wrapper around the public Sleeper API
// ---------------------------------------------------------------------
// Sleeper's read API needs no key and no login, and it allows browser
// requests, so we can call it straight from the page. It is READ ONLY:
// nothing in this app can change anything in Sleeper.
//
// Docs: https://docs.sleeper.com
// =====================================================================

const BASE = "https://api.sleeper.app/v1";

/** GET a Sleeper endpoint and return parsed JSON (or null for 404). */
async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Sleeper API ${res.status} on ${path}`);
  return res.json();
}

export const sleeper = {
  /** Current NFL season / week. */
  state:        ()            => get(`/state/nfl`),
  league:       (id)          => get(`/league/${id}`),
  users:        (id)          => get(`/league/${id}/users`),
  rosters:      (id)          => get(`/league/${id}/rosters`),
  matchups:     (id, week)    => get(`/league/${id}/matchups/${week}`),
  transactions: (id, week)    => get(`/league/${id}/transactions/${week}`),
  winnersBracket: (id)        => get(`/league/${id}/winners_bracket`),
  /* Last place is decided here, not by the regular-season table. See
     js/sleeper-bracket.js readLastPlace(). */
  losersBracket:  (id)        => get(`/league/${id}/losers_bracket`),
  /*
    THE DRAFT. Two calls: the league's drafts (one per season for DFL), then
    that draft's picks. A pick carries round, pick_no, draft_slot, player_id,
    roster_id and picked_by - picked_by being a Sleeper USER id, the same
    thing members.sleeper_user_id holds, so a pick maps to a member without
    going anywhere near a name.

    Verified against this league: 180 picks per season for 2020-2025, zero
    for 2019 (not drafted on Sleeper) and zero for a draft still in
    pre_draft. An absent draft is a null, not an error.
  */
  drafts:       (id)          => get(`/league/${id}/drafts`),
  draftPicks:   (draftId)     => get(`/draft/${draftId}/picks`),
  /*
    THE DRAFT ORDER, which lives on the draft object and NOT on the picks.
    /draft/<id> returns draft_order ({sleeper_user_id: slot}) and
    slot_to_roster_id ({slot: roster_id}) alongside type, settings.rounds,
    status and start_time.

    This is the only way to know where anyone picks BEFORE a draft happens:
    a draft in pre_draft has zero picks, so draft_slot on a pick cannot
    answer it. draft_order is null until the commissioner sets the order,
    which is a real state rather than a failure - see js/sync.js
    syncDraftOrder() and sleeper_draft_order_schema.sql.
  */
  draft:        (draftId)     => get(`/draft/${draftId}`),
};

// ---------------------------------------------------------------------
// Season stats, and the upcoming season's ADP
// ---------------------------------------------------------------------
// The Keeper Advisor needs two things Sleeper publishes and this app was not
// reading: what a player actually did last season, and what the upcoming
// draft is expected to cost.
//
// BOTH ARE PUBLIC AND KEYLESS, like everything else in this file. There is no
// API key anywhere in DFL HQ, no server-side proxy and no secret to leak,
// because the provider the app already trusts for rosters, drafts, identity
// and scoring settings also answers these two questions.
//
//   STATS   /v1/stats/nfl/regular/<season>  ->  { player_id: {statKey: count} }
//           The same stat keys the league's own scoring_settings uses, which
//           is what makes dfl-scoring.js a dot product. ~1.9MB.
//
//   ADP     /projections/nfl/<season>?season_type=regular&order_by=adp_<fmt>
//           One row per player with adp_std / adp_half_ppr / adp_ppr, the
//           player's position, and last_modified. Keyed on the SLEEPER player
//           id, so there is no name matching to get wrong. The position[]
//           filter takes it from 8.6MB to 2.9MB.
//
// Both are cached in the Cache API, the way the player map already is,
// because both are megabytes and neither changes on the timescale of a page
// view. A completed season's stats never change at all; ADP moves daily in
// August, so it gets a much shorter life and the card shows its date.
// ---------------------------------------------------------------------

const STATS_CACHE  = "sleeper-stats-v1";
const MARKET_CACHE = "sleeper-market-v1";
const WEEK_MS      = 7 * 24 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
/* The four positions the Advisor evaluates. Kickers and defences are not
   requested at all, which is both a smaller download and one less way for one
   to reach a surface that must not mention them. */
const MARKET_POSITIONS = ["QB", "RB", "WR", "TE"];

/**
 * Fetch-and-cache JSON that is too big to pull on every page view.
 *
 * A cache hit inside its life is returned without touching the network. A
 * stale hit is still returned if the fetch fails, because last week's ADP is
 * a great deal more useful than an empty card - the caller gets a timestamp
 * and says how old it is.
 */
async function cachedJson(cacheName, url, maxAgeMs) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(url);
  const hitAt = hit ? Number(hit.headers.get("x-fetched-at") || 0) : 0;

  if (hit && Date.now() - hitAt < maxAgeMs) {
    return { data: await hit.json(), fetchedAt: hitAt, fromCache: true };
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Sleeper API ${res.status}`);
    const data = await res.json();
    const fetchedAt = Date.now();
    await cache.put(url, new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", "x-fetched-at": String(fetchedAt) },
    }));
    return { data, fetchedAt, fromCache: false };
  } catch (err) {
    if (hit) return { data: await hit.json(), fetchedAt: hitAt, fromCache: true, stale: true };
    throw err;
  }
}

/**
 * One completed season's stats for every player, keyed by Sleeper player id.
 * @returns {Promise<{data:Object, fetchedAt:number}>}
 */
export function loadSeasonStats(season) {
  const year = Number(season);
  if (!Number.isFinite(year)) return Promise.resolve({ data: {}, fetchedAt: 0 });
  return cachedJson(STATS_CACHE, `${BASE}/stats/nfl/regular/${year}`, WEEK_MS);
}

/**
 * The upcoming season's ADP rows, for the four positions the Advisor uses.
 *
 * `format` is the league's own scoring format - see scoringFormat() in
 * dfl-scoring.js - so a PPR league is never shown standard-scoring ADP.
 * @returns {Promise<{data:Object[], fetchedAt:number}>}
 */
export function loadMarketAdp(season, format = "ppr") {
  const year = Number(season);
  if (!Number.isFinite(year)) return Promise.resolve({ data: [], fetchedAt: 0 });
  const positions = MARKET_POSITIONS.map((p) => `position[]=${p}`).join("&");
  const url = `https://api.sleeper.app/projections/nfl/${year}`
            + `?season_type=regular&order_by=adp_${format}&${positions}`;
  return cachedJson(MARKET_CACHE, url, SIX_HOURS_MS);
}

// ---------------------------------------------------------------------
// This week
// ---------------------------------------------------------------------
// Everything above is season-shaped: season projections, season ADP, a
// completed season's stats. None of it answers the question a manager
// actually asks on a Saturday, which is who to start on Sunday.
//
// The weekly projection endpoint answers it, and carries more than points:
// every row names the player's TEAM, their OPPONENT, the game_id and the
// current injury_status. So one call per week buys the projection, the
// matchup and the availability flag together - no second source, no
// scraping, no key.
// ---------------------------------------------------------------------

const WEEKLY_CACHE  = "sleeper-weekly-v1";
const TREND_CACHE   = "sleeper-trending-v1";
const THIRTY_MIN_MS = 30 * 60 * 1000;
const STATE_MS      = 15 * 60 * 1000;

/**
 * Where the NFL currently is: { week, season, season_type, season_start_date }.
 * Everything weekly hangs off this rather than a hardcoded week.
 * @returns {Promise<{data:Object, fetchedAt:number}>}
 */
export function loadNflState() {
  return cachedJson(WEEKLY_CACHE, `${BASE}/state/nfl`, STATE_MS);
}

/**
 * One week of projections for the four scoring positions.
 *
 * Cached for half an hour: these move during the week as injuries land, and
 * a stale Sunday-morning projection is worse than no advice at all.
 *
 * @returns {Promise<{data:Object[], fetchedAt:number}>}
 */
export function loadWeeklyProjections(season, week) {
  const year = Number(season), wk = Number(week);
  if (!Number.isFinite(year) || !Number.isFinite(wk) || wk < 1) {
    return Promise.resolve({ data: [], fetchedAt: 0 });
  }
  const positions = MARKET_POSITIONS.map((p) => `position[]=${p}`).join("&");
  const url = `https://api.sleeper.app/projections/nfl/${year}/${wk}`
            + `?season_type=regular&${positions}`;
  return cachedJson(WEEKLY_CACHE, url, THIRTY_MIN_MS);
}

/**
 * What the rest of the fantasy world is doing with a player, as raw add and
 * drop counts across every Sleeper league.
 *
 * This is the one genuinely external opinion the app can see. It is NOT a
 * projection and must never be scored like one - a hyped waiver add and a
 * good start are different claims - but it is a real answer to "am I the
 * only one who rates this guy".
 *
 * @returns {Promise<{adds:Map<string,number>, drops:Map<string,number>, fetchedAt:number}>}
 */
export async function loadTrendingPlayers({ hours = 24, limit = 200 } = {}) {
  const url = (kind) => `${BASE}/players/nfl/trending/${kind}`
                      + `?lookback_hours=${hours}&limit=${limit}`;
  const toMap = (rows) => new Map((rows || [])
    .map((row) => [String(row.player_id), Number(row.count) || 0]));
  try {
    const [addRes, dropRes] = await Promise.all([
      cachedJson(TREND_CACHE, url("add"), THIRTY_MIN_MS),
      cachedJson(TREND_CACHE, url("drop"), THIRTY_MIN_MS),
    ]);
    return {
      adds: toMap(addRes.data), drops: toMap(dropRes.data),
      fetchedAt: Math.max(addRes.fetchedAt || 0, dropRes.fetchedAt || 0),
    };
  } catch {
    /* An opinion signal is a bonus. Losing it must not cost the advice. */
    return { adds: new Map(), drops: new Map(), fetchedAt: 0 };
  }
}

// ---------------------------------------------------------------------
// Player names
// ---------------------------------------------------------------------
// Rosters come back as bare player ids ("4034"). The id -> name map is a
// separate ~5MB download, far too big to pull on every page load, so we
// fetch it only when something actually needs to show names and keep it
// in the Cache API for a week.
// ---------------------------------------------------------------------

const PLAYER_CACHE = "sleeper-players-v1";
const PLAYER_URL   = `${BASE}/players/nfl`;

let playersPromise = null;

/**
 * Returns a { player_id: {name, position, team} } map.
 * First call may take a few seconds; after that it is instant.
 */
export function loadPlayers() {
  if (playersPromise) return playersPromise;

  playersPromise = (async () => {
    const cache = await caches.open(PLAYER_CACHE);
    const hit = await cache.match(PLAYER_URL);

    if (hit) {
      const age = Date.now() - Number(hit.headers.get("x-fetched-at") || 0);
      if (age < WEEK_MS) return trim(await hit.json());
    }

    const res = await fetch(PLAYER_URL);
    if (!res.ok) throw new Error(`Could not load the Sleeper player list (${res.status})`);
    const raw = await res.json();

    // Store a slimmed copy - the full payload is mostly fields we never use.
    const slim = trim(raw);
    await cache.put(PLAYER_URL, new Response(JSON.stringify(slim), {
      headers: { "Content-Type": "application/json", "x-fetched-at": String(Date.now()) },
    }));
    return slim;
  })();

  return playersPromise;
}

function trim(map) {
  // Already slimmed on the way out of the cache.
  const first = Object.values(map)[0];
  if (first && first.n !== undefined) return map;

  const out = {};
  for (const [id, p] of Object.entries(map)) {
    out[id] = {
      n: p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || id,
      p: p.position || "",
      t: p.team || "FA",
    };
  }
  return out;
}

/** Friendly name for a player id, once loadPlayers() has resolved. */
export function playerName(players, id) {
  const p = players?.[id];
  return p ? `${p.n} (${p.p} · ${p.t})` : id;
}

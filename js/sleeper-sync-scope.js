const DEFAULT_MAX_SEASONS = 20;

/**
 * Resolve the league records a sync should touch.
 *
 * Normal syncs intentionally stop after the configured (current) league.
 * Historical traversal is an explicit repair operation because Sleeper gives
 * every season a new league id and links them through previous_league_id.
 */
export async function collectLeagueChain(leagueId, {
  includeHistory = false,
  getLeague,
  log = (_message) => {},
  maxSeasons = DEFAULT_MAX_SEASONS,
} = {}) {
  const firstId = String(leagueId || "").trim();
  if (!firstId) throw new Error("Enter a Sleeper league ID first.");
  if (typeof getLeague !== "function") throw new Error("A Sleeper league reader is required.");

  const chain = [];
  let currentId = firstId;
  let lookups = 0;

  while (currentId && lookups < maxSeasons) {
    const league = await getLeague(currentId);
    lookups++;

    if (!league) {
      if (lookups === 1) {
        throw new Error(`Sleeper has no league with ID ${currentId}. Double-check the ID.`);
      }
      log(`History chain ended at ${currentId}.`);
      break;
    }

    chain.push(league);
    log(`Found ${league.season}: ${league.name}`);
    if (!includeHistory) break;
    currentId = league.previous_league_id || null;
  }

  if (includeHistory && currentId && lookups >= maxSeasons) {
    log(`Stopped after ${maxSeasons} seasons.`);
  }

  return chain.sort((a, b) => Number(a.season) - Number(b.season));
}

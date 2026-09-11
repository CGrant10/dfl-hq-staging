// =====================================================================
// season-result.js - the commissioner names a champion or a Chip Eater.
// ---------------------------------------------------------------------
// One RPC, two callers (the Champions table and the Chip Eaters card), because
// the answer lands in the same place either way: the columns everything else
// already reads, with a lock beside them so Sync Sleeper leaves them alone.
// See season_result_override_schema.sql for why it is the same column rather
// than a separate override table - champion_user_id is read in fourteen files.
// =====================================================================

import { db } from "./supabase.js";

const MISSING = /set_season_result|champion_locked|schema cache|does not exist/i;

/** True when the app was told the migration is absent, not that the write failed. */
export const isMissingOverride = (err) => MISSING.test(err?.message || "");

/**
 * Record who a season belonged to.
 *
 * Exactly one field is set per call, so a champion correction can never
 * accidentally clear a Chip Eater. `memberId` of null clears the override and
 * hands that column back to the sync.
 *
 * @param {Object} input
 * @param {number} input.season
 * @param {"champion"|"lastPlace"} input.field
 * @param {number|null} input.memberId
 */
export async function setSeasonResult({ season, field, memberId = null }) {
  const champion = field === "champion";
  const { data, error } = await db().rpc("set_season_result", {
    target_season: Number(season),
    champion_member_id: champion ? memberId : null,
    last_place_member_id: champion ? null : memberId,
    set_champion: champion,
    set_last_place: !champion,
  });
  if (error) {
    throw new Error(isMissingOverride(error)
      ? "Run season_result_override_schema.sql in Supabase first"
      : (error.message || "That could not be saved"));
  }
  return Array.isArray(data) ? data[0] : data;
}

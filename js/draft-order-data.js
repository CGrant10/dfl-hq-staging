// =====================================================================
// draft-order-data.js - the one database read behind the draft board
// ---------------------------------------------------------------------
// Split from draft-order.js on purpose, the same way bottomline-routes.js
// is split from bottomline.js: supabase.js pulls the Supabase client from a
// CDN over https, and the test runner's ESM loader cannot follow that, so
// anything a spec imports has to stay clear of it. All the logic worth
// testing lives next door; this file is the wire.
// =====================================================================

import { db } from "./supabase.js";

/* A migration a league has not run yet must not take the front page down.
   Same shape as ACTIVITY_MISSING in js/activity.js. */
export const DRAFT_ORDER_MISSING = /sleeper_drafts|sleeper_draft_slots|sleeper_draft_picks|schema cache|does not exist/i;

/**
 * The newest season's draft and its board.
 * @returns {Promise<null|{draft:object, slots:object[], picks:object[]}>} null when there is
 *          no draft on record or the migration has not been run - either way
 *          the card draws nothing.
 */
export async function loadDraftOrder() {
  try {
    const { data: drafts, error } = await db()
      .from("sleeper_drafts").select("*")
      .order("season", { ascending: false }).limit(1);
    if (error) throw error;
    const draft = (drafts || [])[0] || null;
    if (!draft) return null;

    const { data: slots, error: slotErr } = await db()
      .from("sleeper_draft_slots").select("draft_slot,roster_id,sleeper_user_id")
      .eq("season", draft.season).order("draft_slot", { ascending: true });
    if (slotErr) throw slotErr;

    /* Status can lag behind the actual Sleeper draft. The completed pick
       count is independent evidence that lets Home retire the order as soon
       as the board is full, even before another commissioner sync updates
       sleeper_drafts.status. */
    const { data: picks, error: pickErr } = await db()
      .from("sleeper_draft_picks").select("pick_no,round,roster_id,sleeper_user_id")
      .eq("season", draft.season).order("pick_no", { ascending: true });
    if (pickErr && !DRAFT_ORDER_MISSING.test(pickErr.message || "")) throw pickErr;

    return { draft, slots: slots || [], picks: pickErr ? [] : (picks || []) };
  } catch (err) {
    /* An absent migration is silent; anything else is worth a console note
       but still must not take the page down. */
    if (!DRAFT_ORDER_MISSING.test(err?.message || "")) console.warn("draft order unavailable", err);
    return null;
  }
}

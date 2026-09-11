/* =====================================================================
   arena/results.js - writing an Arena race into the record
   ---------------------------------------------------------------------
   ONE writer, shared by the only two places entitled to ask for it: the
   Race View when the celebration starts, and the commissioner's "Save
   result" button on the event page.

   The rows are DERIVED, never observed. sim.order comes from simulate() on
   the event's stored seed, so the same seed always produces the same
   result and saving twice cannot store two different races. Nothing about
   winner, order or finishMs is decided here - this file only writes down
   what the simulation already said.

   Both writes are admin-only at the database. A member's call simply
   matches no rows, which is why every caller here checks what came back
   instead of trusting a cheerful 204.
   ===================================================================== */
import { db, updateRow } from "../supabase.js";

/** Where the shared clock is parked once the race is over. */
export const finalOffsetMs = (sim) => (sim.order.at(-1)?.finishMs ?? 0) + 400;

/**
 * CLAIM THE RIGHT TO WRITE THIS RESULT.
 *
 * A compare-and-set on bc_state, and it is the thing that makes an
 * automatic save safe. The Race View saves when the celebration starts, and
 * there is frequently more than one admin watching it - the commissioner's
 * phone and the machine running OBS are often both signed in, and both hit
 * that moment within a frame of each other.
 *
 * `neq("bc_state", "finished")` means the update matches only while the row
 * has not already been closed out. Exactly one caller gets a row back; every
 * other one gets an empty array and does nothing. That is a real lock taken
 * in Postgres rather than a promise the clients make each other.
 *
 * @returns {Promise<boolean>} true for the one caller that won the claim
 */
export async function claimFinish(eventId, offsetMs) {
  const { data, error } = await db().from("arena_events")
    .update({
      bc_state: "finished",
      bc_started_at: new Date().toISOString(),
      bc_offset_ms: offsetMs,
    })
    .eq("id", eventId)
    .neq("bc_state", "finished")
    .select("id");
  if (error) throw error;
  return !!(data && data.length);
}

/**
 * The result rows for a finished simulation, replacing whatever was there.
 *
 * Delete-then-insert rather than upsert, because a re-run can have fewer
 * racers than the run before it and leftover rows would show up as ghosts
 * in the order. Throws if the database refuses; the caller decides whether
 * that is worth a toast.
 */
export async function persistResult(eventId, sim, seed) {
  const { error: wipe } = await db().from("arena_results").delete().eq("event_id", eventId);
  if (wipe) throw wipe;

  const rows = sim.order.map((o) => ({
    event_id: eventId,
    member_id: o.racer.id,
    place: o.place,
    finish_ms: o.finishMs,
  }));
  const { error } = await db().from("arena_results").insert(rows);
  if (error) throw error;

  /* The event is closed out in the same breath, and the shared clock is
     parked on the final frame - so a viewer arriving after the fact sees the
     winner card rather than an empty start line. */
  await updateRow("arena_events", eventId, {
    status: "complete",
    seed,
    completed_at: new Date().toISOString(),
    bc_state: "finished",
    bc_started_at: new Date().toISOString(),
    bc_offset_ms: finalOffsetMs(sim),
  });
}

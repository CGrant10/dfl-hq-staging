// =====================================================================
// members.js - who is using this device
// ---------------------------------------------------------------------
// No accounts and no passwords. Opening the app asks "Who are you?" and
// the chosen member's id is kept in localStorage.
//
// THE IDENTITY MODEL, in one place, because the app has four things that
// could loosely be called "who you are" and they are not interchangeable:
//
//   MEMBER      the canonical league identity. members.id. Everything that
//               records participation uses it: votes, side-event sign-ups,
//               golf scores, arena racer picks, profile.
//   GOLF GUEST  an event-scoped identity and nothing more (golf-guest.js).
//               A guest has no member row and must never be treated as a
//               league member.
//   ADMIN       an authorisation state, not a person. Being admin does not
//               replace or imply a member identity.
//   USERNAME    LEGACY COMPATIBILITY ONLY. See below.
//
// The username slot in store.js is still mirrored from display_name when a
// member is picked. It no longer carries any participation identity - polls
// moved to member_id in polls_schema.sql and side events followed in
// side_events_member_schema.sql - and what still reads it is:
//
//   * app.js, as the "Who are you?" chip's last-resort label and as the
//     "has this device ever identified itself" test on first run
//   * supabase.js registerUser(), which appends to the write-only legacy
//     `users` table
//   * polls.js / calendar.js, to DISPLAY historical rows whose member_id
//     the migrations could not map safely
//
// Nothing new should depend on it. It is removable once the first-run test
// in app.js no longer needs a pre-member-picker device to look identified.
// =====================================================================

import { db, configured } from "./supabase.js";
import { setUsername } from "./store.js";

const KEY = "dfl.memberId";

let cache = null;
let inFlight = null;      // all active members, loaded once per page load
let current = null;    // the member using this device

export function getMemberId() {
  return localStorage.getItem(KEY) || "";
}

export function currentMember() {
  return current;
}

/** Active members, newest league additions last. */
export async function loadMembers({ force = false } = {}) {
  if (cache && !force) return cache;
  if (!configured) return [];
  /*
    The cache was read before the request and written after it resolved, so
    every caller that arrived while the first was still in flight fired its own.
    boot() calls restoreMember() inside a Promise.all while page modules ask for
    the same list, so that was a real duplicate request on every cold start.
    Holding the promise makes them share one.
  */
  if (inFlight && !force) return inFlight;

  inFlight = (async () => {
    const { data, error } = await db()
      .from("members")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("display_name", { ascending: true });

    if (error) throw error;
    cache = data || [];
    return cache;
  })();

  try {
    return await inFlight;
  } finally {
    /* Cleared either way: a rejected fetch must not be cached as the answer. */
    inFlight = null;
  }
}

/** Work out who this device belongs to. Returns null if not chosen yet. */
export async function restoreMember() {
  const id = getMemberId();
  if (!id) return null;

  try {
    const members = await loadMembers();
    current = members.find((m) => String(m.id) === String(id)) || null;
  } catch {
    current = null;
  }

  if (current) setUsername(current.display_name);
  return current;
}

/** Remember a member on this device. */
export function selectMember(member) {
  current = member;
  localStorage.setItem(KEY, String(member.id));
  /* The legacy mirror. Not identity any more - see the header - but the
     first-run test and the chip's fallback label still read it. */
  setUsername(member.display_name);
}

export function clearMember() {
  current = null;
  localStorage.removeItem(KEY);
}

/** Reload the current member's row after an edit. */
export async function refreshMember() {
  cache = null;
  return restoreMember();
}

/*
  WHICH PICTURE OF SOMEBODY TO USE.

  Four columns, one preference order, one place. The broadcast, a profile
  header and anything else that wants a member's face all ask here, so
  they cannot drift into disagreeing about what "their picture" means.

    profile_image     the person. The default everywhere.
    broadcast_image   the one the stage prefers - more personality than a
                      headshot, which is what a jumbotron wants.
    lookalike_image   the celebrity double.
    chaos_image       OPT-IN ONLY.

  chaos is never in a fallback chain and never reached for automatically:
  a caller has to name it. A championship slide is not the moment to
  surprise somebody with their worst photograph.

  Every branch ends at profile_image or null, so a member with nothing set
  behaves exactly as they did before these columns existed.
*/
export function memberImage(member, kind = "profile") {
  if (!member) return null;
  const profile = member.profile_image || null;
  switch (kind) {
    case "broadcast": return member.broadcast_image || member.lookalike_image || profile;
    case "lookalike": return member.lookalike_image || member.broadcast_image || profile;
    case "chaos":     return member.chaos_image || null;   // asked for by name, or not at all
    default:          return profile;
  }
}

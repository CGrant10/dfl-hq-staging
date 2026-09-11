/* =====================================================================
   golf-guest.js - who is holding this phone on the golf course
   ---------------------------------------------------------------------
   Half the field is not in the fantasy league, and until now that meant
   half the field could not enter a score. A guest had no member id, so
   every RLS policy on a golf score table said no, and somebody with a
   league account had to keep the card for them.

   A guest now signs in to ONE EVENT with the code off the tee sheet, picks
   their own name from that event's roster, and can score their own team.

   WHAT IS STORED HERE IS NOT AN AUTHORISATION.

   This module keeps the outing, the participant and the code in
   localStorage so nobody types it again on the 14th tee. None of that is
   trusted by anything. Every write carries the code to Postgres in a
   header and Postgres re-checks it against a hash the API cannot read -
   the same arrangement the admin password has always used. Editing
   localStorage here gets you precisely nothing, which is exactly why the
   pass is kept there rather than a "yes you are allowed" flag.

   ONE EVENT AT A TIME. A pass names its outing, and the headers are only
   sent when it does. Signing in to this year's outing does not carry over
   to next year's, and a pass for one event is not a pass for another.
   ===================================================================== */

const KEY = "dfl.golf.pass";

/**
 * The pass on this device, or null.
 * @returns {{outing:string, participant:string, code:string, name:string,
 *            teamId:string|null, teamName:string}|null}
 */
export function golfPass() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.outing && p.participant && p.code ? p : null;
  } catch { return null; }
}

/** The pass for THIS event, or null - a pass for another outing is not one. */
export function passFor(outingId) {
  const p = golfPass();
  return p && String(p.outing) === String(outingId) ? p : null;
}

export function saveGolfPass(pass) {
  try { localStorage.setItem(KEY, JSON.stringify(pass)); } catch {}
  notify();
}

export function clearGolfPass() {
  try { localStorage.removeItem(KEY); } catch {}
  notify();
}

/*
  The headers every request carries while a pass is held.

  Sent on ALL requests rather than only golf ones, because the Supabase
  client is built once per identity and cannot vary per table - and it
  costs nothing to do so: no policy outside the two golf score tables ever
  looks at these headers, so they are inert everywhere else.
*/
export function golfHeaders() {
  const p = golfPass();
  if (!p) return {};
  return {
    "x-golf-outing": String(p.outing),
    "x-golf-code": String(p.code),
    "x-golf-participant": String(p.participant),
  };
}

/* A cheap identity for the client cache: the memoised Supabase client has
   to be rebuilt when the pass changes, or a guest who just signed in would
   keep sending the old headers until the page reloaded. */
export function golfHeaderKey() {
  const p = golfPass();
  return p ? `${p.outing}:${p.participant}:${p.code.length}` : "";
}

const listeners = new Set();
export function onGolfPassChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of listeners) { try { fn(); } catch {} } }

/**
 * Ask Postgres whether this code is right, and get the event roster back.
 *
 * The app cannot check the code itself - the hash is deliberately
 * unreachable - so this is an RPC. An empty list means the code was wrong;
 * the function returns no rows rather than an error, so there is nothing
 * here that tells an attacker the difference between a bad code and an
 * event that has none.
 *
 * @returns {Promise<Array<{participant_id, display_name, team_id, team_name}>>}
 */
export async function verifyCode(client, outingId, code) {
  const { data, error } = await client.rpc("golf_guest_signin", {
    p_outing_id: Number(outingId),
    p_code: String(code || "").trim(),
  });
  if (error) throw error;
  return data || [];
}

/** Does this event let guests in at all? False when the SQL is not installed. */
export async function eventHasCode(client, outingId) {
  try {
    const { data, error } = await client.rpc("golf_has_event_code", { p_outing_id: Number(outingId) });
    if (error) return false;
    return data === true;
  } catch { return false; }
}

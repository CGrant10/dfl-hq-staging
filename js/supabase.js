// =====================================================================
// supabase.js - database access
// =====================================================================

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { getAdminToken, setAdminToken, getCommissionerPin, setCommissionerPin } from "./store.js";
import { golfHeaders, golfHeaderKey } from "./golf-guest.js";

export const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("YOUR-PROJECT-REF") && !SUPABASE_ANON_KEY.includes("YOUR-ANON");

let adminClient = null;
let adminClientKey = "";
let adminToken = "";
let adminOn = false;
let commissionerClient = null;
let commissionerAccess = null;
let commissionerMemberId = "";

let publicClient = null;
let publicClientKey = null;

function memberIdNow() { return localStorage.getItem("dfl.memberId") || ""; }
function notificationDeviceToken(memberId = memberIdNow()) {
  try { return memberId ? localStorage.getItem(`dfl.notification.deviceToken.${memberId}`) || "" : ""; }
  catch { return ""; }
}
function notificationHeaders(memberId = memberIdNow()) {
  const token = notificationDeviceToken(memberId);
  return token ? { "x-device-token": token } : {};
}

function makePublicClient() {
  const memberId = memberIdNow();
  const key = `${memberId}|${notificationDeviceToken(memberId)}|${golfHeaderKey()}`;
  if (publicClient && publicClientKey === key) return publicClient;
  publicClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        ...(memberId ? { "x-member-id": memberId } : {}),
        ...notificationHeaders(memberId),
        ...golfHeaders(),
      },
    },
  });
  publicClientKey = key;
  return publicClient;
}

/*
  THE ADMIN CLIENT CARRIES x-member-id TOO, AND NOT DOING SO WAS A REAL BUG.

  It used to send only the admin token. But `is_admin()` is an AUTHORISATION
  fact and x-member-id is an IDENTITY fact, and this app has plenty of functions
  that need the second regardless of the first - every one of them reads the
  header through dfl_current_member() or a local copy of it.

  So while signed in with the shared Admin password, db() returned this client
  and every member-scoped call failed for want of an identity:

    dfl_update_profile        'No member on this request' - the reported bug,
                              nobody could edit their own bio as admin
    profile_set_pin           could not set or change a Profile PIN
    keeper_set_self           could not choose their own keeper
    cast_vote                 could not vote
    sportsbook_touch_wallet   no bankroll, so no claim and no bets
    golf_save_profile         no handicap

  The commissioner client has always sent both, which is why the same actions
  worked in a commissioner session and failed in a master-admin one - a
  difference nobody would guess from the symptom.

  Sending it grants nothing extra: the member-scoped policies check that the
  header MATCHES the row being written, and is_admin() still depends on the
  token alone.

  Keyed like the public client so switching member rebuilds it - a cached header
  would otherwise let an admin who changed their name go on writing as the
  previous one.
*/
function adminHeaderKey(token) {
  return `${token}|${memberIdNow()}|${golfHeaderKey()}`;
}

function makeAdminClient(token) {
  const memberId = memberIdNow();
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        "x-admin-token": token,
        ...(memberId ? { "x-member-id": memberId } : {}),
        ...notificationHeaders(memberId),
        ...golfHeaders(),
      },
    },
  });
}

function makeCommissionerClient(memberId, pin) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        "x-member-id": String(memberId),
        ...notificationHeaders(memberId),
        "x-commissioner-pin": pin,
        ...golfHeaders(),
      },
    },
  });
}

function commissionerStillMatchesMember() {
  return !!commissionerClient && !!commissionerAccess && String(memberIdNow()) === String(commissionerMemberId);
}

/*
  VIEWING AS A MEMBER.

  Commissioners need to see what everybody else sees without logging out and
  back in. The credentials stay in memory - only the answers change: every gate
  below reports false and db() hands back the public client, so Postgres refuses
  a privileged write exactly as it would for a member. That last part is the
  point. A preview that hides the buttons but keeps the commissioner client
  underneath is a preview that lies: anything reached through a stale panel
  still writes for real while you believe you are sandboxed.

  Held in sessionStorage, not localStorage. Surviving a reload matters - the
  alternative is quietly handing your access back mid-test - but it should not
  outlive the tab, or you reopen the app tomorrow wondering what broke.
*/
/*
  Privileged access is granted and revoked long after boot - the profile-lock
  overlay in member-lock.js and the Admin page both call adminLogin() or
  commissionerLogin() from a form submit. Anything that renders based on those
  answers has no way to know they changed, which is exactly how the member-view
  switch shipped invisible: it decided once at boot and never looked again.
*/
export const ACCESS_EVENT = "dfl:access-change";
function announceAccessChange() {
  try { window.dispatchEvent(new CustomEvent(ACCESS_EVENT)); } catch {}
}

const MEMBER_PREVIEW_KEY = "dfl.memberPreview";
let memberPreview = (() => {
  try { return sessionStorage.getItem(MEMBER_PREVIEW_KEY) === "1"; } catch { return false; }
})();

/* Whether real privileged access exists, ignoring the preview. This is what
   decides if the toggle is offered at all, so it must not consult the gates. */
export function canPreviewAsMember() {
  return (adminOn && !!adminClient) || commissionerStillMatchesMember();
}
export function isMemberPreview() { return memberPreview && canPreviewAsMember(); }
export function setMemberPreview(on) {
  memberPreview = !!on && canPreviewAsMember();
  try {
    if (memberPreview) sessionStorage.setItem(MEMBER_PREVIEW_KEY, "1");
    else sessionStorage.removeItem(MEMBER_PREVIEW_KEY);
  } catch {}
  announceAccessChange();
  return memberPreview;
}

export function db() {
  /* Before the admin branch, or a master-admin preview would keep writing. */
  if (isMemberPreview()) return makePublicClient();
  if (adminOn && adminClient) {
    /* Rebuild on a changed member so the identity header cannot go stale while
       the authorisation header stays valid. */
    const key = adminHeaderKey(adminToken);
    if (key !== adminClientKey) {
      adminClient = makeAdminClient(adminToken);
      adminClientKey = key;
    }
    return adminClient;
  }
  if (commissionerStillMatchesMember()) return commissionerClient;
  return makePublicClient();
}

// Compatibility: existing pages use isAdmin() to decide whether privileged
// controls exist. It now means "an authenticated privileged session". Use
// isMasterAdmin(), isCommissionerOwner(), or hasPermission() when scope matters.
export function isAdmin() { return !isMemberPreview() && ((adminOn && !!adminClient) || commissionerStillMatchesMember()); }
export function isMasterAdmin() { return !isMemberPreview() && adminOn && !!adminClient; }
export function isCommissioner() { return !isMemberPreview() && !isMasterAdmin() && commissionerStillMatchesMember(); }
export function isCommissionerOwner() { return !isMemberPreview() && (isMasterAdmin() || !!(commissionerStillMatchesMember() && commissionerAccess?.is_owner)); }
export function commissionerProfile() { return !isMemberPreview() && commissionerStillMatchesMember() ? commissionerAccess : null; }
export function hasPermission(permission) {
  if (isMemberPreview()) return false;
  if (isMasterAdmin()) return true;
  if (!commissionerStillMatchesMember()) return false;
  if (commissionerAccess?.is_owner) return true;
  return (commissionerAccess?.permissions || []).includes(permission);
}

/*
  EDGE FUNCTIONS GET A CLIENT WITH NO GOLF PASS ON IT.

  golfHeaders() rides on EVERY request from a device holding a pass, by design
  - the client is built once per identity and cannot vary per table, and no
  policy outside the two golf score tables looks at those headers.

  For PostgREST that is free. For an Edge Function it is not: the browser must
  clear a CORS preflight first, and the function has to name every header it
  will accept. x-golf-outing / x-golf-code / x-golf-participant were not on
  send-notification's list, so the browser refused the POST before the function
  ran and supabase-js reported the only thing it could see - an Edge Function
  error, on a function that was healthy and never got the call. Enabling
  notifications died there for anyone who had signed in to a golf outing, which
  includes league members: the "Enter code" strip on the Golf page is drawn for
  everyone, not only guests.

  So Edge Function traffic goes out on its own client carrying identity and
  nothing else. The function reads x-member-id and x-device-token; it has never
  read a golf header, so none are lost. Privileged calls still pass
  privilegedFunctionHeaders() per invoke, which merges on top of these.

  The function's allow-list should be permissive too - it now echoes what the
  browser asks for - but that fix only exists once it is deployed, and this one
  ships with the app.
*/
let edgeClient = null;
let edgeClientKey = null;
export function edge() {
  const memberId = memberIdNow();
  const key = `${memberId}|${notificationDeviceToken(memberId)}`;
  if (edgeClient && edgeClientKey === key) return edgeClient;
  edgeClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        ...(memberId ? { "x-member-id": memberId } : {}),
        ...notificationHeaders(memberId),
      },
    },
  });
  edgeClientKey = key;
  return edgeClient;
}

/* `functions.invoke()` does not consistently carry the Supabase client's
   custom global headers into its Functions client. Pass the active app-level
   credentials explicitly for privileged Edge Function calls. */
export function privilegedFunctionHeaders() {
  if (isMemberPreview()) return {};
  const memberId = memberIdNow();
  if (isMasterAdmin()) {
    return {
      "x-admin-token": adminToken,
      ...(memberId ? { "x-member-id": memberId } : {}),
    };
  }
  if (commissionerStillMatchesMember()) {
    const pin = getCommissionerPin();
    return {
      "x-member-id": String(commissionerMemberId),
      ...(pin ? { "x-commissioner-pin": pin } : {}),
    };
  }
  return memberId ? { "x-member-id": memberId } : {};
}

export async function adminLogin(password, remember = true) {
  const client = makeAdminClient(password);
  const { data, error } = await client.rpc("is_admin");
  if (error) throw error;
  if (data !== true) return false;
  adminClient = client;
  /* Remembered so db() can rebuild this client when the selected member
     changes - see adminHeaderKey(). restoreAdmin() comes through here too, so
     a page reload gets the same treatment. */
  adminToken = password;
  adminClientKey = adminHeaderKey(password);
  adminOn = true;
  commissionerClient = null;
  commissionerAccess = null;
  commissionerMemberId = "";
  setCommissionerPin("");
  if (remember) setAdminToken(password);
  announceAccessChange();
  return true;
}

export async function commissionerLogin(pin, remember = true) {
  const memberId = memberIdNow();
  if (!memberId) return false;
  const client = makeCommissionerClient(memberId, pin);
  const { data, error } = await client.rpc("my_commissioner_access");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.member_id) return false;

  commissionerClient = client;
  commissionerMemberId = String(row.member_id);
  commissionerAccess = {
    member_id: row.member_id,
    is_owner: !!row.is_owner,
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
  };
  adminClient = null;
  adminClientKey = "";
  adminToken = "";
  adminOn = false;
  setAdminToken("");
  if (remember) setCommissionerPin(pin);
  announceAccessChange();
  return true;
}

export function adminLogout() {
  adminClient = null;
  adminClientKey = "";
  adminToken = "";
  adminOn = false;
  commissionerClient = null;
  commissionerAccess = null;
  commissionerMemberId = "";
  setAdminToken("");
  setCommissionerPin("");
  setMemberPreview(false);
  announceAccessChange();
}

export async function restoreAdmin() {
  if (!configured) return false;
  const master = getAdminToken();
  if (master) {
    try { if (await adminLogin(master, false)) return true; } catch {}
  }
  const pin = getCommissionerPin();
  if (pin && memberIdNow()) {
    try { return await commissionerLogin(pin, false); } catch {}
  }
  return false;
}

export async function changeAdminPassword(newPassword) {
  if (!isMasterAdmin()) throw new Error("Master admin access required");
  const { error } = await db().rpc("set_admin_password", { new_password: newPassword });
  if (error) throw error;
  adminClient = makeAdminClient(newPassword);
  adminToken = newPassword;
  adminClientKey = adminHeaderKey(newPassword);
  setAdminToken(newPassword);
}

export async function selectAll(table, { order = "created_at", asc = false, limit = null } = {}) {
  let q = db().from(table).select("*").order(order, { ascending: asc });
  if (limit) q = q.limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function selectOne(table, id) {
  const { data, error } = await db().from(table).select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function insertRow(table, row) {
  const { data, error } = await db().from(table).insert(row).select().single();
  if (error) throw error;
  return data;
}

/*
  ASK FOR THE ROW BACK. A REFUSED WRITE IS SILENT OTHERWISE.

  PostgREST answers an update that RLS refuses with 204 and zero rows, NOT an
  error. Without a .select() this function therefore returned successfully for
  a write that never happened, and every caller went on to toast "Saved",
  "Countdown", "Result cleared".

  That has now caused three separate "the app is broken" reports:

    keeper rules   the editor toasted Saved over a refused write, fixed
                   locally in that screen in v1.109.0
    race start     the Race View counted down against a shared row that still
                   said idle, and the poll put it back a second later
    clear result   "Result cleared", and the result stayed on screen

  Fixing it in each screen leaves the trap armed for the next one, so it is
  fixed here. A zero-row update now throws with `refused` set, which callers
  can distinguish from a genuine Postgres error - see clearResult() in
  pages/arena.js, which has to tell a refusal apart from a missing column.

  This does change behaviour for a caller that updates a row which no longer
  exists: that used to pass quietly and now reports. That is the correct answer
  to "did my write land" and it is the whole point.
*/
export async function updateRow(table, id, patch) {
  const { data, error } = await db().from(table).update(patch).eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    const refusal = new Error(
      `That change was refused, or ${table} row ${id} no longer exists. If you are signed in as a commissioner, check the matching permission in Admin - Commissioner Access.`);
    refusal.refused = true;
    throw refusal;
  }
}

export async function deleteRow(table, id) {
  const { error } = await db().from(table).delete().eq("id", id);
  if (error) throw error;
}

/* Legacy users table: write-only compatibility. Canonical identity is members.id. */
export async function registerUser(username) {
  if (!configured) return;
  try {
    await makePublicClient().from("users").upsert({ username }, { onConflict: "username", ignoreDuplicates: true });
  } catch {}
}

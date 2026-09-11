/* =====================================================================
   presence.js - "somebody else is in here"
   ---------------------------------------------------------------------
   An aggregate counter and nothing more: how many browsers have said
   hello in the last two minutes, and how many of those are in the Arena.

   IT CANNOT NAME ANYBODY, ON PURPOSE.

   DFL HQ has no per-user authentication - a member is whichever id sits
   in this device's localStorage, which a client can set to anything. So
   "Kirk is online" would be a statement about a real person resting on a
   claim anyone could forge. The token below is random, per browser, and
   is deliberately NOT the member id. The database never learns who.

   Named presence, profile views and a privacy toggle all wait for real
   auth. Until then the app says HOW MANY and never WHO.

   BEST EFFORT, AND QUIET ABOUT IT. Every call is wrapped: a missing
   table, a refused request or a dead network leaves the indicator hidden
   rather than putting an error on the front page. Presence is a lava
   lamp, not a feature anybody is waiting on.
   ===================================================================== */

import { db, configured } from "./supabase.js";
import { esc } from "./ui.js";
import { icon } from "./icons.js";

const KEY = "dfl.presenceToken";

/* One heartbeat every 45 seconds, and only while the tab is actually
   visible. That is roughly 80 writes an hour from an open tab, against a
   two minute activity window - enough to stay "active" with a comfortable
   margin if one call fails, and nowhere near a write per interaction. */
const BEAT_MS = 45000;

let timer = null;
let listening = false;
let latest = { active: 0, arena: 0 };
const watchers = new Set();

/** A random per-browser token. Not a member id, and never sent as one. */
function token() {
  try {
    let t = localStorage.getItem(KEY);
    if (!t) {
      t = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      localStorage.setItem(KEY, t);
    }
    return t;
  } catch {
    return null;                      // private mode: no heartbeat, no counter
  }
}

/** Which coarse bucket this route belongs to. Never a full route. */
export function zoneOf(hash = location.hash) {
  if (/^#\/arena/.test(hash)) return "arena";
  if (/^#\/golf/.test(hash)) return "golf";
  return "hq";
}

async function beat() {
  if (!configured) return;
  const t = token();
  if (!t) return;
  try {
    const { data, error } = await db().rpc("dfl_presence", { p_token: t, p_zone: zoneOf() });
    if (error) return;                             // table not created yet: stay quiet
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;
    latest = { active: Number(row.active) || 0, arena: Number(row.arena) || 0 };
    for (const fn of watchers) { try { fn(latest); } catch { /* a bad watcher is not our problem */ } }
  } catch {
    /* Offline, blocked, or the function does not exist. Nothing to say. */
  }
}

/**
 * Start the heartbeat. Safe to call repeatedly - the app calls it once on
 * boot, and calling it again simply does nothing.
 */
export function startPresence() {
  if (timer || !configured) return;
  beat();
  timer = setInterval(() => { if (!document.hidden) beat(); }, BEAT_MS);

  if (!listening) {
    listening = true;
    /* Coming back to a backgrounded tab should update immediately rather
       than waiting up to 45 seconds to admit you are here. */
    document.addEventListener("visibilitychange", () => { if (!document.hidden) beat(); });
    /* A route change moves you between zones, so the Arena count is right
       while somebody is actually watching a race. */
    window.addEventListener("hashchange", () => { if (!document.hidden) beat(); });
  }
}

/** Stop everything. Used by tests and by anything that tears the app down. */
export function stopPresence() {
  if (timer) { clearInterval(timer); timer = null; }
}

/** The last numbers we heard, without waiting for a round trip. */
export function presenceNow() { return latest; }

/** Be told when the numbers change. Returns an unsubscribe. */
export function onPresence(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

/*
  THE LINE ITSELF.

  Returns "" when there is nobody else, because "1 DFLer active" is just
  you, and an app telling you that you are alone is worse than saying
  nothing. It is written to sound like a lava lamp rather than a metric.
*/
export function presenceLine(p = latest) {
  const others = Math.max(0, (p.active || 0) - 1);
  if (!others) return "";
  const who = `${others} DFLer${others === 1 ? "" : "s"}`;
  if (p.arena > 0) return `${who} · ${p.arena} in the Arena`;
  return `${who} lurking`;
}

/*
  THE SAME LINE WITH ITS GLYPH, for callers that can take markup.

  presenceLine() stays text-only because it is also the accessible name
  and a textContent assignment; a flame emoji in that string is announced
  as "fire" mid-sentence and cannot be themed. The icon is drawn in
  currentColor by the SVG set instead, and is aria-hidden - the words
  beside it already carry the meaning.
*/
export function presenceHtml(p = latest) {
  const text = presenceLine(p);
  if (!text) return "";
  const glyph = (p.arena > 0 ? "stadium" : "flame");
  return `${icon(glyph, { size: 14, className: "alive-ico" })}<span>${esc(text)}</span>`;
}

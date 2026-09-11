/* =====================================================================
   golf-offline.js - strokes survive a course with no signal
   ---------------------------------------------------------------------
   Rolla has holes where a phone has no bars at all, and the scorecard used
   to write every stroke straight to Supabase: a failed save popped an
   alert and re-rendered the card, which threw away the number you had just
   typed. A round played in a dead zone lost holes.

   So the queue is the source of truth for anything you have entered but
   the server has not accepted yet:

     ENTER      the stroke lands in localStorage, synchronously, before any
                network call. Nothing is in flight when your thumb leaves
                the button.
     RENDER     the card draws server rows with the queue laid over the
                top, so what you see is always what you typed.
     FLUSH      the queue drains when it can - after the save delay, when
                the browser says it is back online, when the tab comes
                back to the front, and on a slow retry timer in between.

   One entry per hole, keyed outing:team:hole, so tapping + four times
   leaves one write to send rather than four. Last value wins, which is
   exactly what the card's own debounce already assumed.

   The card payload is cached here too. Without it a scorecard opened out
   of signal is an error page - with it you get the round as you last saw
   it and can keep scoring.
   ===================================================================== */
import { db } from "./supabase.js";

const PENDING_KEY = "dfl.golf.pending";
const cardKey = (outingId, teamId) => `dfl.golf.card.${outingId}.${teamId}`;

export const MIN_STROKES = 1;
export const MAX_STROKES = 15;

/* Slow on purpose. The flush is already kicked by every event that means
   "the network might be back"; this only covers the case where none of
   them fire - the walk from 4 green to 5 tee, signal returning with no
   online event because it never officially went away. */
const RETRY_MS = 20000;

/* A write the server keeps refusing must not block every hole behind it
   forever. Network failures are free to retry all day; this is the
   backstop for anything else. */
const MAX_TRIES = 20;

const OFFLINE_RE = /failed to fetch|networkerror|network request failed|load failed|timed? ?out|internet connection/i;

const listeners = new Set();
let flushing = false;
let retryTimer = 0;

/*
  A REFUSED STROKE HAS TO BE SAID OUT LOUD.

  flush() has always separated a dead zone from a refusal, and it drops a
  refusal out of the queue rather than retrying it forever - which is right.
  What it did with the news was return it in `refused` to a caller that has
  never existed: both status lines only ever asked "how many are waiting?".
  So a stroke the server threw out took the count to zero and the card went
  back to saying "Saves on its own", which is the app telling somebody their
  score is safe on a hole where it was actually thrown away.

  These are the failures since the app opened. They are deliberately NOT
  persisted: the point is to tell whoever is holding the phone right now, and
  a refusal nagging from a round three weeks ago is noise.

  A failure is forgotten the moment the SAME hole goes through, so the warning
  clears itself by the only thing that actually fixes it - entering the score
  again and having it land. Nothing has to be dismissed.
*/
const failures = [];

/** Strokes the server refused, newest last. */
export function refusals(outingId) {
  if (outingId == null) return failures.slice();
  return failures.filter((f) => f.outingId === String(outingId));
}

/* Same hole, same card: one supersedes the other. */
const sameTarget = (a, b) =>
  Number(a.hole) === Number(b.hole) &&
  (a.sideId != null || b.sideId != null
    ? String(a.sideId) === String(b.sideId)
    : String(a.teamId) === String(b.teamId) && String(a.outingId) === String(b.outingId));

function forgetFailure(entry) {
  for (let i = failures.length - 1; i >= 0; i--) {
    if (sameTarget(failures[i], entry)) failures.splice(i, 1);
  }
}

function notify() {
  for (const fn of listeners) { try { fn(); } catch {} }
}

// ---------------------------------------------------------------- storage

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }   // private mode / quota: the round still plays
}

function pendingMap() {
  const raw = readJSON(PENDING_KEY, {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function savePending(map) {
  writeJSON(PENDING_KEY, map);
  notify();
}

const entryKey = (outingId, teamId, hole) => `${outingId}:${teamId}:${hole}`;

// ------------------------------------------------------------------ queue

/**
 * Remember a stroke and start trying to send it.
 * @param {string|number} outingId
 * @param {string|number} teamId
 * @param {string|number} hole
 * @param {string|number} value  "" or null clears the hole
 * @throws if the strokes are not a legal score - a bad value never enters
 *         the queue, so a flush can never be stuck behind one
 */
function legal(value) {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;              // clearing the hole
  const strokes = Number(raw);
  if (!Number.isInteger(strokes) || strokes < MIN_STROKES || strokes > MAX_STROKES) {
    throw new Error(`Enter strokes from ${MIN_STROKES} to ${MAX_STROKES}`);
  }
  return strokes;
}

export function queueScore(outingId, teamId, hole, value) {
  const strokes = legal(value);
  const map = pendingMap();
  map[entryKey(outingId, teamId, hole)] = {
    outingId: String(outingId), teamId: String(teamId), hole: Number(hole),
    strokes, tries: 0,
  };
  savePending(map);
  flush();
}

/**
 * The same thing for one side of a 2v2.
 *
 * A pair's card is a different table (golf_match_scores, keyed by side) but
 * exactly the same problem - it is played on the same course, in the same
 * dead zones - so it goes through the same queue rather than growing a
 * second one that would have to be drained separately.
 *
 * The outing rides along on the entry so that resetting an event can drop
 * its queued strokes without having to look anything up.
 */
export function queueSideScore(outingId, sideId, hole, value, putts = 0, drops = 0) {
  const strokes = legal(value);
  const map = pendingMap();
  map[`side:${sideId}:${hole}`] = {
    outingId: String(outingId), sideId: String(sideId), hole: Number(hole),
    strokes, putts: Number(putts) || 0, drops: Number(drops) || 0, tries: 0,
  };
  savePending(map);
  flush();
}

/** Hole -> strokes for one side of a 2v2. */
export function pendingForSide(sideId) {
  const out = new Map();
  for (const entry of Object.values(pendingMap())) {
    if (entry.sideId === String(sideId)) out.set(Number(entry.hole), entry.strokes);
  }
  return out;
}

/** Hole -> the complete locally queued score details for a match side. */
export function pendingDetailsForSide(sideId) {
  const out = new Map();
  for (const entry of Object.values(pendingMap())) {
    if (entry.sideId === String(sideId)) out.set(Number(entry.hole), entry);
  }
  return out;
}

/** How many holes are waiting for one side, or for every side in a match. */
export function pendingCountSides(sideIds) {
  const want = new Set((sideIds || []).map(String));
  return Object.values(pendingMap()).filter((e) => e.sideId && want.has(e.sideId)).length;
}

export function dropPendingSides(sideIds) {
  const want = new Set((sideIds || []).map(String));
  const map = pendingMap();
  let changed = false;
  for (const [key, entry] of Object.entries(map)) {
    if (!entry.sideId || !want.has(entry.sideId)) continue;
    delete map[key];
    changed = true;
  }
  if (changed) savePending(map);
}

/** Hole -> strokes (null means "clear this hole") for one team's card. */
export function pendingFor(outingId, teamId) {
  const out = new Map();
  const prefix = `${outingId}:${teamId}:`;
  for (const [key, entry] of Object.entries(pendingMap())) {
    if (key.startsWith(prefix)) out.set(Number(entry.hole), entry.strokes);
  }
  return out;
}

/** How many holes are waiting - for the whole app, one team, or one event. */
export function pendingCount(outingId, teamId) {
  const entries = Object.values(pendingMap());
  if (outingId == null) return entries.length;
  return entries.filter((e) =>
    e.outingId === String(outingId) &&
    (teamId == null || e.teamId === String(teamId))).length;
}

/**
 * Forget queued strokes without sending them.
 *
 * This is what keeps "clear the scorecard" honest: without it, a queued
 * stroke would be re-sent after the delete and the card would refill
 * itself a moment after being wiped.
 */
export function dropPending(outingId, teamId) {
  const map = pendingMap();
  let changed = false;
  for (const [key, entry] of Object.entries(map)) {
    if (outingId != null && entry.outingId !== String(outingId)) continue;
    if (teamId != null && entry.teamId !== String(teamId)) continue;
    delete map[key];
    changed = true;
  }
  if (changed) savePending(map);
}

/** Run fn whenever the queue changes, so a UI can show what is waiting. */
export function onQueueChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ------------------------------------------------------------- card cache

export function cacheCard(outingId, teamId, payload) {
  writeJSON(cardKey(outingId, teamId), payload);
}

export function cachedCard(outingId, teamId) {
  return readJSON(cardKey(outingId, teamId), null);
}

export function dropCachedCard(outingId, teamId) {
  try { localStorage.removeItem(cardKey(outingId, teamId)); } catch {}
}

/* The same for a 2v2 card. Same reason: a pair standing on the 5th tee with
   no bars needs the card, not an error. */
const matchKey = (matchId) => `dfl.golf.match.${matchId}`;
export function cacheMatch(matchId, payload) { writeJSON(matchKey(matchId), payload); }
export function cachedMatch(matchId) { return readJSON(matchKey(matchId), null); }
export function dropCachedMatch(matchId) {
  try { localStorage.removeItem(matchKey(matchId)); } catch {}
}

// ------------------------------------------------------------------ flush

/*
  A refusal and a dead zone are not the same failure and must not be
  treated the same way. PostgREST answering "no" comes back with a code or
  a status - the server saw the write and rejected it, so retrying forever
  is pointless. A fetch that never arrived has neither.
*/
function retryable(err) {
  if (!navigator.onLine) return true;
  if (OFFLINE_RE.test(String(err?.message || err || ""))) return true;
  return !err?.code && !err?.status;
}

/* A 2v2 side's card: same queue, different table, keyed by side and hole. */
async function sendSide(entry) {
  const { sideId, hole, strokes, putts = 0, drops = 0 } = entry;
  const client = db();

  if (strokes == null) {
    const { error } = await client.from("golf_match_scores").delete()
      .eq("side_id", sideId).eq("hole", hole);
    if (error) throw error;
    return;
  }
  const { error } = await client.from("golf_match_scores")
    .upsert({ side_id: sideId, hole, strokes, putts, drops, updated_at: new Date().toISOString() },
            { onConflict: "side_id,hole" });
  if (error) throw error;
}

async function sendOne(entry) {
  if (entry.sideId != null) return sendSide(entry);
  const { outingId, teamId, hole, strokes } = entry;
  const client = db();

  if (strokes == null) {
    const { error } = await client.from("golf_scores").delete()
      .eq("outing_id", outingId).eq("team_id", teamId).eq("hole", hole);
    if (error) throw error;
    return;
  }

  const existing = await client.from("golf_scores").select("id")
    .eq("outing_id", outingId).eq("team_id", teamId).eq("hole", hole).maybeSingle();
  if (existing.error) throw existing.error;

  if (existing.data?.id) {
    const { error } = await client.from("golf_scores")
      .update({ strokes, member_id: null }).eq("id", existing.data.id);
    if (error) throw error;
    return;
  }

  const inserted = await client.from("golf_scores")
    .insert({ outing_id: outingId, team_id: teamId, member_id: null, hole, strokes });
  if (!inserted.error) return;

  /* Two phones on the same team wrote the hole at once. The other one got
     there first, so this becomes an update rather than an error. */
  if (String(inserted.error.code) === "23505") {
    const retry = await client.from("golf_scores")
      .update({ strokes, member_id: null })
      .eq("outing_id", outingId).eq("team_id", teamId).eq("hole", hole);
    if (retry.error) throw retry.error;
    return;
  }
  throw inserted.error;
}

function scheduleRetry() {
  if (retryTimer || !pendingCount()) return;
  retryTimer = setTimeout(() => { retryTimer = 0; flush(); }, RETRY_MS);
}

/**
 * Try to send everything waiting.
 * @returns {Promise<{sent:number, left:number, refused:string[]}>}
 */
export async function flush() {
  if (flushing) return { sent: 0, left: pendingCount(), refused: [] };
  if (!navigator.onLine) { scheduleRetry(); return { sent: 0, left: pendingCount(), refused: [] }; }

  flushing = true;
  let sent = 0;
  const refused = [];
  try {
    for (const [key, entry] of Object.entries(pendingMap())) {
      try {
        await sendOne(entry);
        /* This hole is on the server now, so any earlier refusal of it is
           history and must stop being reported. */
        forgetFailure(entry);
        const map = pendingMap();
        /* Re-read before deleting: the hole may have been typed again while
           this write was in flight, and that newer value must not be
           dropped on the floor. */
        if (map[key] && map[key].strokes === entry.strokes) { delete map[key]; savePending(map); }
        else notify();
        sent++;
      } catch (err) {
        const map = pendingMap();
        if (!map[key]) continue;                    // cleared while in flight
        if (retryable(err)) {
          map[key].tries = (map[key].tries || 0) + 1;
          if (map[key].tries < MAX_TRIES) { savePending(map); break; }  // stop: the network is down
        }
        delete map[key];
        const message = err?.message || "That stroke could not be saved";
        failures.push({
          outingId: entry.outingId, teamId: entry.teamId, sideId: entry.sideId,
          hole: entry.hole, strokes: entry.strokes, message,
        });
        savePending(map);       // notifies, so the card repaints with the failure
        refused.push(message);
      }
    }
  } finally {
    flushing = false;
  }
  if (pendingCount()) scheduleRetry();
  return { sent, left: pendingCount(), refused };
}

/* Every moment that means "the network might be back". */
addEventListener("online", () => flush());
addEventListener("visibilitychange", () => { if (!document.hidden) flush(); });
addEventListener("pageshow", () => flush());

/* Anything left over from a previous visit goes out as soon as the app
   opens, whether or not anybody navigates to the golf page. */
flush();

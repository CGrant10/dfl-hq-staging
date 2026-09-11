// =====================================================================
// settings.js - league preferences that live in the database.
// ---------------------------------------------------------------------
// One key/value table, read once per page load. Anything a commissioner
// sets that is not really "content" belongs here: the dashboard logo
// today, hidden cards and similar next.
//
// A missing table is NOT an error. Somebody who has not run
// settings_schema.sql yet just gets the defaults, so the app keeps working
// and nothing has to be run in a particular order.
// =====================================================================

import { db } from "./supabase.js";

let cache = null;

/** All settings as a Map. Empty if the table is missing. */
export async function loadSettings({ force = false } = {}) {
  if (cache && !force) return cache;

  const { data, error } = await db().from("app_settings").select("key, value");
  if (error) {
    // Table not created yet, or unreadable - defaults are a fine answer.
    console.warn("Settings unavailable, using defaults:", error.message);
    cache = new Map();
    return cache;
  }

  cache = new Map((data || []).map((r) => [r.key, r.value]));
  return cache;
}

/** Write one setting. Admin only - the database enforces that. */
export async function saveSetting(key, value) {
  const { error } = await db().from("app_settings")
    .upsert({ key, value: value ?? "", updated_at: new Date().toISOString() },
            { onConflict: "key" });
  if (error) throw error;
  cache = null;                       // next read comes from the database
}

export const KEY_LOGO   = "dashboard_logo";
export const KEY_HIDDEN = "hidden_cards";

/*
  Hidden cards.

  One setting holds a JSON array of "table:id" keys - announcements:4,
  rules:12 - rather than a `hidden` column on nine different tables. It
  needs no migration when the next kind of card becomes hideable, and a card
  that gets deleted just leaves a stale key that matches nothing.

  Read synchronously from the warm cache, because it is needed in the middle
  of building markup. app.js loads settings during start-up so the cache is
  populated before any page draws; if that has not happened yet this returns
  empty, which shows everything - the safe way to be wrong.
*/
export function hiddenCards() {
  try {
    const parsed = JSON.parse(cache?.get(KEY_HIDDEN) || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export async function setCardHidden(key, hide) {
  const set = hiddenCards();
  if (hide) set.add(key);
  else      set.delete(key);

  await saveSetting(KEY_HIDDEN, JSON.stringify([...set]));
  await loadSettings({ force: true });   // refill the cache we just cleared
}

/*
  Broadcast generators that are switched off.

  ONE SETTING HOLDING A LIST OF IDS, for the same reason hidden cards work
  that way: the alternative is a column, or a row, per generator, and there
  are fourteen of them with more to come. A generator that gets renamed or
  deleted leaves a stale id here that matches nothing, which is harmless.

  STORED AS THE EXCEPTIONS, NOT THE SETTINGS. The list is what is OFF, so a
  generator added next month is on by default and needs no migration - and
  an empty or unreadable setting means "everything on", which is the safe
  way to be wrong for a front page.
*/
export const KEY_BROADCAST_OFF = "broadcast_off";

export function broadcastOff() {
  try {
    const parsed = JSON.parse(cache?.get(KEY_BROADCAST_OFF) || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export async function setGeneratorOff(id, off) {
  const set = broadcastOff();
  if (off) set.add(id);
  else     set.delete(id);
  await saveSetting(KEY_BROADCAST_OFF, JSON.stringify([...set]));
  await loadSettings({ force: true });
}

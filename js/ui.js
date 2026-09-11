// =====================================================================
// ui.js - little helpers shared by every page
// =====================================================================

/** Escape text before dropping it into HTML. Always use this on user data. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/** "Sat, Aug 30, 2026" */
/**
 * "19:00:00" -> "7:00 PM", in the reader's own locale.
 *
 * NO TIMEZONE MATHS. The column behind this is a Postgres `time`, which
 * is wall clock and carries no zone - "the draft is at 7pm" means 7pm,
 * and converting it would show a member in another state the wrong hour
 * for an event they are driving to. Contrast toLocalInput() in form.js,
 * which DOES convert, because that one is backed by timestamptz.
 */
export function fmtTime(value) {
  if (!value) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value));
  if (!m) return "";
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (isNaN(d)) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Sat, Aug 29, 2026" or "Sat, Aug 29, 2026 · 7:00 PM" when a time is set. */
export function fmtWhen(date, time) {
  const day = fmtDate(date);
  const at = fmtTime(time);
  return at ? `${day} · ${at}` : day;
}

export function fmtDate(value) {
  if (!value) return "";
  const d = new Date(String(value).length === 10 ? value + "T12:00:00" : value);
  if (isNaN(d)) return String(value);
  return d.toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

/** "3 days away" / "today" / "2 weeks ago" */
export function relDate(value) {
  if (!value) return "";
  const d = new Date(String(value).length === 10 ? value + "T12:00:00" : value);
  if (isNaN(d)) return "";
  const days = Math.round((d - new Date()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return days < 14 ? `in ${days} days` : `in ${Math.round(days / 7)} weeks`;
  const ago = -days;
  return ago < 14 ? `${ago} days ago` : `${Math.round(ago / 7)} weeks ago`;
}

/** Short "Aug 6" style date used on announcement cards. */
export function fmtShort(value) {
  const d = new Date(value);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "$1,200" - drops the cents unless there are any. */
export function money(value) {
  const n = Number(value || 0);
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/*
  THE THREE SHARED STATES - loading, empty, error.

  All three draw from the one block in ui.css (".state"), so a page that is
  loading, a page with nothing on it and a page that failed look like three
  states of the same app rather than three different accidents. Nothing here
  carries a style="" attribute: if a state needs a colour it needs a class,
  because a hex code in a template is a colour that can never follow the
  rest of the palette.
*/

/** "Nothing here yet". `.empty` is this state's name in that block. */
export function empty(message) {
  return `<div class="empty">${esc(message)}</div>`;
}

/**
 * Standard loading placeholder. `is-loading` is what puts the moving
 * hairline on it - the app's one designed loading treatment, which until now
 * nothing actually asked for.
 */
export function loading(message = "Loading…") {
  return `<div class="state is-loading">${esc(message)}</div>`;
}

/** Friendly error box; logs the real error for you. */
export function errorBox(err) {
  console.error(err);
  const msg = err?.message || String(err);
  return `<div class="state is-error" role="alert">
    <span class="state-title">Could not load</span>
    <span class="tiny">${esc(msg)}</span>
  </div>`;
}

let toastTimer = null;
export function toast(message, bad = false) {
  const el = document.getElementById("toast");
  // Never let a missing element break the caller: toast() is routinely the
  // last line of a save, and throwing here would skip the re-render.
  if (!el) { console.log(message); return; }
  el.textContent = message;
  el.classList.toggle("bad", !!bad);
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

/** Turn ["a","b"] or a JSON string into a real array. */
export function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { const p = JSON.parse(value); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

/** Group rows into a Map keyed by the value of `key`. */
export function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = typeof key === "function" ? key(row) : row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

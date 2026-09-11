// =====================================================================
// bottomline.js - THE DFL BOTTOMLINE
// =====================================================================

import { db } from "./supabase.js";
import { manualTickerItems } from "./ticker-lines.js";
import { esc } from "./ui.js";
import { suppressedOn } from "./bottomline-routes.js";

export { suppressedOn };

const placementStyle = typeof document !== "undefined" ? document.createElement("style") : null;
if (placementStyle) {
  placementStyle.id = "dfl-bottomline-desktop-placement";
  placementStyle.textContent = `
    @media (min-width: 900px) {
      .bottomline { bottom: 0; }
      body.has-bottomline { padding-bottom: calc(40px + var(--bl-h)); }
      body.has-bottomline .install { bottom: calc(24px + var(--bl-h)); }
      body.has-bottomline .install.update { bottom: calc(86px + var(--bl-h)); }
      body.has-bottomline .toast { bottom: calc(24px + var(--bl-h)); }
    }
  `;
  document.head.appendChild(placementStyle);
}

const DAY = 86400000;
const REFRESH_MS = 5 * 60 * 1000;

function whenText(value, timeValue) {
  if (!value) return "";
  const d = new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
  if (isNaN(d)) return "";
  const days = Math.round((d.setHours(12, 0, 0, 0) - new Date().setHours(12, 0, 0, 0)) / DAY);
  const date = new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
  const label = days === 0 ? "today"
    : days === 1 ? "tomorrow"
    : days > 1 && days <= 6 ? date.toLocaleDateString(undefined, { weekday: "long" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const at = timeValue && days >= 0 && days <= 6 ? ` · ${shortTime(timeValue)}` : "";
  return `${label}${at}`;
}

function shortTime(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value));
  if (!m) return "";
  const h = Number(m[1]), min = m[2];
  const ampm = h >= 12 ? "pm" : "am";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${min === "00" ? "" : `:${min}`}${ampm}`;
}

function overrideMap(rows) {
  return new Map((rows || []).filter((r) => r?.auto_source).map((r) => [r.auto_source, r]));
}

function withOverride(source, item, overrides) {
  if (!item) return null;
  const ov = overrides.get(source);
  if (!ov) return item;
  if (ov.active === false) return null;
  const rawText = String(ov.text || "").trim();
  const text = /^\(automatic:/i.test(rawText) ? "" : rawText;
  return {
    ...item,
    label: String(ov.label || "").trim() || item.label,
    text: text || item.text,
    route: String(ov.route || "").trim() || item.route,
  };
}

/** Read league facts, hand-written ticker lines, and ticker-only overrides. */
export async function bottomlineItems() {
  const today = new Date().toISOString().slice(0, 10);
  const [eventsRes, golfRes, pollsRes, annRes, leagueRes, tickerRes] = await Promise.all([
    db().from("events").select("title,event_date,event_time")
      .gte("event_date", today).order("event_date", { ascending: true }).limit(1)
      .then((r) => r, () => ({ error: true })),
    db().from("golf_outings").select("name,event_date,status")
      .order("event_date", { ascending: false }).limit(6)
      .then((r) => r, () => ({ error: true })),
    db().from("polls").select("question,active").eq("active", true)
      .order("created_at", { ascending: false }).limit(1)
      .then((r) => r, () => ({ error: true })),
    db().from("announcements").select("title,content,created_at")
      .order("created_at", { ascending: false }).limit(1)
      .then((r) => r, () => ({ error: true })),
    db().from("sleeper_leagues").select("season,champion_user_id,status")
      .order("season", { ascending: false }).limit(4)
      .then((r) => r, () => ({ error: true })),
    /* auto_source is optional so an older database still degrades to the old
       hand-written-only query instead of taking the ticker down. */
    db().from("ticker_items").select("label,text,route,weight,active,starts_at,ends_at,auto_source")
      .order("weight", { ascending: false }).limit(24)
      .then((r) => r, async () => db().from("ticker_items")
        .select("label,text,route,weight,active,starts_at,ends_at")
        .eq("active", true).order("weight", { ascending: false }).limit(12)
        .then((r) => r, () => ({ error: true }))),
  ]);

  const tickerRows = tickerRes.error ? [] : tickerRes.data || [];
  const overrides = overrideMap(tickerRows);
  const items = manualTickerItems(tickerRows.filter((r) => !r.auto_source));

  const event = (eventsRes.error ? [] : eventsRes.data || [])[0];
  if (event?.title) {
    const when = whenText(event.event_date, event.event_time);
    const item = withOverride("next_event", {
      label: "Next up", text: `${event.title}${when ? ` · ${when}` : ""}`, route: "calendar",
    }, overrides);
    if (item) items.push(item);
  }

  const outings = golfRes.error ? [] : golfRes.data || [];
  const upcoming = outings.filter((o) => o.status !== "final" && o.event_date >= today)
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))[0];
  const lastFinal = outings.filter((o) => o.status === "final")[0];
  if (upcoming || lastFinal) {
    const item = upcoming
      ? { label: "Golf", text: `${upcoming.name || "Golf day"}${whenText(upcoming.event_date) ? ` · ${whenText(upcoming.event_date)}` : ""}`, route: "golf" }
      : { label: "Golf", text: `${lastFinal.name || "Golf day"} · final`, route: "golf" };
    const shown = withOverride("golf", item, overrides);
    if (shown) items.push(shown);
  }

  const open = (pollsRes.error ? [] : pollsRes.data || [])[0];
  if (open?.question) {
    const item = withOverride("poll", { label: "Poll open", text: open.question, route: "polls" }, overrides);
    if (item) items.push(item);
  }

  const ann = (annRes.error ? [] : annRes.data || [])[0];
  if (ann?.title || ann?.content) {
    const item = withOverride("notice", { label: "Notice", text: ann.title || ann.content, route: "home" }, overrides);
    if (item) items.push(item);
  }

  const leagues = leagueRes.error ? [] : leagueRes.data || [];
  const done = leagues.find((l) => l.status === "complete" && l.champion_user_id);
  if (done) {
    const name = await championName(done.champion_user_id);
    const item = name ? withOverride("champion", {
      label: `${done.season} champion`, text: name, route: "history",
    }, overrides) : null;
    if (item) items.push(item);
  }

  return items.filter((i) => i?.text);
}

async function championName(userId) {
  const res = await db().from("sleeper_users")
    .select("display_name,team_name").eq("sleeper_user_id", userId).limit(1)
    .then((r) => r, () => ({ error: true }));
  const row = (res.error ? [] : res.data || [])[0];
  return row?.team_name || row?.display_name || "";
}

let host = null;
let rotate = null;
let refreshTimer = null;
let refreshing = false;
let items = [];

function itemKey(list) {
  return JSON.stringify(list.map((i) => [i.label || "", i.text || "", i.route || "", i.tone || ""]));
}

/*
  LABEL COLOUR ALTERNATES ALONG THE TAPE: primary, secondary, primary,
  secondary. It is the longest run of accent text in the app, and painting
  all of it one hue is most of why a team palette looked like one colour.

  WHY THE PARITY IS STAMPED HERE INSTEAD OF IN CSS. The first attempt was
  `.bl-item:nth-of-type(even)`, which produced primary, primary, secondary,
  primary - because .bl-item is an <a> when the entry links somewhere and a
  <span> when it does not, and nth-of-type counts each tag in its own
  sequence. CSS cannot count by class, so the index comes from the loop that
  already has it.
*/
const altAttr = (n) => n % 2 ? ` data-bl-alt="1"` : "";

function markup(list, reduced) {
  const cell = (i, n) => `
    ${i.route ? `<a class="bl-item"${altAttr(n)} href="#/${esc(i.route)}">`
              : `<span class="bl-item"${altAttr(n)}>`}
      <span class="bl-label">${esc(i.label)}</span>
      <span class="bl-text">${esc(i.text)}</span>
    ${i.route ? `</a>` : `</span>`}`;
  if (reduced) {
    return `<div class="bl-static">${list.map((i, n) =>
      `<div class="bl-slot ${n === 0 ? "on" : ""}">${cell(i, n)}</div>`).join("")}</div>`;
  }
  /*
    THE REPEATING UNIT HAS TO BE AN EVEN NUMBER OF ITEMS.

    fillTickerWidth() repeats this tape verbatim with base.repeat(copies), so
    an odd-length unit puts two same-coloured labels back to back at every
    seam - the exact thing the alternation is for. An odd list is laid out
    twice, which changes nothing about the order or the content and makes the
    unit even, so no seam can ever double a colour.
  */
  const seq = list.length % 2 ? [...list, ...list] : list;
  /* A trailing dot is intentional: when a short sequence is repeated to fill
     a wide screen, the join between copies looks exactly like every other join. */
  const dot = `<span class="bl-dot" aria-hidden="true"></span>`;
  const tape = seq.map(cell).join(dot) + dot;
  return `<div class="bl-tape"><div class="bl-run">${tape}</div><div class="bl-run" aria-hidden="true">${tape}</div></div>`;
}

/** Fill each half of the marquee wider than the viewport, then animate one half.
 * Two copies only works when one copy is already wider than the screen; on an
 * ultrawide display that assumption creates the blank tail the user sees. */
function fillTickerWidth() {
  if (!host) return;
  const runs = [...host.querySelectorAll(".bl-run")];
  if (runs.length !== 2) return;
  const first = runs[0];
  const base = first.innerHTML;
  first.innerHTML = base;
  runs[1].innerHTML = base;
  const baseWidth = Math.max(1, first.scrollWidth);
  const need = Math.max(host.clientWidth * 1.15, baseWidth);
  const copies = Math.max(1, Math.ceil(need / baseWidth));
  if (copies > 1) {
    const filled = base.repeat(copies);
    first.innerHTML = filled;
    runs[1].innerHTML = filled;
  }
  const seconds = Math.max(18, Math.round(first.scrollWidth / 42));
  host.style.setProperty("--bl-duration", `${seconds}s`);
}

export function hideBottomline() {
  if (rotate) { clearInterval(rotate); rotate = null; }
  host?.remove();
  host = null;
  document.body.classList.remove("has-bottomline");
}

export function paintBottomline(route, hash = location.hash, { force = false } = {}) {
  if (suppressedOn(route, hash)) { hideBottomline(); return; }
  if (!items.length) { hideBottomline(); return; }
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (!force && host && host.classList.contains("is-static") === reduced) {
    document.body.classList.add("has-bottomline");
    return;
  }
  if (!host) {
    host = document.createElement("div");
    host.className = "bottomline";
    host.setAttribute("aria-label", "League bottom line");
    document.body.appendChild(host);
  }
  host.classList.toggle("is-static", reduced);
  host.innerHTML = markup(items, reduced);
  document.body.classList.add("has-bottomline");
  if (!reduced) fillTickerWidth();

  if (rotate) { clearInterval(rotate); rotate = null; }
  if (reduced) {
    const slots = [...host.querySelectorAll(".bl-slot")];
    if (slots.length > 1) {
      let at = 0;
      rotate = setInterval(() => {
        slots[at].classList.remove("on");
        at = (at + 1) % slots.length;
        slots[at].classList.add("on");
      }, 6000);
    }
  }
}

/*
  The route reader, kept so the Admin refresh button can repaint without being
  handed the router. startBottomline() is called once from app.js with the real
  one; before that there is nothing on screen to repaint anyway.
*/
let routeReader = null;

/**
 * Re-read the ticker and repaint it immediately.
 *
 * The timer below already does this every few minutes. This is the same work on
 * demand, for the Admin screen: an admin who has just written a line should not
 * have to wait out an interval to find out whether it shows.
 */
export async function refreshBottomlineNow() {
  items = await bottomlineItems();
  if (routeReader) paintBottomline(routeReader(), location.hash, { force: true });
}

async function refreshBottomline(routeOf) {
  if (refreshing) return;
  refreshing = true;
  try {
    const next = await bottomlineItems();
    if (itemKey(next) === itemKey(items)) return;
    items = next;
    paintBottomline(routeOf(), location.hash, { force: true });
  } catch { /* keep last good strip */ }
  finally { refreshing = false; }
}

export async function startBottomline(routeOf) {
  routeReader = routeOf;
  try { items = await bottomlineItems(); }
  catch { items = []; }
  if (items.length) paintBottomline(routeOf(), location.hash);
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => refreshBottomline(routeOf), REFRESH_MS);
  window.addEventListener("resize", () => {
    if (host && !host.classList.contains("is-static")) fillTickerWidth();
  }, { passive: true });
}

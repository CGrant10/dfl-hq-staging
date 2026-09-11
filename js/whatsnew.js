/* =====================================================================
   whatsnew.js - "here is what changed since you last looked"
   ---------------------------------------------------------------------
   DERIVED, NEVER RECORDED. There is no activity table, no event log and
   no per-item seen-set. This reads the timestamps the app already writes
   for its own reasons - created_at on the content tables, last_synced_at
   on the Sleeper config - and compares them against ONE watermark in
   localStorage.

   WHY THAT MATTERS. An event log would need a row written on every edit
   from every screen, a migration, and a policy - and it would drift the
   first time something was changed by a path that forgot to log. Reading
   created_at cannot drift, because it is the same column the content
   itself is ordered by. If a row exists, its timestamp is true.

   WHAT IT COSTS: this can only report things that HAVE a timestamp, and
   it can only say "3 new announcements", not "Dave edited the rules".
   That is the honest trade and it is why the strip says what it says.

   THE WATERMARK IS ONE VALUE, NOT A SET.

     dfl.seenAt        the last time this device dismissed the strip
     dfl.seenVersion   the app version it was on when it did

   A set of seen ids would grow forever, would need pruning, and would
   still be wrong on a second device. A single timestamp is self-pruning:
   everything older than it is, by definition, seen.

   THE 14-DAY CEILING. Somebody returning after three months does not
   want a changelog of their absence, they want to know what is current.
   The window never opens wider than a fortnight.

   FIRST RUN SHOWS NOTHING. A new device has no watermark, and treating
   that as "everything is new" would greet a first-time user with a list
   of things they have never seen the old version of. It sets the mark
   and stays quiet.
   ===================================================================== */

import { APP_VERSION } from "./config.js";
import { relDate, esc } from "./ui.js";

const DAY = 86400000;
const CEILING = 14 * DAY;

const KEY_AT  = "dfl.seenAt";
const KEY_VER = "dfl.seenVersion";

function read(key) {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode; strip just reappears */ }
}

/**
 * Mark everything up to now as seen. Called when the strip is dismissed,
 * and once on a first run so a new device starts quiet.
 *
 * `leagues` is optional and only used to stamp the champion watermark -
 * pass it wherever it is to hand, because a device that never stamps one
 * simply never announces a champion, which is the safe way to be wrong.
 */
export function markSeen(now = new Date(), leagues = null) {
  write(KEY_AT, now.toISOString());
  write(KEY_VER, APP_VERSION);
  if (leagues) {
    const champ = championSeason(leagues);
    if (champ) write(KEY_CHAMP, String(champ));
  }
}

/**
 * The window to report on, or null when there is nothing to report against.
 *
 * Returns { since, firstRun }. On a first run it sets the watermark as a
 * side effect and reports firstRun, so the caller shows nothing.
 */
export function window_(now = new Date()) {
  const raw = read(KEY_AT);
  if (!raw) { markSeen(now); return { since: null, firstRun: true }; }
  const seen = new Date(raw).getTime();
  if (Number.isNaN(seen)) { markSeen(now); return { since: null, firstRun: true }; }
  return { since: new Date(Math.max(seen, now.getTime() - CEILING)), firstRun: false };
}

const after = (ts, since) => {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  return !Number.isNaN(t) && t > since.getTime();
};

/*
  KINDS COLLAPSE. Three announcements are one line saying "3 new
  announcements", not three lines. The strip is a signpost - it exists to
  get you to the page where the actual things are - so listing them here
  would be the page, twice.
*/
function kind(id, count, one, many, href, icon) {
  return { id, count, href, icon, label: count === 1 ? one : many.replace("{n}", count) };
}

/*
  THE CHAMPION WATERMARK, and why it is a second value.

  Everything else here is dated by a timestamp the app already writes. A
  champion is not: sleeper_leagues has no created_at, only synced_at,
  which changes on every sync - so dating the champion by it would
  re-announce the same champion after every single sync, forever.

  So this one remembers WHAT was seen rather than WHEN: the newest season
  that had a champion last time. It fires once, when a new title is
  recorded, and then never again. Two values is the honest cost of not
  fabricating a timestamp that does not exist.
*/
const KEY_CHAMP = "dfl.seenChampion";

/** The newest season with a champion recorded, or 0. */
function championSeason(leagues) {
  return (leagues || []).reduce(
    (best, l) => (l?.champion_user_id ? Math.max(best, Number(l.season) || 0) : best), 0);
}

/**
 * What changed.
 *
 * @param {object} data  the rows home.js already has
 * @param {Date}   since the watermark
 * @returns {Array} zero or more collapsed lines
 */
export function changesSince(data, since) {
  const out = [];
  const {
    announcements = [], events = [], polls = [], syncedAt = null,
    golf = [], leagues = [], broadcast = [],
  } = data || {};

  /*
    CHAMPIONS FIRST. A title is the biggest thing that can change in this
    league, so it leads - everything below is ordered by how much a member
    would care, not by table name.
  */
  const champ = championSeason(leagues);
  const seenChamp = Number(read(KEY_CHAMP)) || 0;
  if (champ && seenChamp && champ > seenChamp) {
    out.push({ id: "champion", count: 1, href: "#/history", icon: "i-trophy",
               label: `${champ} champion added to History` });
  }

  /* A finalised outing is a real, dated event: somebody pressed finalise. */
  const golfDone = golf.filter((r) => after(r.finalized_at, since)).length;
  if (golfDone) out.push(kind("golf", golfDone, "Golf results are in",
    "Results are in for {n} golf outings", "#/golf", "i-golf"));

  const news = announcements.filter((r) => after(r.created_at, since)).length;
  if (news) out.push(kind("news", news, "A new announcement", "{n} new announcements", "#/calendar", "i-moment"));

  const pl = polls.filter((r) => after(r.created_at, since)).length;
  if (pl) out.push(kind("polls", pl, "A new poll to vote on", "{n} new polls to vote on", "#/polls", "i-polls"));

  const ev = events.filter((r) => after(r.created_at, since)).length;
  if (ev) out.push(kind("events", ev, "A new event on the calendar", "{n} new events on the calendar", "#/calendar", "i-calendar"));

  /* A sync is not content, but it IS the answer to "why did the standings
     change" - and it is the only line here that can be a single event
     rather than a count. */
  if (after(syncedAt, since)) {
    out.push({ id: "sync", count: 1, href: "#/history", icon: "i-history",
               label: "Fantasy results were updated" });
  }

  /*
    A hand-written broadcast slide is a thing the commissioner published
    FOR members, so it belongs here. Only the ones that are switched on and
    inside their window ever reach this function - loadBroadcastItems()
    filtered them - so a scheduled slide cannot leak before it airs.
  */
  const bx = broadcast.filter((r) => after(r.createdAt, since)).length;
  if (bx) out.push(kind("broadcast", bx, "Something new on the broadcast",
    "{n} new broadcast slides", null, "i-record"));

  /*
    THE APP ITSELF. Compared against the version this device last saw,
    not against a timestamp, because "the app updated" is a fact about the
    build and not about the clock. It is last in the list on purpose: it
    matters least to somebody opening the league's front page.
  */
  const seenVer = read(KEY_VER);
  if (seenVer && seenVer !== APP_VERSION) {
    out.push({ id: "app", count: 1, href: null, icon: "i-award",
               label: `DFL HQ updated to v${APP_VERSION}` });
  }

  return out;
}

/** "since Tuesday" / "since 3 days ago" - whatever relDate already says. */
export function sinceLabel(since) {
  try { return relDate(since.toISOString().slice(0, 10)); } catch { return "recently"; }
}

// ----------------------------------------------------------------- markup

/**
 * The strip. Returns "" when there is nothing to say, which is most days -
 * and a strip that appears every single visit is one nobody reads.
 *
 * It is NOT aria-live. This is present when the page draws rather than
 * something that arrives while you are reading, so announcing it would
 * interrupt for no reason. It is a <section> with a heading instead, which
 * puts it in the landmark list where a screen reader user can find it on
 * purpose.
 */
export function whatsNewStrip(changes, since) {
  if (!changes?.length) return "";
  return `
    <section class="wn" data-wn aria-labelledby="wn-title">
      <div class="wn-head">
        <svg class="ico-sm" aria-hidden="true"><use href="#i-moment"></use></svg>
        <strong id="wn-title" class="wn-title">New since ${esc(sinceLabel(since))}</strong>
        <button type="button" class="wn-x" data-wn-dismiss aria-label="Dismiss what's new">
          <svg class="ico-sm" aria-hidden="true"><use href="#i-close"></use></svg>
        </button>
      </div>
      <ul class="wn-list">
        ${changes.map((c) => {
          /* The icon is decoration - the label already says what changed -
             so it is aria-hidden and the row reads the same without it. */
          const ico = c.icon
            ? `<svg class="ico-sm" aria-hidden="true"><use href="#${esc(c.icon)}"></use></svg>`
            : "";
          return `<li>${c.href
            ? `<a href="${esc(c.href)}">${ico}<span>${esc(c.label)}</span></a>`
            : `<span class="wn-flat">${ico}<span>${esc(c.label)}</span></span>`}</li>`;
        }).join("")}
      </ul>
    </section>`;
}

/**
 * Wire the dismiss button.
 *
 * Dismissing sets the watermark to NOW, not to the newest item shown -
 * otherwise something posted between the page loading and the button being
 * pressed would be marked seen without ever having been on screen.
 */
export function wireWhatsNew(root, leagues = null) {
  const strip = root?.querySelector("[data-wn]");
  if (!strip) return;
  strip.querySelector("[data-wn-dismiss]")?.addEventListener("click", () => {
    markSeen(new Date(), leagues);
    strip.remove();
  });
}

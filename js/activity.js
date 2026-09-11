import { esc } from "./ui.js";

export const ACTIVITY_RPC = "activity_feed";
export const ACTIVITY_MISSING = /activity_feed|activity_log|schema cache|does not exist/i;

export function whenText(iso, now = Date.now()) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return new Date(then).toLocaleDateString([], { month: "short", day: "numeric" });
}

const VERB = { insert: "added", update: "changed", delete: "removed" };

export function activityLine(row, { now = Date.now() } = {}) {
  const who = row.display_name || "Somebody";
  const verb = VERB[row.action] || "touched";
  const thing = row.label || String(row.entity || "something").replace(/_/g, " ");
  const many = Number(row.row_count) || 1;
  const what = many > 1 ? `${many} ${thing}${thing.endsWith("s") ? "" : "s"}` : `a ${thing}`;
  return {
    who,
    text: `${verb} ${what}`,
    when: whenText(row.last_at, now),
    memberId: row.member_id || null,
  };
}

/*
  THE WALL USED TO BE MOUNTED FROM HERE, via a queueMicrotask that reached
  into the document for a [data-wall-slot] this function had just returned as
  a string. That made the activity feed responsible for rendering an
  unrelated feature, hid the Wall from anyone reading home.js, and meant the
  Wall could only ever appear directly after the feed. pages/home.js now
  loads and places it like any other section.
*/
export function activityCard(rows) {
  // Commissioner/admin writes are intentionally absent. The feed is for member
  // activity, not a running audit log of league maintenance.
  const lines = (rows || [])
    .filter((r) => r.as_commissioner !== true)
    .map((r) => activityLine(r));
  if (!lines.length) return "";

  return `<section class="block">
    <h2 class="section-title">Activity</h2>
    <div class="card"><div class="card-body"><ul class="act-list">${lines.map((l) => `
      <li class="act-row">
        <span class="act-who">${l.memberId ? `<a class="plainlink" href="#/profile?id=${esc(l.memberId)}">${esc(l.who)}</a>` : esc(l.who)}</span>
        <span class="act-what">${esc(l.text)}</span>
        <span class="act-when">${esc(l.when)}</span>
      </li>`).join("")}</ul></div></div>
  </section>`;
}

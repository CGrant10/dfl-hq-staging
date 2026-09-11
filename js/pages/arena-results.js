// =====================================================================
// Arena Results - spectator-safe read-only event result.
//
// Regular members need somewhere to land after a race ends. The normal Arena
// event page owns commissioner controls and historically auto-entered Broadcast
// whenever bc_state was finished, creating an exit loop for spectators. This
// page reads the same saved result without exposing any control surface.
// =====================================================================

import { db } from "../supabase.js";
import { esc, empty, errorBox, loading, fmtDate } from "../ui.js";
import { loadMembers } from "../members.js";
import { themeLabel } from "../arena/sprite-themes.js";
import { icon } from "../icons.js";

const ms = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? `${(n / 1000).toFixed(2)}s` : "—";
};

export async function render(view) {
  const id = new URLSearchParams((location.hash.split("?")[1] || "")).get("id");
  if (!id) {
    view.innerHTML = `<h1>Arena Results</h1>${empty("No Arena event selected.")}`;
    return;
  }

  view.innerHTML = loading("Reading the finish…");

  const [eventRes, resultRes, members] = await Promise.all([
    db().from("arena_events").select("id,name,description,theme,event_date,status,bc_state").eq("id", id).maybeSingle(),
    db().from("arena_results").select("member_id,place,finish_ms").eq("event_id", id).order("place"),
    loadMembers().catch(() => []),
  ]);

  if (eventRes.error || !eventRes.data) {
    view.innerHTML = `<h1>Arena Results</h1>${errorBox(eventRes.error || new Error("Event not found"))}`;
    return;
  }
  if (resultRes.error) {
    view.innerHTML = `<h1>Arena Results</h1>${errorBox(resultRes.error)}`;
    return;
  }

  const event = eventRes.data;
  const results = resultRes.data || [];
  const byId = new Map(members.map((m) => [String(m.id), m]));

  view.innerHTML = `
    <header class="page-head">
      <a class="backlink" href="#/arena">← Arena</a>
      <h1>${esc(event.name)}</h1>
      <p class="page-sub">
        ${esc(themeLabel(event.theme))}${event.event_date ? ` · ${esc(fmtDate(event.event_date))}` : ""}
      </p>
      ${event.description ? `<p class="page-sub">${esc(event.description)}</p>` : ""}
    </header>

    <div class="card">
      <div class="card-title">Race results</div>
      ${results.length ? `
        <div class="tblwrap">
          <table class="tbl">
            <thead><tr><th>Place</th><th>Racer</th><th class="num">Time</th></tr></thead>
            <tbody>
              ${results.map((r) => {
                const member = byId.get(String(r.member_id));
                const name = member?.display_name || "Unknown";
                return `<tr>
                  <td><strong>${esc(r.place)}</strong>${Number(r.place) === 1 ? ` ${icon("trophy", { size: 14, className: "win-ico" })}` : ""}</td>
                  <td>${member ? `<a href="#/profile?id=${member.id}">${esc(name)}</a>` : esc(name)}</td>
                  <td class="num">${esc(ms(r.finish_ms))}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>` : `
        <div class="card-body muted">The race has finished, but its saved results are not available yet.</div>`}
    </div>

    <div class="row-end">
      <a class="btn ghost" href="#/arena">Arena history</a>
    </div>
  `;
}

// =====================================================================
// Fantasy Fun Facts - "Did you know?"
// ---------------------------------------------------------------------
// One fact a day, chosen by the date so the whole league sees the same
// one, plus the rest of the book underneath it.
//
// This page computes nothing. funfacts.js derives the facts, and it in
// turn takes every figure from lore.js. Three layers, one direction, no
// second stats engine.
// =====================================================================
import { esc, errorBox, loading, toast } from "../ui.js";
import { loadLore, clearLore } from "../lore.js";
import { funFacts, factOfTheDay } from "../funfacts.js";
import { shareFact } from "../fact-share.js";
import { canEdit } from "../inline.js";

const ICON = {
  nailbiter: "i-versus", blowout: "i-versus", high: "i-record", low: "i-record",
  streak: "i-medal", volume: "i-history", title: "i-trophy",
};

export async function render(view) {
  view.innerHTML = loading();

  const lore = await loadLore();
  if (!lore || lore.error) { view.innerHTML = errorBox(lore?.error || new Error("No league data yet")); return; }

  const today = factOfTheDay(lore);
  const all = funFacts(lore);

  if (!today) {
    view.innerHTML = `<header class="page-head"><h1>DFL Lore</h1></header>
      <div class="state"><span class="state-title">Not enough history yet</span>
      <span>Once a few seasons have been synced from Sleeper, the league's records show up here.</span></div>`;
    return;
  }

  /* The rest of the book, today's fact excluded - it is already the top
     of the page and printing it twice makes the list look padded. */
  const rest = all.filter((f) => f.id !== today.id);

  view.innerHTML = `
    <header class="page-head"><h1>DFL Lore</h1></header>

    <section class="factcard dfl-mark" data-fact>
      <span class="fact-kicker">
        <svg class="ico-sm" aria-hidden="true"><use href="#${esc(ICON[today.kind] || "i-record")}"></use></svg>
        DFL Lore
      </span>
      <p class="fact-ask">Did you know?</p>
      <p class="fact-head">${esc(today.headline)}</p>
      <p class="fact-detail">${esc(today.detail)}</p>
      ${today.season ? `<span class="fact-when">${esc(today.season)} season</span>` : ""}
      <div class="row-end">
        <button type="button" class="btn ghost small" data-share>
          <svg class="ico-sm" aria-hidden="true"><use href="#i-moment"></use></svg>
          Share
        </button>
      </div>
    </section>

    <p class="muted tiny fact-note">A new piece of league history every day — the same one for everybody.</p>

    ${canEdit() ? `
      <section class="card lore-admin">
        <div class="card-title-row">
          <div>
            <div class="card-title">DFL Lore</div>
            <p class="muted tiny">The facts are worked out from the Sleeper data every time this page
            loads — there is no stored list to regenerate. Refresh re-reads the league from Supabase,
            which is what you want after a sync.</p>
          </div>
          <span class="admin-badge">Admin only</span>
        </div>
        <div class="row-end">
          <span class="muted tiny" data-lore-status>${all.length} facts from ${lore.matchups.length} games</span>
          <button type="button" class="btn ghost small" data-lore-refresh>Refresh DFL Lore</button>
        </div>
      </section>` : ""}

    ${rest.length ? `<h2 class="section-title">The rest of the lore<span class="count">${rest.length}</span></h2>
      <div class="factlist">
        ${rest.map((f) => `
          <article class="card fact-row">
            <svg class="ico-sm" aria-hidden="true"><use href="#${esc(ICON[f.kind] || "i-record")}"></use></svg>
            <div>
              <h3 class="card-heading">${esc(f.headline)}</h3>
              <div class="card-body">${esc(f.detail)}</div>
            </div>
          </article>`).join("")}
      </div>` : ""}
  `;

  /*
    THE REFRESH.

    It re-reads, it does not regenerate: clearLore() drops the cached
    league and loadLore({force}) fetches it again, which makes funfacts.js
    rebuild because it caches against the lore object's identity. That is
    the whole existing pipeline, run again - no second generation system.

    THIS IS NOT A SECURITY BOUNDARY, and it does not need to be. The
    operation is "re-read data this browser is already allowed to read", so
    a non-admin invoking it would gain exactly nothing. It is behind
    canEdit() because it is commissioner housekeeping, not because it is
    privileged - and nothing here writes.
  */
  view.querySelector("[data-lore-refresh]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const status = view.querySelector("[data-lore-status]");
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = "Refreshing…";
    if (status) status.textContent = "Re-reading the league…";
    try {
      clearLore();
      const fresh = await loadLore({ force: true });
      if (fresh?.error) throw fresh.error;
      const n = funFacts(fresh).length;
      toast(`DFL Lore refreshed — ${n} facts`);
      await render(view);                     // redraw with the new data
      return;
    } catch (err) {
      if (status) status.textContent = "Could not refresh";
      toast(err.message || "Could not refresh DFL Lore", true);
    }
    btn.disabled = false;
    btn.textContent = was;
  });

  view.querySelector("[data-share]")?.addEventListener("click", () => {
    /* A PICTURE, not a paragraph. shareCanvas() underneath falls back the
       right way on its own: the share sheet on a phone (which is how this
       reaches Messenger), then saving the PNG, then the clipboard. */
    const how = shareFact(today);
    if (how === "saved")  toast("Image saved to your downloads");
    if (how === "copied") toast("Copied — paste it in the group chat");
    if (how === "failed") toast("Could not share on this device", true);
  });
}

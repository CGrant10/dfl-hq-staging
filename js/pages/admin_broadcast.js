// =====================================================================
// Admin -> Broadcast. Three things that belong on one screen.
// ---------------------------------------------------------------------
//   the running order  what plays, in what order, with a live preview
//   the slides         a normal renderManager() over broadcast_items
//   the sources        which automatic generators may contribute
//
// They are together because they answer the same question - "what is on
// the front page" - and separating them would mean an admin turning off
// "Dues" in one place and wondering why their hand-written slide about
// dues, in another place, still shows.
//
// THE PREVIEW USES THE REAL RENDERER. renderItem() is the same function
// the public stage calls, inside an element carrying the same .bx-stage
// class, so what an admin sees is what ships. A second "preview
// renderer" would be a second thing to keep in sync, and it would drift.
//
// SECURITY: this panel is a convenience, not a control. Every write it
// makes is refused by RLS unless the request has the matching commissioner
// permission. Hiding this tab protects nothing and is not relied on.
// =====================================================================
import { esc, toast, errorBox } from "../ui.js";
import { db } from "../supabase.js";
import { renderManager } from "../crud.js";
import { specFor } from "../sections.js";
import { GENERATOR_LABELS, generatorStanding, weightToPass, renderItemFromRow, loadBroadcastOverrides, BROADCAST_COLUMNS } from "../broadcast-deck.js";
import { renderItem } from "../broadcast-stage.js";
import { loadSettings, broadcastOff, setGeneratorOff } from "../settings.js";
import { imageFieldHtml, wireImageFields } from "../image-field.js";
import { clearLore } from "../lore.js";
import { refreshBottomlineNow } from "../bottomline.js";
import { broadcastInboxHtml, wireBroadcastInbox } from "../broadcast-inbox.js";
import { ensureBroadcastStyles } from "../lazy-css.js";
/* Renders inside the Admin shell; asks in its own right so order never matters. */
ensureBroadcastStyles();

wireImageFields();

/*
  THE REFRESH BUTTON, and what it is actually for.

  Everything on this screen writes straight to Supabase, so the DATA is never
  stale - what goes stale is what has already been read. Three things cache:

    this panel      the running order and the preview were read once when the
                    tab opened, so a slide edited in another tab, or by another
                    commissioner, is not shown here
    lore            js/lore.js keeps one shared copy of the league's history
                    for the whole visit, and the deck is built from it
    the strip       js/bottomline.js re-reads on a timer, so a new ticker line
                    can take minutes to appear

  So Refresh drops the caches and reads again, in that order. It is not a
  "publish" button: nothing is held back waiting for it, and the front page
  would have caught up on its own eventually. It is for the ten seconds after
  an edit when you want to see whether it worked.
*/
function refreshBar(label) {
  return `<div class="row-end" style="margin-bottom:10px">
    <span class="muted tiny" data-bx-refreshed></span>
    <button type="button" class="btn ghost small" data-bx-refresh>${esc(label)}</button>
  </div>`;
}

export async function renderBroadcastPanel(host) {
  host.innerHTML = `
    ${refreshBar("Refresh the broadcast")}
    <div data-broadcast-inbox-slot></div>
    <section class="block" data-bx-order>
      <h2 class="section-title">Running order</h2>
      <div data-bx-rows></div>
    </section>
    <div data-bx-manager></div>
    <section class="block" data-bx-sources>
      <h2 class="section-title">Where slides come from</h2>
      <div class="card">
        <div class="card-body">Turn a source off and the front page stops
        building slides from it. Hand-written slides above are unaffected.</div>
        <div class="switchlist" data-bx-switches></div>
      </div>
    </section>`;

  const inboxSlot = host.querySelector("[data-broadcast-inbox-slot]");
  if (inboxSlot) {
    inboxSlot.innerHTML = await broadcastInboxHtml();
    wireBroadcastInbox(inboxSlot, () => renderBroadcastPanel(host));
  }
  await renderOrder(host.querySelector("[data-bx-rows]"));
  renderManager(host.querySelector("[data-bx-manager]"), specFor("broadcast_items"));
  await renderSources(host.querySelector("[data-bx-switches]"));
  wireRefresh(host, () => renderBroadcastPanel(host));
}

/*
  THE TICKER, with the same button.

  It was a bare table tab, which is still the right shape for five fields - this
  wraps it rather than replacing it, so the list, the form and the permission are
  all unchanged and the only new thing on the screen is Refresh.
*/
export async function renderTickerPanel(host) {
  host.innerHTML = `${refreshBar("Refresh the ticker")}<div data-tk-manager></div>`;
  renderManager(host.querySelector("[data-tk-manager]"), specFor("ticker_items"));
  wireRefresh(host, () => renderTickerPanel(host));
}

/**
 * Drop the caches, re-read, and say when.
 *
 * The button is disabled for the duration: a second click while the first read
 * is in flight would re-render the panel underneath the handler that is still
 * running against it, and the second render wins with the older data.
 */
function wireRefresh(host, again) {
  const btn = host.querySelector("[data-bx-refresh]");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Refreshing…";
    try {
      clearLore();                       // the deck is built from this
      await refreshBottomlineNow();      // the strip at the bottom of every page
      await again();                     // and this panel, from the database
      /* again() replaced the markup, so the stamp has to be found afresh - the
         element this handler captured is no longer in the document. */
      const stamp = host.querySelector("[data-bx-refreshed]");
      if (stamp) stamp.textContent = `Read at ${new Date().toLocaleTimeString()}`;
      toast("Refreshed");
    } catch (err) {
      btn.disabled = false;
      btn.textContent = label;
      toast(err.message || "Could not refresh", true);
    }
  });
}

// ------------------------------------------------------- the running order

async function renderOrder(host) {
  if (!host) return;
  /* The same column list the front page reads, so the preview cannot be
     drawn from a different row shape than the one that will play. */
  let { data, error } = await db()
    .from("broadcast_items")
    .select(`${BROADCAST_COLUMNS},active`)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  /* A commissioner who has not run broadcast_artwork_zoom_schema.sql yet still
     gets their running order, minus the column that migration adds. */
  if (error?.code === "42703") {
    ({ data, error } = await db()
      .from("broadcast_items")
      .select(`${BROADCAST_COLUMNS.replace(",image_zoom", "")},active`)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }));
  }
  if (error) { host.innerHTML = errorBox(error); return; }
  const rows = data || [];
  if (!rows.length) {
    host.innerHTML = `<div class="state"><span class="state-title">No slides yet</span>
      <span>Add one below and it will appear here in running order.</span></div>`;
    return;
  }

  host.innerHTML = `
    <div class="card">
      <div class="card-body">The order hand-written slides play in. Automatic
      slides are ranked by what is happening and are not listed here.</div>
      <ol class="bxorder">${rows.map(row).join("")}</ol>
    </div>
    <div class="bxpreview-wrap">
      <span class="u-label">Preview</span>
      <div class="bx-stage bxpreview" data-bx-preview></div>
    </div>`;

  preview(host, rows[0]);
  host.addEventListener("click", (e) => onOrderClick(e, host, rows));
}

function row(r, i) {
  const bits = [r.treatment];
  if (r.background && r.background !== "default") bits.push(r.background);
  bits.push(r.dwell_seconds ? `${r.dwell_seconds}s` : "auto");
  if (r.featured) bits.push("featured");
  if (!r.active) bits.push("OFF");
  return `
    <li class="bxrow${r.active ? "" : " is-off"}" data-bx-row="${r.id}">
      <button type="button" class="bxrow-main" data-bx-preview-id="${r.id}">
        <strong>${esc(r.headline || r.kicker || "Untitled slide")}</strong>
        <span class="muted">${esc(bits.join(" · "))}</span>
      </button>
      <span class="bxrow-moves">
        <button type="button" class="btn ghost small" data-bx-move="up" data-id="${r.id}"
          aria-label="Move ${esc(r.headline || "slide")} earlier">↑</button>
        <button type="button" class="btn ghost small" data-bx-move="down" data-id="${r.id}"
          aria-label="Move ${esc(r.headline || "slide")} later">↓</button>
      </span>
    </li>`;
}

function preview(host, r) {
  const box = host.querySelector("[data-bx-preview]");
  if (!box || !r) return;
  /* The same function the public stage uses, on a row shaped the same way
     loadBroadcastItems() shapes it. */
  box.innerHTML = renderItem(renderItemFromRow(r));
  const slide = box.querySelector(".bx-slide");
  slide?.classList.add("bx-in");
  box.classList.toggle("bx-on-light", (r.background || "") === "light");
}

async function onOrderClick(e, host, rows) {
  const show = e.target.closest("[data-bx-preview-id]");
  if (show) {
    const r = rows.find((x) => String(x.id) === show.dataset.bxPreviewId);
    preview(host, r);
    host.querySelectorAll(".bxrow").forEach((li) =>
      li.classList.toggle("on", li.dataset.bxRow === show.dataset.bxPreviewId));
    return;
  }

  const move = e.target.closest("[data-bx-move]");
  if (!move) return;
  const id = move.dataset.id;
  const at = rows.findIndex((x) => String(x.id) === id);
  const to = move.dataset.bxMove === "up" ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= rows.length) return;

  /*
    SWAP THE POSITIONS, not the rows.

    Both writes are sent before either is awaited, but they are checked
    together - if one is refused the order on screen would no longer match
    the database, and a reorder that half-worked is worse than one that
    did not. On failure the list is re-read rather than patched.

    The positions written are the two INDEXES, not the two stored values:
    every row created before this migration has sort_order 0, so swapping
    stored values would swap 0 with 0 and appear to do nothing.
  */
  host.querySelectorAll("[data-bx-move]").forEach((b) => (b.disabled = true));
  const a = rows[at], b = rows[to];
  const [ra, rb] = await Promise.all([
    db().from("broadcast_items").update({ sort_order: to }).eq("id", a.id),
    db().from("broadcast_items").update({ sort_order: at }).eq("id", b.id),
  ]);
  if (ra.error || rb.error) {
    toast((ra.error || rb.error).message || "Could not reorder", true);
  }
  await renderOrder(host);
}

// ------------------------------------------------------------ the sources

async function renderSources(list) {
  if (!list) return;
  await loadSettings();
  const off = broadcastOff();
  const overrides = await loadBroadcastOverrides();

  /*
    Each source is a switch plus a collapsed "Look" panel. It is <details>
    rather than a dialog because an admin adjusting several sources wants
    to see them next to each other, and because it costs no JavaScript.

    The fields here are PRESENTATION ONLY - there is deliberately no
    headline or body box. The golf score has to stay the golf score.
  */
  const sel = (name, id, value, options) => `
    <label class="ov-field"><span>${esc(name)}</span>
      <select data-ov="${esc(id)}" data-field="${esc(name.toLowerCase())}">
        ${options.map((o) => `<option value="${esc(o.v)}"${String(value || "") === o.v ? " selected" : ""}>${esc(o.l)}</option>`).join("")}
      </select></label>`;

  /*
    LISTED IN THE ORDER THEY WILL PLAY, not in registry order.

    The panel used to print the generators in the order they happen to appear in
    GENERATORS, which is source-code order and tells a commissioner nothing about
    what the front page does. Sorted by effective standing - base priority plus
    whatever has been done to it - the list IS the running order, which is what
    makes the arrows mean something.

    Ties keep registry order, so two sources on the same band do not shuffle
    between renders.
  */
  const order = [...GENERATOR_LABELS.keys()];
  const ranked = order
    .map((id, i) => ({ id, i, standing: generatorStanding(id, overrides.get(id)) }))
    .sort((a, b) => (b.standing - a.standing) || (a.i - b.i));

  list.innerHTML = ranked.map(({ id, standing }, position) => {
    const [name, what] = GENERATOR_LABELS.get(id);
    const ov = overrides.get(id) || {};
    const tweaked = ov.treatment || ov.background || ov.image || ov.dwell_seconds || ov.featured || ov.weight;
    return `
    <div class="srcrow">
      <label class="switchrow">
        <input type="checkbox" data-gen="${esc(id)}" ${off.has(id) ? "" : "checked"}>
        <span class="switch-text">
          <strong>${esc(name)}</strong>
          <span class="muted">${esc(what)}</span>
        </span>
      </label>
      <div class="srcmove">
        <button type="button" class="btn ghost small" data-gen-up="${esc(id)}"
          ${position === 0 ? "disabled" : ""} aria-label="Move ${esc(name)} earlier">↑</button>
        <button type="button" class="btn ghost small" data-gen-down="${esc(id)}"
          ${position === ranked.length - 1 ? "disabled" : ""} aria-label="Move ${esc(name)} later">↓</button>
        ${ov.featured ? `<span class="muted tiny">featured</span>`
          : ov.weight ? `<span class="muted tiny">moved</span>` : ""}
      </div>
      <details class="ovbox"${tweaked ? " open" : ""}>
        <summary>Look${tweaked ? " · customised" : ""}</summary>
        <div class="ovgrid" data-ov-form="${esc(id)}">
          ${sel("Treatment", id, ov.treatment, [
            { v: "", l: "Automatic (whatever suits the data)" },
            { v: "scoreboard", l: "Scoreboard (needs two sides)" },
            { v: "champion", l: "Champion" }, { v: "stat", l: "Stat" },
            { v: "announcement", l: "Announcement" }, { v: "event", l: "Event" },
            { v: "hero", l: "Hero" },
          ])}
          ${sel("Background", id, ov.background, [
            { v: "", l: "Automatic (house look)" },
            { v: "default", l: "DFL house" }, { v: "dark", l: "Dark" },
            { v: "light", l: "Light" }, { v: "image", l: "Image" }, { v: "logo", l: "Crest" },
          ])}
          <label class="ov-field"><span>Background picture</span>
            ${imageFieldHtml({ id: `ov-image-${id}`, name: `ov-image-${id}`,
                               value: ov.image || "", preset: "backdrop",
                               attrs: `data-ov="${esc(id)}" data-field="image"` })}</label>
          <label class="ov-field"><span>Seconds</span>
            <input type="number" min="3" max="15" data-ov="${esc(id)}" data-field="dwell_seconds" value="${esc(ov.dwell_seconds ?? "")}" placeholder="auto"></label>
          <label class="ov-field ov-check">
            <input type="checkbox" data-ov="${esc(id)}" data-field="featured" ${ov.featured ? "checked" : ""}>
            <span>Feature it</span></label>
          <div class="row-end">
            <button type="button" class="btn ghost small" data-ov-save="${esc(id)}">Save look</button>
            <button type="button" class="btn ghost small" data-ov-clear="${esc(id)}">Reset</button>
          </div>
        </div>
      </details>
    </div>`;
  }).join("");

  /*
    BIND ONCE. renderSources() re-renders itself after every save, so
    attaching listeners at the end of it would stack a new pair on the
    same element each time - two saves after the second edit, three after
    the third. The markup inside is replaced wholesale; the element is
    not, so one delegated listener on it survives every re-render.
  */
  if (list.dataset.wired === "1") return;
  list.dataset.wired = "1";

  /*
    REORDERING AN AUTOMATIC SOURCE.

    The weight column has existed since broadcast_v2_schema.sql and applyOverride()
    has always added it to the item's priority - there was simply never a control
    for it, and a raw "weight" box would have been useless anyway, because a
    weight means nothing until you know what it is being added to.

    So the arrow does the arithmetic: weightToPass() returns the weight that puts
    this generator one point past its neighbour's effective standing. One point is
    enough - the sort is a plain numeric compare, and leaving gaps would make the
    numbers drift upward every time somebody pressed an arrow.

    It nudges against the automatic ranking rather than pinning a position, which
    is the honest description: what actually plays also depends on what data
    exists that day and on the diversify() pass. The heading says "running order"
    for that reason.
  */
  list.addEventListener("click", async (e) => {
    const move = e.target.closest("[data-gen-up],[data-gen-down]");
    if (move) {
      const up = move.hasAttribute("data-gen-up");
      const id = up ? move.dataset.genUp : move.dataset.genDown;
      /* Recomputed from the CURRENT overrides rather than from the markup, so
         two quick presses cannot both read the same stale neighbour. */
      const fresh = await loadBroadcastOverrides();
      const ranked = [...GENERATOR_LABELS.keys()]
        .map((gid, i) => ({ gid, i, standing: generatorStanding(gid, fresh.get(gid)) }))
        .sort((a, b) => (b.standing - a.standing) || (a.i - b.i));
      const at = ranked.findIndex((r) => r.gid === id);
      const neighbour = ranked[up ? at - 1 : at + 1];
      if (!neighbour) return;                       // already at the end it wants
      move.disabled = true;
      try {
        const weight = weightToPass(id, neighbour.standing, { above: up });
        /* Only the weight is written. Spreading `existing` would send back
           every column the select happened to return, which is how a "move"
           quietly rewrites a look somebody set in the box below. */
        const { error } = await db().from("broadcast_overrides")
          .upsert({ generator: id, weight, updated_at: new Date().toISOString() },
                  { onConflict: "generator" });
        if (error) throw error;
        await renderSources(list);
      } catch (err) {
        move.disabled = false;
        toast(err?.message || "Could not move that", true);
      }
      return;
    }

    const save = e.target.closest("[data-ov-save]");
    const clear = e.target.closest("[data-ov-clear]");
    if (!save && !clear) return;
    const id = (save || clear).dataset.ovSave || (save || clear).dataset.ovClear;
    const box = list.querySelector(`[data-ov-form="${CSS.escape(id)}"]`);
    try {
      if (clear) {
        const { error } = await db().from("broadcast_overrides").delete().eq("generator", id);
        if (error) throw error;
        toast("Back to automatic");
      } else {
        const val = (f) => box.querySelector(`[data-field="${f}"]`);
        const num = Number(val("dwell_seconds").value);
        const row = {
          generator: id,
          treatment: val("treatment").value || null,
          background: val("background").value || null,
          image: val("image").value.trim() || null,
          dwell_seconds: Number.isFinite(num) && num > 0 ? Math.min(15, Math.max(3, Math.round(num))) : null,
          featured: val("featured").checked,
          updated_at: new Date().toISOString(),
        };
        const { error } = await db().from("broadcast_overrides").upsert(row, { onConflict: "generator" });
        if (error) throw error;
        toast("Look saved");
      }
      await renderSources(list);
    } catch (err) {
      toast(err.message || "Could not save that look", true);
    }
  });

  list.addEventListener("change", async (e) => {
    const box = e.target.closest("[data-gen]");
    if (!box) return;
    const id = box.dataset.gen;
    box.disabled = true;
    try {
      // checked means ON, and the setting stores what is OFF.
      await setGeneratorOff(id, !box.checked);
      toast(`${GENERATOR_LABELS.get(id)?.[0] || id} ${box.checked ? "on" : "off"}`);
    } catch (err) {
      box.checked = !box.checked;              // put the switch back
      toast(err.message || "Could not save that", true);
    }
    box.disabled = false;
  });
}

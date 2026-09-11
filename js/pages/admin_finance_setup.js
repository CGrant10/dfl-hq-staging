// =====================================================================
// Admin -> Finances -> Setup
// ---------------------------------------------------------------------
// Setting up a season used to mean: add a buy-in row, then add a dues row
// for each of twelve owners by hand, typing the same amount twelve times,
// then add each payout one at a time - about fifteen trips through a form
// before the page showed anything.
//
// This is that whole job on one screen:
//
//   * the buy-in, saved with the season
//   * "Add every league member", which creates the missing dues rows at
//     the buy-in amount, and a button to re-apply the buy-in if it changes
//   * the payout structure as an editable list, saved in one go, with a
//     running total against the pot so the money has to add up
//
// The per-row detail editors (who has paid what, expenses, side pots) are
// still the other tabs. This screen is for standing a season up.
// =====================================================================

import { db, insertRow, updateRow, deleteRow } from "../supabase.js";
import { esc, money, toast, errorBox, loading } from "../ui.js";
import { loadMembers } from "../members.js";

const THIS_YEAR = new Date().getFullYear();

// The season being set up. Kept across repaints of this panel.
let year = THIS_YEAR;

export async function renderFinanceSetup(host) {
  host.innerHTML = loading();

  let cfg, payments, payouts, members;
  try {
    const [cfgRes, payRes, poutRes] = await Promise.all([
      db().from("finance_seasons").select("*").eq("season", year).maybeSingle(),
      db().from("finance_payments").select("*").eq("season", year).order("owner_name"),
      db().from("finance_payouts").select("*").eq("season", year).order("sort_order"),
    ]);
    if (payRes.error || poutRes.error) throw payRes.error || poutRes.error;

    cfg      = cfgRes.data || null;
    payments = payRes.data || [];
    payouts  = poutRes.data || [];
    members  = await loadMembers().catch(() => []);
  } catch (err) {
    host.innerHTML = errorBox(err);
    return;
  }

  const buyIn = Number(cfg?.buy_in || 0);
  const pot   = buyIn * payments.length;
  const missing = members.filter(
    (m) => !payments.some((p) => sameName(p.owner_name, m.display_name)));
  const wrongDue = payments.filter((p) => Number(p.amount_due) !== buyIn);

  host.innerHTML = `
    <div class="card">
      <div class="card-title">Season</div>
      <div class="setup-grid">
        <label for="su-year">Season</label>
        <label for="su-buyin">Buy-in per team ($)</label>
        <input id="su-year" type="number" value="${esc(year)}" step="1">
        <input id="su-buyin" type="number" value="${esc(buyIn)}" step="1" min="0">
      </div>
      <div class="row-end">
        <button class="btn" id="su-save-season">Save season</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Teams</div>
      <div class="setup-figures">
        ${figure(payments.length, payments.length === 1 ? "team" : "teams")}
        ${figure(money(buyIn), "each")}
        ${figure(money(pot), "pot")}
      </div>

      ${payments.length
        ? `<div class="chiprow">${payments.map((p) =>
             `<span class="chip flat">${esc(p.owner_name)}</span>`).join("")}</div>`
        : `<p class="muted tiny">Nobody is in this season yet.</p>`}

      <div class="row-end">
        ${missing.length
          ? `<button class="btn" id="su-add-members">
               Add ${missing.length} league member${missing.length === 1 ? "" : "s"}
             </button>`
          : `<span class="muted tiny">Every league member is in this season.</span>`}
        ${wrongDue.length && buyIn > 0
          ? `<button class="btn ghost" id="su-fix-dues">
               Set ${wrongDue.length} due${wrongDue.length === 1 ? "" : "s"} to ${money(buyIn)}
             </button>`
          : ""}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Payouts</div>
      <div id="su-payouts">
        ${payouts.length
          ? payouts.map(payoutRow).join("")
          : ""}
      </div>
      <div class="row-end" style="justify-content:space-between">
        <button class="btn ghost small" id="su-add-payout">+ Add payout</button>
        <span id="su-tally" class="setup-tally"></span>
      </div>
      <div class="row-end">
        <button class="btn" id="su-save-payouts">Save payouts</button>
      </div>
    </div>
  `;

  // ---- the pot tally, recalculated as the amounts are typed ----
  const tally = host.querySelector("#su-tally");
  const retally = () => {
    const allocated = [...host.querySelectorAll("#su-payouts .po-amount")]
      .reduce((t, el) => t + (Number(el.value) || 0), 0);
    const left = pot - allocated;

    // A pot of zero has two different causes and they need different advice.
    if (!pot) {
      tally.innerHTML = `<span class="muted">${
        buyIn <= 0 ? "Set a buy-in to see the pot"
                   : "Add teams to see the pot"}</span>`;
      return;
    }

    tally.innerHTML = `${money(allocated)} of ${money(pot)}
      <span class="${left === 0 ? "ok" : left < 0 ? "over" : "under"}">
        ${left === 0 ? "balanced" : left < 0 ? money(-left) + " over" : money(left) + " left"}
      </span>`;
  };
  retally();

  host.querySelector("#su-payouts").addEventListener("input", retally);
  host.querySelector("#su-payouts").addEventListener("click", (e) => {
    const del = e.target.closest("button[data-drop]");
    if (!del) return;
    del.closest(".po-row").remove();
    retally();
  });

  host.querySelector("#su-add-payout").addEventListener("click", () => {
    host.querySelector("#su-payouts").insertAdjacentHTML("beforeend", payoutRow(null));
    retally();
  });

  // ---- save the season ----
  host.querySelector("#su-save-season").addEventListener("click", async (e) => {
    const newYear = Number(host.querySelector("#su-year").value);
    const newBuyIn = Number(host.querySelector("#su-buyin").value) || 0;
    if (!newYear) { toast("Give the season a year", true); return; }

    e.target.disabled = true;
    try {
      const { error } = await db().from("finance_seasons")
        .upsert({ season: newYear, buy_in: newBuyIn }, { onConflict: "season" });
      if (error) throw error;
      year = newYear;
      toast("Saved");
      renderFinanceSetup(host);
    } catch (err) {
      toast(err.message || "Could not save", true);
      e.target.disabled = false;
    }
  });

  // ---- add every member as a paying team ----
  host.querySelector("#su-add-members")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      for (const m of missing) {
        await insertRow("finance_payments", {
          season: year,
          owner_name: m.display_name,
          team_name: m.team_name || "",
          sleeper_user_id: m.sleeper_user_id || null,
          amount_due: buyIn,
          amount_paid: 0,
        });
      }
      toast(`Added ${missing.length} to ${year}`);
      renderFinanceSetup(host);
    } catch (err) {
      toast(err.message || "Could not add everyone", true);
      e.target.disabled = false;
    }
  });

  // ---- re-apply the buy-in after it changes ----
  host.querySelector("#su-fix-dues")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const { error } = await db().from("finance_payments")
        .update({ amount_due: buyIn }).eq("season", year);
      if (error) throw error;
      toast("Dues updated");
      renderFinanceSetup(host);
    } catch (err) {
      toast(err.message || "Could not update the dues", true);
      e.target.disabled = false;
    }
  });

  // ---- save the whole payout structure at once ----
  host.querySelector("#su-save-payouts").addEventListener("click", async (e) => {
    const rows = [...host.querySelectorAll("#su-payouts .po-row")].map((el, i) => ({
      id:     el.dataset.id || null,
      title:  el.querySelector(".po-title").value.trim(),
      amount: Number(el.querySelector(".po-amount").value) || 0,
      sort_order: i + 1,
    })).filter((r) => r.title);

    e.target.disabled = true;
    try {
      // Rows that were on screen but are gone now are deletions. Existing
      // rows are updated rather than replaced, so the winner and description
      // set on the Payouts tab survive an edit here.
      const kept = new Set(rows.filter((r) => r.id).map((r) => String(r.id)));
      for (const old of payouts) {
        if (!kept.has(String(old.id))) await deleteRow("finance_payouts", old.id);
      }
      for (const r of rows) {
        if (r.id) await updateRow("finance_payouts", r.id,
                     { title: r.title, amount: r.amount, sort_order: r.sort_order });
        else      await insertRow("finance_payouts",
                     { season: year, title: r.title, amount: r.amount, sort_order: r.sort_order });
      }
      toast("Payouts saved");
      renderFinanceSetup(host);
    } catch (err) {
      toast(err.message || "Could not save the payouts", true);
      e.target.disabled = false;
    }
  });
}

// ------------------------------- bits ---------------------------------

/** One editable payout line. `row` is null for a blank one. */
function payoutRow(row) {
  return `
    <div class="po-row" ${row ? `data-id="${esc(row.id)}"` : ""}>
      <input class="po-title" type="text" placeholder="Champion"
             value="${row ? esc(row.title) : ""}">
      <input class="po-amount" type="number" step="1" min="0" placeholder="0"
             value="${row ? esc(Number(row.amount)) : ""}">
      <button type="button" class="btn ghost small" data-drop aria-label="Remove">&times;</button>
    </div>`;
}

function figure(value, label) {
  return `<div class="setup-figure">
            <span class="sf-v">${esc(value)}</span>
            <span class="sf-l">${esc(label)}</span>
          </div>`;
}

function sameName(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

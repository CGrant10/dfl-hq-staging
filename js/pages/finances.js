// =====================================================================
// League Finances - read only for members, edited from Admin -> Finances
//
// Nothing on this page is a stored total. Prize pool, remaining balances,
// payment status and every summary figure are calculated here from the
// raw rows, so the numbers can never drift out of step with each other.
//
//   prize pool        = buy-in x number of teams
//   remaining         = amount due - amount paid
//   status            = paid / partial / unpaid
//   remaining balance = collected - expenses - payouts
// =====================================================================

import { db } from "../supabase.js";
import { esc, empty, money, fmtDate, errorBox } from "../ui.js";

let season = null;   // remembered while the app stays open

export async function render(view) {
  const [seasonsRes, paymentsRes, payoutsRes, expensesRes, compsRes] = await Promise.all([
    db().from("finance_seasons").select("*").order("season", { ascending: false }),
    db().from("finance_payments").select("*").order("owner_name", { ascending: true }),
    db().from("finance_payouts").select("*").order("sort_order", { ascending: true }),
    db().from("finance_expenses").select("*").order("expense_date", { ascending: true }),
    db().from("finance_competitions").select("*").order("name", { ascending: true }),
  ]);

  const err = seasonsRes.error || paymentsRes.error || payoutsRes.error ||
              expensesRes.error || compsRes.error;
  if (err) {
    view.innerHTML = `<h1>League Fees</h1>` + errorBox(err) +
      `<div class="card"><div class="card-body muted">If a table is missing, run
       <strong>finance_schema.sql</strong> in the Supabase SQL editor.</div></div>`;
    return;
  }

  const all = {
    seasons:  seasonsRes.data  || [],
    payments: paymentsRes.data || [],
    payouts:  payoutsRes.data  || [],
    expenses: expensesRes.data || [],
    comps:    compsRes.data    || [],
  };

  // Every season that appears anywhere, newest first.
  const years = [...new Set([
    ...all.seasons.map((r) => r.season),
    ...all.payments.map((r) => r.season),
    ...all.payouts.map((r) => r.season),
    ...all.expenses.map((r) => r.season),
    ...all.comps.map((r) => r.season),
  ])].sort((a, b) => b - a);

  if (!years.length) {
    view.innerHTML = `<h1>League Fees</h1>${empty("No fees on record yet.")}`;
    return;
  }

  if (!years.includes(season)) season = years[0];

  view.innerHTML = `
    <h1>League Fees</h1>
    <div class="tabs" id="fin-years">
      ${years.map((y) => `<button data-year="${y}" class="${y === season ? "on" : ""}">${y}</button>`).join("")}
    </div>
    <div id="fin-body"></div>
  `;

  const body = view.querySelector("#fin-body");
  const paint = () => { body.innerHTML = seasonView(all, season); };

  view.querySelector("#fin-years").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-year]");
    if (!btn) return;
    season = Number(btn.dataset.year);
    view.querySelectorAll("#fin-years button")
        .forEach((b) => b.classList.toggle("on", Number(b.dataset.year) === season));
    paint();
  });

  paint();
}

// ---------------------------------------------------------------------
// One season
// ---------------------------------------------------------------------

function seasonView(all, year) {
  const cfg      = all.seasons.find((s) => s.season === year);
  const payments = all.payments.filter((r) => r.season === year);
  const payouts  = all.payouts.filter((r) => r.season === year);
  const expenses = all.expenses.filter((r) => r.season === year);
  const comps    = all.comps.filter((r) => r.season === year);

  const buyIn     = Number(cfg?.buy_in || 0);
  const teams     = payments.length;
  const prizePool = buyIn * teams;

  const expected  = sum(payments, "amount_due");
  const collected = sum(payments, "amount_paid");
  const owed      = expected - collected;
  const spent     = sum(expenses, "amount");
  const paidOut   = sum(payouts, "amount");
  const remaining = collected - spent - paidOut;

  return `
    ${buyInCard(buyIn, teams, prizePool)}
    ${summaryCard({ expected, collected, owed, spent, paidOut, remaining })}
    ${paymentsCard(payments)}
    ${payoutsCard(payouts, prizePool)}
    ${compsCard(comps)}
    ${expensesCard(expenses)}
    ${cfg?.notes ? `<div class="card"><div class="card-title">Notes</div>
                    <div class="card-body">${esc(cfg.notes)}</div></div>` : ""}
  `;
}

function buyInCard(buyIn, teams, prizePool) {
  return `
    <div class="card accent">
      <div class="card-title">League buy-in</div>
      <div class="statgrid">
        ${stat("Buy-in", money(buyIn))}
        ${stat("Teams", teams)}
        ${stat("Prize pool", money(prizePool))}
      </div>
    </div>`;
}

function summaryCard(t) {
  const negative = t.remaining < 0;
  return `
    <div class="card">
      <div class="card-title">Fees summary</div>
      <div class="statgrid">
        ${/* "Dues expected" needed 99px on one line in a 76px cell - no legible
             type size fits that. It sits beside Collected, Owed and Balance,
             all one word, so it is one word too. */""}
        ${stat("Expected", money(t.expected))}
        ${stat("Collected", money(t.collected))}
        ${stat("Owed", money(t.owed), t.owed > 0 ? "warn" : "")}
        ${stat("Expenses", money(t.spent))}
        ${stat("Payouts", money(t.paidOut))}
        ${stat("Balance", money(t.remaining), negative ? "bad" : "good")}
      </div>
      ${/* The formula note is gone; the warning stays, because an
            overcommitted league is news rather than an explanation. */ ""}
      ${negative ? `<div class="card-meta">
        <strong class="warntext">More has been committed than collected.</strong>
      </div>` : ""}
    </div>`;
}

// ------------------------------- dues --------------------------------

/**
 * Who has paid.
 *
 * This was an eight column table - owner, team, due, paid, left, status,
 * date, notes - which on a phone meant scrolling sideways past the money to
 * reach the one column anybody opens this page for. The status is now a
 * coloured dot to the LEFT of the name, so "who still owes" is answered by
 * running your eye down the left edge without scrolling anywhere.
 *
 * The team name is gone: this list is about people, the name is right there
 * on their profile, and it was making every row twice as wide as it needed
 * to be. Date paid and notes are still on Admin -> Finances -> Dues.
 */
function paymentsCard(rows) {
  if (!rows.length) {
    return `<div class="card"><div class="card-title">Dues</div>${empty("Nobody added yet.")}</div>`;
  }

  const paidCount = rows.filter((r) => statusOf(r).key === "paid").length;

  return `
    <div class="card duecard">
      <div class="card-title" style="padding:15px 16px 10px;margin:0">
        Dues <span class="pill ${paidCount === rows.length ? "green" : "grey"}">${paidCount}/${rows.length} paid</span>
      </div>
      ${rows.map(paymentRow).join("")}
    </div>`;
}

function paymentRow(r) {
  const s    = statusOf(r);
  const due  = Number(r.amount_due || 0);
  const paid = Number(r.amount_paid || 0);
  const left = due - paid;

  // The right hand figure says the useful thing for that state rather than
  // three columns of numbers: what is owed, how far in, or just the total.
  const figure = s.key === "paid"    ? money(paid)
               : s.key === "partial" ? `${money(paid)} of ${money(due)}`
               : `${money(due)} due`;

  return `
    <div class="due-row">
      <span class="due-dot ${s.cls}" title="${s.label}" aria-hidden="true"></span>
      <span class="due-who">
        ${esc(r.owner_name)}
        <span class="sr-only"> — ${s.label}</span>
      </span>
      <span class="due-figure ${left > 0 ? "owing" : ""}">${figure}</span>
    </div>`;
}

/** Paid / Partial / Unpaid, worked out from the two amounts. */
function statusOf(r) {
  const due  = Number(r.amount_due  || 0);
  const paid = Number(r.amount_paid || 0);
  if (paid >= due && due > 0) return { key: "paid",    label: "Paid",    cls: "green" };
  if (paid > 0)               return { key: "partial", label: "Partial", cls: "warn" };
  return { key: "unpaid", label: "Unpaid", cls: "red" };
}

// ------------------------------ payouts ------------------------------

function payoutsCard(rows, prizePool) {
  if (!rows.length) {
    return `<div class="card"><div class="card-title">Prize structure</div>${empty("No payouts set.")}</div>`;
  }

  const total = sum(rows, "amount");
  const left  = prizePool - total;

  return `
    <div class="card">
      <div class="card-title">Prize structure</div>
      <div class="tblwrap">
        <table class="tbl">
          <thead><tr><th>Payout</th><th>Winner</th><th class="num">Amount</th></tr></thead>
          <tbody>
            ${rows.map((p) => `
              <tr>
                <td>
                  ${esc(p.title)}
                  ${p.description ? `<div class="muted tiny">${esc(p.description)}</div>` : ""}
                </td>
                <td class="muted">${esc(p.winner || "—")}</td>
                <td class="num">${money(p.amount)}</td>
              </tr>`).join("")}
            <tr>
              <td colspan="2"><strong>Total payouts</strong></td>
              <td class="num"><strong>${money(total)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      ${/* Only the two states that are a problem get a line. "Matches the
            prize pool exactly" is the expected case and needs no comment. */ ""}
      ${prizePool > 0 && left !== 0 ? `<div class="card-meta">
        ${left > 0 ? `${money(left)} unallocated`
                   : `<span class="warntext">${money(-left)} over the prize pool</span>`}
      </div>` : ""}
    </div>`;
}

// --------------------------- competitions ----------------------------

function compsCard(rows) {
  if (!rows.length) {
    return `<div class="card"><div class="card-title">Side competitions</div>${empty("None this season.")}</div>`;
  }

  return `
    <div class="card">
      <div class="card-title">Side competitions</div>
      ${rows.map((c) => {
        const pool = c.prize_pool != null
          ? Number(c.prize_pool)
          : Number(c.buy_in || 0) * Number(c.participants || 0);
        return `
          <div class="subcard">
            <div class="row" style="justify-content:space-between;align-items:baseline">
              <strong>${esc(c.name)}</strong>
              <span class="pill ${c.status === "Finished" ? "grey" : "green"}">${esc(c.status)}</span>
            </div>
            <div class="statgrid" style="margin:8px 0 4px">
              ${stat("Buy-in", money(c.buy_in))}
              ${stat("Players", c.participants)}
              ${stat("Pool", money(pool))}
            </div>
            ${c.winner ? `<div class="card-meta">Winner: <strong>${esc(c.winner)}</strong></div>` : ""}
            ${c.notes ? `<div class="muted tiny">${esc(c.notes)}</div>` : ""}
          </div>`;
      }).join("")}
    </div>`;
}

// ------------------------------ expenses -----------------------------

function expensesCard(rows) {
  if (!rows.length) {
    return `<div class="card"><div class="card-title">Expenses</div>${empty("Nothing spent yet.")}</div>`;
  }

  return `
    <div class="card">
      <div class="card-title">Expenses</div>
      <div class="tblwrap">
        <table class="tbl">
          <thead><tr><th>Item</th><th>Date</th><th class="num">Amount</th></tr></thead>
          <tbody>
            ${rows.map((x) => `
              <tr>
                <td>
                  ${esc(x.description)}
                  ${x.notes ? `<div class="muted tiny">${esc(x.notes)}</div>` : ""}
                </td>
                <td class="muted">${x.expense_date ? esc(fmtDate(x.expense_date)) : "—"}</td>
                <td class="num">${money(x.amount)}</td>
              </tr>`).join("")}
            <tr>
              <td colspan="2"><strong>Total</strong></td>
              <td class="num"><strong>${money(sum(rows, "amount"))}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

// ------------------------------- bits --------------------------------

function stat(label, value, tone = "") {
  return `<div class="stat"><span class="stat-v ${tone}">${esc(value)}</span><span class="stat-l">${esc(label)}</span></div>`;
}

function sum(rows, key) {
  return rows.reduce((t, r) => t + Number(r[key] || 0), 0);
}

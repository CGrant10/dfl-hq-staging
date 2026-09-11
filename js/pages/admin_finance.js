// =====================================================================
// Admin -> Finances
//
// Setup comes first: it stands a whole season up on one screen - buy-in,
// every team, and the payout structure - which is the job people actually
// come here to do. See admin_finance_setup.js.
//
// The rest are per-row editors behind subtabs, for the detail work: who
// has paid what, expenses as they happen, side pots. Each one is just a
// field spec handed to the shared crud manager.
//
// Season is a plain number field defaulting to this year. That is what
// keeps each season's money separate - change it to edit an old year.
// =====================================================================

import { renderManager } from "../crud.js";
import { renderFinanceSetup } from "./admin_finance_setup.js";
import { esc, money } from "../ui.js";

const YEAR = new Date().getFullYear();

const SECTIONS = [
  {
    id: "buyin", tab: "Buy-in",
    table: "finance_seasons", singular: "season", plural: "seasons",
    order: "season", asc: false,
    label: (r) => `${r.season} — ${money(r.buy_in)} per team`,
    sub:   (r) => r.notes || "",
    fields: [
      { name: "season", label: "Season", type: "number", required: true, default: YEAR },
      { name: "buy_in", label: "Buy-in per team ($)", type: "number", required: true, default: 0 },
      { name: "notes",  label: "Notes", type: "textarea" },
    ],
  },
  {
    id: "payments", tab: "Dues",
    table: "finance_payments", singular: "team", plural: "teams",
    order: "owner_name", asc: true,
    label: (r) => `${r.owner_name}${r.team_name ? " — " + r.team_name : ""}`,
    sub:   (r) => `${r.season} · paid ${money(r.amount_paid)} of ${money(r.amount_due)}`,
    fields: [
      { name: "season",      label: "Season", type: "number", required: true, default: YEAR },
      { name: "owner_name",  label: "Team owner", type: "text", required: true, placeholder: "Slaw" },
      { name: "team_name",   label: "Team name",  type: "text", placeholder: "Slaw Squad" },
      { name: "amount_due",  label: "Amount due ($)",  type: "number", default: 0 },
      { name: "amount_paid", label: "Amount paid ($)", type: "number", default: 0 },
      { name: "date_paid",   label: "Date paid", type: "date" },
      { name: "notes",       label: "Notes", type: "textarea", placeholder: "Venmo, paying in two halves…" },
      { name: "sleeper_user_id", label: "Link to Sleeper account (optional)", type: "select",
        optionsFrom: { table: "sleeper_users", value: "sleeper_user_id",
                       label: "display_name", order: "display_name" } },
    ],
  },
  {
    id: "payouts", tab: "Payouts",
    table: "finance_payouts", singular: "payout", plural: "payouts",
    order: "sort_order", asc: true,
    label: (r) => `${r.title} — ${money(r.amount)}`,
    sub:   (r) => `${r.season}${r.winner ? " · " + r.winner : ""}`,
    fields: [
      { name: "season",      label: "Season", type: "number", required: true, default: YEAR },
      { name: "title",       label: "Payout", type: "text", required: true, placeholder: "Champion" },
      { name: "amount",      label: "Amount ($)", type: "number", required: true, default: 0 },
      { name: "description", label: "Description (optional)", type: "text" },
      { name: "winner",      label: "Winner (optional)", type: "text" },
      { name: "sort_order",  label: "Display order", type: "number", default: 1 },
    ],
  },
  {
    id: "expenses", tab: "Expenses",
    table: "finance_expenses", singular: "expense", plural: "expenses",
    order: "expense_date", asc: false,
    label: (r) => `${r.description} — ${money(r.amount)}`,
    sub:   (r) => `${r.season}`,
    fields: [
      { name: "season",       label: "Season", type: "number", required: true, default: YEAR },
      { name: "description",  label: "What was it", type: "text", required: true, placeholder: "Trophy engraving" },
      { name: "amount",       label: "Amount ($)", type: "number", required: true, default: 0 },
      { name: "expense_date", label: "Date", type: "date" },
      { name: "notes",        label: "Notes", type: "textarea" },
    ],
  },
  {
    id: "comps", tab: "Competitions",
    table: "finance_competitions", singular: "competition", plural: "competitions",
    order: "name", asc: true,
    label: (r) => r.name,
    sub:   (r) => `${r.season} · ${r.status}${r.winner ? " · " + r.winner : ""}`,
    fields: [
      { name: "season",       label: "Season", type: "number", required: true, default: YEAR },
      { name: "name",         label: "Competition", type: "text", required: true, placeholder: "March Madness" },
      { name: "buy_in",       label: "Buy-in ($)", type: "number", default: 0 },
      { name: "participants", label: "Number of players", type: "number", default: 0 },
      { name: "prize_pool",   label: "Prize pool ($) — leave blank to calculate", type: "number" },
      { name: "winner",       label: "Winner", type: "text" },
      { name: "status",       label: "Status", type: "select", options: ["Open", "Running", "Finished"] },
      { name: "notes",        label: "Notes", type: "textarea" },
    ],
  },
];

// "setup" is not a table editor, so it is listed here rather than in
// SECTIONS and gets its own render call.
const SETUP = { id: "setup", tab: "Setup" };

let active = "setup";

export function renderFinancePanel(host) {
  host.innerHTML = `
    <div class="tabs subtabs" id="fin-admin-tabs">
      ${[SETUP, ...SECTIONS].map((s) => `
        <button data-fin="${s.id}" class="${s.id === active ? "on" : ""}">${esc(s.tab)}</button>
      `).join("")}
    </div>
    <div id="fin-admin-body"></div>
  `;

  const body = host.querySelector("#fin-admin-body");
  const paint = () => {
    if (active === SETUP.id) return renderFinanceSetup(body);
    return renderManager(body, SECTIONS.find((s) => s.id === active));
  };

  host.querySelector("#fin-admin-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-fin]");
    if (!btn) return;
    active = btn.dataset.fin;
    host.querySelectorAll("#fin-admin-tabs button")
        .forEach((b) => b.classList.toggle("on", b.dataset.fin === active));
    paint();
  });

  paint();
}

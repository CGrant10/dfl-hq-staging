// =====================================================================
// Admin - master fallback + per-member commissioner access
// =====================================================================

import {
  adminLogin, commissionerLogin, adminLogout, isAdmin, isMasterAdmin,
  isCommissionerOwner, hasPermission, changeAdminPassword, configured,
} from "../supabase.js";
import { currentMember } from "../members.js";
import { renderManager } from "../crud.js";
import { renderBroadcastPanel, renderTickerPanel } from "./admin_broadcast.js";
import { renderCommissionerPanel } from "./admin_commissioners.js";
import { specFor } from "../sections.js";
import { renderSleeperPanel } from "./admin_sleeper.js";
import { renderFinancePanel } from "./admin_finance.js";
import { renderKeeperRulesPanel } from "./admin_keepers.js";
import { renderNotificationPanel } from "./admin_notifications.js";
import { esc, toast } from "../ui.js";
import { ensureBroadcastStyles } from "../lazy-css.js";
/* Admin screens are styled by admin.css, which broadcast.css @imports. */
ensureBroadcastStyles();

const TABLES = [
  { id: "members", tab: "Members", table: "members", permission: "members" },
  { id: "rule_categories", tab: "Rule tabs", table: "rule_categories", permission: "rules" },
];

const PANELS = [
  { id: "finances", tab: "Fees", permission: "fees", render: renderFinancePanel },
  { id: "keepers", tab: "Keeper rules", permission: "keepers", render: renderKeeperRulesPanel },
  { id: "sleeper", tab: "Sleeper", permission: "sleeper", render: renderSleeperPanel },
  { id: "broadcast", tab: "Broadcast", permission: "broadcast", render: renderBroadcastPanel },
  { id: "notifications", tab: "Notifications", permission: "broadcast", render: renderNotificationPanel },
  /* The ticker is the same job as the slides, so it answers to the same
     permission. It was a plain table tab - the CRUD list is still the right
     shape for five fields - and is now a panel only so it can carry the same
     Refresh button. renderTickerPanel() wraps renderManager() and adds nothing
     else. */
  { id: "ticker_items", tab: "Ticker", permission: "broadcast", render: renderTickerPanel },
  { id: "commissioners", tab: "Commissioner Access", ownerOnly: true, render: renderCommissionerPanel },
];

let activeSection = "members";

const CAN_MASK = typeof CSS !== "undefined"
  && typeof CSS.supports === "function"
  && CSS.supports("-webkit-text-security", "disc");

function passwordField(id, placeholder, name = "dfl-admin-key", numeric = false) {
  const shared = `id="${id}" required
    ${placeholder ? `placeholder="${esc(placeholder)}"` : ""}
    ${numeric ? `inputmode="numeric" pattern="[0-9]*"` : ""}
    autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
    data-form-type="other" data-lpignore="true" data-1p-ignore data-bwignore
    data-protonpass-ignore="true"`;
  return `<div class="pwwrap">
    ${CAN_MASK
      ? `<input type="text" class="masked" name="${name}" ${shared}>`
      : `<input type="password" name="${name}" ${shared}>`}
    <button type="button" class="pweye" data-eye="${id}" aria-label="Show password">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path class="eye-open" d="M1.8 12S5.4 5.4 12 5.4 22.2 12 22.2 12 18.6 18.6 12 18.6 1.8 12 1.8 12z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        <circle class="eye-open" cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.7"/>
        <path class="eye-slash hidden" d="M3.5 3.5l17 17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      </svg>
    </button>
  </div>`;
}

function wireEyes(root) {
  root.querySelectorAll("button[data-eye]").forEach((btn) => {
    const input = root.querySelector("#" + btn.dataset.eye);
    if (!input) return;
    btn.addEventListener("click", () => {
      const show = CAN_MASK ? input.classList.contains("masked") : input.type === "password";
      if (CAN_MASK) input.classList.toggle("masked", !show);
      else input.type = show ? "text" : "password";
      btn.classList.toggle("on", show);
      btn.querySelector(".eye-slash")?.classList.toggle("hidden", !show);
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      input.focus();
    });
  });
}

function allowed(entry) {
  if (isMasterAdmin()) return true;
  if (entry.ownerOnly) return isCommissionerOwner();
  return hasPermission(entry.permission);
}

export async function render(view) {
  if (!configured) {
    view.innerHTML = `<h1>Admin</h1><div class="card"><div class="card-body">Add your Supabase keys in js/config.js first.</div></div>`;
    return;
  }

  if (!isAdmin()) { renderLogin(view); return; }

  const sections = [...TABLES, ...PANELS].filter(allowed);
  if (!sections.some((s) => s.id === activeSection)) activeSection = sections[0]?.id || "";
  const member = currentMember();
  const sessionLabel = isMasterAdmin()
    ? "Master admin"
    : `${member?.display_name || "Commissioner"}${isCommissionerOwner() ? " · Owner" : ""}`;

  view.innerHTML = `
    <div class="section-head" style="margin-top:0">
      <div><h1 style="margin:0">Admin</h1><div class="muted tiny">${esc(sessionLabel)}</div></div>
      <button class="btn ghost small" id="logout">Sign out</button>
    </div>

    ${sections.length ? `<div class="tabs" id="admin-tabs">
      ${sections.map((s) => `<button data-section="${s.id}" class="${s.id === activeSection ? "on" : ""}">${esc(s.tab)}</button>`).join("")}
    </div><div id="admin-body"></div>`
    : `<div class="card note"><div class="card-body">Your commissioner account is active, but no Admin-screen tools have been assigned. Your permitted inline editing tools are still available on their normal pages.</div></div>`}

    ${isMasterAdmin() ? `<div class="section-head"><h2>Master password</h2></div>
    <form class="card" id="pw-form">
      <label for="new-pw">New master admin password</label>
      ${passwordField("new-pw", "at least 6 characters")}
      <div class="row-end"><button class="btn ghost" type="submit">Change password</button></div>
    </form>` : ""}
  `;

  const body = view.querySelector("#admin-body");
  const paint = () => {
    if (!body) return;
    const panel = PANELS.find((p) => p.id === activeSection && allowed(p));
    if (panel) return panel.render(body);
    const entry = TABLES.find((t) => t.id === activeSection && allowed(t));
    const spec = entry && specFor(entry.table);
    if (!spec) { body.innerHTML = ""; return; }
    return renderManager(body, spec);
  };

  view.querySelector("#admin-tabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-section]");
    if (!btn) return;
    activeSection = btn.dataset.section;
    view.querySelectorAll("#admin-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.section === activeSection));
    paint();
  });

  view.querySelector("#logout").addEventListener("click", () => {
    adminLogout();
    toast("Signed out of commissioner access");
    render(view);
  });

  wireEyes(view);

  view.querySelector("#pw-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = view.querySelector("#new-pw");
    try {
      await changeAdminPassword(input.value);
      input.value = "";
      toast("Master password changed");
    } catch (err) {
      toast(err.message || "Could not change password", true);
    }
  });

  paint();
}

function renderLogin(view) {
  const member = currentMember();
  view.innerHTML = `
    <h1>Admin</h1>
    ${member ? `<form class="card" id="commissioner-login-form">
      <div class="card-title">Commissioner access</div>
      <p class="muted">Signed in as <strong>${esc(member.display_name)}</strong>. Enter your personal commissioner PIN.</p>
      <label for="commissioner-login-pin">Commissioner PIN</label>
      ${passwordField("commissioner-login-pin", "", "dfl-commissioner-pin", true)}
      <div class="row-end"><button class="btn" type="submit">Enter commissioner mode</button></div>
    </form>` : `<div class="card note"><div class="card-body">Pick your league member first to use a personal commissioner PIN.</div></div>`}

    <div class="section-head"><h2>Master access</h2></div>
    <form class="card" id="login-form">
      <p class="muted">Owner fallback. This is the original shared master password.</p>
      <label for="pw">Master admin password</label>
      ${passwordField("pw", "")}
      <div class="row-end"><button class="btn ghost" type="submit">Sign in as master</button></div>
    </form>`;

  wireEyes(view);

  view.querySelector("#commissioner-login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const ok = await commissionerLogin(view.querySelector("#commissioner-login-pin").value);
      if (ok) { toast("Commissioner access unlocked"); render(view); }
      else { toast("Wrong commissioner PIN or access is disabled", true); btn.disabled = false; }
    } catch (err) {
      toast(err.message || "Commissioner sign in failed", true);
      btn.disabled = false;
    }
  });

  view.querySelector("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const ok = await adminLogin(view.querySelector("#pw").value);
      if (ok) { toast("Master admin unlocked"); render(view); }
      else { toast("Wrong master password", true); btn.disabled = false; }
    } catch (err) {
      toast(err.message || "Sign in failed", true);
      btn.disabled = false;
    }
  });
}

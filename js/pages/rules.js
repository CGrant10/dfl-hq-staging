// =====================================================================
// Rules - read only for everyone. An admin sees Edit and Delete on each
// rule and an Add button under the section they are looking at; the tabs
// themselves are still managed at Admin -> Rule tabs.
//
// Categories come from the rule_categories table rather than being
// hardcoded. If that table is missing or empty, the tabs are worked out
// from the rules themselves, so the page never comes up blank.
// =====================================================================

import { db } from "../supabase.js";
import { esc, empty, groupBy, errorBox } from "../ui.js";
import { addControl, editControls, wireInline, canEdit, visible, hiddenClass } from "../inline.js";

// Only used as a fallback and for prettifying unknown keys.
export const DEFAULT_LABELS = {
  scoring: "Scoring", keeper: "Keepers", trade: "Trades",
  waiver: "Waivers", playoff: "Playoffs", general: "General",
};

let activeTab = null;

export async function render(view) {
  const [rulesRes, catsRes] = await Promise.all([
    db().from("rules").select("*").order("sort_order", { ascending: true }),
    db().from("rule_categories").select("*").order("sort_order", { ascending: true }),
  ]);

  if (rulesRes.error) { view.innerHTML = `<h1>Rules</h1>` + errorBox(rulesRes.error); return; }

  const rules = rulesRes.data || [];
  const byCat = groupBy(rules, "category");
  const categories = buildTabs(catsRes.data, byCat);

  if (!categories.length) {
    view.innerHTML = `
      <header class="page-head"><h1>League Rules</h1></header>
      ${empty("No rules yet.")}`;
    return;
  }

  if (!categories.some((c) => c.key === activeTab)) activeTab = categories[0].key;

  view.innerHTML = `
    <header class="page-head">
      <h1>League Rules</h1>
    </header>

    <div id="rules-wrap">
      <div class="tabs" id="rule-tabs">
        ${categories.map((c) => `
          <button data-cat="${esc(c.key)}" class="${c.key === activeTab ? "on" : ""}">
            ${esc(c.label)}
            ${byCat.get(c.key)?.length ? `<span class="tabcount">${byCat.get(c.key).length}</span>` : ""}
          </button>`).join("")}
      </div>

      <div id="rule-body"></div>
    </div>
  `;

  const body = view.querySelector("#rule-body");

  // The Add button carries the tab being viewed, so a new rule lands in the
  // section the admin is already looking at, ordered after what is there.
  const paint = () => {
    const rows = byCat.get(activeTab) || [];
    const nextOrder = rows.reduce((n, r) => Math.max(n, Number(r.sort_order) || 0), 0) + 1;
    body.innerHTML = section(rows) + (canEdit()
      ? `<div class="row-end">${addControl("rules", "Add rule",
           { category: activeTab, sort_order: nextOrder })}</div>`
      : "");
  };

  view.querySelector("#rule-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-cat]");
    if (!btn) return;
    activeTab = btn.dataset.cat;
    view.querySelectorAll("#rule-tabs button")
        .forEach((b) => b.classList.toggle("on", b.dataset.cat === activeTab));
    paint();
  });

  // Bound to the wrapper, which is rebuilt on every render, so paint()
  // replacing #rule-body cannot lose it and revisits cannot stack it.
  wireInline(view.querySelector("#rules-wrap"), () => render(view));

  paint();
}

/**
 * The tab list: the configured categories first, then any category that
 * rules are actually filed under but which has no row. That second part
 * matters - deleting a tab must never make its rules vanish silently.
 */
function buildTabs(configured, byCat) {
  const tabs = (configured || []).map((c) => ({ key: c.key, label: c.label }));
  const known = new Set(tabs.map((t) => t.key));

  for (const key of byCat.keys()) {
    if (!key || known.has(key)) continue;
    tabs.push({ key, label: DEFAULT_LABELS[key] || prettify(key), orphan: true });
  }
  return tabs;
}

function prettify(key) {
  return String(key).replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The whole section as one card, rules separated by hairlines.
 *
 * A card per rule meant a lot of border and padding between two lines of
 * text, so a seven-rule section scrolled for pages. Grouped like this the
 * section reads as one document, which is what it is.
 */
function section(allRows) {
  const rows = visible("rules", allRows);
  if (!rows.length) return empty("Nothing written for this section yet.");
  return `<div class="card rulecard">
    ${rows.map((r) => `
      <article class="rule ${hiddenClass("rules", r)}">
        ${r.title ? `<h3 class="rule-title">${esc(r.title)}</h3>` : ""}
        <div class="rule-text">${esc(r.content)}</div>
        ${editControls("rules", r, { compact: true })}
      </article>`).join("")}
  </div>`;
}

// =====================================================================
// form-layout.js - essentials first, everything else behind one disclosure.
// ---------------------------------------------------------------------
// PURE, and separate from form.js for the same reason activity.js is separate
// from supabase.js: form.js imports fillOptionsFrom(), which reaches the
// database, which pulls its client from a CDN over https - and the ESM test
// loader refuses that. Layout logic that decides what a commissioner sees first
// is worth testing, so it lives where it can be.
//
// It takes a RENDER FUNCTION rather than importing field(), which is what keeps
// it free of that chain.
// =====================================================================

import { esc } from "./ui.js";

/**
 * Lay a field list out as essentials plus a folded "more options".
 *
 * A broadcast slide has SEVENTEEN fields. Every one is worth having and the
 * commissioner wants to keep them all, but meeting all twenty before writing
 * a headline is why making a slide felt like filling in a form rather than
 * writing a slide. Five are up front now; twelve are one tap away.
 *
 * Every field is still emitted, because hiding is layout and dropping would be
 * a feature removal - readForm() reads by name and neither tier changes a
 * field's markup. A spec with nothing marked `advanced` renders exactly as it
 * did before, which is what makes this safe to apply app-wide.
 *
 * @param {Array} fields
 * @param {Function} render  (field) => html
 * @param {Object} [opts]
 */
export function layoutFields(fields, render, { advancedLabel = "More options" } = {}) {
  const list = fields || [];
  const plain = list.filter((f) => !f.advanced);
  const extra = list.filter((f) => f.advanced);
  const body = plain.map((f) => render(f)).join("");
  if (!extra.length) return body;
  return `${body}
    <details class="form-advanced">
      <summary>${esc(advancedLabel)} <span class="muted tiny">${extra.length}</span></summary>
      <div class="form-advanced-body">${extra.map((f) => render(f)).join("")}</div>
    </details>`;
}

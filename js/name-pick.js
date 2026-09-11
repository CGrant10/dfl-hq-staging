// =====================================================================
// name-pick.js - click a name, pick a member, done.
// ---------------------------------------------------------------------
// One control, two callers: the Champions table and the Chip Eaters card. Both
// had the same problem in different words - a name the database got wrong, and
// no way to fix it that did not involve typing an exact display name into a
// prompt() and hoping.
//
// WHAT REPLACED THE PROMPT, AND WHY IT MATTERS. window.prompt asked for the
// display name as free text and matched it case-insensitively; a typo, a
// nickname or a renamed member silently did nothing, and it could not offer the
// list of people it was about to match against. A <select> of the actual
// members cannot be spelled wrong.
//
// It is a plain <select> rather than a custom dropdown on purpose: on a phone
// that opens the OS picker, which is a better list than anything built here,
// and it needs no keyboard handling, no focus trap and no outside-click.
// =====================================================================

import { esc } from "./ui.js";

/**
 * Markup for an editable name.
 *
 * Renders the name as a button when the viewer may change it, and as plain text
 * when they may not - so there is never a control on screen that does nothing.
 *
 * @param {Object} input
 * @param {string} input.text     what to show now ("—" for nobody)
 * @param {string} input.field    which thing this is, e.g. "champion"
 * @param {string|number} input.key  the row this belongs to, e.g. a season
 * @param {boolean} input.canEdit
 */
export function editableName({ text, field, key, canEdit = false } = {}) {
  const shown = text || "—";
  if (!canEdit) return esc(shown);
  return `<button type="button" class="name-pick" data-name-pick="${esc(field)}"
    data-name-key="${esc(key)}" title="Change who this was">${esc(shown)}</button>`;
}

/**
 * Wire every editable name inside `root`.
 *
 * onPick({ field, key, memberId }) does the write and is expected to throw with
 * a usable message; it is awaited, so the select stays disabled until the
 * database has answered rather than pretending to be done.
 *
 * @param {HTMLElement} root
 * @param {Object[]} members  [{ id, display_name }]
 * @param {Function} onPick
 */
export function wireNamePick(root, members, onPick) {
  if (!root) return;

  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-name-pick]");
    if (!button || button.dataset.open === "1") return;

    const field = button.dataset.namePick;
    const key = button.dataset.nameKey;
    const current = button.textContent.trim();

    const select = document.createElement("select");
    select.className = "name-pick-select";
    /*
      "Nobody" is a real choice and it comes first. Clearing an override is how
      you hand the season back to the Sleeper sync, and an override with no way
      out is a trap - see set_season_result(), where null clears the lock.
    */
    select.innerHTML = `<option value="">— nobody —</option>` + (members || [])
      .map((m) => `<option value="${esc(m.id)}"${m.display_name === current ? " selected" : ""}>${esc(m.display_name)}</option>`)
      .join("");

    button.dataset.open = "1";
    button.replaceWith(select);
    select.focus();

    /* The picker is dismissed by choosing, or by leaving it alone. Both restore
       the button, so a mis-tap never strands a select on the page. */
    const restore = () => {
      if (!select.isConnected) return;
      button.dataset.open = "";
      select.replaceWith(button);
    };

    let settled = false;
    select.addEventListener("change", async () => {
      if (settled) return;
      settled = true;
      select.disabled = true;
      try {
        await onPick({ field, key, memberId: select.value ? Number(select.value) : null });
        /* No restore: a successful write re-renders whatever drew this. */
      } catch (err) {
        settled = false;
        select.disabled = false;
        /* The caller reports the failure. Keeping the select open means the
           correction can be retried without hunting for the name again. */
        if (err?.message) select.title = err.message;
      }
    });
    select.addEventListener("blur", () => { if (!settled) restore(); });
  });
}

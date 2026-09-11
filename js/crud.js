// =====================================================================
// crud.js - one reusable "manage a whole table" screen.
//
// Routine content editing now happens inline on the pages themselves (see
// inline.js). This is what remains for the two structural lists that are
// genuinely easier to work with as a table: members and rule tabs. Both
// are about adding people and ordering things, not about writing content.
//
// The field definitions live in sections.js and are shared with the
// inline editor, so a field added there appears in both.
// =====================================================================

import { insertRow, updateRow, deleteRow, selectAll } from "./supabase.js";
import { field, fieldSet, setValue, readForm, fillOptionsFrom } from "./form.js";
import { esc, empty, toast, errorBox, loading } from "./ui.js";

export async function renderManager(host, spec) {
  host.innerHTML = loading();

  let rows;
  try {
    rows = await selectAll(spec.table, { order: spec.order || "created_at", asc: !!spec.asc });
    await fillOptionsFrom(spec.fields);
  } catch (err) {
    host.innerHTML = errorBox(err);
    return;
  }

  let editingId = null;

  /*
    THE FORM IS COLLAPSED UNTIL IT IS WANTED.

    It used to sit open above the list, which was tolerable when a spec had
    four fields and is not now that a broadcast slide has twenty: an admin
    arriving to reorder two slides had to scroll past a full-page form to
    reach the list they came for.

    <details> rather than a button and a class, because the browser gives
    the open/closed state, the keyboard behaviour and the summary role for
    free. The EDIT path opens it - see below - so "Edit" still works, and
    that is the one thing collapsing this could plausibly have broken.
  */
  host.innerHTML = `
    <details class="crud-add" id="crud-box">
      <summary id="crud-heading">Add ${esc(spec.singular)}</summary>
      <form class="card" id="crud-form">
        ${fieldSet(spec.fields, "f_")}
        <div class="row-end">
          <button type="button" class="btn ghost hidden" id="crud-cancel">Cancel</button>
          <button type="submit" class="btn" id="crud-save">Save</button>
        </div>
      </form>
    </details>
    <div id="crud-list">${list(rows, spec)}</div>
  `;

  const form    = host.querySelector("#crud-form");
  const heading = host.querySelector("#crud-heading");
  const cancel  = host.querySelector("#crud-cancel");
  const box     = host.querySelector("#crud-box");

  function resetForm() {
    editingId = null;
    form.reset();
    spec.fields.forEach((f) => {
      if (f.default !== undefined) setValue(form, f, f.default);
    });
    heading.textContent = `Add ${spec.singular}`;
    cancel.classList.add("hidden");
    /* Back to the list after a save or a cancel, which is where the next
       thing an admin wants to do almost always is. */
    if (box) box.open = false;
  }

  resetForm();

  // ---- save (add or update) ----
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = host.querySelector("#crud-save");
    btn.disabled = true;
    try {
      const payload = readForm(form, spec.fields);
      if (editingId) await updateRow(spec.table, editingId, payload);
      else           await insertRow(spec.table, payload);
      toast(editingId ? "Saved" : "Added");
      renderManager(host, spec);
    } catch (err) {
      toast(err.message || "Save failed", true);
      btn.disabled = false;
    }
  });

  cancel.addEventListener("click", resetForm);

  // ---- edit / delete ----
  host.querySelector("#crud-list").addEventListener("click", async (e) => {
    const editBtn = e.target.closest("button[data-edit]");
    const delBtn  = e.target.closest("button[data-del]");

    if (editBtn) {
      const row = rows.find((r) => String(r.id) === editBtn.dataset.edit);
      if (!row) return;
      editingId = row.id;
      spec.fields.forEach((f) => setValue(form, f, row[f.name]));
      heading.textContent = `Edit ${spec.singular}`;
      cancel.classList.remove("hidden");
      /* Editing has to open it, or pressing Edit would silently fill a form
         nobody can see. */
      if (box) box.open = true;
      form.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (delBtn) {
      const row = rows.find((r) => String(r.id) === delBtn.dataset.del);
      if (!row) return;
      if (!confirm(`Delete "${spec.label(row)}"? This cannot be undone.`)) return;
      try {
        await deleteRow(spec.table, row.id);
        toast("Deleted");
        renderManager(host, spec);
      } catch (err) {
        toast(err.message || "Delete failed", true);
      }
    }
  });
}

// ---------------------------------------------------------------- list

function list(rows, spec) {
  if (!rows.length) return empty(`No ${spec.plural} yet.`);
  return rows.map((row) => `
    <div class="card">
      <div class="card-title">${esc(spec.label(row))}</div>
      ${spec.sub ? `<div class="card-meta" style="margin:0">${esc(spec.sub(row))}</div>` : ""}
      <div class="row-end">
        <button class="btn ghost small" data-edit="${row.id}">Edit</button>
        <button class="btn danger small" data-del="${row.id}">Delete</button>
      </div>
    </div>`).join("");
}

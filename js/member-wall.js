// =====================================================================
// member-wall.js - The Wall. Members post, everybody reads.
// ---------------------------------------------------------------------
// A POSTED PICTURE IS FRAMED THE WAY A SLIDE IS. The photo box is a fixed
// shape, so the browser used to centre-crop whatever was handed to it and
// the crop cut faces out of half the phone photos on here. The composer now
// draws the app's image field with the broadcast's crop surface on it: the
// picture is dragged and pinched, and where it sits is saved beside it in
// the four columns member_wall_framing_schema.sql adds.
//
// POSTS FROM BEFORE THAT ARE NOT TOUCHED. image_fit is NULL on them and
// photoHtml() draws those exactly as it always did - natural shape, no
// fixed box. Nothing already on the Wall moves.
// =====================================================================

import { db, isAdmin } from "./supabase.js";
import { currentMember } from "./members.js";
import { esc, toast } from "./ui.js";
import { imageFieldHtml, setImageFraming, setImageValue, wireImageFields } from "./image-field.js";
/* The same arithmetic the broadcast stage draws a slide's artwork with, so a
   framing made on the Wall's crop surface is rendered by the module that
   defined it rather than by a second reading of the same four columns. */
import { artworkStyle } from "./broadcast-artwork.js";
import { icon } from "./icons.js";
import { identityByline, accentOf } from "./profile-identity.js";

/* The crop surface is drawn as a string into the card, and its listeners are
   delegated on the document - so this has to be registered by whoever can draw
   it, exactly as form.js does for the admin forms. Idempotent. */
wireImageFields();

const TABLE_GONE = /member_wall_posts|could not find the table/i;
const COLUMN_GONE = /profile_title|favorite_team|featured_achievement|accent_color|image_fit|image_position|image_zoom/i;
/* The framing columns come off first, because member_wall_framing_schema.sql
   may not have been run yet and the Wall is not allowed to go dark over a
   presentation column. */
const FRAMING_COLUMNS = "image_fit,image_position_x,image_position_y,image_zoom";
const SELECTS = [
  `id,member_id,body,image,${FRAMING_COLUMNS},created_at,members(display_name,profile_image,profile_title,favorite_team,featured_achievement,accent_color)`,
  "id,member_id,body,image,created_at,members(display_name,profile_image,profile_title,favorite_team,featured_achievement,accent_color)",
  "id,member_id,body,image,created_at,members(display_name,profile_image,profile_title,favorite_team,featured_achievement)",
  "id,member_id,body,image,created_at,members(display_name,profile_image)",
];

export async function loadWall(limit = 12) {
  const read = (columns) => db().from("member_wall_posts").select(columns)
    .order("created_at", { ascending: false }).limit(limit);
  let last = null;
  for (const columns of SELECTS) {
    const { data, error } = await read(columns);
    if (!error) return data || [];
    last = error;
    if (!COLUMN_GONE.test(error.message || "")) break;
  }
  if (TABLE_GONE.test(last?.message || "")) return null;
  throw last;
}

export function wallCard(rows) {
  if (rows == null) return "";
  const me = currentMember();
  return `<section class="block wall">
    <h2 class="section-title">The Wall</h2>
    <div class="card wall-card">
      ${me ? composer() : `<p class="muted tiny wall-signin">Pick your name in the top bar to post.</p>`}
      <div class="wall-posts">${rows.length ? rows.map(postHtml).join("") : `<p class="wall-empty muted">Nothing yet. Be the first idiot.</p>`}</div>
    </div>
  </section>`;
}

/*
  The picture is the app's image field with the broadcast's crop surface turned
  on - drag it, pinch it, zoom it - rather than a file input and a preview that
  showed a shape the feed did not use.

  WHY IT IS THE SHARED CONTROL AND NOT A SECOND ONE. The old composer shrank
  the file itself and kept the result in a closure, which is why it could show
  a picture but never say where it sat. imageFieldHtml() puts the value and the
  framing in hidden inputs named for their columns, so submit reads them off
  the form like any other field and the crop tool needs no wiring here.

  WALL_PHOTO_ASPECT IS PASSED IN AND ALSO IN THE STYLESHEET. The crop is only
  honest if the box the user drags in is the box the post is drawn in; the two
  are the same number, named here so a change moves both.
*/
const WALL_PHOTO_ASPECT = "4 / 5";

const WALL_FRAMING = {
  title: "How it sits on the Wall",
  fillLabel: "Fill the frame",
  aspect: WALL_PHOTO_ASPECT,
  hints: {
    cover: "Drag to move it. Pinch, scroll or use the slider to zoom in. Nothing outside the frame is posted.",
    contain: "The whole picture is shown. Drag to place it, and zoom in to crop instead.",
  },
};

function composer() {
  return `<form class="wall-form" data-wall-form>
    <textarea name="body" maxlength="500" rows="2" placeholder="Talk your shit…" data-wall-body></textarea>
    <div class="wall-picture">
      <span class="wall-picture-label">${icon("camera", { size: 15 })}<span>Picture (optional)</span></span>
      ${imageFieldHtml({ id: "wall-image", name: "image", preset: "backdrop", framing: WALL_FRAMING })}
    </div>
    <div class="wall-actions">
      <button class="btn small wall-send" type="submit">Post</button>
    </div>
  </form>`;
}

function stamp(iso, now = Date.now()) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const secs = Math.max(0, Math.round((now - at.getTime()) / 1000));
  if (secs < 60) return "now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days}d`;
  const sameYear = at.getFullYear() === new Date(now).getFullYear();
  return at.toLocaleDateString([], sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
function stampFull(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";

function postHtml(r) {
  const m = r.members || {};
  const me = currentMember();
  const own = !!me && String(me.id) === String(r.member_id);
  /* A commissioner could always delete a post for moderation but not fix one,
     which meant the only moderation move available was the destructive one.
     Editing now matches deleting: the member who posted it, or a commissioner.
     The policy in member_wall_commissioner_edit_schema.sql is the half that
     actually enforces this - the button is only the half you can see. */
  const canEdit = own || isAdmin();
  const canDelete = own || isAdmin();
  const name = m.display_name || "Member";
  const avatar = m.profile_image
    ? `<img class="wall-avatar" src="${esc(m.profile_image)}" alt="" loading="lazy" decoding="async">`
    : `<span class="wall-avatar wall-avatar-fallback" aria-hidden="true">${esc(initials(name))}</span>`;
  const byline = identityByline(m);
  const controls = canEdit || canDelete ? `<div class="wall-manage row-end">
    ${canEdit ? `<button class="btn ghost small" type="button" data-wall-edit="${esc(r.id)}">Edit</button>` : ""}
    ${canDelete ? `<button class="btn ghost small danger" type="button" data-wall-delete="${esc(r.id)}">Delete</button>` : ""}
  </div>` : "";
  /*
    THE PICTURE IS EDITABLE, WHICH IS WHY THE FRAMING IS. Re-framing a post
    meant deleting it and posting it again, and the same was true of a picture
    picked in a hurry. The edit form now carries the same control the composer
    does - replace it, remove it, or just drag the crop.

    WHAT IT WAS SAVED AS RIDES ON THE FORM, not in a second copy of the picture:
    the four framing values are small, and the picture itself is already in the
    DOM as the post's <img>, so openEdit() reads it from there rather than
    printing a second data URI into an attribute.
  */
  const editForm = canEdit ? `<form class="wall-edit hidden" data-wall-edit-form="${esc(r.id)}"
      data-framed="${r.image_fit ? "1" : "0"}"
      data-image-fit="${esc(r.image_fit || "")}"
      data-image-x="${esc(r.image_position_x ?? "")}"
      data-image-y="${esc(r.image_position_y ?? "")}"
      data-image-zoom="${esc(r.image_zoom ?? "")}">
    <textarea maxlength="500" rows="3" data-wall-edit-body>${esc(r.body || "")}</textarea>
    <div class="wall-picture">
      <span class="wall-picture-label">${icon("camera", { size: 15 })}<span>Picture</span></span>
      ${imageFieldHtml({ id: `wall-edit-image-${esc(r.id)}`, name: "image", preset: "backdrop", framing: WALL_FRAMING })}
    </div>
    <div class="row-end">
      <button class="btn ghost small" type="button" data-wall-edit-cancel="${esc(r.id)}">Cancel</button>
      <button class="btn small" type="submit">Save</button>
    </div>
  </form>` : "";

  return `<article class="wall-post" data-wall-post="${esc(r.id)}" data-wall-owner="${esc(r.member_id)}" style="--ident:${esc(accentOf(m))}">
    <div class="wall-head${byline ? " has-byline" : ""}">
      ${avatar}
      <a class="wall-name plainlink" href="#/profile?id=${esc(r.member_id)}">${esc(name)}</a>
      <time class="wall-when muted tiny" datetime="${esc(r.created_at)}" title="${esc(stampFull(r.created_at))}">${esc(stamp(r.created_at))}</time>
      ${byline}
    </div>
    ${r.body ? `<p class="wall-body" data-wall-body-display>${esc(r.body)}</p>` : `<p class="wall-body hidden" data-wall-body-display></p>`}
    ${editForm}
    ${photoHtml(r, name)}
    ${controls ? `<div class="wall-post-actions">${controls}</div>` : ""}
  </article>`;
}

/**
 * A post's picture, framed if whoever posted it framed one.
 *
 * TWO RENDERINGS, ON PURPOSE. image_fit is NULL on every post made before the
 * crop tool existed, and cropping those to the new box would move ten years of
 * pictures nobody asked to move - so an unframed post is drawn exactly as it
 * always was, at its natural shape. A framed one gets the fixed box it was
 * framed in and the style the broadcast stage draws with.
 */
function photoHtml(r, name) {
  if (!r.image) return "";
  const alt = `Posted by ${esc(name)}`;
  const img = (cls, style) =>
    `<img class="${cls}" ${style ? `style="${style}"` : ""} src="${esc(r.image)}" alt="${alt}" loading="lazy" decoding="async">`;
  if (!r.image_fit) return img("wall-photo");
  /* --bx-zoom is spent on a transform right here: the stage hands it to a drift
     animation instead, and the Wall has no animation to hand it to. */
  const style = `${artworkStyle({
    imageFit: r.image_fit, imageX: r.image_position_x, imageY: r.image_position_y, imageZoom: r.image_zoom,
  })};transform:scale(var(--bx-zoom))`;
  return `<div class="wall-photo-frame">${img("wall-photo-framed", esc(style))}</div>`;
}

async function mutatePost(id, action) {
  const q = action(db().from("member_wall_posts")).eq("id", id).select("id");
  const { data, error } = await q;
  if (error) throw error;
  if (!data?.length) throw new Error("That Wall change was refused.");
}

/** Which parts of a post the framing columns are, once a picture exists. */
function framingFrom(fd) {
  const num = (key) => {
    const n = Number(fd.get(key));
    return Number.isFinite(n) ? n : null;
  };
  const fit = String(fd.get("image_fit") || "");
  if (fit !== "cover" && fit !== "contain") return null;
  const x = num("image_position_x"), y = num("image_position_y"), zoom = num("image_zoom");
  if (x === null || y === null || zoom === null) return null;
  return { image_fit: fit, image_position_x: x, image_position_y: y, image_zoom: zoom };
}

/** The framing a post was saved with, all four nulls - it has none any more. */
const NO_FRAMING = { image_fit: null, image_position_x: null, image_position_y: null, image_zoom: null };

/**
 * Fill an edit form's picture control from the post above it.
 *
 * The picture comes off the rendered <img> because it is already in the DOM and
 * a data URI printed twice is a data URI paid for twice. The framing comes off
 * the form's own data attributes. ORDER MATTERS: setImageValue() puts the
 * framing back to untouched, so the saved framing is set after it.
 */
function openEdit(post, form) {
  if (!form || form.dataset.filled === "1") return;
  form.dataset.filled = "1";
  const src = post?.querySelector(".wall-photo, .wall-photo-framed")?.getAttribute("src") || "";
  setImageValue(form, "image", src);
  if (!src || form.dataset.framed !== "1") return;
  setImageFraming(form, "image_fit", form.dataset.imageFit);
  setImageFraming(form, "image_position_x", form.dataset.imageX);
  setImageFraming(form, "image_position_y", form.dataset.imageY);
  setImageFraming(form, "image_zoom", form.dataset.imageZoom);
}

/**
 * What an edit should write to the four framing columns, or null for "leave
 * them alone".
 *
 * A POST NOBODY FRAMED IS NOT FRAMED BY BEING EDITED. The control always has a
 * framing in it - cover, dead centre - so saving a typo fix on a ten-year-old
 * picture would have quietly moved that picture into the cropped box. It only
 * becomes framed if the picture changed, or if somebody actually dragged it.
 */
function editFraming(form, { imageChanged }) {
  const framing = framingFrom(new FormData(form));
  if (!framing) return null;
  const untouched = framing.image_fit === "cover" && framing.image_position_x === 50
    && framing.image_position_y === 50 && framing.image_zoom === 1;
  if (form.dataset.framed !== "1" && !imageChanged && untouched) return null;
  return framing;
}

export function wireWall(root, onChanged) {
  const form = root.querySelector("[data-wall-form]");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const me = currentMember();
    if (!me) return;
    const fd = new FormData(form);
    const body = String(fd.get("body") || "").trim();
    /* The image field's hidden input holds a data URI it shrank on this device,
       or a pasted link. Either way it is just a value on the form now. */
    const image = String(fd.get("image") || "").trim();
    if (!body && !image) { toast("Write something or add a picture", true); return; }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Posting…";
    const post = { member_id: me.id, body, image: image || null };
    const framing = image ? framingFrom(fd) : null;

    /* The framing columns go up when they exist and are dropped when they do
       not: member_wall_framing_schema.sql is a separate step, and a post that
       fails because a presentation column is missing is a post lost over
       nothing. The picture and the words are what matter. */
    let error = (await db().from("member_wall_posts").insert(framing ? { ...post, ...framing } : post)).error;
    if (error && framing && COLUMN_GONE.test(error.message || "")) {
      error = (await db().from("member_wall_posts").insert(post)).error;
    }
    if (error) { btn.disabled = false; btn.textContent = "Post"; toast(error.message, true); return; }
    toast("Posted");
    onChanged?.();
  });

  root.addEventListener("click", async (e) => {
    const edit = e.target.closest("[data-wall-edit]");
    if (edit) {
      const id = edit.dataset.wallEdit;
      const post = root.querySelector(`[data-wall-post="${CSS.escape(id)}"]`);
      const form = post?.querySelector(`[data-wall-edit-form="${CSS.escape(id)}"]`);
      post?.querySelector("[data-wall-body-display]")?.classList.add("hidden");
      form?.classList.remove("hidden");
      /* Filled on open rather than on render: a screen of posts would otherwise
         each hold a second copy of their picture in a hidden control. */
      openEdit(post, form);
      return;
    }
    const cancel = e.target.closest("[data-wall-edit-cancel]");
    if (cancel) {
      const id = cancel.dataset.wallEditCancel;
      const post = root.querySelector(`[data-wall-post="${CSS.escape(id)}"]`);
      post?.querySelector("[data-wall-body-display]")?.classList.remove("hidden");
      post?.querySelector(`[data-wall-edit-form="${CSS.escape(id)}"]`)?.classList.add("hidden");
      return;
    }
    const del = e.target.closest("[data-wall-delete]");
    if (del) {
      if (!confirm("Delete this Wall post?")) return;
      del.disabled = true;
      try {
        await mutatePost(Number(del.dataset.wallDelete), (q) => q.delete());
        toast("Post deleted");
        onChanged?.();
      } catch (err) { del.disabled = false; toast(err.message || "Could not delete post", true); }
      return;
    }
  });

  root.addEventListener("submit", async (e) => {
    const editForm = e.target.closest("[data-wall-edit-form]");
    if (!editForm) return;
    e.preventDefault();
    const id = Number(editForm.dataset.wallEditForm);
    const fd = new FormData(editForm);
    const body = String(editForm.querySelector("[data-wall-edit-body]")?.value || "").trim();
    const image = String(fd.get("image") || "").trim();
    if (!body && !image) { toast("A post needs words or a picture", true); return; }
    const post = editForm.closest("[data-wall-post]");
    const was = post?.querySelector(".wall-photo, .wall-photo-framed")?.getAttribute("src") || "";
    const patch = { body, image: image || null };
    /* Removing the picture takes its framing with it, so a later one cannot
       inherit a crop made for a picture nobody can see any more. */
    const framing = image
      ? editFraming(editForm, { imageChanged: image !== was })
      : (editForm.dataset.framed === "1" ? NO_FRAMING : null);

    const btn = editForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      try {
        await mutatePost(id, (q) => q.update(framing ? { ...patch, ...framing } : patch));
      } catch (err) {
        /* Same bargain the composer makes: member_wall_framing_schema.sql is a
           separate step, and losing an edit over a presentation column that is
           not there yet would be the worse failure. */
        if (!framing || !COLUMN_GONE.test(err?.message || "")) throw err;
        await mutatePost(id, (q) => q.update(patch));
      }
      toast("Post updated");
      onChanged?.();
    } catch (err) { btn.disabled = false; toast(err.message || "Could not update post", true); }
  });
}

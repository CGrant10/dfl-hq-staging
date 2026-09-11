// =====================================================================
// profile-dfl.js - THE top card. One card, everything about the person.
// ---------------------------------------------------------------------
// This used to be four things in a column: a header card with the avatar
// and two pills, a separate "Your DFL page" card with the bio, an Edit
// button that swapped that second card into a form, and the identity
// pickers buried inside the form. Reading who somebody was meant reading
// two cards, and changing your photo meant finding a button in the
// second one that had nothing next to it to say what it applied to.
//
// It is now one card in two states:
//
//   view    avatar, name, the identity pills, the record strip
//           (debut, championships, chip eats) and the bio
//   edit    the same card with the bio and every picker in place -
//           title, featured achievement, club, accent colour
//
// THE PHOTO BUTTON IS ON THE PHOTO. A camera badge pinned to the corner
// of the avatar, in both states, because that is the only place it needs
// no label to be understood. It used to be a "Change" button in a
// different card from the picture it changed.
//
// "THIS IS YOU" IS GONE. It sat next to the member's own name on their
// own profile, which is the one place a person does not need telling.
//
// THE DFL PET IS GONE TOO. Arena racers never read it - they carry their
// own sprite and colour on arena_participants - so removing it changed no
// race. The members.pet column is left alone rather than dropped.
// =====================================================================
import { db } from "../supabase.js";
import { esc, toast } from "../ui.js";
import { shrinkToDataUri } from "../image-field.js";
import { PRESETS, describeValue, fmtBytes, MAX_SOURCE_BYTES } from "../image-shrink.js";
import { identitySettingsCard, profileIdentityDisplay, wireProfileIdentity } from "../profile-identity.js";
import { icon } from "../icons.js";
import { loadLore, career } from "../lore.js";

const BIO_MAX = 500;
const PHOTO_PX = PRESETS.avatar.maxPx;
const PHOTO_MAX_BYTES = MAX_SOURCE_BYTES;

const initials = (name) =>
  String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";

/**
 * The avatar, with its own change button when it is yours.
 *
 * The file input lives here rather than beside the save button so that one
 * click on the badge opens the picker - no intermediate state, no second
 * control appearing somewhere else on the card.
 */
function avatar(m, photo, isMe) {
  const img = photo
    ? `<img class="avatar" src="${esc(photo)}" alt="">`
    : `<div class="avatar avatar-fallback">${esc(initials(m.display_name))}</div>`;
  if (!isMe) return `<div class="ph-avatar">${img}</div>`;
  return `<div class="ph-avatar">
    ${img}
    <button type="button" class="ph-photo-btn" data-photo-pick
            title="${photo ? "Change photo" : "Add a photo"}"
            aria-label="${photo ? "Change photo" : "Add a photo"}">${icon("camera", { size: 14 })}</button>
    <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-photo-file>
  </div>`;
}

/*
  THE RECORD STRIP - facts from the member row, not choices.

  Deliberately separate from the identity pills above it. A title is
  something somebody picked; a debut year and a championship count are
  simply true, and mixing the two made the chosen ones look like records
  and the records look like flair. Empty figures are left out rather than
  shown as zero - "0 championships" is not a fact anybody needs on their
  own profile.

  The chip slot is filled asynchronously by chip-eaters.js, which is why it
  is an empty element rather than a value: whether somebody ate the chip
  takes another two queries, and this card is not waiting for them.
*/
function recordStrip(m) {
  const cells = [];
  const debut = m.joined_year || m.first_season;
  if (debut) cells.push(`<div><b>${esc(debut)}</b><small>Debut</small></div>`);
  if (Number(m.championships) > 0) {
    cells.push(`<div class="is-gold"><b>${icon("trophy", { size: 15 })}${esc(m.championships)}</b>
      <small>Championship${Number(m.championships) === 1 ? "" : "s"}</small></div>`);
  }
  return `<div class="ph-record">${cells.join("")}<div data-chip-slot></div></div>`;
}

function nameBlock(m, ctx) {
  const shown = ctx.currentTeam || m.display_name;
  /* The team name is the heading; the handle only repeats underneath when
     it is actually different, otherwise the card says the same thing twice. */
  const sub = [];
  if (ctx.currentTeam && m.display_name && ctx.currentTeam !== m.display_name) sub.push(esc(m.display_name));
  if (ctx.currentTeam && ctx.currentSeason) sub.push(`${esc(ctx.currentSeason)} team`);
  return `<div class="ph-id">
    <h1 class="profile-name">${esc(shown)}</h1>
    ${sub.length ? `<div class="ph-handle muted">${sub.join(" · ")}</div>` : ""}
  </div>`;
}

function viewCard(m, isMe, ctx) {
  const bio = String(m.bio || "").trim();
  return `<section class="card profile-head accent">
    <div class="ph-top">
      ${avatar(m, m.profile_image, isMe)}
      ${nameBlock(m, ctx)}
      ${isMe ? `<button type="button" class="btn ghost small ph-edit" data-dfl-edit>Edit</button>` : ""}
    </div>
    ${profileIdentityDisplay(m)}
    ${recordStrip(m)}
    ${bio
      ? `<p class="dfl-bio">${esc(bio)}</p>`
      : isMe ? `<p class="muted tiny">No bio yet — say something about yourself.</p>` : ""}
    <div class="row ph-actions">${ctx.actions || ""}</div>
  </section>`;
}

function editCard(m, draft, ctx) {
  const photo = draft.image !== undefined ? draft.image : m.profile_image;
  return `<section class="card profile-head accent is-editing">
    <div class="ph-top">
      ${avatar(m, photo, true)}
      ${nameBlock(m, ctx)}
      <button type="button" class="btn ghost small ph-edit" data-dfl-cancel>Cancel</button>
    </div>

    <p class="muted tiny ph-photo-note">
      ${photo ? `Photo shrunk to ${PHOTO_PX}px. ${esc(describeValue(photo))}.` : `Tap the camera to add a photo.`}
      ${photo ? `<button type="button" class="linkbtn" data-photo-clear>Remove photo</button>` : ""}
    </p>

    <div class="dfl-field">
      <label class="u-label" for="dfl-bio">About me</label>
      <textarea id="dfl-bio" data-bio maxlength="${BIO_MAX}" rows="4"
                placeholder="Bio">${esc(draft.bio)}</textarea>
      <span class="muted tiny"><span data-bio-count>${draft.bio.length}</span>/${BIO_MAX}</span>
    </div>

    <div data-profile-identity-editor></div>

    <div class="row-end"><button type="button" class="btn" data-dfl-save>Save</button></div>
  </section>`;
}

/*
  The earned choices need a career and the chip seasons, which are two more
  queries. They are only read when the editor opens - a reader looking at
  somebody's profile never pays for them.
*/
async function identityData(member) {
  const lore = member.sleeper_user_id ? await loadLore().catch(() => null) : null;
  const c = lore && !lore.error ? career(lore, member.sleeper_user_id) : null;
  let chipSeasons = [];
  if (member.sleeper_user_id) {
    const { data } = await db().from("sleeper_leagues")
      .select("season,last_place_user_id").eq("last_place_user_id", member.sleeper_user_id).order("season");
    chipSeasons = (data || []).map((r) => String(r.season));
  }
  return { career: c, extremes: c, chipSeasons };
}

/**
 * Mount the top card into [data-dfl-host].
 *
 * @param {object} ctx  currentTeam, currentSeason and the action buttons
 *                      profile.js owns (switch member, admin edit controls)
 */
export function wireDflPage(view, member, isMe, refresh, ctx = {}) {
  const host = view.querySelector("[data-dfl-host]");
  if (!host) return;

  let editing = false;
  let draft = null;
  const freshDraft = () => ({ bio: String(member.bio || "").trim(), image: undefined });

  const mountIdentity = async () => {
    const slot = host.querySelector("[data-profile-identity-editor]");
    if (!slot) return;
    try {
      const info = await identityData(member);
      slot.innerHTML = identitySettingsCard(member, info.career, info.extremes, info.chipSeasons);
      wireProfileIdentity(slot, member, refresh);
    } catch {
      slot.innerHTML = "";
    }
  };

  /*
    A REPAINT DROPS THE CHIP BADGE, because chip-eaters.js appended it to
    DOM this function just replaced. Re-running it after every paint puts it
    back; it is idempotent and returns early when the badge is already there.
  */
  const paint = () => {
    host.innerHTML = editing ? editCard(member, draft, ctx) : viewCard(member, isMe, ctx);
    if (editing) void mountIdentity();
    ctx.onRepaint?.();
  };
  paint();

  host.addEventListener("input", (e) => {
    if (!draft) return;
    if (e.target.matches("[data-bio]")) {
      draft.bio = e.target.value;
      const n = host.querySelector("[data-bio-count]");
      if (n) n.textContent = String(draft.bio.length);
    }
  });

  host.addEventListener("change", async (e) => {
    if (!e.target.matches("[data-photo-file]")) return;
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast("Pick an image file", true); return; }
    if (file.size > PHOTO_MAX_BYTES) { toast(`That image is over ${fmtBytes(PHOTO_MAX_BYTES)}`, true); return; }
    /*
      PICKING A PHOTO OPENS THE EDITOR IF IT IS SHUT. The camera badge is on
      the card in both states, so somebody can tap it while just looking at
      their profile - and the chosen picture has to land somewhere it can be
      saved rather than being silently dropped.
    */
    if (!draft) { editing = true; draft = freshDraft(); }
    try {
      draft.image = await shrinkToDataUri(file, "avatar");
      paint();
      toast(`Photo ready (${describeValue(draft.image)}) — press Save`);
    } catch (err) {
      toast(err.message || "Could not read that image", true);
    }
  });

  host.addEventListener("click", async (e) => {
    if (e.target.closest("[data-dfl-edit]")) { editing = true; draft = freshDraft(); paint(); return; }
    if (e.target.closest("[data-dfl-cancel]")) { editing = false; draft = null; paint(); return; }
    /* The camera works in both states, so it is handled before the guard. */
    if (e.target.closest("[data-photo-pick]")) { host.querySelector("[data-photo-file]")?.click(); return; }
    if (!draft) return;
    if (e.target.closest("[data-photo-clear]")) { draft.image = null; paint(); return; }

    const save = e.target.closest("[data-dfl-save]");
    if (!save) return;
    save.disabled = true;
    try {
      /* p_pet is omitted, not sent as null: the RPC coalesces its arguments,
         so leaving it out preserves whatever the column already holds instead
         of this save being the thing that wipes it. */
      const { data, error } = await db().rpc("dfl_update_profile", {
        p_bio: draft.bio,
        p_image: draft.image === undefined || draft.image === null ? null : draft.image,
        p_clear_image: draft.image === null,
      });
      if (error) throw error;
      if (!Number(data)) throw new Error("Pick your name again from the top bar and retry.");
      toast("Profile saved");
      editing = false;
      draft = null;
      await refresh();
    } catch (err) {
      toast(err.message || "Could not save", true);
      save.disabled = false;
    }
  });
}

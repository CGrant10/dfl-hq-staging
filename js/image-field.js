// =====================================================================
// image-field.js - "choose a picture" wherever the app used to say "URL".
// ---------------------------------------------------------------------
// One control, five places: the member's own DFL page, the Members admin
// form (profile / broadcast / look-alike / chaos), a broadcast slide's
// backdrop, and a Wall post's picture. They all ended up asking for a URL, which meant every picture
// in this league lived on somebody else's server and half of them are gone.
//
// WHAT IT IS
//
// A file picker, a preview, and a hidden text input that holds the value the
// form saves. The hidden input is what makes this a drop-in: readForm() and
// setValue() treat it as an ordinary text field, so nothing about how a form
// saves had to change.
//
// A PASTED URL STILL WORKS. Ten years of rows hold http links and they keep
// working: the value is shown, described as external, and left alone unless
// somebody picks a file. Taking that away would have been a migration, and a
// picture that still loads is not a problem to solve.
//
// THE DELEGATED LISTENERS ARE REGISTERED ONCE, on the document, so a form does
// not have to remember to wire anything. crud.js, inline.js and the two
// hand-built panels all draw their markup as strings and hand it to innerHTML;
// anything requiring a per-form wiring call would have been forgotten in one
// of them, which is exactly how the URL field survived this long.
// =====================================================================

import { esc } from "./ui.js";
import {
  MAX_SOURCE_BYTES, PRESETS, QUALITY_LADDER,
  containBox, coverSquare, dataUriBytes, describeValue, fmtBytes,
} from "./image-shrink.js";
/* The allow-lists and the style string are the SAME ones the stage draws with,
   so the control cannot offer a framing the renderer will not honour. That
   module is pure constants with no imports of its own, which is why a generic
   control can borrow from it without dragging the broadcast in. */
import {
  IMAGE_FITS, ZOOM_MIN, ZOOM_MAX,
  artworkStyle, displayedSize, focusPercent, overflowPx, panFocus, zoomAbout, zoomFactor,
} from "./broadcast-artwork.js";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif";

/* =====================================================================
   FRAMING - drag it, pinch it, put it exactly where you want it.
   ---------------------------------------------------------------------
   Opt-in, because not every picture has columns to put a framing in: pass
   framing:true - or an object, to name the columns, the wording and the shape
   of the preview - and the control grows a crop surface. A broadcast slide and
   a Wall post do; an avatar and the look-alike picture render as they did.

   IT IS THE PICTURE THAT MOVES, NOT A SETTING. This was nine buttons over a
   preview, which is nine framings out of all of them, and "his face" is
   almost never one of the nine. So the picture is dragged and pinched
   directly and the numbers are a consequence.

   WHAT IS STORED IS A PERCENTAGE, NOT A PIXEL OFFSET. See broadcast-artwork.js:
   the stage's shape is whatever phone is holding it, and a pixel pan framed on
   one shape would show the edge of the picture on another. object-position is
   defined against the overflow that actually exists, so a framing survives the
   trip to a different screen. The arithmetic for converting a finger-drag into
   that percentage lives there too, where it can be tested.

   THE VALUES STILL LAND IN ORDINARY HIDDEN INPUTS named for their columns, so
   readForm() and setValue() in form.js treat this as four text fields - the
   same trick that made the picture itself a drop-in.
   ===================================================================== */

const FRAME_FALLBACK = { fit: "cover", x: 50, y: 50, zoom: ZOOM_MIN };

/** Which column each part of the framing is saved into. */
function framingNames(framing) {
  if (!framing) return null;
  const f = framing === true ? {} : framing;
  return {
    fit:  f.fit  || "image_fit",
    x:    f.x    || "image_position_x",
    y:    f.y    || "image_position_y",
    zoom: f.zoom || "image_zoom",
  };
}

/**
 * What the surface is called and what shape it is.
 *
 * The broadcast is not the only place with a crop any more - the Wall frames a
 * post's picture with the same control - so the words and the preview's shape
 * are the caller's, not this module's. The hints ride on the element as data
 * attributes because paintFrame() only ever reads the DOM: one direction, and
 * a second surface on the page cannot pick up the first one's wording.
 */
function framingLook(framing) {
  const f = framing === true || !framing ? {} : framing;
  const hints = { ...FRAME_HINTS, ...(f.hints || {}) };
  return {
    title: f.title || "How it sits on the slide",
    fillLabel: f.fillLabel || "Fill the slide",
    hints,
    /* The preview's shape. Left off, it is the 16/9 in the stylesheet - which
       is what the broadcast stage has always used. A caller that renders the
       saved picture in a known shape should pass that shape, so the crop the
       user makes is the crop they get. */
    aspect: f.aspect ? `style="--imgf-aspect:${esc(f.aspect)}"` : "",
  };
}

function framingHtml(names, look) {
  return `
    <div class="imgf-frame" data-imgf-frame hidden
         data-imgf-hint-cover="${esc(look.hints.cover)}"
         data-imgf-hint-contain="${esc(look.hints.contain)}">
      <input type="hidden" name="${esc(names.fit)}"  value="${FRAME_FALLBACK.fit}"  data-imgf-fit>
      <input type="hidden" name="${esc(names.x)}"    value="${FRAME_FALLBACK.x}"    data-imgf-x>
      <input type="hidden" name="${esc(names.y)}"    value="${FRAME_FALLBACK.y}"    data-imgf-y>
      <input type="hidden" name="${esc(names.zoom)}" value="${FRAME_FALLBACK.zoom}" data-imgf-zoom>
      <div class="imgf-frame-top">
        <span class="imgf-frame-title">${esc(look.title)}</span>
        <span class="imgf-fits">
          <button type="button" class="imgf-fit is-on" data-imgf-set-fit="cover">${esc(look.fillLabel)}</button>
          <button type="button" class="imgf-fit" data-imgf-set-fit="contain">Show all of it</button>
        </span>
      </div>
      ${/* tabindex and the key handler are not decoration: this control is a
           drag surface, and a drag surface with no keyboard is a control some
           people simply cannot use. Arrows nudge, +/- zoom, 0 resets. */""}
      <div class="imgf-frame-stage" data-imgf-frame-stage tabindex="0" ${look.aspect}
           role="application" aria-label="Drag the picture to frame it. Arrow keys nudge, plus and minus zoom, 0 resets.">
        <img alt="" decoding="async" draggable="false" data-imgf-frame-img>
        <span class="imgf-frame-grip" aria-hidden="true"></span>
      </div>
      <div class="imgf-frame-tools">
        <label class="imgf-zoom">
          <span class="sr-only">Zoom</span>
          <span aria-hidden="true" class="imgf-zoom-mark">−</span>
          <input type="range" data-imgf-zoom-range
                 min="${ZOOM_MIN}" max="${ZOOM_MAX}" step="0.01" value="${ZOOM_MIN}">
          <span aria-hidden="true" class="imgf-zoom-mark">+</span>
        </label>
        <button type="button" class="btn ghost small" data-imgf-frame-reset>Reset</button>
      </div>
      <div class="muted tiny imgf-frame-hint" data-imgf-frame-hint></div>
    </div>`;
}

/* What the surface is doing changes with the fit, so the line under it does
   too - dragging chooses which part survives a crop when the picture fills the
   slide, and where the picture sits in the empty space when it does not. */
const FRAME_HINTS = {
  cover: "Drag to move it. Pinch, scroll or use the slider to zoom in. Nothing outside the frame is shown.",
  contain: "The whole picture is shown. Drag to place it, and zoom in to crop instead.",
};

/**
 * The control, as markup.
 *
 * @param {Object} o
 * @param {string} o.id     the hidden input's id, so a <label for> still works
 * @param {string} o.name   the column name - this is what the form reads
 * @param {string} o.value  current value: a data URI, an external URL, or ""
 * @param {string} o.preset "avatar" | "backdrop"
 * @param {string} o.attrs  extra attributes for the hidden input. The Broadcast
 *                 panel's override editor gathers its values by data-field
 *                 rather than through a <form>, so it needs its own hooks on
 *                 the element that actually holds the value.
 */
export function imageFieldHtml({ id, name, value = "", preset = "backdrop", attrs = "", framing = null }) {
  const v = String(value || "");
  const p = PRESETS[preset] || PRESETS.backdrop;
  const names = framingNames(framing);
  return `
    <div class="imgf" data-imgf data-preset="${esc(preset)}">
      <input type="hidden" id="${esc(id)}" name="${esc(name)}" value="${esc(v)}" data-imgf-value ${attrs}>
      <div class="imgf-row">
        <span class="imgf-thumb${v ? "" : " is-empty"}" data-imgf-thumb>
          ${v ? `<img src="${esc(v)}" alt="" decoding="async">` : `<span class="imgf-none">No picture</span>`}
        </span>
        <div class="imgf-actions">
          <label class="btn ghost small imgf-pick">
            <input type="file" accept="${ACCEPT}" hidden data-imgf-file>
            ${v ? "Replace" : "Choose"} picture
          </label>
          <button type="button" class="btn ghost small" data-imgf-clear ${v ? "" : "hidden"}>Remove</button>
          <span class="muted tiny" data-imgf-note>${esc(describeValue(v))}</span>
        </div>
      </div>
      ${names ? framingHtml(names, framingLook(framing)) : ""}
      <details class="imgf-url">
        <summary class="muted tiny">Or paste a link</summary>
        <input type="text" placeholder="https://…" value="${esc(v.startsWith("data:") ? "" : v)}" data-imgf-url>
      </details>
      <div class="muted tiny imgf-hint">Shrunk to ${p.maxPx}px${p.square ? " square" : ""} on your device before it is saved. Nothing is uploaded until you save.</div>
    </div>`;
}

/**
 * Shrink a picked file to a data URI inside its preset's budget.
 *
 * TWO PASSES, and the second one is the important one. The quality ladder gets
 * a photograph under budget most of the time; when it does not - a busy image,
 * or a phone panorama - dropping quality further would make it ugly, so the
 * second pass halves the PIXELS instead and walks the ladder again. Fewer,
 * better pixels beats more, worse ones at these sizes.
 *
 * WebP with a JPEG fallback: canvas.toDataURL returns a PNG when it does not
 * know the type asked for, which would silently produce the 5x larger file this
 * whole module exists to avoid - so the result is checked, not trusted.
 */
export async function shrinkToDataUri(file, preset = "backdrop") {
  const p = PRESETS[preset] || PRESETS.backdrop;
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error(`That file is ${fmtBytes(file.size)}. The limit is ${fmtBytes(MAX_SOURCE_BYTES)}.`);
  }
  const bitmap = await createImageBitmap(file);
  try {
    let best = "";
    for (const px of [p.maxPx, Math.round(p.maxPx / 2)]) {
      const uri = encodeAt(bitmap, px, p);
      if (uri && (!best || dataUriBytes(uri) < dataUriBytes(best))) best = uri;
      if (best && dataUriBytes(best) <= p.budget) return best;
    }
    if (!best) throw new Error("That image could not be converted");
    return best;
  } finally { bitmap.close?.(); }
}

/** Draw at `px` and walk the quality ladder, returning the first that fits. */
function encodeAt(bitmap, px, p) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (p.square) {
    const { sx, sy, side } = coverSquare(bitmap.width, bitmap.height);
    canvas.width = canvas.height = Math.min(px, side);
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
  } else {
    const box = containBox(bitmap.width, bitmap.height, px);
    canvas.width = box.w; canvas.height = box.h;
    ctx.drawImage(bitmap, 0, 0, box.w, box.h);
  }
  let smallest = "";
  for (const q of QUALITY_LADDER) {
    /* A browser that cannot write WebP hands back a PNG, and a PNG of a
       photograph is the exact thing being avoided - so take JPEG instead,
       which every canvas can write and which is right for a photo. */
    let uri = canvas.toDataURL("image/webp", q);
    if (!uri.startsWith("data:image/webp")) uri = canvas.toDataURL("image/jpeg", q);
    if (!smallest || dataUriBytes(uri) < dataUriBytes(smallest)) smallest = uri;
    if (dataUriBytes(uri) <= p.budget) return uri;
  }
  return smallest;
}

// --------------------------------------------------------------- the wiring

/** Write a value into one control and redraw its preview. */
function apply(box, value) {
  const v = String(value || "");
  const hidden = box.querySelector("[data-imgf-value]");
  const thumb = box.querySelector("[data-imgf-thumb]");
  const note = box.querySelector("[data-imgf-note]");
  const clear = box.querySelector("[data-imgf-clear]");
  const pick = box.querySelector(".imgf-pick");
  if (hidden) {
    hidden.value = v;
    /* Both editors read values back off the form on submit, but the inline
       dialog also watches for changes to enable its Save button - so this has
       to look like a real edit, not a silent assignment. */
    hidden.dispatchEvent(new Event("input", { bubbles: true }));
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (thumb) {
    thumb.classList.toggle("is-empty", !v);
    thumb.innerHTML = v
      ? `<img src="${esc(v)}" alt="" decoding="async">`
      : `<span class="imgf-none">No picture</span>`;
  }
  if (note) note.textContent = describeValue(v);
  if (clear) clear.hidden = !v;
  if (pick) {
    /* The label holds the file input, so only the trailing text node is the
       caption - replacing innerHTML here would throw the input away. */
    const caption = [...pick.childNodes].reverse().find((n) => n.nodeType === 3);
    if (caption) caption.textContent = ` ${v ? "Replace" : "Choose"} picture`;
  }
  /* A DIFFERENT PICTURE IS NOT THE OLD PICTURE'S CROP. Choosing a second file,
     or removing the picture and picking again, used to keep the framing dragged
     onto the first one - so a new photo arrived pre-cropped to something about
     a photo that is gone. Prefilling a saved row still works: setValue() sets
     the picture first and the framing after, which is the order form.js and the
     Wall's edit form both use. */
  resetFrame(box);
  paintFrame(box);
}

// ------------------------------------------------------------- the framing

/** Put the framing back to untouched. Called whenever the picture changes. */
function resetFrame(box) {
  const frame = box?.querySelector?.("[data-imgf-frame]");
  if (!frame) return;
  const put = (sel, v) => { const el = frame.querySelector(sel); if (el) el.value = v; };
  put("[data-imgf-fit]", FRAME_FALLBACK.fit);
  put("[data-imgf-x]", FRAME_FALLBACK.x);
  put("[data-imgf-y]", FRAME_FALLBACK.y);
  put("[data-imgf-zoom]", FRAME_FALLBACK.zoom);
}

/** Read the four hidden inputs back, through the same rules the stage uses. */
function frameState(frame) {
  const val = (sel) => frame.querySelector(sel)?.value;
  const fit = val("[data-imgf-fit]");
  return {
    fit: IMAGE_FITS.has(fit) ? fit : FRAME_FALLBACK.fit,
    x: focusPercent(val("[data-imgf-x]")),
    y: focusPercent(val("[data-imgf-y]")),
    zoom: zoomFactor(val("[data-imgf-zoom]")),
  };
}

/** The box being framed, and the picture's own dimensions, in pixels. */
function frameGeometry(frame, state) {
  const stage = frame.querySelector("[data-imgf-frame-stage]");
  const img = frame.querySelector("[data-imgf-frame-img]");
  const rect = stage?.getBoundingClientRect();
  if (!rect?.width || !img?.naturalWidth) return null;
  const box = { w: rect.width, h: rect.height };
  const displayed = displayedSize({ w: img.naturalWidth, h: img.naturalHeight }, box, state.fit);
  if (!displayed) return null;
  return { rect, box, displayed, over: overflowPx(displayed, box, state.zoom) };
}

/**
 * Redraw the picture and the tools from the hidden inputs.
 *
 * One direction only: the inputs are the truth and everything visible is
 * derived from them, which is why a drag, a pinch, a prefill from a saved row
 * and a newly chosen picture all end up here rather than each keeping their own
 * idea of where the picture sits.
 */
function paintFrame(box) {
  const frame = box?.querySelector?.("[data-imgf-frame]");
  if (!frame) return;
  const value = box.querySelector("[data-imgf-value]")?.value || "";
  /* Nothing to frame until there is a picture, and an empty crop tool reads as
     a broken one. It appears the moment a picture is chosen. */
  frame.hidden = !value;
  const img = frame.querySelector("[data-imgf-frame-img]");
  if (img && value && img.getAttribute("src") !== value) img.setAttribute("src", value);
  if (!value) return;

  const state = frameState(frame);
  if (img) {
    /* artworkStyle() hands the zoom over as a custom property, because on the
       stage an inline transform would lose to the drift animation. Here there
       is no animation, so the property is spent on a transform immediately -
       and it is the same property, so the two cannot drift apart. */
    img.style.cssText = `${artworkStyle({
      imageFit: state.fit, imageX: state.x, imageY: state.y, imageZoom: state.zoom,
    })};transform:scale(var(--bx-zoom))`;
  }

  frame.querySelectorAll("[data-imgf-set-fit]").forEach((b) => {
    b.classList.toggle("is-on", b.dataset.imgfSetFit === state.fit);
  });
  const range = frame.querySelector("[data-imgf-zoom-range]");
  if (range && Number(range.value) !== state.zoom) range.value = String(state.zoom);
  const hint = frame.querySelector("[data-imgf-frame-hint]");
  /* The wording is the caller's - it rode in on the element - and the module's
     own default is only the fallback. */
  if (hint) hint.textContent = frame.dataset[state.fit === "contain" ? "imgfHintContain" : "imgfHintCover"] || FRAME_HINTS[state.fit] || "";

  /* An axis with nothing to pan cannot be dragged, and a grab cursor over a
     picture that will not move is a lie. Both axes flat means it fits exactly. */
  const geo = frameGeometry(frame, state);
  const movable = !geo || Math.abs(geo.over.x) >= 0.5 || Math.abs(geo.over.y) >= 0.5;
  frame.querySelector("[data-imgf-frame-stage]")?.classList.toggle("is-static", !movable);
}

/**
 * Write part of the framing and redraw.
 *
 * The input/change pair is the same one apply() fires, and for the same reason:
 * the inline dialog enables Save by watching for edits, and a crop the user can
 * see but cannot save would be worse than no crop tool at all.
 */
function setFrame(frame, patch) {
  if (!frame) return;
  const put = (sel, v) => {
    const el = frame.querySelector(sel);
    if (!el || v === undefined || String(el.value) === String(v)) return;
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  put("[data-imgf-fit]", patch.fit);
  put("[data-imgf-x]", patch.x);
  put("[data-imgf-y]", patch.y);
  put("[data-imgf-zoom]", patch.zoom);
  paintFrame(frame.closest("[data-imgf]"));
}

/**
 * Zoom, holding whatever is under `at` still.
 *
 * `at` is a point on the box as a 0-1 fraction of each axis - the cursor under
 * a wheel, the midpoint between two fingers, or dead centre for the slider.
 * Each axis is solved on its own because they crop on their own: a tall picture
 * on a wide stage has nothing to choose horizontally.
 */
function applyZoom(frame, nextZoom, at = { x: 0.5, y: 0.5 }) {
  const state = frameState(frame);
  const zoom = zoomFactor(nextZoom);
  const geo = frameGeometry(frame, state);
  if (!geo) { setFrame(frame, { zoom }); return; }
  setFrame(frame, {
    zoom,
    x: zoomAbout(state.x, at.x, geo.displayed.w, geo.box.w, state.zoom, zoom),
    y: zoomAbout(state.y, at.y, geo.displayed.h, geo.box.h, state.zoom, zoom),
  });
}

/** The zoom as it stands, for the handlers that step away from it. */
const frameStateZoom = (frame) => frameState(frame).zoom;

/** A drag, in pixels of the box, applied to the focal point. */
function applyPan(frame, dx, dy) {
  const state = frameState(frame);
  const geo = frameGeometry(frame, state);
  if (!geo) return;
  setFrame(frame, {
    x: panFocus(state.x, dx, geo.over.x),
    y: panFocus(state.y, dy, geo.over.y),
  });
}

/*
  THE GESTURE, and it is one pointer map rather than three handlers.

  Pointer events mean a finger, a mouse and a pen are the same code. Two
  pointers down is a pinch, and the pinch is measured against the state the
  gesture STARTED in rather than against the previous frame: accumulating
  per-frame ratios drifts, and a picture that lands somewhere slightly
  different every time you pinch it is not a control anybody can aim.
*/
const gestures = new WeakMap();

const points = (g) => [...g.points.values()];

const midpoint = (g) => {
  const list = points(g);
  const n = list.length || 1;
  return {
    x: list.reduce((a, p) => a + p.x, 0) / n,
    y: list.reduce((a, p) => a + p.y, 0) / n,
  };
};

const spread = (g) => {
  const [a, b] = points(g);
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
};

function gestureFor(stage) {
  let g = gestures.get(stage);
  if (!g) { g = { points: new Map(), from: null }; gestures.set(stage, g); }
  return g;
}

/** Snapshot what this gesture is working from, so every frame measures from it. */
function beginGesture(stage) {
  const g = gestureFor(stage);
  const frame = stage.closest("[data-imgf-frame]");
  g.from = { zoom: frameState(frame).zoom, spread: spread(g), at: midpoint(g) };
}

/** Where a client point sits on the box, as a 0-1 fraction of each axis. */
function fractionOf(stage, point) {
  const r = stage.getBoundingClientRect();
  if (!r.width || !r.height) return { x: 0.5, y: 0.5 };
  return {
    x: Math.min(1, Math.max(0, (point.x - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (point.y - r.top) / r.height)),
  };
}

/**
 * Prefill one framing column from a saved row, by column name.
 *
 * Same contract as setImageValue(): form.js knows the column, this module knows
 * what that value does to the picture on screen.
 */
export function setImageFraming(root, name, value) {
  const input = root?.querySelector?.(`[data-imgf-frame] input[name="${CSS.escape(String(name))}"]`);
  if (!input) return;
  /* A row saved before these columns existed holds null, and one saved before
     the crop tool holds a keyword - 'left', 'bottom'. Both are resolved here
     rather than handed on as an empty string against a CHECK constraint. */
  if (input.hasAttribute("data-imgf-fit")) {
    input.value = IMAGE_FITS.has(value) ? value : FRAME_FALLBACK.fit;
  } else if (input.hasAttribute("data-imgf-zoom")) {
    input.value = zoomFactor(value);
  } else if (input.hasAttribute("data-imgf-x")) {
    input.value = focusPercent(value, { left: 0, center: 50, right: 100 });
  } else {
    input.value = focusPercent(value, { top: 0, center: 50, bottom: 100 });
  }
  paintFrame(input.closest("[data-imgf]"));
}

/**
 * Prefill one control from a row, by column name.
 *
 * setValue() in form.js cannot just assign to the hidden input: the preview,
 * the caption and the Remove button all have to follow, and only this module
 * knows about them.
 */
export function setImageValue(root, name, value) {
  const hidden = root?.querySelector?.(`[data-imgf-value][name="${CSS.escape(String(name))}"]`);
  const box = hidden?.closest("[data-imgf]");
  if (box) apply(box, value ?? "");
}

let wired = false;

/**
 * Register the document-level handlers. Idempotent, and called from every
 * module that can draw the control, so no page has to remember to.
 */
export function wireImageFields() {
  if (wired || typeof document === "undefined") return;
  wired = true;

  document.addEventListener("change", async (e) => {
    const input = e.target.closest?.("[data-imgf-file]");
    if (!input) return;
    const box = input.closest("[data-imgf]");
    const file = input.files?.[0];
    input.value = "";                      // so re-picking the same file fires again
    if (!box || !file) return;
    const note = box.querySelector("[data-imgf-note]");
    if (note) note.textContent = "Shrinking…";
    try {
      const uri = await shrinkToDataUri(file, box.dataset.preset || "backdrop");
      apply(box, uri);
    } catch (err) {
      if (note) note.textContent = err.message || "That image could not be read";
    }
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-imgf-clear]");
    if (!btn) return;
    e.preventDefault();
    apply(btn.closest("[data-imgf]"), "");
  });

  /* The two buttons beside the crop surface. Both do the same thing every other
     path does: change a hidden input and let paintFrame() work out the rest. */
  document.addEventListener("click", (e) => {
    const fit = e.target.closest?.("[data-imgf-set-fit]");
    if (fit) {
      e.preventDefault();
      setFrame(fit.closest("[data-imgf-frame]"), { fit: fit.dataset.imgfSetFit });
      return;
    }
    const reset = e.target.closest?.("[data-imgf-frame-reset]");
    if (!reset) return;
    e.preventDefault();
    setFrame(reset.closest("[data-imgf-frame]"), { x: FRAME_FALLBACK.x, y: FRAME_FALLBACK.y, zoom: FRAME_FALLBACK.zoom });
  });

  /* The slider zooms about the middle of the frame, because a slider has no
     pointer over the picture to zoom towards. */
  document.addEventListener("input", (e) => {
    const range = e.target.closest?.("[data-imgf-zoom-range]");
    if (!range) return;
    applyZoom(range.closest("[data-imgf-frame]"), range.value);
  });

  /*
    DRAG AND PINCH.

    setPointerCapture is what makes a drag survive the pointer leaving the
    frame, which it will - the interesting part of a picture is usually being
    dragged towards an edge. touch-action:none in the CSS is the other half:
    without it the browser claims the gesture for scrolling before the second
    pointermove ever arrives.
  */
  document.addEventListener("pointerdown", (e) => {
    const stage = e.target.closest?.("[data-imgf-frame-stage]");
    if (!stage || stage.classList.contains("is-static")) return;
    e.preventDefault();
    const g = gestureFor(stage);
    g.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    /* Capture is an optimisation, not the gesture. It throws NotFoundError for
       a pointer that has already ended, and letting that escape would abandon
       the gesture half-set-up - one finger tracked, nothing anchored. */
    try { stage.setPointerCapture?.(e.pointerId); } catch { /* no capture, still a drag */ }
    stage.classList.add("is-dragging");
    beginGesture(stage);
  });

  document.addEventListener("pointermove", (e) => {
    const stage = e.target.closest?.("[data-imgf-frame-stage]");
    const g = stage && gestures.get(stage);
    if (!g?.points.has(e.pointerId)) return;
    e.preventDefault();
    const frame = stage.closest("[data-imgf-frame]");
    const before = midpoint(g);
    const wasSpread = spread(g);
    g.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const after = midpoint(g);

    /* Two fingers: zoom against the spread this gesture STARTED at, then pan by
       however far the midpoint between them moved. Doing both is what makes a
       pinch feel like moving a photograph rather than operating a zoom
       control - fingers rarely stay put while they spread. */
    if (g.points.size >= 2 && g.from?.spread > 8 && wasSpread > 8) {
      applyZoom(frame, g.from.zoom * (spread(g) / g.from.spread), fractionOf(stage, after));
    }
    applyPan(frame, after.x - before.x, after.y - before.y);
  });

  const endPointer = (e) => {
    const stage = e.target.closest?.("[data-imgf-frame-stage]");
    const g = stage && gestures.get(stage);
    if (!g) return;
    g.points.delete(e.pointerId);
    try { stage.releasePointerCapture?.(e.pointerId); } catch { /* never captured */ }
    if (g.points.size) beginGesture(stage);        // re-anchor on the fingers left
    else stage.classList.remove("is-dragging");
  };
  document.addEventListener("pointerup", endPointer);
  document.addEventListener("pointercancel", endPointer);

  /*
    THE WHEEL, and it is passive:false because it has to be preventable - a
    scroll over the crop surface that zooms AND scrolls the admin page past it
    is the worst of both. Trackpad pinch arrives here as ctrlKey, which is why
    the two are one handler.
  */
  document.addEventListener("wheel", (e) => {
    const stage = e.target.closest?.("[data-imgf-frame-stage]");
    if (!stage || stage.classList.contains("is-static")) return;
    e.preventDefault();
    const frame = stage.closest("[data-imgf-frame]");
    const step = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    applyZoom(frame, frameStateZoom(frame) * step, fractionOf(stage, { x: e.clientX, y: e.clientY }));
  }, { passive: false });

  /*
    THE KEYBOARD. A crop tool reachable only by dragging is one a keyboard user
    cannot operate at all, and the nudge is in pixels of the frame so it means
    the same thing on any picture.
  */
  document.addEventListener("keydown", (e) => {
    const stage = e.target.closest?.("[data-imgf-frame-stage]");
    if (!stage) return;
    const frame = stage.closest("[data-imgf-frame]");
    const step = e.shiftKey ? 24 : 6;
    const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (nudge) { e.preventDefault(); applyPan(frame, nudge[0], nudge[1]); return; }
    if (e.key === "+" || e.key === "=") { e.preventDefault(); applyZoom(frame, frameStateZoom(frame) + 0.1); return; }
    if (e.key === "-" || e.key === "_") { e.preventDefault(); applyZoom(frame, frameStateZoom(frame) - 0.1); return; }
    if (e.key === "0") {
      e.preventDefault();
      setFrame(frame, { x: FRAME_FALLBACK.x, y: FRAME_FALLBACK.y, zoom: FRAME_FALLBACK.zoom });
    }
  });

  /*
    A picture that has not loaded has no natural size, so none of the arithmetic
    above can run - and the picture arrives after the control is drawn every
    time, because it is a data URI being decoded or a link being fetched. This
    is the repaint that gives the surface its geometry.
  */
  document.addEventListener("load", (e) => {
    const img = e.target.closest?.("[data-imgf-frame-img]");
    if (img) paintFrame(img.closest("[data-imgf]"));
  }, true);

  /* The pasted-link path. Applied on input rather than on a button, because a
     link box with its own Apply button is one more thing to forget to press. */
  document.addEventListener("input", (e) => {
    const url = e.target.closest?.("[data-imgf-url]");
    if (!url) return;
    apply(url.closest("[data-imgf]"), url.value.trim());
  });
}

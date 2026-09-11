/* =====================================================================
   broadcast-stage.js - the big screen
   ---------------------------------------------------------------------
   Turns the items broadcast-deck.js ranked into markup, and (from step 4)
   moves between them.

   FIVE TREATMENTS AND NO MORE, because a broadcast package with ten looks
   like a template gallery:

     scoreboard    two sides and their figures. Golf, fantasy, your matchup
     champion      one name, at size, once per season
     stat          one figure and one word
     announcement  a headline, some copy, maybe a picture
     event         a date and how far away it is
     hero          the identity floor

   The scoreboard is NOT reimplemented here. It calls marquee() - the same
   function the live golf match card uses - so a score on the front page and
   a score on the match screen are the same object drawn the same way. If
   they ever diverge it will be because somebody changed marquee(), which is
   the correct blast radius.

   NO DOMAIN LOGIC. This file receives finished items. It does not know what
   a battle is, cannot compute a score, and never asks whether something is
   live - it reads item.temporal and draws the chip. It does not decide what
   is drama and what is a label either: the generators hand over moodText and
   whereText, because only they know which they produced.
   ===================================================================== */

import { esc } from "./ui.js";
import { marquee } from "./marquee.js";
import { artworkStyle } from "./broadcast-artwork.js";

/* The chip that keeps the stage honest. Every item that makes a temporal
   claim shows one, so nothing on this screen is undated by accident. */
const TEMPORAL = {
  live:       { label: "Live",       cls: "is-live" },
  upcoming:   { label: "Upcoming",   cls: "is-upcoming" },
  recent:     { label: "Recent",     cls: "is-recent" },
  final:      { label: "Final",      cls: "is-final" },
  historical: { label: "From the archive", cls: "is-historical" },
  none:       null,
};

function chip(item) {
  const t = TEMPORAL[item.temporal];
  if (!t) return "";
  return `<span class="bx-when ${t.cls}">${esc(t.label)}</span>`;
}

// ------------------------------------------------------------- treatments

function scoreboard(item) {
  /* marquee() owns this shape, and the billing bar carries the kicker - for a
     fantasy item that is "2025 · Week 17", so the year is never dropped.

     NO TEMPORAL CHIP HERE. marquee() already carries LIVE and FINAL in its
     billing bar, and the first cut printed both - "FINAL" twice on one
     slide. The billing bar is the canonical place for a scoreboard's state.

     The generators hand over moodText and whereText rather than the stage
     guessing which of headline/subtitle/body is the drama. "Your matchup" is
     a label and belongs in the billing; "ABSOLUTE BEATDOWN" is drama and
     belongs in the mood slot. Only the generator knows which it produced. */
  return marquee({
    billing: [item.kicker, item.headline].filter(Boolean),
    live: item.temporal === "live",
    final: item.temporal === "final" || item.temporal === "recent",
    sides: (item.sides || []).map((s) => ({
      name: s.name, score: s.score, colour: s.colour || "",
      up: !!s.up, down: !!s.down,
    })),
    mood: item.moodText || "",
    tone: item.temporal === "live" ? "hot" : "done",
    where: item.whereText || item.subtitle || "",
  });
}

function champion(item) {
  /* One layout, two meanings. The Chip Eater borrows the champion's
     composition - big name, centred, kicker above - and passes a variant so
     the CSS can drop the ceremony. See chipEaterItem() in broadcast-deck.js. */
  const v = item.variant ? ` is-${esc(item.variant)}` : "";
  return `
    <div class="bx-champ${v}">
      <span class="bx-kicker">
        <svg class="ico-sm" aria-hidden="true"><use href="#${esc(item.icon || "i-trophy")}"></use></svg>
        ${esc(item.kicker)}
      </span>
      <strong class="bx-name">${esc(item.headline)}</strong>
      ${item.subtitle ? `<span class="bx-sub">${esc(item.subtitle)}</span>` : ""}
      ${chip(item)}
    </div>`;
}

function stat(item) {
  return `
    <div class="bx-stat">
      ${item.kicker ? `<span class="bx-kicker">${esc(item.kicker)}</span>` : ""}
      ${item.figure != null ? `<strong class="bx-figure">${esc(item.figure)}</strong>` : ""}
      <strong class="bx-statword">${esc(item.headline)}</strong>
      ${item.subtitle ? `<span class="bx-sub">${esc(item.subtitle)}</span>` : ""}
      ${chip(item)}
    </div>`;
}

function announcement(item) {
  return `
    <div class="bx-note">
      ${item.kicker ? `<span class="bx-kicker">${esc(item.kicker)}</span>` : ""}
      <strong class="bx-head">${esc(item.headline)}</strong>
      ${item.subtitle ? `<span class="bx-sub">${esc(item.subtitle)}</span>` : ""}
      ${item.body ? `<p class="bx-body">${esc(item.body)}</p>` : ""}
      ${/* NO <img> HERE. There is exactly one image system and it is
            backdrop(): an image is composed as the background of the slide,
            with a scrim, not stacked under the text at natural size. The
            tag that used to be here rendered a 512px-wide crest inside a
            420px stage the moment the old .bx-image rule was dropped. */""}
      ${chip(item)}
    </div>`;
}

function event(item) {
  return `
    <div class="bx-event">
      ${item.kicker ? `<span class="bx-kicker">${esc(item.kicker)}</span>` : ""}
      <strong class="bx-head">${esc(item.headline)}</strong>
      ${item.subtitle ? `<span class="bx-sub">${esc(item.subtitle)}</span>` : ""}
      ${item.body ? `<span class="bx-when-text">${esc(item.body)}</span>` : ""}
      ${chip(item)}
    </div>`;
}

function hero(item) {
  return `
    <div class="bx-hero">
      <span class="bx-kicker">${esc(item.kicker)}</span>
      <strong class="bx-name">${esc(item.headline)}</strong>
      ${item.subtitle ? `<span class="bx-sub">${esc(item.subtitle)}</span>` : ""}
    </div>`;
}

const TREATMENTS = { scoreboard, champion, stat, announcement, event, hero };

/*
  THE PLATE A SLIDE SITS ON.

  Five backgrounds, and which decorations each one gets is decided HERE,
  once, rather than by five nearly-identical CSS blocks. The rule the
  visual language depends on: no slide gets every layer. The weave and the
  vignette are on everything because they are texture; the crest and the
  artwork are exclusive, because two focal images is a collage.
*/
function backdrop(item) {
  const bg = item.background || "default";
  const art = bg === "image" && item.image;
  /* The crest earns its place on a logo slide and on a champion - a title
     belongs to the league - and nowhere else. The Chip Eater keeps the slot and
     swaps the mark: same layer, same opacity, a toilet instead of the crest. */
  const crest = bg === "logo" || item.treatment === "champion";
  return `
    ${art ? `<img class="bx-art${Number(item.imageZoom) > 1 ? " is-framed" : ""}" src="${esc(item.image)}" alt="" draggable="false" decoding="async" style="${artworkStyle(item)}">
             <span class="bx-scrim"></span>` : ""}
    <span class="bx-fx bx-corners" aria-hidden="true">
      <span class="bx-weave"></span>
      ${crest ? `<span class="bx-crest${item.variant === "chip" ? " is-chip" : ""}"></span>` : ""}
      <span class="bx-vignette"></span>
      <span class="bx-sweep"></span>
    </span>`;
}

/*
  A TEAM NAME GETS ONE LINE.

  "KLUTCH SPORTS GROUP" is nineteen characters against a 14ch headline, so it
  wrapped to three lines and read as three separate words stacked up. Wrapping
  is the wrong answer for a name: a name is one thing.

  The type shrinks instead. This cannot be done in CSS - clamp() scales with the
  VIEWPORT, and the thing that overflows here is the string, which CSS cannot
  measure. Two reflows, no loop: one pass computes the exact ratio, a second
  confirms it, because a smaller font-size can change which glyphs are used and
  the ratio is not perfectly linear.

  The floor matters as much as the fit. Below FIT_FLOOR a name has stopped being
  a headline, so wrapping comes BACK rather than being shrunk into a caption -
  a three-word team name on a narrow phone is a real case and unreadably small
  type would be a worse bug than the one being fixed.
*/
/*
  The slide's own headline, and nothing else. The scoreboard's side names are
  deliberately out: they sit in a flex column with no definite width, so there
  is no box to measure them against - see the note on avail below.
*/
const FIT_SELECTOR = ".bx-name, .bx-head";
const FIT_FLOOR = 17;      // px. Below this it is no longer a headline.
const FIT_SAFETY = 0.985;  // a hair under, so a rounding error cannot re-wrap.

/**
 * The font-size that makes `natural` fit `avail`, or null to stop trying.
 *
 * Pure, so the decision is testable without a layout engine: the DOM half
 * below only measures and writes.
 *
 * @param {number} current px, the size it is set at now
 * @param {number} natural px, how wide the text wants to be at that size
 * @param {number} avail   px, how wide it may be
 * @param {number} floor   px, the smallest headline worth having
 * @returns {number|null} a size to apply, or null for "let it wrap"
 */
export function fitSize(current, natural, avail, floor = FIT_FLOOR) {
  if (!(current > 0) || !(natural > 0) || !(avail > 0)) return null;
  if (natural <= avail) return null;               // already fits; nothing to do
  const wanted = current * (avail / natural) * FIT_SAFETY;
  return wanted < floor ? null : wanted;
}

/*
  Set INLINE, not with a class, and that is the whole reason the first attempt
  did not work. .bx-champ .bx-name caps the width at 14ch with two classes of
  specificity, so a one-class .bx-fit rule lost - the name kept wrapping AND
  measured as 14ch wide, which made it look like it already fitted. An inline
  style beats every selector in the file and cannot be out-specified later.
*/
const FIT_ON = { whiteSpace: "nowrap", maxWidth: "none" };
/*
  AND NOT text-wrap. Setting text-wrap:auto here looked like the tidy way to
  cancel the stylesheet's text-wrap:balance, and it silently undid the nowrap
  on the line above: text-wrap is a shorthand over text-wrap-mode, white-space
  is a shorthand over the same longhand, so the second declaration won and the
  element serialised back to `white-space: normal`. balance has nothing to
  balance on a single line, so there was never anything to cancel.
*/

/** Shrink every headline in `slide` until it sits on one line. */
function fitHeadlines(slide) {
  slide.querySelectorAll(FIT_SELECTOR).forEach((el) => {
    const off = () => {
      ["font-size", "white-space", "max-width"].forEach((k) => el.style.removeProperty(k));
    };
    off();
    Object.assign(el.style, FIT_ON);
    /* Two passes. The first gets it close from one measurement; the second
       exists because shrinking can change the width by a pixel or two. */
    for (let pass = 0; pass < 2; pass += 1) {
      /*
        MEASURED AGAINST THE SLIDE, NOT THE PARENT, and this is the subtle part.

        .bx-champ is a content-sized grid. Setting nowrap on its child makes the
        child's max-content width the container's width too, so the container
        grows to fit whatever it was asked to hold - and reading clientWidth off
        it returns the inflated number. The first version did exactly that, and
        so believed a 366px name fitted a 267px box: it was comparing the string
        against itself.

        The slide is position:inset-0 inside a fixed-size stage, so its width is
        definite and cannot be pushed around by its own contents. Its padding is
        the margin the design reserves, which is the whole point of measuring
        here - a name that overflows into the padding is the bug too, not just
        one that wraps.
      */
      const box = el.closest(".bx-slide") || el.parentElement;
      const pad = getComputedStyle(box);
      const avail = box.clientWidth
        - (parseFloat(pad.paddingLeft) || 0)
        - (parseFloat(pad.paddingRight) || 0);
      /* With nowrap and no max-width the element's box IS its content width,
         so this is the real "how wide the string wants to be". */
      const natural = el.getBoundingClientRect().width;
      const current = parseFloat(getComputedStyle(el).fontSize) || 0;
      const next = fitSize(current, natural, avail);
      if (next == null) {
        /* Either it fits, or it never will above the floor. Too wide at this
           point means the floor was hit: hand wrapping back, because two
           readable lines beat one unreadable one. */
        if (natural > avail) off();
        return;
      }
      el.style.fontSize = `${next}px`;
    }
  });
}

/** One item as markup. An unknown treatment degrades to an announcement. */
export function renderItem(item) {
  if (!item) return "";
  const draw = TREATMENTS[item.treatment] || announcement;
  const inner = backdrop(item) + draw(item);
  const cls = `bx-slide is-${esc(item.treatment)} bx-bg-${esc(item.background || "default")} bx-logo-${esc(item.logo || "default")}`;
  /* The whole slide is the link when the item has somewhere to go, so it
     works on a tap, a click, a keyboard and a screen reader without any
     gesture handling. The swipe handler cancels the click when the tap
     turned out to be a drag - see startStage(). */
  return item.href
    ? `<a class="${cls}" href="${esc(item.href)}">${inner}</a>`
    : `<div class="${cls}">${inner}</div>`;
}

/**
 * Draw the stage.
 *
 * Renders deck[0] and the controls. Nothing moves until startStage() is
 * called on the resulting element, so the markup is safe to build on the
 * server-ish path (a template string) and safe to re-render.
 *
 * aria-live="off" IS LOAD-BEARING. #view is aria-live="polite", so without
 * this every slide change would be read aloud, forever, over whatever the
 * user was actually trying to listen to. A rotating billboard is decorative
 * motion, not an announcement. The dots carry the state for anyone
 * navigating by keyboard, and each slide's link text says where it goes.
 */
export function renderStage(deck) {
  const items = deck || [];
  const first = items[0];
  /* The station ident. OUTSIDE the layer on purpose: it belongs to the
     stage rather than to a slide, so it does not re-animate on every
     rotation - a logo that flickers back in every six seconds is the
     thing that makes a broadcast package look cheap. */
  return `
    <section class="bx-stage" data-bx-stage>
      <span class="bx-ident" aria-hidden="true">DFL<i>HQ</i></span>
      <div class="bx-layer" data-bx-layer aria-live="off" aria-atomic="true">${renderItem(first)}</div>
      ${items.length > 1 ? arrows() + controls(items) : ""}
    </section>`;
}

/*
  PREVIOUS AND NEXT. Always present and always focusable, because swipe
  must never be the only way to move - a desktop user with no touchscreen
  and a keyboard user both need a control they can actually reach. CSS
  fades them up on hover where hover exists; on touch they simply stay.
*/
function arrows() {
  return `
    <button type="button" class="bx-arrow bx-prev" data-bx-step="-1" aria-label="Previous slide">
      <svg class="ico-sm" aria-hidden="true"><use href="#i-chev-left"></use></svg>
    </button>
    <button type="button" class="bx-arrow bx-next" data-bx-step="1" aria-label="Next slide">
      <svg class="ico-sm" aria-hidden="true"><use href="#i-chev-right"></use></svg>
    </button>`;
}

function controls(items) {
  /* One pause button and one segment per slide. The segments are real
     buttons, so the whole thing is reachable with a keyboard and needs no
     gestures. */
  const dots = items.map((it, i) => `
    <button type="button" class="bx-dot${i === 0 ? " on" : ""}" data-bx-go="${i}"
      aria-label="Show item ${i + 1} of ${items.length}"${i === 0 ? ' aria-current="true"' : ""}></button>`).join("");
  /* The button's accessible name is the ACTION, and there is deliberately no
     aria-pressed. A toggle that changes both its label and its pressed state
     announces itself as "Play, toggle button, pressed", which is a riddle.
     One or the other: this one names what happens if you press it. */
  return `
    <div class="bx-controls" data-bx-controls>
      <button type="button" class="bx-pause" data-bx-pause aria-label="Pause the broadcast">
        <svg class="ico-sm bx-i-pause" aria-hidden="true"><use href="#i-pause"></use></svg>
        <svg class="ico-sm bx-i-play" aria-hidden="true"><use href="#i-play"></use></svg>
      </button>
      <div class="bx-dots">${dots}</div>
    </div>`;
}

/* =====================================================================
   THE ROTATION ENGINE

   setTimeout, not CSS animation and not requestAnimationFrame.

   tokens.css zeroes animation-duration globally under
   prefers-reduced-motion, so a CSS-driven rotation would fire all its
   iterations instantly for exactly the users who asked for less movement.
   The clock therefore lives in JS, where reduced motion is a decision
   rather than an accident. rAF is wrong too: it is a paint clock, it does
   not run in a background tab, and this needs a wall clock.

   WCAG 2.2.2 (Pause, Stop, Hide) applies: this moves by itself, for more
   than five seconds, and it is not essential. So there is a real pause
   button, and it latches - a user who pauses stays paused.

   On top of that the stage pauses itself whenever attention is clearly
   elsewhere or clearly here:

     tab hidden      nobody is looking, and a phone should not burn battery
     pointer over    you are reading it, or about to tap it
     focus inside    you are on it with a keyboard; moving the target is cruel

   Those are SOFT pauses held in a Set of reasons. They resume on their own.
   The button's pause does not, which is the whole difference between the
   two and why they are not the same flag.
   ===================================================================== */

/* The dwell an item without one gets. Written once rather than twice as a bare
   6000 - the two copies had already drifted from the DWELL table in
   broadcast-deck.js, so a change there did not reach a slide that arrived
   without a dwell. */
export const DWELL_FALLBACK = 3600;

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/*
  THE TWO DECISIONS THE AUTOPLAY BUG LIVED IN, pulled out so they can be tested
  without a browser.

  They were four lines inside startStage()'s closure, which meant the only way to
  check them was to drive a real stage - and a real stage refuses to rotate when
  document.hidden is true, which it is in any headless or backgrounded pane. So
  the bug that killed autoplay for every user was, in practice, unobservable in
  a test. Now it is arithmetic.
*/

/** Selector for the stage's own controls: arrows, dots, pause. */
export const STAGE_CONTROL = "[data-bx-step],[data-bx-go],[data-bx-pause]";

/**
 * Should focus on this element pause the rotation?
 *
 * The pause exists so a keyboard user READING a slide is not yanked to the next
 * one. Focus landing on a NAV CONTROL is the opposite - somebody driving - and
 * treating it as reading is what latched the pause forever: clicking an arrow
 * focuses that arrow, focusout only fires when focus leaves the stage, and the
 * button you just pressed is inside the stage.
 */
export function focusShouldPause(el) {
  if (!el) return false;
  return !el.closest?.(STAGE_CONTROL);
}

/**
 * Is the deck allowed to advance on its own right now?
 *
 * One expression, four inputs, no DOM. `softSize` is the number of soft pauses
 * held - hover, focus, hidden - and any one of them stops the clock.
 */
export function shouldRun({ dead = false, userPaused = false, softSize = 0, count = 0 } = {}) {
  return !dead && !userPaused && softSize === 0 && count > 1;
}

/** Live data goes stale fastest, so a live deck re-checks itself. */
const LIVE_POLL_MS = 15000;

/**
 * Bring a rendered stage to life.
 *
 * @param {Element} root     the [data-bx-stage] element
 * @param {Array}   deck     the deck it was rendered from
 * @param {object}  opts
 * @param {Function} [opts.refresh]  async () => newDeck, called every 15s
 *                                   while a live item is on the deck
 * @returns {{stop: Function, update: Function}} stop() MUST be called when
 *          the page is left, or the timer outlives the DOM it draws into.
 */
export function startStage(root, deck, { refresh } = {}) {
  let items = (deck || []).slice();
  let i = 0;
  let timer = null;
  let poll = null;
  let userPaused = reduced();   // reduced motion starts still, not broken
  const soft = new Set();
  let dead = false;

  const layer = root.querySelector("[data-bx-layer]");
  /* Looked up on demand, never cached: the controls are re-rendered whenever
     the deck length changes, so a captured reference would go stale and the
     button would stop working. Click handling is delegated on root for the
     same reason. */
  const pauseBtn = () => root.querySelector("[data-bx-pause]");
  const running = () => shouldRun({ dead, userPaused, softSize: soft.size, count: items.length });

  function clear() { if (timer) { clearTimeout(timer); timer = null; } }

  function arm() {
    clear();
    if (!running()) return;
    const dwell = items[i]?.dwell || DWELL_FALLBACK;
    timer = setTimeout(() => { go(i + 1); }, dwell);
  }

  function paint() {
    if (!layer) return;
    layer.innerHTML = renderItem(items[i]);
    /* Enter on the next tick so the browser has a frame with the old
       opacity to transition from. Under reduced motion the transition
       duration is 0ms and this is an instant cut, which is the point. */
    const slide = layer.firstElementChild;
    if (slide) {
      /* BEFORE bx-enter, so the measurement happens on a slide that is in the
         document but not yet animating - a mid-animation scale() would make
         getBoundingClientRect() report the wrong width. */
      fitHeadlines(slide);
      slide.classList.add("bx-enter");
      setTimeout(() => {
        slide.classList.remove("bx-enter");
        /* bx-in drives the staggered entrance - kicker, then headline,
           then detail. Added AFTER the element is in the document so the
           animations actually run; added as a class rather than left on
           the markup so a repaint of the same slide replays it. */
        slide.classList.add("bx-in");
      }, 20);
    }
    /* The light plate needs light-plate controls, and the controls are not
       inside the slide, so the stage carries the flag. */
    root.classList.toggle("bx-on-light", (items[i]?.background || "") === "light");
    /* The progress fill is CSS, but only this side knows how long the
       current slide gets - dwell is per treatment and per slide. Handing
       it over as a custom property keeps the animation declarative while
       the clock stays here, which is the same split as everywhere else. */
    const ms = items[i]?.dwell || DWELL_FALLBACK;
    root.querySelectorAll("[data-bx-go]").forEach((d) => {
      const on = Number(d.dataset.bxGo) === i;
      d.classList.toggle("on", on);
      if (on) { d.style.setProperty("--bx-dwell", `${ms}ms`); d.setAttribute("aria-current", "true"); }
      else { d.style.removeProperty("--bx-dwell"); d.removeAttribute("aria-current"); }
    });
  }

  function go(next) {
    if (dead || !items.length) return;
    i = ((next % items.length) + items.length) % items.length;
    paint();
    arm();
  }

  /* Every place that can put a fresh button in the DOM calls this, so the
     glyph and the accessible name can never disagree with the state. The
     first cut set them only in setPaused(), and a rebuild after phase 2 then
     showed a play triangle labelled "Pause the broadcast". */
  function paintButton() {
    const btn = pauseBtn();
    if (!btn) return;
    btn.setAttribute("aria-label", userPaused ? "Play the broadcast" : "Pause the broadcast");
    btn.classList.toggle("is-paused", userPaused);
  }

  /* The progress fill reads this class. It has to reflect BOTH kinds of
     pause: a bar that keeps crawling while the stage is held still under
     the cursor is a progress bar that lies about when the next slide is
     coming. */
  function markStill() {
    root.classList.toggle("is-paused", userPaused || soft.size > 0);
  }

  function setPaused(on) {
    userPaused = on;
    paintButton();
    markStill();
    if (on) clear(); else arm();
  }

  function softPause(reason, on) {
    if (on) soft.add(reason); else soft.delete(reason);
    markStill();
    if (soft.size) clear(); else arm();
  }

  // ------------------------------------------------------------- listeners

  /*
    MANUAL NAVIGATION DOES NOT STOP THE BROADCAST.

    The first cut latched pause whenever you chose a slide, on the theory
    that the thing you asked for should not slide away. In practice that
    meant one arrow press killed the rotation for the rest of the visit
    and the front page went still without ever saying why. Choosing a
    slide now RESETS the dwell - you get the full 5-7 seconds from the
    moment you arrive - and then the deck carries on. The pause button is
    the thing that stops it, and it is still one tap away.
  */
  const step = (delta) => {
    /*
      Driving the deck is the opposite of reading it, so any pause that only
      meant "somebody is looking at this" comes off. The pause BUTTON is
      untouched - that is a decision, not an inference.

      softPause() rather than soft.delete(): the set is only half the state.
      markStill() paints `is-paused` and arm() restarts the clock, and deleting
      from the set behind their backs left the stage advancing while still
      wearing its paused styling. Never touch `soft` directly.
    */
    softPause("focus", false);
    go(i + delta);                                     // go() re-arms
  };

  const onClick = (e) => {
    if (e.target.closest("[data-bx-pause]")) { setPaused(!userPaused); return; }
    const arrow = e.target.closest("[data-bx-step]");
    if (arrow) { step(Number(arrow.dataset.bxStep)); return; }
    const dot = e.target.closest("[data-bx-go]");
    if (!dot) return;
    go(Number(dot.dataset.bxGo));
  };

  /*
    KEYBOARD. Bound to the stage, not the document, so the arrow keys only
    mean "change slide" while focus is actually inside the broadcast -
    hijacking them page-wide would break scrolling with the keyboard.
  */
  const onKey = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowLeft")  { e.preventDefault(); step(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
  };
  const onVis = () => softPause("hidden", document.hidden);
  /* =====================================================================
     THE TWO LATCHES THAT KILLED AUTOPLAY AFTER ONE ARROW PRESS.

     Both soft pauses were correct in intent and unreleasable in practice, and
     between them "use the arrow once and the deck never moves again" was
     guaranteed on every device.

     1. FOCUS. Clicking an arrow FOCUSES that arrow. focusin fired,
        softPause("focus") went on, and focusout only clears it when focus
        leaves the stage entirely - which it never does, because the button you
        just pressed is inside the stage. So the pause latched for the rest of
        the visit.

        The pause exists so a keyboard user reading a slide is not yanked to the
        next one. Focus landing on a NAV CONTROL is not that: it is somebody
        driving, and the comment above step() already says manual navigation
        must not stop the broadcast. So the controls are excluded and focus
        inside the slide content still pauses.

     2. HOVER, on touch. pointerenter fires on a tap, and pointerleave often
        does not fire until the pointer goes somewhere else - so tapping the
        arrow on a phone latched "hover" with nothing to release it. Hover is a
        mouse idea; it is now a mouse-only pause, and a touch tap that did
        somehow set it is released on pointerup.
  ===================================================================== */
  const onEnter = (e) => {
    if (e.pointerType && e.pointerType !== "mouse") return;
    softPause("hover", true);
  };
  const onLeave = () => softPause("hover", false);
  const onFocusIn = (e) => {
    if (!focusShouldPause(e.target)) return;
    softPause("focus", true);
  };
  const onFocusOut = (e) => {
    if (!root.contains(e.relatedTarget)) softPause("focus", false);
  };

  /* =====================================================================
     SWIPE. Pointer events, no library, about thirty lines.

     THE TRAP THIS AVOIDS: the slide is an <a>. A horizontal drag that
     ends on a link fires a click, so without the guard below every swipe
     would also navigate to whatever the slide pointed at. `swiped` is set
     the moment the gesture passes the threshold and is consumed by a
     capture-phase click listener, which is the only place that can stop
     the click before the anchor sees it.

     THE OTHER TRAP: deciding too early. The direction is not judged until
     the finger has moved 12px, because the first few pixels of a vertical
     scroll are frequently a pixel or two sideways. Below that, nothing
     happens and the page scrolls normally - which is the behaviour that
     matters most, since scrolling past the stage is the common gesture
     and changing slides is the rare one.

     CSS does the rest: touch-action:pan-y on the stage means the browser
     keeps vertical scrolling and hands us horizontal movement, so there
     is no preventDefault() on touchmove and no scroll jank.
  ===================================================================== */
  const SWIPE_MIN = 44;        // px of travel before it counts
  const SWIPE_SLOPE = 1.4;     // how much more horizontal than vertical
  let sx = 0, sy = 0, tracking = false, decided = "", swiped = false;

  const onDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest("button")) return;      // a control is not a swipe
    sx = e.clientX; sy = e.clientY;
    tracking = true; decided = ""; swiped = false;
  };
  const onMove = (e) => {
    if (!tracking) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!decided && Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
    if (!decided) decided = Math.abs(dx) > Math.abs(dy) * SWIPE_SLOPE ? "x" : "y";
    if (decided === "y") tracking = false;       // it is a scroll; let go
  };
  const onUp = (e) => {
    if (!tracking) return;
    tracking = false;
    if (decided !== "x") return;
    const dx = e.clientX - sx;
    if (Math.abs(dx) < SWIPE_MIN) return;
    swiped = true;                                // swallow the click
    step(dx < 0 ? 1 : -1);                        // drag left = next
  };
  const onCancel = () => { tracking = false; };
  /* Belt and braces for the touch case: whatever pointerenter did on the way
     in, a lifted finger is not hovering. */
  const onUpAlways = (e) => {
    if (e.pointerType && e.pointerType !== "mouse") softPause("hover", false);
  };
  /* Capture, so it runs before the anchor's own default action. */
  const onClickCapture = (e) => {
    if (!swiped) return;
    swiped = false;
    e.preventDefault();
    e.stopPropagation();
  };

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointerup", onUpAlways);
  root.addEventListener("pointercancel", onCancel);
  root.addEventListener("click", onClickCapture, true);
  root.addEventListener("keydown", onKey);
  /* Long-press on the stage should not raise the iOS selection sheet or a
     desktop context menu. This is an accident guard, not a security one -
     the page is still copyable everywhere it should be. */
  const onMenu = (e) => e.preventDefault();
  root.addEventListener("contextmenu", onMenu);
  const onDragStart = (e) => e.preventDefault();
  root.addEventListener("dragstart", onDragStart);

  root.addEventListener("click", onClick);
  root.addEventListener("pointerenter", onEnter);
  root.addEventListener("pointerleave", onLeave);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  document.addEventListener("visibilitychange", onVis);

  // ----------------------------------------------------------- live refresh

  /**
   * Replace the deck without yanking the screen out from under the reader.
   * The current item is looked up by id in the new deck and kept if it is
   * still there, so a poll that changes nothing changes nothing.
   */
  function update(next) {
    const fresh = (next || []).slice();
    if (!fresh.length) return;
    const currentId = items[i]?.id;
    const same = fresh.length === items.length &&
      fresh.every((it, n) => it.id === items[n]?.id && it.headline === items[n]?.headline &&
        JSON.stringify(it.sides || null) === JSON.stringify(items[n]?.sides || null));
    items = fresh;
    if (same) return;                       // nothing moved; leave the DOM alone
    const found = fresh.findIndex((it) => it.id === currentId);
    i = found >= 0 ? found : 0;
    rebuildDots();
    paint();
    arm();
  }

  function rebuildDots() {
    const wrap = root.querySelector("[data-bx-controls]");
    if (items.length < 2) {
      wrap?.remove();
      root.querySelectorAll("[data-bx-step]").forEach((a) => a.remove());
      clear();
      return;
    }
    /* A one-item deck renders no controls, and phase 2 usually turns it into
       an eight-item one, so this has to be able to create them as well as
       replace them - arrows included, or a deck that grew would rotate with
       no way to step through it. */
    if (wrap) wrap.outerHTML = controls(items);
    else root.insertAdjacentHTML("beforeend", controls(items));
    if (!root.querySelector("[data-bx-step]")) root.insertAdjacentHTML("beforeend", arrows());
    paintButton();
  }

  function armPoll() {
    if (!refresh) return;
    const live = items.some((it) => it.temporal === "live");
    if (!live) { if (poll) { clearInterval(poll); poll = null; } return; }
    if (poll) return;
    poll = setInterval(async () => {
      if (dead || document.hidden) return;  // a hidden tab does not poll
      try { update(await refresh()); } catch (err) { console.warn("broadcast: refresh failed", err); }
      armPoll();
    }, LIVE_POLL_MS);
  }

  paint();
  arm();
  armPoll();
  paintButton();          // reduced motion starts paused; say so on the button

  return {
    update(next) { update(next); armPoll(); },
    stop() {
      dead = true;
      clear();
      if (poll) { clearInterval(poll); poll = null; }
      root.removeEventListener("click", onClick);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onCancel);
      root.removeEventListener("click", onClickCapture, true);
      root.removeEventListener("keydown", onKey);
      root.removeEventListener("contextmenu", onMenu);
      root.removeEventListener("dragstart", onDragStart);
      root.removeEventListener("pointerup", onUpAlways);
      root.removeEventListener("pointerenter", onEnter);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("visibilitychange", onVis);
    },
  };
}

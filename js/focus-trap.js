// =====================================================================
// focus-trap.js - keyboard focus stays inside the thing that is open
// ---------------------------------------------------------------------
// WHAT WAS WRONG
//
// The app has two modal surfaces and both already behaved well by mouse and
// by thumb: More and the member picker each carry role="dialog" and
// aria-modal="true", Escape closes them where that is allowed, the backdrop
// closes them, and a link inside closes them on the way out.
//
// None of that helps a keyboard. Opening More left focus on the More button
// BEHIND the sheet, so the first Tab went into the page underneath - a page
// the sheet covers and aria-modal has already told a screen reader to ignore.
// Tabbing far enough put focus on links nobody could see. Closing put focus
// back at the top of the document, so getting anywhere meant Tabbing in from
// the start again.
//
// WHAT THIS IS
//
// One function, no framework, about forty lines of behaviour:
//
//   remember   who was focused before, so it can be given back
//   move in    to a named control, or the first thing focusable
//   contain    Tab and Shift+Tab cycle within the surface, and focus that
//              escapes some other way is pulled back
//   give back  to the opener, if it is still on the page and still visible
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not close anything, and it does not decide whether closing is
// allowed. The picker's first-run rule - you cannot dismiss it until you have
// said who you are - lives in app.js and stays there. A trap that closed on
// Escape would have quietly created the escape path that rule exists to
// prevent. This only ever moves focus.
// =====================================================================

/*
  Focusable, in DOM order, and only things a person can actually reach.

  `offsetParent === null` catches the case this file exists for: the member
  picker and the golf-join card are SIBLINGS, and the hidden one keeps its
  buttons in the DOM. Without the visibility test, trapping the join card
  would happily Tab into the picker's member list behind it.
*/
const CANDIDATES = [
  "a[href]", "button:not([disabled])", "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])", "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusable(root) {
  return [...root.querySelectorAll(CANDIDATES)].filter((el) =>
    !el.hasAttribute("hidden") &&
    !el.closest("[hidden]") &&
    !el.closest(".hidden") &&
    el.offsetParent !== null);
}

/**
 * Hold keyboard focus inside `container` until the returned function is called.
 *
 * @param {HTMLElement} container
 * @param {Object}  [opts]
 * @param {HTMLElement|string|(()=>HTMLElement|null)} [opts.initial]  where focus
 *        should land. A selector or a function is resolved inside the
 *        container, retried for a few frames while the surface is still
 *        filling itself in. Falls back to the first focusable thing, then to
 *        the container itself.
 * @param {HTMLElement|null}  [opts.returnTo]  who gets focus back. Defaults to
 *        whatever was focused when this was called.
 * @returns {() => void} release
 */
export function trapFocus(container, { initial = null, returnTo = undefined } = {}) {
  if (!container) return () => {};

  const previous = returnTo === undefined
    ? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    : returnTo;

  /*
    THE LANDING POINT IS RESOLVED LATE, and it has to be.

    Both surfaces this file serves fill themselves in AFTER they are opened:
    the member picker paints "Loading members…" and then replaces it with the
    list, and the golf-join card is mounted by golf-join.js which builds its
    form asynchronously. A target computed at call time was therefore either
    the wrong control or no control at all - measured, the picker landed on
    "Here for golf?" (the only button in the card while it loaded) and the
    join card landed on document.body, because the node it had focused was
    replaced a moment later by the form.

    So `initial` may be a function, and the search runs for a few frames
    until there is something real to focus. It gives up quietly rather than
    holding a timer open, and it stops the moment focus is already inside -
    somebody who has started Tabbing must not be yanked back to the top.
  */
  const resolveInitial = () => {
    if (typeof initial === "function") return initial() || null;
    if (typeof initial === "string") return container.querySelector(initial);
    return initial;
  };

  let borrowedTabIndex = false;
  const borrowTabIndex = () => {
    if (borrowedTabIndex || container.hasAttribute("tabindex")) return;
    container.setAttribute("tabindex", "-1");
    borrowedTabIndex = true;
  };

  /* ~20 frames is a third of a second: long enough for a members read off a
     warm cache or a form built in a microtask, short enough that a surface
     which never populates does not sit here spinning. */
  let framesLeft = 20;
  let landing = 0;
  const land = () => {
    if (!container.isConnected) return;
    if (container.contains(document.activeElement)) return;   // already inside
    const target = resolveInitial() || focusable(container)[0];
    if (target) {
      try { target.focus({ preventScroll: false }); } catch { /* not focusable */ }
      return;
    }
    if (framesLeft-- > 0) { landing = requestAnimationFrame(land); return; }
    /* Nothing focusable at all. Park focus on the surface itself so a
       keyboard is inside the modal rather than loose on the page behind it. */
    borrowTabIndex();
    try { container.focus({ preventScroll: false }); } catch { /* nothing to do */ }
  };
  landing = requestAnimationFrame(land);

  const onKeyDown = (event) => {
    if (event.key !== "Tab") return;
    const items = focusable(container);
    if (!items.length) { event.preventDefault(); return; }
    const firstItem = items[0];
    const lastItem = items[items.length - 1];
    const active = document.activeElement;

    /* Focus already outside - a click on the backdrop, or the page beneath -
       so the next Tab comes back in rather than continuing through the page. */
    if (!container.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? lastItem : firstItem).focus();
      return;
    }
    if (event.shiftKey && active === firstItem) {
      event.preventDefault();
      lastItem.focus();
    } else if (!event.shiftKey && active === lastItem) {
      event.preventDefault();
      firstItem.focus();
    }
  };

  /* Capture, so a handler inside the sheet cannot swallow Tab before this
     sees it. */
  document.addEventListener("keydown", onKeyDown, true);

  let released = false;
  return function release() {
    if (released) return;
    released = true;
    document.removeEventListener("keydown", onKeyDown, true);
    cancelAnimationFrame(landing);
    if (borrowedTabIndex) container.removeAttribute("tabindex");
    /*
      Give focus back, but only if there is somewhere sensible to give it to.
      A member picker dismissed by choosing a name has usually caused a
      re-render, so the opener may be gone - in which case leaving focus where
      the browser put it beats throwing it at a detached node.
    */
    if (previous && previous.isConnected && previous.offsetParent !== null) {
      try { previous.focus({ preventScroll: true }); } catch { /* nothing to do */ }
    }
  };
}

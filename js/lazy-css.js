/*
  STYLESHEETS THAT ONLY SOME ROUTES NEED.

  index.html linked ten stylesheets, which meant every member downloaded all of
  them to look at the home screen. css/broadcast.css was the worst of it: four
  kilobytes that @import two more files - broadcast-base.css at 56KB and
  admin.css at 8KB - for an OBS view and a commissioner screen. Two thirds of
  the league never opens either.

  The pattern already existed in the codebase (arena-beta.js injects its own
  render sheet, member-theme-scope.js injects profile-neutral.css); this is the
  same idea with the one detail those two do not have to care about.

  THE DETAIL IS CASCADE ORDER. broadcast.css sat third of ten in index.html, so
  six sheets after it could override it on equal specificity. Appending the link
  to <head> would move it last and quietly hand those ties to broadcast instead
  - a whole class of visual bug that would show up on unrelated screens. So the
  link goes back exactly where it was: immediately before the sheet that used to
  follow it.
*/

const ORDER_ANCHOR = 'link[rel="stylesheet"][href*="css/golf.css"]';
const pending = new Map();

/**
 * Load a stylesheet once, in its original cascade position.
 * Resolves when it has applied, so a caller can paint without a flash.
 */
export function ensureStylesheet(href, { anchor = ORDER_ANCHOR } = {}) {
  if (pending.has(href)) return pending.get(href);

  const existing = document.querySelector(`link[rel="stylesheet"][href="${href}"]`);
  if (existing) {
    const settled = Promise.resolve();
    pending.set(href, settled);
    return settled;
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;

  const ready = new Promise(resolve => {
    /* Resolve either way. A stylesheet that 404s must not stop a page from
       rendering - unstyled beats blank. */
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
  });

  const marker = anchor ? document.querySelector(anchor) : null;
  if (marker && marker.parentNode) marker.parentNode.insertBefore(link, marker);
  else document.head.appendChild(link);

  pending.set(href, ready);
  return ready;
}

/**
 * The broadcast/admin bundle: broadcast.css plus the two files it @imports.
 * Needed by the OBS broadcast view, the Arena page (it draws .bc-* furniture)
 * and the Admin screens.
 */
export const ensureBroadcastStyles = () => ensureStylesheet("css/broadcast.css");

/* =====================================================================
   golf-theme.js - Golf content follows the active app theme
   ===================================================================== */

import { activeMode, pinMode } from "./theme.js";

const GOLF_CONTENT_CLASS = "golf-content";
const FAIRWAY_ROW = "[data-golf-fairway-row]";
let tryingFairway = false;

const onGolf = () => (location.hash || "#/home").split("?")[0] === "#/golf";

/* Mark the route without changing palette variables. Golf inherits the same
   light, dark, Medicine Wheel, or team theme as the rest of the app. */
export function syncGolfContentTheme() {
  document.body?.classList.toggle(GOLF_CONTENT_CLASS, onGolf());
}

/*
  Tournament controls predate commissioner roles and still call their access
  badge "Admin only". That is no longer true: an authenticated commissioner
  with Golf permission can use them, and Commissioner Owners inherit every
  commissioner permission. Keep the existing class/style, but make the words
  match the actual authorization model. Restrict this to Golf and to the exact
  legacy label so LIVE/Complete/etc badges are never touched.
*/
function paintAccessLabels() {
  if (!onGolf()) return;
  for (const badge of document.querySelectorAll("#golf-outing .admin-badge")) {
    if (badge.textContent?.trim() === "Admin only") {
      badge.textContent = "Commissioner";
      badge.title = "Commissioner access";
      badge.setAttribute("aria-label", "Commissioner access");
    }
  }
}

/*
  A quiet, event-only Fairway preview. The theme pin deliberately stays out
  of localStorage: this is an invitation to try the palette, not a surprise
  change to the member's saved Appearance setting.
*/
function eventThemeAnchor() {
  return document.querySelector(".tb-shell[data-tbeta-root] > .tb-sub")
    || document.querySelector(".gqm-focus-shell[data-gqm-root] > .gqm-focus-sub")
    || document.querySelector(".golf-event-head");
}

function clearFairwayPreview() {
  document.querySelectorAll(FAIRWAY_ROW).forEach(row => row.remove());
  if (!tryingFairway) return;
  tryingFairway = false;
  pinMode();
}

function paintFairwayToggle() {
  if (!onGolf()) {
    clearFairwayPreview();
    return;
  }

  const anchor = eventThemeAnchor();
  if (!anchor) {
    document.querySelectorAll(FAIRWAY_ROW).forEach(row => row.remove());
    return;
  }

  let row = document.querySelector(FAIRWAY_ROW);
  if (row && row.previousElementSibling !== anchor) {
    row.remove();
    row = null;
  }
  if (!row) {
    row = document.createElement("div");
    row.className = "golf-fairway-row";
    row.dataset.golfFairwayRow = "";
    row.innerHTML = '<button type="button" class="golf-fairway-try" data-golf-fairway-try></button>';
    anchor.insertAdjacentElement("afterend", row);
    row.querySelector("[data-golf-fairway-try]")?.addEventListener("click", () => {
      tryingFairway = !tryingFairway;
      pinMode(tryingFairway ? "fairway" : undefined);
      paintFairwayToggle();
    });
  }

  const button = row.querySelector("[data-golf-fairway-try]");
  if (!button) return;
  const savedFairwayIsActive = !tryingFairway && activeMode() === "fairway";
  const label = tryingFairway
    ? "Use previous theme"
    : savedFairwayIsActive ? "Fairway theme active" : "Try Fairway theme";
  if (button.textContent !== label) button.textContent = label;
  button.disabled = savedFairwayIsActive;
  button.setAttribute("aria-pressed", String(tryingFairway || savedFairwayIsActive));
  button.title = tryingFairway
    ? "Restore your saved app theme"
    : savedFairwayIsActive ? "Fairway Light is your saved theme" : "Preview Fairway Light for this Golf visit";
}

function sync() {
  syncGolfContentTheme();
  paintAccessLabels();
  paintFairwayToggle();
}

window.addEventListener("hashchange", sync);
sync();

new MutationObserver(() => {
  paintAccessLabels();
  paintFairwayToggle();
}).observe(document.body, {
  childList: true,
  subtree: true,
});

// =====================================================================
// install.js - "Add to Home Screen" help
// ---------------------------------------------------------------------
// Two completely different worlds:
//
//   Android / Chrome / Edge
//     The browser fires `beforeinstallprompt`. We catch it, stop the
//     default mini-bar, and show our own Install button that calls
//     prompt() when tapped.
//
//   iPhone / iPad Safari
//     Apple has no install API at all. The only way in is Share ->
//     Add to Home Screen, so all we can do is show the instruction.
//
// Either way the banner disappears for good once the app is installed,
// or once the user dismisses it.
// =====================================================================

// Only a MANUAL dismissal is remembered, and only for a while.
//
// This used to be a permanent flag that was also set when the app was
// installed. Uninstalling does not clear localStorage, so anyone who
// installed once and later removed the app could never get the button
// back. Installing is now tracked by isInstalled() alone.
const SNOOZED_UNTIL = "dfl.installSnoozedUntil";
const SNOOZE_DAYS = 14;

/** True when the app is already running from the home screen. */
export function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches ||
         window.matchMedia("(display-mode: minimal-ui)").matches ||
         window.navigator.standalone === true;   // older iOS
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
         // iPadOS 13+ reports itself as a Mac, but it has a touch screen
         (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isSafari() {
  return /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);
}

/** True while a manual "not now" is still in effect. */
function snoozed() {
  const until = Number(localStorage.getItem(SNOOZED_UNTIL) || 0);
  return Date.now() < until;
}

// Chrome hands us the install prompt once. Keep it so a manual
// "Install app" tap can use it later, not just the banner.
let deferred = null;

/** Can we trigger Chrome's install dialog right now? */
export function canPrompt() {
  return !!deferred;
}

/**
 * Fire the browser's install dialog.
 * @returns {Promise<"accepted"|"dismissed"|"unavailable">}
 */
export async function promptInstall() {
  if (!deferred) return "unavailable";
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  return outcome;
}

export function setupInstall() {
  const bar = document.getElementById("install");
  if (!bar) return;

  const show = (html) => {
    bar.innerHTML = html;
    bar.classList.remove("hidden");
  };

  const hide = (remember) => {
    bar.classList.add("hidden");
    if (remember) {
      localStorage.setItem(SNOOZED_UNTIL, String(Date.now() + SNOOZE_DAYS * 864e5));
    }
  };

  // ---- Android / Chrome / Edge -------------------------------------
  // This fires whenever the app is installable, which also means it is
  // NOT currently installed. So it is the right moment to offer the
  // button again, even to someone who installed and later removed it.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();                 // suppress the browser's own bar
    deferred = e;
    if (isInstalled() || snoozed()) return;
    show(`
      <span class="install-text">Install DFL HQ for full screen and faster loading.</span>
      <button class="btn small" id="install-go">Install</button>
      <button class="install-x" id="install-no" aria-label="Not now">&times;</button>
    `);
  });

  // ---- iPhone / iPad Safari ----------------------------------------
  if (isIos() && isSafari() && !isInstalled() && !snoozed()) {
    show(`
      <span class="install-text">
        Add to your home screen: tap <strong>Share</strong>, then
        <strong>Add to Home Screen</strong>.
      </span>
      <button class="install-x" id="install-no" aria-label="Not now">&times;</button>
    `);
  }

  bar.addEventListener("click", async (e) => {
    if (e.target.closest("#install-no")) { hide(true); return; }
    if (e.target.closest("#install-go")) { hide(false); await promptInstall(); }
  });

  // Installed while the page was open: just hide it. Nothing is stored,
  // so removing the app later brings the offer straight back.
  window.addEventListener("appinstalled", () => hide(false));
}

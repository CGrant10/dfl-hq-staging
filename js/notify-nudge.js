// =====================================================================
// notify-nudge.js - the one-time "notifications exist now" prompt
// ---------------------------------------------------------------------
// Push alerts shipped after most of the league had already been using the
// app for months, and nothing in the interface announces a feature that
// lives behind the bell. So the league gets told once, on their next
// visit, with the switch right there in the dialog.
//
// ASKED ONCE, THEN NEVER AGAIN. Both buttons record the answer, and so
// does finding notifications already on. A nudge that reappears is an
// advert, and this one has a real cost: tapping through it fires the
// browser's own permission prompt, and a permission a member has denied
// once is expensive to get back - Android and iOS both bury the reset.
//
// It deliberately waits for the profile picker to close. Stacking a
// second modal on the "Who are you?" overlay would put a dialog nobody
// asked for in front of the one thing they have to answer.
// =====================================================================

import { currentMember } from "./members.js";
import { toast } from "./ui.js";
import { currentPushSubscription, enablePush, pushCapability } from "./notifications.js";

const ASKED = "dfl.notifyNudgeAnswered";

const answered = () => {
  try { return localStorage.getItem(ASKED) === "1"; } catch { return false; }
};
const remember = () => {
  try { localStorage.setItem(ASKED, "1"); } catch { /* private mode: ask again next time */ }
};

/* Resolves once the "Who are you?" overlay is out of the way. */
function pickerClosed() {
  const welcome = document.getElementById("welcome");
  if (!welcome || welcome.classList.contains("hidden")) return Promise.resolve();
  return new Promise(resolve => {
    const watcher = new MutationObserver(() => {
      if (!welcome.classList.contains("hidden")) return;
      watcher.disconnect();
      resolve();
    });
    watcher.observe(welcome, { attributes: true, attributeFilter: ["class"] });
  });
}

async function shouldAsk() {
  if (answered() || !currentMember()) return false;
  /* Unsupported covers iPhones that have not installed the app yet, where
     there is no permission to grant and the dialog would be a dead end. */
  if (!pushCapability().supported) return false;
  /* Denied cannot be undone from a web page - only in system settings. */
  if (Notification.permission === "denied") return false;
  return !(await currentPushSubscription());
}

function dialog() {
  const host = document.createElement("div");
  host.className = "overlay";
  host.id = "notify-nudge";
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-modal", "true");
  host.setAttribute("aria-labelledby", "notify-nudge-title");
  host.innerHTML = `<div class="overlay-card access-card">
    <h2 id="notify-nudge-title">Never miss league business</h2>
    <p class="muted">DFL HQ can send alerts straight to this phone &mdash; trades, polls, fee reminders and commissioner notes. One tap, and you can pick which ones later.</p>
    <div class="row-end">
      <button type="button" class="btn ghost small" data-nudge="no">Not now</button>
      <button type="button" class="btn" data-nudge="yes">Turn on notifications</button>
    </div>
  </div>`;
  return host;
}

export async function setupNotifyNudge() {
  await pickerClosed();
  if (!await shouldAsk()) return;

  const host = dialog();
  document.body.appendChild(host);
  const close = () => { remember(); host.remove(); };

  host.addEventListener("click", async event => {
    const choice = event.target.closest("[data-nudge]")?.dataset.nudge;
    if (!choice) return;
    if (choice === "no") return close();

    const button = event.target.closest("[data-nudge]");
    button.disabled = true;
    try {
      await enablePush();
      toast("Notifications enabled on this device");
      close();
    } catch (error) {
      /* Leave the dialog up on failure so the answer is not recorded and
         the member can read what went wrong before dismissing it. */
      toast(error.message || "Could not enable notifications", true);
      button.disabled = false;
    }
  });
}

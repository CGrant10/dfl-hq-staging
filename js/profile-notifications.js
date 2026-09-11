// =====================================================================
// profile-notifications.js - the notification switch on your own profile
// ---------------------------------------------------------------------
// Settings & privacy is where a member goes to change how the app treats
// them, and until now notifications were the one setting that was not
// there - it lived only behind the bell, on a page you reach by tapping
// an icon whose whole job is to show unread counts. So the card here
// reports the real state of THIS device and offers the opposite action:
// off when it is on, on when it is off.
//
// THE STATE IS PER DEVICE, and the copy says so. A member with a phone
// and a laptop has two answers to "are notifications on", and a profile
// setting that implied one account-wide answer would be lying on
// whichever device they were not holding.
//
// It repaints itself after a toggle rather than re-rendering the profile,
// which would collapse the <details> the member just opened.
// =====================================================================

import { esc, toast } from "./ui.js";
import { disablePush, enablePush, pushCapability, pushPreferences } from "./notifications.js";

const SLOT = "[data-profile-notifications-slot]";

function markup(state, capability) {
  if (!capability.supported) {
    return `<div class="card">
      <h3 class="card-heading">Notifications</h3>
      <p class="muted tiny">${esc(capability.reason)}</p>
    </div>`;
  }
  const on = state.enabled && !!state.subscription;
  const denied = Notification.permission === "denied";
  return `<div class="card">
    <h3 class="card-heading">Notifications</h3>
    <p class="muted tiny">${on
      ? "On for this device. League alerts reach this phone even when DFL HQ is closed."
      : denied
        ? "Blocked in this browser's settings. Allow notifications for DFL HQ there, then come back."
        : "Off for this device. Turn them on for trades, polls, fee reminders and commissioner notes."}</p>
    <div class="row-end">
      ${on ? `<a class="btn ghost small" href="#/notifications">Choose which ones</a>` : ""}
      ${denied && !on ? "" : `<button type="button" class="btn ${on ? "ghost" : ""} small" data-profile-push="${on ? "off" : "on"}">${on ? "Turn off on this device" : "Enable notifications"}</button>`}
    </div>
  </div>`;
}

async function paint(slot) {
  const capability = pushCapability();
  let state = { enabled: false, subscription: null };
  if (capability.supported) {
    try { state = await pushPreferences(); }
    catch { /* the inbox page reports schema trouble properly; stay quiet here */ }
  }
  slot.innerHTML = markup(state, capability);
}

export async function mountProfileNotifications(view) {
  const slot = view.querySelector(SLOT);
  if (!slot) return;
  await paint(slot);

  slot.addEventListener("click", async event => {
    const button = event.target.closest("[data-profile-push]");
    if (!button) return;
    const turningOn = button.dataset.profilePush === "on";
    button.disabled = true;
    try {
      if (turningOn) await enablePush(); else await disablePush();
      toast(turningOn ? "Notifications enabled on this device" : "Notifications turned off on this device");
      await paint(slot);
    } catch (error) {
      toast(error.message || "Could not change notifications", true);
      button.disabled = false;
    }
  });
}

import { db, edge } from "./supabase.js";
import { currentMember } from "./members.js";
import { DEFAULT_NOTIFICATION_CATEGORIES } from "./notification-core.js";

const BADGE_EVENT = "dfl:notifications-changed";
const tokenKey = memberId => `dfl.notification.deviceToken.${memberId}`;

function bytesFromBase64(value) {
  const padded = value + "=".repeat((4 - value.length % 4) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, ch => ch.charCodeAt(0));
}

export function pushCapability() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { supported: false, reason: "This browser does not support app notifications." };
  }
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (ios && !standalone) {
    return { supported: false, installRequired: true, reason: "On iPhone, add DFL HQ to your Home Screen first, then open the installed app." };
  }
  return { supported: true, permission: Notification.permission };
}

export async function currentPushSubscription() {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager?.getSubscription() || null;
}

async function pushPublicKey() {
  const { data, error } = await edge().functions.invoke("send-notification", { body: { action: "config" } });
  if (error) throw error;
  if (!data?.publicKey) throw new Error("Push delivery is not configured yet");
  return data.publicKey;
}

function deviceLabel() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const android = /Android/.test(navigator.userAgent);
  if (ios) return "iPhone / iPad";
  if (android) return "Android phone";
  return "Web browser";
}

export async function enrollSubscription(subscription, categories = DEFAULT_NOTIFICATION_CATEGORIES) {
  const json = subscription.toJSON();
  const member = currentMember();
  const { data, error } = await db().rpc("enroll_push_subscription", {
    push_endpoint: json.endpoint,
    push_p256dh: json.keys?.p256dh,
    push_auth: json.keys?.auth,
    push_categories: categories,
    push_device_label: deviceLabel(),
    push_user_agent: navigator.userAgent,
  });
  if (error) throw error;
  if (!data || !member) throw new Error("This device could not be enrolled");
  localStorage.setItem(tokenKey(member.id), data);
  window.dispatchEvent(new CustomEvent(BADGE_EVENT));
  return data;
}

export async function saveSubscription(subscription, categories = DEFAULT_NOTIFICATION_CATEGORIES) {
  const { data, error } = await db().rpc("save_push_preferences", {
    push_endpoint: subscription.endpoint,
    push_categories: categories,
  });
  if (error) throw error;
  window.dispatchEvent(new CustomEvent(BADGE_EVENT));
  return data;
}

/*
  Turning notifications on is one tap. It used to want a Profile PIN, which
  meant the members most likely to want alerts - the ones who had never opened
  the profile settings - could not turn them on at all.
*/
export async function enablePush(categories = DEFAULT_NOTIFICATION_CATEGORIES) {
  if (!currentMember()) throw new Error("Pick your DFL member first");
  const capability = pushCapability();
  if (!capability.supported) throw new Error(capability.reason);
  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications were not allowed. You can change that in your phone settings.");
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const publicKey = await pushPublicKey();
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytesFromBase64(publicKey),
    });
  }
  try { await enrollSubscription(subscription, categories); }
  catch (error) { if (!localStorage.getItem(tokenKey(currentMember()?.id))) await subscription.unsubscribe().catch(() => {}); throw error; }
  return subscription;
}

/*
  A TEST NOTIFICATION THAT NEVER LEAVES THE PHONE.

  Whether a notification drops down from the top of the screen is Android's
  call, not ours - it comes from the notification channel's importance, and
  there is no web API to set or even read it. So the only way to tell a broken
  channel from a broken delivery is to take delivery out of the picture: this
  draws a notification straight from the service worker registration, with the
  exact options a real push uses.

  It fires on a delay because the answer is worthless otherwise. Android does
  not interrupt you with a banner for the app you are already looking at, and a
  notification arriving while the screen is off goes to the lock screen rather
  than dropping down - two ordinary behaviours that look exactly like the bug.
  The delay is there so the phone can be put in the state where a heads-up
  would actually happen.
*/
export async function testNotification(delayMs = 5000) {
  if (!("serviceWorker" in navigator)) throw new Error("This browser cannot show notifications");
  if (Notification.permission !== "granted") throw new Error("Turn notifications on for this device first");
  const registration = await navigator.serviceWorker.ready;
  await new Promise(resolve => setTimeout(resolve, delayMs));
  await registration.showNotification("Test notification", {
    body: "If this dropped down from the top of the screen, alerts are working.",
    icon: "icons/app-192.png",
    badge: "icons/badge-96.png",
    tag: `dfl-test-${Date.now()}`,
    renotify: true,
    vibrate: [90, 60, 90],
    data: { url: "#/notifications", messageId: null },
  });
}

export async function disablePush() {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  const { error } = await db().rpc("disable_push_subscription", { push_endpoint: subscription.endpoint });
  if (error) throw error;
  await subscription.unsubscribe();
  const member = currentMember();
  if (member) localStorage.removeItem(tokenKey(member.id));
  window.dispatchEvent(new CustomEvent(BADGE_EVENT));
}

export async function pushPreferences() {
  const subscription = await currentPushSubscription();
  if (!subscription) return { subscription: null, enabled: false, categories: DEFAULT_NOTIFICATION_CATEGORIES };
  let { data, error } = await db().rpc("my_push_preferences", { push_endpoint: subscription.endpoint });
  if (error) throw error;
  let row = Array.isArray(data) ? data[0] : data;
  /* A browser push subscription survives normal app updates, while its local
     device token can be lost during an older cache/storage migration. The old
     UI called that device "off" and invited the member to enable it again on
     every visit. Repair the backend enrollment once instead; the browser has
     already granted permission, so no permission prompt is shown. */
  if (!row && Notification.permission === "granted") {
    const known = await db().rpc("known_push_preferences", { push_endpoint: subscription.endpoint });
    if (known.error) throw known.error;
    const previous = Array.isArray(known.data) ? known.data[0] : known.data;
    const categories = Array.isArray(previous?.categories) ? previous.categories : DEFAULT_NOTIFICATION_CATEGORIES;
    let active = subscription;
    /* Re-enabling an endpoint the push service already rejected only makes
       the next delivery fail again. Rotate the subscription and keys first. */
    if (previous && previous.enabled === false) {
      await subscription.unsubscribe().catch(() => {});
      const registration = await navigator.serviceWorker.ready;
      active = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytesFromBase64(await pushPublicKey()),
      });
    }
    await enrollSubscription(active, categories);
    ({ data, error } = await db().rpc("my_push_preferences", { push_endpoint: active.endpoint }));
    if (error) throw error;
    row = Array.isArray(data) ? data[0] : data;
    return { subscription: active, enabled: !!row?.enabled, categories };
  }
  return {
    subscription,
    enabled: !!row?.enabled,
    categories: Array.isArray(row?.categories) ? row.categories : DEFAULT_NOTIFICATION_CATEGORIES,
  };
}

export async function inbox(limit = 50) {
  if (!currentMember()) return [];
  const { data, error } = await db().rpc("notification_inbox", { max_rows: limit });
  if (error) throw error;
  return data || [];
}

export async function markRead(ids) {
  const clean = [...new Set(ids.map(Number).filter(Number.isSafeInteger))];
  if (!clean.length) return;
  const { error } = await db().rpc("mark_notifications_read", { message_ids: clean });
  if (error) throw error;
  window.dispatchEvent(new CustomEvent(BADGE_EVENT));
}

/* Deleting a notice removes YOUR copy. The message is one row shared by the
   whole league, so a real delete would clear it off everyone's phone. */
export async function dismissNotifications(ids) {
  const clean = [...new Set(ids.map(Number).filter(Number.isSafeInteger))];
  if (!clean.length) return;
  const { error } = await db().rpc("dismiss_notifications", { message_ids: clean });
  if (error) throw error;
  window.dispatchEvent(new CustomEvent(BADGE_EVENT));
}

export async function clearInbox() {
  const { error } = await db().rpc("clear_notification_inbox");
  if (error) throw error;
  window.dispatchEvent(new CustomEvent(BADGE_EVENT));
}

async function unreadCount() {
  if (!currentMember()) return 0;
  const { data, error } = await db().rpc("notification_unread_count");
  if (error) throw error;
  return Number(data) || 0;
}

export function mountNotificationBell() {
  let button = document.getElementById("notification-bell");
  if (!button) {
    button = document.createElement("button");
    button.id = "notification-bell";
    button.className = "notification-bell";
    button.type = "button";
    button.setAttribute("aria-label", "Notifications");
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.8 10.2a5.2 5.2 0 0 1 10.4 0v3.1l1.7 2.7H5.1l1.7-2.7zM9.7 18.1a2.5 2.5 0 0 0 4.6 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg><span id="notification-count" class="notification-count hidden">0</span>`;
    document.getElementById("whoami")?.before(button);
  }
  const countNode = button.querySelector("#notification-count");
  if (!button || !countNode) return;
  let stopped = false;
  const paint = async () => {
    try {
      const count = await unreadCount();
      if (stopped) return;
      countNode.textContent = count > 99 ? "99+" : String(count);
      countNode.classList.toggle("hidden", count === 0);
      button.setAttribute("aria-label", count ? `Notifications, ${count} unread` : "Notifications");
    } catch {
      countNode.classList.add("hidden");
    }
  };
  button.addEventListener("click", () => { location.hash = "#/notifications"; });
  window.addEventListener(BADGE_EVENT, paint);
  window.addEventListener("focus", paint);
  const timer = setInterval(paint, 60000);
  /* Repair an expired endpoint when the app opens, after permission was
     already granted. No notification permission prompt is shown here. */
  void pushPreferences().catch(() => {}).finally(paint);
  return () => { stopped = true; clearInterval(timer); window.removeEventListener(BADGE_EVENT, paint); window.removeEventListener("focus", paint); };
}

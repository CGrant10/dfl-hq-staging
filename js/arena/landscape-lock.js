// DFL Arena mobile orientation gate.
// The race is a wide broadcast composition. On a phone, portrait mode is not
// a compressed version of that composition; it is the wrong composition.
// Require landscape only while the race still needs to be watched. The moment
// the race reaches its finished presentation, release the requirement so a
// member can rotate normally and leave without fighting the phone.

/* Loaded only via `import`; this keeps it a module, not a global script. */
export {};

const PHONE_MAX = 900;
let overlay = null;
let stateObserver = null;

function isBroadcast() {
  return (location.hash || "").split("?")[0] === "#/broadcast";
}

function broadcastId() {
  return new URLSearchParams((location.hash || "").split("?")[1] || "").get("id");
}

function raceState() {
  return document.querySelector("#bc-stage")?.dataset?.raceState || "";
}

function needsLandscape() {
  const state = raceState();
  return isBroadcast()
    && state !== "finished"
    && window.innerWidth <= PHONE_MAX
    && window.matchMedia?.("(orientation: portrait)")?.matches;
}

function ensureOverlay() {
  if (overlay?.isConnected) return overlay;
  const id = broadcastId();
  const exitHref = `#/arena${id ? `?id=${encodeURIComponent(id)}` : ""}`;
  overlay = document.createElement("div");
  overlay.className = "arena-rotate-gate";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Rotate phone for Arena race");
  overlay.innerHTML = `
    <div class="arena-rotate-card">
      <div class="arena-rotate-phone" aria-hidden="true">▯</div>
      <strong>Rotate for the race</strong>
      <span>The Arena is built for landscape. Turn your phone sideways to continue.</span>
      <a class="arena-rotate-exit" href="${exitHref}">Exit Arena</a>
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

function watchRaceState() {
  stateObserver?.disconnect?.();
  stateObserver = null;
  const stage = document.querySelector("#bc-stage");
  if (!stage || typeof MutationObserver !== "function") return;
  stateObserver = new MutationObserver(paint);
  stateObserver.observe(stage, { attributes: true, attributeFilter: ["data-race-state"] });
}

function paint() {
  const show = needsLandscape();
  document.body.classList.toggle("arena-needs-landscape", show);
  if (show) ensureOverlay();
  else {
    overlay?.remove();
    overlay = null;
  }
  if (isBroadcast() && !stateObserver) watchRaceState();
}

if (!document.getElementById("arena-landscape-gate-css")) {
  const style = document.createElement("style");
  style.id = "arena-landscape-gate-css";
  style.textContent = `
.arena-rotate-gate{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:24px;background:#090b0f;color:#fff;text-align:center}
.arena-rotate-card{display:grid;justify-items:center;gap:10px;max-width:340px}
.arena-rotate-phone{font-size:54px;line-height:1;transform:rotate(90deg);animation:arena-rotate-nudge 1.7s ease-in-out infinite}
.arena-rotate-card strong{font-size:22px;letter-spacing:.02em}.arena-rotate-card span{font-size:14px;line-height:1.45;color:#aeb6c2}
.arena-rotate-exit{margin-top:10px;display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 18px;border:1px solid #3a414c;border-radius:10px;background:#171b22;color:#fff!important;text-decoration:none!important;font-weight:700;letter-spacing:.02em}
.arena-rotate-exit:active{transform:translateY(1px)}
body.arena-needs-landscape{overflow:hidden!important}
@keyframes arena-rotate-nudge{0%,100%{transform:rotate(90deg) translateY(0)}50%{transform:rotate(90deg) translateY(-5px)}}
@media(min-width:901px){.arena-rotate-gate{display:none!important}}
`;
  document.head.appendChild(style);
}

window.addEventListener("resize", paint, { passive: true });
window.addEventListener("orientationchange", () => setTimeout(paint, 80));
window.addEventListener("hashchange", () => {
  stateObserver?.disconnect?.();
  stateObserver = null;
  paint();
});

// The Broadcast stage is inserted after this module loads, so watch the app
// shell until it exists and then switch to the narrow state observer above.
if (typeof MutationObserver === "function") {
  // Stop as soon as the stage exists. This observer sees EVERY mutation in the
  // document, and a running race mutates constantly - leaving it connected
  // re-created the narrow state observer and repainted the gate on every
  // ticker tick, on the one view whose phone performance matters most.
  let mounted = false;
  const mountObserver = new MutationObserver(() => {
    if (mounted || !isBroadcast()) return;
    if (!document.querySelector("#bc-stage")) return;
    mounted = true;
    mountObserver.disconnect();
    watchRaceState();
    paint();
  });
  mountObserver.observe(document.documentElement, { childList: true, subtree: true });

  // A hash change tears the stage down and builds a new one, so the mount
  // watch has to come back for the next visit to Broadcast.
  window.addEventListener("hashchange", () => {
    if (mounted) {
      mounted = false;
      mountObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  });
}

queueMicrotask(paint);

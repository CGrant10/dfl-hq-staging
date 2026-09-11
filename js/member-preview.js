/*
  VIEW AS MEMBER.

  A commissioner needs to see the app the way everybody else sees it, and the
  old way to do that was to log out, look, and log back in. This is one tap in
  the top bar.

  The gate itself lives in supabase.js: while the preview is on, every
  privileged accessor answers false AND db() hands back the public client, so a
  write is refused by Postgres rather than merely hidden by the UI. Nothing in
  this file decides what is allowed - it only offers the switch, says plainly
  which mode you are in, and covers the repaint with a bit of theatre.

  The signal is the switch itself: a hardware-style toggle with a lit knob,
  sitting in the top bar where it is always on screen. An earlier version threw
  a gold banner across the whole app, which was unmissable and far too loud for
  something you flip several times while checking one page.
*/
import { ACCESS_EVENT, canPreviewAsMember, isMemberPreview, setMemberPreview } from "./supabase.js";
import { onRoute, renderRoute } from "./router.js";
import { currentMember } from "./members.js";
import { isCommissionerMember, requestCommissionerAccess } from "./member-lock.js";

const STYLE_ID = "dfl-member-preview-style";
const FILTER_ID = "dfl-glitch-filter";

/*
  THE PAGE TEARS, NOT A SHEET OVER IT.

  The first version was an overlay and read like one: coloured rectangles and
  scanlines floating above a page that was perfectly calm underneath. Nothing
  the eye actually cared about - the text, the cards, the crest - was ever
  distorted, so it looked stuck on.

  An SVG filter operates on the element's own rendered pixels, so this is the
  real UI coming apart:

    feTurbulence + feDisplacementMap   pushes real pixels sideways in bands,
                                       which is the tear
    feOffset on separated channels     splits the actual artwork into red and
                                       blue ghosts, the way a misaligned CRT
                                       gun does - not a tinted pane on top

  Both are driven from JS rather than SMIL, because animating baseFrequency
  through <animate> is unreliable on mobile Safari and this has to work on a
  phone or it is pointless.
*/
function ensureFilter() {
  if (document.getElementById(FILTER_ID)) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  svg.innerHTML = `
    <filter id="${FILTER_ID}" x="-8%" y="-4%" width="116%" height="108%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.00001 0.28" numOctaves="1" seed="7" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G" result="torn"/>
      <feOffset in="torn" dx="0" dy="0" result="ghostA"/>
      <feColorMatrix in="ghostA" type="matrix" result="redOnly"
        values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/>
      <feOffset in="torn" dx="0" dy="0" result="ghostB"/>
      <feColorMatrix in="ghostB" type="matrix" result="blueOnly"
        values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"/>
      <feBlend in="redOnly" in2="blueOnly" mode="screen"/>
    </filter>`;
  document.body.appendChild(svg);
}
const GLITCH_MS = 620;
const SWITCH_AT = 190;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
/*
  Two derived tokens the effect leans on, rather than colours of its own.

  --dfl-scan   mixed from --text, so scanlines are light on a dark palette and
               dark on a light one without branching on the mode.
  --dfl-glitch-blend
               screen brightens, which is how the channel split reads on a dark
               ground - and on a near-white one it has almost no headroom, so
               the whole effect washed out to nothing. Light grounds multiply
               instead.

               One selector covers every light palette: theme.js collapses any
               light-surface mode to data-mode="light" and keeps the real name
               in data-palette, so Fairway and any light club palette are
               already caught here without being named.
*/
:root{--dfl-scan:color-mix(in srgb,var(--text) 14%,transparent);--dfl-glitch-blend:screen}
:root[data-mode="light"]{--dfl-glitch-blend:multiply}

/* The switch names the view you are in. A knob alone told you a switch had been
   thrown but not which side you landed on - the transition said it, then the
   words were gone. The label is always there now, at every width, and colour
   backs it up rather than carrying it - the palette's second accent for your
   own tools, its first for member view, so neither is a colour this file
   invented. */
.dfl-preview-toggle{display:none;align-items:center;gap:7px;min-height:30px;margin-left:auto;padding:4px 10px 4px 7px;border:1px solid var(--control-line,rgba(255,255,255,.24));border-radius:999px;background:var(--control-bg,rgba(255,255,255,.06));color:var(--muted,#9fb0c0);font:900 9px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap;cursor:pointer;transition:color .2s,border-color .2s,background .2s}
.dfl-preview-toggle.is-available{display:inline-flex}
.dfl-preview-track{position:relative;flex:0 0 auto;width:24px;height:13px;border:1px solid var(--control-line,rgba(255,255,255,.3));border-radius:999px;background:rgba(0,0,0,.32);transition:background .22s,border-color .22s}
.dfl-preview-knob{position:absolute;top:1px;left:1px;width:9px;height:9px;border-radius:50%;background:var(--muted,#8fa0b0);transition:transform .22s cubic-bezier(.34,1.4,.5,1),background .22s}
.dfl-preview-short{display:none}
.dfl-preview-toggle:focus-visible{outline:2px solid var(--accent,#ffd400);outline-offset:2px}

/* Holding your own tools. Drawn in the palette's second accent, so this is
   the crest yellow in Medicine, the crest blue in Dark and Light, and the
   fairway blue in Fairway - never a hardcoded gold. */
.dfl-preview-toggle[data-mode="commissioner"]{border-color:color-mix(in srgb,var(--accent-2) 55%,transparent);background:color-mix(in srgb,var(--accent-2) 10%,transparent);color:var(--accent-2)}
.dfl-preview-toggle[data-mode="commissioner"] .dfl-preview-track{border-color:color-mix(in srgb,var(--accent-2) 55%,transparent)}
.dfl-preview-toggle[data-mode="commissioner"] .dfl-preview-knob{background:var(--accent-2-fill);box-shadow:0 0 6px color-mix(in srgb,var(--accent-2-fill) 80%,transparent)}

/* Looking as a member on purpose - knob thrown, filled rather than outlined so
   it reads as the active, deliberate state. The palette's first accent, which
   is the readable one, so the label holds up on a white ground too. */
.dfl-preview-toggle[data-mode="member"]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent)}
.dfl-preview-toggle[data-mode="member"] .dfl-preview-track{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 28%,transparent)}
.dfl-preview-toggle[data-mode="member"] .dfl-preview-knob{transform:translateX(11px);background:var(--accent-fill);box-shadow:0 0 7px color-mix(in srgb,var(--accent-fill) 75%,transparent)}

/* A commissioner who has not entered a PIN this session. Same side of the
   switch as member view, because that is what they are seeing - but dashed and
   quiet, because getting back needs the PIN. */
.dfl-preview-toggle[data-mode="locked"]{border-style:dashed;border-color:var(--control-line,rgba(255,255,255,.34));color:var(--muted,#9fb0c0)}
.dfl-preview-toggle[data-mode="locked"] .dfl-preview-knob{transform:translateX(11px)}
.dfl-preview-toggle[data-mode="locked"] .dfl-preview-label::after{content:"·PIN";margin-left:5px;opacity:.75}

/* Narrow phones keep the word, just a shorter one. Dropping the label entirely
   is what left the view unnamed in the first place. */
@media(max-width:430px){
  .dfl-preview-toggle{gap:6px;padding:4px 8px 4px 6px;letter-spacing:.06em}
  .dfl-preview-word{display:none}
  .dfl-preview-short{display:inline}
}

/* A second, quieter cue that does not depend on looking at the top right: a
   hairline under the top bar while you are in member view. Two pixels, no
   copy - the loud version of this was a full banner. */
body.is-member-preview .topbar{box-shadow:inset 0 -2px 0 var(--accent-fill)}

/* THE GLITCH. A CRT losing sync for half a second: scanlines roll, the picture
   tears into offset slices, the colour channels separate, and a monospace
   readout names the mode you are landing in. The route repaints underneath at
   ${SWITCH_AT}ms, so the switch is covered rather than watched. */
.dfl-glitch{position:fixed;inset:0;z-index:9500;overflow:hidden;pointer-events:none;animation:dfl-glitch-out ${GLITCH_MS}ms steps(1,end) forwards}
/* Scanlines are mixed from --text rather than hardcoded white, so they come
   out light on a dark palette and dark on a light one with no branching. */
.dfl-glitch-scan{position:absolute;inset:-10% 0;background:repeating-linear-gradient(0deg,var(--dfl-scan) 0,var(--dfl-scan) 1px,transparent 1px,transparent 3px);animation:dfl-glitch-roll ${GLITCH_MS}ms linear}
.dfl-glitch-tear{position:absolute;left:-6%;width:112%;background:color-mix(in srgb,var(--accent) 14%,transparent);mix-blend-mode:var(--dfl-glitch-blend);animation:dfl-glitch-tear 140ms steps(2,end) infinite}
/* The two channels are the crest pair for whichever palette is on: red and
   blue in Dark and Light, red and yellow in Medicine, green and blue in
   Fairway. This is what "takes on the theme accents" means in practice. */
/* The channel split now happens on the real pixels, in the SVG filter. What
   is left over the top is only what a screen genuinely adds: scanlines and a
   faint accent wash in the tear bands. */
/* The readout sits on a plate. Without one it lands on top of whatever the page
   was already showing - a headline, a photo - and turns into noise. */
.dfl-glitch-readout{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:min(340px,calc(100% - 32px));padding:13px 20px;border:1px solid color-mix(in srgb,var(--accent) 50%,transparent);border-radius:4px;background:color-mix(in srgb,var(--bg) 88%,transparent);text-align:center;color:var(--accent);font:900 10px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.3em;text-transform:uppercase;text-shadow:0 0 10px color-mix(in srgb,var(--accent) 55%,transparent);box-shadow:0 0 26px color-mix(in srgb,var(--accent) 22%,transparent);animation:dfl-glitch-flicker ${GLITCH_MS}ms steps(1,end)}
.dfl-glitch-readout b{display:block;margin-top:3px;font-size:14px;letter-spacing:.18em;color:var(--text)}
@keyframes dfl-glitch-roll{from{transform:translateY(-14%)}to{transform:translateY(14%)}}
@keyframes dfl-glitch-tear{0%{transform:translateX(-3%) scaleY(1)}50%{transform:translateX(4%) scaleY(1.6)}100%{transform:translateX(-1%) scaleY(.7)}}
@keyframes dfl-glitch-flicker{0%{opacity:0}12%{opacity:1}22%{opacity:.15}34%{opacity:1}62%{opacity:.85}78%{opacity:1}100%{opacity:0}}
@keyframes dfl-glitch-out{0%,86%{opacity:1}100%{opacity:0}}

/* The app itself jolts, so it reads as the whole machine losing sync and not an
   overlay floating on top of a perfectly calm page. */
/* The shake shifts things sideways, which grows the document and pops a
   horizontal scrollbar for the duration. clip rather than hidden, and on the
   root as well as the body: the root is the scrolling element here, so a rule
   on body alone does nothing, and hidden would turn it into a scroll container
   and lose the vertical position. */
:root:has(body.is-glitching),body.is-glitching{overflow-x:clip}
/* The filter is the effect; the jolt is only what a knocked screen does on top
   of it. Applying filter here also makes #view a containing block - the old
   contrast()/invert() shake already did that, so this changes nothing. */
body.is-glitching #view,body.is-glitching .topbar{animation:dfl-glitch-shake ${GLITCH_MS}ms steps(2,end)}
body.is-tearing #view,body.is-tearing .topbar{filter:url(#${FILTER_ID})}
@keyframes dfl-glitch-shake{0%{transform:none}18%{transform:translate(-2px,1px)}34%{transform:translate(3px,-1px)}52%{transform:translate(-1px,1px)}70%{transform:translate(2px,0)}100%{transform:none}}

/* Anyone who has asked the system to calm down gets the switch with none of the
   theatre - the mode still changes, it just does not lurch. */
@media(prefers-reduced-motion:reduce){
  .dfl-glitch{animation:dfl-glitch-out 160ms steps(1,end) forwards}
  .dfl-glitch-scan,.dfl-glitch-tear{display:none}
  body.is-tearing #view,body.is-tearing .topbar{filter:none}
  .dfl-glitch-readout{animation:none;opacity:1}
  body.is-glitching #view,body.is-glitching .topbar{animation:none}
  .dfl-preview-knob{transition:none}
}
`;
  document.head.appendChild(style);
}

const button = () => document.querySelector("[data-dfl-preview-toggle]");
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/*
  Three states, because there are three, and the switch used to admit only two:

    commissioner  privileged now, seeing everything
    member        privileged, deliberately looking as a member
    locked        holds commissioner access but has not entered a PIN this
                  session, so they are seeing member content already

  The locked state is why the switch used to vanish for anybody who chose Member
  View at sign-in: visibility was tied to holding credentials rather than to
  being a commissioner at all.
*/
function modeNow() {
  if (isMemberPreview()) return "member";
  if (canPreviewAsMember()) return "commissioner";
  return commissionerMember ? "locked" : "none";
}

const MODES = {
  commissioner: {
    word: "Commissioner",
    short: "Commish",
    title: "You have your commissioner tools. Tap to look at the app as a member.",
  },
  member: {
    word: "Member view",
    short: "Member",
    title: "You are seeing the app as a member and nothing can be written. Tap to take your tools back.",
  },
  locked: {
    word: "Member view",
    short: "Member",
    title: "You are seeing the app as a member. Tap and enter your commissioner PIN to switch.",
  },
};

function paint() {
  const node = button();
  if (!node) return;
  const mode = modeNow();
  const copy = MODES[mode];
  node.hidden = !copy;
  node.classList.toggle("is-available", Boolean(copy));
  node.dataset.mode = mode;
  /* aria-pressed answers "am I looking as a member", which is true of the
     locked state as well - it just cannot be turned off without a PIN. */
  node.setAttribute("aria-pressed", String(mode === "member" || mode === "locked"));
  if (copy) {
    node.querySelector(".dfl-preview-word").textContent = copy.word;
    node.querySelector(".dfl-preview-short").textContent = copy.short;
    node.title = copy.title;
    node.setAttribute("aria-label", `${copy.word}. ${copy.title}`);
  }
  document.body.classList.toggle("is-member-preview", mode === "member" || mode === "locked");
}

/* Whether this member is a commissioner at all - a different question from
   whether they are one right now. Cached per member, and the switch repaints
   when the answer lands. */
let commissionerMember = false;
let checkedMemberId = null;

async function checkCommissionerMember() {
  const id = currentMember()?.id ?? null;
  const key = id == null ? null : String(id);
  if (key === checkedMemberId) return;
  checkedMemberId = key;
  commissionerMember = false;
  paint();
  if (key == null) return;
  const answer = await isCommissionerMember(key).catch(() => false);
  if (String(currentMember()?.id ?? "") !== key) return;
  commissionerMember = answer;
  paint();
}

/* Plays over the top while the route repaints underneath. */
function glitch(landingOn) {
  const overlay = document.createElement("div");
  overlay.className = "dfl-glitch";
  overlay.setAttribute("aria-hidden", "true");
  const tears = [18, 39, 57, 74]
    .map(top => `<div class="dfl-glitch-tear" style="top:${top}%;height:${3 + (top % 5)}%"></div>`)
    .join("");
  overlay.innerHTML = `
    <div class="dfl-glitch-scan"></div>
    ${tears}
    <div class="dfl-glitch-readout">
      <span>reassigning session</span>
      <b>${landingOn ? "access :: member" : "access :: commissioner"}</b>
    </div>`;
  document.body.appendChild(overlay);
  /* The tear rides on a class, so a device that failed the cost check simply
     does not get it - the scanlines and the readout still play. */
  document.body.classList.add("is-glitching");
  if (filterAllowed() && !reducedMotion()) document.body.classList.add("is-tearing");
  driveFilter();
  setTimeout(() => {
    overlay.remove();
    document.body.classList.remove("is-glitching");
    document.body.classList.remove("is-tearing");
  }, reducedMotion() ? 200 : GLITCH_MS);
}

/* A second tap mid-glitch would commit twice and leave the switch disagreeing
   with the gates, so the switch is deaf until the transition finishes. */
/*
  Animate the filter across the transition.

  A displacement that never changes is a static smear - it has to move, and it
  has to move in steps rather than smoothly, because a screen losing sync jumps
  between bad frames rather than easing through them. So the values are re-rolled
  on a coarse interval and held.

  It settles to zero at the end rather than being switched off, so the page
  reassembles instead of snapping back.
*/
/*
  A full-page SVG filter is the right effect and the wrong thing to assume about
  a phone. #view is 2295px tall on the home screen, and filtering that surface
  every frame is real GPU work - I could not measure it on a device, so it
  measures itself.

  The first time it runs, frame times are sampled. If the median frame is worse
  than 28ms - anything under about 35fps, where a glitch stops reading as a
  glitch and starts reading as a stutter - the tear is switched off for good on
  this device and the scanline overlay carries the transition alone. Stored per
  device, not per session, because a phone does not get faster tomorrow.
*/
const HEAVY_KEY = "dfl.glitchHeavy";
const filterAllowed = () => {
  try { return localStorage.getItem(HEAVY_KEY) !== "no"; } catch { return true; }
};

function watchFilterCost() {
  try { if (localStorage.getItem(HEAVY_KEY)) return; } catch { return; }
  const times = [];
  let last = performance.now();
  const started = last;
  const tick = now => {
    times.push(now - last);
    last = now;
    if (now - started < GLITCH_MS) { requestAnimationFrame(tick); return; }
    times.shift();
    if (times.length < 6) return;
    const sorted = [...times].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    try { localStorage.setItem(HEAVY_KEY, median > 28 ? "no" : "yes"); } catch {}
  };
  requestAnimationFrame(tick);
}

function driveFilter() {
  const filter = document.getElementById(FILTER_ID);
  if (!filter || reducedMotion()) return;
  watchFilterCost();
  const turbulence = filter.querySelector("feTurbulence");
  const displace = filter.querySelector("feDisplacementMap");
  const offsets = filter.querySelectorAll("feOffset");
  const started = performance.now();
  let lastStep = -1;

  const frame = now => {
    const elapsed = now - started;
    const life = Math.min(1, elapsed / GLITCH_MS);
    if (life >= 1) {
      displace.setAttribute("scale", "0");
      offsets.forEach(o => { o.setAttribute("dx", "0"); o.setAttribute("dy", "0"); });
      return;
    }
    /* ~14 held frames across the transition, not 60 smooth ones. */
    const step = Math.floor(life * 14);
    if (step !== lastStep) {
      lastStep = step;
      /* Violent early, settling late - the screen recovers as the new view lands. */
      const decay = Math.pow(1 - life, 1.6);
      const jitter = (n) => (Math.sin(step * 12.9898 + n) * 43758.5453) % 1;
      displace.setAttribute("scale", String(Math.round(46 * decay * (0.45 + Math.abs(jitter(1))))));
      turbulence.setAttribute("baseFrequency", `0.00001 ${(0.16 + Math.abs(jitter(2)) * 0.5).toFixed(3)}`);
      const split = 7 * decay;
      offsets[0].setAttribute("dx", (-split * (0.5 + Math.abs(jitter(3)))).toFixed(1));
      offsets[0].setAttribute("dy", (jitter(4) * 1.5).toFixed(1));
      offsets[1].setAttribute("dx", (split * (0.5 + Math.abs(jitter(5)))).toFixed(1));
      offsets[1].setAttribute("dy", (jitter(6) * -1.5).toFixed(1));
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

let switching = false;

/* Runs the transition and repaints the page underneath it. */
function transitionTo(landingOnMemberView) {
  glitch(landingOnMemberView);
  const commit = () => {
    setMemberPreview(landingOnMemberView);
    paint();
    /* Every page reads the gates while it renders, so the current one has to be
       drawn again before any of this is visible. */
    void renderRoute();
    switching = false;
  };
  if (reducedMotion()) commit();
  else setTimeout(commit, SWITCH_AT);
}

async function toggle() {
  if (switching) return;
  const mode = modeNow();
  if (mode === "none") return;
  switching = true;
  try {
    if (mode === "locked") {
      /* Nothing to preview yet - they are already seeing member content and
         have no credentials to set aside. Get the PIN first, then run the
         transition into the commissioner side. */
      const granted = await requestCommissionerAccess();
      if (!granted) {
        switching = false;
        paint();
        return;
      }
      setMemberPreview(false);
      transitionTo(false);
      return;
    }
    transitionTo(mode === "commissioner");
  } catch (err) {
    switching = false;
    paint();
    console.warn("member preview:", err);
  }
}

export function refreshMemberPreview() {
  ensureStyles();
  ensureFilter();
  paint();
  void checkCommissionerMember();
}

export function mountMemberPreview() {
  const bar = document.querySelector(".topbar-actions") || document.querySelector(".topbar-inner");
  const whoami = document.getElementById("whoami");
  if (!bar || button()) return refreshMemberPreview();
  ensureStyles();
  const node = document.createElement("button");
  node.type = "button";
  node.className = "dfl-preview-toggle";
  node.dataset.dflPreviewToggle = "";
  node.hidden = true;
  node.setAttribute("aria-pressed", "false");
  /* The visible word is dropped on narrow screens, so the button carries its
     own accessible name rather than relying on the label being rendered. */
  node.setAttribute("aria-label", "Commissioner view");
  node.innerHTML = `<span class="dfl-preview-track" aria-hidden="true"><span class="dfl-preview-knob"></span></span><span class="dfl-preview-label"><span class="dfl-preview-word">Commissioner</span><span class="dfl-preview-short" aria-hidden="true">Commish</span></span>`;
  node.addEventListener("click", toggle);
  bar.insertBefore(node, whoami || null);
  /*
    The switch has to re-decide whether it belongs on screen every time the
    answer could have changed, or it does what it did on first release: decides
    once at boot, finds no credentials because you had not entered your PIN yet,
    and stays hidden for the rest of the session.

    - ACCESS_EVENT covers the real path. Commissioner and owner access is granted
      from a form submit in member-lock.js or on the Admin page, both long after
      boot, and neither knows this switch exists.
    - dfl:pick-member covers switching member, which can hand access over or take
      it away.
    - onRoute is the safety net for any path neither of those catches. Repainting
      one button per navigation costs nothing.
  */
  window.addEventListener(ACCESS_EVENT, () => setTimeout(refreshMemberPreview, 0));
  window.addEventListener("dfl:pick-member", () => setTimeout(refreshMemberPreview, 0));
  onRoute(() => refreshMemberPreview());
  refreshMemberPreview();
}

/* =====================================================================
   collapse.js - fold away a card you are done with
   ---------------------------------------------------------------------
   The golf event page is long: a draft board, a points board, three
   battles, a leaderboard, the teams, the roster, the team editor, the
   generator. Most of it is setup - once the day is under way it is all
   screen filler between you and the scores.

   So any card can be folded. Mark it up and this file does the rest:

     <section class="card" data-collapse="golf-teams" data-collapse-title="Teams">

   WHAT IT REMEMBERS
   The folded/open state is per key, per device, in localStorage - so the
   commissioner who folds the generator on their phone still has it folded
   next week, and nobody else is affected. A key is a stable name, never an
   id, or the state would be forgotten every time a row was rebuilt.

   DEFAULTS, AND WHY THEY ARE THREE-STATE
   A card can ask to start folded:

     <section class="card" data-collapse="golf-round-1" data-collapse-default="folded">

   That is only a DEFAULT. It applies while the reader has never touched
   that card, and the moment they do their choice wins for good - which is
   why an open card now stores "0" rather than deleting its key. With two
   states there was no way to tell "they opened it" from "they have never
   seen it", so a round that folded itself on completing would have folded
   itself again every fifteen seconds under somebody who kept opening it.

   The default is re-read on every draw, so it can follow the content: the
   round cards ask to be folded once every match in them is decided, and
   the draft board asks once the last pick is in. Nothing here works any of
   that out - the module that owns the facts writes the attribute.

   HOW IT ATTACHES
   A MutationObserver, because every golf card is rendered by innerHTML and
   then re-rendered by a poll or a save - there is no single moment after
   which the DOM is settled. Cards are marked as wired so a re-render costs
   one pass over the new nodes and nothing else.

   The button is a real <button> with aria-expanded and it wraps the card's
   existing title, so a screen reader and a keyboard get the same affordance
   as a thumb.
   ===================================================================== */

const KEY = (name) => `dfl.collapsed.${name}`;

/** "1" folded, "0" open, null when this reader has never touched the card. */
function choice(name) {
  try { return localStorage.getItem(KEY(name)); } catch { return null; }
}

/* Both answers are written down. Deleting the key on open would throw away
   the difference between "they want this open" and "they have not decided",
   and the default would then keep overruling them. */
function remember(name, isCollapsed) {
  try { localStorage.setItem(KEY(name), isCollapsed ? "1" : "0"); }
  catch { /* private mode: it just will not be remembered */ }
}

/** Where a card should start: the reader's choice, else what it asked for. */
function startFolded(card) {
  const made = choice(card.dataset.collapse);
  if (made !== null) return made === "1";
  return card.dataset.collapseDefault === "folded";
}

function styles() {
  if (document.getElementById("dfl-collapse-style")) return;
  const s = document.createElement("style");
  s.id = "dfl-collapse-style";
  s.textContent = `
.dfl-fold{display:flex;align-items:center;gap:9px;width:100%;padding:11px 13px;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dfl-fold:hover{background:var(--bg-3)}
.dfl-fold-title{flex:1;min-width:0;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.07em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The one number worth keeping when the card is shut. A round folded away
   should still say what it finished; otherwise folding the nine you just
   played hides the very thing you folded it to stop scrolling past. */
.dfl-fold-badge{flex:0 0 auto;font-size:12.5px;font-weight:950;font-variant-numeric:tabular-nums;white-space:nowrap}
.dfl-fold-badge:empty{display:none}
.dfl-fold-hint{font-size:9.5px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
/* A caret, not a word: it turns instead of relabelling, so the control never
   argues with itself about whether it says what it does or what it will do. */
.dfl-fold-caret{flex:0 0 auto;width:16px;height:16px;color:var(--muted);transition:transform .16s ease}
.dfl-fold[aria-expanded="false"] .dfl-fold-caret{transform:rotate(-90deg)}
.is-folded>*:not(.dfl-fold){display:none !important}
.is-folded{padding-bottom:0 !important}
.card.is-folded .dfl-fold{border-radius:12px}
@media(prefers-reduced-motion:reduce){.dfl-fold-caret{transition:none}}`;
  document.head.appendChild(s);
}

/*
  The card's own heading is reused as the button's label wherever there is
  one, so folding does not introduce a second, differently worded title for
  the same card. data-collapse-title is the fallback for a card whose
  heading is a graphic - the points board, for one.
*/
function titleFor(card) {
  const explicit = card.dataset.collapseTitle;
  if (explicit) return explicit;
  const found = card.querySelector(".card-title, .card-heading, h2, h3");
  return found ? found.textContent.trim() : "Section";
}

function wire(card) {
  if (card.dataset.collapseWired === "1") return;
  const name = card.dataset.collapse;
  if (!name) return;
  card.dataset.collapseWired = "1";
  styles();

  const button = document.createElement("button");
  button.type = "button";
  button.className = "dfl-fold";
  button.innerHTML = `<svg class="dfl-fold-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5 12 15.5 18 9.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="dfl-fold-title">${titleFor(card)}</span><span class="dfl-fold-badge" data-fold-badge></span><span class="dfl-fold-hint" data-fold-hint></span>`;

  const paint = () => {
    const isFolded = card.classList.contains("is-folded");
    button.setAttribute("aria-expanded", String(!isFolded));
    button.querySelector("[data-fold-hint]").textContent = isFolded ? "Show" : "Hide";
    button.querySelector("[data-fold-badge]").textContent = card.dataset.collapseBadge || "";
    button.setAttribute("aria-label", `${isFolded ? "Show" : "Hide"} ${titleFor(card)}`);
  };

  button.addEventListener("click", () => {
    const nowFolded = !card.classList.contains("is-folded");
    card.classList.toggle("is-folded", nowFolded);
    remember(name, nowFolded);
    paint();
  });

  card.insertBefore(button, card.firstChild);
  card.classList.toggle("is-folded", startFolded(card));
  paint();
  /* Re-read the default when the card changes its mind - a round that has
     just been decided asks to fold, and it should not have to wait for a
     re-render to be listened to. A reader who has already chosen is not
     disturbed, because startFolded() puts their choice first. */
  new MutationObserver(() => {
    if (choice(name) !== null) return;
    card.classList.toggle("is-folded", startFolded(card));
    paint();
  }).observe(card, { attributes: true, attributeFilter: ["data-collapse-default"] });
}

/* =====================================================================
   Arena / Broadcast control chrome
   ---------------------------------------------------------------------
   The race viewer is shared by desktop/OBS and phones. Its control pill was
   originally sized in viewport units because the stage is 16:9, which made
   the BLACK SHELL itself enormous on a desktop monitor. On phones the whole
   control cluster was deliberately pinned open, where it covers the race.

   Keep this behavior outside the race engine: tighten the desktop pill with
   ordinary UI pixels, and on phones add one arrow that can tuck the controls
   away. The first time a race leaves idle, the panel tucks itself automatically.
   No race state is written and no Arena timing code is touched here.
   ===================================================================== */
function arenaControlStyles() {
  if (document.getElementById("dfl-arena-control-style")) return;
  const s = document.createElement("style");
  s.id = "dfl-arena-control-style";
  s.textContent = `
/* Desktop: the black shell hugs the actual buttons instead of scaling with
   the width of a 1080p/4K display. The old instructional sentence was also
   the thing most likely to spill beyond the pill, so keep controls, lose yap. */
@media (min-width:901px){
  .bc-bar{gap:8px!important;padding:8px 10px!important;max-width:calc(100vw - 32px);width:max-content;box-sizing:border-box;box-shadow:0 10px 30px rgba(0,0,0,.6)!important}
  .bc-bar .bc-btn{font-size:14px!important;padding:8px 13px!important}
  .bc-bar .bc-motion-setting{gap:6px!important;padding:0 5px!important;font-size:12px!important}
  .bc-bar .bc-bar-hint{display:none!important}
}
.bc-bar-toggle{display:none;appearance:none;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:var(--text);border-radius:999px;width:34px;height:34px;padding:0;font:900 18px/1 system-ui,sans-serif;cursor:pointer;place-items:center}
@media (max-width:900px){
  .bc-bar{box-sizing:border-box;transition:width .16s ease,padding .16s ease,background .16s ease!important}
  .bc-bar-toggle{display:grid;order:-1;flex:0 0 34px}
  .bc-bar.mobile-collapsed{width:auto!important;max-width:none!important;padding:5px!important;gap:0!important;flex-wrap:nowrap!important;background:rgba(9,13,19,.86)!important}
  .bc-bar.mobile-collapsed>:not(.bc-bar-toggle){display:none!important}
}

/* The standings rail costs almost a third of the course on a portrait phone.
   That does not change the race gap, but it crushes the number of pixels the
   gap has to read. While the race is live, give the course the whole frame;
   the full standings rail returns automatically as soon as results exist. */
@media (max-width:800px){
  .bc-stage[data-race-state="countdown"] .bc-body,
  .bc-stage[data-race-state="running"] .bc-body{grid-template-columns:minmax(0,1fr)!important}
  .bc-stage[data-race-state="countdown"] .bc-board,
  .bc-stage[data-race-state="running"] .bc-board{display:none!important}
}

/* Finish paint, not finish furniture. Keep the exact same --finish-x ground
   coordinate and layer, but remove every depth cue: no gantry, bevel, glow or
   contact shadow. Racers still pass in front of one flat checkered stripe. */
.bc-stage .bc-finish,
.arena-track-wrap.cinematic-race .track-finish{
  top:16.5%!important;
  bottom:8%!important;
  width:clamp(8px,1.05vw,18px)!important;
  background:repeating-conic-gradient(#f5f7fa 0 25%,#151a21 0 50%) 0 0 / clamp(8px,1.05vw,18px) clamp(8px,1.05vw,18px)!important;
  border:0!important;
  border-radius:0!important;
  box-shadow:none!important;
  opacity:.94;
}
.bc-stage .bc-finish::before,
.bc-stage .bc-finish::after,
.arena-track-wrap.cinematic-race .track-finish::before,
.arena-track-wrap.cinematic-race .track-finish::after{content:none!important;display:none!important}

@media(prefers-reduced-motion:reduce){.bc-bar{transition:none!important}}
`;
  document.head.appendChild(s);
}

function wireArenaControls() {
  const bar = document.querySelector("#bc-bar");
  const stage = document.querySelector("#bc-stage");
  if (!bar || !stage || bar.dataset.mobileCollapseWired === "1") return;
  bar.dataset.mobileCollapseWired = "1";
  arenaControlStyles();

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "bc-bar-toggle";
  toggle.setAttribute("aria-label", "Collapse race controls");
  toggle.setAttribute("aria-expanded", "true");
  toggle.textContent = "⌄";
  bar.insertBefore(toggle, bar.firstChild);

  const paint = () => {
    const collapsed = bar.classList.contains("mobile-collapsed");
    toggle.textContent = collapsed ? "⌃" : "⌄";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Open race controls" : "Collapse race controls");
  };
  const setCollapsed = (collapsed) => {
    bar.classList.toggle("mobile-collapsed", collapsed);
    paint();
  };

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setCollapsed(!bar.classList.contains("mobile-collapsed"));
  });

  let autoCollapsed = false;
  const followRace = () => {
    if (!matchMedia("(max-width: 900px)").matches) return;
    const state = stage.dataset.raceState || "idle";
    if (state === "idle") {
      autoCollapsed = false;
      setCollapsed(false);
      return;
    }
    if (!autoCollapsed && (state === "countdown" || state === "running")) {
      autoCollapsed = true;
      setCollapsed(true);
    }
  };
  new MutationObserver(followRace).observe(stage, { attributes:true, attributeFilter:["data-race-state"] });
  followRace();
}

function sweep() {
  for (const card of document.querySelectorAll("[data-collapse]")) wire(card);
  wireArenaControls();
}

function boot() {
  sweep();
  new MutationObserver(sweep).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
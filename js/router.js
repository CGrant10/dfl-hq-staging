// =====================================================================
// router.js - hash based routing (#/home, #/rules, ...)
// Hash routing is used because GitHub Pages cannot rewrite URLs.
// =====================================================================

import { loading, errorBox } from "./ui.js";
import { ensureSportsbookNav } from "./sportsbook-nav.js";
import { startMemberLock } from "./member-lock.js";
import { dflSeasonCount, loadGolfFeatures } from "./config.js";
import { canEdit } from "./inline.js";
import { db } from "./supabase.js";

// Pages are loaded on demand, so the first paint stays fast.
const routes = {
  home:     () => import("./pages/home.js"),
  rules:    () => import("./pages/rules.js"),
  keepers:  () => import("./pages/keepers.js"),
  analyzer: () => import("./pages/analyzer.js"),
  polls:    () => import("./pages/polls.js"),
  proposals:() => import("./pages/proposals.js"),
  arena:    () => import("./pages/arena.js"),
  "arena-beta":() => import("./pages/arena-beta.js"),
  "arena-results":() => import("./pages/arena-results.js"),
  golf:     async () => {
    const [page] = await Promise.all([import("./pages/golf.js"), loadGolfFeatures()]);
    return page;
  },
  sportsbook:() => import("./pages/sportsbook.js"),
  broadcast:() => import("./pages/broadcast.js"),
  calendar: () => import("./pages/calendar.js"),
  history:  () => import("./pages/history.js"),
  facts:    () => import("./pages/facts.js"),
  trade:    () => import("./pages/trade.js"),
  finances: () => import("./pages/finances.js"),
  profile:  () => import("./pages/profile-locked.js"),
  notifications: () => import("./pages/notifications.js"),
  admin:    () => import("./pages/admin.js"),
};

/** Every page module name. Used by the updater to refresh unvisited pages. */
export function routeNames() { return Object.keys(routes); }
export function currentRoute() {
  const name = (location.hash || "#/home").replace("#/", "").split("?")[0];
  return routes[name] ? name : "home";
}
export function go(name) { location.hash = "#/" + name; }

let leaving = null;
const listeners = new Set();
export function onRoute(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function setTabIndicatorTarget(target) {
  const bar = document.getElementById("tabbar");
  if (!bar || !target) return;
  bar.style.setProperty("--tab-x", `${target.offsetLeft}px`);
  bar.style.setProperty("--tab-w", `${target.offsetWidth}px`);
  bar.classList.add("has-indicator");
}
function syncTabIndicator() {
  const bar = document.getElementById("tabbar");
  if (!bar) return;
  const active = bar.querySelector("a.on") ||
    (document.getElementById("more-btn")?.classList.contains("on") ? document.getElementById("more-btn") : null);
  if (!active) { bar.classList.remove("has-indicator"); return; }
  setTabIndicatorTarget(active);
}

/*
  DFL predates the Sleeper archive by two seasons. The synced rows remain the
  authority for records, points, averages and standings; only labels that mean
  "how many DFL seasons" get the legacy tenure added. Keeping this at the
  presentation boundary means a Sleeper sync can never erase those two years.
*/
function decorateDflSeasonCounts(view, route) {
  const apply = () => {
    if (route === "profile") {
      for (const stat of view.querySelectorAll(".statgrid .stat")) {
        const label = stat.querySelector(".stat-l");
        const value = stat.querySelector(".stat-v");
        if (!label || !value || label.textContent.trim().toLowerCase() !== "seasons") continue;
        if (value.dataset.dflTenure === "1") continue;
        const synced = Number(value.textContent.replace(/[^0-9.-]/g, ""));
        if (!Number.isFinite(synced)) continue;
        value.textContent = String(dflSeasonCount(synced));
        value.dataset.dflTenure = "1";
      }
    }
    if (route === "history") {
      for (const meta of view.querySelectorAll(".card-meta")) {
        if (meta.dataset.dflTenure === "1") continue;
        const m = /^\s*(\d+)\s+seasons?\s+of\s+history\b/i.exec(meta.textContent || "");
        if (!m) continue;
        meta.textContent = meta.textContent.replace(m[1], String(dflSeasonCount(Number(m[1]))));
        meta.dataset.dflTenure = "1";
      }
    }
  };
  apply();
  if (route === "history" && !view._dflSeasonObserver) {
    const observer = new MutationObserver(apply);
    observer.observe(view, { childList: true, subtree: true });
    view._dflSeasonObserver = observer;
  }
}

/*
  SPECTATORS NEED A WAY OUT OF A FINISHED RACE.

  arena.js auto-enters Broadcast for live events. Older code also treated
  `finished` as live, which meant a regular member could press Exit, land on
  #/arena?id=..., and get thrown straight back into Broadcast before the saved
  result ever became readable. Do the finished-state decision here, before the
  Arena event page gets a chance to redirect. Commissioners still use the full
  event/control page; regular members get the read-only result.
*/
async function redirectFinishedArenaSpectator(name, expectedHash) {
  if (name !== "arena" || canEdit()) return false;
  const id = new URLSearchParams((location.hash.split("?")[1] || "")).get("id");
  if (!id) return false;
  try {
    const { data, error } = await db().from("arena_events")
      .select("status,bc_state").eq("id", id).maybeSingle();
    if (error || !data) return false;
    if (data.status !== "complete" && data.bc_state !== "finished") return false;
    if (location.hash !== expectedHash) return false;
    location.hash = `#/arena-results?id=${id}`;
    return true;
  } catch {
    return false;
  }
}

function spectatorArenaLinks(view, name) {
  if (canEdit()) return;

  /* Finished cards go to the readable result instead of the auto-entering
     event controller. Live/open cards keep their existing behaviour. */
  if (name === "arena" && !new URLSearchParams((location.hash.split("?")[1] || "")).get("id")) {
    view.querySelectorAll(".arena-card .arena-link").forEach((link) => {
      if (!link.querySelector(".pill.grey")) return;
      const id = new URLSearchParams((link.getAttribute("href") || "").split("?")[1] || "").get("id");
      if (id) link.setAttribute("href", `#/arena-results?id=${id}`);
    });
  }

  /* Broadcast hides the normal app navigation. For spectators its Exit must
     land somewhere that cannot bounce them straight back into Broadcast. */
  if (name === "broadcast") {
    const id = new URLSearchParams((location.hash.split("?")[1] || "")).get("id");
    const exit = view.querySelector('#bc-bar a.bc-btn[href^="#/arena"]');
    if (id && exit) exit.setAttribute("href", `#/arena-results?id=${id}`);
  }
}

let renderEpoch = 0;
const setRouteCanvas = color => {
  document.documentElement.style.background = color;
  if (document.body) document.body.style.background = color;
};

/*
  A route renders into the view that existed when that navigation started.
  Replacing #view for every navigation means a slow page can finish safely in
  its now-detached view instead of painting over the page the user selected
  afterward. The epoch also stops stale renders from moving the tab indicator,
  scrolling the new page, or publishing a route-complete notification.
*/
export async function renderRoute() {
  const epoch = ++renderEpoch;
  const name = currentRoute();
  const expectedHash = location.hash;
  const previousView = document.getElementById("view");
  if (!previousView) return;
  const changed = name !== lastAnimated;
  if (changed) { previousView.classList.remove("page-in"); previousView.classList.add("page-switching"); }
  try { leaving?.(); } catch (err) { console.warn(err); }
  leaving = null;
  if (previousView._dflSeasonObserver) { previousView._dflSeasonObserver.disconnect(); previousView._dflSeasonObserver = null; }

  const view = previousView.cloneNode(false);
  view.classList.remove("page-in");
  view.classList.add("is-route-loading");
  document.body.classList.add("route-loading");
  setRouteCanvas("var(--bg)");
  previousView.replaceWith(view);
  const isCurrent = () => epoch === renderEpoch && currentRoute() === name && document.getElementById("view") === view;

  if (await redirectFinishedArenaSpectator(name, expectedHash)) return;
  if (!isCurrent()) return;

  let matched = false;
  document.querySelectorAll("#tabbar a").forEach((a) => {
    const on = a.dataset.route === name;
    if (on) matched = true;
    a.classList.toggle("on", on);
  });
  document.getElementById("more-btn")?.classList.toggle("on", !matched);
  syncTabIndicator();

  view.innerHTML = loading();
  try {
    const mod = await routes[name]();
    if (!isCurrent()) return;
    if (typeof mod.leave === "function") leaving = mod.leave;
    await mod.render(view);
    if (!isCurrent()) return;
    view.classList.remove("is-route-loading");
    document.body.classList.remove("route-loading");
    setRouteCanvas("var(--bg)");
    decorateDflSeasonCounts(view, name);
    spectatorArenaLinks(view, name);
    if (name === "profile") {
      import("./profile-commissioner.js")
        .then((m) => m.decorateCommissionerBadge(view))
        .catch(() => {});
    }
  } catch (err) { if (isCurrent()) { view.classList.remove("is-route-loading"); document.body.classList.remove("route-loading"); setRouteCanvas("var(--bg)"); view.innerHTML = errorBox(err); } }

  if (!isCurrent()) return;

  window.scrollTo(0, 0);
  lastAnimated = name;
  if (changed) {
    view.classList.remove("page-switching");
    void view.offsetWidth;
    view.classList.add("page-in");
  }
  for (const fn of listeners) { try { fn(name); } catch (err) { console.warn(err); } }
}

let lastAnimated = null;
export function startRouter() {
  ensureSportsbookNav();
  startMemberLock();
  const bar = document.getElementById("tabbar");
  bar?.addEventListener("pointerdown", (event) => {
    const target = event.target.closest("a[data-route]");
    if (target) setTabIndicatorTarget(target);
  }, { passive: true });
  window.addEventListener("resize", syncTabIndicator);
  window.addEventListener("hashchange", renderRoute);
  if (!location.hash) location.hash = "#/home";
  else renderRoute();
}

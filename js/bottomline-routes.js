// =====================================================================
// bottomline-routes.js - where the BottomLine is allowed to appear
// ---------------------------------------------------------------------
// One rule, on its own, for two reasons: it is the part of the ticker with
// no DOM and no database in it, and it is the part most likely to be wrong -
// a strip that covers a scorecard somebody is tapping between holes is worse
// than no strip at all. Separate module, so it can be tested directly.
// =====================================================================

/*
  Broadcast: the stage IS the screen, and an OBS capture must not have a
  ribbon in it. Arena: a live race. Admin: a work screen.
*/
const SUPPRESS = new Set(["broadcast", "arena", "admin"]);

/**
 * Should the BottomLine be drawn on this route?
 *
 * @param {string} route  the router's name for the page
 * @param {string} [hash] location.hash, because Golf's state lives in it
 */
export function suppressedOn(route, hash = "") {
  if (SUPPRESS.has(route)) return true;
  /*
    Golf is suppressed only on a FOCUSED surface, not on the golf list. The
    hash carries what is open: `#/golf?id=..&match=..` is a match control
    screen and `?id=..&team=..` is a team scorecard. The event page itself
    (`?id=..` alone) is a normal page and keeps the strip.
  */
  if (route === "golf") {
    const qs = new URLSearchParams(String(hash).split("?")[1] || "");
    if (qs.get("match") || qs.get("team")) return true;
  }
  return false;
}

/* =====================================================================
   arena/racer-view.js - what a racer looks like, in one place.
   ---------------------------------------------------------------------
   THE PROBLEM THIS EXISTS FOR.

   There are two ways to watch an Arena race - the event page's own stage
   and the shared /broadcast viewer - and until now each built its own
   racer markup. Same structure, two class namespaces, two copies:

     arena.js       .lane   > .runner    > .runner-art    + .lane-tag
     broadcast.js   .bc-lane> .bc-runner > .bc-runner-art + .bc-lane-name

   Nothing kept them in step, so they drifted, and the drift was invisible
   until somebody watched the same race twice. The worst instance: the
   Arena loop guarded its position write with `if (!pixi)` and the
   broadcast did not, so on the Arena every name tag froze at the start
   line while the racers ran off without them.

   One emitter now builds both. The class PREFIX is still a parameter,
   because a few hundred lines of `.bc-` CSS depend on those names and
   renaming them is a separate job from removing the duplication - but the
   structure, the order of the layers, the sprite call and the name tag
   are decided here and only here.

   THE NAME TAG IS THE FALLBACK, NOT THE PLATE.

   When Pixi mounts it draws the nameplate itself, on the canvas, pinned to
   the actor - which is the only way a label can track a racer exactly. The
   DOM tag below is what shows when Pixi could not start. Exactly one is
   ever visible; see the `.has-pixi-race` rules in broadcast.css.
   ===================================================================== */

import { esc } from "../ui.js";
import { spriteMarkup } from "./sprites.js";
/* The course band, from the same module Pixi reads it from. The DOM lanes
   and the canvas actors have to agree about where the ground is, or one of
   the two renderers puts racers in the sky. See src/arena/viewport.ts. */
import { LANE_BAND_TOP, LANE_BAND_BOTTOM } from "./pixi-runtime-finish.js";

/**
 * One lane, with its racer.
 *
 * @param {object}  racer   {name, number, color, sprite, image, pet}
 * @param {number}  index   lane index, 0 based
 * @param {number}  count   how many lanes
 * @param {object}  opts    {prefix, theme, id}
 */
export function racerLane(racer, index, count, { prefix = "", theme = "", id = "" } = {}) {
  const lane   = prefix ? `${prefix}-lane` : "lane";
  const runner = prefix ? `${prefix}-runner` : "runner";
  const art    = prefix ? `${prefix}-runner-art` : "runner-art";
  /* The two name classes are NOT interchangeable to the stylesheets yet,
     so the caller's namespace picks one - but only one tag is emitted and
     only one rule set styles it, which is the part that was duplicated. */
  const tag    = prefix ? `${prefix}-lane-name` : "lane-tag";
  const laneY  = ((LANE_BAND_TOP + ((index + 0.5) / count) * (LANE_BAND_BOTTOM - LANE_BAND_TOP)) * 100).toFixed(2);

  return `
    <div class="${lane}" style="--lane:${index};--lanes:${count};--lane-y:${laneY}%">
      <div class="${runner} trail-${esc(racer.pet?.trail || "none")}"${id ? ` id="${id}"` : ""}>
        <div class="${art}" style="--racer:${esc(racer.color)};--pet-accent:${esc(racer.pet?.accent || "#ffffff")}">
          ${spriteMarkup(theme, racer.sprite, racer.color, racer.image, racer.pet)}
        </div>
        <span class="${tag}" style="--racer:${esc(racer.color)}"><b>${racer.number}</b>${esc(racer.name)}</span>
      </div>
    </div>`;
}

/** Every lane, in order. */
export function racerLanes(racers, opts = {}) {
  return racers
    .map((racer, i) => racerLane(racer, i, racers.length, {
      ...opts,
      id: opts.idPrefix ? `${opts.idPrefix}${i}` : "",
    }))
    .join("");
}

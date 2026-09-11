/* =====================================================================
   marquee.js - THE DFL BROADCAST LAYER
   ---------------------------------------------------------------------
   The fight-poster voice, in one place, so Golf, Arena and a championship
   moment can all sound like the same league rather than three apps.

   It builds one block: a billing bar, two sides with their figures, and a
   line that says what is happening in words. That is the whole vocabulary,
   and it is meant to stay that small.

   IT DERIVES NOTHING AND CALCULATES NOTHING.

   Every figure handed to marquee() has already been worked out by whatever
   owns the rules - golf-battle.js for a golf match, and it will be the
   race for Arena. This module chooses WORDS for a margin that has already
   been decided somewhere else. Golf scoring is not touched by anything in
   here, and it must stay that way: the day this file starts doing
   arithmetic is the day the poster can disagree with the scorecard.
   ===================================================================== */

import { esc } from "./ui.js";

/*
  THE STATUS VOCABULARY.

  Ordered hardest to softest, and every step is a real threshold rather
  than a mood somebody felt. The two beatdown numbers are NOT new: they are
  the thresholds golf-matches.js already used to print "BEATDOWN" on a
  finished battle (5 holes in match play, 8 strokes in stroke play), lifted
  here so the board and the poster cannot disagree about what a beatdown is.
*/
const BEATDOWN = { match: 5, strokes: 8 };

/**
 * What to call a lead.
 *
 * @param {number}  lead      how far ahead the leader is, already computed
 * @param {"match"|"strokes"} scoring
 * @param {boolean} complete  is it over
 * @param {boolean} started   has anybody posted anything
 * @param {object}  [where]   {thru, holes} - only needed for the wire
 * @returns {{text:string, tone:"hot"|"level"|"done"|""}}
 */
export function mood(lead, scoring = "strokes", complete = false, started = true, { thru = 0, holes = 0 } = {}) {
  if (!started) return { text: "", tone: "" };
  const big = BEATDOWN[scoring === "match" ? "match" : "strokes"];

  if (complete) {
    if (!lead) return { text: "DEAD EVEN", tone: "level" };
    if (lead >= big) return { text: "ABSOLUTE BEATDOWN", tone: "done" };
    /* WINNER rather than FINAL. FINAL is a state and the billing bar already
       carries it; this line is the one that says something happened. The
       margin is not repeated here because the line underneath is
       standingLine() and already reads "won 4&3" / "won by 6". */
    return { text: "WINNER", tone: "done" };
  }

  if (!lead) return { text: "DEAD EVEN", tone: "level" };
  /*
    DOWN TO THE WIRE, and it needs BOTH halves to be true: close, and nearly
    over. A one-shot lead on the 2nd is not the wire, it is the 2nd - which
    is why this takes the hole count rather than guessing from the margin.
  */
  if (holes && thru >= holes - 2 && lead <= 1) return { text: "DOWN TO THE WIRE", tone: "hot" };
  if (lead >= big) return { text: "ABSOLUTE BEATDOWN", tone: "hot" };
  /* The three live steps are proportions of the same threshold rather than
     four more magic numbers, so changing what a beatdown is moves the whole
     ladder with it. */
  if (lead >= Math.ceil(big * 0.55)) return { text: "RUNNING AWAY WITH IT", tone: "hot" };
  if (lead >= Math.ceil(big * 0.28)) return { text: "TAKING CONTROL", tone: "hot" };
  return { text: "WITHIN STRIKING DISTANCE", tone: "level" };
}

/*
  THE DAY'S MOOD, as opposed to a single battle's.

  Moved here from pages/home.js golfMood(), unchanged, because that file's
  hero is being replaced by the stage and this vocabulary should not go with
  it. It belongs beside mood() anyway: same job, different scope - mood()
  reads one match, this reads a whole day's team points.

  Still only ever derived from a real number. A beatdown has to actually be
  a beatdown, and a day nobody has finished a match in says nothing at all.
*/
export function dayMood(values, done, total) {
  const gap = Math.abs((values?.[0] ?? 0) - (values?.[1] ?? 0));
  if (!done) return "";
  if (done === total) {
    return gap >= 4 ? "ABSOLUTE BEATDOWN" : gap === 0 ? "SPLIT DOWN THE MIDDLE" : "";
  }
  if (gap >= 3) return "RUNNING AWAY WITH IT";
  if (gap === 0) return "DEAD EVEN";
  return "";
}

/**
 * The block.
 *
 * @param {object}   o
 * @param {string[]} o.billing  ["ROUND 2", "2V2"] - short, uppercase
 * @param {boolean}  o.main     is this THE match on the card
 * @param {boolean}  o.live
 * @param {boolean}  o.final
 * @param {Array<{name:string, score:string|number, colour?:string, down?:boolean, up?:boolean}>} o.sides
 * @param {string}   o.mood     the status headline
 * @param {string}   o.tone     hot | level | done
 * @param {string}   o.where    "THRU 7" / "HOLE 4" - the small line under it
 */
export function marquee({ billing = [], main = false, live = false, final = false, sides = [], mood: moodText = "", tone = "", where = "" }) {
  /* MAIN EVENT is a flag, not a position. Deciding it by index made whatever
     happened to be first - ROUND 1 - wear the crest red on every other card. */
  const tags = [
    main ? `<span class="mq-tag is-main">Main event</span>` : "",
    ...billing.filter(Boolean).map((b) => `<span class="mq-tag">${esc(b)}</span>`),
    live ? `<span class="mq-tag is-live">Live</span>` : "",
    final ? `<span class="mq-tag is-final">Final</span>` : "",
  ].filter(Boolean).join("");

  const tape = sides.map((s) => `
    <div class="mq-side ${s.down ? "is-down" : ""} ${s.up ? "is-up" : ""}"${s.colour ? ` style="--racer:${esc(s.colour)}"` : ""}>
      <span class="mq-side-score">${esc(s.score)}</span>
      <span class="mq-side-name">${esc(s.name)}</span>
      <span class="mq-side-bar"></span>
    </div>`).join(`<div class="mq-vs">vs</div>`);

  return `
    <section class="mq-card dfl-mark">
      ${tags ? `<div class="mq-billing">${tags}</div>` : ""}
      <div class="mq-tape">${tape}</div>
      ${moodText || where ? `
        <div class="mq-status">
          ${moodText ? `<span class="mq-mood is-${esc(tone || "done")}">${esc(moodText)}</span>` : ""}
          ${where ? `<span class="mq-where">${esc(where)}</span>` : ""}
        </div>` : ""}
    </section>`;
}

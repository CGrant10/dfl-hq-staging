// Finish-line presentation hotfix.
//
// The committed Pixi runtime contains two finish helpers that make races look
// cleaner in a generic animation, but they are wrong for DFL's race model:
//   1. the finish structure eases into place before P1 crosses; and
//   2. presentationRacerFrame() rewrites each racer's final stretch so they
//      are pulled toward their official finish time.
//
// That second correction is the hidden accordion. Even when physics has real
// gaps, the renderer visually drags every lane toward 1.0 before its finish.
// DFL wants the opposite: show the recorded race exactly as simulated, then
// let the post-P1 clear move that frozen field shape through the stripe.

export * from "./pixi-runtime.js?finish-base=1";
import {
  createFinishPresentation as createBaseFinishPresentation,
  presentationRacerFrame as createBaseRacerFrame,
} from "./pixi-runtime.js?finish-base=1";

const FINISH_ENTRY_RATIO = 1.02;
const FINISH_LINE_RATIO = 0.58;
const FINISH_ROLL_MS = 3500;

const clamp01 = (value) => Math.max(0, Math.min(1, value));

export function presentationRacerFrame(input) {
  // Passing no official finish disables the base runtime's late interpolation
  // toward 1.0. The samples already contain the true deterministic crossing,
  // and presentFinish() still handles the run-through after that crossing.
  return createBaseRacerFrame({ ...input, officialFinishMs: null });
}

export function createFinishPresentation(input) {
  const finish = createBaseFinishPresentation(input);
  const firstFinishMs = Number(input?.order?.[0]?.finishMs);
  const elapsedMs = Number(input?.elapsedMs);

  if (!Number.isFinite(firstFinishMs) || !Number.isFinite(elapsedMs)) return finish;

  // Constant velocity all the way to P1's actual crossing. The stripe never
  // eases into a parking spot and never sits in the frame while the ground
  // continues sliding underneath it.
  const startMs = firstFinishMs - FINISH_ROLL_MS;
  const arrival = clamp01((elapsedMs - startMs) / FINISH_ROLL_MS);
  finish.groundRatio = FINISH_ENTRY_RATIO
    + (FINISH_LINE_RATIO - FINISH_ENTRY_RATIO) * arrival;

  // Whole-field finish camera. The instant P1 crosses, both the stripe and the
  // world stop translating. Every later racer therefore crosses a stationary
  // line against stationary course scenery while their own motion stays live.
  finish.courseStopped = elapsedMs >= firstFinishMs;

  return finish;
}

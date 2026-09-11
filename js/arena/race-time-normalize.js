// DFL Arena wall-clock normalization.
// The dramatic story simulation runs on a deliberately longer internal course.
// This remaps that recording onto the human-requested watch time without
// changing order, relative lead changes, or the post-winner run-through.

const TICK_MS = 40;

function lerp(a, b, t) { return a + (b - a) * t; }

export function normalizeRaceTime(sim, requestedTicks) {
  const targetTicks = Math.max(1, Number(requestedTicks) || 1);
  const winnerMs = Number(sim?.order?.[0]?.finishMs);
  if (!sim?.samples?.length || !Number.isFinite(winnerMs) || winnerMs <= 0) return sim;

  const targetWinnerMs = targetTicks * TICK_MS;
  const scale = targetWinnerMs / winnerMs;
  if (!Number.isFinite(scale) || scale <= 0) return sim;

  const sourceFrames = Math.max(0, Number(sim.frames) || 0);
  const frames = Math.max(targetTicks + 1, Math.ceil(sourceFrames * scale));
  const samples = sim.samples.map((src) => {
    const out = new Float32Array(frames + 1);
    const maxSrc = Math.max(0, src.length - 1);
    for (let t = 0; t <= frames; t++) {
      const sourceTick = Math.min(maxSrc, t / scale);
      const lo = Math.floor(sourceTick);
      const hi = Math.min(maxSrc, lo + 1);
      out[t] = lerp(Number(src[lo]) || 0, Number(src[hi]) || 0, sourceTick - lo);
    }
    return out;
  });

  const order = sim.order.map((row) => ({
    ...row,
    finishMs: Math.round(Number(row.finishMs || 0) * scale),
  }));

  return {
    ...sim,
    samples,
    order,
    ticks: targetTicks,
    frames,
    finishTick: (Number(sim.finishTick) || 0) * scale,
    timeScale: scale,
  };
}

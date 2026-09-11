/* Shared paper-scorecard vocabulary. Kept side-effect free so lightweight
   scoring views can reuse the marks without mounting a full scorecard. */
export function holeResult(score, par) {
  const strokes = Number(score);
  if (!strokes) return { mark: "m-none", cls: "result-empty", label: "—" };
  const difference = strokes - Number(par);
  if (difference <= -2) return { mark: "m-eagle", cls: "result-eagle", label: "EAGLE" };
  if (difference === -1) return { mark: "m-birdie", cls: "result-birdie", label: "BIRDIE" };
  if (difference === 0) return { mark: "m-par", cls: "result-par", label: "PAR" };
  if (difference === 1) return { mark: "m-bogey", cls: "result-bogey", label: "BOGEY" };
  if (difference === 2) return { mark: "m-dbl", cls: "result-double", label: "DOUBLE" };
  return { mark: "m-dbl", cls: "result-double", label: `+${difference}` };
}

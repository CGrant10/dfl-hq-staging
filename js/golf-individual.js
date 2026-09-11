const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export const individualMatchLabel = (count) => {
  const size = Math.max(0, Number(count) || 0);
  return size >= 2 ? Array.from({ length: size }, () => "1").join("v") : "Individual match";
};

export function individualResult(maps, holes = 9) {
  const count = Math.max(1, Number(holes) || 9);
  const sides = maps.map((map, index) => {
    let total = 0;
    let posted = 0;
    for (let hole = 1; hole <= count; hole += 1) {
      const strokes = number(map?.get?.(hole));
      if (!strokes) continue;
      total += strokes;
      posted += 1;
    }
    return { index, total, posted, complete: posted === count };
  });
  const complete = sides.length >= 2 && sides.every((side) => side.complete);
  const best = complete ? Math.min(...sides.map((side) => side.total)) : null;
  const leaders = best == null ? [] : sides.filter((side) => side.total === best).map((side) => side.index);
  return { holes: count, sides, complete, leaders, tied: complete && leaders.length > 1 };
}

export function individualStanding(result, names) {
  if (!result.complete) {
    const finished = result.sides.filter((side) => side.complete).length;
    return finished ? `${finished} of ${result.sides.length} cards complete` : "Individual scorecards open";
  }
  const winners = result.leaders.map((index) => names[index] || `Player ${index + 1}`);
  return result.tied ? `${winners.join(" & ")} tied for the win` : `${winners[0]} wins`;
}

export function capHoleDistance(distance, holeYards) {
  if (distance == null || distance === "") return null;
  const measured = Number(distance);
  const maximum = Number(holeYards);
  if (!Number.isFinite(measured) || measured < 0) return null;
  return Number.isFinite(maximum) && maximum > 0 ? Math.min(measured, maximum) : measured;
}

export function isOutsideHole(distance, holeYards) {
  if (distance == null || distance === "") return false;
  const measured = Number(distance);
  const maximum = Number(holeYards);
  return Number.isFinite(measured) && Number.isFinite(maximum) && maximum > 0 && measured > maximum * 1.35;
}

export function holeZoom(distance) {
  const yards = Number(distance);
  if (!Number.isFinite(yards)) return 18;
  if (yards <= 60) return 20;
  if (yards <= 140) return 19;
  if (yards <= 280) return 18;
  return 17;
}

export function distanceYards(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every(Number.isFinite)) return null;
  const radius = 6371000;
  const radians = value => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * radius * Math.asin(Math.sqrt(haversine)) * 1.0936133);
}

export function nearestTeeHole(point, tees, maximumYards = 140) {
  let nearest = null;
  for (const [hole, tee] of Object.entries(tees || {})) {
    const distance = distanceYards(point, tee);
    if (distance == null || (nearest && distance >= nearest.distance)) continue;
    nearest = { hole: Number(hole), distance };
  }
  return nearest && nearest.distance <= maximumYards ? nearest : null;
}

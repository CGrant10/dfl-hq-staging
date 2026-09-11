export function recommendClub(rows, distance) {
  const target = Number(distance);
  if (!Number.isFinite(target) || target <= 0) return null;
  const clubs = (rows || [])
    .map(row => ({ club: String(row?.club || "").trim(), yards: Number(row?.yards) }))
    .filter(row => row.club && Number.isFinite(row.yards) && row.yards > 0);
  if (!clubs.length) return null;
  return clubs.reduce((best, club) => {
    const gap = Math.abs(club.yards - target), bestGap = Math.abs(best.yards - target);
    if (gap !== bestGap) return gap < bestGap ? club : best;
    return club.yards >= best.yards ? club : best;
  });
}

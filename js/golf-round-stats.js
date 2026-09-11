export function roundDetailStats(rows = []) {
  const scored = rows.filter(row => Number(row?.strokes) > 0);
  const putts = scored.reduce((sum, row) => sum + (Number(row?.putts) || 0), 0);
  const drops = scored.reduce((sum, row) => sum + (Number(row?.drops ?? row?.drop_shots) || 0), 0);
  return {
    holes: scored.length,
    putts,
    drops,
    averagePutts: scored.length ? putts / scored.length : 0,
    tracked: scored.some(row => Number(row?.putts) > 0 || Number(row?.drops ?? row?.drop_shots) > 0),
  };
}

export const averagePuttsLabel = value => Number(value || 0).toFixed(1);

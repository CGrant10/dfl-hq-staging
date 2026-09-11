/* Pick the next two teams for a hand-built match.

   A tournament may have more than two teams even though one golf match still
   has exactly two sides. Prefer the pair used least often, then the teams
   with the fewest total appearances. That gives a three-team field A-B,
   A-C, B-C before repeating instead of quietly using A-B forever. */
export function nextTeamPair(teams, battles = []) {
  const ids = (teams || []).map((team) => String(team.id));
  if (ids.length < 2) return [];

  const pairUses = new Map();
  const teamUses = new Map(ids.map((id) => [id, 0]));
  for (const battle of battles || []) {
    const pair = (battle?.sides || []).map((side) => String(side.team_id)).sort();
    if (pair.length !== 2 || pair[0] === pair[1]) continue;
    const key = pair.join(":");
    pairUses.set(key, (pairUses.get(key) || 0) + 1);
    for (const id of pair) teamUses.set(id, (teamUses.get(id) || 0) + 1);
  }

  const choices = [];
  for (let a = 0; a < ids.length - 1; a += 1) {
    for (let b = a + 1; b < ids.length; b += 1) {
      const pair = [ids[a], ids[b]];
      choices.push({
        pair,
        pairUses: pairUses.get([...pair].sort().join(":")) || 0,
        totalUses: (teamUses.get(pair[0]) || 0) + (teamUses.get(pair[1]) || 0),
        maxUses: Math.max(teamUses.get(pair[0]) || 0, teamUses.get(pair[1]) || 0),
        order: a * ids.length + b,
      });
    }
  }
  choices.sort((x, y) => x.pairUses - y.pairUses
    || x.totalUses - y.totalUses
    || x.maxUses - y.maxUses
    || x.order - y.order);
  return choices[0]?.pair || [];
}

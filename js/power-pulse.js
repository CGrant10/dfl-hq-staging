import { esc } from "./ui.js";
import { REGULAR_SEASON_WEEKS, projectSeason } from "./season-outlook.js";

const teamName = team => team?.team_name || team?.ownerName || `Team ${team?.roster_id || ""}`;
const signed = value => value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "EVEN";

function comparisonRows(standings, season) {
  const all = (standings || []).filter(row => row?.sleeper_user_id && Number(row.rank) > 0);
  const current = all.filter(row => Number(row.season) === Number(season) && Number(row.wins || 0) + Number(row.losses || 0) + Number(row.ties || 0) > 0);
  if (current.length) return { rows: current, label: "VS STANDINGS" };
  const previousSeason = Math.max(...all.map(row => Number(row.season)).filter(value => value < Number(season)));
  return Number.isFinite(previousSeason)
    ? { rows: all.filter(row => Number(row.season) === previousSeason), label: `VS ${previousSeason}` }
    : { rows: [], label: "PRESEASON" };
}

/** Turn the Analyzer's ranking into the small, honest Home summary. */
export function powerPulseView({ analysis, meSleeperId = null, standings = [] } = {}) {
  if (analysis?.state !== "ready" || !analysis.teams?.length) return null;
  const teams = analysis.teams;
  const focus = teams.find(team => meSleeperId && String(team.sleeper_user_id) === String(meSleeperId)) || teams[0];
  const comparison = comparisonRows(standings, analysis.projectionSeason);
  const baseline = new Map(comparison.rows.map(row => [String(row.sleeper_user_id), Number(row.rank)]));
  const scores = teams.map(team => Number(team.lineup?.score || 0));
  const low = Math.min(...scores), high = Math.max(...scores);
  const ratings = Object.fromEntries(teams.map(team => {
    const score = Number(team.lineup?.score || 0);
    const rating = high === low ? 100 : 78 + ((score - low) / (high - low)) * 22;
    return [team.id, rating.toFixed(1)];
  }));
  const movement = team => {
    const oldRank = baseline.get(String(team.sleeper_user_id));
    return Number.isFinite(oldRank) ? oldRank - Number(team.rank) : null;
  };
  /*
    A PROJECTED RECORD BEATS A BIGGEST MOVER.

    "Biggest riser" answered a question nobody asked on the home page - it was
    about somebody else's team, measured against last season's standings, and
    it went stale the moment the model settled. What a manager wants at a
    glance is where their own season is heading.
  */
  const projections = projectSeason({
    teams: teams.map(team => ({ id: String(team.id), mean: team.lineup?.weeklyPoints })),
    playoffTeams: Number(analysis.league?.playoff_teams) || 8,
  });
  const record = projections.get(String(focus.id)) || null;
  return {
    record,
    weeks: REGULAR_SEASON_WEEKS,
    season: analysis.projectionSeason,
    teams: teams.slice(0, 5),
    focus,
    movement: movement(focus),
    movementLabel: comparison.label,
    ratings,
  };
}

export function powerPulseShell(season = null) {
  return `<section class="block season-field power-pulse" data-power-pulse>
    <div class="card pp-card pp-loading" aria-busy="true">
      <div><strong>POWER PULSE</strong><span>${season ? `${esc(String(season))} MODEL` : "BUILDING MODEL"}</span></div>
      <p>Reading every roster and current projection…</p>
    </div>
  </section>`;
}

export function powerPulseCard(view) {
  if (!view?.teams?.length) return "";
  const focusHref = view.focus.sleeper_user_id
    ? `#/analyzer?owner=${encodeURIComponent(view.focus.sleeper_user_id)}`
    : `#/analyzer?team=${encodeURIComponent(view.focus.id)}`;
  const focusMovement = view.movement == null ? "NEW MODEL" : `${signed(view.movement)} ${view.movementLabel}`;
  const record = view.record;
  return `<div class="card pp-card">
    <header class="pp-head"><div><svg class="ico-sm" aria-hidden="true"><use href="#i-record"></use></svg><strong>POWER PULSE</strong></div><span>${esc(String(view.season || "CURRENT"))} MODEL</span></header>
    <div class="pp-body">
      <div class="pp-focus"><small>YOUR POWER RANK</small><strong>#${esc(String(view.focus.rank))}</strong><span>${esc(focusMovement)}</span></div>
      <ol class="pp-ranks">${view.teams.map(team => `<li class="${team.id === view.focus.id ? "is-me" : ""}"><b>${esc(String(team.rank))}</b><span>${esc(teamName(team))}</span><strong>${esc(view.ratings?.[team.id] || "—")}</strong></li>`).join("")}</ol>
      <div class="pp-record">
        <small>PROJECTED RECORD</small>
        <strong>${record ? `${record.wins}-${record.losses}` : "—"}</strong>
        <span>${record
          ? `${Math.round(record.playoffOdds * 100)}% playoffs · ${Math.round(record.titleOdds * 100)}% title`
          : `over ${view.weeks} weeks`}</span>
      </div>
    </div>
    <footer class="pp-foot"><p><svg class="ico-sm" aria-hidden="true"><use href="#i-moment"></use></svg><span><strong>${esc(view.focus.strength || "Roster")} is the best unit</strong> · ${view.focus.need ? `${esc(view.focus.need)} is the clearest starting need` : "no urgent starting-lineup need"}</span></p><a class="btn ghost small" href="${focusHref}">Open Team Analyzer</a></footer>
  </div>`;
}

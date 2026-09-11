import { db } from "./supabase.js";
import { loadMarketAdp, loadPlayers, loadSeasonStats } from "./sleeper.js";
import { scoringFormat } from "./dfl-scoring.js";
import { analyzeLeague, buildPlayerPool } from "./team-analyzer.js";

/**
 * The shared wire behind Team Analyzer and Home's Power Pulse.
 *
 * Keeping this in one place matters: Home must never show a different power
 * order from the full report. Sleeper's large player/projection payloads are
 * cached by sleeper.js, and Home calls this only after its useful shell has
 * already painted.
 */
export async function loadAnalyzerData() {
  const [leagueRes, rosterRes, memberRes] = await Promise.all([
    db().from("sleeper_leagues").select("season,status,scoring_settings,playoff_teams,synced_at").order("season", { ascending: false }).limit(1),
    db().from("sleeper_rosters").select("season,roster_id,sleeper_user_id,players,starters,team_name,display_name,synced_at").order("season", { ascending: false }),
    db().from("members").select("id,display_name,team_name,sleeper_user_id,active"),
  ]);
  const error = leagueRes.error || rosterRes.error || memberRes.error;
  if (error) throw error;
  const league = leagueRes.data?.[0] || null;
  const allRosters = rosterRes.data || [];
  const seasons = [...new Set(allRosters.map(row => Number(row.season)).filter(Number.isFinite))].sort((a, b) => b - a);
  const rosterSeason = seasons.find(season => allRosters.filter(row => Number(row.season) === season && row.players?.length).length >= 2);
  const rosters = allRosters.filter(row => Number(row.season) === rosterSeason && row.players?.length);
  if (!league || !rosters.length) return { state: "empty", league, rosterSeason };

  const members = memberRes.data || [];
  const bySleeper = new Map(members.filter(member => member.sleeper_user_id).map(member => [String(member.sleeper_user_id), member]));
  const namedRosters = rosters.map(roster => {
    const member = bySleeper.get(String(roster.sleeper_user_id));
    return {
      ...roster,
      ownerName: roster.display_name || member?.display_name || "Unassigned owner",
      team_name: roster.team_name || member?.team_name || roster.display_name || member?.display_name || `Team ${roster.roster_id}`,
    };
  });
  const projectionSeason = Number(league.season) || rosterSeason;
  const format = scoringFormat(league.scoring_settings);
  const [players, statsRes, projectionRes] = await Promise.all([
    loadPlayers(),
    loadSeasonStats(projectionSeason - 1).catch(() => ({ data: {}, fetchedAt: 0 })),
    loadMarketAdp(projectionSeason, format).catch(() => ({ data: [], fetchedAt: 0 })),
  ]);
  const pool = buildPlayerPool({
    rosters: namedRosters,
    players,
    previousStats: statsRes.data || {},
    projections: projectionRes.data || [],
    scoringSettings: league.scoring_settings || {},
    scoringFormat: format,
  });
  const teams = analyzeLeague({ rosters: namedRosters, pool });
  return {
    state: teams.length ? "ready" : "empty",
    league, rosterSeason, projectionSeason, teams, pool,
    projectionUpdatedAt: projectionRes.fetchedAt || 0,
    productionUpdatedAt: statsRes.fetchedAt || 0,
  };
}

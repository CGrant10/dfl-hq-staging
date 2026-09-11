import { esc, errorBox } from "../ui.js";
import { currentMember } from "../members.js";
import { ANALYZER_UNITS, compareTeams } from "../team-analyzer.js";
import { loadAnalyzerData } from "../team-analyzer-data.js";
import { HISTORY_SEASONS, wireTrendPanel } from "../trend-panel.js";
import { LEAGUE_WEEKLY_SD, REGULAR_SEASON_WEEKS, outlookSentence, projectSeason } from "../season-outlook.js";
import { buildFindings } from "../analyzer-findings.js";

const ordinal = value => {
  const n = Number(value), mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`;
};
const teamName = team => team?.team_name || team?.ownerName || `Team ${team?.roster_id || ""}`;

const stat = (value, digits = 1) => value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(digits);
const rankText = (rank, total) => rank ? `#${rank}${total ? ` / ${total}` : ""}` : "—";
const gradeTone = value => String(value || "").startsWith("A") ? "elite" : String(value || "").startsWith("B") ? "good" : String(value || "").startsWith("C") ? "average" : "weak";
const trendLabel = trend => ({ up: "Trending up", down: "Trending down", steady: "Steady", new: "New outlook" }[trend] || "Steady");

/*
  THE BRIEFING.

  This was reportHeader(): three grade cards, four KPIs and a top asset, at
  eight numbers of identical size with no headline among them. It answered
  "how good is my QB unit" fine and "is my team any good, and what is wrong
  with it" not at all - the reader had to rank the eight themselves.

  So the page opens by saying what it found. One grade at size, one sentence,
  and the four findings analyzer-findings.js ranked, each carrying the figure
  that supports it and a link to the table it came out of. The tables are all
  still below, complete and unchanged: this is a route into the report, not a
  replacement for it, and nothing here is a claim the evidence cannot back.
*/
const TONE_MARK = { good: "↑", bad: "↓", warn: "!", neutral: "=" };

/*
  A FINDING'S LINK IS A BUTTON WHEN IT STAYS ON THIS PAGE.

  The app is hash-routed, so an <a href="#units"> would not scroll anywhere -
  it would set location.hash and send the router to a route called "units".
  Only the cross-route actions (#/trade) are real anchors; the rest are
  buttons that scroll, and open the section first if it is folded.
*/
function findingAction(action) {
  if (!action) return "";
  if (action.href.startsWith("#/")) return `<a class="ta-finding-go" href="${esc(action.href)}">${esc(action.label)} &rarr;</a>`;
  return `<button type="button" class="ta-finding-go" data-ta-jump="${esc(action.href.slice(1))}">${esc(action.label)} &rarr;</button>`;
}

function briefing(team, teams, projections, count) {
  const { verdict, findings } = buildFindings({ team, teams, projections });
  const jumps = [["units", "Units"], ["roster", "Roster"], ["outlook", "Outlook"], ["compare", "Compare"], ["trends", "Trends"], ["league", "League"]];
  return `<section class="ta-brief">
    <span class="ta-brief-eyebrow">Team report</span>
    <h2>${esc(teamName(team))}</h2>
    <div class="ta-brief-verdict is-${gradeTone(team.overallGrade)}">
      <b>${esc(team.overallGrade)}</b>
      <div>
        <small>Overall roster &middot; ${ordinal(team.overallRank)} of ${count}</small>
        <span>${esc(verdict)}</span>
      </div>
    </div>
    ${findings.length ? `<div class="ta-findings">${findings.map(finding => `
      <article class="ta-finding is-${esc(finding.tone)}">
        <i aria-hidden="true">${TONE_MARK[finding.tone] || "="}</i>
        <div>
          <strong>${esc(finding.title)}</strong>
          <p>${esc(finding.copy)}</p>
          ${findingAction(finding.action)}
        </div>
      </article>`).join("")}</div>`
      : `<p class="ta-inline-note">Not enough of the league has synced to report on this roster yet.</p>`}
    <nav class="ta-jump" aria-label="Jump to the evidence">
      ${jumps.map(([id, label]) => `<button type="button" data-ta-jump="${id}">${label}</button>`).join("")}
    </nav>
  </section>`;
}

/*
  A SECTION IS A <details>, AND TWO OF THEM START CLOSED.

  The report ran to eighteen screens on a phone. Density took a third off it;
  the rest has to come from not rendering everything expanded at once. The
  league table and the trade lab are the two longest and the two least often
  read - you open the analyzer to look at YOUR team - so they arrive folded
  with a one-line summary of what is inside. Everything else stays open,
  because the point of the page is still to answer questions without clicking.

  The aside sits in the BODY, never in the <summary>. A <select> inside a
  summary toggles the disclosure when you try to use it, which would make the
  compare and shop pickers unusable.
*/
function section(kicker, title, { aside = "", body = "", open = true, hint = "", id = "" } = {}) {
  return `<details class="ta-report-section"${id ? ` id="${id}"` : ""} ${open ? "open" : ""}>
    <summary class="ta-report-title">
      <div><small>${kicker}</small><h2>${title}</h2></div>
      ${hint ? `<span class="ta-fold-hint">${hint}</span>` : ""}
      <span class="ta-fold-chevron" aria-hidden="true"></span>
    </summary>
    <div class="ta-section-body">${aside}${body}</div>
  </details>`;
}

function positionReport(team) {
  return section("STARTING UNIT GRADES", "Position report", { open: true, id: "units",
    aside: `<span class="ta-inline-note">Five equally weighted starting units · depth shown separately</span>`,
    body: `<div class="ta-table-wrap"><table class="ta-table ta-position-table"><thead><tr><th>Pos</th><th>Grade</th><th>League</th><th>Starter score</th><th>Starting unit / depth</th></tr></thead><tbody>${ANALYZER_UNITS.map(position => {
    const group = team.positionGrades[position];
    const names = [...group.starters.map(player => ({ player, role: "Starts" })), ...group.depth.map(player => ({ player, role: "Depth" }))];
    return `<tr><td><b class="ta-pos">${position}</b></td><td data-label="Grade"><span class="ta-unit-grade is-${gradeTone(group.grade)}"><strong>${esc(group.grade)}</strong><i><span style="width:${Math.round(group.percentile * 100)}%"></span></i></span></td><td data-label="League">${rankText(group.leagueRank, group.leagueSize)}</td><td data-label="Starter score"><strong>${stat(group.score)}</strong></td><td data-label="Unit / depth"><div class="ta-player-run">${names.map(({ player, role }) => `<span class="${role === "Depth" ? "is-depth" : ""}"><b>${esc(player.name)}</b><small>${role} · ${stat(player.expectedPoints)} pts · ${rankText(player.positionRank, player.positionCount)}</small></span>`).join("") || `<span class="muted">No ${position}</span>`}</div></td></tr>`;
  }).join("")}</tbody></table></div>` });
}

function rosterReport(team, pool) {
  const starters = new Set(team.lineup.starters.map(player => player.id));
  const flexId = team.lineup.flexId;
  const ordered = [...team.lineup.starters, ...team.lineup.bench];
  return section("FULL ROSTER", "Player outlook", { open: true, id: "roster",
    hint: `${ordered.length} players`,
    aside: `<span class="ta-inline-note">Projection leads · prior production is pace-adjusted for games played</span>`,
    body: `<div class="ta-table-wrap"><table class="ta-table ta-roster-table"><thead><tr><th>Player</th><th>Role</th><th>Expected</th><th>Per game</th><th>Trend</th><th>Projection</th><th>Prior pace</th><th>Pos rank</th><th>Value</th></tr></thead><tbody>${ordered.map((player, index) => {
    const starting = starters.has(player.id);
    const role = starting ? (player.id === flexId ? "Flex" : "Starter") : "Bench";
    const divider = index === team.lineup.starters.length && team.lineup.bench.length ? `<tr class="ta-roster-divider"><td colspan="9">DEPTH · GRADED SEPARATELY FROM THE STARTING LINEUP</td></tr>` : "";
    return `${divider}<tr class="${starting ? "is-starter" : "is-bench"}"><td><div class="ta-player"><b>${esc(player.name)}</b><small>${esc(player.position)} · ${esc(player.nflTeam)}</small></div></td><td data-label="Role"><span class="ta-role">${role}</span></td><td data-label="Expected"><strong class="ta-expected">${stat(player.expectedPoints)}</strong></td><td data-label="Per game">${stat(player.expectedPerGame, 2)}</td><td data-label="Trend"><span class="ta-trend is-${esc(player.trend)}">${esc(trendLabel(player.trend))}</span></td><td data-label="Projection">${stat(player.projectedPoints)}</td><td data-label="Prior pace">${stat(player.priorPace)}</td><td data-label="Pos rank"><strong>${rankText(player.positionRank, player.positionCount)}</strong></td><td data-label="Value"><b class="ta-value">${player.tradeValue}</b></td></tr>`;
  }).join("")}</tbody></table></div>` });
}

function comparison(team, opponent, teams) {
  const result = compareTeams(team, opponent);
  const metrics = [
    ["Projected finish", ordinal(team.rank), ordinal(opponent.rank), team.rank < opponent.rank ? "a" : team.rank > opponent.rank ? "b" : ""],
    ["Starter grade", team.starterGrade, opponent.starterGrade, team.starterPercentile > opponent.starterPercentile ? "a" : team.starterPercentile < opponent.starterPercentile ? "b" : ""],
    ["Depth grade", team.depthGrade, opponent.depthGrade, team.depthPercentile > opponent.depthPercentile ? "a" : team.depthPercentile < opponent.depthPercentile ? "b" : ""],
    ["Overall roster", `${team.overallGrade} · ${ordinal(team.overallRank)}`, `${opponent.overallGrade} · ${ordinal(opponent.overallRank)}`, team.overallPercentile > opponent.overallPercentile ? "a" : team.overallPercentile < opponent.overallPercentile ? "b" : ""],
    ["Weekly points", stat(team.lineup.weeklyPoints), stat(opponent.lineup.weeklyPoints), result.weeklyEdge > 0 ? "a" : result.weeklyEdge < 0 ? "b" : ""],
    ["Starter points", stat(team.lineup.starterPoints), stat(opponent.lineup.starterPoints), team.lineup.starterPoints > opponent.lineup.starterPoints ? "a" : team.lineup.starterPoints < opponent.lineup.starterPoints ? "b" : ""],
    ...result.positions.map(row => [`${row.position} unit`, `${row.a.grade} · ${rankText(row.a.leagueRank)}`, `${row.b.grade} · ${rankText(row.b.leagueRank)}`, row.winner || ""]),
  ];
  const picker = `<label class="ta-inline-select"><span>Compare with</span><select data-ta-compare aria-label="Team to compare">${teams.filter(other => other.id !== team.id).map(other => `<option value="${esc(other.id)}" ${other.id === opponent.id ? "selected" : ""}>${esc(teamName(other))}</option>`).join("")}</select></label>`;
  return section("HEAD TO HEAD", "Team comparison", { open: true, id: "compare", aside: picker,
    body: `<div class="ta-compare-summary"><strong>${result.weeklyEdge === 0 ? "Even weekly projection" : `${teamName(result.weeklyEdge > 0 ? team : opponent)} leads by ${Math.abs(result.weeklyEdge).toFixed(1)} per week`}</strong><span>Positive lineup value is highlighted below.</span></div><div class="ta-table-wrap"><table class="ta-table ta-comparison-table"><thead><tr><th>Measure</th><th>${esc(teamName(team))}</th><th>${esc(teamName(opponent))}</th></tr></thead><tbody>${metrics.map(([label, a, b, winner]) => `<tr><td>${esc(label)}</td><td class="${winner === "a" ? "wins" : ""}">${esc(String(a))}</td><td class="${winner === "b" ? "wins" : ""}">${esc(String(b))}</td></tr>`).join("")}</tbody></table></div>` });
}

/*
  THE MARK ON A ROW IS A BADGE, NOT A STRIPE.

  A 3px accent bar down the side of one card said "something is different
  about this one" and left you to work out what. The row being read now
  carries a labelled chip instead - YOU when it is your own team, READING
  when you have clicked into somebody else's - so the highlight names itself
  and the card only needs a quiet tint to sit behind it.
*/
function rowMark(team, selectedId, myTeamId) {
  if (String(team.id) !== String(selectedId)) return "";
  const mine = myTeamId != null && String(team.id) === String(myTeamId);
  return `<span class="ta-mark ${mine ? "is-you" : ""}">${mine ? "YOU" : "READING"}</span>`;
}

function rankings(teams, selectedId, myTeamId) {
  return section("LEAGUE OUTLOOK", "Projected table", { open: true, id: "league",
    hint: `${teams.length} teams`,
    aside: `<span class="ta-inline-note">Grades read starters · depth · overall</span>`,
    body: `<div class="ta-table-wrap"><table class="ta-table ta-league-table is-compact"><thead><tr><th>Team</th><th>Weekly</th><th>Grades</th><th>Best unit</th><th>Need</th></tr></thead><tbody>${teams.map(team => `<tr class="${String(team.id) === String(selectedId) ? "is-current" : ""}"><td><button type="button" data-ta-team="${esc(team.id)}"><strong><span class="ta-seed">${team.rank}</span><span class="ta-name">${esc(teamName(team))}</span>${rowMark(team, selectedId, myTeamId)}</strong><small>${esc(team.ownerName)}</small></button></td><td data-label="Weekly">${stat(team.lineup.weeklyPoints)}</td><td data-label="Grades"><span class="ta-gradeset"><b class="is-${gradeTone(team.starterGrade)}" title="Starters">${esc(team.starterGrade)}</b><b class="is-${gradeTone(team.depthGrade)}" title="Depth">${esc(team.depthGrade)}</b><b class="is-${gradeTone(team.overallGrade)}" title="Overall">${esc(team.overallGrade)}</b></span></td><td data-label="Best unit">${esc(team.strength || "—")}</td><td data-label="Need">${esc(team.need || "No urgent need")}</td></tr>`).join("")}</tbody></table></div>` });
}

const pct = value => `${Math.round((Number(value) || 0) * 100)}%`;

/*
  WHAT THE ROSTER IS LIKELY TO BUY.

  Grades say how good a team is; this says what that tends to be worth - a
  record, a berth, a trophy, or the Chip Eater. Simulated rather than
  formula'd, on this league's own measured weekly spread. See
  season-outlook.js for why the schedule is random and the seed is fixed.
*/
function seasonOutlook(team, projections, teams) {
  const projection = projections.get(String(team.id));
  if (!projection) return "";
  const ranked = [...projections.entries()].sort((a, b) => b[1].titleOdds - a[1].titleOdds);
  const favourite = teams.find(t => String(t.id) === String(ranked[0]?.[0]));
  const chip = [...projections.entries()].sort((a, b) => b[1].lastOdds - a[1].lastOdds)[0];
  const chipTeam = teams.find(t => String(t.id) === String(chip?.[0]));
  const titleRank = ranked.findIndex(([id]) => String(id) === String(team.id)) + 1;

  return `<section class="so-panel" id="outlook">
    <header class="so-head">
      <div><small>SEASON OUTLOOK</small><h2>${esc(teamName(team))}</h2></div>
      <div class="so-record">
        <strong>${projection.wins}<i>-</i>${projection.losses}</strong>
        <span>projected · ${ordinal(Math.round(projection.seed))} of ${teams.length}</span>
      </div>
    </header>
    <div class="so-body">
      <p class="so-summary">${esc(outlookSentence(projection, ordinal(team.rank), teams.length))}</p>
      <p class="so-source">Sleeper projects <b>${stat(team.lineup.sleeperWeeklyPoints)}</b> a week from these starters${
        team.lineup.sleeperWeeklyPoints != null && team.lineup.weeklyPoints != null
          ? ` · this report uses <b>${stat(team.lineup.weeklyPoints)}</b>, blending that with last season's pace`
          : ""}${team.lineup.sleeperProjectedCount < team.lineup.starters.length
          ? ` · ${team.lineup.starters.length - team.lineup.sleeperProjectedCount} starter(s) unprojected` : ""}</p>
      <div class="so-odds">
        <div class="so-odd"><small>Playoffs</small><b>${pct(projection.playoffOdds)}</b><i>8 of ${teams.length}</i></div>
        <div class="so-odd is-title"><small>Championship</small><b>${pct(projection.titleOdds)}</b><i>${titleRank ? `${ordinal(titleRank)} best` : "—"}</i></div>
        <div class="so-odd is-chip"><small>Chip Eater</small><b>${pct(projection.lastOdds)}</b><i>finishing last</i></div>
      </div>
      <dl class="so-field">
        <div><dt>Title favourite</dt><dd>${esc(favourite ? teamName(favourite) : "—")} · ${pct(ranked[0]?.[1]?.titleOdds)}</dd></div>
        <div><dt>Chip Eater favourite</dt><dd>${esc(chipTeam ? teamName(chipTeam) : "—")} · ${pct(chip?.[1]?.lastOdds)}</dd></div>
      </dl>
      <details class="ta-method so-method"><summary>How this is calculated</summary><p>${DEFAULT_RUNS_NOTE}</p></details>
    </div>
  </section>`;
}

const DEFAULT_RUNS_NOTE = `3,000 simulated ${REGULAR_SEASON_WEEKS}-week seasons on each roster's projected weekly points, with a `
  + `${LEAGUE_WEEKLY_SD}-point weekly spread measured from 24 team-seasons of real DFL matchups. `
  + `No 2026 schedule has been published, so each week draws a random opponent — the odds describe the roster, not a fixture list.`;

function trendReport(team) {
  /* Folded, and it loads nothing until opened - three seasons of Sleeper stats
     is about 5.6MB. See trend-panel.js. */
  return section("MULTI-SEASON RECORD", "Trends", { open: true, id: "trends",
    hint: `${HISTORY_SEASONS} seasons`,
    body: `<div data-trend-panel data-team="${esc(team.id)}"></div>` });
}

function page(data) {
  const me = currentMember();
  const routeParams = new URLSearchParams((location.hash.split("?")[1] || ""));
  const requestedId = routeParams.get("team"), requestedOwner = routeParams.get("owner");
  let selectedId = data.teams.find(team => requestedOwner && String(team.sleeper_user_id) === String(requestedOwner))?.id || data.teams.find(team => String(team.id) === String(requestedId))?.id || data.teams.find(team => String(team.sleeper_user_id) === String(me?.sleeper_user_id))?.id || data.teams[0].id;
  let compareId = data.teams.find(team => team.id !== selectedId)?.id || selectedId;
  /* Your own team, if you have one in this league - the projected table marks
     it differently from whichever row you happen to be reading. */
  const myTeamId = data.teams.find(team => me?.sleeper_user_id && String(team.sleeper_user_id) === String(me.sleeper_user_id))?.id ?? null;
  /* Once per page load. Seeded, so it is stable across redraws too. */
  const projections = projectSeason({
    teams: data.teams.map(team => ({ id: String(team.id), mean: team.lineup.weeklyPoints })),
    playoffTeams: Number(data.league?.playoff_teams) || 8,
  });
  return {
    markup: `<header class="page-head ta-page-head"><div><h1>Team Analyzer</h1><p class="page-sub">${data.projectionSeason} outlook · ${data.rosterSeason} rosters · DFL scoring</p></div><a class="btn ghost small" href="#/keepers">Keepers</a></header><div class="ta-toolbar"><label><span>Reading team</span><select data-ta-team-select>${data.teams.map(team => `<option value="${esc(team.id)}" ${team.id === selectedId ? "selected" : ""}>${esc(teamName(team))}</option>`).join("")}</select></label><p>Current expectations, last season’s production and the league’s actual scoring.</p></div><main class="ta-report" data-ta-body></main>`,
    wire(view) {
      const body = view.querySelector("[data-ta-body]");
      const draw = () => {
        const team = data.teams.find(item => item.id === selectedId) || data.teams[0];
        const opponent = data.teams.find(item => item.id === compareId && item.id !== team.id) || data.teams.find(item => item.id !== team.id) || team;
        compareId = opponent.id;
        body.innerHTML = `${briefing(team, data.teams, projections, data.teams.length)}${positionReport(team)}${rosterReport(team, data.pool)}${seasonOutlook(team, projections, data.teams)}${comparison(team, opponent, data.teams)}${trendReport(team)}${rankings(data.teams, team.id, myTeamId)}<details class="ta-method"><summary>How this is calculated</summary><p> projected finish uses total points from the submitted legal offensive lineup (1 QB, 2 RB, 2 WR, 1 TE and 1 flex), with an optimized lineup used only when the submitted starters are incomplete. Starter grade equally averages the league-relative QB, RB, WR, TE and flex units shown above, so one high-scoring position cannot hide several weaker units. Depth receives its own grade. Overall roster grade blends starters (72%), depth (18%) and top-12 roster value (10%). Position needs are league-relative and only appear for a genuinely weak starting unit. Player forecasts favor current projections and pace-adjust prior production. Estimates are not guarantees.</p></details>`;
        view.querySelector("[data-ta-team-select]").value = team.id;
        wireTrendPanel(body.querySelector("[data-trend-panel]"), {
          team, pool: data.pool,
          season: Number(data.projectionSeason),
          scoringSettings: data.league?.scoring_settings || null,
        });
      };
      view.querySelector("[data-ta-team-select]").addEventListener("change", event => {
        selectedId = event.currentTarget.value;
        draw();
      });
      body.addEventListener("click", event => {
        /* A finding or a jump chip: open the section if it is folded, then
           scroll to it. Not an anchor, because the app is hash-routed. */
        const jump = event.target.closest("[data-ta-jump]");
        if (jump) {
          const target = body.querySelector(`#${jump.dataset.taJump}`);
          if (target) {
            if (target.tagName === "DETAILS") target.open = true;
            target.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          return;
        }
        const button = event.target.closest("[data-ta-team]");
        if (!button) return;
        selectedId = button.dataset.taTeam;
        draw();
        view.scrollTo?.({ top: 0, behavior: "smooth" });
      });
      body.addEventListener("change", event => {
        if (event.target.matches("[data-ta-compare]")) { compareId = event.target.value; draw(); }
      });
      draw();
    },
  };
}

export async function render(view) {
  view.innerHTML = `<header class="page-head"><h1>Team Analyzer</h1><p class="page-sub">Reading every roster, last season and current expectations…</p></header><div class="card"><div class="card-body muted">Building the league outlook…</div></div>`;
  try {
    const data = await loadAnalyzerData();
    if (data.state !== "ready") {
      view.innerHTML = `<header class="page-head"><h1>Team Analyzer</h1></header><div class="card"><div class="card-body"><strong>No populated Sleeper rosters yet.</strong><p class="muted">Run a Sleeper sync after the draft, then come back here.</p></div></div>`;
      return;
    }
    const built = page(data);
    view.innerHTML = built.markup;
    built.wire(view);
  } catch (error) {
    view.innerHTML = errorBox(error);
  }
}

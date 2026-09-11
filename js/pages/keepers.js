// =====================================================================
// Keepers - who is keeping whom, how long they have been held, and what
// round it costs.
//
// Four columns, one row per keeper, one card for the whole league. The
// team name is printed once and left blank on a team's later rows, the way
// a printed table of contents does it - so the eye runs straight down the
// player column without a header or a box interrupting it every line.
//
// This replaced a block per team, which spent a header and a border on
// teams that mostly have a single keeper.
// =====================================================================

import { db, selectAll } from "../supabase.js";
import { esc, empty, groupBy, toast } from "../ui.js";
import { addControl, editControls, wireInline, canEdit, visible, hiddenClass } from "../inline.js";
import { selfStatus, myKeepers, pickable, selfCard, wireSelfCard } from "../keeper-self.js";
import { loadPlayers, loadSeasonStats, loadMarketAdp } from "../sleeper.js";
import { advise, badgesFor, comparisonRow, factsFor, whyFor, marketFrom,
         CLASS, LABELS, NO_MARKET, NO_PRODUCTION } from "../keeper-advisor.js";
import { configFor, decisionContext, describeRules, DEFAULT_RULES } from "../keeper-rules.js";
import { positionalFinish, scoringFormat, seasonTotals } from "../dfl-scoring.js";
import { normalizeSleeperMarket } from "../keeper-market.js";
import { openKeeperEntry } from "../keeper-entry.js";
import { boardData, shareKeeperBoard } from "../keeper-board.js";
import { currentMember, loadMembers } from "../members.js";

let year = null;   // remembered while the app stays open

export async function render(view) {
  const rows = await selectAll("keepers", { order: "team", asc: true });
  /* The hold length is the league's own rule, not a 3 written into this page.
     An un-migrated league has no keeper_rules table, which is not worth
     failing the board over - the default is the same three seasons. */
  const ruleRows = await db().from("keeper_rules")
    .select("effective_season, max_keeper_seasons, cost_basis, round_adjustment, progression")
    .then((r) => (r.error ? [] : (r.data || [])), () => []);

  if (!rows.length) {
    view.innerHTML = `
      <header class="page-head"><h1>Keepers</h1></header>
      <div data-advisor-host></div>
      <div id="keeper-body">
        ${empty("No keepers recorded yet.")}
        ${canEdit() ? `<div class="row-end ke-actions">
           <button type="button" class="btn" data-keeper-entry>Add keeper</button>
           ${addControl("keepers", "Add by hand")}
         </div>` : ""}
      </div>`;
    wireInline(view.querySelector("#keeper-body"), () => render(view));
    view.addEventListener("click", (e) => {
      if (!e.target.closest("[data-keeper-entry]")) return;
      /* No keeper rows yet, so there is no year tab to read - the league's
         current season is what a first keeper would be recorded against. */
      openKeeperEntry({ season: new Date().getFullYear(), onSaved: () => render(view) });
    });
    mountAdvisor(view);
    return;
  }

  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a);
  if (!years.includes(year)) year = years[0];

  view.innerHTML = `
    <header class="page-head">
      <h1>Keepers</h1>
      <p class="page-sub" id="keeper-count"></p>
    </header>

    <div data-advisor-host></div>

    <h2 class="section-title">League keepers</h2>
    <div class="tabs" id="year-tabs">
      ${years.map((y) => `<button data-year="${y}" class="${y === year ? "on" : ""}">${y}</button>`).join("")}
    </div>
    <div id="keeper-body"></div>
  `;

  const body  = view.querySelector("#keeper-body");
  const count = view.querySelector("#keeper-count");

  const paint = () => {
    const mine = rows.filter((r) => r.year === year);
    const teams = groupBy(mine, "team").size;

    count.textContent = mine.length
      ? `${year} · ${mine.length} keeper${mine.length === 1 ? "" : "s"} across ${teams} team${teams === 1 ? "" : "s"}`
      : `${year} · nothing recorded`;

    const maxYears = configFor(ruleRows, year)?.max_keeper_seasons
                  ?? DEFAULT_RULES.max_keeper_seasons;

    body.innerHTML = teamList(mine, maxYears)
      + `<div class="row-end ke-actions">
           <button type="button" class="btn ghost small" data-keeper-share>Share keeper board</button>
           ${canEdit() ? `<button type="button" class="btn" data-keeper-entry>Add keeper</button>
             ${addControl("keepers", "Add by hand", { year })}` : ""}
         </div>`;
  };

  view.querySelector("#year-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-year]");
    if (!btn) return;
    year = Number(btn.dataset.year);
    view.querySelectorAll("#year-tabs button")
        .forEach((b) => b.classList.toggle("on", Number(b.dataset.year) === year));
    paint();
  });

  wireInline(body, () => render(view));

  /*
    THE POINT-AND-CLICK PATH IS THE DEFAULT, and the generic editor stays
    beside it as "Add by hand" - a commissioner still has to be able to
    correct a row whose source data is wrong, which is exactly what the
    legacy rows need. Delegated on the view, so a repaint cannot double it.
  */
  view.addEventListener("click", (e) => {
    if (!e.target.closest("[data-keeper-entry]")) return;
    openKeeperEntry({ season: year, onSaved: () => render(view) });
  });

  /*
    SHARE THE BOARD, and it must stay SYNCHRONOUS from the tap.

    Safari refuses navigator.share() outside the task that started it, and an
    await ends that task - so the members and the player map are fetched when
    the page loads, not when the button is pressed. `boardReady` is what the
    handler reads; until it exists the button says so rather than opening an
    empty share sheet. Same rule as every other share path - see share.js.
  */
  let boardReady = null;
  const primeBoard = async () => {
    try {
      const members = await loadMembers();
      const ids = rows.filter((r) => r.player_id != null).map((r) => String(r.player_id));
      /* Only bother with the 5MB player map if a row could actually be
         enriched by it. The snapshot columns cover most rows already. */
      const needsMap = rows.some((r) => r.player_id != null && !r.player_pos);
      const players = needsMap && ids.length ? await loadPlayers().catch(() => ({})) : {};
      const ruleSets = await db().from("keeper_rules")
        .select("effective_season, max_keeper_seasons, cost_basis, round_adjustment, progression");
      boardReady = { members, players, ruleSets: ruleSets.error ? [] : (ruleSets.data || []) };
    } catch {
      /* A board with no member list is still a board of the rows that exist,
         so this degrades rather than disabling the button. */
      boardReady = { members: [], players: {}, ruleSets: [] };
    }
  };
  primeBoard();

  view.addEventListener("click", (e) => {
    if (!e.target.closest("[data-keeper-share]")) return;
    if (!boardReady) { toast("Still reading the league — try again in a moment"); return; }
    const board = boardData({
      season: year, members: boardReady.members, keeperRows: rows,
      players: boardReady.players, rules: configFor(boardReady.ruleSets, year),
    });
    toast(shareKeeperBoard(board));
  });

  paint();
  mountAdvisor(view);
}

// ========================== KEEPER ADVISOR ============================
/*
  ABOVE the league table, never instead of it. The year view below is the
  league's shared reference and this pass does not touch a line of it.

  MOUNTED AFTER THE PAGE HAS DRAWN, on purpose. The advisor needs the Sleeper
  player map, a season of stats and the upcoming ADP board - several megabytes
  between them, all cached, none of which should hold the page hostage on the
  first visit of the week. The historical table paints first; the advisor
  fills in.

  IDENTITY IS THE MEMBER, and only ever the member: currentMember() ->
  sleeper_user_id -> the newest sleeper_rosters row for that id. The roster is
  never located by team name, which is exactly the mistake that would put
  somebody else's players on your card - and the keepers table below is proof
  of why, because its own `team` column holds first names.
*/
async function mountAdvisor(view) {
  const host = view.querySelector("[data-advisor-host]");
  if (!host) return;

  const member = currentMember();
  if (!member) { host.innerHTML = advisorShell(advisorBody({ state: "no-member" })); return; }
  if (!member.sleeper_user_id) {
    host.innerHTML = advisorShell(advisorBody({ state: "no-sleeper-id", member }), member);
    return;
  }

  host.innerHTML = advisorShell(
    `<p class="muted tiny">Reading your roster, last season and the draft board…</p>`, member);

  let data;
  try {
    data = await advisorData(member);
  } catch (err) {
    host.innerHTML = advisorShell(
      `<p class="muted tiny">Could not read your roster. ${esc(err.message || "")}</p>`, member);
    return;
  }

  host.innerHTML = advisorShell(advisorBody(data), member);

  /*
    THE MEMBER'S OWN CHOICE, next to the advice about it.

    Mounted here rather than in the page markup because it reuses the
    Advisor's candidate list: same member, same season, costs already priced by
    keeper-rules.js. Reading the roster a second time to build a picker would
    be a second answer to "what can I keep".

    Everything it offers is still checked server-side. This is where the
    options come from, not where the rules are.
  */
  await mountSelfCard(host, data, member);
}

async function mountSelfCard(host, data, member) {
  const season = data?.context?.targetSeason;
  if (!season || !host) return;

  let status = null;
  try {
    status = await selfStatus(season);
  } catch {
    /* A real failure is not worth taking the Advisor down for - the card is an
       addition to it, and the commissioner route still exists. */
    return;
  }
  /* No migration, no card. A league that has not run it has not opted in. */
  if (!status) return;

  /* One mount, however many times the advisor is remounted. Inserting a
     sibling without clearing the last one leaves two cards fighting over the
     same season. */
  host.parentElement?.querySelectorAll("[data-keeper-self-host]").forEach((el) => el.remove());
  const mount = document.createElement("div");
  mount.dataset.keeperSelfHost = "1";
  host.insertAdjacentElement("afterend", mount);

  const draw = async () => {
    let mine = [];
    try { mine = await myKeepers(season, status.member_id); } catch { mine = []; }
    const options = pickable(data.candidates || []);
    mount.innerHTML = selfCard({
      season, status, mine, options,
      keeperRows: data.keeperRows || [],
      /* data.rules is already the resolved config for this season - see
         line 339 - so it is read directly rather than passed through
         configFor() a second time. */
      maxKeeperSeasons: data.rules?.max_keeper_seasons ?? DEFAULT_RULES.max_keeper_seasons,
    });
    return options;
  };

  const options = await draw();
  wireSelfCard(mount, {
    season,
    memberId: status.member_id,
    options,
    onSaved: async () => {
      /* Re-read the status too: a save can be the thing that uses up the last
         slot, and the card has to stop offering what it cannot do. */
      try { status = (await selfStatus(season)) || status; } catch { /* keep the old one */ }
      await draw();
      render(document.getElementById("view") || document.body);
    },
  });
}

/*
  THE READS, and the three seasons they belong to.

  For a 2026 decision this loads 2025 production, the 2025 draft board and the
  2026 ADP board. decisionContext() is the only place that offset is written
  down - see keeper-rules.js - so nothing here computes `season - 1` by hand.

  The picks query is scoped to the ids ON THIS ROSTER rather than pulling
  every pick the league has ever made - a roster is about twenty players and
  the board is over a thousand picks.
*/
async function advisorData(member) {
  const uid = member.sleeper_user_id;

  const [rosterRes, leagueRes, rulesRes, keeperRowsRes] = await Promise.all([
    /*
      THE NEWEST ROSTER THAT ACTUALLY HAS PLAYERS, which is not always the
      newest row. A season in pre_draft has a roster for everybody and nobody
      on it - verified live: 2026 rows exist with `players: []` while 2025
      holds sixteen. Taking `limit(1)` told the whole league their roster was
      empty. Keepers are chosen off the squad you finished last season with, so
      the newest populated roster is both the available answer and the right
      one, and the card names the season it read.
    */
    db().from("sleeper_rosters")
      .select("season, players, team_name, synced_at")
      .eq("sleeper_user_id", uid)
      .order("season", { ascending: false }).limit(4),
    /* The league's own season, keeper allowance and - the new one - the
       scoring settings every points total on this card is computed from. */
    db().from("sleeper_leagues")
      .select("season, max_keepers, status, scoring_settings")
      .order("season", { ascending: false }).limit(1),
    /*
      THE CONFIGURED RULES, and they are the only authority now. The prose in
      the `rules` table is the league's human-readable constitution and is no
      longer parsed for a calculation - see keeper_rules_schema.sql for why.
    */
    db().from("keeper_rules")
      .select("effective_season, max_keeper_seasons, cost_basis, round_adjustment, progression, updated_at")
      .order("effective_season", { ascending: false }),
    /* Existing keeper rows, for tenure. Only rows carrying a player_id can
       contribute - see priorKeeperSeasons() - so legacy nickname rows are read
       but never counted. */
    db().from("keepers").select("year, member_id, player_id, player_name, team, player, round_cost"),
  ]);

  const rosterRows = rosterRes.data || [];
  const roster = rosterRows.find((r) => (r.players || []).length) || rosterRows[0] || null;
  const league = (leagueRes.data || [])[0] || null;
  /* max_keepers arrives with sleeper_draft_schema.sql. Before that migration
     the column is missing and the whole select fails - which is not worth
     losing the advisor over, so an error here just means "not stated". */
  const maxKeepers = leagueRes.error ? null : (league?.max_keepers ?? null);
  const scoring = leagueRes.error ? null : (league?.scoring_settings || null);

  /*
    The season being decided. The league's own current season is the answer -
    2026 while 2026 is in pre_draft - and the roster being read is the last one
    played, which is exactly the keeper relationship.
  */
  const targetSeason = league?.season ?? null;
  const ctx = decisionContext(targetSeason);
  /* A missing keeper_rules table is the un-migrated state: no rules, which the
     engine reports as "no-rules" and the card explains. */
  const ruleSets = rulesRes.error ? [] : (rulesRes.data || []);
  const rules = configFor(ruleSets, targetSeason);
  const keeperRows = keeperRowsRes.error ? [] : (keeperRowsRes.data || []);

  const ids = Array.isArray(roster?.players) ? roster.players.map(String) : [];

  /*
    LEAGUE SIZE COMES FROM THE LEAGUE, not from a twelve somebody typed. An
    expected round is a ceiling division by the team count, so a wrong size is
    wrong by a round at the top of the board and by three at the bottom -
    silently. Counted from the draft-basis season's roster rows.
  */
  const sizeRes = ctx.draftBasisSeason != null
    ? await db().from("sleeper_rosters").select("roster_id")
        .eq("season", ctx.draftBasisSeason)
    : { data: [] };
  const leagueSize = (sizeRes.data || []).length || null;

  const format = scoringFormat(scoring);

  const [players, picksRes, statsRes, marketRes] = await Promise.all([
    ids.length ? loadPlayers().catch(() => ({})) : Promise.resolve({}),
    ids.length
      ? db().from("sleeper_draft_picks")
          .select("season, player_id, round, pick_no, sleeper_user_id")
          .in("player_id", ids)
      : Promise.resolve({ data: [] }),
    /* Last season, for production. A completed season never changes, so this
       is cached for a week. Failure is a level-2 fallback, not an error. */
    ids.length && scoring
      ? loadSeasonStats(ctx.productionSeason).catch(() => ({ data: {}, fetchedAt: 0 }))
      : Promise.resolve({ data: {}, fetchedAt: 0 }),
    /* The upcoming draft, for market value. Failure is a level-3 fallback. */
    ids.length
      ? loadMarketAdp(ctx.marketSeason, format).catch(() => ({ data: [], fetchedAt: 0 }))
      : Promise.resolve({ data: [], fetchedAt: 0 }),
  ]);

  /*
    PRODUCTION, SCORED THE WAY THIS LEAGUE SCORES.

    Two passes over the same stats: the positional finish is ranked over every
    player at the position in the league, because "RB5 of the players I happen
    to own" would mean nothing, and the roster totals fill in anybody the
    ranking skipped. Both use the league's own scoring_settings; neither uses
    Sleeper's pts_ppr, which is a different scoring system with a similar name.
  */
  const stats = statsRes.data || {};
  const finishes = scoring
    ? positionalFinish({ stats, players, scoringSettings: scoring })
    : new Map();
  const totals = scoring
    ? seasonTotals({ playerIds: ids, stats, players, scoringSettings: scoring })
    : new Map();
  const production = new Map();
  for (const id of ids) {
    const finish = finishes.get(id);
    const total = totals.get(id);
    if (finish) production.set(id, { ...finish, games: total?.games ?? null });
    else if (total?.points != null) production.set(id, { ...total, positionRank: null, label: null });
  }

  const marketRows = normalizeSleeperMarket(marketRes.data || [], {
    leagueSize, scoringFormat: format, season: ctx.marketSeason,
  });
  const market = marketRows.length ? marketFrom(marketRows) : NO_MARKET;

  return {
    ...advise({
      member, sleeperUserId: uid, roster, players,
      /* A missing sleeper_draft_picks table is the un-migrated state. No
         rounds means every candidate needs review, which the card explains
         rather than hiding. */
      draftPicks: picksRes.error ? [] : (picksRes.data || []),
      rules, targetSeason, keeperRows,
      maxKeepers, market, production: production.size ? production : NO_PRODUCTION,
    }),
    needsDraftSync: !!picksRes.error,
    needsRulesMigration: !!rulesRes.error,
    needsScoring: !scoring,
    leagueSize,
    scoringFormat: format,
    leagueSeason: league?.season ?? null,
    rosterSeason: roster?.season ?? null,
  };
}

function advisorShell(inner, member) {
  return `
    <section class="card keeper-advisor" data-collapse="keeper-advisor"
             data-collapse-title="Keeper advisor"${member ? ` data-collapse-badge="${esc(member.display_name)}"` : ""}>
      ${inner}
    </section>`;
}

/*
  THE COPY IS SPECIFIC, WHICH IS WHAT MAKES IT HONEST.

  Every figure carries its season. "R8" on its own is the ambiguity that let a
  wrong draft basis survive a release, so this card writes "2025 Draft · R8"
  and "2026 Keeper · R7", and the market line names its source and its date.

  Where a fact is missing the card says which one and what it would take to
  get it, and the recommendation labels are gated on the data that would make
  them true - see dataLevel() and badgesFor() in keeper-advisor.js.
*/
function advisorBody(data) {
  if (data.state === "no-member") {
    return `<p class="muted">Pick your name in the top right and this will show your
      own keeper options.</p>`;
  }
  if (data.state === "no-sleeper-id") {
    return `<p class="muted">${esc(data.member.display_name)} is not linked to a Sleeper
      account yet, so there is no roster to read. An admin can link it on the
      Admin page.</p>`;
  }
  if (data.state === "no-roster") {
    return `<p class="muted">No roster has been synced for you yet. An admin can run
      <strong>Sync Sleeper</strong> on the Admin page.</p>`;
  }
  if (data.state === "no-players") {
    return `<p class="muted">No synced season has any players on your roster yet. An
      admin can run <strong>Sync Sleeper</strong> on the Admin page.</p>`;
  }

  const { candidates, counts, rules, context, shortlist, market } = data;
  /*
    The lead is drawn once, at the top, with its four figures and its
    reasoning. It is NOT repeated as row 1 - the first cut printed the same
    player twice, which on a 375px screen is a whole screenful of duplicate.
    The numbering still counts them as first, so the list starts at 2.
  */
  const lead = candidates[0]?.standing === "eligible" ? candidates[0] : null;
  const start = lead ? 1 : 0;
  const top = candidates.slice(start, shortlist);
  const rest = candidates.slice(shortlist);

  return `
    ${leadCard(lead, candidates, data)}

    ${ruleLine(rules, context)}
    ${marketLine(market)}

    <ol class="ka-list" start="${start + 1}" ${top.length ? "" : "hidden"}>
      ${top.map((c, i) => candidateRow(c, start + i + 1, candidates)).join("")}
    </ol>

    ${rest.length ? `
      <div class="ka-more" data-collapse="keeper-compare" data-collapse-default="folded"
           data-collapse-title="Compare all ${counts.total}"
           data-collapse-badge="${rest.length} more">
        ${compareTable(candidates, context)}
      </div>` : ""}

    ${blockers(data).map((b) => `<p class="ka-blocker">${b}</p>`).join("")}`;
}

/* The lead: one player, the four labelled figures, and why. */
function leadCard(c, all, data) {
  if (!c) return "";
  const badges = badgesFor(c, all);
  /*
    ONLY A POSITIVE CALL FILLS THE ACCENT SLOT. "POOR VALUE" in the accent
    reads as a recommendation to a reader skimming - which is how the whole
    league's best roster ended up headlined POOR VALUE in the harness. It is
    still shown, as a chip beside the others, because it is true.
  */
  const headline = badges.find((b) => HEADLINE.has(b)) || null;
  const chips = badges.filter((b) => b !== headline);
  const facts = factsFor(c);
  return `
    <div class="ka-lead-card">
      ${headline ? `<span class="ka-headline">${esc(headline)}</span>` : ""}
      <p class="ka-lead-who"><strong>${esc(c.name || `Player ${c.playerId}`)}</strong>
        <span class="ka-where">${esc([c.position, c.nflTeam].filter(Boolean).join(" · "))}</span></p>
      <dl class="ka-facts">
        ${facts.map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join("")}
      </dl>
      <p class="ka-why-long">${esc(whyFor(c))}</p>
      ${chips.length ? `<span class="ka-badges">${chips
        .map((b) => `<span class="pill tiny ${CALLS.has(b) ? "is-call" : ""}">${esc(b)}</span>`)
        .join("")}</span>` : ""}
    </div>`;
}

/* The calls that can headline the lead card: a reader should never see a
   warning rendered as the recommendation. */
const HEADLINE = new Set([LABELS.BEST_VALUE, LABELS.BEST_PLAYER, LABELS.SAFE_CHOICE,
                          LABELS.FINAL_YEAR, LABELS.VALUE_PLAY]);
/* Every label that is a judgement rather than a fact, for the chip styling. */
const CALLS = new Set([...HEADLINE, LABELS.POOR_VALUE]);

/*
  NO LEAD PARAGRAPH, AND NO FOOTNOTES.

  This card has lost three blocks of prose in a row, all of them true and none
  of them wanted: the methodology ("Ranked on 2025 production, your 2025 draft
  round and the 2026 market"), then the residue of it ("From your 2025 roster.
  1 keeper allowed"), then the explanatory list underneath - roster count,
  "expected rounds are approximate", "N players need a draft round".

  The card opens on the recommendation now and ends on the comparison. Every
  figure is already labelled with its own season and a missing one already
  reads "—", so the explanations were restating what the layout says. The
  roster season is still on the card, on the lead card and in the compare-all
  headers.

  What survives is blockers() below: not commentary, but the states where the
  card would otherwise be quietly wrong.
*/

function ruleLine(rules, context) {
  const summary = describeRules(rules);
  if (!summary) return "";
  return `<p class="ka-rules">${esc(context.targetSeason ?? "")} keeper rules ·
    ${esc(summary)}</p>`;
}

/* SOURCE AND DATE, always together. A market number with no date is a
   number somebody has to trust rather than check. */
function marketLine(market) {
  if (!market?.available) return "";
  const fresh = market.freshness;
  return `<p class="ka-source ${fresh?.stale ? "is-stale" : ""}">${esc(market.source || "Market")}
    ${market.scoringFormat ? `· ${esc(market.scoringFormat.replace("_", " "))}` : ""}
    ${fresh?.label ? `· ${esc(fresh.label)}` : ""}</p>`;
}

/*
  ONLY THE THINGS THAT MEAN THE CARD IS LYING.

  gaps() used to print seven kinds of note, and six of them were commentary a
  reader did not ask for. What is left is the set where a figure is ABSENT for a
  fixable reason and the card cannot say so any other way - a migration that has
  not been run, or a sync that has not happened. Those are not subtext; without
  them the Advisor shows every cost as "—" and offers no clue why.

  A normal, fully-synced league sees NOTHING here, which is the point.
*/
function blockers(data) {
  const { context, rules } = data;
  const out = [];
  if (data.needsRulesMigration) {
    out.push(`Keeper rules are not switched on yet. Run
      <strong>keeper_rules_schema.sql</strong> in the Supabase SQL editor.`);
  } else if (!rules) {
    out.push(`No keeper rules are configured for ${esc(context.targetSeason ?? "this season")},
      so no keeper cost is shown.`);
  }
  if (data.needsDraftSync) {
    out.push(`Draft rounds are missing. Run <strong>sleeper_draft_schema.sql</strong>,
      then <strong>Sync Sleeper</strong>.`);
  }
  if (data.needsScoring) {
    out.push(`This league's scoring settings have not been synced, so
      ${esc(context.productionSeason)} points cannot be worked out. Run
      <strong>Sync Sleeper</strong> on the Admin page.`);
  }
  return out;
}

function candidateRow(c, n, all) {
  const badges = badgesFor(c, all);
  const who = c.name || `Player ${c.playerId}`;
  const where = [c.position, c.nflTeam].filter(Boolean).join(" · ");
  const cost = c.keeperCost != null
    ? `<span class="ka-cost">R${c.keeperCost}</span>`
    : `<span class="ka-cost none" title="${c.standing === "unavailable"
        ? "Not eligible under the configured rules"
        : `No ${c.basisSeason ?? "previous season"} draft round on record`}">—</span>`;

  return `
    <li class="ka-row ${c.class === CLASS.UNKNOWN ? "is-unknown" : ""} ${
        c.standing === "unavailable" ? "is-unavailable" : ""}">
      <span class="ka-n" aria-hidden="true">${n}</span>
      <span class="ka-main">
        <span class="ka-name">${esc(who)}</span>
        ${where ? `<span class="ka-where">${esc(where)}</span>` : ""}
        <span class="ka-why">${factsFor(c).map((f) =>
          `<span class="ka-fact"><b>${esc(f.label)}</b> ${esc(f.value)}</span>`).join("")}</span>
        ${badges.length ? `<span class="ka-badges">${badges
          .map((b) => `<span class="pill tiny ${CALLS.has(b) ? "is-call" : ""}">${esc(b)}</span>`)
          .join("")}</span>` : ""}
      </span>
      ${cost}
    </li>`;
}

/*
  COMPARE ALL, with every column labelled by its season.

  A table rather than a repeat of the list, because comparing fourteen players
  on six numbers is what a table is for. It scrolls inside its own box - the
  page itself never scrolls sideways, at any width.
*/
function compareTable(all, context) {
  const rows = all.map(comparisonRow);
  const n = (v, dp = 0) => v == null ? "—" : Number(v).toFixed(dp);
  return `
    <div class="ka-table-wrap">
      <table class="ka-table">
        <thead>
          <tr>
            <th>Player</th><th>Pos</th>
            <th class="num">${esc(context.productionSeason)} Pts</th>
            <th>${esc(context.productionSeason)} Finish</th>
            <th class="num">${esc(context.draftBasisSeason)} Draft</th>
            <th class="num">${esc(context.targetSeason)} Keeper</th>
            <th class="num">${esc(context.marketSeason)} ADP</th>
            <th class="num">${esc(context.marketSeason)} Exp.</th>
            <th class="num">Value</th>
            <th>Keeper year</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr class="${r.standing === "unavailable" ? "is-unavailable" : ""}">
              <td>${esc(r.player)}</td>
              <td>${esc(r.position)}</td>
              <td class="num">${n(r.productionPoints, 1)}</td>
              <td>${esc(r.positionFinish || "—")}</td>
              <td class="num">${r.basisRound != null ? `R${r.basisRound}` : "—"}</td>
              <td class="num">${r.keeperRound != null ? `R${r.keeperRound}` : "—"}</td>
              <td class="num">${n(r.marketAdp, 1)}</td>
              <td class="num">${r.expectedRound != null ? `R${r.expectedRound}` : "—"}</td>
              <td class="num ${r.roundValue != null && r.roundValue > 0 ? "is-plus" : ""}">${
                r.roundValue == null ? "—" : (r.roundValue > 0 ? `+${r.roundValue}` : r.roundValue)}</td>
              <td>${r.keeperYear != null && r.maxKeeperYears != null
                ? `${r.keeperYear} of ${r.maxKeeperYears}` : "—"}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

/**
 * The whole year as one list, sorted by team.
 *
 * A row only draws its top hairline when it starts a new team, so the
 * grouping is legible without a header per team. The cost column is fixed
 * width with tabular digits, so the rounds line up as a column you can
 * scan on its own.
 *
 * `keeper_year` is which season of the hold this row is - 1 the first time a
 * player is kept. The season he was first selected and the seasons still left
 * are both arithmetic on it, so there is one stored fact and no second column
 * to keep in step with it.
 */
function teamList(allRows, maxYears) {
  const rows = visible("keepers", allRows);
  if (!rows.length) return empty("No keepers for this year.");

  const byTeam = [...groupBy(rows, "team").entries()]
    .sort((a, b) => a[0].localeCompare(b[0]));

  return `
    <div class="card keepcard">
      <div class="kp-head" aria-hidden="true">
        <span>Team</span><span>Keeper</span><span>Held</span><span class="kp-r">Round</span>
      </div>
      ${byTeam.map(([team, list]) => list.map((k, i) => `
        <div class="kp-row ${i === 0 ? "kp-new" : ""} ${hiddenClass("keepers", k)}">
          <span class="kp-team">${i === 0 ? esc(team) : ""}</span>
          <span class="kp-player">
            ${esc(k.player)}
            ${k.notes ? `<span class="kp-note">${esc(k.notes)}</span>` : ""}
          </span>
          ${heldCell(k, maxYears)}
          <span class="kp-cost ${k.round_cost == null ? "none" : ""}">${
            k.round_cost != null ? `${esc(k.round_cost)}` : "—"}</span>
          ${editControls("keepers", k, { compact: true })}
        </div>`).join("")).join("")}
    </div>`;
}

/*
  THE SEASON HE WAS TAKEN, AND WHAT IS LEFT AFTER THIS ONE.

  A row with no keeper year is not guessed at. Most of the legacy rows carry a
  nickname and no player id, and inventing a tenure for one of those is how a
  player becomes ineligible for a reason nobody can trace - so an unmarked row
  reads "—" and waits for a commissioner to set it.
*/
function heldCell(k, maxYears) {
  const yr = Number(k.keeper_year);
  const season = Number(k.year);
  if (!Number.isFinite(yr) || yr < 1) {
    return `<span class="kp-held none">—</span>`;
  }
  const since = Number.isFinite(season) ? season - yr + 1 : null;
  const left = Math.max(0, (maxYears ?? DEFAULT_RULES.max_keeper_seasons) - yr);
  return `
    <span class="kp-held">
      ${since != null ? `<span class="kp-since">${esc(since)}</span>` : ""}
      <span class="kp-left ${left === 0 ? "is-final" : ""}">${
        left === 0 ? "final" : `${left} left`}</span>
    </span>`;
}

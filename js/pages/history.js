// =====================================================================
// History - everything backward-looking, in one place.
//
//   Hall of Fame  champions, runners up, and the hand-written entries
//   Seasons       final standings for any season
//   All-time      career records for every owner
//   Records       the record book, computed from every week ever played
//
// This absorbed what used to be a separate Owners page. Per-person detail
// lives on the profile pages; this is the league-wide view.
// =====================================================================

import { db } from "../supabase.js";
import { loadPlayers, loadSeasonStats } from "../sleeper.js";
import { rankTradeFleeces } from "../trade-fleeces.js";
import { editableName, wireNamePick } from "../name-pick.js";
import { setSeasonResult } from "../season-result.js";
import { LEAGUE_FOUNDED, FIRST_SYNCED_SEASON } from "../config.js";
import { esc, empty, errorBox, groupBy, loading } from "../ui.js";
import { addControl, editControls, wireInline, canEdit, visible, hiddenClass } from "../inline.js";
/*
  The record book, the moments and the yearbook are three views of ONE
  derivation, and it lives in lore.js. This page used to own namer(),
  toSides(), best() and the streak walk outright, which is why a profile
  could never show a head-to-head: the arithmetic was trapped in here.
*/
import {
  loadLore, clearLore, namer, toSides, margin, best, played,
  winnerSide, loserSide, streaks, spanLabel, moments, yearbook,
} from "../lore.js";

const ICON = {
  "Champion":  "i-trophy",
  "Runner Up": "i-medal",
  "Award":     "i-award",
  "Record":    "i-record",
  "Moment":    "i-moment",
};

function icon(category) {
  return `<svg class="ico-sm" aria-hidden="true"><use href="#${ICON[category] || "i-award"}"></use></svg>`;
}

let tab = "fame";
let season = null;

export async function render(view) {
  view.innerHTML = `<h1>History</h1>` + loading("Reading the record book…");

  /* ONE LOAD for every tab on this page, and the same one a profile reads.
     The record book used to fetch the matchup table separately the first
     time somebody opened its tab; it is all one fetch now, cached in
     lore.js for the rest of the visit. */
  const data = await loadLore();
  if (data.error) { view.innerHTML = `<h1>History</h1>` + errorBox(data.error); return; }

  if (!data.manual.length && !data.leagues.length) {
    view.innerHTML = `<h1>History</h1>
      <div id="hist-body">
        ${empty("No league history yet.")}
        ${canEdit() ? `<div class="row-end">${addControl("history", "Add entry")}</div>` : ""}
      </div>`;
    wireInline(view.querySelector("#hist-body"), () => { clearLore(); render(view); });
    return;
  }

  view.innerHTML = `
    <h1>History</h1>
    <!--
      FIVE TABS DO NOT FIT A PHONE, and .tabs has always been a horizontal
      scroller - the problem was that it did not look like one. At 375px the
      strip is wider than the screen with nothing to say so, so "Records"
      simply did not exist unless you happened to swipe. tabscroll adds the
      edge fade, the snap and the keyboard roles; scrollTabIntoView() below
      keeps the current one in shot.
    -->
    <div class="tabs tabscroll" id="hist-tabs" role="tablist" aria-label="History sections">
      <button data-tab="fame"    role="tab" aria-selected="${tab === "fame"}"    class="${tab === "fame" ? "on" : ""}">Hall of Fame</button>
      <button data-tab="moments" role="tab" aria-selected="${tab === "moments"}" class="${tab === "moments" ? "on" : ""}">Moments</button>
      <button data-tab="seasons" role="tab" aria-selected="${tab === "seasons"}" class="${tab === "seasons" ? "on" : ""}">Yearbook</button>
      <button data-tab="alltime" role="tab" aria-selected="${tab === "alltime"}" class="${tab === "alltime" ? "on" : ""}">All-time</button>
      <button data-tab="records" role="tab" aria-selected="${tab === "records"}" class="${tab === "records" ? "on" : ""}">Records</button>
    </div>
    <div id="hist-body"></div>
  `;

  const body = view.querySelector("#hist-body");
  const paint = () => {
    if (tab === "records") return recordsView(body, data);
    body.innerHTML = tab === "fame"    ? fameView(data)
                   : tab === "moments" ? momentsView(data)
                   : tab === "seasons" ? yearbookView(data)
                   : allTimeView(data);
  };

  view.querySelector("#hist-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (!btn) return;
    tab = btn.dataset.tab;
    view.querySelectorAll("#hist-tabs button").forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    });
    scrollTabIntoView(btn);
    paint();
  });

  body.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-season]");
    if (!btn) return;
    season = Number(btn.dataset.season);
    paint();
    /* paint() rebuilt the picker, so the button just clicked is gone - find
       its replacement and keep the choice visible. */
    scrollTabIntoView(view.querySelector(`#year-picker button[data-season="${season}"]`));
    /* The yearbook is long and the picker is at the top of it - jumping
       back up is the difference between reading a season and hunting for
       where it started. */
    view.querySelector("#hist-tabs")?.scrollIntoView({ block: "start" });
  });

  // #hist-body is new on every render, so this cannot stack up.
  // An edited moment changes the derivation, so the cache goes with it.
  wireInline(body, () => { clearLore(); render(view); });
  /*
    CLICK A CHAMPION'S NAME TO CHANGE IT. Sleeper cannot know every answer -
    the 2019 title belongs to a member who was removed from the league that
    year - so the commissioner gets the list and the write locks the column
    against the next sync. See season_result_override_schema.sql.
  */
  wireNamePick(body, data.members || [], async ({ field, key, memberId }) => {
    await setSeasonResult({ season: Number(key), field, memberId });
    clearLore();
    render(view);
  });

  paint();
  /* Arriving back on a tab that sits off the right of a phone screen should
     not look like the first tab is selected. */
  scrollTabIntoView(view.querySelector(`#hist-tabs button[data-tab="${tab}"]`));
  if (tab === "seasons") {
    scrollTabIntoView(view.querySelector(`#year-picker button[data-season="${season}"]`));
  }
}

function nameCell(who) {
  const inner = `${esc(who.label)}${who.sub && who.sub !== who.label
    ? `<div class="muted tiny">${esc(who.sub)}</div>` : ""}`;
  return who.memberId
    ? `<a href="#/profile?id=${who.memberId}" class="plainlink">${inner}</a>`
    : inner;
}

// ----------------------------- hall of fame ---------------------------

function fameView(data) {
  const name = namer(data);
  // Every completed season, not just those with a known owner. A season
  // whose winner deleted their account still belongs in the record book.
  const titled = data.leagues
    .filter((l) => l.champion_user_id || l.champion_roster_id)
    .sort((a, b) => b.season - a.season);

  const byYear = [...groupBy(visible("history", data.manual), "year").entries()]
    .sort((a, b) => b[0] - a[0]);

  return `
    ${titled.length ? `
      <div class="card accent">
        <div class="card-title">${icon("Champion")} Champions</div>
        <div class="tblwrap">
          <table class="tbl">
            <thead><tr><th>Season</th><th>Champion</th><th>Runner up</th></tr></thead>
            <tbody>
              ${titled.map((l) => `
                <tr>
                  <td>${esc(l.season)}</td>
                  <td>${canEdit() ? editableName({
                    text: name(l.champion_user_id, l.season, l.champion_roster_id).label,
                    field: "champion", key: l.season, canEdit: true,
                  }) : nameCell(name(l.champion_user_id, l.season, l.champion_roster_id))}${
                    l.champion_locked ? `<div class="muted tiny">set by hand</div>` : ""}</td>
                  <td class="muted">${l.runner_up_user_id || l.runner_up_roster_id
                    ? nameCell(name(l.runner_up_user_id, l.season, l.runner_up_roster_id))
                    : "—"}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <div class="card-meta">Taken from the Sleeper playoff brackets, except where a season is marked <em>set by hand</em> — 2017 and 2018 were played on another app and 2019’s winner was removed from the league after winning it.</div>
      </div>` : ""}

    ${byYear.length
      ? byYear.map(([year, list]) => `
          <div class="section-head">
            <h2>${esc(year)}</h2>
            ${addControl("history", "Add entry", { year })}
          </div>
          <div class="card schedule">${sortRows(list).map(entry).join("")}</div>`).join("")
      : `<div class="card"><div class="card-body muted">No league history yet.</div>
           ${canEdit() ? `<div class="row-end">${addControl("history", "Add entry")}</div>` : ""}
         </div>`}
  `;
}

const ORDER = ["Champion", "Runner Up", "Award", "Record", "Moment"];

function sortRows(list) {
  const rank = (c) => { const i = ORDER.indexOf(c); return i === -1 ? 99 : i; };
  return [...list].sort((a, b) => rank(a.category) - rank(b.category));
}

/**
 * One line per entry inside the year's card, rather than a card each. A
 * season with four awards used to be four bordered boxes saying two words.
 */
function entry(r) {
  return `
    <div class="evrow ${hiddenClass("history", r)}">
      <div class="evicon" aria-hidden="true">${icon(r.category)}</div>
      <div class="evbody">
        <div class="evtop">
          <span class="evtitle">${esc(r.winner || r.category)}</span>
          <span class="pill">${esc(r.category)}</span>
        </div>
        ${r.notes ? `<div class="evnote">${esc(r.notes)}</div>` : ""}
        ${editControls("history", r, { compact: true })}
      </div>
    </div>`;
}

// ------------------------------- MOMENTS ------------------------------
//
// The league's memory, newest first. NOT a feed: nothing here is posted,
// liked or followed - every row is a fact derived in lore.js from a game
// that was actually played, or a line the commissioner wrote down. It is a
// record, and it reads the way a record reads: by year.

const KIND_ICON = {
  championship: "i-trophy", title: "i-trophy", commissioner: "i-moment",
  golf: "i-golf", arena: "i-arena", streak: "i-record", heartbreak: "i-medal",
  blowout: "i-record", nailbiter: "i-record", high: "i-record", low: "i-record",
  rivalry: "i-versus",
};

/* What the row IS, so a moment says what kind of thing it is before you
   have read the figure. */
const KIND_LABEL = {
  championship: "Champion", title: "The final", commissioner: "From the commissioner",
  golf: "Golf", arena: "Arena", streak: "Streak", heartbreak: "Hard luck",
  blowout: "Blowout", nailbiter: "Nail-biter", high: "Highest week", low: "Lowest week",
  rivalry: "Rivalry",
};

function momentsView(data) {
  const list = moments(data);
  if (!list.length) {
    return `<div class="state">
      <span class="state-title">Nothing to remember yet</span>
      <span>Sync Sleeper from the Admin page, or write the first one down.</span>
    </div>${canEdit() ? `<div class="row-end">${addControl("history", "Add a moment")}</div>` : ""}`;
  }

  const byYear = groupBy(list, (m) => m.season ?? "—");
  const years = [...byYear.keys()].sort((x, y) => (Number(y) || 0) - (Number(x) || 0));

  /*
    A YEAR AT A TIME, and only the newest one open.

    Every moment the league has is on this tab - it is over a hundred rows
    already and it grows every Sunday, so the page was several screens of
    scrolling before you reached the season you came for. Each year is now a
    fold: js/collapse.js, the app's only collapse implementation, with the
    newest year open and the rest asking to start folded.

    NOTHING IS COLLAPSED INSIDE A YEAR and no moment is removed. The fold row
    carries the year and its count, so a shut year still tells you how much is
    in it. "folded" is only a default - one tap and collapse.js remembers that
    year open for good, per device.
  */
  return `
    <p class="page-sub" style="margin-bottom:14px">
      ${list.length} moments · read off every game on record
      <span class="muted">· nothing here is invented</span>
    </p>
    ${years.map((y, i) => {
      const rows = byYear.get(y);
      return `
      <div class="card momentlist" data-collapse="hist-moments-${esc(y)}"
           data-collapse-title="${esc(y)}"
           data-collapse-badge="${rows.length} moment${rows.length === 1 ? "" : "s"}"
           ${i === 0 ? "" : `data-collapse-default="folded"`}>
        ${rows.map(momentRow).join("")}
      </div>`;
    }).join("")}
    ${canEdit() ? `<div class="row-end">${addControl("history", "Add a moment")}</div>` : ""}
  `;
}

/*
  Keep the chosen tab or year in shot inside its scroller.

  `nearest` rather than `center`: on a wide screen where the whole strip fits,
  nearest does nothing at all, which is what should happen. And `block:
  "nearest"` so scrolling a horizontal strip never drags the page up or down.
*/
function scrollTabIntoView(button) {
  if (!button) return;
  try { button.scrollIntoView({ inline: "nearest", block: "nearest" }); }
  catch { /* older engines: the strip is still scrollable by hand */ }
}

/*
  ONE MOMENT. Deliberately a ROW, not a card - a hundred of these as cards
  is exactly the card wall the redesign spent its time removing. The kind is
  the quiet part, the headline is the loud part, and the detail explains it
  in one line.
*/
function momentRow(m) {
  const kind = m.kind === "commissioner" && m.category ? m.category : (KIND_LABEL[m.kind] || "Moment");
  const inner = `
    <svg class="ico-sm moment-ico" aria-hidden="true"><use href="#${KIND_ICON[m.kind] || "i-moment"}"></use></svg>
    <span class="moment-body">
      <span class="moment-kind">${esc(kind)}</span>
      <strong class="moment-head">${esc(m.headline)}</strong>
      ${m.detail ? `<span class="moment-detail">${esc(m.detail)}</span>` : ""}
    </span>`;
  return m.href
    ? `<a class="moment is-${esc(m.kind)}" href="${esc(m.href)}">${inner}</a>`
    : `<div class="moment is-${esc(m.kind)}">${inner}</div>`;
}

// ------------------------------ YEARBOOK ------------------------------
//
// A season told as what happened, rather than as a table of rows. The
// standings are still here - they are the last word on a season - but they
// come after the story instead of being the whole of it.
//
// Everything reads through lore.js, so the champion named here is named the
// same way on the moments tab and on that owner's career page.

function yearbookView(data) {
  const years = [...new Set(data.standings.map((s) => s.season))].sort((a, b) => b - a);
  if (!years.length) return empty("No season standings yet. Sync Sleeper from the Admin page.");

  const hasGames = (y) => data.standings.some((s) => s.season === y && (s.wins + s.losses + s.ties) > 0);
  // Open on the newest season actually played, not a pre-draft season of 0-0.
  if (!years.includes(season)) season = years.find(hasGames) ?? years[0];

  const y = yearbook(data, season);
  /*
    ONE BUTTON PER SEASON, and that list only ever grows - eight seasons
    already overflow a 375px screen and 2031 will overflow a tablet. Rather
    than swap it for a <select> and lose the at-a-glance row, it becomes the
    same contained scroller the tab strip uses, and the selected year is
    scrolled into shot after every paint. Desktop still shows the whole row.

    Kept as buttons on purpose: the click handler, the remembered `season`
    and the scroll-to-top behaviour all work exactly as they did.
  */
  const picker = `<div class="tabs tabscroll" id="year-picker" role="tablist"
                       aria-label="Season">${years.map((n) =>
    `<button data-season="${n}" role="tab" aria-selected="${n === season}"
             class="${n === season ? "on" : ""}">${n}</button>`).join("")}</div>`;

  if (!y.played) {
    return `${picker}
      <div class="state">
        <span class="state-title">${esc(season)} has not been played</span>
        <span>The teams are set. The yearbook writes itself once the games start.</span>
      </div>
      ${standingsCard(y, false)}`;
  }

  return `
    ${picker}
    ${champBand(y)}
    ${titleGameCard(y)}
    ${seasonMomentsCard(y)}
    ${standingsCard(y, true)}
  `;
}

/*
  THE CHAMPION, once, at the top and at size. A season has exactly one
  headline and this is it - which is why the runner-up is a line underneath
  rather than a second band competing with it.
*/
function champBand(y) {
  if (!y.champion) {
    return `<div class="card"><div class="card-title">${esc(y.season)}</div>
      <div class="card-body muted">No champion recorded for this season.</div></div>`;
  }
  return `
    <section class="yb-champ">
      <span class="yb-kicker">
        <svg class="ico-sm" aria-hidden="true"><use href="#i-trophy"></use></svg>
        ${esc(y.season)} champion
      </span>
      <strong class="yb-name">${esc(y.champion.label)}</strong>
      ${y.champion.sub && y.champion.sub !== y.champion.label
        ? `<span class="yb-sub">${esc(y.champion.sub)}</span>` : ""}
      ${y.runnerUp ? `<span class="yb-runner">Runner-up · ${esc(y.runnerUp.label)}</span>` : ""}
    </section>`;
}

/* The game that decided it, on the seasons where the data can prove which
   game that was. lore.js returns nothing rather than a guess. */
function titleGameCard(y) {
  if (!y.title) return "";
  const t = y.title;
  return `
    <div class="card">
      <div class="card-title">The final · Week ${esc(t.week)}</div>
      <div class="yb-final">
        <div class="yb-side">
          <b>${t.champScore.toFixed(2)}</b>
          <span>${esc(y.name(t.champUser, t.season, t.champRoster).label)}</span>
        </div>
        <div class="yb-by">by ${t.margin.toFixed(2)}</div>
        <div class="yb-side is-down">
          <b>${t.runnerScore.toFixed(2)}</b>
          <span>${esc(y.name(t.runnerUser, t.season, t.runnerRoster).label)}</span>
        </div>
      </div>
    </div>`;
}

/* The season's own moments, minus the two the band above already carries -
   printing the championship twice on one screen is noise. */
function seasonMomentsCard(y) {
  const rows = y.moments.filter((m) => m.kind !== "championship" && m.kind !== "title");
  if (!rows.length) return "";
  return `
    <h2 class="section-title">${esc(y.season)} in moments</h2>
    <div class="card momentlist">${rows.map(momentRow).join("")}</div>`;
}

function standingsCard(y, played) {
  return `
    <h2 class="section-title">${played ? "Final standings" : "Teams"}</h2>
    <div class="card">
      <div class="tblwrap">
        <table class="tbl">
          <thead>
            <tr><th>#</th><th>Team</th><th>Record</th><th class="num">PF</th><th class="num">PA</th></tr>
          </thead>
          <tbody>
            ${y.standings.map((s) => `
              <tr>
                <td>
                  ${played ? (s.rank ?? "—") : "—"}
                  ${played && s.made_playoffs ? `<span class="pill green tiny">P</span>` : ""}
                </td>
                <td>${nameCell(y.name(s.sleeper_user_id, y.season, s.roster_id))}</td>
                <td>${s.wins}-${s.losses}${s.ties ? "-" + s.ties : ""}</td>
                <td class="num">${Math.round(s.points_for).toLocaleString()}</td>
                <td class="num">${Math.round(s.points_against).toLocaleString()}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="card-meta">
        ${played
          ? `P marks a playoff berth · ${y.games} games over ${y.weeks} weeks.`
          : "This season has not been played yet."}
      </div>
    </div>`;
}

// ------------------------------ all time ------------------------------

function allTimeView(data) {
  if (!data.standings.length) return empty("No career records yet. Sync Sleeper from the Admin page.");

  const name = namer(data);
  const titles = countBy(data.leagues, "champion_user_id");
  const byUser = groupBy(data.standings, "sleeper_user_id");

  const careers = [...byUser.entries()]
    /* An owner-less standings row is not a career. There is one in the data,
       and `titles` above has a null key holding every unwon season (2019 was
       never recorded, the current one is not over) - so if a Sleeper user row
       ever turned up with no id, this would pair the two and invent an owner
       called nobody with a fistful of championships. Same null-equality trap
       that used to hand unlinked members the 2019 title. */
    .filter(([userId]) => userId != null)
    // hidden Sleeper accounts are excluded from the league record books
    .filter(([userId]) => data.users.some((u) => u.sleeper_user_id === userId))
    .map(([userId, seasons]) => {
      const wins   = sum(seasons, "wins");
      const losses = sum(seasons, "losses");
      const ties   = sum(seasons, "ties");
      const games  = wins + losses + ties;
      const ranked = seasons.filter((s) => s.rank != null);
      return {
        who: name(userId),
        wins, losses, ties,
        winPct:    games ? (wins + ties / 2) / games : 0,
        pointsFor: sum(seasons, "points_for"),
        avgFinish: ranked.length ? ranked.reduce((t, s) => t + s.rank, 0) / ranked.length : null,
        playoffs:  seasons.filter((s) => s.made_playoffs).length,
        titles:    titles.get(userId) || 0,
        seasons:   seasons.length,
      };
    })
    .sort((a, b) => b.winPct - a.winPct || b.titles - a.titles || b.pointsFor - a.pointsFor);

  const seasonCount = new Set(data.standings.map((s) => s.season)).size;

  return `
    <div class="card">
      <div class="card-title">All-time records</div>
      <div class="tblwrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>Owner</th><th>Record</th><th class="num">Win %</th>
              <th class="num">Titles</th><th class="num">Playoffs</th>
              <th class="num">Avg finish</th><th class="num">Points</th>
            </tr>
          </thead>
          <tbody>
            ${careers.map((c) => `
              <tr>
                <td>${nameCell(c.who)}</td>
                <td>${c.wins}-${c.losses}${c.ties ? "-" + c.ties : ""}</td>
                <td class="num">${(c.winPct * 100).toFixed(1)}%</td>
                <td class="num">${c.titles || "—"}</td>
                <td class="num">${c.playoffs}</td>
                <td class="num">${c.avgFinish ? c.avgFinish.toFixed(1) : "—"}</td>
                <td class="num">${Math.round(c.pointsFor).toLocaleString()}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="card-meta">
        ${seasonCount} season${seasonCount === 1 ? "" : "s"} of history. Tap an owner for their profile.
      </div>
    </div>`;
}

// ============================ record book =============================
//
// Everything here is computed from data that is already synced: every week
// ever played (sleeper_matchups), the season totals (sleeper_standings) and
// the trades (sleeper_transactions). No new API, no new tables.
//
// Loaded only when the tab is opened, and then kept for the rest of the
// session - it is a few hundred rows, but there is no reason to fetch them
// for somebody who only wanted the champions list.

/*
  The trades are the only thing the record book still fetches for itself:
  they are a big table, nothing else on the page wants them, and somebody
  who only came for the champions list should not pay for them.
*/
let tradeCache = null;

async function loadTrades() {
  if (tradeCache) return tradeCache;
  const { data, error } = await db()
    .from("sleeper_transactions")
    .select("season, week, type, status, details")
    .eq("type", "trade").eq("status", "complete");
  tradeCache = { trades: data || [], error: error || null };
  return tradeCache;
}

async function recordsView(body, data) {
  body.innerHTML = loading("Reading every week ever played…");

  const rec = await loadTrades();
  const name = namer(data);
  const sides = toSides(data.matchups);

  if (!sides.length) {
    body.innerHTML = empty("No weekly scores synced yet. Run a Sleeper sync from the Admin page.");
    return;
  }

  const scored  = sides.filter((s) => s.score > 0);
  const games   = data.matchups.filter(played);
  const runs    = streaks(sides);
  const seasons = seasonRecords(data.standings);

  const longestWin  = best(runs.map((r) => r.win).filter(Boolean),  (r) => r.run);
  const longestLoss = best(runs.map((r) => r.loss).filter(Boolean), (r) => r.run);

  const high = best(scored, (s) => s.score);
  const low  = best(scored, (s) => -s.score);
  const blow = best(games, (m) => margin(m));
  const near = best(games.filter((m) => margin(m) > 0), (m) => -margin(m));
  const shoot = best(games, (m) => Number(m.score1) + Number(m.score2));
  /* The best loss in the league. It is the row every owner remembers and
     the only one the record book was missing. */
  const hardLuck = best(scored.filter((s) => !s.won && !s.tie), (s) => s.score);

  const who = (s) => name(s.user, s.season, s.roster);
  const sideName = (m, pick) => {
    const p = pick(m);
    return name(p.user, m.season, p.roster).label;
  };

  body.innerHTML = `
    ${/* The season count here is how many seasons of DATA exist, not how old
          the league is. Saying "7 seasons" unqualified next to a 10th
          anniversary badge on the home page would read as a contradiction,
          so the gap is stated rather than glossed over. */ ""}
    <p class="page-sub" style="margin-bottom:14px">
      ${games.length} games · ${esc(FIRST_SYNCED_SEASON)} onward
      <span class="muted">· ${esc(FIRST_SYNCED_SEASON - LEAGUE_FOUNDED)} earlier seasons predate the records</span>
    </p>

    <section class="card recbook records-fold" data-collapse="hist-records-week"
             data-collapse-title="Single week" data-collapse-badge="6 records"
             data-collapse-default="folded">
      ${recRow("Highest score", high && high.score.toFixed(2),
               high && who(high).label, high && `${high.season} · Week ${high.week}`)}
      ${recRow("Lowest score", low && low.score.toFixed(2),
               low && who(low).label, low && `${low.season} · Week ${low.week}`)}
      ${recRow("Biggest blowout", blow && margin(blow).toFixed(2) + " pts",
               blow && sideName(blow, winnerSide),
               blow && `beat ${sideName(blow, loserSide)} · ${blow.season} Wk ${blow.week}`)}
      ${recRow("Closest finish", near && margin(near).toFixed(2) + " pts",
               near && sideName(near, winnerSide),
               near && `over ${sideName(near, loserSide)} · ${near.season} Wk ${near.week}`)}
      ${recRow("Highest combined", shoot && (Number(shoot.score1) + Number(shoot.score2)).toFixed(2),
               shoot && `${sideName(shoot, winnerSide)} v ${sideName(shoot, loserSide)}`,
               shoot && `${shoot.season} · Week ${shoot.week}`)}
      ${recRow("Best losing score", hardLuck && hardLuck.score.toFixed(2),
               hardLuck && who(hardLuck).label,
               hardLuck && `lost ${hardLuck.against.toFixed(2)} · ${hardLuck.season} Wk ${hardLuck.week}`)}
    </section>

    <section class="card recbook records-fold" data-collapse="hist-records-seasons"
             data-collapse-title="Seasons &amp; streaks" data-collapse-badge="4 records"
             data-collapse-default="folded">
      ${recRow("Most points, season", seasons.points && seasons.points.points_for.toFixed(2),
               seasons.points && name(seasons.points.sleeper_user_id, seasons.points.season,
                                      seasons.points.roster_id).label,
               seasons.points && String(seasons.points.season))}
      ${recRow("Best record, season", seasons.record &&
                 `${seasons.record.wins}-${seasons.record.losses}${seasons.record.ties ? "-" + seasons.record.ties : ""}`,
               seasons.record && name(seasons.record.sleeper_user_id, seasons.record.season,
                                      seasons.record.roster_id).label,
               seasons.record && String(seasons.record.season))}
      ${recRow("Longest win streak", longestWin && longestWin.run + " weeks",
               longestWin && name(longestWin.user).label,
               longestWin && spanLabel(longestWin.from, longestWin.to))}
      ${recRow("Longest losing streak", longestLoss && longestLoss.run + " weeks",
               longestLoss && name(longestLoss.user).label,
               longestLoss && spanLabel(longestLoss.from, longestLoss.to))}
    </section>

    ${rec.error ? "" : tradeBoard(rec.trades, data)}
  `;

  const fleeceHost = body.querySelector("[data-fleece-board]");
  if (fleeceHost) {
    loadTradeOutcomes(rec.trades, data).then(result => {
      if (!fleeceHost.isConnected) return;
      fleeceHost.innerHTML = result.error
        ? `<p class="muted tiny">Historical trade outcomes could not be loaded.</p>`
        : fleeceBoard(result.rankings, data, result.players);
    });
  }
}

/** One record: what it is, the number, who holds it, and when. */
function recRow(label, value, holder, when) {
  if (!value) return "";
  return `
    <div class="rec">
      <span class="rec-label">${esc(label)}</span>
      <span class="rec-who">
        ${esc(holder || "—")}
        ${when ? `<span class="rec-when">${esc(when)}</span>` : ""}
      </span>
      <span class="rec-val">${esc(value)}</span>
    </div>`;
}

function seasonRecords(standings) {
  const played = (standings || []).filter((s) => s.wins + s.losses + s.ties > 0);
  return {
    points: best(played, (s) => Number(s.points_for) || 0),
    record: best(played, (s) => {
      const games = s.wins + s.losses + s.ties;
      // Win rate, with games played as the tie-break, so a 3-0 partial season
      // does not outrank a 13-1 full one.
      return games ? (s.wins + s.ties / 2) / games + games / 1000 : 0;
    }),
  };
}

/** Who trades. Counted per roster, since a trade names rosters, not users. */
function tradeBoard(allTrades, data) {
  const trades = allTrades.filter((t) => t.status === "complete" && t.details?.status === "complete");
  if (!trades.length) return "";

  const perRoster = new Map();      // "season:rosterId" -> count
  for (const t of trades) {
    for (const rid of t.details?.roster_ids || []) {
      const key = `${t.season}:${rid}`;
      perRoster.set(key, (perRoster.get(key) || 0) + 1);
    }
  }

  // Roll the season-and-roster counts up to the owner behind them.
  const owner = new Map(data.standings.map((s) => [`${s.season}:${s.roster_id}`, s.sleeper_user_id]));
  const perUser = new Map();
  for (const [key, n] of perRoster) {
    const uid = owner.get(key);
    if (!uid) continue;
    perUser.set(uid, (perUser.get(uid) || 0) + n);
  }

  const name = namer(data);
  const rows = [...perUser.entries()]
    .map(([uid, n]) => ({ who: name(uid), n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);

  if (!rows.length) return "";

  return `<section class="card records-fold records-trades" data-collapse="hist-records-trades"
                  data-collapse-title="Trades" data-collapse-badge="${trades.length} completed"
                  data-collapse-default="folded">
    <div class="trade-fleece-shell" data-fleece-board>${loading("Grading the completed trades…")}</div>
    <div class="recbook trade-leaders">
      ${rows.map((r, i) => `
        <div class="rec">
          <span class="rec-label">${i === 0 ? "Most trades" : ""}</span>
          <span class="rec-who">${esc(r.who.label)}</span>
          <span class="rec-val">${r.n}</span>
        </div>`).join("")}
    </div>
  </section>`;
}

let tradeOutcomeCache = null;
async function loadTradeOutcomes(trades, data) {
  if (tradeOutcomeCache) return tradeOutcomeCache;
  tradeOutcomeCache = (async () => {
    try {
      const lastCalendarSeason = new Date().getFullYear() - 1;
      const completedSeasons = data.leagues.filter(row => row.scoring_settings && (
        row.status === "complete" || Number(row.season) <= lastCalendarSeason
      ))
        .map(row => Number(row.season)).filter(Number.isFinite);
      const latestSeason = Math.max(0, ...completedSeasons);
      const scoringBySeason = new Map(data.leagues.map(row => [Number(row.season), row.scoring_settings]));
      const years = [...new Set(trades.flatMap(trade => {
        const out = [];
        for (let year = Number(trade.season); year <= Math.min(Number(trade.season) + 2, latestSeason); year++) {
          if (scoringBySeason.get(year)) out.push(year);
        }
        return out;
      }))].sort();
      const [players, ...stats] = await Promise.all([loadPlayers(), ...years.map(loadSeasonStats)]);
      const statsBySeason = new Map(years.map((year, index) => [year, stats[index]?.data || {}]));
      return { players, rankings: rankTradeFleeces({ trades, latestSeason, statsBySeason, scoringBySeason, players }), error: null };
    } catch (error) {
      return { players: {}, rankings: [], error };
    }
  })();
  return tradeOutcomeCache;
}

function fleeceBoard(rankings, data, players) {
  if (!rankings.length) return `<p class="muted tiny">No completed trade has enough post-trade history to grade yet.</p>`;
  const limit = 5;
  const name = namer(data);
  const owner = new Map(data.standings.map(row => [`${row.season}:${row.roster_id}`, row.sleeper_user_id]));
  const team = (trade, side) => name(owner.get(`${trade.season}:${side.rosterId}`), trade.season, side.rosterId).label;
  const assets = side => side.playerIds.map(id =>
    `<b class="fleece-player">${esc(players[id]?.n || `Player ${id}`)}</b>`).join("");
  const card = (row, index) => `<article class="fleece-card">
    <div class="fleece-top"><div class="fleece-rank">#${index + 1}</div><div class="fleece-meta">Week ${esc(row.trade.week || "—")}<b>+${esc(row.gap.toFixed(1))} starter-impact gap</b></div></div>
    <div class="fleece-compare">
      <div class="fleece-side is-winner"><small>BEST SIDE</small><strong>${esc(team(row.trade, row.winner))}</strong><div class="fleece-assets"><em>RECEIVED</em>${assets(row.winner)}</div></div>
      <span class="fleece-vs" aria-hidden="true">VS</span>
      <div class="fleece-side is-loser"><small>WORST SIDE</small><strong>${esc(team(row.trade, row.loser))}</strong><div class="fleece-assets"><em>RECEIVED</em>${assets(row.loser)}</div></div>
    </div>
  </article>`;
  const bySeason = new Map();
  for (const row of rankings) {
    const season = Number(row.trade.season);
    if (!bySeason.has(season)) bySeason.set(season, []);
    bySeason.get(season).push(row);
  }
  const seasons = [...bySeason.entries()].sort((a, b) => b[0] - a[0]);

  return `<div class="fleece-head"><div><strong>Biggest fleeces</strong><span>Each season ranked independently</span></div><span class="pill">TOP 5 / SEASON</span></div>
    <div class="fleece-seasons">${seasons.map(([season, rows]) => `
      <section class="card fleece-season" data-collapse="hist-fleeces-${esc(season)}"
               data-collapse-title="${esc(season)}"
               data-collapse-badge="${Math.min(limit, rows.length)} ranked trade${Math.min(limit, rows.length) === 1 ? "" : "s"}"
               data-collapse-default="folded">
        <div class="fleece-list">${rows.slice(0, limit).map(card).join("")}</div>
      </section>`).join("")}</div>
    <p class="fleece-method"><strong>Starter-impact gap</strong> measures each acquired player’s DFL points above a position-specific replacement starter in the completed trade season and up to two seasons after it. Those seasons count 50/30/20, while extra package pieces receive diminishing weight (100/50/25/10) so several bench players cannot outweigh one elite starter by volume alone. The active season and pending trades are never graded, and only transactions marked complete count.</p>`;
}

// -------------------------------- bits --------------------------------

function sum(rows, key) {
  return rows.reduce((t, r) => t + Number(r[key] || 0), 0);
}

function countBy(rows, key) {
  const map = new Map();
  for (const r of rows) {
    const v = r[key];
    if (v) map.set(v, (map.get(v) || 0) + 1);
  }
  return map;
}

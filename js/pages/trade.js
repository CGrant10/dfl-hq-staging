// =====================================================================
// pages/trade.js - the Trade Desk, on its own page
// ---------------------------------------------------------------------
// It was a section inside the analyzer report, which put a decision with
// a clock on it two taps behind a page you read at leisure. A trade offer
// arrives and you want to answer it now.
//
// It borrows the report's shell deliberately - the same .ta-report card,
// the same lead block, the same section headers - because it is the same
// tool family and a second visual language would just make the app feel
// assembled from parts. Only the desk itself is different.
//
// The evaluation is unchanged: evaluateTrade() via trade-desk.js, on the
// league's own full-PPR scoring.
// =====================================================================

import { esc, errorBox, toast } from "../ui.js";
import { currentMember } from "../members.js";
import { loadAnalyzerData } from "../team-analyzer-data.js";
import { mountTradeDesk, recommendationFor, tradeDeskMarkup, tradeReasons, verdictFor } from "../trade-desk.js";
import { shareDeal } from "../trade-card.js";
import { suggestTrades } from "../team-analyzer.js";

const teamName = team => team?.team_name || team?.ownerName || `Team ${team?.roster_id || ""}`;
const ordinal = value => {
  const n = Number(value), mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`;
};

/*
  WHAT THE LEAD BLOCK IS FOR NOW.

  It used to print a projected finish and four KPIs above the desk - a second
  summary of the roster on the one page that is not about the roster. The
  ticket is the lead now, so this is one line: who is trading, and the single
  fact that should steer which players get tapped.
*/
function lead(team, count) {
  return `<header class="td-who">
    <div>
      <small>Trading as</small>
      <strong>${esc(teamName(team))}</strong>
      <span>${esc(team.ownerName)} &middot; ${ordinal(team.rank)} of ${count} &middot; ${team.playerIds.length} rostered</span>
    </div>
    ${team.need ? `<div class="td-need"><small>Shopping for</small><b>${esc(team.need)}</b></div>` : ""}
  </header>`;
}

const signed = value => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Number(value) || 0).toFixed(1)}`;
const playerNames = (ids, pool) => ids.map(id => pool.get(String(id))?.name || String(id)).join(" + ");

/*
  THE LAB BELONGS BESIDE THE DESK.

  It was the last thing on the analyzer report, which meant the two halves of
  one job - "what could I trade" and "is this trade good" - sat on different
  pages. They are the same question asked in either direction, so they are now
  the same page: propose above, judge below.
*/
function tradeLab(team, teams, pool, shop) {
  const otherTeams = teams.filter(item => item.id !== team.id);
  const partner = otherTeams.find(item => String(item.id) === String(shop.partnerId)) || otherTeams[0];
  if (shop.side === "theirs" && !shop.partnerId) shop.partnerId = partner?.id || "";
  const anchorTeam = shop.side === "theirs" ? partner : team;
  const players = (anchorTeam?.playerIds || []).map(id => pool.get(id)).filter(Boolean).sort((a, b) => b.tradeValue - a.tradeValue);
  const first = players.find(player => player.id === shop.playerA) || players[0];
  const second = players.find(player => player.id === shop.playerB && player.id !== first?.id);
  const anchors = [first?.id, second?.id].filter(Boolean);
  const offers = anchors.length ? suggestTrades({ teams, teamId: team.id, playerIds: anchors, partnerId: shop.partnerId || undefined, anchorTeamId: anchorTeam?.id, pool, limit: 8 }) : [];
  const playerOptions = (selected, exclude, optional = false) => `${optional ? '<option value="">None</option>' : ""}${players.filter(player => player.id !== exclude).map(player => `<option value="${esc(player.id)}" ${player.id === selected ? "selected" : ""}>${esc(player.name)} · ${player.position} · ${player.tradeValue}</option>`).join("")}`;
  const controls = `<div class="ta-shop-controls">
    <label><span>Player from</span><select data-ta-shop-side><option value="mine" ${shop.side !== "theirs" ? "selected" : ""}>My team</option><option value="theirs" ${shop.side === "theirs" ? "selected" : ""}>Another team</option></select></label>
    <label><span>Trade with</span><select data-ta-shop-partner>${shop.side === "theirs" ? "" : '<option value="">Any team</option>'}${otherTeams.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(shop.partnerId) ? "selected" : ""}>${esc(teamName(item))}</option>`).join("")}</select></label>
    <label><span>Player 1</span><select data-ta-player="a">${playerOptions(first?.id, second?.id)}</select></label>
    <label><span>Player 2</span><select data-ta-player="b">${playerOptions(second?.id, first?.id, true)}</select></label>
  </div>`;
  return `<details class="ta-report-section ta-trades"${shop.expanded ? " open" : ""}>
    <summary class="ta-report-title"><div><small>SMART STARTS</small><h2>Deals worth exploring</h2></div><span class="ta-fold-hint">Optional</span><span class="ta-fold-chevron" aria-hidden="true"></span></summary>
    <div class="ta-section-body">
      ${controls}
      ${offers.length ? `<div class="ta-deal-grid">${offers.map(offer => {
        const call = recommendationFor(offer);
        return `<article class="ta-deal-card">
          <header><div><small>${esc(teamName(offer.other))}</small><strong>${offer.sendA.length === 1 && offer.sendB.length === 1 ? "Straight-up deal" : "Package deal"}</strong></div><span class="td-call is-${call.tone}">${call.action}</span></header>
          <div class="ta-deal-flow"><div><small>YOU SEND</small><b>${esc(playerNames(offer.sendA, pool))}</b></div><i aria-hidden="true">→</i><div><small>YOU GET</small><b>${esc(playerNames(offer.sendB, pool))}</b></div></div>
          <dl><div><dt>Balance</dt><dd>${offer.fairness}%</dd></div><div><dt>Your lineup</dt><dd class="${offer.weeklyDeltaA >= 0 ? "positive" : "negative"}">${signed(offer.weeklyDeltaA)} / wk</dd></div></dl>
          <button type="button" class="btn ghost small" data-td-load-offer data-partner="${esc(offer.other.id)}" data-send-a="${esc(offer.sendA.join(","))}" data-send-b="${esc(offer.sendB.join(","))}">Analyze this deal</button>
        </article>`;
      }).join("")}</div>`
        : `<div class="ta-empty">No balanced offers found for this package.</div>`}
    </div>
  </details>`;
}

/*
  A MULTI-TEAM RESULT REPORTED FROM THE FIRST PARTY'S POINT OF VIEW.

  verdictFor() and recommendationFor() both read valueToA/valueToB and
  weeklyDeltaA/B, which a three-way does not have - it has arrays. trade-desk
  does exactly this remap for the ticket; the share card has to agree with the
  ticket, so it uses the same one rather than a second interpretation.
*/
function perspectiveOf({ result, parties }) {
  if (!Array.isArray(result?.values)) return result;
  const last = parties.length - 1;
  return { ...result, valueToA: result.values[0], valueToB: result.values[1],
    weeklyDeltaA: result.weeklyDeltas[0], weeklyDeltaB: result.weeklyDeltas[last] };
}

function page(data) {
  const me = currentMember();
  const routeTeam = new URLSearchParams((location.hash.split("?")[1] || "")).get("team");
  let selectedId = data.teams.find(team => String(team.id) === String(routeTeam))?.id
    || data.teams.find(team => String(team.sleeper_user_id) === String(me?.sleeper_user_id))?.id
    || data.teams[0].id;
  const trade = { memberIds: [], sends: [new Set(), new Set()], editing: true };
  const shop = { side: "mine", partnerId: "", playerA: "", playerB: "", expanded: false };

  return {
    markup: `<header class="page-head ta-page-head">
        <div><h1>Trade Analyzer</h1><p class="page-sub">${data.projectionSeason} outlook · DFL full-PPR scoring</p></div>
        <a class="btn ghost small" href="#/analyzer">Analyzer</a>
      </header>
      <div class="ta-toolbar">
        <label><span>Your team</span>
          <select data-td-team>${data.teams.map(team =>
            `<option value="${esc(team.id)}" ${team.id === selectedId ? "selected" : ""}>${esc(teamName(team))}</option>`).join("")}</select>
        </label>
      </div>
      <main class="ta-report" data-td-body></main>`,

    wire(view) {
      const body = view.querySelector("[data-td-body]");
      /* Whatever the ticket is currently showing, so Share renders the same
         deal the reader is looking at rather than re-deriving one. */
      let deal = null;

      const draw = () => {
        const team = data.teams.find(item => item.id === selectedId) || data.teams[0];
        body.innerHTML = `${lead(team, data.teams.length)}
          <section class="ta-report-section td-deck">
            <div class="ta-section-body" data-trade-desk>${tradeDeskMarkup(team, data.teams, data.pool, trade)}</div>
            <div class="td-share"><button type="button" class="btn" data-td-share disabled>Share this ticket</button></div>
          </section>
          ${tradeLab(team, data.teams, data.pool, shop)}`;
        const share = body.querySelector("[data-td-share]");
        mountTradeDesk(body.querySelector("[data-trade-desk]"), {
          team, teams: data.teams, pool: data.pool, state: trade, onPartnerChange: draw,
          onDeal: current => {
            deal = current;
            /* Nothing to share until both sides have somebody on them, and a
               disabled button says that better than an error would. */
            if (share) share.disabled = !current;
          },
        });
        body.querySelector(".ta-trades")?.addEventListener("toggle", event => {
          shop.expanded = event.currentTarget.open;
        });
      };
      body.addEventListener("change", event => {
        if (event.target.matches("[data-ta-shop-side]")) {
          shop.side = event.target.value; shop.playerA = ""; shop.playerB = "";
          if (shop.side === "theirs" && !shop.partnerId) shop.partnerId = data.teams.find(item => item.id !== selectedId)?.id || "";
          draw(); return;
        }
        if (event.target.matches("[data-ta-shop-partner]")) {
          shop.partnerId = event.target.value; shop.playerA = ""; shop.playerB = ""; draw(); return;
        }
        if (event.target.matches('[data-ta-player="a"]')) { shop.playerA = event.target.value; draw(); return; }
        if (event.target.matches('[data-ta-player="b"]')) { shop.playerB = event.target.value; draw(); }
      });
      body.addEventListener("click", async event => {
        const shareButton = event.target.closest("[data-td-share]");
        if (shareButton) {
          if (!deal) return;
          shareButton.disabled = true;
          try {
            await shareDeal({
              ...deal,
              pool: data.pool,
              verdict: verdictFor(perspectiveOf(deal)),
              recommendation: recommendationFor(perspectiveOf(deal)),
              remarks: tradeReasons(perspectiveOf(deal), deal.parties[0], deal.parties.at(-1),
                data.pool, deal.sends[0], deal.sends.at(-1)),
              member: me,
            });
          } catch (error) {
            toast(error?.message || "Could not build that card", true);
          } finally {
            shareButton.disabled = false;
          }
          return;
        }
        const button = event.target.closest("[data-td-load-offer]");
        if (!button) return;
        trade.memberIds = [button.dataset.partner];
        trade.sends = [
          new Set((button.dataset.sendA || "").split(",").filter(Boolean)),
          new Set((button.dataset.sendB || "").split(",").filter(Boolean)),
        ];
        draw();
        body.querySelector("[data-td-verdict]")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      view.querySelector("[data-td-team]").addEventListener("change", event => {
        selectedId = event.currentTarget.value;
        /* Both sides referred to rosters that are no longer in play. */
        trade.memberIds = []; trade.sends = [new Set(), new Set()]; trade.editing = true;
        shop.side = "mine"; shop.partnerId = ""; shop.playerA = ""; shop.playerB = ""; shop.expanded = false;
        draw();
      });
      draw();
    },
  };
}

export async function render(view) {
  view.innerHTML = `<header class="page-head"><h1>Trade Analyzer</h1>
    <p class="page-sub">Reading every roster…</p></header>
    <div class="card"><div class="card-body muted">Building the league outlook…</div></div>`;
  try {
    const data = await loadAnalyzerData();
    if (data.state !== "ready") {
      view.innerHTML = `<header class="page-head"><h1>Trade Analyzer</h1></header>
        <div class="card"><div class="card-body"><strong>No populated Sleeper rosters yet.</strong>
        <p class="muted">Run a Sleeper sync after the draft, then come back here.</p></div></div>`;
      return;
    }
    const built = page(data);
    view.innerHTML = built.markup;
    built.wire(view);
  } catch (error) {
    view.innerHTML = errorBox(error);
  }
}

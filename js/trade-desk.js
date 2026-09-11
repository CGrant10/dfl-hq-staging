// =====================================================================
// trade-desk.js - build a trade by hand and see who wins
// ---------------------------------------------------------------------
// The Trade Lab proposes deals. This is the other half: you already have
// a trade in mind, or somebody has offered you one, and the only question
// is whether to take it.
//
// It does not invent a second opinion. evaluateTrade() in team-analyzer.js
// is the same function the Lab's suggestions are scored with, and it runs
// on the league's own scoring settings - full PPR here, read from the
// synced Sleeper league rather than assumed. A trade judged here and the
// same trade suggested there cannot disagree.
//
// TWO ANSWERS, NOT ONE, because they are different questions and a single
// verdict hides the interesting case:
//
//   VALUE  - who gave up more, in asset terms. This is the "fair or not"
//            question, and it is the one that matters for a rebuild.
//   LINEUP - what it does to each side's weekly points RIGHT NOW. A
//            perfectly fair trade by value can still improve one starting
//            lineup and not the other, because value counts depth a
//            starting eleven cannot use.
//
// Rendering and event handling live here rather than in analyzer.js so a
// checkbox does not force the whole report to redraw - see update(), which
// repaints the verdict alone.
// =====================================================================

import { evaluateMultiTeamTrade, evaluateTrade } from "./team-analyzer.js";
import { esc } from "./ui.js";

const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
const signed = value => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(num(value)).toFixed(1)}`;
const teamName = team => team?.team_name || team?.ownerName || `Team ${team?.roster_id || ""}`;

/* Fairness is a percentage of the larger package, so the bands are about
   how lopsided a deal is rather than how big it is. */
export function verdictFor(result) {
  if (!result) return null;
  const gap = num(result.valueToA) - num(result.valueToB);
  const fairness = num(result.fairness);
  if (fairness >= 88) return { tone: "even", headline: "Balanced", who: null };
  const who = gap > 0 ? "a" : "b";
  if (fairness >= 72) return { tone: "slight", headline: "Slight edge", who };
  if (fairness >= 55) return { tone: "clear", headline: gap < 0 ? "FLEECE" : "Clear winner", who };
  return { tone: "lopsided", headline: "FLEECE", who };
}

/* The recommendation is from team A's point of view. Value carries a little
   more weight than one projected week, while a material lineup swing can
   still move a close deal. The thresholds deliberately leave a negotiation
   band instead of pretending every small model difference is decisive. */
export function recommendationFor(result) {
  if (!result) return null;
  const valueGap = num(result.valueToA) - num(result.valueToB);
  const valueBase = Math.max(num(result.valueToA), num(result.valueToB), 1);
  const valueEdge = valueGap / valueBase * 100;
  const signal = valueEdge * .55 + num(result.weeklyDeltaA) * 8;
  if (signal >= 7) return { action: "ACCEPT", tone: "accept", signal, valueEdge };
  if (signal <= -7) return { action: "FLEECE", tone: "pass", signal, valueEdge };
  return { action: "NEGOTIATE", tone: "negotiate", signal, valueEdge };
}

function playerRow(player, side, checked) {
  const search = `${player.name} ${player.position} ${player.nflTeam}`.toLowerCase();
  return `<label class="td-player ${checked ? "is-picked" : ""}" data-td-player-row data-search="${esc(search)}">
    <input type="checkbox" data-td-pick="${side}" value="${esc(player.id)}" ${checked ? "checked" : ""}>
    <span class="td-player-copy">
      <b>${esc(player.name)}</b>
      <small>${esc(player.position)} · ${esc(player.nflTeam)} · ${Math.round(num(player.expectedPoints))} pts</small>
    </span>
    <span class="td-value">${Math.round(num(player.tradeValue))}</span>
  </label>`;
}

function sideList(team, pool, picked, side, label) {
  const players = (team?.playerIds || []).map(id => pool.get(String(id))).filter(Boolean)
    .sort((a, b) => num(b.tradeValue) - num(a.tradeValue));
  return `<div class="td-side">
    <div class="td-side-head">
      <div><small>${esc(label || (side === "a" ? "YOU SEND" : "YOU GET"))}</small>
      <strong>${esc(teamName(team))}</strong></div>
      <span class="td-picked-count" data-td-count="${side}">${picked.size} picked</span>
    </div>
    <label class="td-search"><span class="sr-only">Search ${esc(teamName(team))}</span><input type="search" data-td-filter="${side}" placeholder="Search players" autocomplete="off"></label>
    <div class="td-list">${players.map(p => playerRow(p, side, picked.has(String(p.id)))).join("")
      || `<p class="td-empty">No rated players on this roster.</p>`}</div>
  </div>`;
}

/*
  THE DFLYZER.

  "Why the model makes this call" over four politely-worded observations was
  accurate and nobody read it. This is a league that keeps receipts; a tool
  that tells you a trade is bad should say so in a voice somebody will
  actually screenshot.

  THE RULE, AND IT IS THE WHOLE RULE: the voice changes, the numbers do not.
  Every remark below is welded to a figure evaluateTrade() computed - value
  gap, fairness band, weekly lineup delta, package sizes, position need - and
  the figure is printed in the same sentence that mocks you for it. Trash talk
  with a citation is funny. Trash talk without one is just noise, and the
  first time the DFLyzer calls a fair trade a robbery it stops being worth
  reading.

  Weighted rather than push-ordered: a genuine fleecing has to lead, and on a
  boring even swap the interesting remark is whatever else is true.
*/
export function tradeReasons(result, teamA, teamB, pool, sendA, sendB) {
  const incoming = sendB.map(id => pool.get(String(id))).filter(Boolean);
  const outgoing = sendA.map(id => pool.get(String(id))).filter(Boolean);
  const need = teamA?.need;
  const fillsNeed = need && incoming.some(player => player.position === need);
  const givesStrength = teamA?.strength && outgoing.some(player => player.position === teamA.strength);
  const valueGap = num(result.valueToA) - num(result.valueToB);
  const gap = Math.abs(valueGap).toFixed(1);
  const fairness = num(result.fairness);
  const bestIn = Math.max(0, ...incoming.map(player => num(player.tradeValue)));
  const bestOut = Math.max(0, ...outgoing.map(player => num(player.tradeValue)));
  const weakIncoming = incoming.filter(player => num(player.tradeValue) < bestOut * .5).length;
  const quantityTrap = sendA.length === 1 && sendB.length >= 2
    && weakIncoming >= 2 && valueGap < 0 && fairness < 75;
  const them = teamName(teamB);
  const reasons = [];

  /* ---- who is fleecing whom ------------------------------------------ */
  if (fairness < 55 && valueGap > 0) {
    reasons.push({ tone: "good", weight: 100,
      title: "You are committing the robbery. Hit accept.",
      copy: `${fairness}% balance with ${gap} value points coming your way. Take the money, kill the headlights, and get the hell out before they realize what they signed.` });
  } else if (fairness < 55) {
    reasons.push({ tone: "bad", weight: 100,
      title: "FLEECE. They are robbing your ass blind.",
      copy: `${fairness}% balance and ${gap} value points walking out the door. ${them} is trying to leave with your best shit while you thank them for the privilege. Reject this garbage.` });
  } else if (Math.abs(valueGap) < 4) {
    reasons.push({ tone: "neutral", weight: 70,
      title: "Fair as hell. Weird, but fine.",
      copy: `${gap} value points between the packages at ${fairness}% balance. Boring as hell, annoyingly responsible, and perfectly fine. Shake hands.` });
  } else if (valueGap > 0) {
    reasons.push({ tone: "good", weight: 84,
      title: "Damn, you actually won this one.",
      copy: `The incoming side grades ${gap} points higher after roster cuts, at ${fairness}% balance. A sexy little piece of business without getting reckless.` });
  } else {
    reasons.push({ tone: "bad", weight: 84,
      title: "This deal is dogshit. Stop negotiating.",
      copy: `Your outgoing side grades ${gap} points higher after roster cuts, at ${fairness}% balance. You are paying the dumbass tax so ${them} can upgrade for free.` });
  }

  /* ---- what it does to the only lineup you can actually start -------- */
  if (result.weeklyDeltaA >= .25) {
    reasons.push({ tone: "good", weight: 76,
      title: "Your Sundays just got sexier.",
      copy: `The best legal lineup projects ${signed(result.weeklyDeltaA)} points a week after this. That is real production, not horny spreadsheet math.` });
  } else if (result.weeklyDeltaA <= -1.5) {
    reasons.push({ tone: "bad", weight: 80,
      title: "Congrats, you paid to suck more.",
      copy: `The best legal lineup projects ${signed(result.weeklyDeltaA)} points a week after this. That is competitive self-harm with paperwork.` });
  } else if (result.weeklyDeltaA <= -.25) {
    /* Banded, because the same sentence over −0.3 and over −6.0 makes the
       DFLyzer sound like it cannot read its own numbers - and the moment it
       oversells one of them, nobody believes the next one either. */
    reasons.push({ tone: "warn", weight: 66,
      title: "A small kick in the ass.",
      copy: `${signed(result.weeklyDeltaA)} points a week. A bruise, not a funeral—but you had better be getting long-term value for the pain.` });
  } else {
    reasons.push({ tone: "neutral", weight: 58,
      title: "All that work for jack shit.",
      copy: `${signed(result.weeklyDeltaA)} points a week. All that tapping for jack shit on Sunday, so make sure the roster shape is actually the point.` });
  }

  /* ---- a real player for spare parts --------------------------------- */
  if (quantityTrap) {
    const title = sendB.length >= 4
      ? "They emptied the roster toilet and called it a package"
      : sendB.length === 3
        ? "Three bench turds in a trench coat are not a starter"
        : "Two pieces of shit still do not make a star";
    reasons.push({ tone: "bad", weight: 92, title,
      copy: `${them} sent ${sendB.length} names, but the best is worth ${bestIn} against the ${bestOut} leaving your roster. After cuts, this shit sandwich still costs you ${gap} value points.` });
  } else if (bestIn >= bestOut * 1.8 && bestOut > 0) {
    reasons.push({ tone: "good", weight: 74,
      title: "Less crap, more star power.",
      copy: `Your best piece out is worth ${bestOut}; the best coming back is worth ${bestIn}. That is grown-ass roster construction: turn clutter into someone opponents fear.` });
  } else if (bestOut >= bestIn * 1.8 && bestIn > 0) {
    reasons.push({ tone: "bad", weight: 78,
      title: "You are selling a stud for spare change.",
      copy: `Out goes a ${bestOut}; back comes a ${bestIn} as the headline piece. That is how you wake up with regret and three waiver-wire chores.` });
  }

  /* ---- the hole, and the thing you are selling to plug it ------------ */
  if (fillsNeed) {
    reasons.push({ tone: "good", weight: 72,
      title: `Your ${need} room finally stops sucking.`,
      copy: `${incoming.filter(player => player.position === need).map(player => `${player.name} (${num(player.tradeValue)})`).join(" and ")} lands in the worst unit on your roster. Your ugly-ass ${need} room finally looks playable.` });
  }
  if (givesStrength) {
    reasons.push({ tone: "warn", weight: 68,
      title: `You fixed one hole by opening another dumb one.`,
      copy: `${outgoing.filter(player => player.position === teamA.strength).map(player => `${player.name} (${num(player.tradeValue)})`).join(" and ")} comes from ${teamA.strength}, currently the one damn thing your roster does well.` });
  }

  /* ---- roster arithmetic --------------------------------------------- */
  if (sendB.length > sendA.length && !quantityTrap) {
    reasons.push({ tone: "warn", weight: 54,
      title: `${sendB.length} bodies in. Check the damn quality.`,
      copy: `Those ${sendB.length} incoming pieces count only if they beat the players they displace. Otherwise you traded for extra asses and a cut-day headache.` });
  }

  /* ---- and the part nobody wants to hear ------------------------------ */
  if (result.weeklyDeltaB > .35) {
    reasons.push({ tone: "warn", weight: 62,
      title: `${them} is getting off on this too.`,
      copy: `Their lineup gains ${signed(result.weeklyDeltaB)} a week too. Everybody can leave happy—just make sure they are not getting the better orgasm.` });
  } else if (result.weeklyDeltaB <= -.4 && result.weeklyDeltaA > 0) {
    reasons.push({ tone: "neutral", weight: 60,
      title: `${them} would have to be drunk.`,
      copy: `Their lineup drops ${Math.abs(num(result.weeklyDeltaB)).toFixed(1)} a week. Sending it is free; expecting a yes is drunk-text confidence.` });
  }

  return reasons.sort((a, b) => b.weight - a.weight).slice(0, 4);
}

/*
  THE DEAL TICKET.

  This was .td-verdict: a recommendation chip beside a bigger word, a bare
  fairness percentage, two "scales", two impact cells and the reasons. It
  contained the right facts in the wrong order - the loudest thing on it was
  "Balanced" or "Clear winner", not the actual advice, and 68% balance means
  nothing to a reader who does not know that 88+ is even and under 55 is
  lopsided.

  It is a document now. Two columns totalled like an invoice, so "who gave up
  more" is arithmetic you can see rather than a percentage you have to trust;
  the call stamped across the middle at 34px, because it is the answer to the
  only question this page is ever asked; and the balance drawn against
  verdictFor()'s real bands instead of printed as a number.

  It is also the same shape as the Sportsbook entry card, which is already the
  app's idea of "a thing that records a wager" - and a trade is a wager on two
  rosters. That is what makes it shareable, and a trade argument happens in the
  group chat, not on this page.
*/
function packageRows(ids, pool) {
  const players = ids.map(id => pool.get(String(id))).filter(Boolean)
    .sort((a, b) => num(b.tradeValue) - num(a.tradeValue));
  if (!players.length) return `<div class="td-item is-empty"><span><b>Nobody yet</b></span></div>`;
  return players.map(player => `<div class="td-item">
    <span><b>${esc(player.name)}</b><small>${esc(player.position)} &middot; ${esc(player.nflTeam)}</small></span>
    <span class="td-item-value">${Math.round(num(player.tradeValue))}</span>
  </div>`).join("");
}

/* The marker's position IS the fairness number, and the bands behind it are
   verdictFor()'s thresholds - so where the needle sits and what the headline
   calls it cannot disagree. */
function balanceMeter(fairness) {
  const at = Math.max(0, Math.min(100, num(fairness)));
  return `<div class="td-balance">
    <div class="td-balance-track"><i style="left:${at}%"><b>${at}% balance</b></i></div>
    <div class="td-balance-scale"><span>Lopsided</span><span>Even split</span></div>
  </div>`;
}

function reasonList(reasons) {
  return `<div class="td-reasoning">
    <h3>What the DFLyzer thinks of this trade</h3>
    ${reasons.map(reason => `<article class="td-reason is-${reason.tone}">
      <i aria-hidden="true">${REASON_MARK[reason.tone] || "="}</i>
      <div><strong>${esc(reason.title)}</strong><p>${esc(reason.copy)}</p></div>
    </article>`).join("")}
  </div>`;
}

const REASON_MARK = { good: "↑", bad: "↓", warn: "!", neutral: "=" };

function idleTicket() {
  return `<div class="td-ticket is-idle">
    <div class="td-ticket-head">
      <small>DFL Trade Analyzer</small>
      <h2>No deal yet</h2>
      <span>Pick at least one player from each side and the ticket fills in.</span>
    </div>
  </div>`;
}

function ticketMarkup(result, teamA, teamB, pool, sendA, sendB) {
  if (!result) return idleTicket();
  const v = verdictFor(result);
  const recommendation = recommendationFor(result);
  const winner = v.who === "a" ? teamA : v.who === "b" ? teamB : null;
  const reasons = tradeReasons(result, teamA, teamB, pool, sendA, sendB);
  const need = teamA?.need;
  const incoming = sendB.map(id => pool.get(String(id))).filter(Boolean);
  const fills = need ? incoming.filter(player => player.position === need) : [];
  /* Value and lineup are reported separately and never averaged: a fair trade
     that helps only one starting lineup is a real and common shape, and
     blending the two into one score would hide exactly that. */
  return `<div class="td-ticket is-${v.tone}">
    <div class="td-ticket-head">
      <small>DFL Trade Analyzer</small>
      <h2>${esc(teamName(teamA))} <i aria-hidden="true">&rlarr;</i> ${esc(teamName(teamB))}</h2>
      <span>${esc(v.headline)}${winner ? ` &middot; ${esc(teamName(winner))} wins it` : ""}</span>
    </div>

    <div class="td-cols">
      <div class="td-col">
        <small>You send</small>
        ${packageRows(sendA, pool)}
        <div class="td-total"><small>Worth to them</small><b>${Math.round(num(result.valueToB))}</b></div>
      </div>
      <div class="td-col">
        <small>You get</small>
        ${packageRows(sendB, pool)}
        <div class="td-total"><small>Worth to you</small><b class="td-in">${Math.round(num(result.valueToA))}</b></div>
      </div>
    </div>
    <div class="td-stamp is-${recommendation.tone}">
      <strong>${recommendation.action}</strong>
      <span>${recommendation.action === "FLEECE" ? `${esc(teamName(teamA))} is getting robbed` : `For ${esc(teamName(teamA))}`}</span>
    </div>

    <div class="td-lines">
      <div class="td-line"><span>Your lineup</span><b class="${result.weeklyDeltaA >= 0 ? "is-up" : "is-down"}">${signed(result.weeklyDeltaA)} / wk</b></div>
      <div class="td-line"><span>${esc(teamName(teamB))} lineup</span><b class="${result.weeklyDeltaB >= 0 ? "is-up" : "is-down"}">${signed(result.weeklyDeltaB)} / wk</b></div>
      ${need ? `<div class="td-line"><span>Fills your ${esc(need)} need</span><b class="${fills.length ? "is-up" : "is-down"}">${fills.length ? `${esc(fills.map(p => p.name).join(", "))} &check;` : "No"}</b></div>` : ""}
    </div>

    ${balanceMeter(result.fairness)}
    ${reasonList(reasons)}
  </div>`;
}

/*
  THREE OR MORE PARTIES.

  Two columns cannot hold a three-way, so the packages become a run of
  "from → to" rows and the stamp, the lines and the reasoning are unchanged -
  they are all stated from the first party's point of view either way, which
  is what "RECOMMENDATION FOR" always meant.
*/
function multiTicketMarkup(result, parties, pool, sends) {
  if (!result) return idleTicket();
  const last = parties.length - 1;
  const perspective = { ...result, valueToA: result.values[0], valueToB: result.values[1], weeklyDeltaA: result.weeklyDeltas[0], weeklyDeltaB: result.weeklyDeltas[last] };
  const v = verdictFor(perspective), recommendation = recommendationFor(perspective);
  const winnerIndex = result.values.reduce((best, value, index, values) => value > values[best] ? index : best, 0);
  const winner = parties[winnerIndex];
  const reasons = tradeReasons(perspective, parties[0], parties[last], pool, sends[0], sends[last]);
  return `<div class="td-ticket is-${v.tone}">
    <div class="td-ticket-head">
      <small>DFL Trade Analyzer</small>
      <h2>${parties.length}-team deal</h2>
      <span>${esc(v.headline)} &middot; ${esc(teamName(winner))}</span>
    </div>

    <div class="td-legs">
      ${parties.map((from, index) => {
        const to = parties[(index + 1) % parties.length];
        return `<div class="td-leg">
          <small>${esc(teamName(from))} &rarr; ${esc(teamName(to))}</small>
          ${packageRows(sends[index], pool)}
          <div class="td-total"><small>Value</small><b>${num(result.values[(index + 1) % parties.length])}</b></div>
        </div>`;
      }).join("")}
    </div>

    <div class="td-stamp is-${recommendation.tone}">
      <strong>${recommendation.action}</strong>
      <span>${recommendation.action === "FLEECE" ? `${esc(teamName(parties[0]))} is getting robbed` : `For ${esc(teamName(parties[0]))}`}</span>
    </div>

    <div class="td-lines">
      ${parties.map((party, index) => `<div class="td-line"><span>${esc(teamName(party))} lineup</span><b class="${result.weeklyDeltas[index] >= 0 ? "is-up" : "is-down"}">${signed(result.weeklyDeltas[index])} / wk</b></div>`).join("")}
    </div>

    ${balanceMeter(result.fairness)}
    ${reasonList(reasons)}
  </div>`;
}

export function tradeDeskMarkup(team, teams, pool, state) {
  state.memberIds ||= state.partnerId ? [state.partnerId] : [];
  state.sends ||= [state.sendA || new Set(), state.sendB || new Set()];
  if (state.editing == null) state.editing = true;
  const available = teams.filter(item => item.id !== team.id);
  const validIds = state.memberIds.filter((id, index, ids) => available.some(item => String(item.id) === String(id)) && ids.findIndex(other => String(other) === String(id)) === index);
  if (!validIds.length && available[0]) validIds.push(available[0].id);
  state.memberIds = validIds;
  const parties = [team, ...validIds.map(id => teams.find(item => String(item.id) === String(id))).filter(Boolean)];
  while (state.sends.length < parties.length) state.sends.push(new Set());
  state.sends.length = parties.length;
  const selectors = validIds.map((id, index) => {
    const usedElsewhere = new Set(validIds.filter((_, otherIndex) => otherIndex !== index).map(String));
    return `<div class="td-member-control"><label class="ta-inline-select"><span>${index === 0 ? "Trade with" : `Member ${index + 2}`}</span><select data-td-member="${index}">${available.filter(item => !usedElsewhere.has(String(item.id))).map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(id) ? "selected" : ""}>${esc(teamName(item))}</option>`).join("")}</select></label>${index ? `<button type="button" class="td-remove-member" data-td-remove-member="${index}" aria-label="Remove ${esc(teamName(parties[index + 1]))}">×</button>` : ""}</div>`;
  }).join("");
  const add = parties.length < teams.length ? `<button type="button" class="btn ghost small td-add-member" data-td-add-member>+ Add member</button>` : "";
  const multi = parties.length > 2;
  return `<details class="td-builder"${state.editing ? " open" : ""}>
      <summary><span>Build your trade</span><i aria-hidden="true"></i></summary>
      <div class="td-builder-body">
        <div class="td-party-controls">${selectors}${add}</div>
        <div class="td-board ${multi ? "is-multi" : ""}" style="--td-party-count:${parties.length}">
          ${parties.map((party, index) => sideList(party, pool, state.sends[index], String(index), multi ? `${teamName(party)} → ${teamName(parties[(index + 1) % parties.length])}` : index ? "YOU GET" : "YOU SEND")).join("")}
        </div>
        <div class="td-actions"><button type="button" class="btn ghost small" data-td-clear>Clear the board</button></div>
      </div>
    </details>
    <div data-td-verdict>${multi ? multiTicketMarkup(null) : ticketMarkup(null)}</div>`;
}

/**
 * Wire a rendered trade desk. Repaints only the verdict on each change, so
 * building a deal never redraws the report underneath it.
 */
export function mountTradeDesk(root, { team, teams, pool, state, onPartnerChange, onDeal }) {
  if (!root) return;
  const verdictHost = root.querySelector("[data-td-verdict]");
  root.querySelector(".td-builder")?.addEventListener("toggle", event => {
    state.editing = event.currentTarget.open;
  });
  const partiesOf = () => [team, ...state.memberIds.map(id => teams.find(item => String(item.id) === String(id))).filter(Boolean)];

  /*
    onDeal hands the page whatever the ticket is currently showing, so the
    Share button can render a card from it. Passing the evaluated result
    rather than re-deriving it is the point: a shared image that disagreed
    with the ticket above it would be worse than no image.
  */
  const update = () => {
    const parties = partiesOf(), sends = state.sends.map(set => [...set]);
    if (parties.length > 2) {
      const result = sends.every(ids => ids.length) ? evaluateMultiTeamTrade({ teams: parties, sends, pool }) : null;
      verdictHost.innerHTML = multiTicketMarkup(result, parties, pool, sends);
      onDeal?.(result ? { result, parties, sends } : null);
    } else {
      const [partner] = parties.slice(1), [sendA, sendB] = sends;
      const result = sendA.length && sendB.length ? evaluateTrade({ teamA: team, teamB: partner, sendA, sendB, pool }) : null;
      verdictHost.innerHTML = ticketMarkup(result, team, partner, pool, sendA, sendB);
      onDeal?.(result ? { result, parties: [team, partner], sends: [sendA, sendB] } : null);
    }
  };

  root.addEventListener("change", event => {
    const box = event.target.closest("[data-td-pick]");
    if (box) {
      const set = state.sends[Number(box.dataset.tdPick)];
      if (box.checked) set.add(box.value); else set.delete(box.value);
      box.closest(".td-player")?.classList.toggle("is-picked", box.checked);
      const count = root.querySelector(`[data-td-count="${box.dataset.tdPick}"]`);
      if (count) count.textContent = `${set.size} picked`;
      update();
      return;
    }
    if (event.target.matches("[data-td-member]")) {
      const index = Number(event.target.dataset.tdMember);
      state.memberIds[index] = event.target.value;
      state.sends[index + 1] = new Set();
      onPartnerChange?.();
    }
  });

  root.addEventListener("input", event => {
    const filter = event.target.closest("[data-td-filter]");
    if (!filter) return;
    const term = filter.value.trim().toLowerCase();
    const list = filter.closest(".td-side")?.querySelector(".td-list");
    list?.querySelectorAll("[data-td-player-row]").forEach(row => {
      row.hidden = Boolean(term) && !String(row.dataset.search || "").includes(term);
    });
  });

  /* A redraw rebuilds the whole desk, so the disclosure remembers itself. */
  root.querySelector(".td-builder")?.addEventListener("toggle", event => {
    state.editing = event.currentTarget.open;
  });

  root.addEventListener("click", event => {
    if (event.target.closest("[data-td-add-member]")) {
      const used = new Set([String(team.id), ...state.memberIds.map(String)]);
      const next = teams.find(item => !used.has(String(item.id)));
      if (next) { state.memberIds.push(next.id); state.sends.push(new Set()); onPartnerChange?.(); }
      return;
    }
    const remove = event.target.closest("[data-td-remove-member]");
    if (remove) {
      const index = Number(remove.dataset.tdRemoveMember);
      state.memberIds.splice(index, 1); state.sends.splice(index + 1, 1); onPartnerChange?.();
      return;
    }
    if (!event.target.closest("[data-td-clear]")) return;
    state.sends.forEach(set => set.clear());
    root.querySelectorAll("[data-td-pick]").forEach(box => {
      box.checked = false;
      box.closest(".td-player")?.classList.remove("is-picked");
    });
    root.querySelectorAll("[data-td-count]").forEach(count => { count.textContent = "0 picked"; });
    update();
  });

  update();
}

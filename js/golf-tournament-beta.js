import { db } from "./supabase.js";
import { getMemberId, loadMembers } from "./members.js";
import { esc, toast } from "./ui.js";
import { canEdit } from "./inline.js";
import { battleResult, dayPoints, pairName, roundHoles, standingLine } from "./golf-battle.js";
import { label as boardLabel, progress as boardProgress, roundBoard } from "./golf-board.js";
import { BETA_CUSTOM_MAX_SIDE, betaAddedRoundName, betaCaptainChoices, betaCustomBoardVisible, betaCustomRoundName, betaCustomSizes, betaFormatStatus, betaIsCustomRound, betaMatchCount, betaRoundLabel, betaRoundName, betaRoundTitle, betaSeatsForSide, betaSelectedRound } from "./golf-tournament-beta-format.js";
import { betaEditableSideIds, betaRouteForMember, canScoreBetaCard } from "./golf-tournament-beta-rules.js";
import { holeResult } from "./golf-score-result.js";
import { eventHasCode } from "./golf-guest.js";
import { dropPendingSides, flush, onQueueChange, pendingCountSides, pendingDetailsForSide, pendingForSide, queueSideScore, refusals } from "./golf-offline.js";
import { shareScorecard } from "./golf-scorecard-share.js";
import { shareBetaLeaderboard, shareBetaTeams, shareBetaTournament } from "./golf-tournament-beta-share.js";
import { averagePuttsLabel, roundDetailStats } from "./golf-round-stats.js";

const activeHole = new Map(), activeFormat = new Map(), leaderboardOpen = new Map(), setupMode = new Map(), setupSection = new Map();
let stopSyncWatch = () => {};
const route = () => { const [path, raw = ""] = location.hash.split("?"); const q = new URLSearchParams(raw); return { golf: path === "#/golf", id: Number(q.get("id")) || 0, classic: q.get("classic") === "1", setup: q.get("setup") === "1" }; };
const nameOf = m => m?.golf_name || m?.display_name || "Golfer";
const playerName = (p, names) => p?.member_id ? names.get(String(p.member_id)) : p?.guest_name || "Golfer";
const initials = name => String(name || "G").trim().split(/\s+/).slice(0, 2).map(x => x[0] || "").join("").toUpperCase();
const relative = n => n === 0 ? "E" : n > 0 ? `+${n}` : String(n);
const courseHoleFor = (courseHoles, hole) => { const count = Math.max(1, courseHoles?.length || 9); return ((Number(hole) - 1) % count) + 1; };
const parFor = (holes, hole) => Number(holes.find(x => Number(x.hole) === Number(hole))?.par) || Number(holes.find(x => Number(x.hole) === courseHoleFor(holes, hole))?.par) || 4;
const yardageFor = (courseHoles, hole) => { const row = (courseHoles || []).find(x => Number(x.hole) === courseHoleFor(courseHoles, hole)); return Number(row?.yardage_men) || Number(row?.yardage_women) || 0; };
const effectiveCourseId = (state, participant) => Number(participant?.course_id) || Number(state.outing.course_id) || 0;
const courseById = (state, id) => state.courses?.find(course => String(course.id) === String(id));
const courseHolesForId = (state, id) => state.courseHolesById?.get(String(id)) || state.courseHoles || state.holes || [];
const sideCourseId = (state, side) => Number(side?.players?.find(player => player.course_id)?.course_id) || Number(state.outing.course_id) || 0;
const sideCourseHoles = (state, side) => courseHolesForId(state, sideCourseId(state, side));
const sideCourseName = (state, side) => courseById(state, sideCourseId(state, side))?.name || state.outing.course || "Event course";
const memberCourseId = state => effectiveCourseId(state, state.participants.find(person => String(person.member_id) === String(getMemberId())));
const scoreKey = (side, hole) => `${side}:${hole}`;
const sideName = side => pairName(side.players.map(p => p.name));
const scoringOf = round => round?.scoring === "match" ? "match" : "strokes";
const captainName = (team, names) => team?.captain_member_id == null ? "" : names.get(String(team.captain_member_id)) || "";
const betaCacheKey = outingId => `dfl.golf.beta.${outingId}`;
const betaHoleKey = outingId => `dfl.golf.beta.hole.${outingId}`;
const scoreMark = (score, par, empty = "—") => {
  const value = Number(score) || 0, result = holeResult(value, par);
  return `<span class="tb-card-mark ${result.mark}" aria-label="${value ? `${value} strokes, ${result.label.toLowerCase()}` : "No score"}">${value || empty}</span>`;
};
const scoreRange = (strokes, holes, start, end) => {
  let total = 0, playedPar = 0, played = 0;
  for (let hole = start; hole <= end; hole += 1) {
    const value = Number(strokes.get(hole)) || 0;
    if (!value) continue;
    total += value; playedPar += parFor(holes, hole); played += 1;
  }
  return { total, playedPar, played };
};
function scorecardTable(state, sides, count, showYards = false) {
  const frontHoles = Array.from({ length: Math.min(9, count) }, (_, i) => i + 1);
  const backHoles = Array.from({ length: Math.max(0, count - 9) }, (_, i) => i + 10);
  const groups = new Map();
  for (const side of sides) { const id = sideCourseId(state, side); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(side); }
  return [...groups.entries()].map(([courseId, courseSides]) => {
    const holes = courseHolesForId(state, courseId), course = courseById(state, courseId), label = course?.name || state.outing.course || "Event course";
    const place = [course?.city, course?.state].filter(Boolean).join(", ");
    const heading = h => { const yards = showYards ? yardageFor(holes, h) : 0; return `<th>${h}<br><small>${yards ? `${yards} yd · ` : ""}Par ${parFor(holes, h)}</small></th>`; };
    const cells = (side, list) => list.map(h => `<td>${scoreMark(side.strokes.get(h), parFor(holes, h))}</td>`).join("");
    const rows = courseSides.map(side => {
    const front = scoreRange(side.strokes, holes, 1, Math.min(9, count)), back = scoreRange(side.strokes, holes, 10, count), all = scoreRange(side.strokes, holes, 1, count);
    return `<tr><th class="sticky">${esc(sideName(side))}<br><small>${esc(side.teamName)}</small></th>${cells(side, frontHoles)}<td class="tb-total">${front.total || "—"}</td>${cells(side, backHoles)}<td class="tb-total">${back.total || "—"}</td><td class="tb-total">${all.played ? relative(all.total - all.playedPar) : "—"}</td><td class="tb-total">${all.total || "—"}</td></tr>`;
    }).join("");
    return `<section class="tb-course-card"><div class="tb-course-divider"><strong>${esc(label)}</strong>${place ? `<small>${esc(place)}</small>` : ""}</div><table class="tb-table"><thead><tr><th class="sticky">Side / golfer</th>${frontHoles.map(heading).join("")}<th>Front 9</th>${backHoles.map(heading).join("")}<th>Back 9</th><th>+/−</th><th>Total ${count}</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join("");
}

const scorecardLegend = () => `<section class="tb-legend" aria-label="Scorecard legend"><h3>Scorecard Legend</h3><div class="tb-legend-grid"><div class="tb-legend-item"><span class="tb-card-mark m-eagle">3</span>Eagle</div><div class="tb-legend-item"><span class="tb-card-mark m-birdie">4</span>Birdie</div><div class="tb-legend-item"><span class="tb-card-mark m-par">5</span>Par</div><div class="tb-legend-item"><span class="tb-card-mark m-bogey">6</span>Bogey</div><div class="tb-legend-item"><span class="tb-card-mark m-dbl">7</span>D. Bogey</div><div class="tb-legend-item"><span class="tb-card-mark m-dbl">8</span>T. Bogey</div><div class="tb-legend-item"><strong>FB</strong>Fairway bunker</div><div class="tb-legend-item"><strong>GB</strong>Greenside bunker</div><div class="tb-legend-item"><strong>H₂O</strong>Water hazard</div><div class="tb-legend-item"><strong>OB</strong>Out of bounds</div><div class="tb-legend-item"><strong>D</strong>Drop shot</div></div></section>`;
const scorecardBody = table => `<div class="tb-scorecard-body"><div class="tb-table-wrap">${table}</div>${scorecardLegend()}</div>`;
function scorecardStats(state, sides) {
  return `<section class="tb-round-stats" aria-label="Round putting and drop statistics">${sides.map(side => {
    const rows = [...state.scoreRows.values()].filter(row => String(row.side_id) === String(side.id));
    const stats = roundDetailStats(rows);
    return `<div class="tb-stat-summary"><strong>${esc(sideName(side))}</strong><span><b>${stats.tracked ? stats.putts : "—"}</b><small>Putts</small></span><span><b>${stats.tracked ? averagePuttsLabel(stats.averagePutts) : "—"}</b><small>Avg / hole</small></span><span><b>${stats.tracked ? stats.drops : "—"}</b><small>Drops</small></span></div>`;
  }).join("")}</section>`;
}

function rememberHole(outingId, hole) {
  activeHole.set(outingId, hole);
  try { localStorage.setItem(betaHoleKey(outingId), String(hole)); } catch {}
}

function rememberedHole(outingId) {
  if (activeHole.has(outingId)) return Number(activeHole.get(outingId)) || 1;
  try { return Number(localStorage.getItem(betaHoleKey(outingId))) || 1; } catch { return 1; }
}

function cacheBetaState(state) {
  try {
    localStorage.setItem(betaCacheKey(state.outing.id), JSON.stringify(state, (_, value) =>
      value instanceof Map ? { __dflMap: [...value.entries()] } : value));
  } catch {}
}

function cachedBetaState(outingId) {
  try {
    const raw = localStorage.getItem(betaCacheKey(outingId));
    if (!raw) return null;
    const state = JSON.parse(raw, (_, value) => value?.__dflMap ? new Map(value.__dflMap) : value);
    const sides = new Map(state.sides.map(side => [String(side.id), side]));
    for (const entry of state.rounds) for (const battle of entry.battles) {
      battle.sides = battle.sides.map(side => sides.get(String(side.id)) || side);
    }
    for (const side of state.sides) for (const [hole, pending] of pendingDetailsForSide(side.id)) {
      const key = scoreKey(side.id, hole);
      if (pending.strokes == null) { side.strokes.delete(hole); state.scoreRows.delete(key); }
      else { side.strokes.set(hole, Number(pending.strokes)); state.scoreRows.set(key, { ...(state.scoreRows.get(key) || {}), side_id: side.id, hole, strokes: pending.strokes, putts: pending.putts || 0, drops: pending.drops || 0, pending: true }); }
    }
    refreshBattleResults(state);
    return state;
  } catch { return null; }
}

function syncText(state) {
  const sideIds = state.sides.map(side => side.id), pending = pendingCountSides(sideIds), failed = refusals(state.outing.id).length;
  if (failed) return `${failed} score${failed === 1 ? "" : "s"} need attention`;
  if (!navigator.onLine) return pending ? `Offline · ${pending} saved on this phone` : "Offline · ready to keep scoring";
  if (pending) return `${pending} score${pending === 1 ? "" : "s"} waiting to sync`;
  return state.stale ? "Offline copy · ready to score" : "Ready · all scores synced";
}

function betaBattleResult(state, sides, round) {
  if (sides.length !== 2) return null;
  const count = roundHoles(round), holesA = sideCourseHoles(state, sides[0]), holesB = sideCourseHoles(state, sides[1]);
  const normalize = (strokes, holes) => new Map([...strokes.entries()].map(([hole, value]) => [hole, 20 + Number(value) - parFor(holes, hole)]));
  const differentCourses = sideCourseId(state, sides[0]) !== sideCourseId(state, sides[1]);
  if (!differentCourses) return battleResult(sides[0].strokes, sides[1].strokes, count, scoringOf(round));
  const result = battleResult(normalize(sides[0].strokes, holesA), normalize(sides[1].strokes, holesB), count, scoringOf(round));
  const rawTotal = strokes => [...strokes.entries()].filter(([hole, value]) => Number(hole) <= count && Number(value) > 0).reduce((sum, [, value]) => sum + Number(value), 0);
  result.a = rawTotal(sides[0].strokes); result.b = rawTotal(sides[1].strokes); result.crossCourse = true;
  return result;
}

function refreshBattleResults(state) {
  for (const entry of state.rounds) for (const battle of entry.battles) {
    battle.result = betaBattleResult(state, battle.sides, entry.round);
  }
}

function injectPlayType() {
  const select = document.querySelector("#i_event_type");
  if (!select || select.querySelector('option[value="tournament_beta"]')) return;
  const option = document.createElement("option"); option.value = "tournament_beta"; option.textContent = "Tournament Beta"; select.append(option);
  select.closest("form")?.querySelector(".muted.tiny")?.append(" Tournament Beta supports two-team match days with 2v2 and singles rounds.");
}

function ensureStyles() {
  if (document.getElementById("golf-tournament-beta-style")) return;
  const style = document.createElement("style"); style.id = "golf-tournament-beta-style";
  style.textContent = `body.tb-focus{height:100dvh;overflow:hidden;background:#171717}body.tb-focus .golf-event-head,body.tb-focus .guest-strip{display:none!important}body.tb-focus #view,body.tb-focus #golf-outing{height:100%;overflow:hidden}body.tb-focus #view{max-width:none!important;padding:0!important}.tb-shell{display:flex;flex-direction:column;width:min(100%,760px);height:100%;margin:auto;overflow:hidden;background:linear-gradient(#24211d,#171717 65%);color:#f8f5ec}.tb-head{display:grid;grid-template-columns:44px 1fr 44px;align-items:center;gap:8px;min-height:78px;padding:8px 12px;background:#171717;border-bottom:1px solid #f4c43055}.tb-circle{display:grid;place-items:center;width:42px;height:42px;border:1px solid #ffffff2d;border-radius:50%;background:#2a2722;color:#fff;font:900 22px/1 inherit;text-decoration:none}.tb-hole{text-align:center}.tb-hole strong{display:block;font-size:23px}.tb-hole small{display:block;margin-top:5px;color:#b9b2a6;font-size:9px;text-transform:uppercase}.tb-sub{display:flex;justify-content:space-between;gap:10px;padding:9px 13px;background:#211f1b;border-bottom:1px solid #ffffff18}.tb-sub small{display:block;color:#f4c430;font-size:9px;font-weight:900;text-transform:uppercase}.tb-sub strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}.tb-link{color:#f4c430;font-size:10px;font-weight:900;text-decoration:none}.tb-play,.tb-setup{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}.tb-play{padding:10px 12px 90px}.tb-setup{display:grid;grid-template-columns:minmax(0,1fr);grid-auto-rows:max-content;align-content:start;gap:10px;padding:12px 12px 90px}.tb-box{padding:12px;border:1px solid #ffffff1e;border-radius:15px;background:#24211d}.tb-title{display:flex;align-items:center;justify-content:space-between;gap:8px}.tb-title h2,.tb-title h3{margin:0;font-size:17px}.tb-title span{color:#f4c430;font-size:10px;font-weight:900}.tb-copy{margin:7px 0 0;color:#b9b2a6;font-size:10px;line-height:1.45}.tb-add{display:grid;grid-template-columns:1fr auto;gap:7px;margin-top:9px}.tb-add input,.tb-add select,.tb-select,.tb-team-name{min-height:40px;border:1px solid #ffffff28;border-radius:10px;background:#171717;color:#fff;padding:0 10px}.tb-chips{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:9px}.tb-chip{display:flex;justify-content:space-between;min-width:0;padding:7px 8px;border-radius:9px;background:#171717;font-size:11px}.tb-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tb-chip button{border:0;background:transparent;color:#e8a39e}.tb-mode,.tb-round-tabs{display:grid;grid-template-columns:1fr 1fr;gap:7px}.tb-mode button,.tb-round-tabs button{min-height:40px;border:1px solid #ffffff26;border-radius:11px;background:#2a2722;color:#fff;font-weight:900}.tb-mode button.is-active,.tb-round-tabs button.is-active{border-color:#f4c430;background:#f4c430;color:#171717}.tb-panel[hidden],.tb-scorecard[hidden],.tb-sheet[hidden]{display:none!important}.tb-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px}.tb-actions .wide{grid-column:1/-1}.tb-team-edit{display:grid;grid-template-columns:1fr auto;gap:7px;margin-top:7px}.tb-place{display:grid;grid-template-columns:1fr minmax(120px,.8fr);align-items:center;gap:7px;padding:6px 0;border-top:1px solid #ffffff12;font-size:11px}.tb-ready{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:9px}.tb-ready span{padding:7px;border-radius:8px;background:#171717;color:#d4938e;font-size:9px;text-align:center}.tb-ready .is-ready{color:#8fd18b}.tb-round-setup{margin-top:10px;padding-top:10px;border-top:1px solid #ffffff16}.tb-round-tools{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}.tb-matchup{margin-top:9px;padding:9px;border:1px solid #ffffff18;border-radius:11px;background:#1b1a18}.tb-matchup-head{display:flex;justify-content:space-between;color:#f4c430;font-size:10px;font-weight:900}.tb-side{display:grid;grid-template-columns:90px 1fr;gap:7px;align-items:center;margin-top:7px}.tb-side b{overflow:hidden;text-overflow:ellipsis;font-size:10px}.tb-seats{display:grid;grid-template-columns:repeat(2,1fr);gap:5px}.tb-seats.single{grid-template-columns:1fr}.tb-seats select{width:100%;min-height:36px;border:1px solid #ffffff22;border-radius:8px;background:#292622;color:#fff;font-size:10px}.tb-vs{text-align:center;color:#8f887e;font-size:8px;font-weight:900;text-transform:uppercase}.tb-status{min-height:16px;color:#f4c430;font-size:10px;text-align:center}.tb-scoreboard{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;padding:13px;border:1px solid #f4c43055;border-radius:15px;background:#211f1b}.tb-score-team{text-align:center}.tb-score-team strong{display:block;color:#f4c430;font-size:42px}.tb-score-team span{font-size:12px;font-weight:900}.tb-score-vs{color:#8f887e;font-size:9px}.tb-round-tabs{margin-top:9px}.tb-leader,.tb-match-card{margin-top:9px;border:1px solid #ffffff18;border-radius:12px;background:#211f1b;overflow:hidden}.tb-leader-head{display:flex;justify-content:space-between;padding:7px 10px;color:#f4c430;font-size:9px;font-weight:900;text-transform:uppercase}.tb-leader-row{display:grid;grid-template-columns:24px 1fr auto;gap:7px;align-items:center;min-height:48px;padding:7px 9px;border-top:1px solid #ffffff12}.tb-leader-row strong,.tb-leader-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tb-leader-row small{color:#aaa196;font-size:8px}.tb-leader-row em{color:#f4c430;font-size:16px;font-style:normal;font-weight:950}.tb-match-card{padding:9px}.tb-match-title{display:flex;justify-content:space-between;gap:7px;font-size:10px}.tb-match-title span{color:#b9b2a6}.tb-score-side{display:grid;grid-template-columns:1fr 70px;gap:8px;align-items:center;margin-top:7px}.tb-score-side strong,.tb-score-side small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tb-score-side small{color:#aaa196;font-size:9px}.tb-score{display:grid;place-items:center;min-height:46px;border:1px solid #ffffff29;border-radius:11px;background:#28251f;color:#fff;font:900 10px inherit}.tb-score b{display:block;color:#f4c430;font-size:18px}.tb-score.is-readonly{opacity:.58}.tb-bottom{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.tb-bottom.is-member{grid-template-columns:1fr}.tb-empty{padding:14px;color:#b9b2a6;font-size:11px;text-align:center}.tb-scorecard{position:fixed;inset:0;z-index:80;display:flex;flex-direction:column;min-height:0;background:#f5f5f4;color:#263b49}.tb-card-head{display:flex;flex:0 0 auto;align-items:center;gap:10px;min-height:64px;padding:10px 12px;background:#fff;border-bottom:1px solid #dfe5e8}.tb-card-head h2{min-width:0;margin:0;font-size:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tb-card-back{min-height:42px;border:0;border-radius:9px;background:#477fbd;color:#fff;font-weight:900}.tb-scorecard-field{flex:0 1 auto;max-height:min(44dvh,370px);overflow-y:auto;overscroll-behavior:contain}.tb-table-wrap{flex:1 1 auto;min-height:180px;overflow:auto;overscroll-behavior:contain;background:#fff}.tb-table{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0;background:#fff;color:#263b49}.tb-table th,.tb-table td{min-width:58px;height:46px;padding:6px;border:0;border-right:1px solid #ccd2d6;border-bottom:1px solid #ccd2d6;color:#263b49;text-align:center}.tb-table thead th{position:sticky;top:0;z-index:3;background:#eef3f6}.tb-table .sticky{position:sticky;left:0;z-index:2;min-width:120px;background:#fff;text-align:left}.tb-table thead .sticky{z-index:4;background:#eef3f6}.tb-sheet{position:fixed;left:50%;bottom:70px;z-index:85;width:min(calc(100% - 16px),730px);padding:10px 14px 14px;transform:translateX(-50%);border-radius:20px 20px 0 0;background:#f9fbfc;color:#27485a;box-shadow:0 0 0 100vmax #0008}.tb-sheet-head{display:grid;grid-template-columns:40px 1fr 64px;align-items:center;gap:9px}.tb-avatar{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#c73a33;color:#fff;font-size:11px;font-weight:950}.tb-done{min-height:40px;border:0;border-radius:9px;background:#477fbd;color:#fff;font-weight:900}.tb-controls{display:grid;grid-template-columns:repeat(2,minmax(120px,164px));justify-content:center;gap:10px;padding-top:10px}.tb-label{display:block;text-align:center;font-size:10px;font-weight:900}.tb-step{display:grid;grid-template-columns:32px 1fr 32px;align-items:center;min-height:40px;border-radius:14px;background:#d8e8f3}.tb-step button{width:29px;height:29px;margin:auto;border:0;border-radius:50%;background:#fff;color:#17384f;font-size:20px;font-weight:950;line-height:1}.tb-step output{text-align:center;font-size:21px;font-weight:900}.tb-circle:focus-visible,.tb-link:focus-visible,.tb-fold summary:focus-visible,.tb-step button:focus-visible,.tb-card-back:focus-visible{outline:3px solid #f4c430;outline-offset:2px}.tb-classic-banner{margin:10px;padding:10px;border:1px solid #f4c43066;border-radius:10px}.tb-classic-banner a{color:#f4c430}`;
  style.textContent += `.tb-captain{display:grid;grid-template-columns:72px minmax(0,1fr);align-items:center;gap:7px;margin:10px 0}.tb-captain span{color:#f4c430;font-size:9px;font-weight:900;text-transform:uppercase}.tb-ready{grid-template-columns:repeat(2,1fr)}.tb-score-team small{display:block;margin-top:3px;color:#b9b2a6;font-size:9px}.tb-fold{border:1px solid #ffffff1e;border-radius:15px;background:#24211d;overflow:hidden}.tb-fold[open]{height:max-content}.tb-fold summary{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:60px;padding:10px 13px;cursor:pointer;list-style:none}.tb-fold summary::-webkit-details-marker{display:none}.tb-fold summary span{min-width:0}.tb-fold summary small,.tb-fold summary strong{display:block}.tb-fold summary small{color:#f4c430;font-size:8px;font-weight:900;letter-spacing:.1em}.tb-fold summary strong{margin-top:3px;font-size:15px}.tb-fold summary em{color:#b9b2a6;font-size:9px;font-style:normal;font-weight:900;text-align:right}.tb-fold summary em.is-ready{color:#8fd18b}.tb-fold summary:after{content:'+';color:#f4c430;font-size:20px;font-weight:900}.tb-fold[open] summary:after{content:'−'}.tb-fold[open] summary{border-bottom:1px solid #ffffff14}.tb-fold-body{padding:11px 12px 13px}.tb-team-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:10px 0 12px}.tb-team-actions .btn{min-height:42px;border-color:#ffffff24;background:#2a2722;color:#f8f5ec}.tb-team-actions .tb-reset{grid-column:1/-1;border-color:#a65b56;background:transparent;color:#e8a39e}.tb-team-card{margin-top:10px;padding:11px;border:1px solid #ffffff1c;border-left:3px solid var(--tb-team-color);border-radius:12px;background:#1b1a18}.tb-team-card-head{display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:center;gap:8px}.tb-team-dot{width:10px;height:10px;border-radius:50%;background:var(--tb-team-color)}.tb-team-card .tb-team-name{width:100%;min-width:0}.tb-team-save{min-height:40px;padding-inline:12px}.tb-roster-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:9px;border-top:1px solid #ffffff12}.tb-roster-head strong{color:#f4c430;font-size:9px;text-transform:uppercase}.tb-roster-head small{color:#aaa196;font-size:9px}.tb-roster-list .tb-place:first-child{border-top:0}.tb-roster-list .tb-place{grid-template-columns:minmax(0,1fr) minmax(125px,.8fr)}.tb-unassigned{margin-top:10px;padding:9px 11px;border:1px dashed #ffffff27;border-radius:11px;background:#171717}.tb-unassigned>strong{display:block;margin-bottom:4px;color:#b9b2a6;font-size:9px;text-transform:uppercase}.tb-matchup-grid{display:grid;grid-template-columns:minmax(0,1fr) 28px minmax(0,1fr);align-items:center;gap:7px;margin-top:8px}.tb-match-side{min-width:0}.tb-match-side>b{display:block;margin-bottom:5px;color:#f4c430;font-size:10px;text-align:center}.tb-match-side .tb-seats{grid-template-columns:1fr}.tb-seat{display:block;min-width:0}.tb-seat small{display:block;margin-bottom:3px;color:#aaa196;font-size:8px;font-weight:900;text-transform:uppercase}.tb-seat select{width:100%}.tb-matchup-grid .tb-vs{font-size:10px}.tb-member-entry{margin-top:10px;border:1px solid #ffffff1e;border-radius:14px;overflow:hidden;background:#211f1b}.tb-member-hint{padding:9px 12px;border-bottom:1px solid #ffffff12;color:#b9b2a6;font-size:10px}.tb-quick-player{display:grid;grid-template-columns:62px minmax(0,1fr) 112px;align-items:center;gap:10px;min-height:126px;padding:14px 12px}.tb-quick-player .tb-avatar{width:54px;height:54px;font-size:19px}.tb-quick-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:18px;font-weight:900}.tb-quick-status{margin-top:6px;color:#f4c430;font-size:16px;font-weight:900}.tb-quick-status small{color:#aaa196;font-size:10px}.tb-quick-add{min-height:78px;border:1px solid #ffffff29;border-radius:12px;background:#28251f;color:#fff;font:900 15px/1.05 inherit}.tb-quick-add span,.tb-quick-add small{display:block}.tb-quick-add span{margin-bottom:4px;font-size:20px}.tb-quick-add small{margin-top:4px;color:#aaa196;font-size:9px}.tb-score-card-tools{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 12px;background:#fff}.tb-score-card-tools button{min-height:40px}.tb-card-mark{display:inline-grid;place-items:center;width:28px;height:28px;font-weight:950;line-height:1}.tb-card-mark.m-birdie,.tb-card-mark.m-eagle{border:2px solid #23834b;border-radius:50%;background:#e9f7ef;color:#176338}.tb-card-mark.m-eagle{box-shadow:0 0 0 2px #fff,0 0 0 4px #23834b}.tb-card-mark.m-bogey,.tb-card-mark.m-dbl{border:2px solid #c73a33;border-radius:4px;background:#fff0ef;color:#a62f29}.tb-card-mark.m-dbl{box-shadow:0 0 0 2px #fff,0 0 0 4px #c73a33}.tb-score .tb-card-mark{width:27px;height:27px}.tb-score .tb-card-mark.m-birdie,.tb-score .tb-card-mark.m-eagle{background:#183d29;color:#8fe0ae}.tb-score .tb-card-mark.m-bogey,.tb-score .tb-card-mark.m-dbl{background:#4a201e;color:#ffaaa5}.tb-sheet.tb-quick-sheet{bottom:0;padding:18px 18px calc(18px + env(safe-area-inset-bottom));border-radius:18px 18px 0 0}.tb-quick-sheet .tb-sheet-head{display:block;text-align:center}.tb-quick-sheet .tb-sheet-head .tb-avatar{display:none}.tb-quick-sheet .tb-sheet-head small{display:block;margin-top:5px;color:#667985}.tb-quick-sheet .tb-controls{display:block}.tb-quick-sheet .tb-step{grid-template-columns:64px 1fr 64px;gap:12px;background:transparent}.tb-quick-sheet .tb-step button{width:100%;height:58px;border:1px solid #9eb4c2;border-radius:12px;background:#e4eef4;color:#17384f;font-size:32px;font-weight:950;line-height:1;box-shadow:0 1px 0 #fff inset}.tb-quick-sheet .tb-step button:active{background:#cbdde8;transform:scale(.98)}.tb-quick-sheet .tb-step output{display:grid;place-items:center;height:58px;border:1px solid #ccd2d6;border-radius:12px;background:#fff;color:#27485a;font-size:28px}.tb-sheet-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.tb-sheet-actions.has-clear{grid-template-columns:1fr 1fr 1fr}.tb-sheet-actions button{min-height:48px}.tb-clear-hole{border-color:#c98682!important;background:#fff0ef!important;color:#9f2f2a!important}@media(max-width:520px){.tb-matchup-grid{grid-template-columns:1fr}.tb-matchup-grid .tb-vs{padding:2px}.tb-quick-player{grid-template-columns:54px minmax(0,1fr) 104px}.tb-roster-head{align-items:flex-start;flex-direction:column;gap:2px}}`;
  style.textContent += `.tb-sync{padding:6px 12px;border-bottom:1px solid #ffffff12;background:#171717;color:#8fd18b;font-size:9px;font-weight:900;text-align:center;text-transform:uppercase;letter-spacing:.06em}`;
  style.textContent += `.tb-leaderboard-field{flex:1;min-height:0;overflow-y:auto;padding:12px;background:linear-gradient(#24211d,#171717);color:#f8f5ec}.tb-leaderboard-field .tb-scoreboard{margin-bottom:10px}.tb-quick-add .tb-card-mark{margin:0 auto 4px}`;
  style.textContent += `.tb-gps-slot{min-height:64px;margin-top:10px}.tb-hole small .tb-yardage{color:#f4c430}.tb-table th small{font-size:8px;line-height:1.2}`;
  style.textContent += `body.tb-focus{background:var(--bg)}.tb-shell{background:linear-gradient(var(--bg-2),var(--bg) 70%);color:var(--text)}.tb-head,.tb-sub,.tb-scoreboard,.tb-leader,.tb-match-card,.tb-member-entry,.tb-box,.tb-fold{background:var(--bg-2);border-color:var(--line)}.tb-circle,.tb-mode button,.tb-round-tabs button,.tb-team-actions .btn{border-color:var(--line);background:var(--bg-3);color:var(--text)}.tb-hole small,.tb-copy,.tb-match-title span,.tb-empty,.tb-member-hint,.tb-leader-row small,.tb-score-side small,.tb-quick-status small,.tb-roster-head small,.tb-seat small{color:var(--muted)}.tb-hole small .tb-yardage,.tb-sub small,.tb-link,.tb-title span,.tb-matchup-head,.tb-score-team strong,.tb-leader-head,.tb-leader-row em,.tb-quick-status,.tb-fold summary small,.tb-fold summary:after,.tb-roster-head strong,.tb-match-side>b{color:var(--accent-2)}.tb-sync{background:var(--bg-2);border-bottom-color:var(--line-soft);color:var(--ok)}.tb-leader-row,.tb-member-hint,.tb-fold[open] summary,.tb-roster-head,.tb-place{border-color:var(--line-soft)}.tb-leaderboard-field{background:linear-gradient(var(--bg-2),var(--bg));color:var(--text)}.tb-chip,.tb-ready span,.tb-unassigned,.tb-team-card,.tb-matchup{background:var(--bg-3);border-color:var(--line)}.tb-add input,.tb-add select,.tb-select,.tb-team-name,.tb-seats select{border-color:var(--line);background:var(--bg-3);color:var(--text)}`;
  style.textContent += `.tb-format-state{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:3px 10px;margin-top:10px;padding:10px 11px;border:1px solid var(--line);border-radius:11px;background:var(--bg-3)}.tb-format-state small{grid-row:1/3;color:var(--accent-2);font-size:8px;font-weight:950;letter-spacing:.1em}.tb-format-state strong{font-size:14px}.tb-format-state span{color:var(--muted);font-size:9px}.tb-round-tools .btn{display:grid;gap:2px;place-content:center;min-height:48px}.tb-round-tools .btn small{display:block;color:inherit;font-size:8px;font-weight:900;opacity:.76}.tb-guest-code{display:grid;gap:5px;margin-top:10px}.tb-guest-code span{color:var(--accent-2);font-size:9px;font-weight:950;text-transform:uppercase;letter-spacing:.08em}.tb-guest-code input{width:100%;min-height:44px;border:1px solid var(--line);border-radius:10px;background:var(--bg-3);color:var(--text);padding:0 11px;text-transform:uppercase}.tb-total,.tb-quick-add{border-color:#ccd2d6!important;background:#eef3f6!important;color:#263b49!important}.tb-total{font-weight:950}.tb-quick-add small{color:#667985}`;
  style.textContent += `.tb-total{border-color:#ccd2d6!important;background:#eef3f6!important;color:#263b49!important}.tb-quick-add{border-color:var(--control-line)!important;background:var(--bg-3)!important;color:var(--text)!important;box-shadow:var(--shadow)}.tb-quick-add small{color:var(--muted)}.tb-leader-head,.tb-leaderboard-view .tb-card-head{background:var(--bg-3);color:var(--text);border-color:var(--line)}.tb-leaderboard-view .tb-card-back{background:var(--bg-2);color:var(--accent-2);border:1px solid var(--line)}.tb-h2h{margin-top:10px;border:1px solid var(--line);border-radius:14px;background:var(--bg-2);overflow:hidden}.tb-h2h-head{display:flex;justify-content:space-between;gap:8px;padding:7px 10px;background:var(--bg-3);color:var(--muted);font-size:9px;font-weight:950;text-transform:uppercase}.tb-h2h-grid{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;padding:11px}.tb-h2h-side{min-width:0;text-align:center}.tb-h2h-side strong,.tb-h2h-side small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tb-h2h-side strong{font-size:13px}.tb-h2h-side b{display:block;margin:4px 0 2px;color:var(--accent-2);font-size:28px}.tb-h2h-side small{color:var(--muted);font-size:8px;text-transform:uppercase}.tb-h2h-vs{color:var(--muted);font-size:9px;font-weight:950}.tb-h2h-status{padding:0 10px 9px;color:var(--muted);font-size:10px;text-align:center}`;
  style.textContent += `.tb-scorecard{bottom:calc(68px + env(safe-area-inset-bottom))}.tb-table-wrap{scroll-padding-bottom:24px}`;
  style.textContent += `.tb-bottom.has-share{grid-template-columns:repeat(3,minmax(0,1fr))}.tb-share-sheet{position:fixed;inset:0;z-index:95;display:grid;align-items:end;background:#0009}.tb-share-sheet[hidden]{display:none!important}.tb-share-panel{width:min(100%,760px);margin:0 auto;padding:18px 14px calc(18px + env(safe-area-inset-bottom));border-radius:22px 22px 0 0;background:var(--bg-2);color:var(--text);box-shadow:0 -12px 40px #0005}.tb-share-panel h2{margin:0;font-size:21px}.tb-share-panel>p{margin:5px 0 14px;color:var(--muted);font-size:11px}.tb-share-options{display:grid;grid-template-columns:1fr 1fr;gap:8px}.tb-share-option{min-height:66px;text-align:left}.tb-share-option strong,.tb-share-option small{display:block}.tb-share-option small{margin-top:3px;color:var(--muted);font-size:9px}.tb-share-close{width:100%;margin-top:10px}.tb-share-card{margin-left:auto;min-height:38px;padding:0 12px;border:1px solid var(--line);border-radius:9px;background:var(--bg-2);color:var(--text);font-weight:900}@media(max-width:430px){.tb-share-options{grid-template-columns:1fr}.tb-bottom.has-share{grid-template-columns:1fr 1fr}.tb-bottom.has-share [data-tb-share-open]{grid-column:1/-1;grid-row:1}.tb-bottom.has-share [data-tb-finish]{grid-column:2}}`;
  style.textContent += `.tb-scorecard-body{display:flex;flex:1 1 auto;min-height:0;flex-direction:column;overflow:hidden}.tb-scorecard-body .tb-table-wrap{flex:1 1 auto}.tb-legend{flex:0 0 auto;margin:10px 12px 8px;border-radius:14px;background:#fff;overflow:hidden;box-shadow:0 1px 4px #0000000e}.tb-legend h3{margin:0;padding:9px 13px;background:#426a7d;color:#fff;font-size:14px}.tb-legend-grid{display:grid;grid-template-columns:repeat(11,minmax(58px,1fr));gap:8px;padding:10px;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}.tb-legend-item{display:grid;justify-items:center;gap:4px;min-width:58px;color:#444;font-size:9px;text-align:center}.tb-legend-item .tb-card-mark{width:28px;height:28px}.tb-legend-item>strong{display:grid;place-items:center;width:28px;height:28px;font-size:14px}`;
  style.textContent += `.tb-bottom.is-member{grid-template-columns:1fr 1fr;margin-top:0}.tb-bottom.is-member .btn{min-height:42px;padding-block:8px}.tb-play{padding-bottom:calc(90px + var(--bl-h,30px) + env(safe-area-inset-bottom))}`;
  style.textContent += `.tb-card-head h2{flex:1}.tb-share-card{min-height:40px;padding:0 12px;border:1px solid #477fbd;border-radius:9px;background:transparent;color:#477fbd;font-weight:900}`;
  style.textContent += `.tb-card-head h2{min-width:0}.tb-share-card,.tb-clear-card{flex:0 0 auto;white-space:nowrap;font-size:11px}.tb-clear-card{min-height:40px;padding:0 12px;border:1px solid #a65b56;border-radius:9px;background:transparent;color:#a65b56;font-weight:900}.tb-clear-card:disabled{opacity:.5}`;
  style.textContent += `.tb-custom-grid{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:end;gap:9px;margin-top:12px}.tb-custom-grid label{display:grid;gap:5px}.tb-custom-grid label span{overflow:hidden;color:var(--accent-2);font-size:9px;font-weight:950;text-overflow:ellipsis;white-space:nowrap;text-transform:uppercase}.tb-custom-grid>strong{padding-bottom:13px;color:var(--muted);font-size:9px}.tb-board-setting{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:9px;padding:10px 11px;border:1px solid var(--line);border-radius:11px;background:var(--bg-3)}.tb-board-setting span{min-width:0}.tb-board-setting strong,.tb-board-setting small{display:block}.tb-board-setting strong{font-size:11px}.tb-board-setting small{margin-top:2px;color:var(--muted);font-size:9px;line-height:1.35}.tb-board-setting input{flex:0 0 auto;width:22px;height:22px;accent-color:var(--accent-2-fill)}.tb-score{border-color:var(--control-line)!important;background:var(--bg-3)!important;color:var(--text)!important;box-shadow:var(--shadow)}.tb-score b{color:var(--accent-2)!important}`;
  style.textContent += `.tb-member-add{display:grid;gap:8px;margin-top:9px}.tb-member-picker{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:start;gap:7px;width:100%;height:min(42dvh,360px);min-height:240px;overflow-y:auto;padding:9px;border:1px solid var(--line);border-radius:11px;background:var(--bg-3)}.tb-member-picker.is-empty{height:auto;min-height:0}.tb-member-picker label{display:flex;align-items:center;gap:8px;min-width:0;min-height:44px;padding:7px 9px;border:1px solid var(--line-soft);border-radius:9px;background:var(--bg-2);font-size:11px;font-weight:800}.tb-member-picker input{width:20px;height:20px;flex:0 0 auto;accent-color:var(--accent-2-fill)}.tb-member-picker span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tb-member-add>.btn{min-height:46px}.tb-setup-guide{padding:12px;border:1px solid var(--line);border-radius:15px;background:var(--bg-2);box-shadow:var(--shadow)}.tb-guide-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.tb-guide-step{display:grid;grid-template-columns:28px minmax(0,1fr);align-items:center;gap:7px;min-width:0;min-height:52px;padding:7px;border:1px solid var(--line);border-radius:11px;background:var(--bg-3);color:var(--text);text-align:left}.tb-guide-step>b{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--bg);color:var(--muted);font-size:12px}.tb-guide-step span,.tb-guide-step small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tb-guide-step span{font-size:10px;font-weight:950;text-transform:uppercase}.tb-guide-step small{margin-top:2px;color:var(--muted);font-size:8px}.tb-guide-step.is-done{border-color:color-mix(in srgb,var(--ok) 55%,var(--line))}.tb-guide-step.is-done>b{background:var(--ok);color:var(--bg)}.tb-guide-step.is-current{border-color:var(--accent-2);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent-2) 18%,transparent)}.tb-guide-step.is-current>b{background:var(--accent-2-fill);color:#fff}.tb-guide-next{margin:10px 2px 0;color:var(--muted);font-size:10px;line-height:1.45}.tb-guide-next strong{color:var(--accent-2)}@media(max-width:520px){.tb-guide-step{grid-template-columns:1fr;place-items:center;text-align:center}.tb-guide-step span{font-size:9px}.tb-guide-step small{display:none}}@media(max-width:440px){.tb-member-picker{grid-template-columns:1fr}}`;
  style.textContent += `.tb-quick-sheet .tb-controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.tb-quick-sheet .tb-control{min-width:0}.tb-quick-sheet .tb-step{grid-template-columns:36px minmax(38px,1fr) 36px;gap:3px}.tb-quick-sheet .tb-step button{height:48px;font-size:25px}.tb-quick-sheet .tb-step output{height:48px;font-size:22px}.tb-round-stats{display:grid;gap:8px;padding:12px;background:#f5f5f4}.tb-stat-summary{display:grid;grid-template-columns:minmax(90px,1.4fr) repeat(3,minmax(60px,1fr));gap:7px;padding:9px;border:1px solid #d8dde0;border-radius:12px;background:#fff}.tb-stat-summary>strong{align-self:center;overflow:hidden;text-overflow:ellipsis}.tb-stat-summary span{display:grid;place-items:center;padding:6px 3px;border-radius:8px;background:#eaf1f5;text-align:center}.tb-stat-summary b,.tb-stat-summary small{display:block}.tb-stat-summary small{color:#55707f;font-size:8px;text-transform:uppercase}`;
  style.textContent += `.tb-course-assignments{display:grid;gap:7px;margin-top:10px}.tb-course-person{display:grid;grid-template-columns:minmax(100px,1fr) minmax(145px,1.2fr);align-items:center;gap:9px;padding:8px 9px;border:1px solid var(--line-soft);border-radius:10px;background:var(--bg-3)}.tb-course-person>span{overflow:hidden;font-size:11px;font-weight:900;text-overflow:ellipsis;white-space:nowrap}.tb-course-divider{position:sticky;left:0;display:flex;align-items:baseline;gap:8px;min-height:42px;padding:9px 12px;border-top:3px solid #477fbd;background:#e5eef4;color:#27485a}.tb-course-divider strong{font-size:13px;text-transform:uppercase}.tb-course-divider small{color:#607b89;font-size:9px}.tb-course-card+.tb-course-card{margin-top:14px}.tb-course-card .tb-table{border-top:1px solid #ccd2d6}.tb-leader-course{color:var(--accent-2)}@media(max-width:480px){.tb-course-person{grid-template-columns:1fr}.tb-course-person .tb-select{width:100%}}`;
  // The scorecard scrolls as one page: the table stands at its full height so every golfer is
  // visible, and the stats and legend flow underneath the last row instead of being pinned to a
  // half-screen. The body owns both scroll axes, which is what keeps the sticky hole header and
  // sticky name column working; the stats and legend stay put horizontally so a sideways scroll
  // through the holes never drags them out of view.
  style.textContent += `.tb-scorecard-body{display:block;flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}.tb-scorecard-body .tb-table-wrap{flex:none;width:max-content;min-width:100%;min-height:0;overflow:visible}.tb-scorecard-body .tb-round-stats,.tb-scorecard-body .tb-legend{position:sticky;width:auto}.tb-scorecard-body .tb-round-stats{left:0}.tb-scorecard-body .tb-legend{left:12px}.tb-scorecard-body .tb-legend{margin-bottom:calc(14px + env(safe-area-inset-bottom))}.tb-legend-grid{grid-template-columns:repeat(auto-fill,minmax(58px,1fr));overflow:visible}`;
  document.head.append(style);
}

function persistScore(state, sideId, hole, strokes, putts, drops) {
  if (!canScoreBetaCard({ ...state, individual: true, memberId: getMemberId(), cardId: sideId })) return;
  const key = scoreKey(sideId, hole), previous = state.scoreRows.get(key);
  if (strokes) state.scoreRows.set(key, { ...(previous || {}), side_id: sideId, hole, strokes, putts, drops, pending: true });
  else state.scoreRows.delete(key);
  const side = state.sides.find(item => String(item.id) === String(sideId));
  if (side) { if (strokes) side.strokes.set(hole, strokes); else side.strokes.delete(hole); }
  refreshBattleResults(state);
  queueSideScore(state.outing.id, sideId, hole, strokes || null, putts, drops);
  cacheBetaState(state);
}

/*
  ONE PRESS CLEARS THE WHOLE EVENT.

  A golfer clearing their own hole is the sheet's "Clear hole" button and stays
  hole by hole. A commissioner wiping a testing round is a different job, so this
  takes every stroke of every side in the event at once. Setup carries it as a
  section; the scorecard header carries the same button, because that is the
  screen a commissioner is standing on when the test scores are in front of them.
*/
async function clearAllBetaScores(state) {
  const sideIds = state.sides.map(side => Number(side.id)).filter(Boolean);
  if (!sideIds.length) throw new Error("No Tournament Beta scorecards were found.");
  const result = await db().from("golf_match_scores").delete().in("side_id", sideIds).select("id");
  if (result.error) throw result.error;
  if ((result.data || []).length < Number(state.persistedScoreCount || 0)) throw new Error("Some scores could not be cleared. Check commissioner Golf permission and try again.");
  dropPendingSides(sideIds);
}

const clearAllPrompt = state => `Clear all ${state.scoreRows.size} scored hole${state.scoreRows.size === 1 ? "" : "s"} from this Tournament Beta event?\n\nGolfers, matches, course and setup will stay. This cannot be undone.`;

const matchSides = (state, entry) => (entry?.battles || []).flatMap(b => b.sides);
const memberPicker = available => `<div class="tb-member-add"><div class="tb-member-picker ${available.length ? "" : "is-empty"}" role="group" aria-label="Choose one or more DFL golfers">${available.map(member => `<label><input type="checkbox" value="${member.id}" data-tb-member><span>${esc(nameOf(member))}</span></label>`).join("") || `<span class="tb-copy">Every DFL golfer is already added.</span>`}</div><button class="btn" data-tb-add-member ${available.length ? "" : "disabled"}>Add selected golfers</button></div>`;

function matchupEditor(state, entry) {
  if (!entry) return `<div class="tb-empty">Build the schedule to place the matchups.</div>`;
  const held = new Map();
  matchSides(state, entry).flatMap(s => s.players).forEach(p => held.set(String(p.participant_id), p.side_id));
  return entry.battles.map(b => `<div class="tb-matchup"><div class="tb-matchup-head"><span>Match ${b.match_number}</span><span>${betaIsCustomRound(entry.round) ? betaCustomSizes(entry.round).join(" vs ") : entry.round.format === "pairs" ? "PAIR vs PAIR" : "PLAYER vs PLAYER"}</span></div><div class="tb-matchup-grid">${b.sides.map((s, i) => {
    const perSide = betaSeatsForSide(entry.round, i);
    const pool = state.participants.filter(p => String(p.team_id) === String(s.team_id));
    const seats = Array.from({ length: perSide }, (_, n) => {
      const current = s.players[n], seatLabel = perSide > 1 ? `Player ${n + 1}` : "Player";
      return `<label class="tb-seat"><small>${seatLabel}</small><select data-tb-seat="${entry.round.id}:${s.id}" data-row="${current?.row_id || ""}"><option value="">— choose ${seatLabel.toLowerCase()} —</option>${pool.map(p => `<option value="${p.id}" ${String(p.id) === String(current?.participant_id) ? "selected" : ""}>${esc(playerName(p, state.names))}${held.has(String(p.id)) && String(held.get(String(p.id))) !== String(s.id) ? " · currently in another match" : ""}</option>`).join("")}</select></label>`;
    }).join("");
    return `${i ? `<div class="tb-vs">VS</div>` : ""}<div class="tb-match-side"><b>${esc(s.teamName)}</b><div class="tb-seats ${perSide === 1 ? "single" : ""}">${seats}</div></div>`;
  }).join("")}</div></div>`).join("");
}

function setupMarkup(state) {
  const status = betaFormatStatus(state), mode = setupMode.get(state.outing.id) || (state.individual ? "singles" : "teams");
  const have = new Set(state.participants.filter(p => p.member_id != null).map(p => String(p.member_id))), available = state.members.filter(m => !have.has(String(m.id)));
  const chips = state.participants.map(p => `<div class="tb-chip"><span>${esc(playerName(p, state.names))}</span><button data-tb-remove="${p.id}">×</button></div>`).join("");
  const options = p => `<option value="">Unassigned</option>${state.teams.map(t => `<option value="${t.id}" ${String(p.team_id) === String(t.id) ? "selected" : ""}>${esc(t.name)}</option>`).join("")}`;
  const teamEditor = state.teams.length ? `<div>${state.teams.map(t => {
    const choices = betaCaptainChoices(t, state.participants);
    return `<div class="tb-team-edit"><input class="tb-team-name" value="${esc(t.name)}" data-tb-team-name="${t.id}"><button class="btn" data-tb-save-team="${t.id}">Save</button></div><label class="tb-captain"><span>Captain</span><select class="tb-select" data-tb-captain="${t.id}"><option value="">— choose captain —</option>${choices.map(p => `<option value="${p.member_id}" ${String(p.member_id) === String(t.captain_member_id) ? "selected" : ""}>${esc(playerName(p, state.names))}</option>`).join("")}</select></label>`;
  }).join("")}</div><div>${state.participants.map(p => `<label class="tb-place"><span>${esc(playerName(p, state.names))}</span><select class="tb-select" data-tb-place="${p.id}">${options(p)}</select></label>`).join("")}</div>` : `<p class="tb-copy">Create the two teams, then place six golfers on each side.</p>`;
  const roundSetup = format => { const entry = status[format === "pairs" ? "pairs" : "singles"]; return `<section class="tb-round-setup"><div class="tb-title"><h3>${betaRoundName(format)}</h3><span>${entry?.battles.length || 0}/${betaMatchCount(format)} MATCHES</span></div><div class="tb-round-tools">${["strokes", "match"].map(s => `<button class="btn ${scoringOf(entry?.round) === s ? "primary" : ""}" data-tb-scoring="${entry?.round.id || ""}:${s}" ${entry ? "" : "disabled"}>${s === "strokes" ? "Stroke play" : "Match play"}</button>`).join("")}</div><div class="tb-round-tools">${[9,18].map(holes => `<button class="btn ${roundHoles(entry?.round) === holes ? "primary" : ""}" data-tb-holes="${entry?.round.id || ""}:${holes}" ${entry ? "" : "disabled"}>${holes} holes</button>`).join("")}</div>${matchupEditor(state, entry)}</section>`; };
  return `<main class="tb-shell" data-tbeta-root><header class="tb-head"><a class="tb-circle" href="#/golf?id=${state.outing.id}">‹</a><div class="tb-hole"><strong>SETUP</strong><small>Tournament Beta</small></div><span></span></header><div class="tb-sub"><div><small>Commissioner setup</small><strong>${esc(state.outing.course || state.outing.name)}</strong></div><a class="tb-link" href="#/golf?id=${state.outing.id}">MATCH →</a></div><section class="tb-setup"><div class="tb-box"><div class="tb-title"><h2>Golfers</h2><span>${state.participants.length} PLAYERS</span></div>${memberPicker(available)}<div class="tb-add"><input data-tb-guest placeholder="Guest golfer name"><button class="btn" data-tb-add-guest>Add guest</button></div><div class="tb-chips">${chips || "Add golfers to begin."}</div></div><div class="tb-mode"><button class="${mode === "singles" ? "is-active" : ""}" data-tb-mode="singles">Singles field</button><button class="${mode === "teams" ? "is-active" : ""}" data-tb-mode="teams">Two-team match</button></div><div class="tb-box tb-panel" data-tb-panel="singles" ${mode === "singles" ? "" : "hidden"}><div class="tb-title"><h2>Individual singles</h2><span>${state.participants.length} PLAYERS</span></div><p class="tb-copy">One individual card per golfer, ranked together in stroke play.</p><div class="tb-actions"><button class="btn primary wide" data-tb-build-singles ${state.participants.length < 2 ? "disabled" : ""}>Build individual field</button></div></div><div class="tb-box tb-panel" data-tb-panel="teams" ${mode === "teams" ? "" : "hidden"}><div class="tb-title"><h2>Two teams of six</h2><span>${state.teams.length}/2 TEAMS</span></div><p class="tb-copy">Round 1 is three 2v2 matches. Round 2 is six 1v1 matches. Every win is one team point.</p><div class="tb-actions"><button class="btn primary wide" data-tb-create-teams>Create / reset two teams</button><button class="btn" data-tb-deal="even" ${state.teams.length !== 2 ? "disabled" : ""}>Place evenly</button><button class="btn" data-tb-deal="random" ${state.teams.length !== 2 ? "disabled" : ""}>Place randomly</button></div>${teamEditor}<div class="tb-ready"><span class="${status.teamsReady ? "is-ready" : ""}">Teams ${status.counts.join("–") || "0–0"}</span><span class="${status.captainsReady ? "is-ready" : ""}">2 captains named</span><span class="${status.pairsReady ? "is-ready" : ""}">3 pairs matches</span><span class="${status.singlesReady ? "is-ready" : ""}">6 singles matches</span></div><div class="tb-actions"><button class="btn primary wide" data-tb-build-team-day ${status.teamsReady && status.captainsReady ? "" : "disabled"}>${status.pairs || status.singles ? "Reset" : "Build"} two-round schedule</button></div>${roundSetup("pairs")}${roundSetup("singles")}</div><div class="tb-status" data-tb-status></div></section></main>`;
}

function calmSetupMarkup(state) {
  const status = betaFormatStatus(state);
  const openSection = setupSection.get(state.outing.id) || "";
  const have = new Set(state.participants.filter(p => p.member_id != null).map(p => String(p.member_id)));
  const available = state.members.filter(m => !have.has(String(m.id)));
  const golfersReady = state.participants.length >= 2;
  const sidesReady = state.teams.length === 2 && state.teams.every(team => state.participants.some(person => String(person.team_id) === String(team.id)));
  const matchReady = state.rounds.length > 0;
  const currentGuideStep = !golfersReady ? 1 : !sidesReady ? 2 : !matchReady ? 3 : 4;
  const matchGuideTarget = status.custom ? "custom" : status.pairs || status.singles ? "traditional" : "custom";
  const guideMessage = currentGuideStep === 1
    ? "Select every golfer playing, then tap Add selected golfers. Guests can be added underneath."
    : currentGuideStep === 2
      ? "Create two sides and place the golfers. For a quick custom match, Step 3 can create and fill the sides automatically."
      : currentGuideStep === 3
        ? "Choose Custom Match for flexible sides such as 1v2, or Traditional Team Day for the full 6v6 format."
        : "Setup is ready. Review any matchup seats below, then tap MATCH at the top to begin scoring.";
  const guideClass = step => step < currentGuideStep ? "is-done" : step === currentGuideStep ? "is-current" : "";
  const setupGuide = `<nav class="tb-setup-guide" aria-label="Tournament setup progress"><div class="tb-guide-steps"><button type="button" class="tb-guide-step ${guideClass(1)}" data-tb-jump="golfers" ${currentGuideStep === 1 ? `aria-current="step"` : ""}><b>${golfersReady ? "✓" : "1"}</b><span>Golfers<small>${state.participants.length} added</small></span></button><button type="button" class="tb-guide-step ${guideClass(2)}" data-tb-jump="teams" ${currentGuideStep === 2 ? `aria-current="step"` : ""}><b>${sidesReady ? "✓" : "2"}</b><span>Sides<small>${state.teams.length === 2 ? "Created" : "Not created"}</small></span></button><button type="button" class="tb-guide-step ${guideClass(3)}" data-tb-jump="${matchGuideTarget}" ${currentGuideStep === 3 ? `aria-current="step"` : ""}><b>${matchReady ? "✓" : "3"}</b><span>Match<small>${matchReady ? "Built" : "Choose format"}</small></span></button></div><p class="tb-guide-next"><strong>${currentGuideStep === 4 ? "Ready:" : `Step ${currentGuideStep}:`}</strong> ${guideMessage}</p></nav>`;
  const playerChips = state.participants.map(p => `<div class="tb-chip"><span>${esc(playerName(p, state.names))}</span><button data-tb-remove="${p.id}" aria-label="Remove ${esc(playerName(p, state.names))}">×</button></div>`).join("");
  const eventCourse = courseById(state, state.outing.course_id);
  const courseOptions = participant => `<option value="">Event course · ${esc(eventCourse?.name || state.outing.course || "Not selected")}</option>${state.courses.map(course => `<option value="${course.id}" ${String(participant.course_id) === String(course.id) ? "selected" : ""}>${esc(course.name)}${course.city ? ` · ${esc(course.city)}, ${esc(course.state || "")}` : ""}</option>`).join("")}`;
  const courseAssignments = `<details class="tb-fold" data-tb-section="courses" ${openSection === "courses" ? "open" : ""}><summary><span><small>OPTIONAL · REMOTE PLAY</small><strong>Player courses</strong></span><em>${state.participants.filter(person => person.course_id).length ? `${state.participants.filter(person => person.course_id).length} custom` : "Everyone uses event course"}</em></summary><div class="tb-fold-body"><p class="tb-copy">Assign a different course only to golfers playing remotely. Their GPS, pars, yardages and scorecard section will follow that course; the leaderboard compares everyone to par.</p><div class="tb-course-assignments">${state.participants.map(person => `<label class="tb-course-person"><span>${esc(playerName(person, state.names))}</span><select class="tb-select" data-tb-player-course="${person.id}">${courseOptions(person)}</select></label>`).join("") || `<p class="tb-copy">Add golfers first.</p>`}</div></div></details>`;
  const teamOptions = p => `<option value="">Unassigned</option>${state.teams.map(t => `<option value="${t.id}" ${String(p.team_id) === String(t.id) ? "selected" : ""}>${esc(t.name)}</option>`).join("")}`;
  const teamControls = state.teams.length === 2 ? `${state.teams.map(t => {
    const choices = betaCaptainChoices(t, state.participants);
    const roster = state.participants.filter(p => String(p.team_id) === String(t.id));
    return `<section class="tb-team-card" style="--tb-team-color:${esc(t.color || "#f4c430")}"><div class="tb-team-card-head"><span class="tb-team-dot" aria-hidden="true"></span><input class="tb-team-name" value="${esc(t.name)}" data-tb-team-name="${t.id}" aria-label="${esc(t.name)} team name"><button class="btn tb-team-save" data-tb-save-team="${t.id}">Save name</button></div><label class="tb-captain"><span>Captain</span><select class="tb-select" data-tb-captain="${t.id}"><option value="">Optional for custom matches</option>${choices.map(p => `<option value="${p.member_id}" ${String(p.member_id) === String(t.captain_member_id) ? "selected" : ""}>${esc(playerName(p, state.names))}</option>`).join("")}</select></label><div class="tb-roster-head"><strong>${roster.length} golfer${roster.length === 1 ? "" : "s"}</strong><small>Change a golfer's team below</small></div><div class="tb-roster-list">${roster.map(p => `<label class="tb-place"><span>${esc(playerName(p, state.names))}</span><select class="tb-select" data-tb-place="${p.id}">${teamOptions(p)}</select></label>`).join("")}</div></section>`;
  }).join("")}${state.participants.some(p => p.team_id == null) ? `<div class="tb-unassigned"><strong>Unassigned golfers</strong>${state.participants.filter(p => p.team_id == null).map(p => `<label class="tb-place"><span>${esc(playerName(p, state.names))}</span><select class="tb-select" data-tb-place="${p.id}">${teamOptions(p)}</select></label>`).join("")}</div>` : ""}` : `<p class="tb-copy">Create two teams, then place each golfer on a side.</p>`;
  const roundCard = (format, entry = status[format === "pairs" ? "pairs" : "singles"], extra = false) => {
    const expectedMatches = betaIsCustomRound(entry?.round) ? 1 : betaMatchCount(format);
    const ready = entry?.battles?.length === expectedMatches
      && entry.battles.every(battle => battle.sides?.length === 2 && battle.sides.every((side, index) => side.players?.length === betaSeatsForSide(entry.round, index)));
    const selectedScoring = scoringOf(entry?.round), scoringName = selectedScoring === "match" ? "Match play" : "Stroke play";
    const explainer = betaIsCustomRound(entry?.round)
      ? "Choose the golfers on each side for this custom round. You can adjust every seat without changing the earlier round."
      : format === "pairs"
      ? "Choose both partners on each side. Each row is one specific pair against one specific opposing pair."
      : "Choose the player from each team for every head-to-head singles match.";
    const section = extra ? `round-${entry.round.id}` : format;
    const heading = betaIsCustomRound(entry?.round) ? betaRoundTitle(entry.round) : format === "pairs" ? "Three 2v2 matchups" : "Six singles matchups";
    return `<details class="tb-fold" data-tb-section="${section}" ${openSection === section || (!openSection && entry && format === "pairs" && !extra) ? "open" : ""}><summary><span><small>${extra ? `ADDED ROUND · ${betaRoundLabel(entry.round).toUpperCase()}` : format === "pairs" ? "ROUND 1" : "ROUND 2"}</small><strong>${heading}</strong></span><em class="${ready ? "is-ready" : ""}">${entry ? `${roundHoles(entry.round)} holes · ${scoringName} · ${entry.battles.length}/${expectedMatches} built` : "Not built"}</em></summary><div class="tb-fold-body"><p class="tb-copy">${explainer}</p>${entry ? `<div class="tb-format-state"><small>ROUND SCORING</small><strong>${scoringName}</strong><span>${selectedScoring === "match" ? "Every hole is won, lost, or tied." : "The lowest total strokes wins."}</span></div><div class="tb-round-tools">${["strokes", "match"].map(s => `<button class="btn ${selectedScoring === s ? "primary" : ""}" data-tb-scoring="${entry.round.id}:${s}" aria-pressed="${selectedScoring === s}">${s === "strokes" ? "Stroke play" : "Match play"}<small>${selectedScoring === s ? "Selected" : s === "match" ? "Hole by hole" : "Fewest strokes"}</small></button>`).join("")}</div><div class="tb-round-tools">${[9,18].map(holes => `<button class="btn ${roundHoles(entry.round) === holes ? "primary" : ""}" data-tb-holes="${entry.round.id}:${holes}" aria-pressed="${roundHoles(entry.round) === holes}">${holes} holes<small>${roundHoles(entry.round) === holes ? "Selected" : "Set round length"}</small></button>`).join("")}</div>${matchupEditor(state, entry)}` : `<div class="tb-empty">Build the two-round schedule from Teams & Captains first.</div>`}</div></details>`;
  };
  const hasGuests = state.participants.some(person => person.member_id == null);
  const guestAccess = `<details class="tb-fold" data-tb-section="guest-access" ${openSection === "guest-access" ? "open" : ""}><summary><span><small>OPTIONAL</small><strong>Guest access code</strong></span><em class="${state.guestCodeSet ? "is-ready" : ""}">${state.guestCodeSet ? "Code is set" : hasGuests ? "Set if guests score" : "Only needed for guests"}</em></summary><div class="tb-fold-body"><p class="tb-copy">Only set this when a guest needs to open the event on their own phone and enter scores.</p><label class="tb-guest-code"><span>Event code</span><input type="text" minlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" data-tb-guest-code placeholder="e.g. ROLLA26"></label><div class="tb-actions"><button class="btn primary" data-tb-set-code>Set code</button><button class="btn tb-reset" data-tb-clear-code ${state.guestCodeSet ? "" : "disabled"}>Clear code</button></div><p class="tb-copy">Four characters or more. The code itself is never displayed again; set a new one if it is forgotten.</p></div></details>`;
  const currentCustomSizes = betaCustomSizes(status.custom?.round) || [2, 1];
  const sideSizeOptions = selected => Array.from({ length: BETA_CUSTOM_MAX_SIDE }, (_, index) => index + 1).map(size => `<option value="${size}" ${size === selected ? "selected" : ""}>${size} golfer${size === 1 ? "" : "s"}</option>`).join("");
  const customSetup = `<details class="tb-fold" data-tb-section="custom" ${openSection === "custom" || Boolean(status.custom) || (!openSection && currentGuideStep === 3 && matchGuideTarget === "custom") ? "open" : ""}><summary><span><small>STEP 3 · CUSTOM</small><strong>Custom match</strong></span><em class="${status.customReady ? "is-ready" : ""}">${status.custom ? `${currentCustomSizes[0]} vs ${currentCustomSizes[1]} · ${status.customReady ? "Ready" : "Needs players"}` : "1–4 players per side"}</em></summary><div class="tb-fold-body"><p class="tb-copy">Best for 1v2, 2v2, or any single head-to-head match. Choose the size of each side, scoring style, and number of holes.</p><div class="tb-custom-grid"><label><span>${esc(state.teams[0]?.name || "Side 1")}</span><select class="tb-select" data-tb-custom-side="0">${sideSizeOptions(currentCustomSizes[0])}</select></label><strong>VS</strong><label><span>${esc(state.teams[1]?.name || "Side 2")}</span><select class="tb-select" data-tb-custom-side="1">${sideSizeOptions(currentCustomSizes[1])}</select></label></div><div class="tb-round-tools"><select class="tb-select" data-tb-custom-scoring aria-label="Custom match scoring"><option value="strokes" ${scoringOf(status.custom?.round) === "strokes" ? "selected" : ""}>Stroke play</option><option value="match" ${scoringOf(status.custom?.round) === "match" ? "selected" : ""}>Match play</option></select><select class="tb-select" data-tb-custom-holes aria-label="Custom match holes"><option value="9" ${roundHoles(status.custom?.round) === 9 ? "selected" : ""}>9 holes</option><option value="18" ${roundHoles(status.custom?.round) === 18 ? "selected" : ""}>18 holes</option></select></div><label class="tb-board-setting"><span><strong>Tournament points board</strong><small>Show the team-points board above scoring.</small></span><input type="checkbox" data-tb-custom-board aria-label="Show tournament points board" ${betaCustomBoardVisible(status.custom?.round) ? "checked" : ""}></label><div class="tb-actions"><button class="btn primary wide" data-tb-build-custom ${state.participants.length >= 2 ? "" : "disabled"}>${status.custom ? "Rebuild custom match" : "Build custom match"}</button></div>${status.custom ? matchupEditor(state, status.custom) : ""}</div></details>`;
  const traditionalBuilder = status.custom ? "" : `<details class="tb-fold" data-tb-section="traditional" ${openSection === "traditional" || (!openSection && currentGuideStep === 3 && matchGuideTarget === "traditional") ? "open" : ""}><summary><span><small>STEP 3 · TRADITIONAL</small><strong>Traditional team day</strong></span><em class="${status.pairsReady && status.singlesReady ? "is-ready" : ""}">${status.pairs || status.singles ? "Schedule built" : "6 vs 6 · captains required"}</em></summary><div class="tb-fold-body"><p class="tb-copy">Use this for the full two-team format: three 2v2 matches followed by six singles matches.</p><div class="tb-actions"><button class="btn primary wide" data-tb-build-team-day ${status.teamsReady && status.captainsReady ? "" : "disabled"}>${status.pairs || status.singles ? "Reset traditional schedule" : "Build traditional schedule"}</button></div>${status.teamsReady && status.captainsReady ? "" : `<p class="tb-copy">Before building, place exactly six golfers on each team and choose both captains in Step 2.</p>`}</div></details>`;
  const primaryRoundIds = new Set([status.pairs?.round?.id, status.singles?.round?.id, status.custom?.round?.id].filter(Boolean).map(String));
  const extraRounds = state.rounds.filter(entry => !entry.individual && !primaryRoundIds.has(String(entry.round.id)));
  const customSizesForAdd = betaCustomSizes(status.custom?.round);
  const customReadyToAdd = customSizesForAdd && state.teams.length === 2 && state.teams.every((team, index) => state.participants.filter(person => String(person.team_id) === String(team.id)).length >= customSizesForAdd[index]);
  const addRound = `<details class="tb-fold" data-tb-section="add-round" ${openSection === "add-round" ? "open" : ""}><summary><span><small>ANY TIME</small><strong>Add another round</strong></span><em>${extraRounds.length ? `${extraRounds.length} added` : status.custom ? "Repeat custom match" : "Pairs or singles"}</em></summary><div class="tb-fold-body"><p class="tb-copy">Add a complete round without replacing the schedule or scores already here. Matchups use the current team rosters and can be adjusted afterward.</p><div class="tb-actions">${status.custom ? `<button class="btn primary wide" data-tb-add-round="custom" ${customReadyToAdd ? "" : "disabled"}>Add another ${customSizesForAdd?.join("v") || "custom"} round</button>` : `<button class="btn primary" data-tb-add-round="pairs" ${status.teamsReady ? "" : "disabled"}>Add pairs round</button><button class="btn" data-tb-add-round="singles" ${status.teamsReady ? "" : "disabled"}>Add singles round</button>`}</div>${status.custom ? customReadyToAdd ? "" : `<p class="tb-copy">Place enough golfers on both sides before adding this custom round.</p>` : status.teamsReady ? "" : `<p class="tb-copy">Place exactly six golfers on each team before adding a traditional round.</p>`}</div></details>`;
  const primaryCards = status.custom ? "" : `${roundCard("pairs")}${roundCard("singles")}`;
  const traditionalRounds = `${primaryCards}${extraRounds.map(entry => roundCard(entry.round.format, entry, true)).join("")}${addRound}`;
  /*
    THE TWO SHARES THE CLASSIC TOURNAMENT PAGE HAD, and they were missing here.

    Beta kept them behind "Share images" inside the SCORING view, which is a
    screen a commissioner is on once the day has started. The team sheet and the
    points card are wanted before that: the matchups image goes out the night
    before, from the screen where the matchups were just built. Classic put
    "Share teams" on the Teams card and "Share tournament" on the points board
    for exactly that reason - see paintTeamShare() in golf-matches.js.

    Same two functions the scoring view calls, so there is one team sheet and
    one points card in this app and not a second pair drawn from setup state.
  */
  const shareReady = state.teams.length === 2;
  const builtMatches = state.rounds.reduce((n, entry) => n + (entry.battles?.length || 0), 0);
  const shareTools = `<details class="tb-fold" data-tb-section="share" ${openSection === "share" ? "open" : ""}><summary><span><small>ANY TIME</small><strong>Share images</strong></span><em class="${shareReady ? "is-ready" : ""}">${shareReady ? (builtMatches ? `${builtMatches} matchup${builtMatches === 1 ? "" : "s"} to post` : "Rosters ready") : "Create two sides first"}</em></summary><div class="tb-fold-body"><p class="tb-copy">Ready-to-send images of what you have built so far. The matchups card fills in as rounds are built; the summary carries the points once they are being played for.</p><div class="tb-actions"><button class="btn primary wide" data-tb-setup-share="teams" ${shareReady ? "" : "disabled"}>Teams &amp; matchups</button><button class="btn wide" data-tb-setup-share="tournament" ${shareReady ? "" : "disabled"}>Tournament summary</button></div>${shareReady ? "" : `<p class="tb-copy">Both cards are drawn from the two sides, so there is nothing to draw until Step 2 is done.</p>`}</div></details>`;
  const scoreCount = state.scoreRows.size;
  const scoreReset = `<details class="tb-fold" data-tb-section="score-reset" ${openSection === "score-reset" ? "open" : ""}><summary><span><small>COMMISSIONER TOOL</small><strong>Clear scorecards</strong></span><em>${scoreCount ? `${scoreCount} scored hole${scoreCount === 1 ? "" : "s"}` : "No scores entered"}</em></summary><div class="tb-fold-body"><p class="tb-copy">Remove every entered stroke from this Tournament Beta event without changing golfers, sides, matches, pars, or the course.</p><div class="tb-actions"><button class="btn tb-reset wide" data-tb-reset-scores ${scoreCount && !state.stale ? "" : "disabled"}>Clear all scorecards</button></div><p class="tb-copy">${state.stale ? "Reconnect before clearing scores." : "This cannot be undone."}</p></div></details>`;
  return `<main class="tb-shell" data-tbeta-root>
    <header class="tb-head"><a class="tb-circle" href="#/golf?id=${state.outing.id}" aria-label="Back to match">‹</a><div class="tb-hole"><strong>SETUP</strong><small>Tournament Beta</small></div><span></span></header>
    <div class="tb-sub"><div><small>Commissioner setup</small><strong>${esc(state.outing.course || state.outing.name)}</strong></div><a class="tb-link" href="#/golf?id=${state.outing.id}">MATCH →</a></div>
    <section class="tb-setup">
      ${setupGuide}
      <details class="tb-fold" data-tb-section="golfers" ${openSection === "golfers" || (!openSection && currentGuideStep === 1) ? "open" : ""}><summary><span><small>STEP 1</small><strong>Golfers</strong></span><em>${state.participants.length} added</em></summary><div class="tb-fold-body">${memberPicker(available)}<div class="tb-add"><input data-tb-guest placeholder="Guest golfer name"><button class="btn" data-tb-add-guest>Add guest</button></div><div class="tb-chips">${playerChips || "Add golfers to begin."}</div></div></details>
      ${courseAssignments}
      <details class="tb-fold" data-tb-section="teams" ${openSection === "teams" || (!openSection && currentGuideStep === 2) ? "open" : ""}><summary><span><small>STEP 2</small><strong>Sides & captains</strong></span><em class="${state.teams.length === 2 ? "is-ready" : ""}">${status.counts.join("–") || "0–0"} · Captains optional for custom</em></summary><div class="tb-fold-body"><p class="tb-copy">Name each team and place every golfer on a side. Captains are only required for the traditional two-round schedule.</p><div class="tb-team-actions"><button class="btn" data-tb-deal="even" ${state.teams.length !== 2 ? "disabled" : ""}>Place evenly</button><button class="btn" data-tb-deal="random" ${state.teams.length !== 2 ? "disabled" : ""}>Shuffle teams</button><button class="btn tb-reset" data-tb-create-teams>${state.teams.length === 2 ? "Reset teams" : "Create two teams"}</button></div>${teamControls}</div></details>
      ${customSetup}${traditionalBuilder}${guestAccess}${traditionalRounds}${shareTools}${scoreReset}<div class="tb-status" data-tb-status></div>
    </section>
  </main>`;
}

function scoreboard(state) {
  if (state.teams.length !== 2) return "";
  const { total } = dayPoints(state.rounds.filter(e => !e.individual));
  return `<section class="tb-scoreboard"><div class="tb-score-team"><strong>${total.get(String(state.teams[0].id)) || 0}</strong><span>${esc(state.teams[0].name)}</span><small>${captainName(state.teams[0], state.names) ? `Captain ${esc(captainName(state.teams[0], state.names))}` : "Captain not named"}</small></div><div class="tb-score-vs">POINTS</div><div class="tb-score-team"><strong>${total.get(String(state.teams[1].id)) || 0}</strong><span>${esc(state.teams[1].name)}</span><small>${captainName(state.teams[1], state.names) ? `Captain ${esc(captainName(state.teams[1], state.names))}` : "Captain not named"}</small></div></section>`;
}

function headToHead(entry, mine) {
  const myIds = new Set(mine.map(side => String(side.id)));
  const battle = entry.battles.find(item => item.sides.some(side => myIds.has(String(side.id))));
  if (!battle || battle.sides.length !== 2 || !battle.result) return "";
  const result = battle.result, matchPlay = scoringOf(entry.round) === "match";
  const names = battle.sides.map(sideName);
  const values = matchPlay ? [result.cardWonA || 0, result.cardWonB || 0] : [result.a || 0, result.b || 0];
  const metric = matchPlay ? (result.crossCourse ? "holes won vs par" : "holes won") : `strokes · thru ${result.thru || 0}${result.crossCourse ? " · ranked vs par" : ""}`;
  const sides = battle.sides.map((side, index) => `<div class="tb-h2h-side"><strong>${esc(names[index])}</strong><b>${values[index]}</b><small>${myIds.has(String(side.id)) ? `You · ${metric}` : metric}</small></div>`);
  return `<section class="tb-h2h"><div class="tb-h2h-head"><span>Your match</span><span>${matchPlay ? "Match play" : "Stroke play"}</span></div><div class="tb-h2h-grid">${sides[0]}<span class="tb-h2h-vs">VS</span>${sides[1]}</div><div class="tb-h2h-status">${esc(standingLine(result, names[0], names[1]))}</div></section>`;
}

function matchMarkup(state) {
  const playable = state.individual ? state.rounds.filter(e => e.individual) : state.rounds.filter(e => !e.individual && ["pairs", "singles"].includes(e.round.format));
  if (!playable.length) return `<main class="tb-shell" data-tbeta-root><header class="tb-head"><a class="tb-circle" href="#/golf">‹</a><div class="tb-hole"><strong>MATCH</strong><small>Tournament Beta</small></div><span></span></header><div class="tb-sub"><div><small>Tournament Beta</small><strong>${esc(state.outing.course || state.outing.name)}</strong></div>${state.organizer ? `<a class="tb-link" href="#/golf?id=${state.outing.id}&setup=1">SETUP</a>` : ""}</div><div class="tb-empty">${state.organizer ? "Build the field in Setup to start scoring." : "Waiting for the commissioner to build the field."}</div></main>`;
  const wanted = activeFormat.get(state.outing.id), entry = betaSelectedRound(playable, wanted); activeFormat.set(state.outing.id, String(entry.round.id));
  const count = roundHoles(entry.round), hole = Math.max(1, Math.min(count, rememberedHole(state.outing.id))); rememberHole(state.outing.id, hole);
  const sides = matchSides(state, entry), balls = sides.map(s => ({ ...s, round: entry.round, matchId: s.match_id, matchNumber: s.match_number, teamOrder: s.slot }));
  const leaders = roundBoard({ balls, holes: state.holes }, entry.round).flatMap(g => g.rows);
  const leaderboard = `<section class="tb-leader"><div class="tb-leader-head"><span>${entry.round.format === "pairs" ? "Pairs" : "Singles"} live leaderboard</span><span>LIVE</span></div>${leaders.map((r, i) => `<div class="tb-leader-row"><span>${i + 1}</span><div><strong>${esc(r.name)}</strong><small>${esc(r.teamName)} · ${boardProgress(r)}</small></div><em>${boardLabel(r)}</em></div>`).join("") || `<div class="tb-empty">No matchups yet.</div>`}</section>`;
  const matches = entry.battles.map(b => { const names = b.sides.map(sideName); return `<article class="tb-match-card"><div class="tb-match-title"><strong>Match ${b.match_number}</strong><span>${b.result ? esc(standingLine(b.result, names[0], names[1])) : "Waiting for both sides"}</span></div>${b.sides.map(s => { const row = state.scoreRows.get(scoreKey(s.id, hole)) || {}, editable = canScoreBetaCard({ ...state, individual: true, memberId: getMemberId(), cardId: s.id }), total = [...s.strokes.values()].reduce((a, n) => a + Number(n || 0), 0), value = Number(row.strokes) || 0; return `<div class="tb-score-side"><div><strong>${esc(sideName(s))}</strong><small>${esc(s.teamName)} · ${s.strokes.size ? `${total} strokes · Thru ${s.strokes.size}` : "Not started"}</small></div>${editable ? `<button class="tb-score" data-tb-open="${s.id}">Hole ${hole}<b>${value || "+"}</b></button>` : `<span class="tb-score is-readonly">Hole ${hole}<b>${value || "—"}</b></span>`}</div>`; }).join("")}</article>`; }).join("");
  const table = scorecardTable(state, sides, count);
  return `<main class="tb-shell" data-tbeta-root><header class="tb-head"><a class="tb-circle" href="#/golf">‹</a><div class="tb-hole"><strong>HOLE ${hole}</strong><small>Par ${parFor(state.holes, hole)} · ${entry.round.format}</small></div><button class="tb-circle" data-tb-next>›</button></header><div class="tb-sub"><div><small>${betaRoundTitle(entry.round)}</small><strong>${esc(state.outing.course || state.outing.name)}</strong></div>${state.organizer ? `<a class="tb-link" href="#/golf?id=${state.outing.id}&setup=1">SETUP</a>` : ""}</div><section class="tb-play">${state.individual || !betaCustomBoardVisible(entry.round) ? "" : scoreboard(state)}${playable.length > 1 ? `<div class="tb-round-tabs">${playable.map(e => `<button class="${e === entry ? "is-active" : ""}" data-tb-format="${e.round.id}">${betaRoundLabel(e.round)}</button>`).join("")}</div>` : ""}${leaderboard}${matches}<div class="tb-bottom ${state.organizer ? "" : "is-member"}"><button class="btn" data-tb-card>Scorecard</button>${state.organizer ? `<button class="btn primary" data-tb-finish ${state.outing.status === "final" ? "disabled" : ""}>${state.outing.status === "final" ? "Finished" : "Finish tournament"}</button>` : ""}</div></section><section class="tb-scorecard" hidden><header class="tb-card-head"><button class="tb-card-back" data-tb-card>‹ Back</button><h2>${entry.round.format.toUpperCase()} SCORECARD</h2></header>${scorecardBody(table)}</section><section class="tb-sheet" data-tb-sheet hidden><div class="tb-sheet-head"><span class="tb-avatar" data-tb-avatar>G</span><div><strong data-tb-name>Golfer</strong><small>Hole ${hole} · Par ${parFor(state.holes, hole)}</small></div><button class="tb-done" data-tb-done>Done</button></div><div class="tb-controls">${["strokes", "putts"].map(f => `<div><span class="tb-label">${f === "strokes" ? "Shots" : "Putts"}</span><div class="tb-step"><button data-tb-step="${f}:-1">−</button><output data-tb-${f}>—</output><button data-tb-step="${f}:1">+</button></div></div>`).join("")}</div></section></main>`;
}

function focusedMatchMarkup(state) {
  const playable = state.rounds.filter(e => !e.individual && ["pairs", "singles"].includes(e.round.format));
  if (!playable.length) return `<main class="tb-shell" data-tbeta-root><header class="tb-head"><a class="tb-circle" href="#/golf" aria-label="Back">‹</a><div class="tb-hole"><strong>MATCH</strong><small>Tournament Beta</small></div><span></span></header><div class="tb-sub"><div><small>Tournament Beta</small><strong>${esc(state.outing.course || state.outing.name)}</strong></div>${state.organizer ? `<a class="tb-link" href="#/golf?id=${state.outing.id}&setup=1">SETUP</a>` : ""}</div><div class="tb-empty">${state.organizer ? "Open Setup and build the two-team matchups." : "Waiting for the commissioner to assign the matchups."}</div></main>`;
  const wanted = activeFormat.get(state.outing.id), entry = betaSelectedRound(playable, wanted);
  activeFormat.set(state.outing.id, String(entry.round.id));
  const count = roundHoles(entry.round), hole = Math.max(1, Math.min(count, rememberedHole(state.outing.id))), assignedCourseId = memberCourseId(state), assignedHoles = courseHolesForId(state, assignedCourseId), yards = yardageFor(assignedHoles, hole);
  const yardages = Array.from({ length: count }, (_, i) => yardageFor(assignedHoles, i + 1)).join(","), pars = Array.from({ length: count }, (_, i) => parFor(assignedHoles, i + 1)).join(",");
  rememberHole(state.outing.id, hole);
  const sides = matchSides(state, entry), balls = sides.map(s => ({ ...s, round: entry.round, matchId: s.match_id, matchNumber: s.match_number, teamOrder: s.slot, holes: sideCourseHoles(state, s), courseName: sideCourseName(state, s) }));
  const leaders = roundBoard({ balls, holes: state.holes }, entry.round).flatMap(g => g.rows);
  const tabs = playable.length > 1 ? `<div class="tb-round-tabs">${playable.map(e => `<button class="${e === entry ? "is-active" : ""}" data-tb-format="${e.round.id}">${betaRoundLabel(e.round)}</button>`).join("")}</div>` : "";
  const leaderboard = `<section class="tb-leader"><div class="tb-leader-head"><span>${betaRoundLabel(entry.round)} live leaderboard</span><span>LIVE</span></div>${leaders.map((r, i) => `<div class="tb-leader-row"><span>${i + 1}</span><div><strong>${esc(r.name)}</strong><small>${esc(r.teamName)} · <span class="tb-leader-course">${esc(r.courseName)}</span> · ${boardProgress(r)}</small></div><em>${boardLabel(r)}</em></div>`).join("") || `<div class="tb-empty">No matchups yet.</div>`}</section>`;
  const matches = entry.battles.map(b => {
    const names = b.sides.map(sideName);
    return `<article class="tb-match-card"><div class="tb-match-title"><strong>Match ${b.match_number}</strong><span>${b.result ? esc(standingLine(b.result, names[0], names[1])) : "Waiting for both sides"}</span></div>${b.sides.map(s => {
      const row = state.scoreRows.get(scoreKey(s.id, hole)) || {}, editable = canScoreBetaCard({ ...state, individual: true, memberId: getMemberId(), cardId: s.id }), total = [...s.strokes.values()].reduce((a, n) => a + Number(n || 0), 0);
      const value = Number(row.strokes) || 0;
      return `<div class="tb-score-side"><div><strong>${esc(sideName(s))}</strong><small>${esc(s.teamName)} · ${s.strokes.size ? `${total} strokes · Thru ${s.strokes.size}` : "Not started"}</small></div>${editable ? `<button class="tb-score" data-tb-open="${s.id}">Hole ${hole}<b>${value || "+"}</b></button>` : `<span class="tb-score is-readonly">Hole ${hole}<b>${value || "—"}</b></span>`}</div>`;
    }).join("")}</article>`;
  }).join("");
  const editableIds = new Set(betaEditableSideIds({ ...state, memberId: getMemberId() }));
  const mine = sides.filter(s => editableIds.has(String(s.id)));
  const quickMatch = headToHead(entry, mine);
  const memberEntry = `<section class="tb-member-entry"><div class="tb-member-hint">Your score entry · other players' scores are available under Scorecard</div>${mine.length ? mine.map(s => {
    const row = state.scoreRows.get(scoreKey(s.id, hole)) || {}, total = [...s.strokes.values()].reduce((a, n) => a + Number(n || 0), 0);
    return `<article class="tb-quick-player"><div class="tb-avatar">${esc(initials(sideName(s)))}</div><div><div class="tb-quick-name">${esc(sideName(s))}</div><div class="tb-quick-status">${s.strokes.size ? `${total} strokes` : `Hole ${hole}`} <small>· ${esc(s.teamName)} · Thru ${s.strokes.size}</small></div></div><button class="tb-quick-add" data-tb-open="${s.id}">${Number(row.strokes) ? `<span>${Number(row.strokes)}</span>Edit score<small>Hole ${hole}</small>` : `<span>+</span>Add score<small>Hole ${hole}</small>`}</button></article>`;
  }).join("") : `<div class="tb-empty">You are not assigned to this ${betaIsCustomRound(entry.round) ? "custom" : entry.round.format === "pairs" ? "2v2" : "singles"} matchup yet.</div>`}</section>`;
  const table = scorecardTable(state, sides, count, true);
  const gps = `<div class="tb-gps-slot" data-tb-gps-slot data-tb-hole-yardage="${yards}" data-tb-hole-par="${parFor(assignedHoles, hole)}"></div>`;
  const tournamentBoard = betaCustomBoardVisible(entry.round) ? scoreboard(state) : "";
  const playBody = state.organizer ? `${tournamentBoard}${tabs}${gps}${leaderboard}${matches}` : `${tabs}${gps}${quickMatch}${memberEntry}`;
  const boardOpen = !state.organizer && leaderboardOpen.get(state.outing.id) === true;
  const memberLeaderboard = state.organizer ? "" : `<section class="tb-scorecard tb-leaderboard-view" data-tb-leaderboard-view ${boardOpen ? "" : "hidden"}><header class="tb-card-head"><button class="tb-card-back" data-tb-leaderboard>‹ Back to scoring</button><h2>LIVE LEADERBOARD</h2></header><div class="tb-leaderboard-field">${tournamentBoard}${tabs}${leaderboard}</div></section>`;
  const scoringName = scoringOf(entry.round) === "match" ? "MATCH PLAY" : "STROKE PLAY";
  return `<main class="tb-shell" data-tbeta-root data-tb-hole="${hole}" data-tb-hole-count="${count}" data-tb-yardages="${yardages}" data-tb-pars="${pars}"><header class="tb-head"><button class="tb-circle" data-tb-prev aria-label="Previous hole">‹</button><div class="tb-hole"><strong>HOLE ${hole}</strong><small>Par ${parFor(state.holes, hole)}${yards ? ` · <span class="tb-yardage">${yards} yd</span>` : ""} · ${betaRoundLabel(entry.round)} · ${scoringName}</small></div><button class="tb-circle" data-tb-next aria-label="Next hole">›</button></header><div class="tb-sub"><div><small>${betaRoundTitle(entry.round)} · ${scoringName}</small><strong>${esc(state.outing.course || state.outing.name)}</strong></div>${state.organizer ? `<a class="tb-link" href="#/golf?id=${state.outing.id}&setup=1">SETUP</a>` : `<a class="tb-link" href="#/golf">GOLF HOME</a>`}</div><div class="tb-sync" data-tb-sync>${syncText(state)}</div><section class="tb-play" ${boardOpen ? "hidden" : ""}>${playBody}<div class="tb-bottom has-share"><button class="btn" data-tb-share-open>Share images</button><button class="btn" data-tb-card>Scorecard</button>${state.organizer ? `<button class="btn primary" data-tb-finish ${state.outing.status === "final" ? "disabled" : ""}>${state.outing.status === "final" ? "Finished" : "Finish tournament"}</button>` : `<button class="btn" data-tb-leaderboard>Leaderboard</button>`}</div></section><section class="tb-scorecard" hidden><header class="tb-card-head"><button class="tb-card-back" data-tb-card>‹ Back to scoring</button><h2>${betaRoundLabel(entry.round).toUpperCase()} · ${scoringName} SCORECARD</h2></header>${scorecardBody(table)}</section>${memberLeaderboard}<section class="tb-share-sheet" data-tb-share-sheet hidden><div class="tb-share-panel"><h2>Share tournament</h2><p>Each option makes a ready-to-send image.</p><div class="tb-share-options"><button class="btn ghost tb-share-option" data-tb-share="scorecard"><strong>Scorecard</strong><small>Front nine, back nine and totals</small></button><button class="btn ghost tb-share-option" data-tb-share="leaderboard"><strong>Live leaderboard</strong><small>Current standings for this round</small></button><button class="btn ghost tb-share-option" data-tb-share="teams"><strong>Teams &amp; matchups</strong><small>Rosters and every scheduled match</small></button><button class="btn ghost tb-share-option" data-tb-share="tournament"><strong>Tournament summary</strong><small>Overall points and round results</small></button></div><button class="btn ghost tb-share-close" data-tb-share-close>Cancel</button></div></section><section class="tb-sheet tb-quick-sheet" data-tb-sheet hidden><div class="tb-sheet-head"><span class="tb-avatar" data-tb-avatar>G</span><div><strong data-tb-name>Golfer</strong><small>Enter strokes for hole ${hole}</small></div></div><div class="tb-controls"><div class="tb-step"><button data-tb-step="strokes:-1" aria-label="One fewer stroke">−</button><output data-tb-strokes>—</output><button data-tb-step="strokes:1" aria-label="One more stroke">+</button></div></div><div class="tb-sheet-actions has-clear"><button class="btn tb-clear-hole" data-tb-clear disabled>${state.organizer ? "Clear hole" : "Remove score"}</button><button class="btn" data-tb-cancel>Cancel</button><button class="btn primary" data-tb-save>${hole < count ? "Save & next" : "Save score"}</button></div></section></main>`;
}

async function assignSeat(state, roundId, sideId, rowId, participantId) {
  const entry = state.rounds.find(e => String(e.round.id) === String(roundId)), players = matchSides(state, entry).flatMap(s => s.players), held = players.find(p => String(p.participant_id) === String(participantId)), outgoing = players.find(p => String(p.row_id) === String(rowId));
  if (!participantId) { if (rowId) { const r = await db().from("golf_match_players").delete().eq("id", rowId); if (r.error) throw r.error; } return; }
  if (held && String(held.row_id) !== String(rowId)) { const gone = await db().from("golf_match_players").delete().in("id", [held.row_id, ...(rowId ? [rowId] : [])]); if (gone.error) throw gone.error; const rows = [{ side_id: Number(sideId), participant_id: Number(participantId) }]; if (outgoing) rows.push({ side_id: Number(held.side_id), participant_id: Number(outgoing.participant_id) }); const made = await db().from("golf_match_players").insert(rows); if (made.error) throw made.error; }
  else if (rowId) { const r = await db().from("golf_match_players").update({ participant_id: Number(participantId) }).eq("id", rowId); if (r.error) throw r.error; }
  else { const r = await db().from("golf_match_players").insert({ side_id: Number(sideId), participant_id: Number(participantId) }); if (r.error) throw r.error; }
}

async function createTeams(state) {
  if ((state.teams.length || state.rounds.length) && !confirm("Replace the current Beta teams and schedule? Existing Beta match scores will be removed.")) return false;
  let r = await db().from("golf_participants").update({ team_id: null, pick_number: null, picked_at: null }).eq("outing_id", state.outing.id); if (r.error) throw r.error;
  r = await db().from("golf_rounds").delete().eq("outing_id", state.outing.id); if (r.error) throw r.error;
  r = await db().from("golf_teams").delete().eq("outing_id", state.outing.id); if (r.error) throw r.error;
  r = await db().from("golf_teams").insert([{ outing_id: state.outing.id, name: "Team 1", color: "#c73a33", sort_order: 0, draft_order: 0 }, { outing_id: state.outing.id, name: "Team 2", color: "#f4c430", sort_order: 1, draft_order: 1 }]); if (r.error) throw r.error; return true;
}

async function dealTeams(state, shuffle) {
  const players = [...state.participants]; if (shuffle) for (let i = players.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [players[i], players[j]] = [players[j], players[i]]; }
  const cleared = await db().from("golf_teams").update({ captain_member_id: null }).eq("outing_id", state.outing.id); if (cleared.error) throw cleared.error;
  const writes = await Promise.all(players.map((p, i) => db().from("golf_participants").update({ team_id: state.teams[i % 2].id }).eq("id", p.id))); const failed = writes.find(r => r.error); if (failed) throw failed.error;
}

async function buildTeamDay(state) {
  const status = betaFormatStatus(state);
  if (!status.teamsReady) throw new Error("Place exactly six golfers on each team first.");
  if (!status.captainsReady) throw new Error("Choose a captain from each team's six golfers first.");
  if (state.rounds.length && !confirm("Reset both rounds and their scores, then build the schedule again?")) return false;
  let r = await db().from("golf_rounds").delete().eq("outing_id", state.outing.id); if (r.error) throw r.error;
  const addRound = async format => { const added = await db().rpc("golf_add_round", { p_outing_id: state.outing.id, p_format: format, p_scoring: "match" }); if (added.error) throw added.error; const changed = await db().from("golf_rounds").update({ name: betaRoundName(format), holes: format === "pairs" ? 18 : 9 }).eq("id", added.data); if (changed.error) throw changed.error; return Number(added.data); };
  const pairsId = await addRound("pairs"); await buildStandardRoundMatches(state, pairsId, "pairs");
  const singlesId = await addRound("singles"); await buildStandardRoundMatches(state, singlesId, "singles");
  return true;
}

async function buildStandardRoundMatches(state, roundId, format) {
  if (format === "pairs") {
    const built = await db().rpc("golf_build_pairs", { p_round_id: Number(roundId) });
    if (built.error) throw built.error;
    return;
  }
  const pools = state.teams.map(team => state.participants
    .filter(person => String(person.team_id) === String(team.id))
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order)));
  if (pools.length !== 2 || pools.some(pool => pool.length < betaMatchCount("singles"))) throw new Error("Place exactly six golfers on each team first.");
  for (let i = 0; i < betaMatchCount("singles"); i++) {
    const made = await db().rpc("golf_add_match", { p_round_id: Number(roundId) });
    if (made.error) throw made.error;
    const sides = await db().from("golf_match_sides").select("id").eq("match_id", made.data).order("slot");
    if (sides.error) throw sides.error;
    const seated = await db().from("golf_match_players").insert(sides.data.map((side, index) => ({ side_id: side.id, participant_id: pools[index][i].id })));
    if (seated.error) throw seated.error;
  }
}

async function addBetaRound(state, format) {
  const status = betaFormatStatus(state);
  if (format === "custom") {
    const source = status.custom;
    const sizes = betaCustomSizes(source?.round);
    if (!source || !sizes) throw new Error("Build the first custom match before adding another round.");
    const rosters = state.teams.map(team => state.participants
      .filter(person => String(person.team_id) === String(team.id))
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order)));
    if (rosters.length !== 2 || rosters.some((roster, index) => roster.length < sizes[index])) throw new Error("Place enough golfers on both sides first.");
    const added = await db().rpc("golf_add_round", { p_outing_id: state.outing.id, p_format: source.round.format, p_scoring: scoringOf(source.round) });
    if (added.error) throw added.error;
    const roundId = Number(added.data);
    try {
      let result = await db().from("golf_rounds").update({ name: source.round.name, holes: roundHoles(source.round) }).eq("id", roundId);
      if (result.error) throw result.error;
      const made = await db().rpc("golf_add_match", { p_round_id: roundId });
      if (made.error) throw made.error;
      const sides = await db().from("golf_match_sides").select("id").eq("match_id", made.data).order("slot");
      if (sides.error) throw sides.error;
      const seats = sides.data.flatMap((side, index) => rosters[index].slice(0, sizes[index]).map(person => ({ side_id: side.id, participant_id: person.id })));
      result = await db().from("golf_match_players").insert(seats);
      if (result.error) throw result.error;
      return roundId;
    } catch (error) {
      await db().from("golf_rounds").delete().eq("id", roundId);
      throw error;
    }
  }
  if (!status.teamsReady) throw new Error("Place exactly six golfers on each team first.");
  const holes = format === "pairs" ? 18 : 9;
  const added = await db().rpc("golf_add_round", { p_outing_id: state.outing.id, p_format: format, p_scoring: "match" });
  if (added.error) throw added.error;
  const roundId = Number(added.data);
  try {
    const changed = await db().from("golf_rounds").update({ name: betaAddedRoundName(state.rounds, format), holes }).eq("id", roundId);
    if (changed.error) throw changed.error;
    await buildStandardRoundMatches(state, roundId, format);
    return roundId;
  } catch (error) {
    await db().from("golf_rounds").delete().eq("id", roundId);
    throw error;
  }
}

async function buildCustomMatch(state, sizes, holes, scoring, showBoard = true) {
  if (!sizes.every(size => Number.isInteger(size) && size >= 1 && size <= BETA_CUSTOM_MAX_SIDE)) throw new Error("Choose between one and four golfers per side.");
  const needed = sizes[0] + sizes[1];
  if (state.participants.length < needed) throw new Error(`A ${sizes[0]}v${sizes[1]} needs ${needed} golfers. Add ${needed - state.participants.length} more first.`);
  let teams = state.teams, rosters, assignments = [];
  if (teams.length !== 2) {
    if ((teams.length || state.rounds.length) && !confirm(`Reset the current teams and schedule, then build one ${sizes[0]}v${sizes[1]} custom match? Existing match scores will be removed.`)) return false;
    let result = await db().from("golf_rounds").delete().eq("outing_id", state.outing.id); if (result.error) throw result.error;
    result = await db().from("golf_participants").update({ team_id: null, pick_number: null, picked_at: null }).eq("outing_id", state.outing.id); if (result.error) throw result.error;
    result = await db().from("golf_teams").delete().eq("outing_id", state.outing.id); if (result.error) throw result.error;
    result = await db().from("golf_teams").insert([{ outing_id: state.outing.id, name: "Side 1", color: "#c73a33", sort_order: 0, draft_order: 0 }, { outing_id: state.outing.id, name: "Side 2", color: "#477fbd", sort_order: 1, draft_order: 1 }]).select("*").order("sort_order"); if (result.error) throw result.error;
    teams = result.data || [];
    if (teams.length !== 2) throw new Error("The two custom-match sides could not be created.");
    const ordered = [...state.participants].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    rosters = [ordered.slice(0, sizes[0]), ordered.slice(sizes[0], needed)];
    assignments = rosters.flatMap((roster, index) => roster.map(person => ({ person, teamId: teams[index].id })));
  } else {
    rosters = teams.map(team => state.participants.filter(person => String(person.team_id) === String(team.id)).sort((a, b) => Number(a.sort_order) - Number(b.sort_order)));
    const unassigned = state.participants.filter(person => !teams.some(team => String(person.team_id) === String(team.id))).sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    rosters.forEach((roster, index) => { while (roster.length < sizes[index] && unassigned.length) { const person = unassigned.shift(); roster.push(person); assignments.push({ person, teamId: teams[index].id }); } });
  }
  const shortSide = rosters.findIndex((roster, index) => roster.length < sizes[index]);
  if (shortSide >= 0) throw new Error(`${teams[shortSide].name} needs ${sizes[shortSide]} golfer${sizes[shortSide] === 1 ? "" : "s"}. Move or unassign a golfer in Teams, then try again.`);
  if (state.teams.length === 2 && state.rounds.length && !confirm(`Replace the current Beta schedule with one ${sizes[0]}v${sizes[1]} custom match? Existing match scores will be removed.`)) return false;
  let result = await db().from("golf_rounds").delete().eq("outing_id", state.outing.id); if (result.error) throw result.error;
  for (const { person, teamId } of assignments) { result = await db().from("golf_participants").update({ team_id: teamId }).eq("id", person.id); if (result.error) throw result.error; }
  const added = await db().rpc("golf_add_round", { p_outing_id: state.outing.id, p_format: "pairs", p_scoring: scoring }); if (added.error) throw added.error;
  const roundId = Number(added.data), name = betaCustomRoundName(sizes, showBoard);
  result = await db().from("golf_rounds").update({ name, holes }).eq("id", roundId); if (result.error) throw result.error;
  const made = await db().rpc("golf_add_match", { p_round_id: roundId }); if (made.error) throw made.error;
  const sides = await db().from("golf_match_sides").select("id,team_id,slot").eq("match_id", made.data).order("slot"); if (sides.error) throw sides.error;
  const seats = sides.data.flatMap((side, index) => rosters[index].slice(0, sizes[index]).map(person => ({ side_id: side.id, participant_id: person.id })));
  result = await db().from("golf_match_players").insert(seats); if (result.error) throw result.error;
  return true;
}

function setupPosition(root, control) {
  const scroller = root.querySelector(".tb-setup");
  if (!scroller || !control) return null;
  const identity = ["data-row", "data-tb-place", "data-tb-captain", "data-tb-team-name", "data-tb-seat", "data-tb-save-team"]
    .map(name => [name, control.getAttribute(name)]).find(([, value]) => value);
  return {
    scrollTop: scroller.scrollTop,
    offset: control.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
    controlIndex: [...root.querySelectorAll("select,input,button")].indexOf(control),
    identity
  };
}

function restoreSetupPosition(root, saved) {
  if (!saved || !root.isConnected) return;
  const scroller = root.querySelector(".tb-setup");
  if (!scroller) return;
  scroller.scrollTop = saved.scrollTop;
  let control = null;
  if (saved.identity) {
    const [name, value] = saved.identity;
    control = [...root.querySelectorAll(`[${name}]`)].find(el => el.getAttribute(name) === value) || null;
  }
  control ||= [...root.querySelectorAll("select,input,button")][saved.controlIndex] || null;
  if (!control) return;
  scroller.scrollTop += control.getBoundingClientRect().top - scroller.getBoundingClientRect().top - saved.offset;
  control.focus({ preventScroll: true });
}

function wireSetup(root, state) {
  const busy = async (button, task) => {
    const saved = setupPosition(root, button);
    button.disabled = true;
    root.querySelector("[data-tb-status]").textContent = "Working…";
    try {
      await task();
      restoreSetupPosition(root, saved);
      requestAnimationFrame(() => restoreSetupPosition(root, saved));
    } catch (e) {
      toast(e.message || "Setup did not save", true);
      root.querySelector("[data-tb-status]").textContent = "";
      button.disabled = false;
    }
  };
  /*
    NOT through busy(), and deliberately not async. navigator.share has to be
    called in the same task as the tap that asked for it, and awaiting anything
    on the way there spends the gesture - on iOS that is the difference between
    the share sheet opening and a NotAllowedError. See the note at the top of
    share.js, and the same warning on wireShare() in golf-matches.js.
  */
  root.querySelectorAll("[data-tb-setup-share]").forEach(button => button.addEventListener("click", () => {
    const result = button.dataset.tbSetupShare === "teams" ? shareBetaTeams(state) : shareBetaTournament(state);
    toast(result === "failed" ? "That image could not be built" : (typeof result === "string" ? result : "Sharing…"), result === "failed");
  }));
  root.querySelectorAll("[data-tb-section]").forEach(section => section.addEventListener("toggle", () => { if (section.open) setupSection.set(state.outing.id, section.dataset.tbSection); }));
  root.querySelectorAll("[data-tb-jump]").forEach(button => button.addEventListener("click", () => {
    const section = root.querySelector(`[data-tb-section="${button.dataset.tbJump}"]`);
    if (!section) return;
    section.open = true;
    setupSection.set(state.outing.id, section.dataset.tbSection);
    requestAnimationFrame(() => section.scrollIntoView({ behavior: "smooth", block: "start" }));
  }));
  root.querySelectorAll("[data-tb-mode]").forEach(b => b.addEventListener("click", () => { setupMode.set(state.outing.id, b.dataset.tbMode); root.querySelectorAll("[data-tb-mode]").forEach(x => x.classList.toggle("is-active", x === b)); root.querySelectorAll("[data-tb-panel]").forEach(x => { x.hidden = x.dataset.tbPanel !== b.dataset.tbMode; }); }));
  root.querySelector("[data-tb-add-member]")?.addEventListener("click", e => busy(e.currentTarget, async () => {
    const memberIds = [...root.querySelectorAll("[data-tb-member]:checked")].map(input => Number(input.value)).filter(Boolean);
    if (!memberIds.length) throw new Error("Select at least one golfer first.");
    const rows = memberIds.map((member_id, index) => ({ outing_id: state.outing.id, member_id, sort_order: state.participants.length + index }));
    const result = await db().from("golf_participants").insert(rows); if (result.error) throw result.error;
    toast(`${memberIds.length} golfer${memberIds.length === 1 ? "" : "s"} added`);
    await paint();
  }));
  root.querySelector("[data-tb-add-guest]")?.addEventListener("click", e => busy(e.currentTarget, async () => { const guest_name = root.querySelector("[data-tb-guest]").value.trim(); if (!guest_name) throw new Error("Enter the guest's name."); const r = await db().from("golf_participants").insert({ outing_id: state.outing.id, guest_name, sort_order: state.participants.length }); if (r.error) throw r.error; await paint(); }));
  root.querySelector("[data-tb-set-code]")?.addEventListener("click", e => busy(e.currentTarget, async () => { const input = root.querySelector("[data-tb-guest-code]"), code = input?.value.trim() || ""; if (code.length < 4) throw new Error("Use at least four characters for the guest code."); const r = await db().rpc("golf_set_event_code", { p_outing_id: Number(state.outing.id), p_code: code }); if (r.error) throw r.error; toast("Guest access code set"); setupSection.set(state.outing.id, "guest-access"); await paint(); }));
  root.querySelector("[data-tb-clear-code]")?.addEventListener("click", e => { if (!confirm("Clear the guest access code? Guests will lose access immediately.")) return; busy(e.currentTarget, async () => { const r = await db().rpc("golf_set_event_code", { p_outing_id: Number(state.outing.id), p_code: "" }); if (r.error) throw r.error; toast("Guest access code cleared"); setupSection.set(state.outing.id, "guest-access"); await paint(); }); });
  root.querySelector("[data-tb-reset-scores]")?.addEventListener("click", e => {
    if (!confirm(clearAllPrompt(state))) return;
    busy(e.currentTarget, async () => {
      await clearAllBetaScores(state);
      toast("Tournament Beta scorecards cleared");
      setupSection.set(state.outing.id, "score-reset");
      await paint();
    });
  });
  root.querySelectorAll("[data-tb-remove]").forEach(b => b.addEventListener("click", () => busy(b, async () => { const r = await db().from("golf_participants").delete().eq("id", b.dataset.tbRemove); if (r.error) throw r.error; await paint(); })));
  root.querySelectorAll("[data-tb-player-course]").forEach(select => select.addEventListener("change", e => busy(e.currentTarget, async () => {
    const courseId = select.value ? Number(select.value) : null;
    const result = await db().from("golf_participants").update({ course_id: courseId }).eq("id", Number(select.dataset.tbPlayerCourse)).select("id").maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error("Only a Golf commissioner can assign player courses.");
    setupSection.set(state.outing.id, "courses");
    toast(courseId ? "Player course assigned" : "Player now uses the event course");
    await paint();
  })));
  root.querySelector("[data-tb-build-singles]")?.addEventListener("click", e => busy(e.currentTarget, async () => { if (state.rounds.length && !confirm("Replace the current Beta schedule with an individual singles field?")) return; let r = await db().from("golf_rounds").delete().eq("outing_id", state.outing.id); if (r.error) throw r.error; const added = await db().rpc("golf_add_round", { p_outing_id: state.outing.id, p_format: "singles", p_scoring: "strokes" }); if (added.error) throw added.error; await db().from("golf_rounds").update({ name: "Individual Singles", holes: Number(state.outing.holes) || 18 }).eq("id", added.data); r = await db().rpc("golf_sync_individual_match", { p_round_id: Number(added.data) }); if (r.error) throw r.error; location.hash = `#/golf?id=${state.outing.id}`; }));
  root.querySelector("[data-tb-create-teams]")?.addEventListener("click", e => busy(e.currentTarget, async () => { if (await createTeams(state)) await paint(); else e.currentTarget.disabled = false; }));
  root.querySelectorAll("[data-tb-deal]").forEach(b => b.addEventListener("click", e => busy(e.currentTarget, async () => { await dealTeams(state, b.dataset.tbDeal === "random"); await paint(); })));
  root.querySelectorAll("[data-tb-place]").forEach(s => s.addEventListener("change", e => busy(e.currentTarget, async () => {
    const person = state.participants.find(p => String(p.id) === String(s.dataset.tbPlace));
    const former = state.teams.find(t => String(t.id) === String(person?.team_id));
    if (former?.captain_member_id != null && String(former.captain_member_id) === String(person?.member_id)) {
      const cleared = await db().from("golf_teams").update({ captain_member_id: null }).eq("id", former.id);
      if (cleared.error) throw cleared.error;
    }
    const r = await db().from("golf_participants").update({ team_id: s.value ? Number(s.value) : null }).eq("id", s.dataset.tbPlace);
    if (r.error) throw r.error;
    await paint();
  })));
  root.querySelectorAll("[data-tb-captain]").forEach(s => s.addEventListener("change", e => busy(e.currentTarget, async () => {
    const team = state.teams.find(t => String(t.id) === String(s.dataset.tbCaptain));
    const memberId = s.value ? Number(s.value) : null;
    if (memberId && !betaCaptainChoices(team, state.participants).some(p => Number(p.member_id) === memberId)) throw new Error("Choose a captain from this team's roster.");
    const r = await db().from("golf_teams").update({ captain_member_id: memberId }).eq("id", team.id).select("id").maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) throw new Error("Only the commissioner can set captains.");
    await paint();
  })));
  root.querySelectorAll("[data-tb-save-team]").forEach(b => b.addEventListener("click", e => busy(e.currentTarget, async () => { const name = root.querySelector(`[data-tb-team-name="${b.dataset.tbSaveTeam}"]`).value.trim(); if (!name) throw new Error("Team name cannot be blank."); const r = await db().from("golf_teams").update({ name }).eq("id", b.dataset.tbSaveTeam); if (r.error) throw r.error; await paint(); })));
  root.querySelector("[data-tb-build-team-day]")?.addEventListener("click", e => busy(e.currentTarget, async () => { if (await buildTeamDay(state)) { setupSection.set(state.outing.id, "pairs"); await paint(); } else e.currentTarget.disabled = false; }));
  root.querySelectorAll("[data-tb-add-round]").forEach(button => button.addEventListener("click", e => busy(e.currentTarget, async () => {
    const format = ["pairs", "singles", "custom"].includes(button.dataset.tbAddRound) ? button.dataset.tbAddRound : "pairs";
    const roundId = await addBetaRound(state, format);
    setupSection.set(state.outing.id, `round-${roundId}`);
    toast(`${format === "custom" ? "Custom" : format === "pairs" ? "Pairs" : "Singles"} round added`);
    await paint();
  })));
  root.querySelector("[data-tb-build-custom]")?.addEventListener("click", e => busy(e.currentTarget, async () => {
    const sizes = [0, 1].map(index => Number(root.querySelector(`[data-tb-custom-side="${index}"]`)?.value));
    const holes = Number(root.querySelector("[data-tb-custom-holes]")?.value) || 18;
    const scoring = root.querySelector("[data-tb-custom-scoring]")?.value === "match" ? "match" : "strokes";
    const showBoard = root.querySelector("[data-tb-custom-board]")?.checked !== false;
    if (await buildCustomMatch(state, sizes, holes, scoring, showBoard)) { setupSection.set(state.outing.id, "custom"); await paint(); }
    else e.currentTarget.disabled = false;
  }));
  root.querySelector("[data-tb-custom-board]")?.addEventListener("change", async e => {
    const entry = betaFormatStatus(state).custom;
    if (!entry) return;
    const toggle = e.currentTarget, visible = toggle.checked;
    toggle.disabled = true;
    try {
      const name = betaCustomRoundName(betaCustomSizes(entry.round), visible);
      const result = await db().from("golf_rounds").update({ name }).eq("id", entry.round.id);
      if (result.error) throw result.error;
      entry.round.name = name;
      toast(visible ? "Tournament points board enabled" : "Tournament points board hidden");
    } catch (error) {
      toggle.checked = !visible;
      toast(error?.message || "Tournament board setting could not be saved.", true);
    } finally { toggle.disabled = false; }
  });
  root.querySelectorAll("[data-tb-scoring]").forEach(b => b.addEventListener("click", e => busy(e.currentTarget, async () => { const [id, scoring] = b.dataset.tbScoring.split(":"); const r = await db().from("golf_rounds").update({ scoring }).eq("id", id); if (r.error) throw r.error; await paint(); })));
  root.querySelectorAll("[data-tb-holes]").forEach(b => b.addEventListener("click", e => busy(e.currentTarget, async () => { const [id, holes] = b.dataset.tbHoles.split(":"); const r = await db().from("golf_rounds").update({ holes: Number(holes) }).eq("id", id); if (r.error) throw r.error; await paint(); })));
  root.querySelectorAll("[data-tb-seat]").forEach(s => s.addEventListener("change", e => busy(e.currentTarget, async () => { const [round, side] = s.dataset.tbSeat.split(":"); await assignSeat(state, round, side, s.dataset.row, s.value); await paint(); })));
}

function wireMatch(root, state) {
  stopSyncWatch();
  const cardHead=root.querySelector(".tb-scorecard:not(.tb-leaderboard-view) .tb-card-head"),shareButton=document.createElement("button");shareButton.type="button";shareButton.className="tb-share-card";shareButton.textContent="Share";cardHead?.appendChild(shareButton);shareButton.addEventListener("click",()=>{const result=shareScorecard(shareButton.closest(".tb-scorecard"),"Tournament scorecard");toast(result==="copied"?"Scorecard copied":"Scorecard ready to share",result==="failed")});
  if (state.organizer && cardHead) {
    const clearAll = document.createElement("button");
    clearAll.type = "button"; clearAll.className = "tb-clear-card"; clearAll.textContent = "Clear all";
    clearAll.title = "Clear every score in this event";
    cardHead.appendChild(clearAll);
    clearAll.addEventListener("click", async () => {
      if (!state.scoreRows.size) { toast("There are no scores to clear"); return; }
      if (state.stale) { toast("Reconnect before clearing scores.", true); return; }
      if (!confirm(clearAllPrompt(state))) return;
      clearAll.disabled = true;
      try { await clearAllBetaScores(state); toast("Every scorecard cleared"); await paint(); }
      catch (error) { clearAll.disabled = false; toast(error?.message || "Scores could not be cleared", true); }
    });
  }
  const updateSync = () => { const line = root.querySelector("[data-tb-sync]"); if (line) line.textContent = syncText(state); };
  const stopQueue = onQueueChange(updateSync);
  addEventListener("online", updateSync); addEventListener("offline", updateSync);
  stopSyncWatch = () => { stopQueue(); removeEventListener("online", updateSync); removeEventListener("offline", updateSync); };
  void flush();
  const playable = state.rounds.filter(e => !e.individual && ["pairs", "singles"].includes(e.round.format));
  const entry = betaSelectedRound(playable, activeFormat.get(state.outing.id));
  if (!entry) return;
  const count = roundHoles(entry.round);
  const repaint = () => { root.innerHTML = focusedMatchMarkup(state); wireMatch(root, state); };
  const shareSheet = root.querySelector("[data-tb-share-sheet]");
  root.querySelector("[data-tb-share-open]")?.addEventListener("click", () => { shareSheet.hidden = false; });
  root.querySelector("[data-tb-share-close]")?.addEventListener("click", () => { shareSheet.hidden = true; });
  shareSheet?.addEventListener("click", e => { if (e.target === shareSheet) shareSheet.hidden = true; });
  root.querySelectorAll("[data-tb-share]").forEach(button => button.addEventListener("click", () => {
    const kind = button.dataset.tbShare;
    const result = kind === "scorecard" ? shareScorecard(root.querySelector(".tb-scorecard:not(.tb-leaderboard-view)"), "Tournament scorecard")
      : kind === "leaderboard" ? shareBetaLeaderboard(state, entry)
      : kind === "teams" ? shareBetaTeams(state) : shareBetaTournament(state);
    shareSheet.hidden = true;
    toast(result === "failed" ? "That image could not be built" : (result === "saved" ? "Image saved to your downloads" : typeof result === "string" ? result : "Sharing…"), result === "failed");
  }));
  const move = step => { const hole = rememberedHole(state.outing.id); rememberHole(state.outing.id, Math.max(1, Math.min(count, hole + step))); repaint(); };
  root.querySelector("[data-tb-prev]")?.addEventListener("click", () => move(-1));
  root.querySelector("[data-tb-next]")?.addEventListener("click", () => move(1));
  root.querySelectorAll("[data-tb-format]").forEach(b => b.addEventListener("click", () => { leaderboardOpen.set(state.outing.id, Boolean(b.closest("[data-tb-leaderboard-view]"))); activeFormat.set(state.outing.id, b.dataset.tbFormat); rememberHole(state.outing.id, 1); repaint(); }));
  root.querySelectorAll("[data-tb-card]").forEach(b => b.addEventListener("click", () => { const play = root.querySelector(".tb-play"), card = root.querySelector(".tb-scorecard"); play.hidden = !play.hidden; card.hidden = !card.hidden; }));
  root.querySelectorAll("[data-tb-leaderboard]").forEach(b => b.addEventListener("click", () => { const play = root.querySelector(".tb-play"), board = root.querySelector("[data-tb-leaderboard-view]"); if (!board) return; const opening = board.hidden; leaderboardOpen.set(state.outing.id, opening); play.hidden = opening; board.hidden = !opening; }));
  const sheet = root.querySelector("[data-tb-sheet]");
  const controls = sheet?.querySelector(".tb-controls");
  if (controls) controls.innerHTML = ["strokes", "putts", "drops"].map(field => `<div class="tb-control"><span class="tb-label">${field === "strokes" ? "Shots" : field[0].toUpperCase() + field.slice(1)}</span><div class="tb-step"><button data-tb-step="${field}:-1" aria-label="Remove one ${field === "strokes" ? "shot" : field.slice(0, -1)}">−</button><output data-tb-${field}>—</output><button data-tb-step="${field}:1" aria-label="Add one ${field === "strokes" ? "shot" : field.slice(0, -1)}">+</button></div></div>`).join("");
  root.querySelectorAll(".tb-scorecard-body").forEach(body => body.querySelector(".tb-legend")?.before(Object.assign(document.createElement("div"), { innerHTML: scorecardStats(state, matchSides(state, entry)) }).firstElementChild));
  root.querySelectorAll("[data-tb-open]").forEach(b => b.addEventListener("click", () => {
    const sideId = Number(b.dataset.tbOpen), side = matchSides(state, entry).find(s => Number(s.id) === sideId), hole = rememberedHole(state.outing.id), row = state.scoreRows.get(scoreKey(sideId, hole)) || {};
    if (!side || !canScoreBetaCard({ ...state, individual: true, memberId: getMemberId(), cardId: sideId })) return;
    sheet.dataset.sideId = String(sideId); sheet.dataset.strokes = String(Number(row.strokes) || parFor(sideCourseHoles(state, side), hole)); sheet.dataset.putts = String(Number(row.putts) || 0); sheet.dataset.drops = String(Number(row.drops) || 0);
    sheet.querySelector("[data-tb-name]").textContent = `${sideName(side)} · Hole ${hole}`;
    sheet.querySelector("[data-tb-strokes]").textContent = sheet.dataset.strokes;
    sheet.querySelector("[data-tb-putts]").textContent = Number(sheet.dataset.putts) || "—";
    sheet.querySelector("[data-tb-drops]").textContent = Number(sheet.dataset.drops) || "—";
    const clear = sheet.querySelector("[data-tb-clear]");
    if (clear) clear.disabled = !Number(row.strokes);
    sheet.hidden = false;
  }));
  root.querySelector("[data-tb-cancel]")?.addEventListener("click", () => { sheet.hidden = true; });
  root.querySelectorAll("[data-tb-step]").forEach(b => b.addEventListener("click", () => {
    const [field, rawStep] = b.dataset.tbStep.split(":"), step = Number(rawStep), min = field === "strokes" ? 1 : 0, max = field === "drops" ? 9 : 15;
    const value = Math.max(min, Math.min(max, (Number(sheet.dataset[field]) || 0) + step));
    sheet.dataset[field] = String(value); sheet.querySelector(`[data-tb-${field}]`).textContent = value || "—";
  }));
  root.querySelector("[data-tb-clear]")?.addEventListener("click", async e => {
    const sideId = Number(sheet.dataset.sideId), hole = rememberedHole(state.outing.id);
    e.currentTarget.disabled = true;
    persistScore(state, sideId, hole, 0, 0, 0);
    sheet.hidden = true;
    toast(state.organizer ? `Hole ${hole} cleared` : `Hole ${hole} score removed`);
    repaint();
  });
  root.querySelector("[data-tb-save]")?.addEventListener("click", () => {
    const sideId = Number(sheet.dataset.sideId), hole = rememberedHole(state.outing.id);
    persistScore(state, sideId, hole, Number(sheet.dataset.strokes), Number(sheet.dataset.putts) || 0, Number(sheet.dataset.drops) || 0);
    sheet.hidden = true;
    rememberHole(state.outing.id, Math.min(count, hole + 1));
    repaint();
  });
  root.querySelector("[data-tb-finish]")?.addEventListener("click", async e => { e.currentTarget.disabled = true; const r = await db().from("golf_outings").update({ status: "final", finalized_at: new Date().toISOString() }).eq("id", state.outing.id); if (r.error) toast(r.error.message, true); else paint(); });
}

async function loadState(outing, organizer) {
  const id = outing.id, [tr, pr, hr, rr, mr, members, courseRes, guestCodeSet] = await Promise.all([db().from("golf_teams").select("*").eq("outing_id", id).order("sort_order"), db().from("golf_participants").select("*").eq("outing_id", id).order("sort_order"), db().from("golf_holes").select("hole,par").eq("outing_id", id).order("hole"), db().from("golf_rounds").select("*").eq("outing_id", id).order("round_number"), db().from("golf_matches").select("id,round_id,match_number").eq("outing_id", id).order("match_number"), loadMembers().catch(() => []), outing.course_id ? db().from("golf_course_holes").select("hole,par,yardage_men,yardage_women").eq("course_id", outing.course_id).order("hole") : { data: [], error: null }, organizer ? eventHasCode(db(), id) : Promise.resolve(false)]);
  const error = tr.error || pr.error || hr.error || rr.error || mr.error; if (error) throw error;
  const relevantCourseIds = [...new Set([Number(outing.course_id), ...(pr.data || []).map(person => Number(person.course_id))].filter(Boolean))];
  const [coursesResult, allCourseHolesResult] = await Promise.all([db().from("golf_courses").select("id,name,city,state,holes,par").order("name"), relevantCourseIds.length ? db().from("golf_course_holes").select("course_id,hole,par,yardage_men,yardage_women").in("course_id", relevantCourseIds).order("hole") : Promise.resolve({ data: [], error: null })]);
  if (coursesResult.error || allCourseHolesResult.error) throw coursesResult.error || allCourseHolesResult.error;
  const courses = coursesResult.data || [], courseHolesById = new Map();
  for (const row of allCourseHolesResult.data || []) { const key = String(row.course_id); if (!courseHolesById.has(key)) courseHolesById.set(key, []); courseHolesById.get(key).push(row); }
  const courseHoles = courseRes.error ? [] : courseRes.data || [];
  let holes = hr.data || []; if (!holes.length && courseHoles.length) holes = courseHoles.map(({ hole, par }) => ({ hole, par }));
  const matches = mr.data || [], matchIds = matches.map(m => m.id), sr = matchIds.length ? await db().from("golf_match_sides").select("id,match_id,team_id,slot").in("match_id", matchIds).order("slot") : { data: [] }; if (sr.error) throw sr.error;
  const sides = sr.data || [], sideIds = sides.map(s => s.id), [mpr, scr] = sideIds.length ? await Promise.all([db().from("golf_match_players").select("id,side_id,participant_id,round_id").in("side_id", sideIds).order("id"), db().from("golf_match_scores").select("id,side_id,hole,strokes,putts,drops").in("side_id", sideIds)]) : [{ data: [] }, { data: [] }]; if (mpr.error || scr.error) throw mpr.error || scr.error;
  const teams = tr.data || [], participants = pr.data || [], names = new Map(members.map(m => [String(m.id), nameOf(m)])), tm = new Map(teams.map(t => [String(t.id), t])), pm = new Map(participants.map(p => [String(p.id), p])), mm = new Map(matches.map(m => [String(m.id), m])), scoreRows = new Map(scr.data.map(r => [scoreKey(r.side_id, r.hole), r]));
  for (const sideId of sideIds) for (const [hole, pending] of pendingDetailsForSide(sideId)) {
    const key = scoreKey(sideId, hole);
    if (pending.strokes == null) scoreRows.delete(key);
    else scoreRows.set(key, { ...(scoreRows.get(key) || {}), side_id: sideId, hole, strokes: pending.strokes, putts: pending.putts || 0, drops: pending.drops || 0, pending: true });
  }
  const builtSides = sides.map(s => { const m = mm.get(String(s.match_id)), players = mpr.data.filter(p => String(p.side_id) === String(s.id)).map(p => { const participant = pm.get(String(p.participant_id)); return { ...p, row_id: p.id, name: playerName(participant, names), member_id: participant?.member_id, course_id: Number(participant?.course_id) || Number(outing.course_id) || 0 }; }), strokes = new Map(scr.data.filter(r => String(r.side_id) === String(s.id) && Number(r.strokes) > 0).map(r => [Number(r.hole), Number(r.strokes)])), team = tm.get(String(s.team_id)); for (const [hole, pending] of pendingForSide(s.id)) { if (pending == null) strokes.delete(hole); else strokes.set(hole, Number(pending)); } return { ...s, match_number: m?.match_number, players, strokes, teamName: team?.name || "Individual", color: team?.color || "#477fbd" }; });
  const battleState = { outing, holes, courseHoles, courses, courseHolesById };
  const rounds = rr.data.map(round => { const battles = matches.filter(m => String(m.round_id) === String(round.id)).map(m => { const bs = builtSides.filter(s => String(s.match_id) === String(m.id)); return { ...m, sides: bs, result: betaBattleResult(battleState, bs, round) }; }); return { round, battles, individual: battles.some(b => b.sides.length > 2 || b.sides.some(s => s.team_id == null)) }; });
  return { outing, organizer, teams, participants, holes, courseHoles, courses, courseHolesById, rounds, sides: builtSides, matchPlayers: mpr.data, scoreRows, persistedScoreCount: scr.data.length, members, names, individual: rounds.some(e => e.individual), guestCodeSet, stale: false };
}

async function paint() {
  stopSyncWatch();
  injectPlayType(); const current = route(); if (!current.golf || !current.id) { document.body.classList.remove("tb-focus"); return; }
  const root = document.querySelector("#golf-outing"); if (!root) return; const organizer = canEdit("golf_participants");
  if (betaRouteForMember({ organizer, setup: current.setup, classic: current.classic }) === "match" && (current.setup || current.classic)) { location.replace(`#/golf?id=${current.id}`); return; }
  if (current.classic) { document.body.classList.remove("tb-focus"); if (!root.querySelector(".tb-classic-banner")) root.insertAdjacentHTML("afterbegin", `<div class="tb-classic-banner"><strong>Tournament Beta</strong> · <a href="#/golf?id=${current.id}">Open Beta match view</a></div>`); return; }
  ensureStyles();
  try {
    let state;
    try {
      const out = await db().from("golf_outings").select("*").eq("id", current.id).maybeSingle();
      if (out.error) throw out.error;
      if (out.data?.event_type !== "tournament_beta") { document.body.classList.remove("tb-focus"); return; }
      state = await loadState(out.data, organizer);
      cacheBetaState(state);
    } catch (networkError) {
      state = cachedBetaState(current.id);
      if (!state) throw networkError;
      state.organizer = organizer;
      state.stale = true;
    }
    root.innerHTML = current.setup ? calmSetupMarkup(state) : focusedMatchMarkup(state);
    if (!current.setup) {
      const courseId = memberCourseId(state), course = courseById(state, courseId), holes = courseHolesForId(state, courseId), hole = rememberedHole(state.outing.id);
      const holeMeta = root.querySelector(".tb-hole small");
      if (holeMeta) holeMeta.innerHTML = holeMeta.innerHTML.replace(/^Par \d+/, `Par ${parFor(holes, hole)}`);
      const courseTitle = root.querySelector(".tb-sub strong");
      if (courseTitle) courseTitle.textContent = course?.name || state.outing.course || state.outing.name;
    }
    const gpsRoot=root.querySelector("[data-tbeta-root]");if(gpsRoot){const courseId=memberCourseId(state),course=courseById(state,courseId);gpsRoot.dataset.gpsCourseId=String(courseId||"");gpsRoot.dataset.gpsCourseName=course?.name||state.outing.course||"Golf course";gpsRoot.dataset.gpsCourseLabel=course?.name||state.outing.course||"Golf course"}
    document.body.classList.add("tb-focus");
    current.setup ? wireSetup(root, state) : wireMatch(root, state);
  } catch (e) {
    root.innerHTML = `<section class="card" data-tbeta-root><div class="card-title">Tournament Beta</div><div class="card-body muted">${esc(e.message || e)}</div></section>`;
  }
}

let queued = false, queuedAgain = false;
function schedule() {
  if (queued) { queuedAgain = true; return; }
  queued = true;
  queueMicrotask(async () => {
    try { await paint(); }
    finally { queued = false; if (queuedAgain) { queuedAgain = false; schedule(); } }
  });
}
new MutationObserver(() => {
  injectPlayType();
  const c = route();
  if (!c.golf || !c.id) return;
  let root = document.querySelector("#golf-outing");
  if (!root && cachedBetaState(c.id)) {
    const view = document.querySelector("#view");
    if (view) { view.innerHTML = `<div id="golf-outing" class="golf-event"><div class="tb-route-loading" aria-label="Opening saved Tournament Beta"></div></div>`; root = view.querySelector("#golf-outing"); }
  }
  if (root && (c.classic ? !root.querySelector(".tb-classic-banner") : !root.querySelector("[data-tbeta-root]"))) schedule();
}).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("hashchange", schedule);
window.addEventListener("dfl:tournament-beta-route", schedule);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule); else schedule();

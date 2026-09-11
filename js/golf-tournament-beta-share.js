import { FONT, fitText, roundRect, shareCanvas } from "./share.js";
import { SHARE_INK, teamInk } from "./brand-ink.js";
import { memberNames } from "./golf-people.js";
import { progress as boardProgress, label as boardLabel, roundBoard } from "./golf-board.js";
import { shareBoard, shareTeamSheet } from "./golf-share.js";

const { INK, MUTED, BG, CARD, LINE, GOLD } = SHARE_INK;
const W = 1080, H = 1350;

function adapted(state) {
  return { ...state, parts: state.participants || [], names: memberNames(state.members || []) };
}

export function shareBetaTournament(state) {
  return shareBoard(adapted(state), state.outing);
}

export function shareBetaTeams(state) {
  return shareTeamSheet(adapted(state), state.outing);
}

export function leaderboardCanvas(state, entry) {
  const balls = entry.battles.flatMap(b => b.sides.map(s => ({ ...s, round: entry.round, matchId: s.match_id, matchNumber: s.match_number, teamOrder: s.slot })));
  const rows = roundBoard({ balls, holes: state.holes }, entry.round).flatMap(group => group.rows);
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d"); ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = LINE; ctx.lineWidth = 6; ctx.strokeRect(3, 3, W - 6, H - 6); ctx.fillStyle = GOLD; ctx.fillRect(0, 0, W, 16);
  ctx.fillStyle = INK; fitText(ctx, String(state.outing.name || "DFL Golf").toUpperCase(), W / 2, 92, W - 100, 52, 950);
  ctx.fillStyle = MUTED; fitText(ctx, `${String(entry.round.name || entry.round.format || "ROUND").toUpperCase()} · LIVE LEADERBOARD`, W / 2, 138, W - 100, 25, 800);
  const top = 190, gap = 10, rowH = Math.min(92, Math.max(46, (H - top - 120 - Math.max(0, rows.length - 1) * gap) / Math.max(1, rows.length)));
  rows.slice(0, 16).forEach((row, index) => {
    const y = top + index * (rowH + gap); ctx.fillStyle = index === 0 ? "#20242a" : CARD; roundRect(ctx, 50, y, W - 100, rowH, 18); ctx.fill(); ctx.strokeStyle = index === 0 ? GOLD : LINE; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = index === 0 ? GOLD : MUTED; ctx.font = `950 28px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(index + 1), 92, y + rowH / 2);
    ctx.textAlign = "left"; ctx.fillStyle = INK; fitText(ctx, row.name, 135, y + rowH * .44, 570, Math.min(34, rowH * .38), 900, "left");
    ctx.fillStyle = teamInk(row.color, index); fitText(ctx, `${row.teamName || "Individual"} · ${boardProgress(row)}`, 135, y + rowH * .76, 590, Math.min(20, rowH * .22), 750, "left");
    ctx.fillStyle = index === 0 ? GOLD : INK; fitText(ctx, boardLabel(row), W - 92, y + rowH * .60, 225, Math.min(38, rowH * .44), 950, "right");
  });
  if (!rows.length) { ctx.fillStyle = MUTED; ctx.font = `800 30px ${FONT}`; ctx.textAlign = "center"; ctx.fillText("No scores have been entered yet.", W / 2, 420); }
  ctx.fillStyle = MUTED; ctx.font = `700 22px ${FONT}`; ctx.textAlign = "center"; ctx.fillText("DFL HQ · GOLF", W / 2, H - 38);
  return canvas;
}

export function shareBetaLeaderboard(state, entry) {
  const title = `${state.outing.name || "DFL Golf"} leaderboard`;
  const filename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`;
  const how = shareCanvas(leaderboardCanvas(state, entry), filename, { title, text: "Live tournament leaderboard" });
  return how === "saved" ? "Image saved to your downloads" : "Sharing…";
}

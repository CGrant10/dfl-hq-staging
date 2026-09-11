// =====================================================================
// profile-share.js - one member's DFL scouting report, as an image.
// ---------------------------------------------------------------------
// This is not a polite bio card. It is the record: career numbers, hardware,
// receipts, and one verdict derived from facts already shown on the profile.
// No invented stats and no random roast copy.
// =====================================================================

import { FONT, crestImage, roundRect, fitText, shareCanvas, shareText } from "./share.js";
import { SHARE_INK } from "./brand-ink.js";
import { dflSeasonCount } from "./config.js";

const W = 1080, H = 1350;
const { BG, CARD, LINE, INK, MUTED, GOLD, ACCENT, OK, CREST_RED, CREST_BLUE } = SHARE_INK;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const one = (v) => (num(v) == null ? "—" : num(v).toFixed(1));
const pct = (v) => (num(v) == null ? "—" : `${Math.round(num(v) * 100)}%`);

function ordinal(n) {
  const v = num(n);
  if (v == null) return "—";
  const s = ["th", "st", "nd", "rd"];
  const k = v % 100;
  return v + (s[(k - 20) % 10] || s[k] || s[0]);
}

function streakValue(streak) {
  const run = num(streak?.run);
  return run && run > 0 ? String(run) : null;
}

/**
 * Fold the profile's real data into the player card.
 *
 * `career` is the compact career total used by the profile page. `extremes`
 * comes from lore.career(), so it carries the best/worst season, best/worst
 * scoring week, and longest win/loss streak. Keeping this pure makes it easy
 * to test without canvas or Supabase.
 */
export function profileShareData({ member, career, extremes = {}, seasonCount = 0, chipSeasons = [] } = {}) {
  if (!member) return null;

  const c = career || {};
  const wins = num(c.wins) ?? 0;
  const losses = num(c.losses) ?? 0;
  const ties = num(c.ties) ?? 0;
  const games = wins + losses + ties;
  const winPct = num(c.winPct) ?? (games ? (wins + ties / 2) / games : 0);
  const titles = num(c.titles) ?? 0;
  const playoffs = num(c.playoffs) ?? 0;
  const runnerUps = num(c.runnerUps) ?? 0;
  const chips = chipSeasons.length;

  const trophyCase = [];
  trophyCase.push(["Championships", String(titles)]);
  trophyCase.push(["Playoff trips", String(playoffs)]);
  if (runnerUps) trophyCase.push(["Runner-ups", String(runnerUps)]);
  if (extremes.bestSeason) trophyCase.push(["Best finish", ordinal(extremes.bestSeason.rank)]);
  if (extremes.highWeek) trophyCase.push(["Nuclear week", one(extremes.highWeek.score)]);
  const winRun = streakValue(extremes.streak?.win);
  if (winRun) trophyCase.push(["Win streak", `${winRun} straight`]);

  const crimeScene = [];
  if (chips) crimeScene.push(["Chip Eater", chips > 1 ? `${chips}×` : String(chipSeasons[0])]);
  if (extremes.worstSeason) crimeScene.push(["Basement visit", ordinal(extremes.worstSeason.rank)]);
  if (extremes.lowWeek) crimeScene.push(["Crime of a week", one(extremes.lowWeek.score)]);
  const lossRun = streakValue(extremes.streak?.loss);
  if (lossRun) crimeScene.push(["Loss spiral", `${lossRun} straight`]);
  if (!chips && runnerUps) crimeScene.push(["Almost had it", `${runnerUps} runner-up${runnerUps === 1 ? "" : "s"}`]);

  const data = {
    who: member.display_name || "DFL",
    team: (member.team_name || "").trim(),
    seasons: dflSeasonCount(num(seasonCount) ?? 0),
    record: `${wins}-${losses}${ties ? `-${ties}` : ""}`,
    wins, losses, ties, games,
    winPct,
    points: Math.round(num(c.pointsFor) ?? 0).toLocaleString(),
    avgFinish: num(c.avgFinish) == null ? "—" : one(c.avgFinish),
    titles,
    playoffs,
    runnerUps,
    chips,
    trophyCase: trophyCase.slice(0, 5),
    crimeScene: crimeScene.slice(0, 5),
  };
  data.verdict = verdictFor(data, extremes);
  return data;
}

/** Savage, but only where the numbers earned it. */
export function verdictFor(d, extremes = {}) {
  const lossRun = num(extremes.streak?.loss?.run) ?? 0;
  const winRun = num(extremes.streak?.win?.run) ?? 0;
  const worst = num(extremes.worstSeason?.rank);

  if (d.titles > 0 && d.chips > 0) {
    return "Has lived at both ends of the standings. Ring on one hand, hot chip in the other.";
  }
  if (d.chips >= 2) {
    return "Multiple trips to the basement. At this point the hot chip knows the address.";
  }
  if (d.titles >= 3) {
    return "Dynasty credentials. Annoying as hell, but the hardware makes the argument for them.";
  }
  if (d.titles >= 1 && d.winPct >= 0.55) {
    return "The shit talk has documentation: winning record, playoff damage, and a ring to point at.";
  }
  if (lossRun >= 6) {
    return `Once lost ${lossRun} straight. That is not a slump; that is a subscription plan.`;
  }
  if (worst != null && worst >= 10) {
    return `Has finished ${ordinal(worst)}. The standings had to add a basement level.`;
  }
  if (d.games >= 20 && d.winPct < 0.40) {
    return "The résumé has seen some shit. The group chat should keep the screenshots handy.";
  }
  if (winRun >= 6) {
    return `Put together ${winRun} straight wins once. For a while, everybody else was just schedule filler.`;
  }
  if (d.playoffs && !d.titles && d.runnerUps) {
    return "Knows the route to the playoffs. Still looking for the last damn turn.";
  }
  if (d.winPct >= 0.55) {
    return "Annoyingly effective. The record gives the trash talk legal standing.";
  }
  return "Dangerous enough to talk shit. Inconsistent enough that the receipts stay interesting.";
}

/** The line that travels with the PNG in a share sheet. */
export function profileShareText(d) {
  if (!d) return "";
  const bits = [`${d.who} — ${d.record} in ${d.seasons} DFL season${d.seasons === 1 ? "" : "s"}`];
  if (d.titles) bits.push(`${d.titles} title${d.titles === 1 ? "" : "s"}`);
  if (d.chips) bits.push(`${d.chips}× Chip Eater`);
  return `${bits.join(" · ")}. ${d.verdict}`;
}

function drawStat(ctx, x, y, w, label, value) {
  ctx.fillStyle = MUTED;
  ctx.font = `800 20px ${FONT}`;
  ctx.letterSpacing = "2px";
  ctx.fillText(label, x + w / 2, y + 22);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = INK;
  fitText(ctx, value, x + w / 2, y + 73, w - 18, 46, 900, "center");
}

function drawReceiptColumn(ctx, x, y, w, h, title, list, ink, emptyText) {
  ctx.fillStyle = CARD;
  roundRect(ctx, x, y, w, h, 24); ctx.fill();
  ctx.strokeStyle = LINE; ctx.lineWidth = 3;
  roundRect(ctx, x, y, w, h, 24); ctx.stroke();

  ctx.fillStyle = ink;
  ctx.font = `900 27px ${FONT}`;
  ctx.letterSpacing = "4px";
  ctx.fillText(title, x + w / 2, y + 42);
  ctx.letterSpacing = "0px";

  if (!list.length) {
    ctx.fillStyle = MUTED;
    ctx.font = `700 24px ${FONT}`;
    fitText(ctx, emptyText, x + w / 2, y + h / 2 + 12, w - 36, 24, 700, "center");
    return;
  }

  const rowH = (h - 64) / Math.max(5, list.length);
  list.forEach(([label, value], i) => {
    const ry = y + 64 + i * rowH;
    ctx.fillStyle = MUTED;
    ctx.font = `700 19px ${FONT}`;
    fitText(ctx, label, x + w / 2, ry + 22, w - 30, 19, 700, "center");
    ctx.fillStyle = ink;
    fitText(ctx, value, x + w / 2, ry + 60, w - 30, 38, 900, "center");
  });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown[maxLines - 1] = shown[maxLines - 1].replace(/[.,;:!?]*$/, "") + "…";
  shown.forEach((s, i) => ctx.fillText(s, x, y + i * lineHeight));
  return shown.length;
}

export function profileShareCanvas(d) {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);

  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, CREST_RED);
  grad.addColorStop(1, CREST_BLUE);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 12);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // ---- identity -------------------------------------------------------
  let y = 55;
  const img = crestImage();
  if (img) {
    const cw = 210;
    const ch = cw * (img.naturalHeight / img.naturalWidth || 0.666);
    ctx.drawImage(img, (W - cw) / 2, y, cw, ch);
    y += ch + 12;
  }

  ctx.fillStyle = MUTED;
  ctx.font = `900 20px ${FONT}`;
  ctx.letterSpacing = "5px";
  ctx.fillText("DFL PLAYER FILE", W / 2, y + 20);
  ctx.letterSpacing = "0px";
  y += 34;

  ctx.fillStyle = INK;
  fitText(ctx, d.who.toUpperCase(), W / 2, y + 58, W - 120, 72, 900, "center");
  y += 80;
  if (d.team) {
    ctx.fillStyle = MUTED;
    fitText(ctx, d.team, W / 2, y + 28, W - 150, 29, 700, "center");
    y += 46;
  }

  // ---- career strip ---------------------------------------------------
  const sx = 70, sw = W - 140, sh = 112;
  ctx.fillStyle = CARD;
  roundRect(ctx, sx, y, sw, sh, 22); ctx.fill();
  ctx.strokeStyle = LINE; ctx.lineWidth = 3;
  roundRect(ctx, sx, y, sw, sh, 22); ctx.stroke();

  const stats = [
    ["RECORD", d.record],
    ["WIN %", pct(d.winPct)],
    ["POINTS", d.points],
    ["AVG FINISH", d.avgFinish],
    ["SEASONS", String(d.seasons)],
  ];
  const statW = sw / stats.length;
  stats.forEach(([label, value], i) => drawStat(ctx, sx + i * statW, y + 8, statW, label, value));
  y += sh + 24;

  // ---- the two things DFL actually cares about ------------------------
  const gap = 28, colW = (W - 140 - gap) / 2;
  const colH = 420;
  drawReceiptColumn(ctx, 70, y, colW, colH, "TROPHY CASE", d.trophyCase, GOLD, "Nothing in the case yet");
  drawReceiptColumn(ctx, 70 + colW + gap, y, colW, colH, "CRIME SCENE", d.crimeScene, ACCENT, "No bodies on record");
  y += colH + 26;

  // ---- verdict --------------------------------------------------------
  const vh = 150;
  ctx.fillStyle = CARD;
  roundRect(ctx, 70, y, W - 140, vh, 22); ctx.fill();
  ctx.strokeStyle = LINE; ctx.lineWidth = 3;
  roundRect(ctx, 70, y, W - 140, vh, 22); ctx.stroke();
  ctx.fillStyle = OK;
  ctx.font = `900 22px ${FONT}`;
  ctx.letterSpacing = "4px";
  ctx.fillText("DFL VERDICT", W / 2, y + 38);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = INK;
  ctx.font = `800 28px ${FONT}`;
  wrapText(ctx, d.verdict, W / 2, y + 78, W - 210, 33, 2);

  ctx.fillStyle = MUTED;
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText("DFL HQ · Draft ★ Golf ★ Sin ★ Fold", W / 2, H - 34);

  return canvas;
}

/** Draw it and hand it to the device share sheet. */
export async function shareProfile(input) {
  const d = profileShareData(input);
  if (!d) return "none";
  const canvas = profileShareCanvas(d);
  const name = d.who.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const how = await shareCanvas(canvas, `dfl-${name}.png`, {
    title: `${d.who} · DFL HQ`,
    text: profileShareText(d),
  });
  if (how === "none") await shareText({ title: `${d.who} · DFL HQ`, text: profileShareText(d) });
  return how;
}
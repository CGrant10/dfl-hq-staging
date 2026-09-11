// =====================================================================
// trade-card.js - share one deal as an image
// ---------------------------------------------------------------------
// The sixth card in the DFL identity, and the third that reuses all of it:
// roundRect(), fitText(), crestImage() and shareCanvas() come from share.js,
// the palette from brand-ink.js, and the frame is the same 1080x1350 every
// other DFL card uses.
//
// WHY A TRADE NEEDS ONE AT ALL
//
// Trade arguments do not happen on the Trade Analyzer. They happen in the
// group chat, where the analyzer's verdict was previously represented by
// somebody typing "the model says accept" and everybody else taking their
// word for it. This is the model saying it: both packages, both totals, the
// call, and the balance - so the argument is about the model rather than
// about what the model said.
//
// SAME BONES AS THE SPORTSBOOK TICKET, on purpose. The figures, the stamp
// and the footer are measured UP from the bottom edge and the packages flex
// between - see sportsbook-ticket.js for the long version of why. Two share
// cards from one app should be recognisably the same object.
// =====================================================================

import { FONT, crestImage, roundRect, fitText, shareCanvas, shareText } from "./share.js";
import { SHARE_INK } from "./brand-ink.js";

const W = 1080;
const { BG, CARD, CARD_2, LINE, INK, MUTED, GOLD, ACCENT, OK, CREST_RED, CREST_BLUE } = SHARE_INK;

const num = value => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);
const signed = value => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Number(value) || 0).toFixed(1)}`;
const teamName = team => team?.team_name || team?.ownerName || `Team ${team?.roster_id || ""}`;

/* recommendationFor() owns the call and its tone. FLEECE deliberately uses
   the same red as PASS: the word is louder, the direction is identical. */
const CALL_INK = { accept: GOLD, pass: CREST_RED, negotiate: CREST_BLUE };

function savageFallback(recommendation) {
  if (recommendation?.action === "FLEECE") return "FLEECE. They are robbing your ass blind.";
  if (recommendation?.action === "ACCEPT") return "You are committing the robbery. Hit accept.";
  if (recommendation?.action === "PASS") return "This deal is dogshit. Stop negotiating.";
  return "Fair as hell. Weird, but fine.";
}

/**
 * Fold a deal into exactly what the card draws.
 *
 * Takes the ALREADY EVALUATED result rather than re-running evaluateTrade():
 * a shared image that disagreed with the ticket it was shared from would be
 * worse than no image at all.
 */
export function dealCardData({ result, parties = [], sends = [], pool = new Map(), verdict, recommendation, remarks, remark, member } = {}) {
  if (!result || parties.length < 2 || !recommendation) return null;
  const named = ids => (ids || []).map(id => pool.get(String(id))).filter(Boolean)
    .sort((a, b) => Number(b.tradeValue) - Number(a.tradeValue))
    .map(player => ({
      name: String(player.name || ""),
      meta: `${player.position || ""}${player.nflTeam ? ` · ${player.nflTeam}` : ""}`,
      value: num(player.tradeValue),
    }));
  const multi = parties.length > 2;
  const last = parties.length - 1;
  const supplied = Array.isArray(remarks) && remarks.length ? remarks : remark ? [remark] : [];
  const fullRemarks = supplied.length ? supplied.map(item => ({
    title: String(item?.title || ""),
    copy: String(item?.copy || ""),
    tone: String(item?.tone || "neutral"),
  })).filter(item => item.title || item.copy) : [{
    title: savageFallback(recommendation), copy: "", tone: recommendation.tone === "pass" ? "bad" : recommendation.tone === "accept" ? "good" : "neutral",
  }];
  return {
    multi,
    who: member?.display_name || teamName(parties[0]),
    /* Every column is "this side hands these over", which is the only framing
       that stays true for a three-way. */
    columns: parties.map((from, index) => ({
      from: teamName(from),
      to: teamName(parties[(index + 1) % parties.length]),
      players: named(sends[index]),
      /* The value a package is worth TO ITS RECIPIENT, which is what
         evaluateTrade already reports and what makes the totals comparable. */
      total: multi ? num(result.values?.[(index + 1) % parties.length])
        : index === 0 ? num(result.valueToB) : num(result.valueToA),
    })),
    call: String(recommendation.action || "").toUpperCase(),
    callTone: String(recommendation.tone || "negotiate"),
    headline: verdict?.headline || "",
    winner: verdict?.who === "a" ? teamName(parties[0]) : verdict?.who === "b" ? teamName(parties[1]) : null,
    fairness: Math.max(0, Math.min(100, num(result.fairness))),
    deltas: parties.map((party, index) => ({
      team: teamName(party),
      delta: multi ? Number(result.weeklyDeltas?.[index] || 0)
        : index === 0 ? Number(result.weeklyDeltaA || 0) : Number(result.weeklyDeltaB || 0),
    })),
    /* The DFLyzer's top remark rides along, because the card is what reaches
       the group chat and "ACCEPT" alone starts no arguments. */
    /* Every evidence-backed description belongs on the shared receipt. */
    remarks: fullRemarks,
    remark: fullRemarks[0]?.title || "",
    remarkTone: fullRemarks[0]?.tone || "neutral",
    forWhom: teamName(parties[0]),
    against: teamName(parties[multi ? last : 1]),
  };
}

/** The one-line text that goes with the image where a share sheet takes text. */
export function dealCardText(t) {
  if (!t) return "";
  const out = t.columns[0]?.players.map(p => p.name).join(" + ") || "nobody";
  const back = t.columns[1]?.players.map(p => p.name).join(" + ") || "nobody";
  const remark = (t.remarks || []).map(item => [item.title, item.copy].filter(Boolean).join(" ")).join(" ");
  return `${t.call} — ${t.forWhom} sends ${out} for ${back}. `
    + `${remark}${remark && !/[.!?]$/.test(remark) ? "." : ""} `
    + `${t.fairness}% balance, ${signed(t.deltas[0]?.delta)} a week to my lineup. `
    + `DFLyzer, which is a model and not a promise.`;
}

/* Where every band sits. Measured up from the bottom, packages flex above. */
function packageMetrics(t) {
  const rowsIn = column => Math.max(1, column.players.length);
  const packH = Math.max(...t.columns.map(column => 92 + rowsIn(column) * 58 + 62));
  return { packH, packsH: t.columns.length <= 2 ? packH : t.columns.length * (packH + 12) - 12 };
}

function canvasHeight(t) {
  const { packsH } = packageMetrics(t);
  const reasonCount = Math.max(1, t.remarks?.length || 0);
  const needed = 300 + packsH + 468 + t.deltas.length * 44 + 44 + reasonCount * 128;
  return Math.max(1800, Math.ceil(needed / 20) * 20);
}

function frame(t, height) {
  const disclaimer = height - 40;
  const who = height - 92;
  const meterY = height - 168;
  const linesBottom = meterY - 56;
  const lineH = 44;
  const linesTop = linesBottom - t.deltas.length * lineH;
  const stampH = 132;
  const reasonsH = 44 + Math.max(1, t.remarks?.length || 0) * 128;
  const reasonsTop = linesTop - 26 - reasonsH;
  const stampTop = reasonsTop - 26 - stampH;
  const ceiling = stampTop - 26;
  return { disclaimer, who, meterY, linesTop, lineH, stampTop, stampH, reasonsTop, reasonsH, ceiling };
}

function drawPackage(ctx, column, x, y, w, h, accent) {
  ctx.fillStyle = CARD;
  roundRect(ctx, x, y, w, h, 20);
  ctx.fill();
  ctx.strokeStyle = LINE; ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 20);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.fillStyle = accent;
  ctx.font = `800 20px ${FONT}`;
  ctx.letterSpacing = "3px";
  ctx.fillText(column.label.toUpperCase(), x + 20, y + 34);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = MUTED;
  fitText(ctx, column.from, x + 20, y + 60, w - 40, 22, 700, "left");

  let rowY = y + 92;
  const rows = column.players.length ? column.players : [{ name: "Nobody yet", meta: "", value: null }];
  for (const player of rows) {
    ctx.textAlign = "right";
    ctx.fillStyle = MUTED;
    ctx.font = `800 26px ${FONT}`;
    const valueText = player.value === null ? "" : String(player.value);
    const valueW = valueText ? ctx.measureText(valueText).width : 0;
    if (valueText) ctx.fillText(valueText, x + w - 20, rowY + 22);

    ctx.textAlign = "left";
    ctx.fillStyle = player.value === null ? MUTED : INK;
    fitText(ctx, player.name, x + 20, rowY + 20, w - 44 - valueW, 27, 800, "left");
    if (player.meta) {
      ctx.fillStyle = MUTED;
      fitText(ctx, player.meta, x + 20, rowY + 42, w - 44 - valueW, 19, 700, "left");
    }
    rowY += player.meta ? 58 : 40;
  }

  /* The total, on a rule, because the whole point of the two columns is that
     you can see the arithmetic instead of trusting a percentage. */
  ctx.strokeStyle = LINE; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 20, y + h - 62);
  ctx.lineTo(x + w - 20, y + h - 62);
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.fillStyle = MUTED;
  ctx.font = `800 20px ${FONT}`;
  ctx.letterSpacing = "3px";
  ctx.fillText("VALUE", x + 20, y + h - 26);
  ctx.letterSpacing = "0px";
  ctx.textAlign = "right";
  ctx.fillStyle = accent;
  ctx.font = `900 42px ${FONT}`;
  ctx.fillText(String(column.total), x + w - 20, y + h - 20);
  ctx.textAlign = "center";
}

function wrappedLines(ctx, text, maxWidth, maxLines = 3) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else line = next;
  }
  if (line && lines.length < maxLines) {
    const used = lines.join(" ").split(/\s+/).filter(Boolean).length;
    const remaining = words.slice(used).join(" ");
    let final = remaining || line;
    while (ctx.measureText(final).width > maxWidth && final.length > 1) final = `${final.slice(0, -2).trim()}…`;
    lines.push(final);
  }
  return lines;
}

export function dealCanvas(t) {
  const H = canvasHeight(t);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const f = frame(t, H);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);

  [CREST_RED, GOLD, INK, CREST_BLUE].forEach((colour, index) => {
    ctx.fillStyle = colour;
    ctx.fillRect(index * W / 4, 0, W / 4, 12);
  });

  const img = t.columns.length <= 2 ? crestImage() : null;
  const cw = 260;
  const ch = img ? cw * (img.naturalHeight / img.naturalWidth || 0.666) : 0;
  const headH = (img ? ch + 14 : 0) + 40 + 66;

  /* Two parties sit side by side; three or more stack, because a 1080px card
     cannot hold three readable columns.

     The boxes are sized to their contents rather than to a constant - a
     fixed 300px left a one-player package two thirds empty - and both
     columns take the TALLER of the two, because two side-by-side boxes of
     different heights read as a layout bug rather than as a short package. */
  const side = t.columns.length <= 2;
  const { packH, packsH } = packageMetrics(t);
  const groupH = headH + 18 + packsH;
  const slack = Math.max(0, f.ceiling - 34 - groupH);
  let y = 34 + slack - Math.min(slack / 2, 50);

  if (img) {
    ctx.drawImage(img, (W - cw) / 2, y, cw, ch);
    y += ch + 14;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = MUTED;
  ctx.font = `800 24px ${FONT}`;
  ctx.letterSpacing = "6px";
  ctx.fillText("DFL TRADE ANALYZER", W / 2, y + 20);
  ctx.letterSpacing = "0px";
  y += 40;

  ctx.fillStyle = INK;
  fitText(ctx, t.multi ? `${t.columns.length}-TEAM DEAL` : `${t.forWhom.toUpperCase()}  ⇄  ${t.against.toUpperCase()}`,
    W / 2, y + 42, W - 120, 44, 900, "center");
  y += 66 + 18;

  // ---- the packages ---------------------------------------------------
  if (side) {
    const gap = 24, colW = (W - 160 - gap) / 2;
    drawPackage(ctx, { ...t.columns[0], label: "You send" }, 80, y, colW, packH, INK);
    drawPackage(ctx, { ...t.columns[1], label: "You get" }, 80 + colW + gap, y, colW, packH, GOLD);
  } else {
    t.columns.forEach((column, index) => {
      drawPackage(ctx, { ...column, label: `${column.from} → ${column.to}` },
        80, y + index * (packH + 12), W - 160, packH, index ? GOLD : INK);
    });
  }

  // ---- the call, stamped ----------------------------------------------
  const callInk = CALL_INK[t.callTone] || GOLD;
  ctx.fillStyle = `${callInk}1f`;
  roundRect(ctx, 80, f.stampTop, W - 160, f.stampH, 22);
  ctx.fill();
  ctx.strokeStyle = callInk; ctx.lineWidth = 5;
  roundRect(ctx, 80, f.stampTop, W - 160, f.stampH, 22);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = callInk;
  fitText(ctx, t.call, W / 2, f.stampTop + 74, W - 240, 66, 900, "center");
  ctx.fillStyle = MUTED;
  ctx.font = `700 24px ${FONT}`;
  /* Not "· for X" as well: on any deal you win, the winner and the point of
     view are the same team, and the card said its name twice in one line.
     Whose call it is, is answered by the name at the foot of the card. */
  fitText(ctx, `${t.headline}${t.winner ? ` · ${t.winner} wins it` : ""}`,
    W / 2, f.stampTop + 108, W - 200, 24, 700, "center");

  // ---- every DFLyzer description, with room to read it ----------------
  ctx.textAlign = "left";
  ctx.fillStyle = MUTED;
  ctx.font = `800 20px ${FONT}`;
  ctx.letterSpacing = "3px";
  ctx.fillText("THE FULL DFLYZER READ", 80, f.reasonsTop + 24);
  ctx.letterSpacing = "0px";
  const reasonInk = tone => tone === "bad" ? CREST_RED : tone === "good" ? GOLD : tone === "warn" ? CREST_BLUE : MUTED;
  (t.remarks || []).forEach((reason, index) => {
    const top = f.reasonsTop + 44 + index * 128;
    ctx.fillStyle = CARD_2;
    roundRect(ctx, 80, top, W - 160, 116, 18);
    ctx.fill();
    ctx.fillStyle = reasonInk(reason.tone);
    roundRect(ctx, 80, top, 7, 116, 4);
    ctx.fill();
    ctx.fillStyle = reasonInk(reason.tone);
    fitText(ctx, reason.title, 108, top + 34, W - 216, 27, 900, "left");
    if (reason.copy) {
      ctx.fillStyle = INK;
      ctx.font = `600 20px ${FONT}`;
      wrappedLines(ctx, reason.copy, W - 216, 3).forEach((line, lineIndex) => {
        ctx.fillText(line, 108, top + 63 + lineIndex * 23);
      });
    }
  });

  // ---- what it does to each lineup ------------------------------------
  t.deltas.forEach((row, index) => {
    const lineY = f.linesTop + index * f.lineH;
    ctx.strokeStyle = LINE; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(80, lineY);
    ctx.lineTo(W - 80, lineY);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = MUTED;
    ctx.font = `700 24px ${FONT}`;
    fitText(ctx, `${row.team} lineup`, 80, lineY + 32, W - 400, 24, 700, "left");
    ctx.textAlign = "right";
    ctx.fillStyle = row.delta >= 0 ? GOLD : CREST_RED;
    ctx.font = `900 30px ${FONT}`;
    ctx.fillText(`${signed(row.delta)} / wk`, W - 80, lineY + 33);
  });

  // ---- the balance, against verdictFor()'s own bands -------------------
  const barX = 80, barW = W - 160, barH = 14;
  const band = (from, to, colour) => {
    ctx.fillStyle = colour;
    ctx.fillRect(barX + barW * from, f.meterY, barW * (to - from), barH);
  };
  ctx.save();
  roundRect(ctx, barX, f.meterY, barW, barH, 7);
  ctx.clip();
  band(0, .55, `${CREST_RED}66`);
  band(.55, .72, `${GOLD}33`);
  band(.72, .88, `${CREST_BLUE}66`);
  band(.88, 1, `${INK}33`);
  ctx.restore();
  const markX = barX + barW * (t.fairness / 100);
  ctx.fillStyle = INK;
  roundRect(ctx, markX - 3, f.meterY - 6, 6, barH + 12, 3);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = MUTED;
  ctx.font = `800 19px ${FONT}`;
  ctx.letterSpacing = "2px";
  ctx.fillText("LOPSIDED", barX, f.meterY + 42);
  ctx.textAlign = "right";
  ctx.fillText("EVEN SPLIT", barX + barW, f.meterY + 42);
  ctx.letterSpacing = "0px";
  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  ctx.font = `900 22px ${FONT}`;
  ctx.fillText(`${t.fairness}% BALANCE`, W / 2, f.meterY - 14);

  // ---- who, and the disclaimer that keeps this a model -----------------
  ctx.fillStyle = INK;
  ctx.font = `800 34px ${FONT}`;
  fitText(ctx, t.who, W / 2, f.who, W - 200, 34, 800, "center");
  ctx.fillStyle = MUTED;
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText("A model estimate on DFL scoring. Not a promise, and not a trade offer.", W / 2, f.disclaimer);

  return canvas;
}

/**
 * Draw it and hand it to the share sheet.
 *
 * shareCanvas() owns the fallbacks and the phone rule - a download is only
 * ever offered where downloading is how you get a file. Do not add one here.
 */
export async function shareDeal(input) {
  const t = dealCardData(input);
  if (!t) return "none";
  const canvas = dealCanvas(t);
  const slug = `${t.forWhom}-${t.against}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "deal";
  const how = await shareCanvas(canvas, `dfl-deal-${slug}.png`, {
    title: "DFL Trade Analyzer",
    text: dealCardText(t),
  });
  if (how === "none") await shareText({ title: "DFL Trade Analyzer", text: dealCardText(t) });
  return how;
}

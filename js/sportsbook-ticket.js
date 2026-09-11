// =====================================================================
// sportsbook-ticket.js - share one ENTRY as an image
// ---------------------------------------------------------------------
// The fifth card in the DFL identity, and deliberately the FOURTH implementation
// of nothing: roundRect(), fitText(), crestImage() and shareCanvas() come from
// share.js, the palette from brand-ink.js, and the frame is the same 1080x1350
// every other DFL card uses. A ticket is not a screenshot of a row.
//
// WHY THIS DRAWS A LIST NOW
//
// It used to draw one wager: one pick, one price, one return, and a member with
// three picks got three separate images that nobody in a group chat is going to
// post in a row. An entry holds up to six picks against one stake, so the card
// draws the entry - every pick stacked with its own price, then the combined
// price and the one return underneath. That is the Underdog shape, and it is
// also just what a paper slip looks like.
//
// THE FOOT IS ANCHORED, THE MIDDLE FLEXES
//
// Six picks is 3.5x the content of one, so a fixed layout would either crop the
// long card or leave a third of the short one empty. The first version summed
// every band's height and centred the total, which very nearly worked and left
// a visible dead band under the name on the short cards - the sum omitted the
// footer's own height, and a stack centred against a footer that is pinned
// separately cannot come out even.
//
// So nothing is centred against a guess now. The figures, the status chip, the
// name and the disclaimer are measured UP from the bottom edge, the brand block
// is measured DOWN from the top, and the picks flex in the space between. Every
// card is framed identically at every length, which is the only way six states
// of the same object look like six of the same object.
// =====================================================================

import { FONT, crestImage, roundRect, fitText, shareCanvas, shareText } from "./share.js";
import { SHARE_INK } from "./brand-ink.js";

const W = 1080, H = 1350;
const FOOTER = 90;
const { BG, CARD, CARD_2, LINE, INK, MUTED, GOLD, ACCENT, OK, CREST_RED, CREST_BLUE } = SHARE_INK;

const fmtOdds = (n) => (Number(n) > 0 ? `+${Number(n)}` : String(Number(n)));
const num = (n) => Number(n || 0).toLocaleString("en-US");

/*
  A LEG'S SUBTITLE IS THE OPPONENT, NOT THE FIXTURE.

  Market titles are "A vs B", so printing one under a pick of "A" read
  "Doberman Dynasty / Doberman Dynasty vs Gengar Gang" - the pick's own name
  twice, and the only new word buried at the end. Splitting the title and
  dropping the half that IS the pick leaves "vs Gengar Gang".

  A prop's title is a question with no side in it, so the split finds nothing
  and the whole question is kept - which is correct, because for a YES pick
  the question is the only thing that identifies the bet.
*/
export function opponentLine(market, pick) {
  const title = String(market || "").trim();
  const name = String(pick || "").trim();
  if (!title || !name) return title;
  const parts = title.split(/\s+(?:vs\.?|v\.?|@|at)\s+/i);
  if (parts.length !== 2) return title;
  const [home, away] = parts.map((part) => part.trim());
  if (home.toLowerCase() === name.toLowerCase()) return `vs ${away}`;
  if (away.toLowerCase() === name.toLowerCase()) return `vs ${home}`;
  return title;
}

/* The tick and the cross, stroked rather than typed. "✓" and "✗" are not in
   every system font at the same weight - the cross was arriving as a thin
   serif X beside a bold tick - and a mark this small has to be one shape. */
function drawMark(ctx, kind, cx, cy, size, colour) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(2.5, size / 6);
  ctx.lineCap = "round";
  ctx.beginPath();
  const r = size / 2;
  if (kind === "won") {
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx - r * .25, cy + r * .7);
    ctx.lineTo(cx + r, cy - r * .75);
  } else {
    ctx.moveTo(cx - r * .8, cy - r * .8);
    ctx.lineTo(cx + r * .8, cy + r * .8);
    ctx.moveTo(cx + r * .8, cy - r * .8);
    ctx.lineTo(cx - r * .8, cy + r * .8);
  }
  ctx.stroke();
}

/*
  STATUS DRIVES THE COLOUR AND NOTHING ELSE DOES.

  Settled tickets keep their result colour: won is green, lost is muted, and
  void is the accent. Open tickets do not need a chip repeating that they are
  open; the potential return already makes their state clear.
*/
const STATUS_INK = { open: GOLD, won: OK, lost: MUTED, void: ACCENT };

/**
 * Fold one entry plus its legs into exactly what the card draws.
 *
 * Separate from the painting so the shape can be reasoned about, and tested,
 * without a canvas. Everything is a string or a number by the time it leaves.
 */
export function ticketData({ bet, legs = [], member, season = null } = {}) {
  if (!bet) return null;
  const stake = Number(bet.stake) || 0;
  const ret = Number(bet.potential_payout) || 0;
  const picks = (Array.isArray(legs) ? legs : []).map((leg) => ({
    pick: String(leg?.label || "Pick"),
    market: opponentLine(leg?.market, leg?.label),
    odds: fmtOdds(leg?.odds_american),
    status: String(leg?.status || "open"),
  }));
  const status = String(bet.status || "open");
  return {
    who: member?.display_name || "DFL",
    picks,
    /* The headline. One pick is its own headline; a real entry is counted. */
    title: picks.length === 1 ? picks[0].pick : `${picks.length}-pick entry`,
    market: picks.length === 1 ? picks[0].market : "",
    odds: fmtOdds(bet.odds_american),
    stake,
    ret,
    /* The profit, because "return" alone reads as the winnings to about half of
       everybody and as stake+winnings to the other half. Print both. */
    profit: Math.max(0, ret - stake),
    status,
    /* A ticket the member pulled themselves is not a ticket the house voided,
       and the card should not accuse anybody of the wrong one. */
    pulled: status === "void" && !!bet.cancelled_at,
    settled: !!bet.settled_at,
    won: picks.filter((p) => p.status === "won").length,
    season,
  };
}

/** The one-line text that goes with the image where a share sheet takes text. */
export function ticketText(t) {
  if (!t) return "";
  const head = t.status === "won" ? "Cashed" : t.status === "lost" ? "Torn up"
    : t.pulled ? "Pulled" : t.status === "void" ? "Voided" : "On the board";
  const what = t.picks.length === 1
    ? `${t.picks[0].pick} at ${t.odds}`
    : `${t.picks.length} picks at ${t.odds} — ${t.picks.map((p) => p.pick).join(", ")}`;
  return `${head}: ${what} — ${num(t.stake)} SIN to return ${num(t.ret)}. DFL Sportsbook, where SIN is play money.`;
}

/*
  A LEG ROW. Index chip, pick, its opponent underneath, its own price on the
  right - and a tick or a cross once the leg has been graded, because on a
  settled 3-pick the interesting question is which one broke it.
*/
function drawLeg(ctx, leg, index, x, y, w, rowH) {
  const ink = STATUS_INK[leg.status] || GOLD;
  const h = rowH - 12;
  const compact = h < 74;
  ctx.fillStyle = CARD;
  roundRect(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.strokeStyle = leg.status === "open" ? LINE : ink;
  ctx.lineWidth = leg.status === "open" ? 2 : 3;
  roundRect(ctx, x, y, w, h, 18);
  ctx.stroke();

  const chip = compact ? 42 : 52;
  const cy = y + h / 2;
  ctx.fillStyle = CARD_2;
  roundRect(ctx, x + 18, cy - chip / 2, chip, chip, 13);
  ctx.fill();
  ctx.strokeStyle = LINE; ctx.lineWidth = 2;
  roundRect(ctx, x + 18, cy - chip / 2, chip, chip, 13);
  ctx.stroke();
  const markX = x + 18 + chip / 2;
  if (leg.status === "won" || leg.status === "lost") {
    drawMark(ctx, leg.status, markX, cy, chip * .42, ink);
  } else {
    ctx.textAlign = "center";
    ctx.fillStyle = leg.status === "void" ? MUTED : GOLD;
    ctx.font = `900 ${compact ? 22 : 26}px ${FONT}`;
    ctx.fillText(String(index + 1), markX, cy + (compact ? 8 : 9));
  }

  // The price first, so the name knows how much room it has left.
  ctx.textAlign = "right";
  ctx.fillStyle = leg.status === "lost" || leg.status === "void" ? MUTED : GOLD;
  ctx.font = `900 ${compact ? 34 : 42}px ${FONT}`;
  const priceW = ctx.measureText(leg.odds).width;
  ctx.fillText(leg.odds, x + w - 24, cy + (compact ? 12 : 15));

  const textX = x + 18 + chip + 18;
  const textW = w - (textX - x) - priceW - 48;
  ctx.textAlign = "left";
  ctx.fillStyle = leg.status === "lost" || leg.status === "void" ? MUTED : INK;
  if (!leg.market) {
    fitText(ctx, leg.pick, textX, cy + 12, textW, compact ? 30 : 36, 800, "left");
  } else {
    fitText(ctx, leg.pick, textX, cy - (compact ? 2 : 4), textW, compact ? 28 : 34, 800, "left");
    ctx.fillStyle = MUTED;
    fitText(ctx, leg.market, textX, cy + (compact ? 20 : 24), textW, compact ? 19 : 22, 700, "left");
  }
  ctx.textAlign = "center";
}

/*
  WHERE EVERY BAND SITS.

  Measured up from the bottom edge, because these five things are the same on
  every card and somebody comparing two shared tickets should find the stake
  in the same place on both. The picks are the only variable-height part, so
  they are the only part that flexes.
*/
function frame(t) {
  const multi = t.picks.length > 1;
  const open = t.status === "open";
  const disclaimer = H - 40;
  const who = H - 96;
  const chipTop = open ? null : H - 222;
  const profit = open ? who - 72 : null;
  const boxesTop = (profit ? profit - 30 : chipTop - 28) - 168;
  /* The combined price: 104px on a multi so the picks above it keep their
     room, 150px on a single where it is the only figure on the card. */
  const priceSize = multi ? 104 : 150;
  const priceBase = boxesTop - 34;
  const mustLand = multi && open ? priceBase - priceSize - 14 : null;
  const ceiling = (mustLand !== null ? mustLand : priceBase - priceSize) - 26;
  return { multi, open, disclaimer, who, chipTop, profit, boxesTop, priceSize, priceBase, mustLand, ceiling };
}

export function ticketCanvas(t) {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const f = frame(t);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);

  /* The brand rule: the same device the stage, the marquee, the lore card and
     the keeper board use. Fills, so the crest's own pair. */
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, CREST_RED); grad.addColorStop(1, CREST_BLUE);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 10);

  /* Rows get tighter as the entry gets longer, and past four picks the crest
     is the thing that gives way - the picks are the content. */
  const rowH = t.picks.length <= 3 ? 100 : t.picks.length <= 4 ? 92 : 80;
  const img = t.picks.length <= 4 ? crestImage() : null;
  const cw = 340;
  const ch = img ? cw * (img.naturalHeight / img.naturalWidth || 0.666) : 0;
  const rowsH = f.multi ? t.picks.length * rowH : 0;
  const marketH = !f.multi && t.market ? 46 : 0;
  const headH = (img ? ch + 16 : 0) + 44 + 92 + marketH;

  /*
    WHERE THE SPARE ROOM GOES.

    The brand block and the picks share everything above the price. Centring
    that group split the leftover evenly, which on a two-pick put ~110px of
    nothing between the last pick and the combined price those picks add up
    to - the two things on the card with the strongest relationship, pushed
    apart by arithmetic.

    So the slack goes ABOVE the crest, where it reads as a margin, and at
    most 60px of it is allowed to fall below the picks. A six-pick has no
    slack to place and clamps to the top either way.
  */
  const groupH = headH + rowsH + (f.multi ? 14 : 0);
  const slack = Math.max(0, f.ceiling - 38 - groupH);
  let y = 38 + slack - Math.min(slack / 2, 60);

  if (img) {
    ctx.drawImage(img, (W - cw) / 2, y, cw, ch);
    y += ch + 16;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = MUTED;
  ctx.font = `800 25px ${FONT}`;
  ctx.letterSpacing = "6px";
  ctx.fillText("DFL SPORTSBOOK", W / 2, y + 22);
  ctx.letterSpacing = "0px";
  y += 44;

  // ---- the headline: the pick, or the entry that holds them -------------
  ctx.fillStyle = INK;
  const titleSize = f.multi ? (t.picks.length >= 5 ? 48 : 58) : 74;
  fitText(ctx, t.title.toUpperCase(), W / 2, y + 58, W - 140, titleSize, 900, "center");
  y += 92;

  if (marketH) {
    ctx.fillStyle = MUTED;
    ctx.font = `700 28px ${FONT}`;
    fitText(ctx, t.market, W / 2, y + 8, W - 160, 28, 700, "center");
    y += marketH;
  }

  // ---- every pick on the entry, in order -------------------------------
  if (f.multi) {
    y += 14;
    t.picks.forEach((leg, i) => drawLeg(ctx, leg, i, 88, y + i * rowH, W - 176, rowH));
  }

  // ---- the price, big, because it is the brag --------------------------
  if (f.mustLand !== null) {
    ctx.fillStyle = MUTED;
    ctx.font = `800 23px ${FONT}`;
    ctx.letterSpacing = "4px";
    ctx.fillText(`ALL ${t.picks.length} MUST LAND`, W / 2, f.mustLand);
    ctx.letterSpacing = "0px";
  }
  ctx.fillStyle = t.status === "lost" ? MUTED : GOLD;
  ctx.font = `900 ${f.priceSize}px ${FONT}`;
  ctx.fillText(t.odds, W / 2, f.priceBase);

  // ---- stake / return, side by side -----------------------------------
  const boxW = (W - 200) / 2, boxH = 168, gap = 40;
  const left = 100;
  const cell = (x, label, value, ink) => {
    ctx.fillStyle = CARD;
    roundRect(ctx, x, f.boxesTop, boxW, boxH, 22);
    ctx.fill();
    ctx.strokeStyle = LINE; ctx.lineWidth = 3;
    roundRect(ctx, x, f.boxesTop, boxW, boxH, 22);
    ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.font = `800 23px ${FONT}`;
    ctx.letterSpacing = "3px";
    ctx.fillText(label, x + boxW / 2, f.boxesTop + 52);
    ctx.letterSpacing = "0px";
    ctx.fillStyle = ink;
    fitText(ctx, value, x + boxW / 2, f.boxesTop + 126, boxW - 40, 62, 900, "center");
  };
  cell(left, t.pulled ? "REFUNDED" : "STAKE", num(t.stake), INK);
  cell(left + boxW + gap,
    t.status === "won" ? "PAID" : t.status === "lost" ? "RETURNED" : t.status === "void" ? "VOID" : "TO RETURN",
    t.status === "lost" ? "0" : t.status === "void" ? "—" : num(t.ret),
    t.status === "lost" || t.status === "void" ? MUTED : GOLD);

  if (f.profit !== null) {
    ctx.fillStyle = MUTED;
    ctx.font = `700 27px ${FONT}`;
    ctx.fillText(`${num(t.profit)} SIN profit if ${f.multi ? "they all land" : "it lands"}`, W / 2, f.profit);
  }

  // ---- settled result chip --------------------------------------------
  if (!f.open) {
    const ink = STATUS_INK[t.status] || GOLD;
    /* A settled multi says how it went - "1 OF 3" is the story, "LOST" is not. */
    const label = (t.pulled ? "PULLED"
      : f.multi && (t.status === "won" || t.status === "lost") ? `${t.won} OF ${t.picks.length}`
      : t.status).toUpperCase();
    ctx.font = `900 40px ${FONT}`;
    const chipW = Math.min(W - 200, ctx.measureText(label).width + 96);
    const chipX = (W - chipW) / 2;
    ctx.fillStyle = CARD;
    roundRect(ctx, chipX, f.chipTop, chipW, 84, 42);
    ctx.fill();
    ctx.strokeStyle = ink; ctx.lineWidth = 5;
    roundRect(ctx, chipX, f.chipTop, chipW, 84, 42);
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.fillText(label, W / 2, f.chipTop + 57);
  }

  // ---- who, and the disclaimer that keeps this a joke -----------------
  ctx.fillStyle = INK;
  ctx.font = `800 37px ${FONT}`;
  fitText(ctx, t.who, W / 2, f.who, W - 200, 37, 800, "center");

  ctx.fillStyle = MUTED;
  ctx.font = `700 23px ${FONT}`;
  ctx.fillText("SIN is play money. No cash value. Never has been.", W / 2, f.disclaimer);

  return canvas;
}

/**
 * Draw it and hand it to the share sheet.
 *
 * shareCanvas() owns the fallbacks and the phone rule - a download is only ever
 * offered where downloading is how you get a file. Do not add one here.
 */
export async function shareTicket(input) {
  const t = ticketData(input);
  if (!t) return "none";
  const canvas = ticketCanvas(t);
  const slug = (t.picks.length === 1 ? t.picks[0].pick : `${t.picks.length}-pick`)
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "entry";
  const how = await shareCanvas(canvas, `dfl-ticket-${slug}.png`, {
    title: "DFL Sportsbook",
    text: ticketText(t),
  });
  if (how === "none") await shareText({ title: "DFL Sportsbook", text: ticketText(t) });
  return how;
}

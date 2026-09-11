/* =====================================================================
   fact-share.js - a piece of DFL lore as a picture
   ---------------------------------------------------------------------
   The fun fact used to share as plain text, which in a group chat is a
   grey paragraph nobody reads. This paints it onto the same card the golf
   board and the match poster use, so a fact arriving in Messenger looks
   like it came from the same league as everything else.

   IT REUSES golf-share.js's LANGUAGE, NOT ITS CODE PATH: the same 1080 x
   1350 4:5 ratio, the same inks, the same crest, the same shareCanvas()
   fallbacks. What it does not do is borrow the board's layout, because a
   fact is one sentence and a board is a table.

   FIXED COLOURS, not the theme's - the image lands on somebody else's
   phone in somebody else's chat, and it should not turn white because the
   sender happened to have light mode on. Same rule as the golf cards.

   Everything is synchronous, because the share sheet must be opened
   inside the user's gesture - see the note in share.js.
   ===================================================================== */
import { FONT, crestImage, roundRect, fitText, shareCanvas, shareText } from "./share.js";
import { factLine } from "./funfacts.js";

const W = 1080, H = 1350;
const INK = "#f2f5f8", MUTED = "#8b98a5", BG = "#0d1117", CARD = "#161b22", LINE = "#2b313a";
const RED = "#E5011B", BLUE = "#003396";

/** Wrap text to a width, returning the lines. Canvas has no such thing. */
function wrap(ctx, text, maxWidth, size, weight) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The card.
 *
 * The headline is the whole point, so it is sized to fit rather than
 * truncated: a fact that says "decided by 0.04 points" and then stops is
 * worse than one set two points smaller.
 */
export function factCanvas(fact) {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // The brand rule, the same device the stage and the marquee use.
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, RED); grad.addColorStop(1, BLUE);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 10);

  /*
    THE CREST AS A WATERMARK, bled off the right edge - the same
    composition as the dfl-mark utility in the app. Drawn before the card
    so the text sits on top of it, and at 7% for the same reason it is 7%
    everywhere else: it should be felt rather than read.
  */
  const img = crestImage();
  if (img) {
    ctx.save();
    ctx.globalAlpha = 0.07;
    const cw = W * 1.05, ch = cw * (img.naturalHeight / img.naturalWidth || 0.666);
    ctx.drawImage(img, W - cw * 0.72, H / 2 - ch / 2, cw, ch);
    ctx.restore();
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // ---- the billing -----------------------------------------------------
  ctx.fillStyle = RED;
  ctx.font = `800 34px ${FONT}`;
  ctx.letterSpacing = "8px";
  ctx.fillText("DFL LORE", W / 2, 130);
  ctx.letterSpacing = "0px";

  ctx.fillStyle = MUTED;
  ctx.font = `700 30px ${FONT}`;
  ctx.fillText("DID YOU KNOW?", W / 2, 186);

  // ---- the card --------------------------------------------------------
  const pad = 70, cardTop = 240, cardBottom = H - 210;
  ctx.fillStyle = CARD;
  roundRect(ctx, pad, cardTop, W - pad * 2, cardBottom - cardTop, 28);
  ctx.fill();
  ctx.strokeStyle = LINE; ctx.lineWidth = 2;
  roundRect(ctx, pad, cardTop, W - pad * 2, cardBottom - cardTop, 28);
  ctx.stroke();
  // A weighted left edge, so the card reads as a quote rather than a box.
  ctx.fillStyle = RED;
  roundRect(ctx, pad, cardTop, 8, cardBottom - cardTop, 4);
  ctx.fill();

  const inner = W - pad * 2 - 90;

  /* The headline, set as large as it can be while still fitting the card.
     Stepping down beats truncating: the number IS the fact. */
  let size = 74;
  let lines = wrap(ctx, fact.headline, inner, size, 800);
  while (lines.length > 5 && size > 40) {
    size -= 4;
    lines = wrap(ctx, fact.headline, inner, size, 800);
  }
  ctx.fillStyle = INK;
  let y = cardTop + 110;
  for (const line of lines) { ctx.fillText(line, W / 2, y); y += size * 1.18; }

  // ---- the detail ------------------------------------------------------
  y += 26;
  const dLines = wrap(ctx, fact.detail, inner, 36, 500).slice(0, 6);
  ctx.fillStyle = MUTED;
  ctx.font = `500 36px ${FONT}`;
  for (const line of dLines) { ctx.fillText(line, W / 2, y); y += 50; }

  /* The season, when the fact has one. A record with no year on it reads
     as something that happened last week, and most of these did not. */
  if (fact.season) {
    y += 24;
    const label = `${fact.season} SEASON`;
    ctx.font = `800 28px ${FONT}`;
    const tw = ctx.measureText(label).width + 44;
    ctx.strokeStyle = LINE;
    roundRect(ctx, W / 2 - tw / 2, y - 34, tw, 50, 12);
    ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.fillText(label, W / 2, y);
  }

  // ---- the footer ------------------------------------------------------
  ctx.fillStyle = MUTED;
  ctx.font = `700 26px ${FONT}`;
  ctx.letterSpacing = "4px";
  ctx.fillText("DFL HQ", W / 2, H - 90);
  ctx.letterSpacing = "0px";

  return canvas;
}

/**
 * Share it, picture first.
 *
 * shareCanvas() already falls back the right way - the share sheet, then
 * saving the PNG, then the clipboard - so a desktop with no share sheet
 * quietly gets the image in its downloads. If the canvas itself cannot be
 * made at all, the original text share still goes out, because a fact
 * that shares as words beats a button that does nothing.
 */
export function shareFact(fact) {
  if (!fact) return "failed";
  try {
    const canvas = factCanvas(fact);
    return shareCanvas(canvas, "dfl-lore.png", {
      title: "DFL HQ — DFL Lore",
      text: factLine(fact),
    });
  } catch (err) {
    console.warn("fact share: falling back to text", err);
    return shareText({ title: "DFL HQ — DFL Lore", text: factLine(fact) });
  }
}

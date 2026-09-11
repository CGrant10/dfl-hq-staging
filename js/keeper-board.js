// =====================================================================
// keeper-board.js - the whole league's keepers, as one picture
// ---------------------------------------------------------------------
// WHAT THIS IS FOR
//
// Keeper season is the one week a year the league argues in the group chat,
// and the argument needs a reference everybody can see. A screenshot of the
// Keepers page is a screenshot: it carries the app's chrome, the year tabs
// and whatever was scrolled into view. This is a purpose-built board -
// twelve rows, one per member, in the Medicine identity.
//
// THE RULE THAT SHAPES THE LAYOUT
//
// EVERY MEMBER APPEARS, whether they have submitted or not. A board that
// silently omits the four people who have not decided looks complete when it
// is not, and "who still owes a keeper" is precisely the question the board
// is being sent to answer. A member with nothing shows an understated
// "No keeper submitted" and is not styled as an error.
//
// IT SHOWS WHAT IT HAS, AND NEVER HIDES A ROW IT CANNOT ENRICH
//
//   new rows      carry player_id, so position and NFL team are looked up
//                 from the Sleeper map and printed beside the name
//   legacy rows   are the 2026 nickname rows ("Puka", "JJettas", one literal
//                 "NA"). They have no player_id and never will. They print
//                 exactly as typed with their stored round, because a keeper
//                 the commissioner recorded is on the board whether or not
//                 the app can resolve it.
//
// SYNCHRONOUS, LIKE EVERY OTHER SHARE PATH. Safari refuses navigator.share()
// if it is not called in the same task as the tap, and an await ends the
// task - so the caller passes data in and this only ever draws. See the
// header of share.js.
//
// IT REUSES THE EXISTING HELPERS rather than starting a second image system:
// roundRect(), fitText(), crestImage() and shareCanvas() from share.js, the
// palette from brand-ink.js, the 1080x1350 4:5 frame every other DFL card
// uses so a keeper board and a golf board look like the same league.
// =====================================================================

import { FONT, crestImage, roundRect, fitText, shareCanvas, shareText } from "./share.js";
import { SHARE_INK } from "./brand-ink.js";
import { describeRules, keeperTenure } from "./keeper-rules.js";

const W = 1080, H = 1350;
const { BG, CARD, LINE, INK, MUTED, GOLD, ACCENT, CREST_RED, CREST_BLUE } = SHARE_INK;

/**
 * Fold the page's data into exactly what the board draws.
 *
 * Kept separate from the painting so it can be reasoned about (and read in a
 * test) without a canvas: the ordering rule, the enrichment and the
 * "submitted / not submitted" split all live here.
 *
 * @param {Object} input
 * @param {number} input.season
 * @param {Object[]} input.members     canonical league members, in league order
 * @param {Object[]} input.keeperRows  rows from `keepers` for any season
 * @param {Object} [input.players]     the Sleeper player map {id:{n,p,t}}
 * @param {Object} [input.rules]       a validated keeper rule set, or null
 */
export function boardData({ season, members = [], keeperRows = [], players = {}, rules = null }) {
  const year = Number(season);
  const mine = (keeperRows || []).filter((r) => Number(r.year ?? r.season) === year);

  /*
    MATCHED BY member_id WHERE THERE IS ONE, and by the stored `team` string
    only as a fallback - because that is the only handle the legacy rows have.
    The fallback is a display-time join for a board, not identity: nothing is
    written and nothing downstream keys off it. A row that matches nobody is
    still shown, under "Also recorded", rather than dropped.
  */
  const byMember = new Map(members.map((m) => [String(m.id), []]));
  const nameKey = new Map();
  for (const m of members) {
    for (const label of [m.team_name, m.display_name]) {
      if (label) nameKey.set(String(label).trim().toLowerCase(), String(m.id));
    }
  }

  /*
    A LAST RESORT FOR THE LEGACY ROWS, and it is deliberately narrow.

    Those rows hold a first name in `team` - "Shey", "Cole" - against member
    display names like "sheyg2014". An exact match never fires, so on a board
    that member reads "No keeper submitted" while their keeper sits at the
    bottom under "Also recorded", which is a worse answer than the truth.

    So a stored name is also accepted as an UNAMBIGUOUS PREFIX of exactly one
    member's name. Two members it could be is not a match, and neither is
    anything under three characters. This is a display-time join for one
    picture: nothing is written, nothing keys off it, and priorKeeperSeasons()
    still refuses to count these rows - see keeper-rules.js. Tenure being
    wrong makes somebody ineligible; a board being generous does not.
  */
  const prefixMatch = (label) => {
    const q = String(label || "").trim().toLowerCase();
    if (q.length < 3) return null;
    const hits = members.filter((m) =>
      [m.display_name, m.team_name].some((v) =>
        String(v || "").trim().toLowerCase().startsWith(q)));
    return hits.length === 1 ? String(hits[0].id) : null;
  };

  const orphans = [];
  for (const row of mine) {
    let key = row.member_id != null ? String(row.member_id) : null;
    if (!key || !byMember.has(key)) {
      const label = String(row.team || "").trim().toLowerCase();
      key = nameKey.get(label) || prefixMatch(label);
    }
    if (key && byMember.has(key)) byMember.get(key).push(row);
    else orphans.push(row);
  }

  const maxKeeperSeasons = rules?.max_keeper_seasons ?? null;

  const entryOf = (row) => {
    const meta = row.player_id != null ? players[String(row.player_id)] : null;
    /* The snapshot columns beat the live map: they are what the player was on
       the day, which is the honest thing on a historical board. */
    const position = row.player_pos || meta?.p || "";
    const nflTeam = row.player_team || meta?.t || "";
    return {
      name: row.player_name || row.player || "—",
      where: [position, nflTeam].filter((v) => v && v !== "FA").join(" · "),
      round: row.round_cost == null ? null : Number(row.round_cost),
      legacy: row.player_id == null,
      overridden: row.round_overridden === true,
      /* The hold, for the board. Computed from the same keeper rows the board
         was built from, so a shared image and the page cannot disagree about
         how long somebody has had a player. Legacy rows carry no player_id and
         therefore no countable history - they get no counter rather than a
         wrong one. */
      tenure: row.player_id == null ? null : keeperTenure(keeperRows, {
        playerId: row.player_id, memberId: row.member_id,
        season: year, max: maxKeeperSeasons,
      }),
    };
  };

  const rows = members.map((m) => ({
    member: m.display_name || "",
    team: m.team_name || "",
    keepers: (byMember.get(String(m.id)) || []).map(entryOf),
  }));

  return {
    season: year,
    rows,
    also: orphans.map(entryOf),
    submitted: rows.filter((r) => r.keepers.length).length,
    total: rows.length,
    /* Omitted rather than truncated if it will not fit - see draw(). */
    rulesLine: describeRules(rules),
  };
}

/** The one-line text that goes with the image on platforms that want words. */
export function boardText(board) {
  if (!board) return "";
  const head = `DFL ${board.season} keepers — ${board.submitted} of ${board.total} submitted`;
  const lines = board.rows.map((r) => {
    const who = r.team || r.member;
    if (!r.keepers.length) return `${who}: no keeper submitted`;
    return `${who}: ${r.keepers.map((k) => {
      const cost = k.round != null ? ` (R${k.round})` : "";
      const held = k.tenure?.max ? ` yr ${k.tenure.year}/${k.tenure.max}` : "";
      return `${k.name}${cost}${held}`;
    }).join(", ")}`;
  });
  return [head, ...lines].join("\n");
}

/**
 * The board.
 *
 * ONE VERTICAL BUDGET, divided by the number of members, so a twelve-team
 * league and a six-team league both fill the card instead of one of them
 * running off the bottom. Row height is computed, never assumed.
 */
export function boardCanvas(board) {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);

  /* The brand rule, the same device the stage, the marquee and the lore card
     use. Fills, so the crest's own pair rather than the readable pair. */
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, CREST_RED); grad.addColorStop(1, CREST_BLUE);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 10);

  // ---- the billing ----------------------------------------------------
  /*
    THE CREST IS THE BILLING. At 300px it was still only 28% of a 1080px card
    and read like a header icon in chat previews. At 460px it owns roughly 43%
    of the canvas width, while tighter surrounding gaps preserve room for the
    keeper rows below.
  */
  let y = 48;
  const img = crestImage();
  if (img) {
    const cw = 460, ch = cw * (img.naturalHeight / img.naturalWidth || 0.666);
    ctx.drawImage(img, (W - cw) / 2, y, cw, ch);
    y += ch + 24;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  ctx.font = `900 66px ${FONT}`;
  ctx.fillText(`${board.season} KEEPERS`, W / 2, y);
  y += 42;

  ctx.fillStyle = MUTED;
  ctx.font = `800 26px ${FONT}`;
  ctx.letterSpacing = "4px";
  ctx.fillText(`${board.submitted} OF ${board.total} SUBMITTED`, W / 2, y);
  ctx.letterSpacing = "0px";
  y += 30;

  /*
    THE RULE SUMMARY IS NOT ON THE CARD.

    It used to print "3-year maximum · Previous season's draft -1 round · Floor
    R1" under the count. The commissioner asked for it off: the board is a
    scoreboard of who kept whom, and the rules are a separate conversation that
    lives on the Rules page and in the editor. `boardData().rulesLine` is still
    produced - boardText() and any future caller can use it - but nothing is
    painted here.
  */

  // ---- the rows -------------------------------------------------------
  const footer = 116;
  const top = y + 22;
  const listH = H - top - footer;
  /* Everybody who is drawn: the members, then anything recorded that matched
     no member. An extra row costs height rather than being hidden. */
  const drawn = [
    ...board.rows.map((r) => ({ ...r, extra: false })),
    ...(board.also.length
      ? [{ member: "Also recorded", team: "", keepers: board.also, extra: true }]
      : []),
  ];
  /* Two keepers under one member needs a taller row than one, so the budget is
     divided by LINES rather than by rows. */
  const lines = drawn.reduce((t, r) => t + Math.max(1, r.keepers.length), 0);
  /*
    A row is capped so a four-team league does not get four enormous bars, and
    the block is then CENTRED in what is left. Without the centring, a six-team
    board was six rows at the top and half a card of black underneath - which
    reads as a rendering fault rather than as a small league.
  */
  const unit = Math.min(78, listH / lines);
  const rowGap = 6;
  const used = unit * lines;

  ctx.textBaseline = "middle";
  let ry = top + Math.max(0, (listH - used) / 2);

  for (const row of drawn) {
    const count = Math.max(1, row.keepers.length);
    const h = unit * count - rowGap;

    ctx.fillStyle = CARD;
    roundRect(ctx, 46, ry, W - 92, h, 16);
    ctx.fill();
    /* A weighted left edge, gold when this member has submitted and a quiet
       line when they have not - so "who still owes one" is answerable from
       across the room, without shouting at anybody. */
    ctx.fillStyle = row.keepers.length ? GOLD : LINE;
    roundRect(ctx, 46, ry, 7, h, 4);
    ctx.fill();

    const midY = ry + h / 2;
    const nameX = 78;

    // Who
    ctx.textAlign = "left";
    ctx.fillStyle = INK;
    const label = row.team || row.member || "—";
    const twoLine = row.team && row.member && !row.extra;
    /* fitText returns the size it settled on, so the member name underneath can
       stay PROPORTIONAL to it. A fixed 21px under a team name that had to shrink
       to 18 made the label smaller than its own subtitle. */
    const nameSize = fitText(ctx, label, nameX, twoLine ? midY - 13 : midY,
                             370, 30, 800, "left");
    if (twoLine) {
      ctx.fillStyle = MUTED;
      ctx.font = `700 ${Math.min(21, Math.max(15, nameSize - 6))}px ${FONT}`;
      ctx.fillText(row.member, nameX, midY + 16);
    }

    // What
    const px = 470;
    if (!row.keepers.length) {
      ctx.fillStyle = MUTED;
      ctx.font = `600 italic 25px ${FONT}`;
      ctx.fillText("No keeper submitted", px, midY);
    } else {
      row.keepers.forEach((k, i) => {
        const ky = ry + unit * i + (unit - rowGap) / 2;
        ctx.textAlign = "left";
        ctx.fillStyle = INK;
        fitText(ctx, k.name, px, k.where ? ky - 12 : ky, W - px - 150, 30, 800, "left");
        if (k.where) {
          ctx.fillStyle = MUTED;
          ctx.font = `700 20px ${FONT}`;
          ctx.letterSpacing = "2px";
          ctx.fillText(k.where.toUpperCase(), px, ky + 16);
          ctx.letterSpacing = "0px";
        }
        /*
          THE HOLD, ON THE SHARED IMAGE.

          A keeper board that shows only the cost answers half the question.
          "R7" says what he costs; "YR 2/3" says how much longer he can be
          held at all, which is the part that changes what anybody does about
          it. Drawn as pips plus the numerals for the same reason the card
          does both - the pips are read at a glance and the numerals survive
          a screenshot being looked at on a small phone.
        */
        if (k.tenure?.max) {
          const t = k.tenure;
          const tx = k.where ? px + ctx.measureText(k.where.toUpperCase()).width + 24 : px;
          const ty = ky + 16;
          const pipW = 16, pipH = 6, pipGap = 4;
          t.max > 0 && Array.from({ length: t.max }).forEach((_, i) => {
            ctx.fillStyle = i < t.year ? (t.final ? CREST_RED : GOLD) : LINE;
            roundRect(ctx, tx + i * (pipW + pipGap), ty - pipH / 2 - 2, pipW, pipH, 3);
            ctx.fill();
          });
          ctx.fillStyle = t.final ? CREST_RED : MUTED;
          ctx.font = `800 19px ${FONT}`;
          ctx.textAlign = "left";
          ctx.fillText(`YR ${t.year}/${t.max}`, tx + t.max * (pipW + pipGap) + 8, ty + 1);
        }
        // The round, as a column you can read straight down.
        ctx.textAlign = "right";
        if (k.round != null) {
          ctx.fillStyle = ACCENT;
          ctx.font = `900 34px ${FONT}`;
          ctx.fillText(`R${k.round}`, W - 76, ky);
        } else {
          ctx.fillStyle = MUTED;
          ctx.font = `800 30px ${FONT}`;
          ctx.fillText("—", W - 76, ky);
        }
      });
    }

    ry += unit * count;
  }

  // ---- the footer -----------------------------------------------------
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.fillStyle = MUTED;
  ctx.font = `700 26px ${FONT}`;
  ctx.letterSpacing = "4px";
  ctx.fillText("DFL HQ", W / 2, H - 58);
  ctx.letterSpacing = "0px";
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText("cgrant10.github.io/dfl-hq", W / 2, H - 26);

  return canvas;
}

/**
 * Share it. MUST be called straight from the click handler.
 * @returns {string} a message worth putting in a toast
 */
export function shareKeeperBoard(board) {
  if (!board || !board.total) {
    return shareText({ title: "DFL HQ — Keepers", text: boardText(board), url: location.href })
      === "copied" ? "Copied to the clipboard" : "Sharing…";
  }
  try {
    const canvas = boardCanvas(board);
    const how = shareCanvas(canvas, `dfl-keepers-${board.season}.png`, {
      title: `DFL HQ — ${board.season} keepers`,
      text: boardText(board),
    });
    return how === "saved" ? "Saved the keeper board to your downloads" : "Sharing…";
  } catch (err) {
    /* A board that arrives as words beats a button that does nothing. */
    console.warn("keeper board: falling back to text", err);
    return shareText({ title: `DFL HQ — ${board.season} keepers`,
                       text: boardText(board), url: location.href })
      === "copied" ? "Copied to the clipboard" : "Sharing…";
  }
}
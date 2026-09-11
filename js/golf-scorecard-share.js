import { FONT, fitText, shareCanvas } from "./share.js";

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const W = 1600, H = 900;
const INK = "#263b49", MUTED = "#627681", LINE = "#ccd2d6";
const HEADER = "#eef3f6", PAPER = "#ffffff";
const GREEN = "#23834b", GREEN_BG = "#e9f7ef";
const RED = "#c73a33", RED_BG = "#fff0ef";

function cellMark(cell) {
  const mark = cell?.querySelector?.(".m-eagle,.m-birdie,.m-par,.m-bogey,.m-dbl")?.className || "";
  if (String(mark).includes("m-eagle")) return "eagle";
  if (String(mark).includes("m-birdie")) return "birdie";
  if (String(mark).includes("m-bogey")) return "bogey";
  if (String(mark).includes("m-dbl")) return "double";
  return "par";
}

function primaryText(node, fallback = "") {
  if (!node) return fallback;
  const clone = node.cloneNode(true);
  clone.querySelectorAll("small").forEach(child => child.remove());
  return clean(clone.textContent) || fallback;
}

export function scorecardModel(card, fallbackTitle = "Golf scorecard") {
  const table = card?.querySelector("table");
  const title = clean(card?.querySelector("h2")?.textContent) || fallbackTitle;
  const context = [...(card?.querySelectorAll(".gqm-scorecard-title p,.gqm-scorecard-title strong") || [])]
    .map(node => clean(node.textContent)).filter(Boolean).join(" · ");
  const columns = [...(table?.querySelectorAll("thead th") || [])].slice(1).map((node, index) => {
    const label = primaryText(node, clean(node.textContent));
    return {
      label,
      meta: clean(node.querySelector?.("small")?.textContent),
      index,
      hole: Number((label.match(/^\d+/) || [])[0]) || 0,
    };
  });
  const rows = [...(table?.querySelectorAll("tbody tr") || [])].map(row => {
    const head = row.querySelector("th");
    const cells = [...row.querySelectorAll("td")];
    return {
      name: primaryText(head, "Golfer"),
      detail: clean(head?.querySelector?.("small")?.textContent),
      values: cells.map(cell => clean(cell.textContent) || "—"),
      marks: cells.map(cellMark),
    };
  });
  return { title, context, columns, rows };
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawScoreMark(ctx, value, mark, x, y, w, h) {
  const size = Math.min(42, w - 10, h - 10);
  const cx = x + w / 2, cy = y + h / 2;
  const isGreen = mark === "birdie" || mark === "eagle";
  const isRed = mark === "bogey" || mark === "double";
  if (isGreen || isRed) {
    const inset = mark === "eagle" || mark === "double" ? 4 : 0;
    ctx.fillStyle = isGreen ? GREEN_BG : RED_BG;
    ctx.strokeStyle = isGreen ? GREEN : RED;
    ctx.lineWidth = 2;
    if (isGreen) {
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      if (inset) { ctx.beginPath(); ctx.arc(cx, cy, size / 2 - inset, 0, Math.PI * 2); ctx.stroke(); }
    } else {
      ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
      ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
      if (inset) ctx.strokeRect(cx - size / 2 + inset, cy - size / 2 + inset, size - inset * 2, size - inset * 2);
    }
  }
  ctx.fillStyle = isGreen ? "#176338" : isRed ? "#a62f29" : INK;
  ctx.textBaseline = "middle";
  fitText(ctx, value, cx, cy + 1, Math.max(20, w - 10), Math.min(25, h * .42), 850);
}

function drawHeader(ctx, column, x, y, w, h) {
  ctx.fillStyle = HEADER;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  const metaLines = column.meta.split(/\s*[·•]\s*/).filter(Boolean);
  fitText(ctx, column.label, x + w / 2, y + (metaLines.length ? h * .25 : h / 2), w - 8, column.hole ? 23 : 18, 850);
  if (metaLines.length) {
    ctx.fillStyle = MUTED;
    metaLines.slice(0, 2).forEach((text, index) => {
      fitText(ctx, text, x + w / 2, y + h * (.54 + index * .24), w - 8, 13, 700);
    });
  }
}

export function scorecardCanvas(model) {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);

  const margin = 38;
  const tableTop = model.context ? 125 : 105;
  const footerH = 34, headerH = 86;
  const tableW = W - margin * 2;
  const nameW = Math.min(270, Math.max(205, tableW * .17));
  const dataW = (tableW - nameW) / Math.max(1, model.columns.length);
  const availableRowsH = H - tableTop - headerH - footerH - 18;
  const rowH = Math.min(64, availableRowsH / Math.max(1, model.rows.length));
  const renderedTableH = headerH + rowH * model.rows.length;

  ctx.fillStyle = INK; ctx.textBaseline = "alphabetic";
  fitText(ctx, model.title.toUpperCase(), margin, 58, W - margin * 2, 36, 900, "left");
  if (model.context) {
    ctx.fillStyle = MUTED;
    fitText(ctx, model.context, margin, 92, W - margin * 2, 20, 650, "left");
  }
  ctx.fillStyle = GREEN; ctx.fillRect(margin, tableTop - 8, tableW, 8);

  ctx.fillStyle = HEADER; ctx.fillRect(margin, tableTop, nameW, headerH);
  ctx.fillStyle = INK; ctx.textBaseline = "middle";
  fitText(ctx, "GOLFER", margin + 14, tableTop + headerH / 2, nameW - 28, 20, 850, "left");
  model.columns.forEach((column, index) => drawHeader(ctx, column, margin + nameW + dataW * index, tableTop, dataW, headerH));

  model.rows.forEach((row, rowIndex) => {
    const y = tableTop + headerH + rowH * rowIndex;
    ctx.fillStyle = rowIndex % 2 ? "#fbfcfc" : PAPER;
    ctx.fillRect(margin, y, tableW, rowH);
    ctx.fillStyle = INK; ctx.textBaseline = "middle";
    fitText(ctx, row.name, margin + 14, y + (row.detail ? rowH * .4 : rowH / 2), nameW - 28, Math.min(21, rowH * .34), 800, "left");
    if (row.detail) {
      ctx.fillStyle = MUTED;
      fitText(ctx, row.detail, margin + 14, y + rowH * .7, nameW - 28, Math.min(14, rowH * .24), 600, "left");
    }
    model.columns.forEach((column, index) => {
      const x = margin + nameW + dataW * index;
      if (!column.hole) { ctx.fillStyle = HEADER; ctx.fillRect(x, y, dataW, rowH); }
      drawScoreMark(ctx, row.values[column.index] || "—", column.hole ? row.marks[column.index] : "par", x, y, dataW, rowH);
    });
  });

  ctx.strokeStyle = LINE; ctx.lineWidth = 1.5;
  line(ctx, margin, tableTop, margin + tableW, tableTop);
  line(ctx, margin, tableTop + renderedTableH, margin + tableW, tableTop + renderedTableH);
  line(ctx, margin, tableTop, margin, tableTop + renderedTableH);
  line(ctx, margin + tableW, tableTop, margin + tableW, tableTop + renderedTableH);
  line(ctx, margin + nameW, tableTop, margin + nameW, tableTop + renderedTableH);
  model.columns.forEach((_, index) => {
    const x = margin + nameW + dataW * (index + 1);
    line(ctx, x, tableTop, x, tableTop + renderedTableH);
  });
  line(ctx, margin, tableTop + headerH, margin + tableW, tableTop + headerH);
  model.rows.forEach((_, index) => {
    const y = tableTop + headerH + rowH * (index + 1);
    line(ctx, margin, y, margin + tableW, y);
  });

  ctx.fillStyle = MUTED; ctx.textBaseline = "alphabetic";
  fitText(ctx, "DFL HQ · GOLF SCORECARD", W - margin, H - 18, W / 2, 15, 750, "right");
  return canvas;
}

export function shareScorecard(card, fallbackTitle = "Golf scorecard") {
  const model = scorecardModel(card, fallbackTitle);
  if (!model.rows.length) return "failed";
  const filename = `${model.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "golf-scorecard"}.png`;
  return shareCanvas(scorecardCanvas(model), filename, { title: model.title, text: model.context || model.title });
}

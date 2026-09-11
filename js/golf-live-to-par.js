// Live score-to-par presentation for Golf match scorecards.
// Keeps the underlying match/stroke scoring logic untouched; this only changes
// what the in-round card shows while scores are being entered.
const fmt = (n) => n === 0 ? "E" : n > 0 ? `+${n}` : String(n);

function scoreSide(root, side) {
  let diff = 0, holes = 0;
  for (const input of root.querySelectorAll(`input[data-battle-score][data-side="${side}"]`)) {
    const raw = String(input.value || "").trim();
    if (!raw) continue;
    const strokes = Number(raw), par = Number(input.dataset.par);
    if (!Number.isFinite(strokes) || !Number.isFinite(par) || strokes < 1) continue;
    diff += strokes - par;
    holes++;
  }
  return { diff, holes };
}

function paint(root) {
  if (!root?.querySelector?.("input[data-battle-score]")) return;
  const sides = [scoreSide(root, 0), scoreSide(root, 1)];
  const rows = [...root.querySelectorAll("[data-match-state] .gm-side")];

  rows.forEach((row, i) => {
    const x = sides[i];
    const fig = row.querySelector(".gm-fig");
    if (!fig) return;
    fig.innerHTML = x.holes ? `${fmt(x.diff)}<small>thru ${x.holes}</small>` : `—<small>not started</small>`;
    row.classList.remove("is-up");
  });

  if (sides[0].holes || sides[1].holes) {
    const comparable = sides[0].holes && sides[1].holes;
    if (comparable && sides[0].diff !== sides[1].diff) {
      const leader = sides[0].diff < sides[1].diff ? 0 : 1;
      rows[leader]?.classList.add("is-up");
    }
  }

  const stand = root.querySelector("[data-match-state] .gm-stand");
  if (stand) {
    const thru = Math.min(sides[0].holes || 0, sides[1].holes || 0);
    stand.textContent = thru ? `Live score to par · through ${thru}` : "Live score to par";
    stand.classList.remove("is-done");
  }

  // The old paper-card UP/DN row conflicts with the live differential view.
  root.querySelectorAll(".dfl-battle-tbl .row-m").forEach((row) => row.hidden = true);
  const stripHint = root.querySelector(".dfl-battle-strip-title span:last-child");
  if (stripHint && /UP\/DN/i.test(stripHint.textContent || "")) stripHint.textContent = "Live score to par";
}

function schedule(root) {
  clearTimeout(root.__dflToParTimer);
  root.__dflToParTimer = setTimeout(() => paint(root), 0);
}

function bind(root) {
  if (!root || root.dataset.liveToPar === "1") return;
  root.dataset.liveToPar = "1";
  const refresh = () => schedule(root);
  root.addEventListener("input", refresh, true);
  root.addEventListener("change", refresh, true);
  root.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-step]")) setTimeout(refresh, 0);
  }, true);
  const mo = new MutationObserver(refresh);
  mo.observe(root, { childList: true, subtree: true, characterData: true });
  root.__dflToParObserver = mo;
  paint(root);
}

function scan() {
  document.querySelectorAll(".dfl-battle-card").forEach(bind);
}

const observer = new MutationObserver(scan);
if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("hashchange", () => setTimeout(scan, 0));
queueMicrotask(scan);

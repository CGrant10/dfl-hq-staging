import { db } from "./supabase.js";
import { currentMember } from "./members.js";
import { shrinkToDataUri } from "./image-field.js";
import { esc, toast } from "./ui.js";
import { icon } from "./icons.js";

const SCHEMA_MISSING = /target_broadcast|target_hall|hall_status|hall_year|people_label|schema cache|does not exist/i;
let painting = false;

function ensureStyles() {
  if (document.getElementById("dfl-league-photo-styles")) return;
  const style = document.createElement("style");
  style.id = "dfl-league-photo-styles";
  style.textContent = `
.dfl-quick-actions{margin-top:18px}
.dfl-quick-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
.dfl-quick-action{display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--text);padding:13px 14px;border:1px solid var(--border);border-radius:14px;background:linear-gradient(145deg,color-mix(in srgb,var(--bg-2) 92%,transparent),color-mix(in srgb,var(--bg-3) 82%,transparent));box-shadow:0 8px 24px rgba(0,0,0,.12)}
.dfl-quick-action:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--border));transform:translateY(-1px)}
.dfl-quick-icon{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 13%,var(--bg-3));flex:0 0 auto}
.dfl-quick-icon svg{width:21px;height:21px;filter:grayscale(1) saturate(0) brightness(1.6)}
.dfl-quick-copy{min-width:0;display:grid;gap:2px}.dfl-quick-copy strong{font-size:15px}.dfl-quick-copy span{font-size:12px;color:var(--muted)}
.dfl-quick-arrow{margin-left:auto;color:var(--muted);font-size:20px}
.dfl-photo-page{max-width:720px;margin:0 auto;padding-bottom:28px}.dfl-photo-head{display:flex;align-items:center;gap:10px;margin-bottom:14px}.dfl-photo-head h1{margin:0}.dfl-photo-card{padding:16px}.dfl-photo-form{display:grid;gap:14px}
.dfl-photo-pick{display:grid;place-items:center;min-height:180px;border:1px dashed var(--border);border-radius:16px;background:var(--bg-2);overflow:hidden;cursor:pointer;text-align:center;padding:14px}.dfl-photo-pick img{display:block;width:100%;max-height:420px;object-fit:contain;border-radius:12px}.dfl-photo-pick.is-ready{padding:8px}
.dfl-photo-pick-copy{display:grid;gap:6px;place-items:center}.dfl-photo-pick-copy svg{width:28px;height:28px;filter:grayscale(1) saturate(0) brightness(1.5)}
.dfl-photo-field{display:grid;gap:6px}.dfl-photo-field>span{font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}.dfl-photo-field textarea{resize:vertical}
.dfl-destinations{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.dfl-dest{position:relative}.dfl-dest input{position:absolute;opacity:0;pointer-events:none}.dfl-dest span{display:grid;gap:3px;height:100%;padding:11px;border:1px solid var(--border);border-radius:12px;background:var(--bg-2);cursor:pointer;text-align:center}.dfl-dest strong{font-size:13px}.dfl-dest small{color:var(--muted);font-size:10px}.dfl-dest input:checked+span{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--bg-2))}
.dfl-photo-meta{display:grid;grid-template-columns:1fr 120px;gap:10px}.dfl-photo-submit-row{display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap}
.dfl-hall-photos{margin-top:18px}.dfl-hall-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.dfl-hall-head h2{margin:0}.dfl-hall-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.dfl-hall-photo{overflow:hidden}.dfl-hall-photo img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:var(--bg-3)}.dfl-hall-photo .card-body{display:grid;gap:5px}.dfl-hall-photo p{margin:0}.dfl-hall-kicker{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.dfl-hall-year{font-weight:800}.dfl-hall-people{color:var(--muted);font-size:12px}
@media(max-width:560px){.dfl-destinations{grid-template-columns:1fr}.dfl-photo-meta{grid-template-columns:1fr}.dfl-hall-grid{grid-template-columns:1fr}.dfl-photo-card{padding:13px}}
`;
  document.head.appendChild(style);
}

function hashInfo() {
  const raw = location.hash || "#/home";
  const [path, qs = ""] = raw.split("?");
  return { path, params: new URLSearchParams(qs) };
}

function quickActions() {
  const { path } = hashInfo();
  if (path !== "#/home") return;
  const home = document.getElementById("home-wrap");
  const wall = home?.querySelector("[data-wall-slot]");
  if (!home || !wall || home.querySelector("[data-dfl-quick-actions]")) return;
  const section = document.createElement("section");
  section.className = "block dfl-quick-actions";
  section.dataset.dflQuickActions = "1";
  section.innerHTML = `
    <h2 class="section-title">Quick Actions</h2>
    <div class="dfl-quick-grid">
      <a class="dfl-quick-action" href="#/history?photo-submit=1">
        <span class="dfl-quick-icon" aria-hidden="true">${icon("camera", { size: 22 })}</span>
        <span class="dfl-quick-copy"><strong>Submit a Photo</strong><span>Broadcast · Hall of Fame · or both</span></span>
        <span class="dfl-quick-arrow" aria-hidden="true">›</span>
      </a>
    </div>`;
  wall.before(section);
}

function submitPageMarkup() {
  const me = currentMember();
  return `<div class="dfl-photo-page" data-league-photo-submit-page>
    <div class="dfl-photo-head"><a class="btn ghost small" href="#/home">← Home</a><h1>Submit a Photo</h1></div>
    <div class="card dfl-photo-card">
      ${me ? `<form class="dfl-photo-form" data-league-photo-form>
        <p class="muted" style="margin:0">Got a DFL photo worth putting on the big screen or saving forever? Send it in. A commissioner reviews it before it goes anywhere.</p>
        <label class="dfl-photo-pick" data-photo-pick>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/avif" hidden data-photo-file>
          <span class="dfl-photo-pick-copy" data-photo-empty>${icon("camera", { size: 28 })}<strong>Choose a photo</strong><span class="muted tiny">We shrink it on your device before saving.</span></span>
          <img class="hidden" alt="Selected photo preview" data-photo-preview>
        </label>
        <label class="dfl-photo-field"><span>Caption</span><textarea rows="3" maxlength="180" data-photo-caption placeholder="What are we looking at?"></textarea></label>
        <div class="dfl-photo-meta">
          <label class="dfl-photo-field"><span>Who's in it? <em class="muted" style="font-style:normal;text-transform:none">optional</em></span><input maxlength="160" data-photo-people placeholder="Grant, Mike, the poor bartender…"></label>
          <label class="dfl-photo-field"><span>Year <em class="muted" style="font-style:normal;text-transform:none">optional</em></span><input type="number" min="2010" max="2100" inputmode="numeric" data-photo-year placeholder="2026"></label>
        </div>
        <fieldset style="border:0;padding:0;margin:0;display:grid;gap:7px"><legend class="tiny muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.05em">Send it to</legend>
          <div class="dfl-destinations">
            <label class="dfl-dest"><input type="radio" name="destination" value="broadcast" checked><span><strong>Broadcast</strong><small>Temporary spotlight</small></span></label>
            <label class="dfl-dest"><input type="radio" name="destination" value="hall"><span><strong>Hall of Fame</strong><small>Permanent league lore</small></span></label>
            <label class="dfl-dest"><input type="radio" name="destination" value="both"><span><strong>Both</strong><small>Let it live twice</small></span></label>
          </div>
        </fieldset>
        <div class="dfl-photo-submit-row"><a class="btn ghost" href="#/history">View Hall of Fame</a><button class="btn" type="submit" data-photo-submit>Submit Photo</button></div>
      </form>` : `<div class="muted">Pick your member identity before submitting a photo.</div>`}
    </div>
  </div>`;
}

function wireSubmitPage(root) {
  const form = root.querySelector("[data-league-photo-form]");
  if (!form || form.dataset.wired === "1") return;
  form.dataset.wired = "1";
  let image = "";
  const file = form.querySelector("[data-photo-file]");
  const preview = form.querySelector("[data-photo-preview]");
  const empty = form.querySelector("[data-photo-empty]");
  const pick = form.querySelector("[data-photo-pick]");
  file?.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    try {
      empty.innerHTML = `<strong>Shrinking…</strong><span class="muted tiny">Making it app-sized.</span>`;
      image = await shrinkToDataUri(chosen, "backdrop");
      preview.src = image;
      preview.classList.remove("hidden");
      empty.classList.add("hidden");
      pick.classList.add("is-ready");
    } catch (err) {
      image = "";
      preview.removeAttribute("src"); preview.classList.add("hidden");
      empty.classList.remove("hidden");
      empty.innerHTML = `${icon("camera", { size: 28 })}<strong>Choose a photo</strong><span class="muted tiny">${esc(err?.message || "Could not read that photo")}</span>`;
      pick.classList.remove("is-ready");
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const me = currentMember();
    if (!me) return toast("Pick your member identity first", true);
    if (!image) return toast("Choose a photo first", true);
    const destination = form.querySelector('input[name="destination"]:checked')?.value || "broadcast";
    const targetBroadcast = destination === "broadcast" || destination === "both";
    const targetHall = destination === "hall" || destination === "both";
    const yearRaw = Number(form.querySelector("[data-photo-year]")?.value || 0);
    const payload = {
      member_id: me.id,
      image,
      caption: String(form.querySelector("[data-photo-caption]")?.value || "").trim(),
      people_label: String(form.querySelector("[data-photo-people]")?.value || "").trim(),
      hall_year: targetHall && yearRaw >= 2010 && yearRaw <= 2100 ? yearRaw : null,
      target_broadcast: targetBroadcast,
      target_hall: targetHall,
      status: targetBroadcast ? "pending" : "not_requested",
      hall_status: targetHall ? "pending" : "not_requested",
    };
    const btn = form.querySelector("[data-photo-submit]");
    btn.disabled = true; btn.textContent = "Submitting…";
    const { error } = await db().from("broadcast_submissions").insert(payload);
    if (error) {
      btn.disabled = false; btn.textContent = "Submit Photo";
      return toast(SCHEMA_MISSING.test(error.message || "") ? "Run league_photo_submissions_schema.sql first" : error.message, true);
    }
    const label = destination === "both" ? "Broadcast + Hall of Fame" : destination === "hall" ? "Hall of Fame" : "Broadcast";
    root.innerHTML = `<div class="dfl-photo-page" data-league-photo-submit-page><div class="dfl-photo-head"><a class="btn ghost small" href="#/home">← Home</a><h1>Submitted</h1></div><div class="card"><div class="card-body" style="display:grid;gap:12px"><strong>Sent for ${esc(label)} review.</strong><p class="muted" style="margin:0">A commissioner will decide what makes the cut.</p><div class="row-end"><a class="btn ghost" href="#/history">Hall of Fame</a><a class="btn" href="#/home">Back Home</a></div></div></div></div>`;
    toast("Photo submitted");
  });
}

async function hallGallery(holder) {
  if (!holder || holder.dataset.loading === "1") return;
  holder.dataset.loading = "1";
  const { data, error } = await db().from("broadcast_submissions")
    .select("id,image,caption,hall_year,people_label,created_at,members(display_name)")
    .eq("target_hall", true).eq("hall_status", "approved")
    .order("hall_year", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false }).limit(40);
  if (!holder.isConnected) return;
  if (error) {
    holder.innerHTML = SCHEMA_MISSING.test(error.message || "") ? "" : `<div class="card"><div class="card-body muted">${esc(error.message)}</div></div>`;
    return;
  }
  const rows = data || [];
  holder.innerHTML = rows.length ? `<div class="dfl-hall-grid">${rows.map((r) => `<article class="card dfl-hall-photo">
    <img src="${esc(r.image)}" alt="${esc(r.caption || "DFL Hall of Fame photo")}" loading="lazy" decoding="async">
    <div class="card-body">
      <div class="dfl-hall-kicker">${r.hall_year ? `<span class="dfl-hall-year">${esc(r.hall_year)}</span>` : ""}${r.people_label ? `<span class="dfl-hall-people">${esc(r.people_label)}</span>` : ""}</div>
      ${r.caption ? `<p>${esc(r.caption)}</p>` : ""}
      <span class="muted tiny">Submitted by ${esc(r.members?.display_name || "DFL member")}</span>
    </div></article>`).join("")}</div>` : `<div class="card"><div class="card-body muted">No Hall of Fame photos yet. Somebody has to submit the first piece of evidence.</div></div>`;
}

function decorateHistory() {
  const { path, params } = hashInfo();
  if (path !== "#/history") return;
  const view = document.getElementById("view");
  if (!view) return;
  if (params.get("photo-submit") === "1") {
    if (!view.querySelector("[data-league-photo-submit-page]")) {
      view.innerHTML = submitPageMarkup();
      wireSubmitPage(view);
    } else wireSubmitPage(view);
    return;
  }
  const fame = view.querySelector('#hist-tabs button[data-tab="fame"].on');
  const body = view.querySelector("#hist-body");
  if (!fame || !body || body.querySelector("[data-hall-photo-section]")) return;
  const section = document.createElement("section");
  section.className = "dfl-hall-photos";
  section.dataset.hallPhotoSection = "1";
  section.innerHTML = `<div class="dfl-hall-head"><h2>Hall of Fame Photos</h2><a class="btn ghost small" href="#/history?photo-submit=1">Submit a Photo</a></div><div data-hall-photo-grid><div class="card"><div class="card-body muted">Loading the evidence…</div></div></div>`;
  const championCard = body.querySelector(".card.accent");
  if (championCard) championCard.after(section); else body.prepend(section);
  hallGallery(section.querySelector("[data-hall-photo-grid]"));
}

function decorate() {
  if (painting) return;
  painting = true;
  queueMicrotask(() => {
    try { quickActions(); decorateHistory(); } finally { painting = false; }
  });
}

export function startLeaguePhotoFeature() {
  ensureStyles();
  decorate();
  const target = document.getElementById("app") || document.body;
  if (!target || target.dataset.leaguePhotoWatch === "1") return;
  target.dataset.leaguePhotoWatch = "1";
  new MutationObserver(decorate).observe(target, { childList: true, subtree: true });
  window.addEventListener("hashchange", decorate);
}

startLeaguePhotoFeature();

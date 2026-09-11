import { db } from "./supabase.js";
import { esc, toast } from "./ui.js";

const NEW_SCHEMA_MISSING = /target_broadcast|target_hall|hall_status|hall_year|people_label|schema cache|does not exist/i;

function ensureStyles() {
  if (document.getElementById("dfl-broadcast-inbox-style")) return;
  const style = document.createElement("style");
  style.id = "dfl-broadcast-inbox-style";
  style.textContent = `
.broadcast-inbox{display:grid;gap:12px}
.bx-submit{overflow:hidden}
.bx-submit>img{display:block;width:100%;height:auto;max-height:440px;object-fit:cover}
.bx-submit .card-body{display:grid;gap:10px}
.bx-submit p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.bx-submit select{width:auto;min-width:68px;margin-left:6px}
.bx-targets{display:flex;gap:6px;flex-wrap:wrap}.bx-target{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;border:1px solid var(--border);border-radius:999px;padding:3px 7px;color:var(--muted)}
.bx-review-block{display:grid;gap:8px;padding-top:8px;border-top:1px solid var(--border)}.bx-review-head{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.bx-review-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.bx-review-actions .row-end{display:flex;gap:7px;margin-left:auto}
@media(min-width:780px){.broadcast-inbox{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
  document.head.appendChild(style);
}

async function readSubmissions() {
  const modern = await db().from("broadcast_submissions")
    .select("id,member_id,image,caption,status,target_broadcast,target_hall,hall_status,hall_year,people_label,created_at,members(display_name)")
    .or("and(target_broadcast.eq.true,status.eq.pending),and(target_hall.eq.true,hall_status.eq.pending)")
    .order("created_at", { ascending: true });
  if (!modern.error) return { rows: modern.data || [], modern: true };
  if (!NEW_SCHEMA_MISSING.test(modern.error.message || "")) throw modern.error;
  const legacy = await db().from("broadcast_submissions")
    .select("id,member_id,image,caption,status,created_at,members(display_name)")
    .eq("status", "pending").order("created_at", { ascending: true });
  if (legacy.error) throw legacy.error;
  return { rows: legacy.data || [], modern: false };
}

function reviewBlock(r, kind) {
  if (kind === "broadcast") return `<div class="bx-review-block">
    <div class="bx-review-head">Broadcast review</div>
    <div class="bx-review-actions">
      <label class="tiny">On screen <select data-dwell>${[3, 5, 8, 10, 12, 15].map((n) => `<option value="${n}"${n === 8 ? " selected" : ""}>${n}s</option>`).join("")}</select></label>
      <span class="row-end"><button class="btn ghost small danger" data-reject-broadcast="${r.id}">Reject</button><button class="btn small" data-approve-broadcast="${r.id}">Approve</button></span>
    </div></div>`;
  return `<div class="bx-review-block">
    <div class="bx-review-head">Hall of Fame review</div>
    <div class="bx-review-actions"><span class="muted tiny">Permanent league gallery${r.hall_year ? ` · ${esc(r.hall_year)}` : ""}</span>
      <span class="row-end"><button class="btn ghost small danger" data-reject-hall="${r.id}">Reject</button><button class="btn small" data-approve-hall="${r.id}">Approve</button></span>
    </div></div>`;
}

export async function broadcastInboxHtml() {
  ensureStyles();
  let result;
  try { result = await readSubmissions(); }
  catch (error) {
    if (/broadcast_submissions|schema cache|does not exist/i.test(error?.message || "")) return "";
    return `<div class="muted">${esc(error?.message || "Could not load submissions")}</div>`;
  }
  const { rows, modern } = result;
  return `<section class="block" data-broadcast-inbox data-modern="${modern ? "1" : "0"}">
    <h2 class="section-title">Photo Submission Inbox <span class="muted tiny">${rows.length} pending</span></h2>
    <div class="broadcast-inbox">${rows.length ? rows.map((r) => `
      <article class="card bx-submit">
        <img src="${esc(r.image)}" alt="Submitted by ${esc(r.members?.display_name || "member")}">
        <div class="card-body">
          <div><strong>${esc(r.members?.display_name || "Member")}</strong>${modern ? `<div class="bx-targets">${r.target_broadcast ? `<span class="bx-target">Broadcast</span>` : ""}${r.target_hall ? `<span class="bx-target">Hall of Fame</span>` : ""}</div>` : ""}</div>
          ${r.caption ? `<p>${esc(r.caption)}</p>` : ""}
          ${modern && r.people_label ? `<span class="muted tiny">In the photo: ${esc(r.people_label)}</span>` : ""}
          ${modern
            ? `${r.target_broadcast && r.status === "pending" ? reviewBlock(r, "broadcast") : ""}${r.target_hall && r.hall_status === "pending" ? reviewBlock(r, "hall") : ""}`
            : `<div class="row-between"><label class="tiny">On screen <select data-dwell>${[3,5,8,10,12,15].map(n=>`<option value="${n}"${n===8?" selected":""}>${n}s</option>`).join("")}</select></label><span><button class="btn ghost small danger" data-reject-broadcast="${r.id}">Reject</button> <button class="btn small" data-approve-broadcast="${r.id}">Approve</button></span></div>`}
        </div>
      </article>`).join("") : `<div class="card"><div class="card-body muted">Inbox clear.</div></div>`}</div>
  </section>`;
}

function disableCard(btn, disabled) {
  btn.closest(".bx-submit")?.querySelectorAll("button,select").forEach((el) => (el.disabled = disabled));
}

export function wireBroadcastInbox(root, onChanged) {
  root.querySelectorAll("[data-approve-broadcast]").forEach((btn) => btn.addEventListener("click", async () => {
    const card = btn.closest(".bx-submit");
    const dwell = Number(card.querySelector("[data-dwell]")?.value) || 8;
    disableCard(btn, true);
    const { error } = await db().rpc("approve_broadcast_submission", { p_id: Number(btn.dataset.approveBroadcast), p_dwell_seconds: dwell });
    if (error) { disableCard(btn, false); return toast(error.message, true); }
    toast("Approved for Broadcast"); onChanged?.();
  }));

  root.querySelectorAll("[data-reject-broadcast]").forEach((btn) => btn.addEventListener("click", async () => {
    disableCard(btn, true);
    const { error } = await db().from("broadcast_submissions").update({ status: "rejected", reviewed_at: new Date().toISOString() }).eq("id", Number(btn.dataset.rejectBroadcast));
    if (error) { disableCard(btn, false); return toast(error.message, true); }
    toast("Broadcast submission rejected"); onChanged?.();
  }));

  root.querySelectorAll("[data-approve-hall]").forEach((btn) => btn.addEventListener("click", async () => {
    disableCard(btn, true);
    const { error } = await db().rpc("approve_hall_submission", { p_id: Number(btn.dataset.approveHall) });
    if (error) { disableCard(btn, false); return toast(error.message, true); }
    toast("Added to the Hall of Fame"); onChanged?.();
  }));

  root.querySelectorAll("[data-reject-hall]").forEach((btn) => btn.addEventListener("click", async () => {
    disableCard(btn, true);
    const { error } = await db().from("broadcast_submissions").update({ hall_status: "rejected", hall_reviewed_at: new Date().toISOString() }).eq("id", Number(btn.dataset.rejectHall));
    if (error) { disableCard(btn, false); return toast(error.message, true); }
    toast("Hall of Fame submission rejected"); onChanged?.();
  }));
}

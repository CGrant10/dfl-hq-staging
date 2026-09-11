// Marks active commissioners on member profiles without exposing role secrets.
import { db } from "./supabase.js";
import { currentMember } from "./members.js";

export async function decorateCommissionerBadge(view) {
  const heading = view.querySelector(".profile-name");
  if (!heading || heading.querySelector("[data-commissioner-badge]")) return;
  const wanted = new URLSearchParams((location.hash.split("?")[1] || "")).get("id");
  const memberId = wanted || currentMember()?.id;
  if (!memberId) return;
  try {
    const { data, error } = await db().rpc("public_commissioners");
    if (error) return;
    if (!(data || []).some((r) => String(r.member_id) === String(memberId))) return;
    const badge = document.createElement("span");
    badge.dataset.commissionerBadge = "1";
    badge.className = "pill";
    badge.title = "DFL Commissioner";
    badge.setAttribute("aria-label", "DFL Commissioner");
    badge.textContent = "C";
    badge.style.marginLeft = "8px";
    badge.style.verticalAlign = "middle";
    heading.appendChild(badge);
  } catch { /* migration not installed yet: profile stays unchanged */ }
}

// Member-switch theme reconciliation + permanent league chrome.
import { APP_VERSION } from "./config.js";
import { db } from "./supabase.js";
import { currentMember } from "./members.js";
import { applyTheme, isTeamMode, teamModeFor } from "./theme.js";
import "./arena-duration-ui.js";
import "./league-photo-feature.js";
import "./engagement-home.js";

const MODE_KEY = "dfl.mode";
const PICKABLE = new Set(["dark", "light", "fairway", "medicine", "medicine-light", "system"]);

function validMode(value) {
  const v = String(value || "");
  if (PICKABLE.has(v)) return v;
  if (isTeamMode(v)) return teamModeFor(v.slice("team:".length)) || "";
  return "";
}

function tagProfileVisuals(root = document) {
  const grid = root.querySelector?.("#profile-wrap .statgrid.is-3up");
  if (grid) {
    grid.classList.add("dfl-career-grid");
    grid.closest(".card")?.classList.add("dfl-career-card");
  }
  for (const heading of root.querySelectorAll?.("#profile-wrap .section-title") || []) {
    if (String(heading.textContent || "").trim().toLowerCase() !== "the career") continue;
    heading.classList.add("dfl-the-career-title");
    const card = heading.nextElementSibling;
    if (card?.classList.contains("recbook")) card.classList.add("dfl-the-career-card");
  }
  for (const trophy of root.querySelectorAll?.(".profile-head .ph-record .is-gold .ico-trophy") || []) {
    trophy.classList.add("dfl-profile-champ-trophy");
  }
  const cabinetTrophy = root.querySelector?.("#profile-wrap .cabinet .cab-row:not(.is-second) .ico-sm");
  if (cabinetTrophy) cabinetTrophy.classList.add("dfl-cabinet-gold-trophy");
}

function watchProfileVisuals() {
  tagProfileVisuals(document);
  const target = document.getElementById("app") || document.body || document.documentElement;
  if (!target || target.dataset?.profilePolishWatch === "1") return;
  if (target.dataset) target.dataset.profilePolishWatch = "1";
  new MutationObserver(() => tagProfileVisuals(document)).observe(target, { childList: true, subtree: true });
}

function loadPermanentChromeStyles() {
  if (!document.getElementById("dfl-profile-neutral-css")) {
    const link = document.createElement("link");
    link.id = "dfl-profile-neutral-css";
    link.rel = "stylesheet";
    link.href = `css/profile-neutral.css?v=${APP_VERSION}`;
    document.head.appendChild(link);
  }
  if (document.getElementById("dfl-visual-polish-hardfix")) return;
  const style = document.createElement("style");
  style.id = "dfl-visual-polish-hardfix";
  style.textContent = `
.brand-word,.brand-text .brand-word,.brand-text .brand-word span{
  background:none!important;-webkit-background-clip:border-box!important;background-clip:border-box!important;
  -webkit-text-fill-color:#fff!important;color:#fff!important
}

#profile-wrap .dfl-career-card .card-title{
  background:none!important;-webkit-background-clip:border-box!important;background-clip:border-box!important;
  -webkit-text-fill-color:var(--text)!important;color:var(--text)!important
}
#profile-wrap .dfl-career-grid .stat-v,
#profile-wrap .dfl-career-grid .stat-v.good,
#profile-wrap .dfl-career-grid .stat-v.warn,
#profile-wrap .dfl-career-grid .stat-v.bad{
  background:none!important;-webkit-background-clip:border-box!important;background-clip:border-box!important;
  -webkit-text-fill-color:var(--text)!important;color:var(--text)!important
}

/* TOKENS, NOT HEXES. These were written as dark-mode values - a #111419
   card with #f4f6f8 ink - and applied unconditionally, so in light mode the
   career card was a black box with white text sitting in a white page. The
   palette already has a name for every one of them. */
#profile-wrap .dfl-the-career-title{
  background:none!important;-webkit-background-clip:border-box!important;background-clip:border-box!important;
  -webkit-text-fill-color:var(--text)!important;color:var(--text)!important
}
#profile-wrap .dfl-the-career-card{
  background:var(--bg-2)!important;border:1px solid var(--line)!important;
  box-shadow:var(--shadow)!important
}
#profile-wrap .dfl-the-career-card .rec{background:var(--bg-3)!important}
#profile-wrap .dfl-the-career-card .rec-val{
  background:none!important;-webkit-background-clip:border-box!important;background-clip:border-box!important;
  -webkit-text-fill-color:var(--text)!important;color:var(--text)!important
}
#profile-wrap .dfl-the-career-card .rec-label,
#profile-wrap .dfl-the-career-card .rec-when{color:var(--muted)!important}
#profile-wrap .dfl-the-career-card .rec-who{color:var(--text)!important}

/* Trophy Cabinet: replace the theme-painted <use> pixels with the same kind
   of four-step metallic gold used by DFL championship hardware. */
.dfl-cabinet-gold-trophy{
  background:linear-gradient(135deg,#fff0a8 0%,#f7c948 34%,#fff4bb 52%,#b77912 100%)!important;
  -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M7 4h10v4.5a5 5 0 0 1-10 0V4Z'/%3E%3Cpath d='M7 5H4.5v1.5A3.5 3.5 0 0 0 8 10M17 5h2.5v1.5A3.5 3.5 0 0 1 16 10' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round'/%3E%3Cpath d='M10.5 13.2h3V17h-3z'/%3E%3Crect x='7.5' y='17' width='9' height='2.4' rx='1.2'/%3E%3C/svg%3E") center/contain no-repeat!important;
  mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M7 4h10v4.5a5 5 0 0 1-10 0V4Z'/%3E%3Cpath d='M7 5H4.5v1.5A3.5 3.5 0 0 0 8 10M17 5h2.5v1.5A3.5 3.5 0 0 1 16 10' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round'/%3E%3Cpath d='M10.5 13.2h3V17h-3z'/%3E%3Crect x='7.5' y='17' width='9' height='2.4' rx='1.2'/%3E%3C/svg%3E") center/contain no-repeat!important;
  filter:drop-shadow(0 0 4px rgba(247,201,72,.55)) drop-shadow(0 1px 1px rgba(255,244,187,.28))!important;
  opacity:1!important
}
.dfl-cabinet-gold-trophy use{display:none!important}

.dfl-profile-champ-trophy{
  color:#e7c66a!important;
  filter:drop-shadow(0 0 5px rgba(231,198,106,.38)) drop-shadow(0 1px 0 rgba(255,255,255,.08))!important
}
.dfl-profile-champ-trophy path:not([fill="none"]),
.dfl-profile-champ-trophy rect{fill:url(#dfl-gold-grad)!important}
.dfl-profile-champ-trophy path[fill="none"]{stroke:url(#dfl-gold-grad)!important}
`;
  document.head.appendChild(style);
}
loadPermanentChromeStyles();
watchProfileVisuals();

export async function adoptSelectedMemberTheme() {
  const me = currentMember();
  if (!me) return;
  try {
    const { data, error } = await db().from("members").select("theme_mode").eq("id", me.id).maybeSingle();
    if (error) throw error;
    const remote = validMode(data?.theme_mode);
    if (remote) localStorage.setItem(MODE_KEY, remote);
    else localStorage.removeItem(MODE_KEY);
    applyTheme();
  } catch (err) {
    if (!/theme_mode|could not find|does not exist|schema cache/i.test(err?.message || "")) {
      console.warn("theme: could not switch member palette", err);
    }
    localStorage.removeItem(MODE_KEY);
    applyTheme();
  }
}

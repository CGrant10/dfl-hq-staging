import { db } from "./supabase.js";
import { currentMember } from "./members.js";
import { esc, toast } from "./ui.js";
import { icon } from "./icons.js";
import { markSeen, sinceLabel } from "./whatsnew.js";

const REACTIONS = ["😂", "🔥", "💀", "🏆", "🖕"];
const REACTION_SCHEMA_MISSING = /wall_reactions|schema cache|does not exist|could not find/i;
let quickToken = 0;
let sinceToken = 0;
let reactionToken = 0;

function ensureStyles() {
  if (document.getElementById("dfl-engagement-home-css")) return;
  const style = document.createElement("style");
  style.id = "dfl-engagement-home-css";
  style.textContent = `
.dfl-quick-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.dfl-quick-action.is-priority{border-color:color-mix(in srgb,var(--accent) 42%,var(--border));background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 11%,var(--bg-2)),var(--bg-2))}
.dfl-quick-badge{display:inline-flex;width:max-content;margin-top:3px;padding:2px 7px;border-radius:999px;background:color-mix(in srgb,var(--accent) 14%,var(--bg-3));color:var(--text);font-size:10px;font-weight:800;letter-spacing:.03em;text-transform:uppercase}
.dfl-since-sub{margin:1px 0 0;color:var(--muted);font-size:11px;font-weight:500}
.wall-reactions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:10px}
.wall-react{appearance:none;border:1px solid var(--border);background:var(--bg-2);color:var(--text);border-radius:999px;padding:5px 8px;min-width:40px;font:inherit;font-size:13px;line-height:1;display:inline-flex;align-items:center;justify-content:center;gap:4px;cursor:pointer}
.wall-react:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--border))}.wall-react.on{background:color-mix(in srgb,var(--accent) 15%,var(--bg-2));border-color:color-mix(in srgb,var(--accent) 55%,var(--border));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 18%,transparent)}
.wall-react-count{font-size:10px;font-weight:800;color:var(--muted)}.wall-react.on .wall-react-count{color:var(--text)}
@media(max-width:560px){.dfl-quick-grid{grid-template-columns:1fr}.wall-react{padding:6px 9px;min-width:42px}}
`;
  document.head.appendChild(style);
}

const homeNow = () => (location.hash || "#/home").split("?")[0] === "#/home";

function actionGlyph(name) {
  if (name === "camera") return icon("camera", { size: 22 });
  return `<svg class="ico" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${esc(name)}"></use></svg>`;
}

function action(href, title, sub, iconName, { priority = false, badge = "" } = {}) {
  return `<a class="dfl-quick-action${priority ? " is-priority" : ""}" href="${esc(href)}">
    <span class="dfl-quick-icon" aria-hidden="true">${actionGlyph(iconName)}</span>
    <span class="dfl-quick-copy"><strong>${esc(title)}</strong><span>${esc(sub)}</span>${badge ? `<span class="dfl-quick-badge">${esc(badge)}</span>` : ""}</span>
    <span class="dfl-quick-arrow" aria-hidden="true">›</span>
  </a>`;
}

async function paintQuickActions() {
  if (!homeNow()) return;
  const section = document.querySelector("[data-dfl-quick-actions]");
  if (!section || section.dataset.engagementLoading === "1" || section.dataset.engagementPainted === "1") return;
  section.dataset.engagementLoading = "1";
  const token = ++quickToken;
  const me = currentMember();
  const today = new Date().toISOString().slice(0, 10);
  const actions = [];

  try {
    if (me) {
      const [polls, votes, payments] = await Promise.all([
        db().from("polls").select("id,question").eq("active", true).order("created_at", { ascending: false }).limit(5),
        db().from("votes").select("poll_id").eq("member_id", me.id),
        me.sleeper_user_id
          ? db().from("finance_payments").select("season,amount_due,amount_paid").eq("sleeper_user_id", me.sleeper_user_id).order("season", { ascending: false }).limit(1)
          : Promise.resolve({ data: [] }),
      ]);
      if (token !== quickToken || !section.isConnected) { section.dataset.engagementLoading = "0"; return; }
      const voted = new Set((votes.data || []).map((v) => String(v.poll_id)));
      const poll = (polls.data || []).find((p) => !voted.has(String(p.id)));
      if (poll) actions.push(action("#/polls", "Vote in the open poll", poll.question || "Your vote is still missing", "polls", { priority: true, badge: "Needs you" }));
      const pay = (payments.data || [])[0];
      const owed = pay ? Math.max(0, Number(pay.amount_due || 0) - Number(pay.amount_paid || 0)) : 0;
      if (owed > 0) actions.unshift(action("#/finances", `You still owe $${owed.toFixed(owed % 1 ? 2 : 0)}`, `${pay.season} league fees`, "finances", { priority: true, badge: "Open balance" }));
    }

    const [arena, golf] = await Promise.all([
      db().from("arena_events").select("id,name,event_date,status,bc_state").gte("event_date", today).neq("status", "complete").order("event_date", { ascending: true }).limit(1),
      db().from("golf_outings").select("id,name,event_date,status").gte("event_date", today).neq("status", "final").order("event_date", { ascending: true }).limit(1),
    ]);
    if (token !== quickToken || !section.isConnected) { section.dataset.engagementLoading = "0"; return; }
    const race = (arena.data || [])[0];
    if (race && actions.length < 2) actions.push(action(`#/arena?id=${race.id}`, race.bc_state === "running" ? "Arena race is live" : "Arena race coming up", race.name || race.event_date || "Open Arena", "arena", { priority: race.bc_state === "running", badge: race.bc_state === "running" ? "Live" : "" }));
    const outing = (golf.data || [])[0];
    if (outing && actions.length < 2) actions.push(action(`#/golf?id=${outing.id}`, "Golf is on deck", outing.name || outing.event_date || "Open Golf", "golf"));
  } catch (err) {
    console.warn("engagement: quick actions unavailable", err);
  }

  actions.splice(2);
  actions.push(action("#/history?photo-submit=1", "Submit a Photo", "Broadcast · Hall of Fame · or both", "camera"));
  const grid = section.querySelector(".dfl-quick-grid");
  if (grid) grid.innerHTML = actions.join("");
  section.dataset.engagementLoading = "0";
  section.dataset.engagementPainted = "1";
}

async function paintSinceAway() {
  if (!homeNow()) return;
  const home = document.getElementById("home-wrap");
  if (!home || home.dataset.engagementSinceLoading === "1" || home.dataset.engagementSincePainted === "1") return;
  home.dataset.engagementSinceLoading = "1";
  const token = ++sinceToken;
  const raw = (() => { try { return localStorage.getItem("dfl.seenAt") || ""; } catch { return ""; } })();
  const seen = raw ? new Date(raw) : null;
  if (!seen || Number.isNaN(seen.getTime())) { home.dataset.engagementSinceLoading = "0"; home.dataset.engagementSincePainted = "1"; return; }
  const floor = new Date(Math.max(seen.getTime(), Date.now() - 14 * 86400000));
  let wallCount = 0, raceCount = 0;
  try {
    const [wall, races] = await Promise.all([
      db().from("member_wall_posts").select("id", { count: "exact", head: true }).gt("created_at", floor.toISOString()),
      db().from("arena_events").select("id", { count: "exact", head: true }).gt("completed_at", floor.toISOString()),
    ]);
    wallCount = Number(wall.count || 0);
    raceCount = Number(races.count || 0);
  } catch (err) { console.warn("engagement: since-away extras unavailable", err); }
  if (token !== sinceToken || !home.isConnected) { home.dataset.engagementSinceLoading = "0"; return; }

  let strip = home.querySelector("[data-wn]");
  if (!strip && (wallCount || raceCount)) {
    const stage = home.querySelector("[data-bx-stage]")?.closest("section") || home.firstElementChild;
    const section = document.createElement("section");
    section.className = "wn";
    section.dataset.wn = "1";
    section.innerHTML = `<div class="wn-head"><svg class="ico-sm" aria-hidden="true"><use href="#i-moment"></use></svg><div><strong id="wn-title" class="wn-title">Since You Were Gone</strong><p class="dfl-since-sub">Since ${esc(sinceLabel(floor))}</p></div><button type="button" class="wn-x" data-engagement-dismiss aria-label="Dismiss what's new"><svg class="ico-sm" aria-hidden="true"><use href="#i-close"></use></svg></button></div><ul class="wn-list"></ul>`;
    stage?.after(section);
    strip = section;
  }
  if (strip) {
    const title = strip.querySelector(".wn-title");
    if (title) title.textContent = "Since You Were Gone";
    if (!strip.querySelector(".dfl-since-sub")) title?.insertAdjacentHTML("afterend", `<p class="dfl-since-sub">Since ${esc(sinceLabel(floor))}</p>`);
    const list = strip.querySelector(".wn-list");
    const extras = [];
    if (raceCount && !list?.querySelector('[data-engagement-kind="arena"]')) extras.push(`<li data-engagement-kind="arena"><a href="#/arena"><svg class="ico-sm" aria-hidden="true"><use href="#i-arena"></use></svg><span>${raceCount === 1 ? "An Arena race finished" : `${raceCount} Arena races finished`}</span></a></li>`);
    if (wallCount && !list?.querySelector('[data-engagement-kind="wall"]')) extras.push(`<li data-engagement-kind="wall"><a href="#/home"><svg class="ico-sm" aria-hidden="true"><use href="#i-moment"></use></svg><span>${wallCount === 1 ? "A new Wall post" : `${wallCount} new Wall posts`}</span></a></li>`);
    if (list && extras.length) list.insertAdjacentHTML("beforeend", extras.join(""));
    strip.querySelector("[data-engagement-dismiss]")?.addEventListener("click", () => { markSeen(new Date()); strip.remove(); }, { once: true });
  }
  home.dataset.engagementSinceLoading = "0";
  home.dataset.engagementSincePainted = "1";
}

async function paintReactions(root = document) {
  if (!homeNow()) return;
  const posts = [...root.querySelectorAll(".wall-post[data-wall-post]")];
  const ids = posts.map((p) => Number(p.dataset.wallPost)).filter(Number.isFinite);
  if (!ids.length) return;
  const signature = ids.join(",");
  const wall = root.querySelector(".wall-posts") || document.querySelector(".wall-posts");
  if (!wall || wall.dataset.reactionSignature === signature || wall.dataset.reactionsLoading === "1") return;
  wall.dataset.reactionsLoading = "1";
  const token = ++reactionToken;
  let data, error;
  try {
    ({ data, error } = await db().from("wall_reactions").select("post_id,member_id,reaction").in("post_id", ids));
  } catch (err) {
    error = err;
  } finally {
    wall.dataset.reactionsLoading = "0";
  }
  if (token !== reactionToken || !wall.isConnected) return;
  if (error) {
    if (!REACTION_SCHEMA_MISSING.test(error.message || "")) console.warn("wall reactions unavailable", error);
    return;
  }
  const me = currentMember();
  const rows = data || [];
  for (const post of posts) {
    const id = Number(post.dataset.wallPost);
    const mine = rows.find((r) => me && String(r.member_id) === String(me.id) && Number(r.post_id) === id)?.reaction || "";
    const counts = new Map(REACTIONS.map((r) => [r, 0]));
    rows.filter((r) => Number(r.post_id) === id).forEach((r) => counts.set(r.reaction, (counts.get(r.reaction) || 0) + 1));
    let bar = post.querySelector("[data-wall-reactions]");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "wall-reactions";
      bar.dataset.wallReactions = String(id);
      const actions = post.querySelector(".wall-post-actions");
      actions ? actions.before(bar) : post.appendChild(bar);
    }
    bar.innerHTML = REACTIONS.map((r) => `<button type="button" class="wall-react${mine === r ? " on" : ""}" data-wall-react="${esc(r)}" data-post="${id}" aria-label="React ${esc(r)}">${esc(r)}${counts.get(r) ? `<span class="wall-react-count">${counts.get(r)}</span>` : ""}</button>`).join("");
  }
  wall.dataset.reactionSignature = signature;
}

async function onReactionClick(event) {
  const btn = event.target.closest("[data-wall-react]");
  if (!btn) return;
  const me = currentMember();
  if (!me) return toast("Pick your member identity to react", true);
  const postId = Number(btn.dataset.post);
  const reaction = btn.dataset.wallReact;
  if (!postId || !REACTIONS.includes(reaction)) return;
  btn.disabled = true;
  try {
    const { data: mine, error: readError } = await db().from("wall_reactions").select("reaction").eq("post_id", postId).eq("member_id", me.id).maybeSingle();
    if (readError) throw readError;
    const result = mine?.reaction === reaction
      ? await db().from("wall_reactions").delete().eq("post_id", postId).eq("member_id", me.id)
      : await db().from("wall_reactions").upsert({ post_id: postId, member_id: me.id, reaction }, { onConflict: "post_id,member_id" });
    if (result.error) throw result.error;
    const wall = document.querySelector(".wall-posts");
    if (wall) wall.dataset.reactionSignature = "";
    await paintReactions(document);
  } catch (err) {
    toast(REACTION_SCHEMA_MISSING.test(err?.message || "") ? "Run engagement_home_schema.sql first" : (err.message || "Could not react"), true);
    btn.disabled = false;
  }
}

function decorate() {
  if (!homeNow()) return;
  void paintQuickActions();
  void paintSinceAway();
  void paintReactions(document);
}

ensureStyles();
document.addEventListener("click", onReactionClick);
new MutationObserver(() => decorate()).observe(document.body || document.documentElement, { childList: true, subtree: true });
window.addEventListener("hashchange", () => setTimeout(decorate, 0));
queueMicrotask(decorate);

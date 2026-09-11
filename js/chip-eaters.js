/*
  DFL Chip Eaters - profile badge only.

  The league-wide single-line Chip Eater cards were removed from History.
  This module now has one UI job: decorate an individual profile with the
  compact Chip Eater badge used by the profile and its share card.
*/
import { db } from "./supabase.js";
import { currentMember, loadMembers } from "./members.js";
import { icon } from "./icons.js";

/** The punishment history starts after 2021. */
export const FIRST_SEASON = 2022;

async function data() {
  const [leagues, standings, history, members] = await Promise.all([
    db().from("sleeper_leagues").select("season,status,last_place_user_id,last_place_locked")
      .then(r => r, () => ({ data: [], error: null }))
      .then(async r => {
        if (!r.error) return r;
        const bare = await db().from("sleeper_leagues").select("season,status");
        return { ...bare, chipColumnMissing: true };
      }),
    db().from("sleeper_standings").select("season,sleeper_user_id,team_name,rank,wins,losses,points_for"),
    db().from("history").select("id,year,category,winner,notes").eq("category", "Chip Eater"),
    loadMembers({ force: false }).then(data => ({ data, error: null })).catch(error => ({ data: [], error })),
  ]);
  const error = leagues.error || standings.error || history.error || members.error;
  if (error) throw error;
  return {
    leagues: leagues.data || [],
    standings: standings.data || [],
    manual: history.data || [],
    members: members.data || [],
  };
}

function automatic(d) {
  const bySleeper = new Map(d.members.filter(m => m.sleeper_user_id).map(m => [String(m.sleeper_user_id), m]));
  const teamNameOf = new Map(d.standings.map(s => [`${s.season}:${s.sleeper_user_id}`, s.team_name || ""]));
  return d.leagues
    .filter(l => Number(l.season) >= FIRST_SEASON && l.last_place_user_id)
    .map(l => {
      const season = Number(l.season);
      const uid = String(l.last_place_user_id);
      const m = bySleeper.get(uid);
      return {
        season,
        memberId: m?.id || null,
        name: m?.display_name || teamNameOf.get(`${season}:${uid}`) || "Unknown",
        team: teamNameOf.get(`${season}:${uid}`) || m?.team_name || "",
      };
    });
}

function chipEaters(d) {
  const auto = new Map(automatic(d).map(r => [Number(r.season), r]));
  for (const h of d.manual) {
    const y = Number(h.year);
    if (y < FIRST_SEASON || auto.has(y)) continue;
    const m = d.members.find(x =>
      String(x.display_name).toLowerCase() === String(h.winner || "").toLowerCase() ||
      String(x.team_name || "").toLowerCase() === String(h.winner || "").toLowerCase());
    auto.set(y, {
      season: y,
      memberId: m?.id || null,
      name: h.winner || m?.display_name || "Unknown",
      team: m?.team_name || "",
    });
  }
  return [...auto.values()].sort((a, b) => b.season - a.season);
}

export async function decorateChipEaters(view) {
  if (!view || !location.hash.startsWith("#/profile")) return;
  let d;
  try { d = await data(); } catch { return; }

  const wanted = new URLSearchParams(location.hash.split("?")[1] || "").get("id");
  const memberId = wanted || currentMember()?.id;
  if (!memberId) return;

  const mine = chipEaters(d).filter(r => String(r.memberId) === String(memberId));
  if (!mine.length) return;
  /*
    THE RECORD STRIP FIRST. The top card now carries debut and championships
    as a strip of figures and leaves an empty [data-chip-slot] at the end of
    it for this, because eating the chip is the same kind of fact and belongs
    beside them. The old .profile-head .row is still accepted so nothing
    breaks if a card is drawn without the slot.
  */
  const head = view.querySelector("[data-chip-slot]") || view.querySelector(".profile-head .row");
  if (!head || view.querySelector('[data-chip-eaters="badge"]')) return;

  const badge = document.createElement("span");
  badge.className = "pill warn chip-badge";
  badge.dataset.chipEaters = "badge";
  badge.innerHTML = `${icon("chilli", { size: 13 })}<span>Chip Eater${mine.length > 1 ? ` ×${mine.length}` : ""}</span>`;
  badge.title = mine.map(r => r.season).join(", ");
  head.appendChild(badge);
}

// =====================================================================
// admin_keepers.js - the keeper rules, as controls instead of a SQL editor
// ---------------------------------------------------------------------
// v1.106.0 made the keeper rules machine-readable and v1.108.0 corrected
// what they measure from. Neither gave the commissioner a way to CHANGE
// them: the only route was the Supabase SQL editor, which means the person
// who owns the rules cannot edit the rules.
//
// This is that screen and nothing more. It writes rows to `keeper_rules`
// and it does not contain one line of keeper arithmetic:
//
//   validateConfig()   decides whether what was typed is legal
//   keeperCost()       via ruleExample(), produces the worked example
//   describeRules()    produces the summary sentence
//
// all from js/keeper-rules.js, the same functions the Advisor and the entry
// sheet call. If the example on this screen ever disagrees with the
// Advisor, the bug is in one place.
//
// SEASON-AWARE, BECAUSE THE TABLE IS.
//
// One row per effective season, and the engine reads the newest row at or
// before the season it is deciding. So editing 2027 cannot change what 2026
// decided, and this screen says so out loud rather than letting somebody
// discover it. Saving an existing season EDITS it; a new season ADDS one.
//
// The human-readable Rules page is untouched. That is the league's
// constitution in prose; this is the configuration the engine reads. They
// are deliberately two different things.
// =====================================================================

import { db } from "../supabase.js";
import { esc, toast } from "../ui.js";
import { describeCostBasis, describeRules, ruleExample, validateConfig,
         COST_BASIS, DEFAULT_RULES, PROGRESSION } from "../keeper-rules.js";

/* The progression modes, with the sentence the commissioner actually reads.
   The stored strings never appear on screen. */
const PROGRESSIONS = [
  { value: PROGRESSION.FIXED_FROM_BASIS,
    label: "Fixed",
    hint: "The cost stays the same every keeper year." },
  { value: PROGRESSION.ESCALATES_PER_YEAR,
    label: "Climbs each year",
    hint: "The adjustment applies again for every extra keeper year." },
];

export async function renderKeeperRulesPanel(host) {
  host.innerHTML = `<div class="card"><div class="card-body muted">Reading the keeper rules…</div></div>`;

  const [rulesRes, leagueRes] = await Promise.all([
    db().from("keeper_rules")
      .select("effective_season, max_keeper_seasons, cost_basis, round_adjustment, progression, notes, updated_at")
      .order("effective_season", { ascending: false }),
    db().from("sleeper_leagues").select("season").order("season", { ascending: false }).limit(1),
  ]);

  /*
    THE MEMBER-ENTRY FREEZE, read here so the panel that owns the rules also
    owns the switch that closes them. Absent table = the migration has not been
    run = no member entry to freeze, so the control is simply not drawn rather
    than drawn broken.
  */
  let lockRows = null;
  try {
    const res = await db().from("keeper_season_state").select("season, member_entry_locked");
    lockRows = res.error ? null : (res.data || []);
  } catch { lockRows = null; }

  if (rulesRes.error) {
    host.innerHTML = `<div class="card"><div class="card-body">
      Keeper rules are not switched on yet. Run <strong>keeper_rules_schema.sql</strong>
      and then <strong>keeper_basis_correction.sql</strong> in the Supabase SQL editor.
      <p class="muted tiny">${esc(rulesRes.error.message || "")}</p></div></div>`;
    return;
  }

  const rows = rulesRes.data || [];
  const leagueSeason = (leagueRes.data || [])[0]?.season ?? new Date().getFullYear();
  /* The season the editor opens on: the newest configured one, because that
     is what somebody arriving here is almost always coming to change. */
  let editing = rows[0]?.effective_season ?? leagueSeason;

  const paint = () => {
    const row = rows.find((r) => Number(r.effective_season) === Number(editing));
    const draft = row || { ...DEFAULT_RULES, effective_season: editing };
    host.innerHTML = form(rows, draft, !row, leagueSeason) + lockCard(editing, lockRows);
    wire();
  };

  function readForm() {
    const f = host.querySelector("[data-kr-form]");
    return {
      effective_season: Number(f.effective_season.value),
      max_keeper_seasons: Number(f.max_keeper_seasons.value),
      round_adjustment: Number(f.round_adjustment.value),
      progression: f.progression.value,
      /* Not editable: one basis is supported and it is the league's rule.
         Shown as a read-only fact so the screen still states what the cost is
         measured from - see the field in form(). */
      cost_basis: COST_BASIS.PREVIOUS_SEASON_DRAFT_ROUND,
    };
  }

  /* The preview is the whole point of the screen: change a number, read the
     sentence, decide. Recomputed from validateConfig() on every keystroke so
     an illegal value shows its error instead of a wrong example. */
  function preview() {
    const out = host.querySelector("[data-kr-preview]");
    const errs = host.querySelector("[data-kr-errors]");
    const v = validateConfig(readForm());
    if (!v.ok) {
      out.innerHTML = `<span class="muted">—</span>`;
      errs.textContent = v.errors.join(" · ");
      return;
    }
    errs.textContent = "";
    const season = v.config.effective_season;
    const ex8 = ruleExample(v.config, { basisRound: 8, targetSeason: season });
    const ex2 = ruleExample(v.config, { basisRound: 2, targetSeason: season });
    const ex1 = ruleExample(v.config, { basisRound: 1, targetSeason: season });
    out.innerHTML = `
      <p class="kr-summary">${esc(describeRules(v.config))}</p>
      <p class="kr-example"><strong>${esc(ex8.basisSeason)} Draft R${ex8.basisRound}</strong>
        → <strong>${esc(season)} Keeper R${ex8.cost}</strong></p>
      <ul class="kr-cases">
        <li>${esc(ex2.basisSeason)} Draft R${ex2.basisRound} → ${esc(season)} Keeper R${ex2.cost}</li>
        <li>${esc(ex1.basisSeason)} Draft R${ex1.basisRound} → ${esc(season)} Keeper R${ex1.cost}
          <span class="muted tiny">R1 is the floor, always</span></li>
      </ul>
      <p class="muted tiny">${esc(ex8.text)}</p>`;
  }

  function lockCard(season, locks) {
    if (locks == null) return "";
    const locked = !!locks.find((r) => Number(r.season) === Number(season))?.member_entry_locked;
    /*
      SAID AS A CONSEQUENCE, not as a state. "Locked / unlocked" tells a
      commissioner what the flag is; what they actually need to know before
      pressing it is who stops being able to do what.
    */
    return `<section class="card"><div class="card-body">
      <h3 class="card-heading">Member entry for ${season}</h3>
      <p class="muted tiny">${locked
        ? `Closed. Members cannot choose or change their own ${season} keeper. You still can.`
        : `Open. Members can choose and change their own ${season} keeper until you close it.`}</p>
      <div class="row-end">
        <button type="button" class="btn ${locked ? "" : "danger"}" data-kr-lock="${locked ? "0" : "1"}"
                data-kr-lock-season="${season}">
          ${locked ? `Reopen ${season} for members` : `Close ${season} to members`}
        </button>
      </div>
    </div></section>`;
  }

  function wire() {
    host.querySelectorAll("[data-kr-lock]").forEach((b) => {
      b.addEventListener("click", async () => {
        const want = b.dataset.krLock === "1";
        const season = Number(b.dataset.krLockSeason);
        b.disabled = true;
        try {
          const { data, error } = await db().rpc("keeper_set_season_lock",
            { target_season: season, locked: want });
          if (error) throw error;
          /* The RPC returns the stored row, so the panel reflects what the
             database now says rather than what was asked for. */
          const saved = Array.isArray(data) ? data[0] : data;
          if (!saved) throw new Error("That was refused.");
          lockRows = [
            ...(lockRows || []).filter((r) => Number(r.season) !== season),
            { season, member_entry_locked: !!saved.member_entry_locked },
          ];
          toast(saved.member_entry_locked
            ? `${season} closed to members` : `${season} reopened for members`);
          paint();
        } catch (err) {
          b.disabled = false;
          toast(err?.message || "Could not change that", true);
        }
      });
    });

    host.querySelectorAll("[data-kr-season]").forEach((b) => {
      b.addEventListener("click", () => { editing = Number(b.dataset.krSeason); paint(); });
    });

    const form = host.querySelector("[data-kr-form]");
    form.addEventListener("input", preview);
    form.addEventListener("change", preview);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      const v = validateConfig(readForm());
      if (!v.ok) { toast(v.errors[0], true); return; }

      btn.disabled = true;
      try {
        /* Upsert on effective_season: the table's own unique key, so saving
           2026 twice edits 2026 rather than growing a duplicate. */
        const { data, error } = await db().from("keeper_rules")
          .upsert({
            effective_season: v.config.effective_season,
            max_keeper_seasons: v.config.max_keeper_seasons,
            cost_basis: v.config.cost_basis,
            round_adjustment: v.config.round_adjustment,
            progression: v.config.progression,
            updated_at: new Date().toISOString(),
          }, { onConflict: "effective_season" })
          .select("effective_season");
        if (error) throw error;
        /* RLS makes a refused write match zero rows and return a cheerful
           204, exactly as it does in golf.js - so a commissioner without a
           valid token would otherwise see "Saved" and no change. */
        if (!data || !data.length) {
          throw new Error("The database refused that write. Sign in as admin and try again.");
        }
        toast(`${v.config.effective_season} keeper rules saved`);
        await renderKeeperRulesPanel(host);
      } catch (err) {
        btn.disabled = false;
        toast(err.message || "Could not save the keeper rules", true);
      }
    });

    preview();
  }

  paint();
}

function form(rows, draft, isNew, leagueSeason) {
  const seasons = rows.map((r) => Number(r.effective_season));
  /* One tab per configured season, plus the next one along - so adding a
     future rule set is a tap rather than a number somebody has to know to
     type. */
  const next = Math.max(leagueSeason, ...(seasons.length ? seasons : [leagueSeason])) + 1;
  const tabs = [...new Set([...seasons, next])].sort((a, b) => b - a);

  return `
    <div class="card kr-card">
      <div class="card-title-row">
        <div>
          <div class="card-title">Keeper rules</div>
          <p class="muted tiny">The configuration the keeper engine reads. The
            <a href="#/rules">Rules page</a> is the league's wording; this is the maths.</p>
        </div>
        <span class="admin-badge">Admin only</span>
      </div>

      <div class="tabs kr-seasons">
        ${tabs.map((s) => `
          <button type="button" data-kr-season="${s}"
            class="${Number(s) === Number(draft.effective_season) ? "on" : ""}">${s}${
            seasons.includes(s) ? "" : " +"}</button>`).join("")}
      </div>

      <form data-kr-form class="kr-form">
        <input type="hidden" name="effective_season" value="${esc(draft.effective_season)}">

        <p class="kr-note">${isNew
          ? `Nothing is configured for <strong>${esc(draft.effective_season)}</strong> yet.
             Saving adds a new rule set that takes effect from that season.`
          : `Editing the rule set effective from <strong>${esc(draft.effective_season)}</strong>.`}
          A season is governed by the newest rule set at or before it, so changing a future
          season cannot alter a keeper already recorded.</p>

        <div class="kr-fields">
          <label class="kr-field">
            <span>Maximum keeper seasons</span>
            <input name="max_keeper_seasons" type="number" min="1" max="20" inputmode="numeric"
                   value="${esc(draft.max_keeper_seasons)}" required>
            <small class="muted tiny">How many seasons one player may be kept in total.</small>
          </label>

          <label class="kr-field">
            <span>Rounds earlier than the basis</span>
            <input name="round_adjustment" type="number" min="0" max="20" inputmode="numeric"
                   value="${esc(draft.round_adjustment)}" required>
            <small class="muted tiny">0 means the keeper costs that same round.</small>
          </label>

          <label class="kr-field">
            <span>Cost progression</span>
            <select name="progression">
              ${PROGRESSIONS.map((p) => `<option value="${p.value}" ${
                p.value === draft.progression ? "selected" : ""}>${esc(p.label)}</option>`).join("")}
            </select>
            <small class="muted tiny">${esc(PROGRESSIONS.find((p) =>
              p.value === draft.progression)?.hint || PROGRESSIONS[0].hint)}</small>
          </label>
        </div>

        <div class="kr-field is-fixed">
          <span>Cost basis</span>
          <strong>${esc(describeCostBasis(DEFAULT_RULES) || "Previous season's draft round")}</strong>
          <small class="muted tiny">A 2026 keeper is priced from that player's 2025 DFL draft
            round. This is the league's rule and the only basis the engine supports, so it is
            not editable here.</small>
        </div>

        <div class="kr-preview">
          <div class="kr-preview-head">What this means</div>
          <div data-kr-preview></div>
          <p class="kr-errors" data-kr-errors role="alert"></p>
        </div>

        <div class="row-end">
          <button class="btn" type="submit">${isNew ? "Add" : "Save"} ${esc(draft.effective_season)} rules</button>
        </div>
      </form>
    </div>`;
}

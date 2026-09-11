// =====================================================================
// profile-identity.js - earned titles, one featured receipt, one club,
// and the accent colour that carries all three.
// ---------------------------------------------------------------------
// WHERE THIS ACTUALLY SHOWS, which was the open question:
//
//   the profile page   the full set, as pills under the card title
//   a wall post        a one-line byline under the author's name, tinted
//                      with the member's own accent colour
//
// That second surface is the point. Identity that only appears on a page
// nobody visits is decoration; identity attached to the thing a member
// posts is a signature. identityByline() carries the same three facts as
// the profile pills at byline scale, each fenced by a diamond spacer so
// they read as separate items rather than one grey smear.
//
// A CHAMPIONSHIP IS THE ONE THING THAT IS NOT A MATTER OF TASTE. Only the
// title may claim a ring - achievementChoices() will not emit one - and a
// title that does gets gold and a trophy instead of the member's accent,
// on both surfaces and in every theme.
//
// WHAT EACH COLOUR MEANS, which is the whole rule:
//
//   accent    the member's own choice - a non-champion title and their
//             featured achievement. Theirs to pick, so it is theirs.
//   gold      a championship title. Not a matter of taste, so not the
//             accent. Same treatment on every surface and theme.
//   club      the favourite-team badge, in that club's own two colours as
//             a gradient. Which club somebody supports is a fact, not a
//             preference about colour.
//
// THE ACCENT IS THEIRS, NOT THE THEME'S. It is stored per member and only
// ever used to tint their own byline, badge rail and post edge. It never
// touches the app's theme tokens, so one member's taste cannot repaint
// the league's chrome for everybody else.
// =====================================================================

import { db } from "./supabase.js";
import { esc, toast } from "./ui.js";
import { refreshMember } from "./members.js";
/* Picking a club is where somebody decides they want its colours, so the
   theme switch lives beside the club rather than in a separate card. */
import { saveMode, savedMode, isTeamMode, teamModeFor, modeTeam } from "./theme.js";
import { icon } from "./icons.js";
import { nflTeams, teamCode, teamValue, teamLogo, teamName, teamColor,
         teamGradientVars } from "./nfl-teams.js";
/* The earned-choice logic lives in a db-free module so it can have a spec.
   Re-exported here because this is the import site every caller already
   knows, and moving them was a refactor, not an API change. */
import {
  ACCENTS, accentOf, isChampionTitle, titleChoices, achievementChoices,
  achievementOptions, displayAchievement, ringCount,
} from "./identity-rules.js";
export {
  ACCENTS, accentOf, isChampionTitle, titleChoices, achievementChoices,
  achievementOptions, displayAchievement, ringCount,
};

/*
  ONE TROPHY PER RING. A two-time champion gets two, a three-time gets
  three - the count is the point, and a number beside a single glyph reads
  as a label where a row of trophies reads as a record.

  They are wrapped rather than emitted loose so the row is one flex item:
  inside a pill that ellipsises a long title, three separate glyphs were
  three separate things the browser could shrink away.
*/
function rings(member, size) {
  const n = ringCount(member);
  if (!n) return "";
  return `<span class="idp-rings" aria-label="${n} championship${n === 1 ? "" : "s"}">${
    icon("trophy", { size }).repeat(n)}</span>`;
}


// ------------------------------------------------------------- display

/** The full set, as pills. The profile page's own card. */
export function profileIdentityDisplay(member) {
  const bits = [];
  const accent = accentOf(member);
  const title = member?.profile_title;
  if (title) {
    /* A ring is the one thing in here that is not a matter of taste, so it
       is the one thing that does not take the member's accent colour - it
       gets gold, and the trophy, on every theme. */
    const champ = isChampionTitle(title);
    bits.push(`<span class="idp is-title${champ ? " is-champion" : ""}">${
      champ ? rings(member, 13) : ""}<span>${esc(title)}</span></span>`);
  }
  const fav = teamName(member?.favorite_team);
  if (fav) {
    /* The club wears its OWN two colours, not the member's accent. The accent
       is for what they chose; which club they support is a fact. */
    bits.push(`<span class="idp is-team" style="${esc(teamGradientVars(member.favorite_team))}"
      >${teamLogo(member.favorite_team, { size: 18 })}<span>${esc(fav)}</span></span>`);
  }
  const feat = displayAchievement(member);
  if (feat) {
    bits.push(`<span class="idp is-feat">${icon("star", { size: 13 })}<span>${esc(feat)}</span></span>`);
  }
  if (!bits.length) return "";
  return `<div class="identity-pills" style="--ident:${esc(accent)}">${bits.join("")}</div>`;
}

/**
 * The compact byline that sits under an author's name on a wall post.
 *
 * Title, club and featured achievement - the same three facts as the
 * profile, at byline scale. The achievement is here because the small,
 * specific lines are the interesting ones to read next to somebody's
 * shit-talk; the title carries the ring on its own.
 *
 * EACH ITEM IS FENCED BY A SPACER GLYPH. Whitespace alone let "DFL
 * Champion" and "CHI" and "High week 184.2 pts" run together into one grey
 * smear at 11px. A diamond between them reads as a divider at a glance.
 * It is drawn by CSS rather than emitted here, so it is invisible to a
 * screen reader and cannot be orphaned at the start of a wrapped line.
 *
 * Returns "" when the member has set nothing, so a post from an
 * unconfigured member simply has no second line.
 */
export function identityByline(member) {
  if (!member) return "";
  const bits = [];

  const title = member.profile_title;
  if (title) {
    const champ = isChampionTitle(title);
    bits.push(`<span class="ib-title${champ ? " is-champion" : ""}">${
      champ ? rings(member, 12) : ""}<span>${esc(title)}</span></span>`);
  }

  const code = teamCode(member.favorite_team);
  if (code) {
    bits.push(`<span class="ib-team" style="${esc(teamGradientVars(member.favorite_team))}"
      >${teamLogo(member.favorite_team, { size: 14 })}<span>${esc(code)}</span></span>`);
  }

  const feat = displayAchievement(member);
  if (feat) {
    bits.push(`<span class="ib-feat">${esc(feat)}</span>`);
  }

  if (!bits.length) return "";
  /*
    NO SEPARATOR ELEMENTS. The diamond is a ::before on every item after the
    first, so it belongs to the item it precedes and wraps with it. As its
    own flex item it could be pushed onto a new line by itself, which reads
    as a bullet rather than a divider - and the byline has to be allowed to
    wrap now, because on a phone it does.
  */
  return `<span class="identity-byline">${bits.join("")}</span>`;
}

// -------------------------------------------------------------- editor

/*
  USE MY CLUB'S COLOURS AS THE APP THEME.

  This was a grid of all 32 logos in the Appearance card, which asked a
  question nobody has: somebody wants THEIR team's colours, not a browse of
  everyone else's. It belongs next to the club they just picked.

  Disabled until a club is chosen, because there is nothing to theme with -
  and it says so rather than silently doing nothing when tapped.
*/
function themeToggle(member) {
  const code = teamCode(member?.favorite_team);
  const on = isTeamMode(savedMode()) && modeTeam(savedMode())?.code === code && !!code;
  if (!code) {
    return `<p class="muted tiny ident-theme-note">Pick a club to use its colours as your app theme.</p>`;
  }
  return `<label class="ident-theme">
    <input type="checkbox" data-identity-theme${on ? " checked" : ""}>
    <span>Use these colours as my app theme</span>
  </label>
  <span class="muted tiny">A dark palette with your club's primary and secondary. Follows you to your other devices.</span>`;
}

export function identitySettingsCard(member, career, extremes, chipSeasons = []) {
  const titles = titleChoices(member, career, extremes, chipSeasons);
  const achievements = achievementOptions(member, career, extremes, chipSeasons);
  const accent = accentOf(member);
  const suggested = teamColor(member?.favorite_team);

  /* Nothing earned yet and no club chosen would leave three empty selects
     and a colour row. The club and the colour are still worth offering, so
     only the earned selects drop out. */
  const earned = titles.length || achievements.length;

  return `<div class="identity-editor" data-profile-identity-settings style="--ident:${esc(accent)}">
    <div class="ident-head">
      <span class="u-label">Identity</span>
      <span class="muted tiny">Shows on your profile and under your name on the Wall.</span>
    </div>

    ${earned ? `
    <div class="ident-grid">
      ${titles.length ? `<label class="dfl-field"><span class="u-label">Title</span>
        <select data-identity-title>
          <option value="">None</option>
          ${titles.map(x => `<option${member.profile_title === x ? " selected" : ""}>${esc(x)}</option>`).join("")}
        </select></label>` : ""}
      ${achievements.length ? `<label class="dfl-field"><span class="u-label">Featured achievement</span>
        <select data-identity-achievement>
          <option value="">None</option>
          ${achievements.map(x => `<option${member.featured_achievement === x ? " selected" : ""}>${esc(x)}</option>`).join("")}
        </select></label>` : ""}
    </div>` : `<p class="muted tiny">No titles earned yet — win something.</p>`}

    <div class="dfl-field">
      <label class="u-label" for="ident-team-select">Favourite NFL team</label>
      <div class="ident-team-row">
        <span class="ident-team-logo" data-identity-team-logo>
          ${member.favorite_team ? teamLogo(member.favorite_team, { size: 30 }) : ""}
        </span>
        <select id="ident-team-select" data-identity-team>
          <option value="">None</option>
          ${nflTeams().map(t => `<option value="${esc(teamValue(t.code))}"${
            teamCode(member.favorite_team) === t.code ? " selected" : ""}>${esc(t.name)}</option>`).join("")}
        </select>
      </div>
      ${themeToggle(member)}
    </div>

    <div class="dfl-field">
      <span class="u-label">Accent colour</span>
      <div class="ident-swatches" role="radiogroup" aria-label="Accent colour">
        ${ACCENTS.map(c => `<button type="button" class="ident-swatch${
          c.toLowerCase() === accent.toLowerCase() ? " on" : ""}" style="--sw:${esc(c)}"
          data-identity-accent="${esc(c)}" role="radio"
          aria-checked="${c.toLowerCase() === accent.toLowerCase()}"
          aria-label="Accent ${esc(c)}"></button>`).join("")}
      </div>
      ${suggested ? `<button type="button" class="linkbtn tiny" data-identity-accent="${esc(suggested)}">
        Use my team's colour</button>` : ""}
    </div>

    <div class="ident-preview">
      <span class="u-label">Preview</span>
      <div class="ident-preview-line" data-identity-preview>${
        identityByline({ ...member, accent_color: accent }) || `<span class="muted tiny">Nothing set yet</span>`
      }</div>
    </div>

    <div class="row-end"><button type="button" class="btn ghost small" data-save-profile-identity>Save identity</button></div>
  </div>`;
}

export function wireProfileIdentity(root, member, onSaved) {
  const host = root.querySelector("[data-profile-identity-settings]") || root;
  /* The draft lives here rather than on the accent buttons, because saving
     reads one value and the swatch row has twelve. */
  let accent = accentOf(member);

  const repaintPreview = () => {
    host.style.setProperty("--ident", accent);
    const slot = host.querySelector("[data-identity-preview]");
    if (!slot) return;
    const line = identityByline({
      ...member,
      profile_title: host.querySelector("[data-identity-title]")?.value || "",
      favorite_team: host.querySelector("[data-identity-team]")?.value || "",
      featured_achievement: host.querySelector("[data-identity-achievement]")?.value || "",
    });
    slot.innerHTML = line || `<span class="muted tiny">Nothing set yet</span>`;
  };

  host.addEventListener("click", (e) => {
    const swatch = e.target.closest("[data-identity-accent]");
    if (!swatch) return;
    accent = swatch.dataset.identityAccent;
    host.querySelectorAll("[data-identity-accent].ident-swatch").forEach((b) => {
      const on = b.dataset.identityAccent.toLowerCase() === accent.toLowerCase();
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
    });
    repaintPreview();
  });

  /* The club select repaints the big logo beside it as well as the preview,
     so picking a team shows the actual mark straight away. */
  host.addEventListener("change", (e) => {
    if (e.target.matches("[data-identity-team]")) {
      const slot = host.querySelector("[data-identity-team-logo]");
      if (slot) slot.innerHTML = e.target.value ? teamLogo(e.target.value, { size: 30 }) : "";
      /*
        THE THEME FOLLOWS THE CLUB. If the app is already wearing a club's
        colours and the member picks a different club, the palette moves with
        them - leaving it on the old team would be the app disagreeing with
        the badge on the same screen. Changing to "None" hands it back to the
        default rather than keeping colours for a club they dropped.
      */
      const box = host.querySelector("[data-identity-theme]");
      if (box?.checked || isTeamMode(savedMode())) {
        const next = e.target.value ? teamModeFor(teamCode(e.target.value)) : null;
        if (next) saveMode(next);
        else if (isTeamMode(savedMode())) saveMode("medicine");
      }
    }
    if (e.target.matches("[data-identity-theme]")) {
      const code = teamCode(host.querySelector("[data-identity-team]")?.value);
      if (e.target.checked && code) saveMode(teamModeFor(code));
      /* Turning it off returns to the app's default rather than to whatever
         was set before - remembering a previous palette would need a second
         piece of stored state for one checkbox. */
      else if (!e.target.checked && isTeamMode(savedMode())) saveMode("medicine");
    }
    if (e.target.matches("[data-identity-team], [data-identity-title], [data-identity-achievement]")) repaintPreview();
  });

  host.querySelector("[data-save-profile-identity]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const args = {
      target_member_id: Number(member.id),
      new_title: host.querySelector("[data-identity-title]")?.value || "",
      new_achievement: host.querySelector("[data-identity-achievement]")?.value || "",
      new_favorite_team: host.querySelector("[data-identity-team]")?.value || "",
    };
    try {
      /*
        THE ACCENT IS SENT ONLY IF THE DATABASE HAS THE COLUMN. Postgres
        resolves overloads by argument name, so calling the four-argument
        function with a fifth name is a hard "function not found" rather
        than an ignored extra. Until profile_identity_accent_schema.sql has
        been run, the save must still work for the other three fields
        instead of failing outright - so a missing-function error retries
        without the accent and says plainly why it did not stick.
      */
      let { error } = await db().rpc("profile_identity_save", { ...args, new_accent_color: accent });
      if (error && /could not find|does not exist|schema cache/i.test(error.message || "")) {
        const retry = await db().rpc("profile_identity_save", args);
        if (retry.error) throw retry.error;
        await refreshMember();
        toast("Saved — run profile_identity_accent_schema.sql to store your accent colour", true);
        await onSaved?.();
        return;
      }
      if (error) throw error;
      await refreshMember();
      toast("Identity saved");
      await onSaved?.();
    } catch (err) {
      toast(err?.message || "Could not update profile", true);
      btn.disabled = false;
    }
  });
}

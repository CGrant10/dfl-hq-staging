// =====================================================================
// nfl-teams.js - the 32 teams, their real logos and their colours.
// ---------------------------------------------------------------------
// members.favorite_team stores "nfl:KC". That is the app's own code, and
// it is what the picker and the database have always written, so it stays.
//
// THE LOGO IS THE REAL ONE. It comes from ESPN's public team-logo CDN,
// which serves every club at a stable path:
//
//     https://a.espncdn.com/i/teamlogos/nfl/500/kc.png
//
// There is no Supabase Storage in this project and no logo assets in the
// repo, so a remote image is the only way to show an actual mark rather
// than something hand-drawn that resembles one. ESPN's slug is the app's
// code lowercased for 31 of the 32; Washington is the exception, so the
// map below carries only that difference rather than all 32 rows twice.
//
// IT DEGRADES INSTEAD OF BREAKING. The <img> carries an inline onerror
// that swaps in a monogram SVG in the club's own colours, so a member
// with no signal - or a browser that blocks third-party images - sees a
// team-coloured badge rather than a broken-image glyph. sw.js caches the
// espncdn host, so a logo seen once survives going offline.
// =====================================================================

import { esc } from "./ui.js";
/* The same lift the team palettes use. A club colour is chosen for a helmet,
   not for 11px text on a card, and nine primaries are effectively black. */
import { liftForText } from "./team-theme.js";

/* code, name, short name, ESPN slug override, primary, secondary */
const TEAMS = [
  ["ARI", "Arizona Cardinals",     "Cardinals",  null,  "#97233F", "#FFB612"],
  ["ATL", "Atlanta Falcons",       "Falcons",    null,  "#A71930", "#A5ACAF"],
  ["BAL", "Baltimore Ravens",      "Ravens",     null,  "#241773", "#9E7C0C"],
  ["BUF", "Buffalo Bills",         "Bills",      null,  "#00338D", "#C60C30"],
  ["CAR", "Carolina Panthers",     "Panthers",   null,  "#0085CA", "#101820"],
  ["CHI", "Chicago Bears",         "Bears",      null,  "#0B162A", "#C83803"],
  ["CIN", "Cincinnati Bengals",    "Bengals",    null,  "#FB4F14", "#101820"],
  ["CLE", "Cleveland Browns",      "Browns",     null,  "#311D00", "#FF3C00"],
  ["DAL", "Dallas Cowboys",        "Cowboys",    null,  "#041E42", "#869397"],
  ["DEN", "Denver Broncos",        "Broncos",    null,  "#FB4F14", "#002244"],
  ["DET", "Detroit Lions",         "Lions",      null,  "#0076B6", "#B0B7BC"],
  ["GB",  "Green Bay Packers",     "Packers",    null,  "#203731", "#FFB612"],
  ["HOU", "Houston Texans",        "Texans",     null,  "#03202F", "#A71930"],
  ["IND", "Indianapolis Colts",    "Colts",      null,  "#002C5F", "#A2AAAD"],
  ["JAX", "Jacksonville Jaguars",  "Jaguars",    null,  "#101820", "#D7A22A"],
  ["KC",  "Kansas City Chiefs",    "Chiefs",     null,  "#E31837", "#FFB81C"],
  ["LV",  "Las Vegas Raiders",     "Raiders",    null,  "#101820", "#A5ACAF"],
  ["LAC", "Los Angeles Chargers",  "Chargers",   null,  "#0080C6", "#FFC20E"],
  ["LAR", "Los Angeles Rams",      "Rams",       null,  "#003594", "#FFA300"],
  ["MIA", "Miami Dolphins",        "Dolphins",   null,  "#008E97", "#FC4C02"],
  ["MIN", "Minnesota Vikings",     "Vikings",    null,  "#4F2683", "#FFC62F"],
  ["NE",  "New England Patriots",  "Patriots",   null,  "#002244", "#C60C30"],
  ["NO",  "New Orleans Saints",    "Saints",     null,  "#101820", "#D3BC8D"],
  ["NYG", "New York Giants",       "Giants",     null,  "#0B2265", "#A71930"],
  ["NYJ", "New York Jets",         "Jets",       null,  "#125740", "#FFFFFF"],
  ["PHI", "Philadelphia Eagles",   "Eagles",     null,  "#004C54", "#A5ACAF"],
  ["PIT", "Pittsburgh Steelers",   "Steelers",   null,  "#FFB612", "#101820"],
  ["SF",  "San Francisco 49ers",   "49ers",      null,  "#AA0000", "#B3995D"],
  ["SEA", "Seattle Seahawks",      "Seahawks",   null,  "#002244", "#69BE28"],
  ["TB",  "Tampa Bay Buccaneers",  "Buccaneers", null,  "#D50A0A", "#0A0A08"],
  ["TEN", "Tennessee Titans",      "Titans",     null,  "#0C2340", "#4B92DB"],
  ["WAS", "Washington Commanders", "Commanders", "wsh", "#5A1414", "#FFB612"],
];

const BY_CODE = new Map(TEAMS.map(([code, name, short, slug, primary, secondary]) =>
  [code, { code, name, short, slug: slug || code.toLowerCase(), primary, secondary }]));

/** Every team, in the order the picker should list them. */
export function nflTeams() { return TEAMS.map(([code]) => BY_CODE.get(code)); }

/** "nfl:KC" -> "KC". Tolerates a bare code, a blank and a null. */
export function teamCode(value) {
  return String(value || "").replace(/^nfl:/i, "").trim().toUpperCase();
}

/** "KC" -> "nfl:KC", which is what the database column holds. */
export function teamValue(code) {
  const hit = BY_CODE.get(String(code || "").trim().toUpperCase());
  return hit ? `nfl:${hit.code}` : "";
}

/** The whole record for a stored value, or null when there is no team set. */
export function team(value) {
  return BY_CODE.get(teamCode(value)) || null;
}

/** Full club name for a stored value, or "" - handy for alt text and titles. */
export function teamName(value) { return team(value)?.name || ""; }

/** The club's primary colour, or null. Used as an accent suggestion. */
export function teamColor(value) { return team(value)?.primary || null; }

const LOGO_BASE = "https://a.espncdn.com/i/teamlogos/nfl/500";

/** The real logo URL for a stored value, or "" when no team is set. */
export function teamLogoUrl(value) {
  const t = team(value);
  return t ? `${LOGO_BASE}/${t.slug}.png` : "";
}

/*
  THE FALLBACK IS A DATA URI, NOT A SECOND REQUEST. onerror fires because
  the network is gone or the host is blocked; asking that same network for
  a replacement image would fail the same way. A monogram built here as a
  data: URI always renders.
*/
function monogramUri(t) {
  const label = t.code.length > 3 ? t.code.slice(0, 3) : t.code;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="14" fill="${t.primary}"/>
    <text x="32" y="41" text-anchor="middle" font-family="system-ui,sans-serif"
      font-size="${label.length > 2 ? 20 : 26}" font-weight="700" fill="${t.secondary}">${label}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, " "))}`;
}

/**
 * An <img> for the club's real logo, with the monogram as its fallback.
 *
 * @param {string} value  the stored "nfl:KC"
 * @param {object} opts   size in px and an extra class name
 */
export function teamLogo(value, { size = 20, className = "" } = {}) {
  const t = team(value);
  if (!t) return "";
  const px = Number(size) || 20;
  /* The handler removes itself before swapping the src, so a fallback that
     somehow also fails cannot loop onerror forever. */
  const onerror = `this.onerror=null;this.src='${monogramUri(t)}'`;
  /* NOT loading="lazy". These are 14-30px marks and there are at most a
     dozen on a screen, so deferring them saves nothing measurable and costs
     a visible gap where the badge should be - a byline that pops in a beat
     after the name reads as a glitch. The big wall photos stay lazy. */
  return `<img class="nfl-logo${className ? ` ${esc(className)}` : ""}"
    src="${esc(teamLogoUrl(value))}" width="${px}" height="${px}"
    alt="${esc(t.name)}" title="${esc(t.name)}" decoding="async"
    onerror="${esc(onerror)}">`;
}

/*
  A CLUB'S COLOURS, READY TO BE A GRADIENT ON TEXT.

  The favourite-team badge is painted in the club's own two colours rather
  than the member's accent - the accent is for the things they chose, and a
  club is a fact. But a gradient made from the raw values is unreadable
  about a third of the time: the Raiders' #101820 on a black card, or the
  Jets' #FFFFFF on a white one.

  So both ends are lifted for the ground they will actually sit on, and BOTH
  grounds are emitted, because CSS cannot run this per theme. The stylesheet
  picks the pair it needs.

  A club whose two colours land in the same place gets a single-colour
  "gradient", which is correct - it is what that club looks like.
*/
const DARK_GROUND = "#141416";
const LIGHT_GROUND = "#ffffff";

export function teamGradientVars(value) {
  const t = team(value);
  if (!t) return "";
  const d1 = liftForText(t.primary, DARK_GROUND, 5.5) || t.primary;
  const d2 = liftForText(t.secondary, DARK_GROUND, 5.5) || t.secondary;
  const l1 = liftForText(t.primary, LIGHT_GROUND, 5.5) || t.primary;
  const l2 = liftForText(t.secondary, LIGHT_GROUND, 5.5) || t.secondary;
  return `--t1:${d1};--t2:${d2};--t1l:${l1};--t2l:${l2}`;
}

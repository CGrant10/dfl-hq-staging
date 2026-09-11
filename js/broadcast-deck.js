/* =====================================================================
   broadcast-deck.js - what the DFL is about to put on the big screen
   ---------------------------------------------------------------------
   This module answers ONE question: given everything the app knows right
   now, what should the stage show, in what order?

   It renders nothing. It has no timers. It touches no DOM. That is the
   whole point of keeping it separate: the deck can be verified in a console
   against the live database without a pixel moving.

   IT HAS NO DOMAIN OPINIONS EITHER.

   Every fact here is asked of the module that owns it:

     is golf live?          golf-battle.js  outingState()
     what are the scores?   golf-battle.js  dayPoints() / battleResult()
     is fantasy current?    lore.js         fantasyState()
     who won a season?      lore.js         leagues + namer()
     what are the records?  lore.js         moments()
     what is somebody
       called?              lore.js         namer()

   If a generator below ever needs a number that is not already computed
   somewhere else, that is a signal the calculation belongs in the domain
   module and not in here. There is no second golf scorer and no second
   fantasy-results engine in this file, and there must never be.

   TEMPORAL HONESTY IS THE HOUSE RULE.

   Every item carries a `temporal` - live, upcoming, recent, final,
   historical or none - and it comes from a resolver, never from "this row
   has the newest timestamp so it must be current". A generator that cannot
   establish its own temporal state returns nothing at all. Nothing in here
   is allowed to imply that a completed season is happening now: the
   fantasy kicker always carries the year, and a week number is only ever
   printed beside the season it belongs to.
   ===================================================================== */

import { esc, fmtDate, fmtWhen, relDate, money } from "./ui.js";
import { P, GENERATOR_LABELS, GENERATOR_BASE, generatorStanding, weightToPass } from "./broadcast-order.js";
import { LEAGUE_FOUNDED } from "./config.js";
import { db } from "./supabase.js";
import { battleResult, dayPoints, outingState, marginLabel } from "./golf-battle.js";
import { namer, moments, titleGame, fantasyState, latestPlayedWeek } from "./lore.js";
import { dayMood } from "./marquee.js";
import { factOfTheDay } from "./funfacts.js";
import { memberImage } from "./members.js";
import { artworkSettings, slideBackground, BACKGROUNDS } from "./broadcast-artwork.js";
/* The 2022 floor lives with the card, which owns the rule. Importing it
   rather than restating it is what stopped these two disagreeing. */
import { FIRST_SEASON as FIRST_CHIP_SEASON } from "./chip-eaters.js";

// --------------------------------------------------------------- priority

/*
  The ranking, and the numbers are a vocabulary rather than a calculation:
  a live event outranks a champion because the league cares more about what
  is happening than about what happened, not because 900 is bigger than 400.
*/
/*
  ===================================================================
  THE ORDERING RULE. Four knobs, one job each. If you are about to add
  a fifth, change one of these instead.

    automatic priority   WHAT SHOULD BE SHOWN. The context engine ranks
                         league data by how much it matters right now. No
                         human input, no stored order. Untouched by 1.5.

    sort_order           The commissioner's running order, and it is only
                         ever compared MANUAL against MANUAL. It does not
                         reach automatic content and cannot promote a
                         slide past a live game.

    weight               Where the manual BLOCK sits relative to automatic
                         content. Default 0 puts hand-written slides just
                         below anything live and above everything else.
                         This is the only knob that crosses the streams.

    featured             Pin to the very front of the deck, ahead of
                         everything including live. For the one slide that
                         must be seen first; not a sorting mechanism.

  So: automatic content is ranked, manual content is ordered, weight
  decides where the two meet, and featured is an override. The order a
  commissioner sets survives ranking because equal weights preserve the
  query order (sort is stable) and diversify() refuses to swap manual
  items past each other.
  ===================================================================
*/


/*
  How long each treatment sits on screen.

  These came down in 1.5. The first cut ran 5-9s and the deck took nearly a
  minute to come round; a broadcast that makes you wait to see the next
  thing reads as slow rather than as calm. The floor is 5s because that is
  roughly the shortest a person can read a headline and a figure without
  feeling hurried, and announcement keeps the longest slot because it is
  the only treatment with a paragraph in it.

  A manual slide may override this - see dwellMs(). Automatic slides do
  not, because there is nobody to ask.
*/
/*
  FASTER, AND STILL NOT THE SAME FOR EVERY TREATMENT.

  Every slot came down by about a third on the commissioner's read that the
  rotation felt slow. The RELATIVE order is unchanged and is the part that
  matters: announcement keeps the longest slot because it is the only treatment
  with a paragraph in it, and stat/event keep the shortest because they are one
  figure and a date.

  The floor is the entrance animation, and shortening THAT is what let these
  come down. Press is ~380ms, ~490 with its stagger, where the old staggered
  rise was ~700ms - so a 3s slot now spends a sixth of its life arriving rather
  than a quarter, and 3s reads as a held slide again, which it did not before.

  Announcements keep the longest slot because they are the only treatment with
  a sentence to finish reading rather than a name to recognise.
*/
export const DWELL = {
  scoreboard: 3600,
  champion:   3600,
  announcement: 4200,
  event:      3000,
  stat:       3000,
  hero:       3600,
};

/** Seconds a commissioner may choose, matching the CHECK in the migration. */
export const DWELL_MIN = 3;
export const DWELL_MAX = 15;

/** A stored per-slide dwell, clamped, or the treatment default. */
export function dwellMs(seconds, treatment) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return DWELL[treatment] || 6000;
  return Math.min(DWELL_MAX, Math.max(DWELL_MIN, Math.round(n))) * 1000;
}

const DAY = 86400000;

/* Decay rather than a cliff: a nine-day-old announcement should still
   outrank the record book, just not by as much as it did on day one. */
const decay = (ageDays, windowDays) =>
  Math.max(0.4, 1 - Math.max(0, ageDays) / windowDays);

const daysBetween = (a, b) => (a - b) / DAY;

function item(o) {
  return {
    source: "auto",
    temporal: "none",
    dwell: DWELL[o.treatment] || 6000,
    /* Automatic slides use the house look. Only a hand-written slide can
       choose, because only a hand-written slide has somebody to choose. */
    background: "default",
    logo: "default",
    kicker: "", headline: "", subtitle: "", body: "",
    image: null, href: null, sides: null, figure: null,
    ...o,
  };
}

// ------------------------------------------------------------- the context

/**
 * Everything the generators are allowed to read, gathered once.
 *
 * `home` is the shape pages/home.js already fetches, passed in rather than
 * re-queried - the stage lives on that page and there is no reason for the
 * same rows to cross the network twice.
 *
 * `lore` may be null. That is the two-phase load: the stage paints from
 * home's own data immediately, and history items join the deck when
 * loadLore() lands. Nothing waits.
 */
export function broadcastContext({ home, lore = null, golfDay = null, member = null, now = Date.now() }) {
  const leagues = lore?.leagues || home?.leagues || [];
  return {
    now,
    member,
    lore,
    name: lore ? namer(lore) : null,
    events: home?.events || [],
    announcements: home?.announcements || [],
    polls: home?.polls || [],
    members: home?.members || [],
    standings: home?.standings || [],
    dues: home?.dues || [],
    leagues,
    golfRow: home?.golfRow || null,
    golfDay,                                   // rounds+battles, or null
    fantasy: lore ? fantasyState(lore, now) : null,
    seasonNumber: new Date(now).getFullYear() - LEAGUE_FOUNDED + 1,
  };
}

/**
 * The golf day, in the shape dayPoints() and outingState() both expect.
 *
 * Same five reads pages/home.js golfHero() performs. When the stage
 * replaces that hero, home stops doing its own copy and this becomes the
 * only one - the duplication is deliberate and temporary so that step 2
 * changes nothing on screen.
 */
/*
  THE HAND-WRITTEN SLIDES.

  Everything else in this file is derived from league data. These are the
  ones a commissioner typed, and they are the only rows on the front page
  that no generator can produce.

  It returns [] rather than throwing when anything at all goes wrong -
  including the table not existing yet, which is the state every install is
  in until broadcast_items_schema.sql has been run. A front page that breaks
  because an optional feature has no table is a worse front page than one
  with no hand-written slides on it.

  THE WINDOW IS APPLIED HERE, IN THE BROWSER, against the reader's own
  clock, so a slide scheduled for 7pm appears at 7pm where the reader is.
  The database is only asked for the active rows.
*/
export async function loadBroadcastItems(now = new Date()) {
  try {
    const { data, error } = await db()
      .from("broadcast_items")
      .select(BROADCAST_COLUMNS)
      .eq("active", true)
      /* THE RUNNING ORDER, and it is this query that decides it - the
         ranking below only decides where the manual BLOCK sits against
         automatic content, never how manual slides sit against each
         other. See ORDERING RULE above. */
      .order("featured", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) {
      /* 42703 is "column does not exist" - this install has the table but
         not the 1.5 migration. Fall back to the columns that shipped with
         the table rather than showing nothing. */
      if (error.code === "42703") return loadBroadcastItemsAt(BROADCAST_COLUMNS_NO_ZOOM, now);
      return [];
    }
    const t = now.getTime();
    return (data || [])
      .filter((r) => !r.starts_at || new Date(r.starts_at).getTime() <= t)
      .filter((r) => !r.ends_at   || new Date(r.ends_at).getTime()   >  t)
      .map(manualItem);
  } catch (err) {
    console.warn("broadcast: manual items unavailable", err);
    return [];
  }
}

/*
  THE COLUMN SETS, NEWEST FIRST.

  Postgres answers 42703 - "column does not exist" - for the whole query when
  one column is missing, so an install that is a migration behind gets nothing
  at all rather than a slide without its zoom. Each entry below is what the
  table looked like after one migration, and the loader walks down until one
  answers. Adding a column to the front of this list is the whole cost of
  shipping ahead of a migration.
*/
export const BROADCAST_COLUMNS =
  "id,treatment,kicker,headline,subtitle,body,figure,image,href,temporal,weight,featured," +
  "starts_at,ends_at,sort_order,dwell_seconds,background,created_at,logo_opacity," +
  "image_fit,image_position_x,image_position_y,image_zoom";

/** The 1.5 set: everything above except the crop tool's zoom. */
const BROADCAST_COLUMNS_NO_ZOOM = BROADCAST_COLUMNS.replace(",image_zoom", "");

/** The pre-1.5 column set, for an install that has not run the migration. */
const BROADCAST_COLUMNS_PRE_15 =
  "id,treatment,kicker,headline,subtitle,body,figure,image,href,temporal,weight,featured,starts_at,ends_at";

/** One more try, a migration further back. Returns [] once there is nowhere left. */
async function loadBroadcastItemsAt(columns, now) {
  const { data, error } = await db()
    .from("broadcast_items")
    .select(columns)
    .eq("active", true)
    .order("featured", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) {
    if (error.code === "42703" && columns !== BROADCAST_COLUMNS_PRE_15) {
      return loadBroadcastItemsAt(BROADCAST_COLUMNS_PRE_15, now);
    }
    return [];
  }
  const t = now.getTime();
  return (data || [])
    .filter((r) => !r.starts_at || new Date(r.starts_at).getTime() <= t)
    .filter((r) => !r.ends_at   || new Date(r.ends_at).getTime()   >  t)
    .map(manualItem);
}

/*
  Exported so the Admin preview draws a row through the SAME mapping the
  front page uses. If the preview built its own item shape it would drift
  the first time a field was added, and the whole point of the preview is
  that it is not a separate opinion about what a slide looks like.
*/
export const renderItemFromRow = (r) => manualItem(r);

function manualItem(r) {
  const treatment = r.treatment || "announcement";
  return item({
    source: "manual",
    id: `manual:${r.id}`,
    rowId: r.id,
    /* Carried for What's New, which asks "what changed since I last
       looked" - it is not used by the stage. */
    createdAt: r.created_at || null,
    treatment,
    temporal: r.temporal || "none",
    kicker: r.kicker || "", headline: r.headline || "",
    subtitle: r.subtitle || "", body: r.body || "",
    figure: r.figure || null, image: r.image || null, href: r.href || null,
    /* Presentation, carried through to the stage untouched. An unknown
       value degrades to the house look rather than to a blank slide. */
    background: slideBackground(r),
    ...artworkSettings(r),
    /* How strong the crest behind this slide should be. Unknown or absent
       means "default", so an install without the column behaves exactly as
       it did before. */
    logo: LOGO_STEPS.has(r.logo_opacity) ? r.logo_opacity : "default",
    dwell: dwellMs(r.dwell_seconds, treatment),
    /*
      weight is a nudge inside the band, not a replacement for it, so a
      manual slide cannot accidentally outrank a live game unless an admin
      deliberately weights it past 100. It deliberately does NOT encode
      sort_order: two slides at the same weight keep the order the query
      returned them in, because Array.prototype.sort is stable - which is
      exactly how the commissioner's running order survives ranking.
    */
    priority: (r.featured ? P.FEATURED : P.MANUAL) + (Number(r.weight) || 0),
  });
}

/*
  PRESENTATION OVERRIDES FOR AUTOMATIC SLIDES.

  A commissioner can already write a slide by hand and can already switch
  a source off. This is the middle: leave the golf slide on, generated
  from live data, but give it a picture and a different plate.

  KEYED BY GENERATOR ID - the same key the on/off switches use. One row
  per source at most. Deliberately coarse: a per-item override would need
  a stable id for something regenerated from live data on every load, and
  there is no such id.

  PRESENTATION ONLY, ENFORCED HERE AS WELL AS IN THE SCHEMA. Nothing in
  this path can touch headline, subtitle, body, sides or temporal. If an
  admin could retype the headline, the stage could say something the data
  does not - and temporal honesty would become a suggestion.

  Returns an empty Map on any failure, including the table not existing,
  which is every install until broadcast_v2_schema.sql is run.
*/
export async function loadBroadcastOverrides() {
  try {
    const { data, error } = await db()
      .from("broadcast_overrides")
      .select("generator,treatment,background,image,dwell_seconds,featured,weight");
    if (error) return new Map();
    return new Map((data || []).map((r) => [r.generator, r]));
  } catch (err) {
    console.warn("broadcast: overrides unavailable", err);
    return new Map();
  }
}

/*
  Apply one override to one generated item.

  THE TREATMENT GUARD IS THE INTERESTING PART. A treatment is not just a
  look - scoreboard needs `sides` and stat reads better with a `figure`.
  Forcing "scoreboard" onto a slide that has no sides would render an
  empty tale of the tape, so a treatment that the item cannot support is
  ignored rather than obeyed. The admin sees no change, which is the
  correct outcome: the alternative is a blank scoreboard on the front page.
*/
function applyOverride(it, ov) {
  if (!ov) return it;
  const out = { ...it };

  if (ov.treatment && ov.treatment !== it.treatment) {
    const wants = ov.treatment;
    const canScore = Array.isArray(it.sides) && it.sides.length === 2;
    if (wants !== "scoreboard" || canScore) {
      out.treatment = wants;
      /* Dwell follows the treatment unless the override sets one, or a
         6-second announcement keeps a 5-second stat's clock. */
      out.dwell = DWELL[wants] || out.dwell;
    }
  }
  if (ov.image) { out.image = ov.image; out.background = ov.background || "image"; }
  else if (ov.background && BACKGROUNDS.has(ov.background)) out.background = ov.background;

  if (ov.dwell_seconds) out.dwell = dwellMs(ov.dwell_seconds, out.treatment);
  if (ov.featured) out.priority = P.FEATURED + (Number(ov.weight) || 0);
  else if (ov.weight) out.priority = (Number(it.priority) || 0) + Number(ov.weight);
  return out;
}

/** Watermark strengths a slide may choose. Words, not numbers - see the SQL. */
export const LOGO_STEPS = new Set(["default", "subtle", "faint", "hidden"]);

/* BACKGROUNDS and the picture rule live in broadcast-artwork.js, which has
   no database import and so can be tested. Re-exported because this module
   is where the deck's vocabulary is documented. */
export { BACKGROUNDS };

export async function loadGolfDay(outingId) {
  const [roundsRes, matchesRes, teamsRes] = await Promise.all([
    db().from("golf_rounds").select("id,round_number,name,format,holes,scoring")
        .eq("outing_id", outingId).order("round_number"),
    db().from("golf_matches").select("id,round_id").eq("outing_id", outingId),
    db().from("golf_teams").select("id,name,color,sort_order").eq("outing_id", outingId).order("sort_order"),
  ]);
  if (roundsRes.error || matchesRes.error || teamsRes.error) return null;

  const matchIds = (matchesRes.data || []).map((m) => m.id);
  let sides = [], scores = [];
  if (matchIds.length) {
    const s = await db().from("golf_match_sides").select("id,match_id,team_id,slot").in("match_id", matchIds);
    if (s.error) return null;
    sides = s.data || [];
    if (sides.length) {
      const sc = await db().from("golf_match_scores").select("side_id,hole,strokes")
                   .in("side_id", sides.map((x) => x.id));
      scores = sc.error ? [] : (sc.data || []);
    }
  }

  const byHole = new Map();
  for (const row of scores) {
    const k = String(row.side_id);
    if (!byHole.has(k)) byHole.set(k, new Map());
    byHole.get(k).set(Number(row.hole), Number(row.strokes));
  }

  const rounds = (roundsRes.data || []).map((round) => ({
    round,
    battles: (matchesRes.data || [])
      .filter((m) => String(m.round_id) === String(round.id))
      .map((m) => {
        const mine = sides.filter((s) => String(s.match_id) === String(m.id))
                          .sort((a, b) => a.slot - b.slot);
        return {
          sides: mine,
          result: mine.length === 2
            ? battleResult(byHole.get(String(mine[0].id)) || new Map(),
                           byHole.get(String(mine[1].id)) || new Map(),
                           Number(round.holes) || 9,
                           round.scoring === "match" ? "match" : "strokes")
            : null,
        };
      }),
  }));

  return { rounds, teams: teamsRes.data || [] };
}

// ---------------------------------------------------------- the generators
//
// Every one is (ctx) => item[]. An empty array is the correct answer far
// more often than not, and it is how sparse data degrades into a shorter
// deck rather than into a broken screen.

function golfItems(ctx) {
  const o = ctx.golfRow;
  if (!o) return [];
  const day = ctx.golfDay;
  const st = outingState(o, day?.rounds || []);
  /* The tee time belongs on the stage as much as on the golf page -
     "Hawktree · Sat, Aug 29 · 8:30 AM" is the whole answer to "when is
     golf", which is what somebody opening the front page is asking. */
  const when = o.event_date ? fmtWhen(o.event_date, o.event_time) : "";
  const sub = [o.course, when].filter(Boolean).join(" · ");
  const href = `#/golf?id=${o.id}`;

  /* Two teams and a points total is the only shape that can be a
     scoreboard. Anything else - four teams, none set up - is an event. */
  const teams = day?.teams?.length === 2 ? day.teams : null;
  if (teams && (st.state === "live" || st.state === "complete" || st.state === "final")) {
    const { total } = dayPoints(day.rounds);
    const values = teams.map((t) => total.get(String(t.id)) || 0);
    const leaderIdx = values[0] === values[1] ? -1 : (values[0] > values[1] ? 0 : 1);
    return [item({
      kind: "golf", treatment: "scoreboard",
      temporal: st.state === "live" ? "live" : st.state === "final" ? "final" : "recent",
      priority: st.state === "live" ? P.LIVE : P.RECENT,
      kicker: o.name, headline: "DFL Golf", subtitle: sub, href,
      sides: teams.map((t, i) => ({
        name: t.name || "Team", score: values[i], colour: t.color || "",
        up: leaderIdx === i, down: leaderIdx > -1 && leaderIdx !== i,
      })),
      /* The day's mood when the numbers have earned one, the count when they
         have not. dayMood() only speaks if a real gap justifies it. */
      /* moodText is the drama slot and dayMood() only speaks when a real gap
         justifies it; whereText is the fact underneath. */
      moodText: dayMood(values, st.decided, st.total),
      whereText: `${st.decided} of ${st.total} decided`,
    })];
  }

  // Not scoreable yet: it is a date on the calendar.
  return [item({
    kind: "golf", treatment: "event", temporal: "upcoming", priority: P.UPCOMING,
    kicker: "DFL Golf", headline: o.name, subtitle: sub, href,
    body: o.event_date ? relDate(o.event_date) : "",
  })];
}

function fantasyItems(ctx) {
  const f = ctx.fantasy;
  if (!f || f.state === "none" || !ctx.lore) return [];

  /* UPCOMING seasons get a season card and NEVER a week number - there is
     no week to have an opinion about before a draft. */
  if (f.state === "upcoming") {
    return [item({
      /* Weaker than a dated event on purpose: "we have not drafted" is a
         state of affairs, and a real date on the calendar beats it. */
      kind: "fantasy", treatment: "event", temporal: "upcoming", priority: P.UPCOMING - 120,
      kicker: "DFL Fantasy", headline: `${f.season} Season`,
      subtitle: f.status === "drafting" ? "Drafting now" : "Not drafted yet",
      href: "#/history",
    })];
  }

  /*
    The title game of the newest completed season. This is the honest
    "recent fantasy result": it names the season and the week, and it is
    labelled FINAL rather than dressed up as this week's game.
  */
  const t = titleGame(ctx.lore, f.season);
  if (t && ctx.name) {
    const champ = ctx.name(t.champUser, t.season, t.champRoster);
    const runner = ctx.name(t.runnerUser, t.season, t.runnerRoster);
    return [item({
      kind: "fantasy", treatment: "scoreboard",
      temporal: f.state === "live" ? "live" : "final",
      priority: f.state === "live" ? P.LIVE : P.RECENT * decay(
        daysBetween(ctx.now, Date.parse(ctx.lore.syncedAt || 0) || ctx.now), 120),
      kicker: `${t.season} · Week ${t.week}`,
      headline: "The final",
      moodText: "", whereText: `${champ.label} by ${t.margin.toFixed(2)}`,
      href: "#/history",
      sides: [
        { name: champ.label, score: t.champScore.toFixed(2), up: true },
        { name: runner.label, score: t.runnerScore.toFixed(2), down: true },
      ],
    })];
  }
  return [];
}

/* The viewer's own most recent matchup. Dated, always. */
function myMatchupItem(ctx) {
  if (!ctx.member || !ctx.lore || !ctx.name) return [];
  const me = ctx.members.find((m) => String(m.id) === String(ctx.member.id));
  const uid = me?.sleeper_user_id;
  if (!uid) return [];

  /* The newest season that has actually been PLAYED, not simply the newest
     season on record. 2026 exists and is pre-draft, so asking for "the
     latest season" gets a year with no games in it and this returns nothing
     - which is honest but useless. The last week somebody actually played is
     a real result worth showing, and the kicker carries its year so nobody
     mistakes it for this week. */
  const seasons = [...new Set(ctx.leagues.map((l) => Number(l.season) || 0))]
    .sort((a, b) => b - a);
  let season = 0, week = 0;
  for (const y of seasons) {
    const w = latestPlayedWeek(ctx.lore, y);
    if (w) { season = y; week = w; break; }
  }
  if (!season || !week) return [];

  const row = ctx.lore.matchups.find((m) =>
    Number(m.season) === season && Number(m.week) === week &&
    (String(m.user1) === String(uid) || String(m.user2) === String(uid)));
  if (!row) return [];

  const iAmOne = String(row.user1) === String(uid);
  const mine  = { u: iAmOne ? row.user1 : row.user2, r: iAmOne ? row.roster1 : row.roster2,
                  s: Number(iAmOne ? row.score1 : row.score2) || 0 };
  const theirs = { u: iAmOne ? row.user2 : row.user1, r: iAmOne ? row.roster2 : row.roster1,
                   s: Number(iAmOne ? row.score2 : row.score1) || 0 };

  /* Only the season fantasyState() is actually talking about can be live.
     A 2025 result is FINAL even while 2026 is in season. */
  const state = (ctx.fantasy?.state === "live" && ctx.fantasy.season === season) ? "live" : "final";
  return [item({
    kind: "mine", treatment: "scoreboard", temporal: state,
    priority: P.MINE,
    kicker: `${season} · Week ${week}`,
    headline: "Your matchup",
    moodText: "",
    whereText: mine.s === theirs.s ? "Tied"
      : `${mine.s > theirs.s ? "You" : ctx.name(theirs.u, season, theirs.r).label} by ${Math.abs(mine.s - theirs.s).toFixed(2)}`,
    href: "#/profile",
    sides: [
      { name: ctx.name(mine.u, season, mine.r).label, score: mine.s.toFixed(2), up: mine.s > theirs.s, down: mine.s < theirs.s },
      { name: ctx.name(theirs.u, season, theirs.r).label, score: theirs.s.toFixed(2), up: theirs.s > mine.s, down: theirs.s < mine.s },
    ],
  })];
}

function eventItems(ctx) {
  const out = [];
  const today = new Date(ctx.now).toISOString().slice(0, 10);
  for (const e of ctx.events) {
    if (!e.event_date) continue;
    const days = Math.round(daysBetween(Date.parse(e.event_date + "T12:00:00"), ctx.now));
    if (days < 0) continue;                       // eventList already shows past ones
    const isToday = e.event_date === today;
    out.push(item({
      kind: "event", treatment: "event",
      temporal: isToday ? "live" : "upcoming",
      priority: isToday ? P.LIVE : (days <= 7 ? P.UPCOMING + 50 : P.UPCOMING) * decay(0, 1),
      kicker: isToday ? "Today" : "Next up",
      /* The time, when there is one, belongs on the broadcast too -
         "Sat, Aug 29 · 7:00 PM" is the whole point of storing it. */
      headline: e.title, subtitle: fmtWhen(e.event_date, e.event_time),
      body: e.description || relDate(e.event_date),
      href: "#/calendar",
    }));
  }
  return out.slice(0, 2);
}

function pollItem(ctx) {
  const p = (ctx.polls || [])[0];
  if (!p) return [];
  return [item({
    kind: "poll", treatment: "stat", temporal: "live", priority: P.ACTIVITY,
    kicker: "Open poll", figure: String(ctx.polls.length),
    headline: ctx.polls.length === 1 ? "Poll open" : "Polls open",
    subtitle: p.question, href: "#/polls",
  })];
}

function newsItem(ctx) {
  const a = (ctx.announcements || [])[0];
  if (!a) return [];
  const age = daysBetween(ctx.now, Date.parse(a.created_at) || ctx.now);
  if (age > 21) return [];
  return [item({
    kind: "news", treatment: "announcement", temporal: "recent",
    priority: P.ACTIVITY * decay(age, 21),
    kicker: "From the commissioner", headline: a.title || "Announcement",
    body: a.content || "", subtitle: fmtDate(a.created_at), href: "#/home",
  })];
}

/* The current champion. Always eligible - league identity does not expire
   because something else is happening today. */
/* A member's broadcast picture, or nothing. namer() hands back the member
   id it resolved, which is the only reliable link from a Sleeper user to a
   DFL member - team names change and accounts get deleted. */
function pictureOf(ctx, memberId) {
  if (!memberId) return null;
  const m = (ctx.members || []).find((x) => String(x.id) === String(memberId));
  return memberImage(m, "broadcast");
}

function championItem(ctx) {
  if (!ctx.name) return [];
  const l = ctx.leagues.find((x) => x.champion_user_id || x.champion_roster_id);
  if (!l) return [];
  const who = ctx.name(l.champion_user_id, l.season, l.champion_roster_id);
  const orphan = !who.memberId && who.sub === "account deleted" && /^Roster \d+$/.test(who.label);
  /* A champion with a broadcast picture gets it behind them. Falls all the
     way back to no image, in which case the champion treatment draws the
     crest as it always has. */
  const art = pictureOf(ctx, who.memberId);
  return [item({
    kind: "champion", treatment: "champion", temporal: "final", priority: P.CHAMPION,
    kicker: `${l.season} DFL Champion`,
    headline: orphan ? `The ${l.season} champion` : who.label,
    subtitle: orphan ? `${who.label} — the Sleeper account was deleted` : (who.sub || ""),
    ...(art ? { image: art, background: "image" } : {}),
    href: "#/history",
  })];
}

function pastChampionItems(ctx) {
  if (!ctx.name) return [];
  const withChamps = ctx.leagues.filter((l) => l.champion_user_id || l.champion_roster_id);
  return withChamps.slice(1, 4).map((l) => {
    const who = ctx.name(l.champion_user_id, l.season, l.champion_roster_id);
    const art = pictureOf(ctx, who.memberId);
    return item({
      kind: "past", treatment: "champion", temporal: "historical", priority: P.HISTORY,
      kicker: `${l.season} Champion`, headline: who.label, subtitle: who.sub || "",
      ...(art ? { image: art, background: "image" } : {}),
      href: "#/history",
    });
  });
}

/*
  THE CHIP EATER, AND THERE IS EXACTLY ONE.

  This has been in twice and out once. The history is the argument:

    v1.109.48  added as TWO slides, alongside the champions
    v1.109.52  removed entirely, because two of eight slides spent a quarter of
               the front page retelling what the Chip Eaters card already says
    here       back as ONE slide, the most recent season only

  One is the number that was actually wanted both times. The complaint was
  never that the Chip Eater appeared - it was that the whole history appeared,
  which is the card's job. The current holder is news; 2022 is an archive.

  It reads last_place_user_id straight from ctx.leagues, which is where a
  commissioner's manual correction lands too (see season-result.js), so naming
  the right person on the History page fixes this slide at the same time.
*/
function chipEaterItem(ctx) {
  if (!ctx.name) return [];
  const l = (ctx.leagues || [])
    .filter((x) => x.last_place_user_id && Number(x.season) >= FIRST_CHIP_SEASON)
    .sort((a, b) => Number(b.season) - Number(a.season))[0];
  if (!l) return [];
  const who = ctx.name(l.last_place_user_id, l.season, null);
  const art = pictureOf(ctx, who.memberId);
  return [item({
    kind: "chip", treatment: "champion", temporal: "historical", priority: P.HISTORY + 10,
    /* The champion treatment's layout, but not its ceremony: variant swaps the
       trophy for a medal and the gold rule for a plain one. Coming last is
       worth a slide; it is not worth a gold rule. */
    variant: "chip", icon: "i-medal",
    kicker: `${l.season} Chip Eater`,
    headline: who.label,
    /* The sub is the team name when there is one; the hot chip is the point
       and it goes in the kicker, so this line stays factual. */
    subtitle: who.sub || "",
    ...(art ? { image: art, background: "image" } : {}),
    href: "#/history",
  })];
}


function recordItems(ctx) {
  if (!ctx.lore) return [];
  const picks = moments(ctx.lore)
    .filter((m) => ["high", "blowout", "nailbiter", "streak", "heartbreak"].includes(m.kind))
    .slice(0, 3);
  return picks.map((m) => item({
    kind: "record", treatment: "stat", temporal: "historical", priority: P.HISTORY,
    kicker: m.kind === "high" ? "Highest week ever" : "From the record book",
    figure: m.figure != null ? String(m.figure).slice(0, 7) : null,
    headline: m.headline, subtitle: m.detail, href: "#/history",
  }));
}

function seasonStatItem(ctx) {
  return [item({
    kind: "season", treatment: "stat", temporal: "none", priority: P.STAT,
    figure: String(ctx.seasonNumber), headline: "Seasons",
    kicker: "DFL", subtitle: `${LEAGUE_FOUNDED} → ${new Date(ctx.now).getFullYear()}`,
    href: "#/history",
  })];
}

function duesItem(ctx) {
  const season = (ctx.dues || []).reduce((a, r) => Math.max(a, Number(r.season) || 0), 0);
  const owed = (ctx.dues || []).filter((r) => Number(r.season) === season)
    .reduce((t, r) => t + Math.max(0, (Number(r.amount_due) || 0) - (Number(r.amount_paid) || 0)), 0);
  if (!owed) return [];
  return [item({
    kind: "dues", treatment: "stat", temporal: "none", priority: P.STAT - 50,
    figure: money(owed), headline: "Owed", kicker: "League fees", href: "#/finances",
  })];
}

function loreItems(ctx) {
  const rows = (ctx.lore?.manual || []).filter((h) => /moment|award|record/i.test(h.category || ""));
  return rows.slice(0, 2).map((h) => item({
    kind: "lore", treatment: "announcement", temporal: "historical", priority: P.HISTORY,
    kicker: `${h.year} · ${h.category}`, headline: h.winner || h.category,
    body: h.notes || "", href: "#/history",
  }));
}

function arenaItem(ctx) {
  const results = ctx.lore?.arenaResults || [];
  const events = ctx.lore?.arenaEvents || [];
  const byMember = new Map((ctx.members || []).map((m) => [String(m.id), m]));
  for (const ev of events) {
    const w = results.find((r) => String(r.event_id) === String(ev.id) && r.place === 1);
    if (!w) continue;
    const m = byMember.get(String(w.member_id));
    return [item({
      kind: "arena", treatment: "champion", temporal: "historical", priority: P.HISTORY,
      kicker: "DFL Arena", headline: m?.display_name || "Somebody",
      subtitle: ev.name || "", href: `#/arena?id=${ev.id}`,
    })];
  }
  return [];
}

/*
  TODAY'S FUN FACT.

  The same fact the Fun Facts page is showing, because it comes from the
  same function - factOfTheDay() is deterministic from the date, so the
  stage and the page cannot disagree about what today's fact is.

  temporal is "historical" and that is not a formality: every one of these
  is a record from a finished season, and a bare "0.04 points" with no year
  on it reads as something that happened this week.
*/
function funFactItem(ctx) {
  if (!ctx.lore) return [];
  const f = factOfTheDay(ctx.lore, new Date(ctx.now));
  if (!f) return [];
  return [item({
    kind: "fact", treatment: "announcement", temporal: "historical",
    priority: P.HISTORY + 20,
    kicker: "Did you know?",
    headline: f.headline,
    body: f.detail,
    subtitle: f.season ? String(f.season) : "",
    href: "#/facts",
  })];
}

/* THE FLOOR. Returns an item unconditionally, which is what makes an empty
   deck impossible and the "sparse database" case a shorter show rather than
   a broken screen. */
function identityItem(ctx) {
  const n = ctx.seasonNumber;
  const decade = n > 1 && n % 10 === 0;
  return [item({
    kind: "identity", treatment: "hero", temporal: "none", priority: P.IDENTITY,
    kicker: decade ? `${n}th Anniversary Season` : "DFL HQ",
    headline: "Draft · Golf · Sin · Fold",
    subtitle: "Forged by sinners. Fueled by rivalries.",
    href: "#/history",
  })];
}

export const GENERATORS = [
  ["golf", golfItems],
  ["fantasy", fantasyItems],
  ["myMatchup", myMatchupItem],
  ["events", eventItems],
  ["poll", pollItem],
  ["news", newsItem],
  ["champion", championItem],
  ["pastChampions", pastChampionItems],
  ["chipEater", chipEaterItem],
  ["records", recordItems],
  ["seasonStat", seasonStatItem],
  ["dues", duesItem],
  ["lore", loreItems],
  ["arena", arenaItem],
  ["funfact", funFactItem],
  ["identity", identityItem],
];

/*
  What each generator is called in the admin panel, and what turning it off
  actually costs. Written here, next to the generators themselves, so a new
  generator cannot be added without a name - the panel lists these, not the
  raw ids.

  identity is deliberately absent. It is the floor buildDeck() falls back to
  when everything else is empty, so offering a switch for it would offer a
  blank front page.
*/


/* Ordering constants and helpers live in js/broadcast-order.js so they can be
   tested - this file reads the database and therefore cannot be. Re-exported so
   every existing importer keeps working. */
export { P, GENERATOR_LABELS, GENERATOR_BASE, generatorStanding, weightToPass };

// ------------------------------------------------------------------- deck

/**
 * Rank everything and take the top slice.
 *
 * @param {object} ctx        from broadcastContext()
 * @param {object} [opts]
 * @param {Set}    [opts.off] generator ids the commissioner has switched off
 * @param {number} [opts.max] deck size
 */
export function buildDeck(ctx, { off = new Set(), max = 8, custom = [], overrides = new Map() } = {}) {
  const out = [];
  for (const [id, gen] of GENERATORS) {
    if (off.has(id)) continue;
    /* A generator that throws contributes nothing. One bad row must not
       blank the stage - the floor generator is the last line of defence and
       it cannot do its job if an earlier throw takes the whole build out. */
    try {
      const ov = overrides.get(id);
      for (const it of gen(ctx) || []) out.push({ ...applyOverride(it, ov), generator: id });
    } catch (err) {
      console.warn(`broadcast: ${id} failed`, err);
    }
  }
  for (const c of custom) out.push(c);

  out.sort((a, b) => (b.priority || 0) - (a.priority || 0));

  const picked = diversify(out, max);

  /* THE FLOOR, enforced here rather than hoped for. The identity generator
     always produces an item, but ranking can slice it off when eight better
     things exist - which is correct. What must never happen is an EMPTY
     deck, so if nothing survived, identity is put back. */
  if (!picked.length) picked.push(...identityItem(ctx));

  /* A stable id so the rotation can remember what it has shown without
     holding a reference to the object. */
  return picked.map((it, i) => ({ ...it, id: it.id ?? `${it.generator || it.source}:${i}` }));
}

/*
  RANKED, BUT NOT THREE OF THE SAME THING IN A ROW.

  Straight priority order put three "upcoming event" cards back to back -
  the golf outing, the fantasy season and draft night - which reads as one
  long card rather than as three. So the pick is greedy: take the best
  remaining item whose treatment is not already the last two on the list,
  and fall back to the best remaining if that is the only option left.

  Priority still decides almost everything; this only breaks up runs.
*/
function diversify(ranked, max) {
  const pool = [...ranked];
  const out = [];
  while (pool.length && out.length < max) {
    const recent = out.slice(-2).map((x) => x.treatment);
    const sameRun = recent.length === 2 && recent[0] === recent[1];
    /*
      MANUAL SLIDES ARE NEVER SWAPPED PAST EACH OTHER.

      This used to search the whole pool for a different treatment, which
      quietly reordered hand-written slides - so the running order a
      commissioner set in Admin was not the order that played, and the
      setting looked broken rather than overruled. Diversity is a
      tie-break for AUTOMATIC content, where nobody chose the sequence.
      Where somebody did choose, their choice wins.
    */
    const i = sameRun
      ? pool.findIndex((x) => x.treatment !== recent[0] && x.source !== "manual")
      : 0;
    out.push(pool.splice(i > -1 ? i : 0, 1)[0]);
  }
  return out;
}

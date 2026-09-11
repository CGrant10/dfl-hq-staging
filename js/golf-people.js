/* =====================================================================
   golf-people.js - what to call a player, and the ONLY place that decides
   ---------------------------------------------------------------------
   Half the field is not in the fantasy league. Making those people members
   rows to get them onto a scorecard would put strangers in the "Who are
   you?" picker, the keeper tables and every member dropdown in the app,
   permanently - so a golf participant is EITHER a league member or a name
   typed in for the day (golf_participants.guest_name).

   And the members who ARE in the league are mostly there under a Sleeper
   username from 2019. A scorecard that says "azhee28" is a scorecard
   nobody reads, so a member can set a GOLF NAME - members.golf_name - and
   that is what golf calls them. It reaches nothing else: no fantasy screen
   reads that column.

   THE ORDER, and it is decided here and nowhere else:

     1  members.golf_name          what they asked to be called at golf
     2  golf_participants.guest_name  a guest's name, per event
     3  members.display_name       their DFL name
     4  members.team_name          the Sleeper-derived name, last resort
     5  "Guest" / "Unknown"

   Step 4 is unreachable for a member by construction - display_name is
   `not null unique` - and is kept for the case of a row arriving without
   one rather than as something that happens.

   WHY ONE FUNCTION. There are a lot of screens: the roster, the team
   editor, the draft board, the leaderboard, the 2v2 list, both scorecards,
   the marquee and both shared images. Every one of them calls playerName(),
   so a name changed in one place changes in all of them and a guest cannot
   be "Unknown" on one card and themselves on another.
   ===================================================================== */

/**
 * The identity map every golf screen passes around: member id -> the bits
 * of the member row that can name them.
 *
 * Takes whatever loadMembers() returned, which is `select("*")`, so
 * golf_name arrives with it and no screen needs a second query.
 *
 * The VALUE used to be a bare display_name string. It is an object now, and
 * nothing outside this file ever reads it - every consumer goes through
 * playerName() - which is exactly why widening it was a two-line change
 * rather than a hunt through eight files.
 */
export function memberNames(members) {
  return new Map((members || []).map((m) => [String(m.id), {
    golf: clean(m.golf_name),
    display: clean(m.display_name),
    team: clean(m.team_name),
  }]));
}

const clean = (v) => String(v ?? "").trim();

/**
 * What to call this participant.
 *
 * @param {object} part   a golf_participants row
 * @param {Map} names     from memberNames()
 */
export function playerName(part, names) {
  if (!part) return "Unknown";

  if (part.member_id != null) {
    const m = names?.get(String(part.member_id));
    if (!m) return "Unknown";
    return m.golf || m.display || m.team || "Unknown";
  }

  return clean(part.guest_name) || "Guest";
}

/**
 * The DFL name behind a golf name, when there is one and it differs.
 *
 * For the places that have to be unambiguous about WHO somebody is - the
 * admin roster, a duplicate-name argument - without putting a Sleeper
 * username on a scorecard. Returns "" when there is nothing to add.
 */
export function realName(part, names) {
  if (!part || part.member_id == null) return "";
  const m = names?.get(String(part.member_id));
  if (!m || !m.golf) return "";
  return m.golf === m.display ? "" : m.display;
}

/** What this member's own golf name is set to, or "" if they have not set one. */
export function golfNameOf(member) {
  return clean(member?.golf_name);
}

/** True for somebody who only exists inside this outing. */
export function isGuest(part) {
  return !!part && part.member_id == null;
}

/* =====================================================================
   golf-board.js - what the live leaderboard says, with no DOM in it
   ---------------------------------------------------------------------
   The arithmetic and the ranking behind golf-live.js, kept in their own
   file for the same reason golf-battle.js is: this is the part that can be
   WRONG in a way nobody notices until somebody is standing on the 18th
   arguing about it, and it is the part a test runner can actually load.
   golf-live.js reads the database and paints; nothing here does either.

   A "ball" is one side of one match: a pair in a 2v2 nine, a person in a
   singles nine. That is the unit the tournament scores (see
   golf_matches_schema.sql), so it is the unit everything below counts.
   ===================================================================== */
import { roundHoles, pairName } from "./golf-battle.js";

export const roundLabel = (round) => round?.name || `Round ${round?.round_number ?? "?"}`;
export const roundShort = (round) => `R${round?.round_number ?? "?"}`;

const parOf = (holes, hole) => {
  const row = (holes || []).find((h) => Number(h.hole) === Number(hole));
  return Number(row?.par) || 0;
};

/*
  TO PAR OVER THE HOLES ACTUALLY WRITTEN DOWN, and only those.

  A pair three holes into a nine is -1 thru 3, not -1 with six holes of par
  still owed. Counting unplayed holes as par would rank a side that has not
  teed off level with the field, and would make a leader look worse the
  moment they bogeyed a hole nobody else had reached yet.

  A nine played twice is still holes 1-9 of the course, so the par lookup
  is the course hole number either way. No par row means the holes table
  has not been filled in: the strokes still add up and the to-par cannot,
  and counting that hole as par 0 is the honest version of that.
*/
export function toPar(strokes, holes, round) {
  const last = roundHoles(round);
  let total = 0, par = 0, thru = 0;
  for (let h = 1; h <= last; h++) {
    const st = Number(strokes?.get(h));
    if (!Number.isFinite(st) || st <= 0) continue;
    total += st;
    par += parOf(holes, h);
    thru++;
  }
  return { diff: total - par, total, thru, of: last };
}

/*
  ONE SORT FOR BOTH UNITS. Best to-par first; a tie goes to whoever has
  played MORE holes, because -1 thru 9 is a better round than -1 thru 3.
  Anybody yet to hit a shot sits at the bottom rather than at level par -
  a board nobody has started is not a twelve-way tie for the lead.
*/
export function rank(rows) {
  return rows.sort((a, b) => {
    if (!a.thru && !b.thru) return a.order - b.order;
    if (!a.thru) return 1;
    if (!b.thru) return -1;
    return a.diff - b.diff || b.thru - a.thru || a.order - b.order;
  });
}

export const label = (row) => (!row.thru ? "—" : row.diff === 0 ? "E" : row.diff > 0 ? `+${row.diff}` : `${row.diff}`);
export const tone = (row) => (!row.thru ? "none" : row.diff < 0 ? "under" : row.diff > 0 ? "over" : "even");
export const progress = (row) => (!row.thru ? "Not started" : row.thru >= row.of ? "Finished" : `Thru ${row.thru}`);
export const strokeLine = (row) => (!row.thru ? "" : `${row.total} stroke${row.total === 1 ? "" : "s"}`);

/*
  ONE ROUND, ONE BOARD, AND THE MATCH TYPE DECIDES WHAT A ROW IS.

  The tournament points board already answers "which team is winning the
  day", so this does not repeat it. The question left over is the one you
  ask walking down a fairway: how is MY match going against everybody
  else's - and the answer has a different shape per round.

    a 2v2 nine   the ball belongs to a pair, so a row is a pair
    a singles nine   the ball belongs to a person, so a row is a person

  Grouped by what is actually on the ball rather than by the round's
  format column, because those can disagree: a singles round with a seat
  filled by two people, or a pairs round with somebody playing alone, is a
  data state the board has to survive. A round whose balls all have the
  same shape gets one ungrouped list; only a genuinely mixed round shows
  two headed groups, each ranked on its own.

  @returns {Array<{kind:"pairs"|"singles", rows:Array}>} in play order,
           pairs first, and empty when the round has no matches at all.
*/
export function roundBoard({ balls, holes }, round) {
  const mine = (balls || []).filter((b) => b.round && String(b.round.id) === String(round?.id));
  const groups = new Map();

  for (const ball of mine) {
    const shared = ball.players.length > 1;
    const kind = shared ? "pairs" : "singles";
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push({
      ...toPar(ball.strokes, ball.holes || holes, ball.round),
      key: `side:${ball.id}`,
      shared,
      name: shared ? pairName(ball.players.map((p) => p.name)) : (ball.players[0]?.name || "Open seat"),
      teamName: ball.teamName,
      courseName: ball.courseName || "",
      color: ball.color,
      /* Untouched, the board reads down the card in the order the matches
         were built rather than in team order - the two sides of one match
         belong next to each other before anybody has hit a shot. */
      order: (ball.matchNumber ?? 0) * 10 + (ball.teamOrder ?? 0),
      matchId: ball.matchId,
    });
  }

  return ["pairs", "singles"]
    .filter((kind) => groups.has(kind))
    .map((kind) => ({ kind, rows: rank(groups.get(kind)) }));
}

/** What a group of rows is called, said only when a round has both. */
export const groupLabel = (kind) => (kind === "pairs" ? "Pairs" : "Singles");

/*
  WHICH ROUND THE BOARD OPENS ON.

  The one being played: the last round anybody has posted a stroke in.
  Opening on round 1 all day means everybody arriving at the board during
  round 3 has to change it first, and opening on the last round in the
  list shows an empty card before that round starts.
*/
export function currentRound(rounds, balls) {
  const played = new Set();
  for (const ball of balls || []) {
    if (ball.round && ball.strokes?.size) played.add(String(ball.round.id));
  }
  const live = [...(rounds || [])].reverse().find((r) => played.has(String(r.id)));
  return live || rounds?.[0] || null;
}

// =====================================================================
// season-outlook.js - projected record, title odds, Chip Eater odds
// ---------------------------------------------------------------------
// The report says how good a roster is. It never said what that is
// likely to BUY - a record, a playoff berth, a trophy, or the punishment
// at the other end.
//
// NO SCHEDULE EXISTS YET. sleeper_matchups stops at last season, so each
// simulated week draws a RANDOM pairing rather than assuming an opponent
// order nobody has published. That matters more than it sounds: the first
// version scored every week against the whole league, which quietly
// removed almost all head-to-head luck and had the top four rosters at
// 97-100% to make an eight-team bracket. Good teams miss the playoffs.
// A random schedule keeps the week you score 140 and lose.
//
// THE VARIANCE IS THIS LEAGUE'S OWN. A weekly projection is a mean, and a
// mean alone says a 130-point team always beats a 120-point team. They
// do not. The spread comes from 24 team-seasons of real DFL matchups
// (2024 and 2025): a median weekly standard deviation of 22.9 points on a
// median score of 117.5. Measured, not guessed - see LEAGUE_WEEKLY_SD.
//
// THE SIMULATION IS SEEDED. Odds that change every time the page is
// refreshed look broken and invite a re-roll until the answer is liked.
// The same rosters always produce the same numbers; change a roster and
// the numbers move.
// =====================================================================

/*
  Measured across 24 team-seasons of DFL matchups in 2024 and 2025:
  median weekly SD 22.9, mean 22.7, range 13.5 to 33.1.
*/
export const LEAGUE_WEEKLY_SD = 22.9;
/* The DFL plays a 14-week regular season and a 3-week bracket - 17 in all. */
export const REGULAR_SEASON_WEEKS = 14;
export const PLAYOFF_WEEKS = 3;
export const DEFAULT_RUNS = 3000;

/* mulberry32 - small, fast, and good enough for counting outcomes. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Box-Muller, one draw at a time. */
function normal(random, mean, sd) {
  const u = Math.max(random(), 1e-9), v = random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* The same league must always seed the same. Team ids and their means are
   the only inputs that should move the answer. */
function seedFrom(teams) {
  let hash = 2166136261;
  for (const team of teams) {
    const key = `${team.id}:${Math.round((team.mean || 0) * 10)}`;
    for (let i = 0; i < key.length; i += 1) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}

/**
 * Project a season by simulation.
 *
 * @param {Object} input
 * @param {Array<{id:string, mean:number}>} input.teams  weekly points expectation
 * @param {number} [input.playoffTeams] how many make the bracket
 * @returns {Map<string, {wins:number, losses:number, playoffOdds:number,
 *                        titleOdds:number, lastOdds:number, seed:number}>}
 */
export function projectSeason({ teams = [], playoffTeams = 8, weeks = REGULAR_SEASON_WEEKS,
                                sd = LEAGUE_WEEKLY_SD, runs = DEFAULT_RUNS } = {}) {
  const out = new Map();
  const live = teams.filter(team => Number.isFinite(team?.mean));
  if (live.length < 2) return out;

  const tally = new Map(live.map(team => [team.id,
    { wins: 0, playoff: 0, title: 0, last: 0, seedSum: 0 }]));
  const random = rng(seedFrom(live));
  const berths = Math.min(playoffTeams, live.length);

  for (let run = 0; run < runs; run += 1) {
    const season = live.map(team => ({ id: team.id, mean: team.mean, wins: 0, points: 0 }));
    for (let week = 0; week < weeks; week += 1) {
      /*
        A RANDOM SCHEDULE, NOT ALL-PLAY.

        All-play - scoring each week against the whole league - was the first
        approach and it was too kind. Averaging over eleven opponents every
        week removes almost all head-to-head luck, and it showed: the top four
        rosters came out at 97-100% to make an eight-team bracket, which is not
        how a fantasy season behaves. Good teams miss the playoffs.

        Since no schedule exists, each simulated week draws a random pairing
        instead. That is an honest stand-in for an unknown fixture list and it
        keeps the thing all-play threw away - the week you score 140 and lose.
      */
      for (let i = season.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [season[i], season[j]] = [season[j], season[i]];
      }
      for (let i = 0; i + 1 < season.length; i += 2) {
        const home = season[i], away = season[i + 1];
        const homeScore = normal(random, home.mean, sd);
        const awayScore = normal(random, away.mean, sd);
        home.points += homeScore; away.points += awayScore;
        if (homeScore >= awayScore) home.wins += 1; else away.wins += 1;
      }
    }
    season.sort((a, b) => b.wins - a.wins || b.points - a.points);
    season.forEach((team, index) => {
      const record = tally.get(team.id);
      record.wins += team.wins;
      record.seedSum += index + 1;
      if (index < berths) record.playoff += 1;
      if (index === season.length - 1) record.last += 1;
    });

    /* A fixed bracket, 1v8 through 4v5, three rounds, one game each. */
    let field = season.slice(0, berths);
    while (field.length > 1) {
      const next = [];
      for (let i = 0; i < field.length / 2; i += 1) {
        const home = field[i], away = field[field.length - 1 - i];
        next.push(normal(random, home.mean, sd) >= normal(random, away.mean, sd) ? home : away);
      }
      field = next;
    }
    if (field[0]) tally.get(field[0].id).title += 1;
  }

  for (const [id, record] of tally) {
    /*
      A RECORD IS WHOLE GAMES.

      This reported the simulation's mean to one decimal - 6.8-7.2 - which is
      not a record anybody can finish with. Nobody wins four fifths of a game.
      The mean is still the honest centre of the distribution, so it is kept as
      expectedWins for anything that needs the precision, but what gets shown
      is the season it rounds to, and losses come off the rounded wins so the
      two always add up to the weeks played.
    */
    const expectedWins = record.wins / runs;
    const wins = Math.round(expectedWins);
    out.set(id, {
      wins,
      losses: weeks - wins,
      expectedWins: Math.round(expectedWins * 10) / 10,
      playoffOdds: record.playoff / runs,
      titleOdds: record.title / runs,
      lastOdds: record.last / runs,
      seed: Math.round((record.seedSum / runs) * 10) / 10,
    });
  }
  return out;
}

/** One sentence on where a team stands, and why. */
export function outlookSentence(projection, rank, count) {
  if (!projection) return "Not enough of the league has synced to project a season.";
  const { wins, losses, playoffOdds, titleOdds } = projection;
  /* Phrased to lead with the number rather than an article. "A 8.5-5.5 pace"
     was the first draft, and an article that has to agree with a numeral is a
     bug waiting on the one season somebody goes 8-6 or 11-3. */
  const record = `${wins}-${losses}`;
  if (titleOdds >= .2) return `Projected ${record}, with the best title odds in the league — this roster is the one to beat.`;
  if (playoffOdds >= .8) return `Projected ${record}. The bracket is close to a formality; seeding is what is left to play for.`;
  if (playoffOdds >= .5) return `Projected ${record}, which makes the bracket more likely than not — but with little margin.`;
  if (playoffOdds >= .25) return `Projected ${record}, squarely on the bubble. A position upgrade decides this season.`;
  return `Projected ${record}. The bracket is out of reach without a real upgrade${rank && count ? `, from ${rank} of ${count}` : ""}.`;
}

import { describe, it, expect } from 'vitest';
import { buildFindings, verdictLine, ordinal } from './analyzer-findings.js';

/* A team shaped like analyzeLeague()'s output, with only the fields the
   findings read. Elite RB, thin flex, good starters, poor bench - the shape
   the mock was drawn against. */
const unit = (percentile, grade, score, leagueRank, starters = []) =>
  ({ percentile, grade, score, leagueRank, leagueSize: 12, starters, depth: [] });

const makeTeam = (over = {}) => ({
  id: '4', team_name: 'Bastards of the Realm', ownerName: 'GrantsTweaking',
  rank: 4, overallRank: 4,
  starterGrade: 'A-', depthGrade: 'C+', overallGrade: 'B+',
  starterPercentile: .78, depthPercentile: .41, overallPercentile: .69,
  lineup: { source: 'set', weeklyPoints: 118.4, starterPoints: 1657, depthScore: 300,
    starters: [
      { name: 'Bijan Robinson', position: 'RB', positionRank: 2, positionCount: 64, expectedPoints: 287, tradeValue: 72 },
      { name: 'Jordan Love', position: 'QB', positionRank: 8, positionCount: 32, expectedPoints: 341, tradeValue: 33 },
    ], bench: [] },
  positionGrades: {
    QB: unit(.82, 'A-', 341, 3),
    RB: unit(.91, 'A', 426, 1, [{ name: 'Bijan Robinson', position: 'RB', positionRank: 2, positionCount: 64 }]),
    WR: unit(.44, 'C+', 292, 7),
    TE: unit(.68, 'B', 198, 4),
    FLEX: unit(.28, 'D+', 146, 10),
  },
  ...over,
});

/* Twelve teams so a median exists; the subject sits inside it. */
const league = (subject) => [subject, ...Array.from({ length: 11 }, (_, i) => ({
  id: `t${i}`, team_name: `Team ${i}`,
  positionGrades: {
    QB: unit(.5, 'C+', 300 + i, 6), RB: unit(.5, 'C+', 300 + i, 6),
    WR: unit(.5, 'C+', 300 + i, 6), TE: unit(.5, 'C+', 200 + i, 6),
    FLEX: unit(.5, 'C+', 230 + i, 6),
  },
}))];

const projectionsFor = (over = {}) => new Map([
  ['4', { wins: 9, losses: 5, seed: 3, playoffOdds: .84, titleOdds: .19, lastOdds: .02, ...over }],
  ['t0', { wins: 10, losses: 4, seed: 1, playoffOdds: .91, titleOdds: .24, lastOdds: .01 }],
]);

describe('buildFindings', () => {
  it('finds the strength, the weakness, the thin bench and the odds, in that order of weight', () => {
    const team = makeTeam();
    const { findings } = buildFindings({ team, teams: league(team), projections: projectionsFor() });
    expect(findings).toHaveLength(4);
    const keys = findings.map(f => f.key);
    expect(keys).toContain('strength');
    expect(keys).toContain('weakness');
    expect(keys).toContain('title');
    /* Weakest unit first: the flex at the 28th percentile outweighs an
       elite RB, because what is wrong is more actionable than what is right. */
    expect(keys[0]).toBe('weakness');
  });

  it('names the elite unit as the best in the league only when it actually is', () => {
    const team = makeTeam();
    const first = buildFindings({ team, teams: league(team), projections: projectionsFor() })
      .findings.find(f => f.key === 'strength');
    expect(first.title).toBe('Your RB is the best in the league');
    expect(first.copy).toContain('Bijan Robinson is RB2 of 64 rated');

    const second = makeTeam({ positionGrades: { ...makeTeam().positionGrades, RB: unit(.91, 'A', 426, 2) } });
    const other = buildFindings({ team: second, teams: league(second), projections: projectionsFor() })
      .findings.find(f => f.key === 'strength');
    expect(other.title).toBe('Your RB is a real strength');
  });

  it('measures the weak unit against the league median actually on screen', () => {
    const team = makeTeam();
    const weak = buildFindings({ team, teams: league(team), projections: projectionsFor() })
      .findings.find(f => f.key === 'weakness');
    expect(weak.title).toBe('The flex is the 28th percentile');
    /* Twelve FLEX scores: the subject's 146 plus 230..240. Sorted, the 6th
       and 7th are 234 and 235, so the median is 234.5 - and (234.5 - 146)
       over 14 weeks is 6.3 a week. Computed from the teams on screen, which
       is the whole point: it moves when the league does. */
    expect(weak.copy).toContain('6.3 points a week behind the league median');
    expect(weak.action.href).toBe('#/trade?team=4');
  });

  it('says the one starting slot line instead when there is no median to compare', () => {
    const team = makeTeam();
    const weak = buildFindings({ team, teams: [team], projections: projectionsFor() })
      .findings.find(f => f.key === 'weakness');
    // Its own score IS the median, so the gap is zero and the sentence changes
    // rather than claiming "0.0 points a week behind".
    expect(weak.copy).toContain('the one starting slot where the league is beating you');
  });

  it('invents no weakness for a roster that has none', () => {
    const even = makeTeam({
      starterPercentile: .6, depthPercentile: .58,
      positionGrades: {
        QB: unit(.55, 'C+', 320, 5), RB: unit(.58, 'B-', 330, 5),
        WR: unit(.52, 'C+', 300, 6), TE: unit(.6, 'B-', 210, 5), FLEX: unit(.5, 'C', 240, 6),
      },
    });
    const { findings } = buildFindings({ team: even, teams: league(even), projections: projectionsFor() });
    expect(findings.map(f => f.key)).not.toContain('weakness');
    expect(findings.map(f => f.key)).not.toContain('strength');
    // It still has something to say rather than coming back empty.
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.map(f => f.key)).toContain('title');
  });

  it('raises the Chip Eater risk over almost everything else', () => {
    const team = makeTeam();
    const { findings } = buildFindings({
      team, teams: league(team),
      projections: projectionsFor({ lastOdds: .31, titleOdds: .01, playoffOdds: .12 }),
    });
    const chip = findings.find(f => f.key === 'chip');
    expect(chip).toBeTruthy();
    expect(chip.title).toBe('31% to finish last');
    expect(chip.tone).toBe('bad');
  });

  it('flags an unset lineup, because it changes what every grade means', () => {
    const team = makeTeam({ lineup: { ...makeTeam().lineup, source: 'optimized' } });
    const { findings } = buildFindings({ team, teams: league(team), projections: projectionsFor() });
    expect(findings.map(f => f.key)).toContain('optimized');
  });

  it('every finding points at a section that exists', () => {
    const team = makeTeam();
    const { findings } = buildFindings({ team, teams: league(team), projections: projectionsFor() });
    for (const finding of findings) {
      expect(finding.action.label).toBeTruthy();
      expect(finding.action.href).toMatch(/^#(units|roster|league|outlook|\/trade)/);
      expect(finding.title).toBeTruthy();
      expect(finding.copy).toBeTruthy();
      expect(['good', 'bad', 'warn', 'neutral']).toContain(finding.tone);
    }
  });

  it('survives a team with no projection and no league around it', () => {
    const bare = { id: '1', lineup: { source: 'set', starters: [] }, positionGrades: {} };
    const { verdict, findings } = buildFindings({ team: bare });
    expect(Array.isArray(findings)).toBe(true);
    expect(typeof verdict).toBe('string');
    expect(buildFindings({}).findings).toEqual([]);
    expect(buildFindings().findings).toEqual([]);
  });
});

describe('verdictLine', () => {
  it('names what the roster is and what holds it back', () => {
    const weak = { position: 'FLEX', percentile: .28 };
    expect(verdictLine({}, { titleOdds: .19, playoffOdds: .84, lastOdds: .02 }, weak))
      .toBe('A contender, held back by the flex.');
    expect(verdictLine({}, { titleOdds: .05, playoffOdds: .7, lastOdds: .02 }, weak))
      .toBe('A playoff roster, held back by the flex.');
    expect(verdictLine({}, { titleOdds: .01, playoffOdds: .4, lastOdds: .05 }, weak))
      .toBe('On the bubble, held back by the flex.');
    expect(verdictLine({}, { titleOdds: 0, playoffOdds: .1, lastOdds: .3 }, weak))
      .toBe('In trouble, held back by the flex.');
  });

  it('drops the second clause when nothing is actually weak', () => {
    expect(verdictLine({}, { titleOdds: .19, playoffOdds: .84, lastOdds: .02 }, { position: 'RB', percentile: .8 }))
      .toBe('A contender.');
  });

  it('says so rather than guessing with no simulation', () => {
    expect(verdictLine({}, null, null)).toContain('Not enough of the league has synced');
  });
});

describe('ordinal', () => {
  it('handles the teens, which is the only interesting part', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
  });
});

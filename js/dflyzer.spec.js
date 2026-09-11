import { describe, it, expect } from 'vitest';
import { tradeReasons } from './trade-desk.js';

/*
  THE DFLYZER IS ALLOWED TO BE RUDE. IT IS NOT ALLOWED TO BE WRONG.

  The voice is the point of these remarks, and the voice is also the risk: the
  first time it calls a fair trade a robbery, or shouts about a third of a
  point a week, nobody believes the next one either. So these tests are about
  the BANDS - which remark fires at which number - rather than the wording,
  and every remark has to print the figure it is mocking you for.
*/
const P = (id, name, position, tradeValue) => ({ id, name, position, nflTeam: 'XXX', tradeValue, expectedPoints: 200 });
const pool = new Map([
  P('big', 'Bijan Robinson', 'RB', 72),
  P('mid', 'Kenneth Walker', 'RB', 28),
  P('small', 'Jayden Reed', 'WR', 20),
  P('star', 'Nico Collins', 'WR', 60),
  P('scrap', 'Tony Pollard', 'RB', 19),
  P('dust', 'Roster Dust', 'WR', 9),
  /* Two near-identical TEs, so the DEFAULT read triggers no need, strength,
     consolidation or roster-room remark and the band under test is not
     crowded out of the top four by remarks that are also correct. */
  P('teA', 'Some Tight End', 'TE', 40),
  P('teB', 'Other Tight End', 'TE', 38),
].map(p => [p.id, p]));

const mine = { id: '4', team_name: 'Bastards of the Realm', need: 'WR', strength: 'RB' };
const theirs = { id: '1', team_name: 'Klutch Sports Group', need: 'RB', strength: 'WR' };
/* No need and no strength on the default team, for the same reason. */
const plain = { id: '4', team_name: 'Bastards of the Realm' };
const read = (result, sendA = ['teA'], sendB = ['teB'], teamA = plain) =>
  tradeReasons({ weeklyDeltaA: 0, weeklyDeltaB: 0, ...result }, teamA, theirs, pool, sendA, sendB);
const titles = reasons => reasons.map(r => r.title);

describe('who is fleecing whom', () => {
  it('calls a lopsided deal a fleecing, and puts the shears in the right hand', () => {
    const mineToWin = read({ fairness: 48, valueToA: 60, valueToB: 28.7 });
    expect(mineToWin[0].title).toBe('You are committing the robbery. Hit accept.');
    expect(mineToWin[0].tone).toBe('good');
    expect(mineToWin[0].copy).toMatch(/money|headlights/i);

    const theirsToWin = read({ fairness: 34, valueToA: 25, valueToB: 72 });
    expect(theirsToWin[0].title).toBe('FLEECE. They are robbing your ass blind.');
    expect(theirsToWin[0].tone).toBe('bad');
    expect(theirsToWin[0].copy).toMatch(/best shit|reject this garbage/i);
  });

  it('does NOT call a fair trade a robbery', () => {
    const even = read({ fairness: 93, valueToA: 38, valueToB: 41 });
    expect(titles(even).join(" ")).not.toMatch(/fleec/i);
    expect(titles(even)).toContain('Fair as hell. Weird, but fine.');
  });

  it('prints the balance and the value gap in the same sentence as the insult', () => {
    const [top] = read({ fairness: 48, valueToA: 60, valueToB: 28.7 });
    expect(top.copy).toContain('48%');
    expect(top.copy).toContain('31.3');
  });
});

describe('the lineup bands', () => {
  /* This is the one that was wrong first time: −0.3 a week got the same
     sentence as −6.0, which is how a tool loses its credibility. */
  it('does not shout about a third of a point a week', () => {
    const small = read({ fairness: 80, valueToA: 45, valueToB: 40, weeklyDeltaA: -.3 });
    expect(titles(small)).toContain('A small kick in the ass.');
    expect(titles(small)).not.toContain('Congrats, you paid to suck more.');
  });

  it('does shout about a real one', () => {
    const big = read({ fairness: 80, valueToA: 45, valueToB: 40, weeklyDeltaA: -4.2 });
    expect(titles(big)).toContain('Congrats, you paid to suck more.');
    expect(big.find(r => r.title.includes('suck more')).copy).toContain('−4.2');
  });

  it('says nothing happened when nothing happened', () => {
    const flat = read({ fairness: 90, valueToA: 41, valueToB: 40, weeklyDeltaA: .05 });
    expect(titles(flat)).toContain('All that work for jack shit.');
  });

  it('never writes a double negative about the other side', () => {
    const reasons = read({ fairness: 80, valueToA: 50, valueToB: 40, weeklyDeltaA: 1.2, weeklyDeltaB: -1.8 });
    const theirLine = reasons.find(r => r.copy.includes('Their lineup drops'));
    expect(theirLine.copy).toContain('drops 1.8');
    expect(theirLine.copy).not.toContain('drops −');
  });
});

describe('the roster remarks', () => {
  it('spots parts turning into a player, and a player turning into change', () => {
    const up = read({ fairness: 60, valueToA: 60, valueToB: 30 }, ['mid', 'small'], ['star']);
    expect(titles(up)).toContain('Less crap, more star power.');

    const down = read({ fairness: 60, valueToA: 25, valueToB: 72 }, ['big'], ['scrap']);
    expect(titles(down)).toContain('You are selling a stud for spare change.');
  });

  it('knows when the hole gets plugged and when the good unit gets sold', () => {
    const reasons = read({ fairness: 62, valueToA: 60, valueToB: 30 }, ['mid'], ['star'], mine);
    /* star is a WR and WR is the need; mid is an RB and RB is the strength. */
    expect(titles(reasons)).toContain('Your WR room finally stops sucking.');
    expect(titles(reasons)).toContain('You fixed one hole by opening another dumb one.');
  });

  it('counts bodies when the package is uneven', () => {
    const reasons = read({ fairness: 80, valueToA: 50, valueToB: 45 }, ['teA'], ['teB', 'scrap']);
    expect(titles(reasons).join(" ")).toContain('2 bodies in. Check the damn quality.');
  });

  it('calls out weak-player piles without mistaking quantity for quality', () => {
    const two = read({ fairness: 44, valueToA: 32, valueToB: 72, weeklyDeltaA: -3 }, ['big'], ['small', 'scrap']);
    expect(titles(two)).toContain('Two pieces of shit still do not make a star');
    expect(two.find(r => r.title.includes('pieces of shit')).copy).toContain('2 names');
    expect(two.find(r => r.title.includes('pieces of shit')).copy).toContain('40.0 value points');

    const three = read({ fairness: 51, valueToA: 37, valueToB: 72, weeklyDeltaA: -2 }, ['big'], ['small', 'scrap', 'dust']);
    expect(titles(three)).toContain('Three bench turds in a trench coat are not a starter');
  });

  it('does not roast a legitimate two-for-one just because it has two names', () => {
    const fair = read({ fairness: 90, valueToA: 66, valueToB: 72 }, ['big'], ['star', 'teB']);
    expect(titles(fair).join(' ')).not.toMatch(/pieces of shit|trench coat|roster toilet/i);
  });
});

describe('the shape of the read', () => {
  it('always returns something, never more than four, and always with a figure', () => {
    const cases = [
      { fairness: 48, valueToA: 60, valueToB: 28.7, weeklyDeltaA: -2.6, weeklyDeltaB: 2.6 },
      { fairness: 93, valueToA: 38, valueToB: 41, weeklyDeltaA: 0, weeklyDeltaB: 0 },
      { fairness: 34, valueToA: 25, valueToB: 72, weeklyDeltaA: -5, weeklyDeltaB: 5 },
      { fairness: 100, valueToA: 0, valueToB: 0, weeklyDeltaA: 0, weeklyDeltaB: 0 },
    ];
    for (const result of cases) {
      const reasons = read(result);
      expect(reasons.length).toBeGreaterThan(0);
      expect(reasons.length).toBeLessThanOrEqual(4);
      for (const reason of reasons) {
        expect(reason.title).toBeTruthy();
        expect(reason.copy).toBeTruthy();
        expect(['good', 'bad', 'warn', 'neutral']).toContain(reason.tone);
        /* A digit somewhere in the remark. Trash talk with a citation is
           funny; trash talk without one is noise. */
        expect(`${reason.title} ${reason.copy}`).toMatch(/\d/);
      }
    }
  });

  it('leads with the fleecing, not with the roster trivia', () => {
    const reasons = read({ fairness: 34, valueToA: 25, valueToB: 72, weeklyDeltaA: -5 }, ['big'], ['scrap'], mine);
    expect(reasons[0].title).toBe('FLEECE. They are robbing your ass blind.');
  });
});

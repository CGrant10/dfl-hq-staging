import { describe, it, expect } from 'vitest';
import { dealCardData, dealCardText } from './trade-card.js';
import { tradeReasons, verdictFor, recommendationFor } from './trade-desk.js';

const P = (id, name, position, nflTeam, tradeValue) => ({ id, name, position, nflTeam, tradeValue, expectedPoints: 200 });
const pool = new Map([
  P('1', 'Bijan Robinson', 'RB', 'ATL', 72),
  P('2', 'Kenneth Walker', 'RB', 'SEA', 28),
  P('3', 'Jayden Reed', 'WR', 'GB', 20),
  P('11', 'Nico Collins', 'WR', 'HOU', 60),
  P('12', 'Tony Pollard', 'RB', 'TEN', 19),
].map(p => [p.id, p]));

const mine = { id: '4', team_name: 'Bastards of the Realm', need: 'WR', strength: 'RB' };
const theirs = { id: '1', team_name: 'Klutch Sports Group', need: 'RB', strength: 'WR' };
const result = { fairness: 48, valueToA: 60, valueToB: 28.7, weeklyDeltaA: -2.6, weeklyDeltaB: 2.6 };
const card = (over = {}) => dealCardData({
  result, parties: [mine, theirs], sends: [['2', '3'], ['11']], pool,
  verdict: verdictFor(result), recommendation: recommendationFor(result),
  member: { display_name: 'GrantsTweaking' }, ...over,
});

describe('dealCardData', () => {
  it('folds both packages with the value each is worth to its RECIPIENT', () => {
    const t = card();
    expect(t.columns).toHaveLength(2);
    expect(t.columns[0].players.map(p => p.name)).toEqual(['Kenneth Walker', 'Jayden Reed']);
    expect(t.columns[1].players.map(p => p.name)).toEqual(['Nico Collins']);
    /* What you send is worth valueToB - to THEM. Getting these two the wrong
       way round would put the fleecing on the wrong side of the card. */
    expect(t.columns[0].total).toBe(29);
    expect(t.columns[1].total).toBe(60);
  });

  it('sorts each package by value, so the headline piece leads', () => {
    const t = card({ sends: [['3', '2'], ['11']] });
    expect(t.columns[0].players[0].name).toBe('Kenneth Walker');
  });

  it('carries the call, the band and the DFLyzer remark', () => {
    const t = card({ remark: tradeReasons(result, mine, theirs, pool, ['2', '3'], ['11'])[0] });
    expect(t.call).toBe('ACCEPT');
    expect(t.callTone).toBe('accept');
    expect(t.headline).toBe('FLEECE');
    expect(t.winner).toBe('Bastards of the Realm');
    expect(t.fairness).toBe(48);
    expect(t.remark).toContain('robbery');
    expect(t.remarkTone).toBe('good');
  });

  it('always puts savage wording on the shared image even without a supplied remark', () => {
    expect(card().remark).toBe('You are committing the robbery. Hit accept.');
    const bad = { fairness: 34, valueToA: 25, valueToB: 72, weeklyDeltaA: -3, weeklyDeltaB: 2 };
    const t = card({
      result: bad,
      verdict: verdictFor(bad),
      recommendation: recommendationFor(bad),
    });
    expect(t.call).toBe('FLEECE');
    expect(t.remark).toBe('FLEECE. They are robbing your ass blind.');
    expect(t.remarkTone).toBe('bad');
  });

  it('keeps every DFLyzer title and full description for the shared image', () => {
    const reasons = tradeReasons(result, mine, theirs, pool, ['2', '3'], ['11']);
    const t = card({ remarks: reasons });
    expect(t.remarks).toHaveLength(reasons.length);
    expect(t.remarks.map(item => item.title)).toEqual(reasons.map(item => item.title));
    expect(t.remarks.map(item => item.copy)).toEqual(reasons.map(item => item.copy));
  });

  it('clamps a nonsense fairness rather than drawing a marker off the card', () => {
    expect(card({ result: { ...result, fairness: 140 } }).fairness).toBe(100);
    expect(card({ result: { ...result, fairness: -20 } }).fairness).toBe(0);
    expect(card({ result: { ...result, fairness: null } }).fairness).toBe(0);
  });

  it('reads a three-way from the first party without inventing a second opinion', () => {
    const third = { id: '9', team_name: 'The Bear Jew' };
    const multi = {
      fairness: 71, values: [40, 55, 48], weeklyDeltas: [1.2, -.4, .8],
    };
    const t = dealCardData({
      result: multi, parties: [mine, theirs, third],
      sends: [['2'], ['11'], ['12']], pool,
      verdict: verdictFor({ ...multi, valueToA: 40, valueToB: 55 }),
      recommendation: recommendationFor({ ...multi, valueToA: 40, valueToB: 55, weeklyDeltaA: 1.2 }),
    });
    expect(t.multi).toBe(true);
    expect(t.columns).toHaveLength(3);
    /* Every column is "this side hands these over", so its total is what the
       NEXT party receives - the only framing that survives a three-way. */
    expect(t.columns[0].total).toBe(55);
    expect(t.columns[1].total).toBe(48);
    expect(t.columns[2].total).toBe(40);
    expect(t.deltas.map(d => d.delta)).toEqual([1.2, -.4, .8]);
  });

  it('refuses to fold a deal it cannot describe', () => {
    expect(dealCardData({})).toBeNull();
    expect(dealCardData()).toBeNull();
    expect(dealCardData({ result, parties: [mine], sends: [[]], recommendation: { action: 'PASS' } })).toBeNull();
    expect(dealCardData({ result, parties: [mine, theirs], sends: [[], []] })).toBeNull();
  });

  it('falls back to the team name when nobody is signed in', () => {
    expect(card({ member: null }).who).toBe('Bastards of the Realm');
  });
});

describe('dealCardText', () => {
  it('names both packages and the remark, because the image may not arrive', () => {
    const reasons = tradeReasons(result, mine, theirs, pool, ['2', '3'], ['11']);
    const t = card({ remarks: reasons });
    const text = dealCardText(t);
    expect(text).toContain('ACCEPT');
    expect(text).toContain('Kenneth Walker + Jayden Reed');
    expect(text).toContain('Nico Collins');
    expect(text).toContain('48% balance');
    expect(text).toContain('robbery');
    for (const reason of reasons) expect(text).toContain(reason.copy);
    expect(text).not.toContain('accept..');
    expect(dealCardText(null)).toBe('');
  });
});

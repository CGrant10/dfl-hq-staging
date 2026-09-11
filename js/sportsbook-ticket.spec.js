import { describe, it, expect } from 'vitest';
import { ticketData, ticketText, opponentLine } from './sportsbook-ticket.js';

const leg = (label, odds, status = 'open') => ({ label, odds_american: odds, market: `${label} vs Someone`, status });
const member = { display_name: 'GrantsTweaking' };

describe('ticketData', () => {
  it('folds a single into its own headline', () => {
    const t = ticketData({ bet: { stake: 50, potential_payout: 83, odds_american: -150, status: 'open' }, legs: [leg('Doberman Dynasty', -150)], member });
    expect(t.title).toBe('Doberman Dynasty');
    /* The market line is the OPPONENT, not the fixture - printing the full
       title under a pick of the same name said the pick's name twice. */
    expect(t.market).toBe('vs Someone');
    expect(t.odds).toBe('-150');
    expect(t.profit).toBe(33);
    expect(t.picks).toHaveLength(1);
  });

  it('counts a multi-pick entry rather than naming one of its legs', () => {
    const t = ticketData({
      bet: { stake: 100, potential_payout: 5922, odds_american: 5822, status: 'open' },
      legs: [leg('A', -155), leg('B', 110), leg('C', 1100)], member,
    });
    expect(t.title).toBe('3-pick entry');
    expect(t.market).toBe('');
    expect(t.odds).toBe('+5822');
    expect(t.picks.map(p => p.odds)).toEqual(['-155', '+110', '+1100']);
  });

  it('reports how many legs landed so a settled entry can say 1 of 3', () => {
    const t = ticketData({
      bet: { stake: 100, potential_payout: 900, odds_american: 800, status: 'lost', settled_at: 'now' },
      legs: [leg('A', -155, 'won'), leg('B', 110, 'lost'), leg('C', 1100, 'open')], member,
    });
    expect(t.won).toBe(1);
    expect(t.settled).toBe(true);
  });

  it('tells a ticket the member pulled apart from one the house voided', () => {
    const base = { stake: 300, potential_payout: 493, odds_american: -155, status: 'void' };
    expect(ticketData({ bet: { ...base, cancelled_at: 'now' }, legs: [leg('A', -155, 'void')], member }).pulled).toBe(true);
    expect(ticketData({ bet: base, legs: [leg('A', -155, 'void')], member }).pulled).toBe(false);
  });

  it('survives a bet with no legs and no member rather than throwing', () => {
    const t = ticketData({ bet: { stake: 10, potential_payout: 20, odds_american: 100, status: 'open' } });
    expect(t.who).toBe('DFL');
    expect(t.picks).toEqual([]);
    expect(t.title).toBe('0-pick entry');
    expect(ticketData({})).toBeNull();
    expect(ticketData()).toBeNull();
  });
});

describe('ticketText', () => {
  it('names every pick on an entry, because the image may not arrive', () => {
    const t = ticketData({
      bet: { stake: 100, potential_payout: 5922, odds_american: 5822, status: 'open' },
      legs: [leg('Doberman Dynasty', -155), leg('Mad Dawgs', 110)], member,
    });
    const text = ticketText(t);
    expect(text).toContain('Doberman Dynasty');
    expect(text).toContain('Mad Dawgs');
    expect(text).toContain('+5822');
    expect(text).toContain('5,922');
  });

  it('leads with what happened to it', () => {
    const of = (status, extra = {}) => ticketText(ticketData({
      bet: { stake: 50, potential_payout: 83, odds_american: -150, status, ...extra },
      legs: [leg('A', -150)], member,
    }));
    expect(of('won')).toMatch(/^Cashed/);
    expect(of('lost')).toMatch(/^Torn up/);
    expect(of('open')).toMatch(/^On the board/);
    expect(of('void', { cancelled_at: 'now' })).toMatch(/^Pulled/);
    expect(of('void')).toMatch(/^Voided/);
    expect(ticketText(null)).toBe('');
  });
});

describe('opponentLine', () => {
  it('drops whichever half of the fixture is the pick', () => {
    expect(opponentLine('Mad Dawgs vs Gengar Gang', 'Mad Dawgs')).toBe('vs Gengar Gang');
    expect(opponentLine('Mad Dawgs vs Gengar Gang', 'Gengar Gang')).toBe('vs Mad Dawgs');
    expect(opponentLine('Mad Dawgs @ Gengar Gang', 'Mad Dawgs')).toBe('vs Gengar Gang');
    expect(opponentLine('Mad Dawgs at Gengar Gang', 'Gengar Gang')).toBe('vs Mad Dawgs');
  });

  it('is case-insensitive about the match but keeps the opponent as written', () => {
    expect(opponentLine('MAD DAWGS vs Gengar Gang', 'mad dawgs')).toBe('vs Gengar Gang');
  });

  /* A prop has no side in its title, so there is nothing to drop - and the
     question is the only thing that identifies a YES pick. */
  it('keeps a prop question whole', () => {
    const q = 'Will golf trash talk break out before this line closes?';
    expect(opponentLine(q, 'YES')).toBe(q);
    expect(opponentLine('Team A vs Team B', 'Somebody Else')).toBe('Team A vs Team B');
  });

  it('gives back what it was handed when either side is missing', () => {
    expect(opponentLine('', 'A')).toBe('');
    expect(opponentLine('A vs B', '')).toBe('A vs B');
    expect(opponentLine(null, null)).toBe('');
  });
});

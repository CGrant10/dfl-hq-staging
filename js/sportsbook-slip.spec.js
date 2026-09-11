import { describe, it, expect } from 'vitest';
import { parseStake, estimatedReturn, decimalOdds, combineOdds, entryReturn } from './sportsbook-slip.js';

describe('sportsbook stake and return', () => {
  it('rejects decimals, negative values, pasted text and over-budget stakes', () => {
    for (const input of ['1.5', '-50', '50 SIN', '1e2', '0', '', '101']) expect(parseStake(input, 100)).toBeNull();
    expect(parseStake(' 50 ', 100)).toBe(50);
  });
  it('matches the database floor rule for positive and negative American odds', () => {
    expect(estimatedReturn(50, -150)).toBe(83);
    expect(estimatedReturn(50, 150)).toBe(125);
    expect(estimatedReturn(50, -110)).toBe(95);
    expect(estimatedReturn(50, 100)).toBe(100);
    expect(estimatedReturn(50, 0)).toBeNull();
  });
});

describe('multi-pick entries', () => {
  it('converts American odds to decimal both directions', () => {
    expect(decimalOdds(100)).toBe(2);
    expect(decimalOdds(-100)).toBe(2);
    expect(decimalOdds(150)).toBe(2.5);
    expect(decimalOdds(-200)).toBe(1.5);
    for (const bad of [0, 99, -99, 1.5, NaN, null]) expect(decimalOdds(bad)).toBeNull();
  });

  it('prices a one-pick entry exactly like the straight bet it is', () => {
    for (const odds of [-110, -150, -2500, 100, 135, 1100]) {
      expect(combineOdds([odds])).toBe(odds);
      expect(entryReturn(50, [odds])).toBe(estimatedReturn(50, odds));
    }
  });

  it('multiplies the legs together', () => {
    // 2.5 x 2.5 = 6.25 -> +525
    expect(combineOdds([150, 150])).toBe(525);
    // 1.909090 x 1.909090 = 3.644628 -> +264
    expect(combineOdds([-110, -110])).toBe(264);
    // 2.35 x 2.1 x 12 = 59.22 -> +5822
    expect(combineOdds([135, 110, 1100])).toBe(5822);
  });

  it('writes a combined price under +100 as a favourite, never as +0', () => {
    // 1.04 x 1.04 = 1.0816, an 8% edge, which is -1225 not +8
    const combined = combineOdds([-2500, -2500]);
    expect(combined).toBeLessThanOrEqual(-100);
    expect(combined).toBe(-1225);
  });

  it('rejects an entry with an unpriceable leg rather than guessing', () => {
    expect(combineOdds([150, 0])).toBeNull();
    expect(combineOdds([150, 50])).toBeNull();
    expect(combineOdds([])).toBeNull();
    expect(combineOdds(null)).toBeNull();
    expect(entryReturn(50, [150, 0])).toBeNull();
  });

  it('pays a three-pick entry off the combined price', () => {
    // +5822 on 100 SIN returns the stake plus 5822
    expect(entryReturn(100, [135, 110, 1100])).toBe(5922);
    // and a six-leg entry still lands on a safe integer
    expect(entryReturn(10, [150, 150, 150, 150, 150, 150])).toBe(Number(entryReturn(10, [150, 150, 150, 150, 150, 150])));
    expect(Number.isSafeInteger(entryReturn(10, [150, 150, 150, 150, 150, 150]))).toBe(true);
  });
});

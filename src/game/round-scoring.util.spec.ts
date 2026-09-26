import {
  computeSpeedBonus,
  hintMultiplier,
  maxRoundPoints,
  scoreRound,
} from './round-scoring.util';

describe('round scoring', () => {
  const window = 20_000;
  const score = (overrides = {}) =>
    scoreRound({
      basePoints: 100,
      isCorrect: true,
      elapsedMs: 0,
      windowMs: window,
      hintsUsed: 0,
      ...overrides,
    });

  it('caps a round at the base points plus the maximum speed bonus', () => {
    expect(score().points).toBe(150);
    expect(maxRoundPoints(0)).toBe(150);
  });

  it('decreases the speed bonus linearly over the window', () => {
    expect(computeSpeedBonus(100, 0, window)).toBe(50);
    expect(computeSpeedBonus(100, 5_000, window)).toBe(38);
    expect(computeSpeedBonus(100, 10_000, window)).toBe(25);
    expect(computeSpeedBonus(100, 20_000, window)).toBe(0);
  });

  it('pays a partial match a proportionally smaller bonus', () => {
    expect(score({ basePoints: 50 }).points).toBe(75);
  });

  it('scores nothing after the window closes, even for a correct answer', () => {
    expect(score({ elapsedMs: window + 1 })).toEqual({
      points: 0,
      speedBonus: 0,
      timedOut: true,
    });
  });

  it('scores nothing for a wrong answer', () => {
    expect(score({ isCorrect: false, basePoints: 0 }).points).toBe(0);
  });

  it('takes a quarter off for each hint', () => {
    expect(hintMultiplier(0)).toBe(1);
    expect(hintMultiplier(1)).toBe(0.75);
    expect(hintMultiplier(4)).toBe(0);
    expect(score({ hintsUsed: 1 }).points).toBe(113);
  });
});

import { pickDeterministic, utcDay } from './daily-seed.util';

describe('daily seed', () => {
  const pool = Array.from({ length: 100 }, (_, i) => i + 1);

  it('picks the same lyrics for the same day, whatever order the pool is in', () => {
    const forward = pickDeterministic(pool, 10, '2026-09-26');
    const reversed = pickDeterministic([...pool].reverse(), 10, '2026-09-26');

    expect(forward).toEqual(reversed);
    expect(new Set(forward).size).toBe(10);
  });

  it('picks a different set on a different day', () => {
    expect(pickDeterministic(pool, 10, '2026-09-26')).not.toEqual(
      pickDeterministic(pool, 10, '2026-09-27'),
    );
  });

  it('uses every lyric when the pool is smaller than the set', () => {
    expect(pickDeterministic([3, 1, 2], 10, '2026-09-26').sort()).toEqual([
      1, 2, 3,
    ]);
  });

  it('names the day in UTC', () => {
    expect(utcDay(new Date('2026-09-26T23:59:59.000Z'))).toBe('2026-09-26');
    expect(utcDay(new Date('2026-09-27T00:00:00.000Z'))).toBe('2026-09-27');
  });
});

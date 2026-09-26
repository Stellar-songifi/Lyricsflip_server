export function normalizeDecade(input: string | number): string {
  const raw = String(input).trim();
  const year = raw.endsWith("s") ? Number(raw.slice(0, 4)) : Number(raw);
  if (!Number.isFinite(year)) return raw;
  return `${Math.floor(year / 10) * 10}s`;
}

export function calculateXpAward(correct: boolean, difficulty = 1, streak = 0): number {
  if (!correct) return 0;
  const streakBonus = Math.min(streak, 10) * 2;
  return Math.round((100 + streakBonus) * Math.max(difficulty, 1));
}

export function levelForXp(xp: number): number {
  return Math.floor(Math.max(xp, 0) / 1000) + 1;
}

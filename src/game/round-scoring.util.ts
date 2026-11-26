import { GAME_CONSTANTS } from './constants/game.constants';

export interface RoundScoreInput {
  /** Points the answer earned on its own (exact or partial match). */
  basePoints: number;
  isCorrect: boolean;
  /** Time between the round being issued and the guess arriving. */
  elapsedMs: number;
  windowMs: number;
  hintsUsed: number;
  /**
   * Difficulty of the round, stored as 1–5. The difficulty multiplier is only
   * applied when this is explicitly provided; otherwise the round scores its
   * base points plus speed bonus unscaled.
   */
  difficulty?: number;
  /** Consecutive correct rounds before this one. */
  streak?: number;
}

export interface RoundScore {
  points: number;
  speedBonus: number;
  /** Streak bonus awarded for the current streak. */
  streakBonus: number;
  /** Difficulty multiplier applied to the round. */
  difficultyMultiplier: number;
  /** Points removed by hints. */
  hintPenalty: number;
  /** The answer window had closed, so no points were earned. */
  timedOut: boolean;
}

/**
 * Streak bonus for a given streak, capped so it cannot run away. The bonus is
 * STREAK_BONUS per consecutive correct answer, up to MAX_STREAK_BONUS_STEPS
 * steps (e.g. 5 × 25).
 */
export function computeStreakBonus(streak: number): number {
  if (streak <= 0) return 0;
  const capped = Math.min(streak, GAME_CONSTANTS.POINTS.MAX_STREAK_BONUS_STEPS);
  return GAME_CONSTANTS.POINTS.STREAK_BONUS * capped;
}

/**
 * Speed bonus for a correct answer, falling linearly from MAX_SPEED_BONUS at
 * the moment the round is issued to 0 when the answer window closes. A partial
 * match earns a proportionally smaller bonus, like its base points.
 */
export function computeSpeedBonus(
  basePoints: number,
  elapsedMs: number,
  windowMs: number,
): number {
  if (windowMs <= 0) return 0;

  const remaining = Math.min(Math.max(1 - elapsedMs / windowMs, 0), 1);
  const share = basePoints / GAME_CONSTANTS.POINTS.CORRECT_GUESS;

  return Math.round(GAME_CONSTANTS.POINTS.MAX_SPEED_BONUS * share * remaining);
}

/** Fraction of a round's points left after `hintsUsed` hints. */
export function hintMultiplier(hintsUsed: number): number {
  const penalty = hintsUsed * GAME_CONSTANTS.POINTS.HINT_PENALTY_PERCENT;
  return Math.max(100 - penalty, 0) / 100;
}

/**
 * Maps a stored difficulty (1–5) to the configured multiplier. 1–2 are easy,
 * 3 is medium and 4–5 are hard.
 */
export function difficultyMultiplier(difficulty: number): number {
  const multipliers = GAME_CONSTANTS.POINTS.DIFFICULTY_MULTIPLIER;
  if (difficulty <= 2) return multipliers.easy;
  if (difficulty === 3) return multipliers.medium;
  return multipliers.hard;
}

/** The most a round can still score with `hintsUsed` hints taken. */
export function maxRoundPoints(hintsUsed: number): number {
  return Math.round(
    (GAME_CONSTANTS.POINTS.CORRECT_GUESS +
      GAME_CONSTANTS.POINTS.MAX_SPEED_BONUS) *
      hintMultiplier(hintsUsed),
  );
}

/**
 * Turns a matched guess into the points a round awards. Order of operations:
 * base points plus the speed bonus, scaled by the difficulty multiplier when a
 * difficulty is explicitly supplied, plus the streak bonus, then reduced by
 * the hint penalty. Nothing is awarded once the window is closed or the guess
 * is wrong.
 */
export function scoreRound(input: RoundScoreInput): RoundScore {
  const {
    basePoints,
    isCorrect,
    elapsedMs,
    windowMs,
    hintsUsed,
    difficulty,
    streak = 0,
  } = input;

  const multiplier =
    difficulty === undefined ? 1 : difficultyMultiplier(difficulty);

  if (elapsedMs > windowMs) {
    return {
      points: 0,
      speedBonus: 0,
      streakBonus: 0,
      difficultyMultiplier: multiplier,
      hintPenalty: 0,
      timedOut: true,
    };
  }

  if (!isCorrect) {
    return {
      points: 0,
      speedBonus: 0,
      streakBonus: 0,
      difficultyMultiplier: multiplier,
      hintPenalty: 0,
      timedOut: false,
    };
  }

  const speedBonus = computeSpeedBonus(basePoints, elapsedMs, windowMs);
  const streakBonus = computeStreakBonus(streak);
  const gross =
    Math.round((basePoints + speedBonus) * multiplier) + streakBonus;
  const points = Math.round(gross * hintMultiplier(hintsUsed));
  const hintPenalty = gross - points;

  return {
    points,
    speedBonus,
    streakBonus,
    difficultyMultiplier: multiplier,
    hintPenalty,
    timedOut: false,
  };
}

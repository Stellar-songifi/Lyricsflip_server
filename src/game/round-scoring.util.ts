import { GAME_CONSTANTS } from './constants/game.constants';

export interface RoundScoreInput {
  /** Points the answer earned on its own (exact or partial match). */
  basePoints: number;
  isCorrect: boolean;
  /** Time between the round being issued and the guess arriving. */
  elapsedMs: number;
  windowMs: number;
  hintsUsed: number;
}

export interface RoundScore {
  points: number;
  speedBonus: number;
  /** The answer window had closed, so no points were earned. */
  timedOut: boolean;
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

/** The most a round can still score with `hintsUsed` hints taken. */
export function maxRoundPoints(hintsUsed: number): number {
  return Math.round(
    (GAME_CONSTANTS.POINTS.CORRECT_GUESS +
      GAME_CONSTANTS.POINTS.MAX_SPEED_BONUS) *
      hintMultiplier(hintsUsed),
  );
}

/**
 * Turns a matched guess into the points a round awards: base points plus the
 * speed bonus, reduced by hints, and nothing at all once the window is closed.
 */
export function scoreRound(input: RoundScoreInput): RoundScore {
  const { basePoints, isCorrect, elapsedMs, windowMs, hintsUsed } = input;

  if (elapsedMs > windowMs) {
    return { points: 0, speedBonus: 0, timedOut: true };
  }

  if (!isCorrect) {
    return { points: 0, speedBonus: 0, timedOut: false };
  }

  const speedBonus = computeSpeedBonus(basePoints, elapsedMs, windowMs);
  const points = Math.round(
    (basePoints + speedBonus) * hintMultiplier(hintsUsed),
  );

  return { points, speedBonus, timedOut: false };
}

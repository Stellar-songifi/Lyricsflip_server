import { GAME_CONSTANTS } from './constants/game.constants';

export interface GuessMatch {
  isCorrect: boolean;
  isExactMatch: boolean;
  points: number;
}

/**
 * Normalizes a string for comparison by removing punctuation,
 * extra whitespace, and converting to lowercase.
 */
export function normalizeAnswer(str: string): string {
  if (!str) return '';

  return (
    str
      .toLowerCase()
      .trim()
      // Remove common punctuation and special characters
      .replace(/[^\w\s]/g, '')
      // Replace multiple whitespaces with single space
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Scores a guess against the correct answer (an artist or a song title).
 * Shared by solo play (GameLogicService) and rooms so both score identically.
 */
export function matchGuess(guess: string, answer: string): GuessMatch {
  const normalizedGuess = normalizeAnswer(guess);
  const normalizedAnswer = normalizeAnswer(answer);

  const isExactMatch =
    normalizedGuess.length > 0 && normalizedGuess === normalizedAnswer;

  // Partial match: one contains the other. Guesses below the minimum length
  // match almost any answer, so they are rejected rather than scored.
  const isPartialMatch =
    !isExactMatch &&
    normalizedGuess.length >=
      GAME_CONSTANTS.VALIDATION.MIN_PARTIAL_MATCH_LENGTH &&
    (normalizedGuess.includes(normalizedAnswer) ||
      normalizedAnswer.includes(normalizedGuess));

  let points = 0;
  if (isExactMatch) {
    points = GAME_CONSTANTS.POINTS.CORRECT_GUESS;
  } else if (isPartialMatch) {
    points = GAME_CONSTANTS.POINTS.PARTIAL_MATCH;
  }

  return { isCorrect: isExactMatch || isPartialMatch, isExactMatch, points };
}

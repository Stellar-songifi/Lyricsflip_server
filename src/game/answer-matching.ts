/**
 * Single source of truth for answer matching across every game mode
 * (solo play, rooms, daily challenge, WebSocket gateway).
 *
 * Replaces the previous three normalisers (`guess-matcher.ts`,
 * `answer-matching.util.ts` and `LyricsService.normalizeAnswer`).
 */

import { GAME_CONSTANTS } from './constants/game.constants';

/** Maximum number of aliases accepted per lyric (artist or title). */
export const MAX_ALIASES = 20;

/** Points awarded for an exact match. */
export const EXACT_MATCH_POINTS = GAME_CONSTANTS.POINTS.CORRECT_GUESS;

/** Points awarded for a non-exact (alias / normalised) match. */
export const PARTIAL_MATCH_POINTS = GAME_CONSTANTS.POINTS.PARTIAL_MATCH;

const LEADING_ARTICLES = /^(the|a|an)\s+/;

/**
 * Normalise an answer for comparison.
 *
 * - NFKD decomposition, then strip combining diacritics so `Beyoncé`,
 *   `Beyonce` and `BEYONCÉ` all collapse to `beyonce`.
 * - `&` becomes `and`.
 * - `feat.` / `ft.` (and their variants) are removed.
 * - Leading articles (`the`, `a`, `an`) are dropped.
 * - Punctuation is removed and whitespace collapsed.
 */
export function normalizeAnswer(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  let result = value
    .normalize('NFKD')
    // Strip combining diacritical marks (U+0300–U+036F).
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // Remove "feat." / "ft." and everything that follows it.
    .replace(/\b(feat|ft|featuring)\b\.?.*$/g, ' ')
    // Replace any remaining non-alphanumeric characters with a space.
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  result = result.replace(LEADING_ARTICLES, '').trim();

  return result;
}

export interface MatchResult {
  isCorrect: boolean;
  isExact: boolean;
  points: number;
}

/**
 * Levenshtein edit distance between two strings.
 * Used for typo tolerance in partial matching.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (!a.length) {
    return b.length;
  }
  if (!b.length) {
    return a.length;
  }

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }

  return previous[b.length];
}

/**
 * Compare edit distance against the configured length-scaled typo allowance.
 */
function isTypoMatch(guess: string, target: string): boolean {
  const longest = Math.max(guess.length, target.length);
  const allowance = Math.max(
    GAME_CONSTANTS.MATCHING.MIN_LEVENSHTEIN_DISTANCE,
    Math.floor(longest * GAME_CONSTANTS.MATCHING.MAX_LEVENSHTEIN_RATIO),
  );
  return levenshtein(guess, target) <= allowance;
}

/**
 * Determine whether a guess partially matches a target string.
 *
 * A partial match occurs when the guess shares enough tokens with the
 * target (token overlap ratio) or is a close typo of the target.
 */
function isPartialMatch(guess: string, target: string): boolean {
  if (
    !target ||
    guess.length < GAME_CONSTANTS.VALIDATION.MIN_PARTIAL_MATCH_LENGTH
  ) {
    return false;
  }

  if (isTypoMatch(guess, target)) {
    return true;
  }

  const stopWords: readonly string[] = GAME_CONSTANTS.MATCHING.STOP_WORDS;
  const tokens = (value: string) =>
    new Set(
      value.split(' ').filter((token) => token && !stopWords.includes(token)),
    );
  const guessTokens = tokens(guess);
  const targetTokens = tokens(target);
  const overlap = [...guessTokens].filter((token) =>
    targetTokens.has(token),
  ).length;
  const total = guessTokens.size + targetTokens.size;
  return (
    overlap > 0 &&
    (overlap / (total - overlap) >= GAME_CONSTANTS.MATCHING.MIN_JACCARD ||
      (2 * overlap) / total >= GAME_CONSTANTS.MATCHING.MIN_DICE)
  );
}

/**
 * Match a guess against the canonical answer and any accepted aliases.
 *
 * - An exact match (guess equals the canonical answer after normalisation)
 *   earns full points.
 * - A match against an alias earns full points.
 * - A partial (token overlap / typo) match earns partial points.
 */
export function matchAnswer(
  guess: string | null | undefined,
  canonical: string | null | undefined,
  aliases: string[] = [],
): MatchResult {
  const normalizedGuess = normalizeAnswer(guess);

  if (!normalizedGuess) {
    return { isCorrect: false, isExact: false, points: 0 };
  }

  const normalizedCanonical = normalizeAnswer(canonical);

  if (normalizedCanonical && normalizedGuess === normalizedCanonical) {
    return {
      isCorrect: true,
      isExact: true,
      points: EXACT_MATCH_POINTS,
    };
  }

  const normalizedAliases = (aliases ?? [])
    .map((alias) => normalizeAnswer(alias))
    .filter(Boolean);

  if (normalizedAliases.includes(normalizedGuess)) {
    return {
      isCorrect: true,
      isExact: true,
      points: EXACT_MATCH_POINTS,
    };
  }

  const candidates = [normalizedCanonical, ...normalizedAliases].filter(
    Boolean,
  );

  const partial = candidates.some((candidate) =>
    isPartialMatch(normalizedGuess, candidate),
  );

  if (partial) {
    return {
      isCorrect: true,
      isExact: false,
      points: PARTIAL_MATCH_POINTS,
    };
  }

  return { isCorrect: false, isExact: false, points: 0 };
}

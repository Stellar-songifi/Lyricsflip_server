/**
 * Single source of truth for answer matching across every game mode
 * (solo play, rooms, daily challenge, WebSocket gateway).
 *
 * Replaces the previous three normalisers (`guess-matcher.ts`,
 * `answer-matching.util.ts` and `LyricsService.normalizeAnswer`).
 */

import { GAME_CONSTANTS } from './constants/game.constants';

/** Maximum number of aliases accepted per lyric (artist or title). */
export const MAX_ALIASES = GAME_CONSTANTS.MATCHING.MAX_ALIASES;

/** Points awarded for an exact match. */
export const EXACT_MATCH_POINTS = GAME_CONSTANTS.MATCHING.EXACT_MATCH_POINTS;

/** Points awarded for a non-exact (alias / normalised) match. */
export const PARTIAL_MATCH_POINTS = GAME_CONSTANTS.MATCHING.PARTIAL_MATCH_POINTS;

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
 * Similarity ratio in [0, 1] between two strings, derived from edit distance.
 */
function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) {
    return 1;
  }
  return 1 - levenshtein(a, b) / longest;
}

/**
 * Determine whether a guess is a close-enough typo of a target string.
 */
function isTypoMatch(guess: string, target: string): boolean {
  if (!guess || !target) {
    return false;
  }
  const distance = levenshtein(guess, target);
  if (distance > GAME_CONSTANTS.MATCHING.PARTIAL_MATCH_MAX_TYPO_DISTANCE) {
    return false;
  }
  return similarity(guess, target) >= GAME_CONSTANTS.MATCHING.PARTIAL_MATCH_MIN_SIMILARITY;
}

/**
 * Determine whether a guess partially matches a target string.
 *
 * A partial match occurs when the guess shares enough tokens with the
 * target (token overlap ratio) or is a close typo of the target.
 */
function isPartialMatch(guess: string, target: string): boolean {
  if (!guess || !target) {
    return false;
  }

  if (isTypoMatch(guess, target)) {
    return true;
  }

  const guessTokens = guess.split(' ').filter(Boolean);
  const targetTokens = target.split(' ').filter(Boolean);

  if (!guessTokens.length || !targetTokens.length) {
    return false;
  }

  const targetSet = new Set(targetTokens);
  const overlap = guessTokens.filter((token) => targetSet.has(token)).length;
  const ratio = overlap / targetTokens.length;

  return ratio >= GAME_CONSTANTS.MATCHING.PARTIAL_MATCH_TYPO_RATIO;
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

  const candidates = [normalizedCanonical, ...normalizedAliases].filter(Boolean);

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

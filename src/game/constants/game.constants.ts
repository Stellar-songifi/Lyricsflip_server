/**
 * XP awarded for each correct guess, before difficulty and speed bonuses.
 */
export const XP_PER_CORRECT_GUESS = 10;

export interface LevelThreshold {
  level: number;
  xp: number;
  title: string;
}

/**
 * Cumulative XP required to reach each level, plus the display title.
 */
export const LEVEL_THRESHOLDS: readonly LevelThreshold[] = [
  { level: 1, xp: 0, title: 'Novice' },
  { level: 2, xp: 100, title: 'Listener' },
  { level: 3, xp: 300, title: 'Fan' },
  { level: 4, xp: 600, title: 'Devotee' },
  { level: 5, xp: 1000, title: 'Expert' },
  { level: 6, xp: 1500, title: 'Virtuoso' },
  { level: 7, xp: 2100, title: 'Maestro' },
  { level: 8, xp: 2800, title: 'Legend' },
  { level: 9, xp: 3600, title: 'Icon' },
  { level: 10, xp: 4500, title: 'Immortal' },
] as const;

export const MAX_LEVEL = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1].level;

export const GAME_CONSTANTS = {
  POINTS: {
    CORRECT_GUESS: 100,
    PARTIAL_MATCH: 50,
    STREAK_BONUS: 25,
    /**
     * Largest speed bonus, awarded for an instant correct exact guess. It
     * decreases linearly to zero as the answer window closes, so the most a
     * round can score is CORRECT_GUESS + MAX_SPEED_BONUS (150) with no hints.
     */
    MAX_SPEED_BONUS: 50,
    /** Share of a round's points each hint used takes away. */
    HINT_PENALTY_PERCENT: 25,
    DIFFICULTY_MULTIPLIER: {
      easy: 1,
      medium: 1.5,
      hard: 2,
    },
    /**
     * Maps the stored 1-5 difficulty to a DIFFICULTY_MULTIPLIER key.
     * 1-2 => easy, 3 => medium, 4-5 => hard.
     */
    DIFFICULTY_TIER: {
      1: 'easy',
      2: 'easy',
      3: 'medium',
      4: 'hard',
      5: 'hard',
    },
  },
  LIMITS: {
    MAX_LYRICS_PER_REQUEST: 20,
    MAX_GUESS_LENGTH: 200,
    MIN_GUESS_LENGTH: 1,
    SESSION_TIMEOUT_MINUTES: 30,
    /** Hard expiry: past this a round can no longer be guessed at all. */
    ROUND_TIMEOUT_SECONDS: 120,
    /**
     * Default answer window. A guess after it is still accepted (until
     * ROUND_TIMEOUT_SECONDS) but earns no points. Override with
     * ROUND_ANSWER_WINDOW_SECONDS.
     */
    ROUND_ANSWER_WINDOW_SECONDS: 20,
    /** Hint levels: 1 genre and word counts, 2 first letters. */
    MAX_HINTS: 2,
    MAX_HINTS_PER_ROUND: 2,
    DAILY_CHALLENGE_SIZE: 10,
    /**
     * How many days back a lyric counts as "seen" when picking a random
     * round, so recently played songs are not repeated.
     */
    SEEN_WINDOW_DAYS: 30,
    /** How long finished game rounds are kept before the retention job prunes them. */
    ROUND_RETENTION_DAYS: 30,
  },
  VALIDATION: {
    MIN_PARTIAL_MATCH_LENGTH: 3,
  },
  /**
   * Token-based partial-match tuning. A guess is only a partial match when it
   * is similar enough to the answer under one of two rules: token overlap
   * (Jaccard/Dice) or a length-scaled Levenshtein distance for typos.
   */
  MATCHING: {
    /**
     * Minimum Jaccard score (|A∩B| / |A∪B|) over normalised tokens. High
     * enough that a single shared word like "love" or "the" never passes.
     */
    MIN_JACCARD: 0.6,
    /**
     * Minimum Dice score (2|A∩B| / (|A|+|B|)) over normalised tokens. Slightly
     * more forgiving than Jaccard for answers with extra words.
     */
    MIN_DICE: 0.75,
    /**
     * Levenshtein distance allowed for typos, as a fraction of the longer
     * string's length (e.g. 0.2 → 1 typo per 5 characters).
     */
    MAX_LEVENSHTEIN_RATIO: 0.2,
    /** Absolute floor for the typo distance so short answers still allow 1. */
    MIN_LEVENSHTEIN_DISTANCE: 1,
    /**
     * Words ignored when comparing tokens: articles, conjunctions and the
     * "feat."/"ft." markers that introduce featuring artists.
     */
    STOP_WORDS: [
      'the',
      'a',
      'an',
      'of',
      'and',
      'feat',
      'featuring',
      'ft',
    ],
  },
  XP: {
    PER_CORRECT_GUESS: XP_PER_CORRECT_GUESS,
    LEVEL_THRESHOLDS,
    MAX_LEVEL,
  },
} as const;

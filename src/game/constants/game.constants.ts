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
    /** Hint levels: 1 decade, 2 word counts, 3 first letters. */
    MAX_HINTS: 3,
    DAILY_CHALLENGE_SIZE: 10,
  },
  VALIDATION: {
    MIN_PARTIAL_MATCH_LENGTH: 3,
  },
} as const;

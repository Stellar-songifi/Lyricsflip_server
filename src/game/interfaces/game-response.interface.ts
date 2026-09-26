export interface GameLyricResponse {
  /** The round to guess against with `POST /game/guess`. */
  roundId: string;
  issuedAt: Date;
  /** Hard expiry: the round cannot be guessed after this. */
  expiresAt: Date;
  /** Seconds after `issuedAt` in which a guess still earns points. */
  answerWindowSeconds: number;
  id: number;
  lyricSnippet: string;
  // Note: We don't include songTitle and artist in the response to avoid spoilers
  category?: string;
  decade?: string;
  genre?: string;
}

export interface GuessResultResponse {
  isCorrect: boolean;
  correctAnswer: string;
  explanation: string;
  points: number;
  /** Part of `points` earned by answering quickly. */
  speedBonus: number;
  /** The answer window had closed, so no points were awarded. */
  timedOut: boolean;
  hintsUsed: number;
  bonus?: {
    type: string;
    points: number;
    description: string;
  };
}

export interface RoundHintResponse {
  level: number;
  hintsRemaining: number;
  maxPoints: number;
  decade?: string | null;
  wordCount?: { songTitle: number; artist: number };
  firstLetter?: { songTitle: string; artist: string };
}

export interface GameStatsResponse {
  totalCount: number;
  availableCategories: string[];
  availableDecades: string[];
  availableGenres: string[];
}

export interface SessionStats {
  correctGuesses: number;
  totalGuesses: number;
  totalPoints: number;
  averagePoints: number;
  streak: number;
  bestStreak: number;
}

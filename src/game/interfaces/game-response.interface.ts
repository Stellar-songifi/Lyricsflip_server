export interface GameLyricResponse {
  /** The round to guess against with `POST /game/guess`. */
  roundId: string;
  expiresAt: Date;
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
  bonus?: {
    type: string;
    points: number;
    description: string;
  };
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

export interface GameHistoryRecord {
  userId: string;
  lyricId: string;
  answer: string;
  correct: boolean;
  xpAwarded: number;
  createdAt: Date;
}

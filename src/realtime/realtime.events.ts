/**
 * The realtime event contract, shared by the services that raise events and the
 * gateway that delivers them. Documented for clients in docs/realtime.md.
 *
 * Every event is raised in-process on the EventEmitter2 bus under the same name
 * it is delivered to clients with. No payload carries an answer or a lyric.
 */
export enum RealtimeEvent {
  PLAYER_JOINED = 'session.player_joined',
  ROUND_STARTED = 'round.started',
  ROUND_ENDED = 'round.ended',
  SESSION_COMPLETED = 'session.completed',
  WAGER_STAKED = 'wager.staked',
  WAGER_SETTLED = 'wager.settled',
}

/** Socket.IO room names. A socket only joins one it is a member of. */
export const realtimeRooms = {
  user: (userId: string) => `user:${userId}`,
  session: (sessionId: string) => `session:${sessionId}`,
  room: (roomId: string) => `room:${roomId}`,
};

export interface PlayerJoinedPayload {
  scope: 'session' | 'room';
  sessionId?: string;
  roomId?: string;
  userId: string;
}

export interface RoundStartedPayload {
  roundId: string;
  sessionId: string | null;
  userId: string;
  issuedAt: Date;
  expiresAt: Date;
  answerWindowSeconds: number;
}

export interface RoundEndedPayload {
  roundId: string;
  sessionId: string | null;
  userId: string;
  isCorrect: boolean;
  points: number;
  speedBonus: number;
  /** The answer window had closed (or the round expired), so nothing scored. */
  timedOut: boolean;
  hintsUsed: number;
}

export interface SessionCompletedPayload {
  sessionId: string;
  playerId: string | null;
  playerTwoId: string | null;
  winnerId: string | null;
  score: number;
  playerTwoScore: number;
}

export interface WagerStakedPayload {
  wagerId: string;
  sessionId: string;
  playerAId: string;
  playerBId: string;
  stakeStroops: string;
  totalPotStroops: string;
}

export interface WagerSettledPayload {
  wagerId: string;
  sessionId: string;
  playerAId: string;
  playerBId: string;
  /** `won` pays the winner; `refunded` returns both stakes. */
  outcome: 'won' | 'refunded';
  winnerId: string | null;
  totalPotStroops: string;
}

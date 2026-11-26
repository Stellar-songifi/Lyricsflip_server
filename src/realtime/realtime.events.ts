/**
 * The realtime event contract, shared by the services that raise events and the
 * gateway that delivers them. Documented for clients in docs/realtime.md.
 *
 * Every event is raised in-process on the EventEmitter2 bus under the same name
 * it is delivered to clients with. No payload carries an answer or a lyric.
 */
export enum RealtimeEvent {
  USER_SESSIONS_REVOKED = 'user.sessions_revoked',
  PLAYER_JOINED = 'session.player_joined',
  ROUND_STARTED = 'round.started',
  ROUND_ENDED = 'round.ended',
  SESSION_COMPLETED = 'session.completed',
  MATCH_FOUND = 'match.found',
  TOURNAMENT_BRACKET_UPDATED = 'tournament.bracket_updated',
  WAGER_STAKED = 'wager.staked',
  WAGER_SETTLED = 'wager.settled',
}

/**
 * Version of the realtime wire contract. Bumped whenever an event name or
 * payload shape changes in a breaking way. Clients receive it on `connected`.
 */
export const REALTIME_PROTOCOL_VERSION = 1;

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

/** Payload of the `connected` handshake event, carrying the contract version. */
export interface ConnectedPayload {
  protocolVersion: number;
  userId: string;
}

/** Payload of the `/game` gateway's `newLyric` event. */
export interface NewLyricPayload {
  roundId: string;
  sessionId: string | null;
  lyric: string;
  issuedAt: Date;
  expiresAt: Date;
}

/** Payload of the `/game` gateway's `guessResult` event. */
export interface GuessResultPayload {
  roundId: string;
  isCorrect: boolean;
  points: number;
  speedBonus: number;
  timedOut: boolean;
  hintsUsed: number;
}

/** Payload of the `/game` gateway's `hintResult` event. */
export interface HintResultPayload {
  roundId: string;
  hint: string;
  hintsUsed: number;
  hintsRemaining: number;
}

/** Payload of the `/game` gateway's `sessionInfo` event. */
export interface SessionInfoPayload {
  sessionId: string;
  playerId: string | null;
  playerTwoId: string | null;
  score: number;
  playerTwoScore: number;
  status: string;
}

/**
 * Events the server emits to clients. Keys are the wire event names; values are
 * the payload types. Used to type Socket.IO servers and generated client docs.
 */
export interface ServerToClientEvents {
  connected: (payload: ConnectedPayload) => void;
  'session.player_joined': (payload: PlayerJoinedPayload) => void;
  'round.started': (payload: RoundStartedPayload) => void;
  'round.ended': (payload: RoundEndedPayload) => void;
  'session.completed': (payload: SessionCompletedPayload) => void;
  'wager.staked': (payload: WagerStakedPayload) => void;
  'wager.settled': (payload: WagerSettledPayload) => void;
  newLyric: (payload: NewLyricPayload) => void;
  guessResult: (payload: GuessResultPayload) => void;
  hintResult: (payload: HintResultPayload) => void;
  sessionInfo: (payload: SessionInfoPayload) => void;
}

/**
 * Events clients may emit to the server. The realtime contract is currently
 * server-push only, so this map is intentionally empty.
 */
export interface ClientToServerEvents {}

/** Per-socket data attached to each connection. */
export interface InterServerEvents {}

export interface SocketData {
  userId?: string;
}

import { ConfigService } from '@nestjs/config';
import {
  DomainException,
  ErrorCode,
} from '../common/exceptions/domain.exception';
import {
  HttpStatus,
  Injectable,
  Optional,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
import { LessThan, Repository } from 'typeorm';
import {
  GameSession,
  GameSessionStatus,
  GameMode,
} from './entities/game-session.entity';
import { CreateGameSessionDto } from './dto/create-game-session.dto';
import { UpdateGameSessionDto } from './dto/update-game-session.dto';
import { User } from '../users/entities/user.entity';
import { WagerService } from '../tokens/services/wager.service';
import { Wager, WagerStatus } from '../tokens/entities/wager.entity';
import { Role } from '../auth/roles/role.enum';
import {
  TOKEN_SERVICE,
  ITokenService,
} from '../tokens/interfaces/token.interface';
import {
  Stroops,
  fromStroops,
  isPositive,
  toStroops,
} from '../stellar/amount.util';
import type { WagerResult } from '../tokens/services/wager.service';
import type { UnsignedTransaction } from '../stellar/services/stellar-rpc.service';
import { sanitizeForDisplay } from '../common/utils/sanitize.util';
import { JobLockService } from '../jobs/job-lock.service';
import { assertPlayersCanInteract } from '../moderation/player-blocks';
import { assertEmailVerified } from '../auth/verified-email.util';

/**
 * A created session, plus the wager handshake when there is one.
 *
 * `pendingSignatures` is the whole point of the extra fields: in non-custodial
 * mode the backend cannot sign a player's stake, so the transactions the
 * wallets have to sign are returned here. Without them the client has no way
 * to fund a pot that has just been opened on-chain.
 */
export type CreateGameSessionResponse = GameSession & {
  wager?: Wager;
  pendingSignatures?: Array<{
    userId: string;
    transaction: UnsignedTransaction;
  }>;
};

/** Wager states in which no funds are left in escrow. */
const TERMINAL_WAGER_STATUSES = [
  WagerStatus.WON,
  WagerStatus.REFUNDED,
  WagerStatus.FAILED,
];

/** How often unanswered invitations are swept up and refunded. */
const INVITATION_SWEEP_INTERVAL_MS = 60 * 1000;

/** Advisory-lock name for the invitation sweep. */
const INVITATION_SWEEP_LOCK = 'invitation-expiry';

/**
 * Series scoring.
 *
 * A series is a best-of-N run of games between the same pair of players. The
 * series ends as soon as one player has won `ceil(N / 2)` games. Settlement
 * decision: a wagered series is settled **per game** — each game's wager is
 * created and settled independently, so a player who is already out of the
 * series is never on the hook for a stake they did not agree to. The series
 * itself only tracks the score and decides when the run is over.
 */
const DEFAULT_SERIES_LENGTH = 1;
const MAX_SERIES_LENGTH = 9;

/** Number of wins needed to take a best-of-N series. */
function winsNeeded(seriesLength: number): number {
  return Math.floor(seriesLength / 2) + 1;
}

@Injectable()
export class GameSessionsService {
  private readonly logger = new Logger(GameSessionsService.name);
  /** Every settlement decision is written here: who, with what, and the result. */
  private readonly auditLogger = new Logger('SettlementAudit');

  constructor(
    @InjectRepository(GameSession)
    private readonly gameSessionRepository: Repository<GameSession>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly wagerService: WagerService,
    @Inject(TOKEN_SERVICE)
    private readonly tokenService: ITokenService,
    private readonly jobLockService: JobLockService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  private get invitationTtlMs(): number {
    return (this.config?.get<number>('INVITATION_TTL_MINUTES') ?? 30) * 60_000;
  }

  async create(
    createGameSessionDto: CreateGameSessionDto,
    player: User,
  ): Promise<CreateGameSessionResponse> {
    const { mode, playerTwoId, wagerAmount } = createGameSessionDto;

    // Validate multiplayer/wagered game requirements
    if (mode === GameMode.MULTIPLAYER || mode === GameMode.WAGERED) {
      if (!playerTwoId) {
        throw new BadRequestException(
          'Player Two ID is required for multiplayer games',
        );
      }

      const playerTwo = await this.userRepository.findOne({
        where: { id: playerTwoId },
      });

      if (!playerTwo) {
        throw new NotFoundException(
          `Player Two with ID ${playerTwoId} not found`,
        );
      }

      if (player.id === playerTwoId) {
        throw new BadRequestException('Cannot play against yourself');
      }
    }

    if (playerTwoId) {
      await assertPlayersCanInteract(
        this.userRepository.manager,
        player.id,
        playerTwoId,
      );
    }

    // Validate wagered game requirements
    // Parsed once here so that a malformed amount is rejected before a session
    // row is written, and every downstream call works in stroops.
    let stake: Stroops | undefined;

    if (mode === GameMode.WAGERED) {
      if (!wagerAmount || !isPositive((stake = toStroops(wagerAmount)))) {
        throw new BadRequestException(
          'Wager amount must be greater than 0 for wagered games',
        );
      }

      if (!playerTwoId) {
        throw new BadRequestException(
          'Player Two ID is required for wagered games',
        );
      }

      assertEmailVerified(player, 'create a wager');

      // Check if both players have sufficient tokens
      const [playerOneBalance, playerTwoBalance] = await Promise.all([
        this.tokenService.hasSufficientTokens(player.id, stake),
        this.tokenService.hasSufficientTokens(playerTwoId, stake),
      ]);

      if (!playerOneBalance) {
        throw new DomainException(
          ErrorCode.INSUFFICIENT_BALANCE,
          HttpStatus.BAD_REQUEST,
          `You have insufficient tokens for this wager (${fromStroops(stake)} LYRIC required)`,
        );
      }

      if (!playerTwoBalance) {
        const playerTwo = await this.userRepository.findOne({
          where: { id: playerTwoId },
        });
        throw new DomainException(
          ErrorCode.INSUFFICIENT_BALANCE,
          HttpStatus.BAD_REQUEST,
          `${sanitizeForDisplay(playerTwo?.username) || 'Player Two'} has insufficient tokens for this wager`,
        );
      }
    }

    // `wagerAmount` is the display amount on the wire; the column stores
    // stroops, so it is replaced rather than carried through.
    const sessionFields = { ...createGameSessionDto };
    delete sessionFields.wagerAmount;

    const gameSession = this.gameSessionRepository.create({
      ...sessionFields,
      hasWager: mode === GameMode.WAGERED,
      player,
      wagerStroops: stake ?? null,
      status:
        mode === GameMode.MULTIPLAYER || mode === GameMode.WAGERED
          ? GameSessionStatus.WAITING_FOR_PLAYER
          : GameSessionStatus.IN_PROGRESS,
    });

    const savedGameSession = await this.gameSessionRepository.save(gameSession);

    // Create wager if this is a wagered game
    if (mode === GameMode.WAGERED && stake && playerTwoId) {
      const wagerResult = await this.wagerService.createWager({
        sessionId: savedGameSession.id,
        playerAId: player.id,
        playerBId: playerTwoId,
        stake,
      });

      if (!wagerResult.success) {
        // If wager creation fails, delete the game session
        await this.gameSessionRepository.delete(savedGameSession.id);
        throw new DomainException(
          wagerResult.code ?? ErrorCode.BAD_REQUEST,
          HttpStatus.BAD_REQUEST,
          `Failed to create wager: ${wagerResult.message}`,
        );
      }

      // Returned alongside the session rather than discarded: a wager waiting
      // on wallet signatures is unfundable unless the client receives them.
      return {
        ...savedGameSession,
        wager: wagerResult.wager,
        ...(wagerResult.pendingSignatures?.length
          ? { pendingSignatures: wagerResult.pendingSignatures }
          : {}),
      };
    }

    return savedGameSession;
  }

  /**
   * Offers a rematch after a finished game.
   *
   * The new session reuses the original opponent, mode and stake, so the
   * opponent only has to accept once. When the original game belonged to a
   * series, the rematch continues that series (same `seriesId`, same
   * `seriesLength`) and is refused once the series has been decided.
   */
  async rematch(
    sessionId: string,
    player: User,
  ): Promise<CreateGameSessionResponse> {
    const original = await this.gameSessionRepository.findOne({
      where: { id: sessionId },
      relations: ['player'],
    });

    if (!original) {
      throw new NotFoundException(`Game session ${sessionId} not found`);
    }

    const isPlayerOne = original.player?.id === player.id;
    const isPlayerTwo = original.playerTwoId === player.id;

    if (this.isExpired(gameSession)) {
      await this.abandonInvitation(gameSession);
      throw new DomainException(
        ErrorCode.INVITATION_EXPIRED,
        HttpStatus.GONE,
        'This invitation has expired',
      );
    if (!isPlayerOne && !isPlayerTwo) {
      throw new ForbiddenException('You are not a player in this session');
    }

    if (!gameSession.player) {
      throw new ForbiddenException('This interaction is unavailable');
    }
    await assertPlayersCanInteract(
      this.userRepository.manager,
      gameSession.player.id,
      user.id,
    );

    if (!this.isWagered(gameSession)) {
      gameSession.status = GameSessionStatus.IN_PROGRESS;
      return this.gameSessionRepository.save(gameSession);
    if (original.status !== GameSessionStatus.COMPLETED) {
      throw new BadRequestException(
        'A rematch can only be offered after the game has finished',
      );
    }

    const opponentId = isPlayerOne ? original.playerTwoId : original.player.id;

    if (!opponentId) {
      throw new BadRequestException(
        'This session has no opponent to rematch against',
      );
    }

    // Series bookkeeping: continue the run, or start a fresh one.
    const seriesId = original.seriesId ?? original.id;
    const seriesLength = original.seriesLength ?? DEFAULT_SERIES_LENGTH;

    return {
      ...saved,
      wager: wagerResult.wager,
      ...(wagerResult.pendingSignatures?.length
        ? { pendingSignatures: wagerResult.pendingSignatures }
        : {}),
    };
  }

  /** Player two declines an invitation; player one's stake is refunded. */
  async decline(
    sessionId: string,
    user: User,
  ): Promise<{ gameSession: GameSession; wagerResult?: WagerResult }> {
    const gameSession = await this.requireInvitation(sessionId, user);
    return this.abandonInvitation(gameSession);
  }

  /** Abandons invitations left unanswered too long, refunding player one. */
  async expireInvitations(): Promise<number> {
    const expired = await this.gameSessionRepository.find({
      where: {
        status: GameSessionStatus.WAITING_FOR_PLAYER,
        createdAt: LessThan(new Date(Date.now() - this.invitationTtlMs)),
      },
    });
    if (original.seriesId) {
      const seriesSessions = await this.gameSessionRepository.find({
        where: { seriesId },
      });

      if (this.isSeriesDecided(seriesSessions, seriesLength)) {
        throw new ConflictException(
          'This series has already been decided; start a new one',
        );
      }
    }

    return expired.length;
  }

  private async requireInvitation(
    sessionId: string,
    user: User,
  ): Promise<GameSession> {
    const gameSession = await this.gameSessionRepository.findOne({
      where: { id: sessionId },
      relations: { player: true },
    const rematchSession = this.gameSessionRepository.create({
      mode: original.mode,
      player,
      playerTwoId: opponentId,
      hasWager: original.hasWager,
      wagerStroops: original.wagerStroops ?? null,
      seriesId,
      seriesLength,
      status: GameSessionStatus.WAITING_FOR_PLAYER,
    });

    const saved = await this.gameSessionRepository.save(rematchSession);

    if (original.hasWager && original.wagerStroops) {
      const wagerResult = await this.wagerService.createWager({
        sessionId: saved.id,
        playerAId: player.id,
        playerBId: opponentId,
        stake: original.wagerStroops as Stroops,
      });

      if (!wagerResult.success) {
        await this.gameSessionRepository.delete(saved.id);
        throw new BadRequestException(
          `Failed to create wager: ${wagerResult.message}`,
        );
      }

      return {
        ...saved,
        wager: wagerResult.wager,
        ...(wagerResult.pendingSignatures?.length
          ? { pendingSignatures: wagerResult.pendingSignatures }
          : {}),
      };
    }

    return { gameSession: saved, wagerResult };
  }

  private isWagered(gameSession: GameSession): boolean {
    return gameSession.mode === GameMode.WAGERED || gameSession.hasWager;
  }

  private isExpired(gameSession: GameSession): boolean {
    return gameSession.createdAt.getTime() <= Date.now() - this.invitationTtlMs;
    return saved;
  }

  /**
   * Records a game result and, when the game belongs to a series, updates the
   * series score. A best-of-N series is decided as soon as one player has won
   * `ceil(N / 2)` games.
   */
  async recordSeriesResult(
    sessionId: string,
    winnerId: string,
  ): Promise<{ seriesId: string | null; decided: boolean; winnerId: string | null }> {
    const session = await this.gameSessionRepository.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Game session ${sessionId} not found`);
    }

    if (!session.seriesId) {
      return { seriesId: null, decided: false, winnerId: null };
    }

    const seriesSessions = await this.gameSessionRepository.find({
      where: { seriesId: session.seriesId },
    });

    const seriesLength = session.seriesLength ?? DEFAULT_SERIES_LENGTH;
    const decided = this.isSeriesDecided(seriesSessions, seriesLength);

    return {
      seriesId: session.seriesId,
      decided,
      winnerId: decided ? this.seriesWinner(seriesSessions, seriesLength) : null,
    };
  }

  /** True once one player has reached the wins needed to take the series. */
  private isSeriesDecided(
    sessions: GameSession[],
    seriesLength: number,
  ): boolean {
    return this.seriesWinner(sessions, seriesLength) !== null;
  }

  async remove(id: string, user: User): Promise<void> {
    await this.findOne(id, user);
    const [tournamentMatch] = await this.gameSessionRepository.query<unknown[]>(
      'SELECT 1 FROM tournament_matches WHERE "sessionId" = $1 AND "finishedAt" IS NULL',
      [id],
    );
    if (tournamentMatch) {
      throw new ConflictException('An active tournament session cannot be deleted');
    }
  /**
   * Returns the player who has clinched the series, or null while it is still
   * open. Wins are counted from completed sessions only.
   */
  private seriesWinner(
    sessions: GameSession[],
    seriesLength: number,
  ): string | null {
    const needed = winsNeeded(seriesLength);
    const wins = new Map<string, number>();

    for (const session of sessions) {
      if (session.status !== GameSessionStatus.COMPLETED) {
        continue;
      }

      const winnerId = session.winnerId;
      if (!winnerId) {
        continue;
      }

      const count = (wins.get(winnerId) ?? 0) + 1;
      if (count >= needed) {
        return winnerId;
      }
      wins.set(winnerId, count);
    }

    return null;
  }

  /**
   * Admins see every session; everyone else sees the ones they play in.
   * Both are paginated.
   */
  async findAll(
    user: User,
    limit: number = 20,
    offset: number = 0,
  ): Promise<GameSession[]> {
    if (user.role === Role.Admin) {
      return this.gameSessionRepository.find({
        relations: ['player'],
        order: { createdAt: 'DESC' },
        take: limit,
        skip: offset,
      });
    }

    return this.gameSessionRepository.find({
      where: [{ player: { id: user.id } }, { playerTwoId: user.id }],
      relations: ['player'],
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Sweeps unanswered invitations. Runs on every instance's timer, but the
   * advisory lock inside `runExclusive` ensures only one instance actually
   * performs the sweep per tick.
   */
  @Interval(INVITATION_SWEEP_INTERVAL_MS)
  async sweepExpiredInvitations(): Promise<void> {
    try {
      await this.jobLockService.runExclusive(INVITATION_SWEEP_LOCK, () =>
        this.expireInvitations(),
      );
    } 

    const updatedGameSession =
      await this.gameSessionRepository.save(gameSession);

    this.auditLogger.log(
      JSON.stringify({
        event: 'wager.settlement',
        sessionId,
        triggeredBy: { id: triggeredBy.id, role: triggeredBy.role },
        playerOneScore,
        playerTwoScore,
        winnerId: gameSession.winnerId ?? null,
        success: wagerResult.success,
        wagerStatus: wagerResult.wager?.status ?? null,
        settlementTxHash: wagerResult.wager?.settlementTxHash ?? null,
      }),
    );

    return {
      gameSession: updatedGameSession,
      wagerResult,
      message,
      // Structured fields alongside the human-readable message, so clients
      // do not have to parse the winner's name back out of prose.
      winnerId,
      winnerUsername,
    };
  }

  /**
   * Gets the user's token balance, in stroops alongside a display rendering.
   *
   * Both are returned because callers need different ones: the display string
   * is what a UI shows, the stroop string is what has to be echoed back as a
   * stake without losing precision.
   */
  async getUserTokenBalance(
    userId: string,
  ): Promise<{ stroops: Stroops; display: string }> {
    const stroops = await this.tokenService.getUserBalance(userId);
    return { stroops, display: fromStroops(stroops) };
  }

  /**
   * Submits a stake transaction the player signed in their wallet.
   *
   * This is the other half of the `pendingSignatures` returned by
   * {@link create}: the client signs that XDR and posts it back here, and the
   * wager becomes `STAKED` once both players have done so.
   */
  async confirmStake(
    sessionId: string,
    userId: string,
    signedTransaction: string,
  ): Promise<WagerResult> {
    return this.wagerService.confirmStake(sessionId, userId, signedTransaction);
  }

  /**
   * Rebuilds the caller's stake transaction after the first one expired —
   * either its 180-second-plus timeout ran out, or another transaction from
   * that account moved the sequence number it was built against.
   */
  async requestFreshStakeTransaction(
    sessionId: string,
    userId: string,
  ): Promise<WagerResult> {
    return this.wagerService.requestFreshStakeTransaction(sessionId, userId);
  }

  /**
   * Re-checks a wager left mid-settlement against the ledger.
   *
   * Operator tooling rather than gameplay: a crash between submitting a payout
   * and recording it leaves a row in `SETTLING`, and this decides what really
   * happened rather than guessing.
   */
  async reconcileWager(sessionId: string): Promise<WagerResult> {
    return this.wagerService.reconcileWager(sessionId);
  }

  /**
   * Gets wager information for a session the user plays in
   */
  async getSessionWager(sessionId: string, user: User): Promise<Wager | null> {
    await this.findOne(sessionId, user);
    return this.wagerService.getWagerBySessionId(sessionId);
  }

  async getSessionWagerView(sessionId: string, user: User) {
    const wager = await this.getSessionWager(sessionId, user);
    if (!wager) throw new NotFoundException('This session has no wager');
    return this.wagerService.toView(wager, user.id);
  }

  /** Gets the user's wager history. */
  async getUserWagers(
    userId: string,
    limit: number = 10,
    offset: number = 0,
  ): Promise<Wager[]> {
    return this.wagerService.findUserWagers(userId, limit, offset);
  }
}
/* … truncated 13639 chars — edit only what you need near the top … */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  GameSession,
  GameSessionStatus,
  GameMode,
} from './entities/game-session.entity';
import { CreateGameSessionDto } from './dto/create-game-session.dto';
import { UpdateGameSessionDto } from './dto/update-game-session.dto';
import { User } from '../users/entities/user.entity';
import { WagerService } from '../tokens/services/wager.service';
import { Wager } from '../tokens/entities/wager.entity';
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

@Injectable()
export class GameSessionsService {
  constructor(
    @InjectRepository(GameSession)
    private readonly gameSessionRepository: Repository<GameSession>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly wagerService: WagerService,
    @Inject(TOKEN_SERVICE)
    private readonly tokenService: ITokenService,
  ) {}

  async create(
    createGameSessionDto: CreateGameSessionDto,
    player: User,
  ): Promise<CreateGameSessionResponse> {
    const { mode, playerTwoId, wagerAmount, hasWager } = createGameSessionDto;

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

    // Validate wagered game requirements
    // Parsed once here so that a malformed amount is rejected before a session
    // row is written, and every downstream call works in stroops.
    let stake: Stroops | undefined;

    if (mode === GameMode.WAGERED || hasWager) {
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

      // Check if both players have sufficient tokens
      const [playerOneBalance, playerTwoBalance] = await Promise.all([
        this.tokenService.hasSufficientTokens(player.id, stake),
        this.tokenService.hasSufficientTokens(playerTwoId, stake),
      ]);

      if (!playerOneBalance) {
        throw new BadRequestException(
          `You have insufficient tokens for this wager (${fromStroops(stake)} LYRIC required)`,
        );
      }

      if (!playerTwoBalance) {
        const playerTwo = await this.userRepository.findOne({
          where: { id: playerTwoId },
        });
        throw new BadRequestException(
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
      player,
      wagerStroops: stake ?? null,
      status:
        mode === GameMode.MULTIPLAYER || mode === GameMode.WAGERED
          ? GameSessionStatus.WAITING_FOR_PLAYER
          : GameSessionStatus.IN_PROGRESS,
    });

    const savedGameSession = await this.gameSessionRepository.save(gameSession);

    // Create wager if this is a wagered game
    if ((mode === GameMode.WAGERED || hasWager) && stake && playerTwoId) {
      const wagerResult = await this.wagerService.createWager({
        sessionId: savedGameSession.id,
        playerAId: player.id,
        playerBId: playerTwoId,
        stake,
      });

      if (!wagerResult.success) {
        // If wager creation fails, delete the game session
        await this.gameSessionRepository.delete(savedGameSession.id);
        throw new BadRequestException(
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

  async findAll(): Promise<GameSession[]> {
    return this.gameSessionRepository.find({
      relations: ['player'],
    });
  }

  async findOne(id: string): Promise<GameSession> {
    const gameSession = await this.gameSessionRepository.findOne({
      where: { id },
      relations: ['player'],
    });

    if (!gameSession) {
      throw new NotFoundException(`Game session with ID "${id}" not found`);
    }

    return gameSession;
  }

  async update(
    id: string,
    updateGameSessionDto: UpdateGameSessionDto,
  ): Promise<GameSession> {
    const gameSession = await this.findOne(id);
    Object.assign(gameSession, updateGameSessionDto);
    return this.gameSessionRepository.save(gameSession);
  }

  async remove(id: string): Promise<void> {
    const result = await this.gameSessionRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Game session with ID "${id}" not found`);
    }
  }

  async getTopScores(limit: number = 10): Promise<GameSession[]> {
    return this.gameSessionRepository.find({
      where: { status: GameSessionStatus.COMPLETED },
      order: { score: 'DESC' },
      take: limit,
      relations: ['player'],
    });
  }

  async getRecentGames(
    userId: string,
    limit: number = 5,
  ): Promise<GameSession[]> {
    return this.gameSessionRepository.find({
      where: { player: { id: userId } },
      order: { createdAt: 'DESC' },
      take: limit,
      relations: ['player'],
    });
  }

  async updateGameStatus(
    id: string,
    status: GameSessionStatus,
  ): Promise<GameSession> {
    const gameSession = await this.findOne(id);
    gameSession.status = status;
    return this.gameSessionRepository.save(gameSession);
  }

  async updateScore(id: string, score: number): Promise<GameSession> {
    const gameSession = await this.findOne(id);
    gameSession.score = score;
    if (score > 0) {
      gameSession.status = GameSessionStatus.COMPLETED;
    }
    return this.gameSessionRepository.save(gameSession);
  }

  /**
   * Completes a wagered game session and resolves the wager
   */
  async completeWageredGame(
    sessionId: string,
    playerOneScore: number,
    playerTwoScore: number,
  ): Promise<{
    gameSession: GameSession;
    wagerResult?: any;
    message: string;
    winnerId?: string | null;
    winnerUsername?: string | null;
  }> {
    const gameSession = await this.gameSessionRepository.findOne({
      where: { id: sessionId },
      relations: ['player', 'playerTwo'],
    });

    if (!gameSession) {
      throw new NotFoundException(
        `Game session with ID ${sessionId} not found`,
      );
    }

    if (!gameSession.hasWager) {
      throw new BadRequestException('This game session does not have a wager');
    }

    if (gameSession.status === GameSessionStatus.COMPLETED) {
      throw new BadRequestException('Game session is already completed');
    }

    // Update scores and determine winner
    gameSession.score = playerOneScore;
    gameSession.playerTwoScore = playerTwoScore;
    gameSession.status = GameSessionStatus.COMPLETED;
    gameSession.completedAt = new Date();

    let wagerResult;
    let message: string;
    let winnerId: string | null = null;
    let winnerUsername: string | null = null;

    if (playerOneScore > playerTwoScore) {
      // Player One wins
      gameSession.winnerId = gameSession.player.id;
      gameSession.winner = gameSession.player;
      wagerResult = await this.wagerService.resolveWagerWithWinner(
        sessionId,
        gameSession.player.id,
      );
      winnerId = gameSession.player.id;
      winnerUsername = sanitizeForDisplay(gameSession.player.username);
      message = `${winnerUsername} wins! ${wagerResult.message}`;
    } else if (playerTwoScore > playerOneScore) {
      // Player Two wins
      gameSession.winnerId = gameSession.playerTwoId;
      gameSession.winner = gameSession.playerTwo;
      wagerResult = await this.wagerService.resolveWagerWithWinner(
        sessionId,
        gameSession.playerTwoId,
      );
      winnerId = gameSession.playerTwoId;
      winnerUsername = sanitizeForDisplay(gameSession.playerTwo?.username);
      message = `${winnerUsername} wins! ${wagerResult.message}`;
    } else {
      // It's a draw
      wagerResult = await this.wagerService.resolveWagerAsDraw(sessionId);
      message = `It's a draw! ${wagerResult.message}`;
    }

    const updatedGameSession =
      await this.gameSessionRepository.save(gameSession);

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
   * Gets wager information for a session
   */
  async getSessionWager(sessionId: string): Promise<Wager | null> {
    return this.wagerService.getWagerBySessionId(sessionId);
  }

  /**
   * Gets user's wager history
   */
  async getUserWagers(userId: string, limit: number = 10): Promise<Wager[]> {
    return this.wagerService.getUserWagers(userId, limit);
  }
}

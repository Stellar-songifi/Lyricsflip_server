import {
  Injectable,
  BadRequestException,
  ConflictException,
  Inject,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Raw, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { User } from './entities/user.entity';
import { Cache } from 'cache-manager';
import { Wager, WagerStatus } from '../tokens/entities/wager.entity';
import {
  ITokenService,
  TOKEN_SERVICE,
} from '../tokens/interfaces/token.interface';
import { fromStroops } from '../stellar/amount.util';
import { GameHistory } from '../game-history/entities/game-history.entity';
import { GameSession } from '../game-sessions/entities/game-session.entity';
import { GameRound } from '../game/entities/game-round.entity';
import { DailyChallengeAttempt } from '../challenges/entities/daily-challenge-attempt.entity';
import { Room } from '../rooms/entities/room.entity';
import { RoomUser } from '../rooms/entities/room-user.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { Lyrics } from '../lyrics/entities/lyrics.entity';
import { usernameRuleViolation } from '../common/validators/username.validator';

// Wager states that have not yet reached a final outcome. A user involved in
// any wager in one of these states cannot be deleted/deactivated, since doing
// so could leave a wager unresolvable or an escrowed stake unaccounted for.
const NON_TERMINAL_WAGER_STATUSES = [
  WagerStatus.PENDING,
  WagerStatus.AWAITING_STAKES,
  WagerStatus.STAKED,
  WagerStatus.SETTLING,
];
import { AdminUpdateUserDto, UpdateProfileDto } from './dto/update-user.dto';
import { MAX_PAGE_SIZE } from '../common/dto/pagination-query.dto';
import { cacheConfig } from '../config/cache.config';

// Fields that are safe to expose on a public player profile. Everything else
// on the User entity (email, wallet address, preferences, flags, timestamps)
// is considered private and must never leak through the public endpoint.
const PUBLIC_PROFILE_FIELDS = [
  'username',
  'level',
  'levelTitle',
  'xp',
  'achievements',
  'wins',
  'losses',
] as const;

/** Symbol of the staking token; the balance is never XLM. */
const TOKEN_SYMBOL = 'LYRIC';
export type LeaderboardPeriod = 'weekly' | 'monthly' | 'all';

const LEADERBOARD_PERIODS: LeaderboardPeriod[] = ['weekly', 'monthly', 'all'];

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Wager)
    private readonly wagerRepository: Repository<Wager>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    @Inject(TOKEN_SERVICE)
    private readonly tokenService: ITokenService,
  ) {}

  async findAll(limit: number = 20, offset: number = 0) {
    return this.userRepository.find({
      order: { createdAt: 'ASC' },
      take: limit,
      skip: offset,
    });
  }

  async count(): Promise<number> {
    return this.userRepository.count();
  }

  async findOne(id: string) {
    const user = await this.userRepository.findOne({
      where: { id },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  /**
   * Returns the deliberately public view of a player profile, looked up by
   * username. Only fields listed in PUBLIC_PROFILE_FIELDS are exposed; the
   * full entity (email, wallet, preferences, etc.) is never returned here.
   */
  async findPublicProfile(username: string) {
    // Usernames are unique case-insensitively (IDX_users_username_lower), so
    // /users/Alice/public and /users/alice/public are the same player.
    const user = await this.userRepository.findOne({
      where: {
        username: Raw((column) => `LOWER(${column}) = LOWER(:username)`, {
          username,
        }),
      },
      select: [...PUBLIC_PROFILE_FIELDS],
    });
    if (!user) {
      throw new NotFoundException(`User with username ${username} not found`);
    }

    const wins = user.wins ?? 0;
    const losses = user.losses ?? 0;
    const totalGames = wins + losses;
    const winRate = totalGames > 0 ? wins / totalGames : 0;

    return {
      username: user.username,
      level: user.level,
      levelTitle: user.levelTitle,
      xp: user.xp,
      achievements: user.achievements ?? [],
      winRate,
    };
  }

  /**
   * Alias used by the controller for the public profile lookup.
   */
  async findByUsername(username: string) {
    return this.findPublicProfile(username);
  }

  /**
   * Returns the richer self-service profile for the authenticated user:
   * the user record, its level title, the linked wallet, a balance summary
   * and gameplay stats.
   */
  async getProfile(userId: string) {
    const user = await this.findOne(userId);

    const [balance, wagerStats] = await Promise.all([
      this.getTokenBalance(userId),
      this.getWagerStats(userId),
    ]);

    const level = user.level ?? 1;
    const stats = {
      xp: user.xp ?? 0,
      level,
      ...wagerStats,
    };

    return {
      ...user,
      levelTitle: this.getLevelTitle(level),
      wallet: user.stellarAddress
        ? {
            address: user.stellarAddress,
            verified: Boolean(user.stellarAddressVerifiedAt),
          }
        : null,
      ...balance,
      stats,
    };
  }

  /**
   * The same balance /game-sessions/tokens/balance reports: the mock balance
   * in mock mode, the token contract in stellar mode. A failed RPC call must
   * not take the whole profile down, so it yields `balance: null` and a
   * reason instead.
   */
  private async getTokenBalance(userId: string): Promise<{
    balance: { stroops: string; display: string; symbol: string } | null;
    balanceUnavailableReason?: string;
  }> {
    try {
      const stroops = await this.tokenService.getUserBalance(userId);
      return {
        balance: { stroops, display: fromStroops(stroops), symbol: TOKEN_SYMBOL },
      };
    } catch (error) {
      this.logger.warn(
        `Could not read token balance for user ${userId}: ${(error as Error).message}`,
      );
      return {
        balance: null,
        balanceUnavailableReason: 'Token balance is temporarily unavailable',
      };
    }
  }

  /**
   * Wins, losses and wager totals, counted from the wagers table in one
   * aggregate query. Only wagers paid out (WON) have a winner and a loser;
   * refunded wagers count towards the total but neither side's record.
   */
  private async getWagerStats(userId: string) {
    const row = await this.wagerRepository
      .createQueryBuilder('wager')
      .select(
        'COUNT(*) FILTER (WHERE wager.status = :won AND wager.winnerId = :userId)',
        'totalWins',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE wager.status = :won AND wager.winnerId <> :userId)',
        'totalLosses',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE wager.status = :refunded)',
        'totalRefunded',
      )
      .addSelect('COUNT(*)', 'totalWagers')
      .addSelect(
        'COALESCE(SUM(wager.stakeStroops) FILTER (WHERE wager.status = :won), 0)::text',
        'totalStakedStroops',
      )
      .where('(wager.playerAId = :userId OR wager.playerBId = :userId)', {
        userId,
      })
      .setParameters({ won: WagerStatus.WON, refunded: WagerStatus.REFUNDED })
      .getRawOne<{
        totalWins: string;
        totalLosses: string;
        totalRefunded: string;
        totalWagers: string;
        totalStakedStroops: string;
      }>();

    return {
      totalWins: Number(row?.totalWins ?? 0),
      totalLosses: Number(row?.totalLosses ?? 0),
      totalRefunded: Number(row?.totalRefunded ?? 0),
      totalWagers: Number(row?.totalWagers ?? 0),
      totalStakedStroops: row?.totalStakedStroops ?? '0',
    };
  }

  /**
   * Alias used by the controller for the authenticated user's profile.
   */
  async getSelfProfile(userId: string) {
    return this.getProfile(userId);
  }

  /**
   * Self-service profile update for the authenticated user. Validates the
   * username format and enforces uniqueness before persisting.
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.findOne(userId);

    if (dto.username && dto.username !== user.username) {
      const violation = usernameRuleViolation(dto.username);
      if (violation) {
        throw new BadRequestException(violation);
      }
      await this.assertUnused(
        { username: dto.username },
        userId,
        'Username already exists',
      );
    }

    Object.assign(user, dto);
    await this.userRepository.save(user);
    await this.cacheManager.del(`user:${userId}`);

    return this.getProfile(userId);
  }

  private getLevelTitle(level: number): string {
    if (level >= 50) return 'Legend';
    if (level >= 30) return 'Master';
    if (level >= 20) return 'Expert';
    if (level >= 10) return 'Veteran';
    if (level >= 5) return 'Apprentice';
    return 'Rookie';
  }

  async update(id: string, updateUserDto: UpdateProfileDto | AdminUpdateUserDto) {
    const user = await this.findOne(id);

    // Report taken usernames/emails as 409 rather than a unique-index 500
    const { username } = updateUserDto;
    const email = 'email' in updateUserDto ? updateUserDto.email : undefined;
    if (username && username !== user.username) {
      await this.assertUnused({ username }, id, 'Username already exists');
    }
    if (email && email !== user.email) {
      await this.assertUnused({ email }, id, 'Email already exists');
    }

    Object.assign(user, updateUserDto);
    return this.userRepository.save(user);
  }

  /**
   * Usernames and emails are unique case-insensitively (see the LOWER()
   * unique indexes), so the check is too: renaming to "ALICE" while "alice"
   * exists is a 409, not a unique-index 500.
   */
  private async assertUnused(
    where: { username: string } | { email: string },
    ownId: string,
    message: string,
  ): Promise<void> {
    const [column, value] =
      'username' in where
        ? ['username', where.username]
        : ['email', where.email];
    const taken = await this.userRepository.exists({
      where: {
        [column]: Raw((alias) => `LOWER(${alias}) = LOWER(:value)`, { value }),
        id: Not(ownId),
      },
    });
    if (taken) {
      throw new ConflictException(message);
    }
  }

  /**
   * Soft-deletes a user: deactivates and anonymizes the account instead of
   * removing the row. A hard delete would cascade into the user's lyric
   * catalogue, game history and wagers (or fail outright on FK constraints),
   * so the account is deactivated and its identifying fields scrubbed while
   * every row that references the user id is preserved.
   */
  async remove(id: string) {
    const user = await this.findOne(id);

    const activeWager = await this.wagerRepository.findOne({
      where: [
        { playerAId: id, status: In(NON_TERMINAL_WAGER_STATUSES) },
        { playerBId: id, status: In(NON_TERMINAL_WAGER_STATUSES) },
      ],
    });
    if (activeWager) {
      throw new ConflictException(
        'User has an in-progress wager and cannot be deleted until it is resolved',
      );
    }

    user.isActive = false;
    user.email = `deleted-${user.id}@deleted.lyricsflip.local`;
    user.username = `deleted_${user.id}`;
    user.name = null;
    user.stellarAddress = null;
    user.stellarAddressVerifiedAt = null;

    await this.userRepository.save(user);
    return { message: 'User deactivated successfully' };
  }

  /**
   * Self-service account deletion. Requires the current password so a stolen
   * access token alone cannot delete the account.
   */
  async deleteAccount(userId: string, password: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'password'],
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const matches =
      typeof user.password === 'string' &&
      user.password.length > 0 &&
      (await bcrypt.compare(password, user.password));
    if (!matches) {
      throw new UnauthorizedException('Invalid password');
    }

    return this.remove(userId);
  }

  /**
   * Exports every row of personal data held for a user, for data-portability
   * requests (GDPR/NDPR). Tables included, and the column that ties each one
   * to the user:
   *
   *   users                     id (the profile itself)
   *   game_history              playerId
   *   game_sessions             playerId / playerTwoId
   *   game_rounds               userId
   *   wagers                    playerAId / playerBId
   *   daily_challenge_attempts  userId
   *   room_users                userId (room participation, guesses)
   *   rooms                     hostId
   *   refresh_tokens            userId (sessions; the token hash is omitted)
   *   notifications             userId
   *   audit_logs                actorId, or targetType 'user' + targetId
   *   lyrics                    createdById (lyrics the user added)
   *
   * Deliberately left out: email_tokens and password_reset_tokens, which hold
   * only short-lived secret hashes, not information about the person.
   *
   * There is no catch-all here: if any table fails to load, the request fails
   * with a 5xx rather than returning an export that looks complete but is not.
   */
  async exportData(id: string) {
    const user = await this.findOne(id);
    const manager = this.userRepository.manager;

    const [
      gameHistory,
      gameSessions,
      gameRounds,
      wagers,
      dailyChallengeAttempts,
      roomParticipation,
      roomsHosted,
      sessions,
      notifications,
      auditEntries,
      lyricsAdded,
    ] = await Promise.all([
      manager.getRepository(GameHistory).find({
        where: { playerId: id },
        order: { createdAt: 'DESC' },
      }),
      manager.getRepository(GameSession).find({
        where: [{ player: { id } }, { playerTwoId: id }],
      }),
      manager.getRepository(GameRound).find({ where: { userId: id } }),
      this.wagerRepository.find({
        where: [{ playerAId: id }, { playerBId: id }],
        order: { createdAt: 'DESC' },
      }),
      manager.getRepository(DailyChallengeAttempt).find({
        where: { userId: id },
      }),
      manager.getRepository(RoomUser).find({ where: { userId: id } }),
      manager.getRepository(Room).find({ where: { hostId: id } }),
      manager.getRepository(RefreshToken).find({
        where: { userId: id },
        select: ['id', 'createdAt', 'expiresAt', 'revokedAt'],
        order: { createdAt: 'DESC' },
      }),
      manager.getRepository(Notification).find({
        where: { userId: id },
        order: { createdAt: 'DESC' },
      }),
      manager.getRepository(AuditLog).find({
        where: [{ actorId: id }, { targetType: 'user', targetId: id }],
        order: { timestamp: 'DESC' },
      }),
      manager.getRepository(Lyrics).find({
        where: { createdBy: { id } },
        select: ['id', 'artist', 'songTitle', 'isActive', 'createdAt'],
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      profile: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        stellarAddress: user.stellarAddress,
        preferredGenre: user.preferredGenre,
        preferredDecade: user.preferredDecade,
        xp: user.xp,
        level: user.level,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      gameHistory,
      gameSessions,
      gameRounds,
      wagers,
      dailyChallengeAttempts,
      roomParticipation,
      roomsHosted,
      sessions,
      notifications,
      auditEntries,
      lyricsAdded,
    };
  }

  /**
   * Update user preferences (genre and decade)
   * @param userId The ID of the user to update
   * @param preferencesDto The preferences to update
   * @returns Updated user with preferences
   */
  async updatePreferences(
    userId: string,
    preferencesDto: UpdateUserPreferencesDto,
  ): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Update only the provided preferences
    if (preferencesDto.preferredGenre !== undefined) {
      user.preferredGenre = preferencesDto.preferredGenre;
    }
    if (preferencesDto.preferredDecade !== undefined) {
      user.preferredDecade = preferencesDto.preferredDecade;
    }

    // Clear cache for this user if needed
    await this.cacheManager.del(`user:${userId}`);

    return this.userRepository.save(user);
  }

  /**
   * Get user preferences
   * @param userId The ID of the user
   * @returns User preferences
   */
  async getUserPreferences(
    userId: string,
  ): Promise<{ preferredGenre?: string; preferredDecade?: string }> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['preferredGenre', 'preferredDecade'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return {
      preferredGenre: user.preferredGenre,
      preferredDecade: user.preferredDecade,
    };
  }

  /**
   * Leaderboard page. Ranks are computed with competition ranking
   * (`RANK() OVER (ORDER BY xp DESC)`) so tied users share the same rank,
   * matching the rank reported by `getMyRank`.
   */
  async getLeaderboard(
    limit: number = 20,
    offset: number = 0,
    period: LeaderboardPeriod = 'all',
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
    const safeOffset = Math.max(offset, 0);

    const rows = await this.userRepository.query(
      `SELECT id, username, xp, level, level_title AS "levelTitle",
              RANK() OVER (ORDER BY xp DESC) AS rank
         FROM users
        ORDER BY xp DESC, id ASC
        LIMIT $1 OFFSET $2`,
      [safeLimit, safeOffset],
    );

    return rows.map((row: any) => ({
      ...row,
      rank: Number(row.rank),
    }));
  }

  /**
   * Rank of a single user, using the same competition ranking as the
   * leaderboard page so tied users see the same rank in both places.
   */
  async getMyRank(userId: string) {
    const rows = await this.userRepository.query(
      `SELECT rank FROM (
         SELECT id, RANK() OVER (ORDER BY xp DESC) AS rank
           FROM users
       ) ranked
       WHERE id = $1`,
      [userId],
    );

    if (!rows.length) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return { rank: Number(rows[0].rank) };
  }
}

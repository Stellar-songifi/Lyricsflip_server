import {
  Injectable,
  BadRequestException,
  ConflictException,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { User } from './entities/user.entity';
import { Cache } from 'cache-manager';
import { Wager, WagerStatus } from '../tokens/entities/wager.entity';

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
import { Optional } from '@nestjs/common';
import { PublicUserDto } from './dto/public-user.dto';
import { AchievementsService } from '../achievements/achievements.service';
import {
  GameSession,
  GameSessionStatus,
} from '../game-sessions/entities/game-session.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { EmailToken } from '../auth/entities/email-token.entity';
import { PasswordResetToken } from '../auth/entities/password-reset-token.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';

/** Public profiles are cached briefly; they change only after a match. */
const PUBLIC_PROFILE_CACHE_TTL_MS = 60_000;

// Usernames must be 3-30 chars, start with a letter, and contain only
// letters, numbers and underscores (issue #129).
const USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{2,29}$/;
export type LeaderboardPeriod = 'weekly' | 'monthly' | 'all';

const LEADERBOARD_PERIODS: LeaderboardPeriod[] = ['weekly', 'monthly', 'all'];

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Wager)
    private readonly wagerRepository: Repository<Wager>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  // Property injection keeps the constructor stable. Optional because the
  // achievements persistence (R2-66) is not wired up on every deployment;
  // without it public profiles report no achievements.
  @Optional()
  @Inject(AchievementsService)
  private readonly achievementsService?: AchievementsService;

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
   * The one public view of a player (GET /users/:username/public): the
   * fields in PublicUserDto and nothing else. Looked up case-insensitively;
   * deactivated and anonymised accounts are 404. Cached for a minute.
   */
  async findPublicProfile(username: string): Promise<PublicUserDto> {
    const cacheKey = `users:public:${username.toLowerCase()}`;
    const cached = await this.cacheManager.get<PublicUserDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.username) = LOWER(:username)', { username })
      .andWhere('user.isActive = true')
      .andWhere('user.username NOT LIKE :anonymised', {
        anonymised: 'deleted\\_%',
      })
      .getOne();
    if (!user) {
      throw new NotFoundException(`User with username ${username} not found`);
    }

    const [record, achievements] = await Promise.all([
      this.getHeadToHeadRecord(user.id),
      this.getPublicAchievements(user.id),
    ]);

    const profile = PublicUserDto.from(user, record, achievements);
    await this.cacheManager.set(cacheKey, profile, PUBLIC_PROFILE_CACHE_TTL_MS);
    return profile;
  }

  /**
   * Wins and losses in completed two-player sessions. Wagered matches are
   * sessions too, so they are counted here once, not again from wagers.
   * Sessions that ended without a winner (draws) count as neither.
   */
  private async getHeadToHeadRecord(
    userId: string,
  ): Promise<{ wins: number; losses: number }> {
    const row = await this.userRepository.manager
      .getRepository(GameSession)
      .createQueryBuilder('gs')
      .select('COUNT(*) FILTER (WHERE gs.winnerId = :userId)', 'wins')
      .addSelect(
        'COUNT(*) FILTER (WHERE gs.winnerId IS NOT NULL AND gs.winnerId <> :userId)',
        'losses',
      )
      .where('gs.status = :completed', {
        completed: GameSessionStatus.COMPLETED,
      })
      .andWhere('gs.playerTwoId IS NOT NULL')
      .andWhere('(gs."playerId" = :userId OR gs.playerTwoId = :userId)', {
        userId,
      })
      .getRawOne<{ wins: string; losses: string }>();

    return {
      wins: Number(row?.wins ?? 0),
      losses: Number(row?.losses ?? 0),
    };
  }

  private async getPublicAchievements(userId: string) {
    if (!this.achievementsService) {
      return [];
    }
    const unlocked = await this.achievementsService.listForUser(userId);
    return unlocked.map(({ code, name, description }) => ({
      code,
      name,
      description,
    }));
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

    const balance = user.balance ?? 0;
    const stats = {
      xp: user.xp ?? 0,
      level: user.level ?? 1,
      totalWins: user.totalWins ?? 0,
      totalLosses: user.totalLosses ?? 0,
      totalWagers: user.totalWagers ?? 0,
    };

    return {
      ...user,
      levelTitle: this.getLevelTitle(stats.level),
      wallet: user.stellarAddress
        ? {
            address: user.stellarAddress,
            verified: Boolean(user.stellarAddressVerifiedAt),
          }
        : null,
      balance: {
        amount: balance,
        currency: 'XLM',
      },
      stats,
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
      if (!USERNAME_PATTERN.test(dto.username)) {
        throw new BadRequestException(
          'Username must be 3-30 characters, start with a letter, and contain only letters, numbers and underscores',
        );
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
   * Soft-deletes a user: deactivates and anonymizes the account instead of
   * removing the row. A hard delete would cascade into the user's lyric
   * catalogue, game history and wagers (or fail outright on FK constraints),
   * so the account is deactivated and its identifying fields scrubbed while
   * every row that references the user id is preserved.
   */
  private async assertUnused(
    where: { username: string } | { email: string },
    ownId: string,
    message: string,
  ): Promise<void> {
    const taken = await this.userRepository.exists({
      where: { ...where, id: Not(ownId) },
    });
    if (taken) {
      throw new ConflictException(message);
    }
  }

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

    await this.erasePersonalData(id);

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

  /**
   * Applies the retention policy (docs/DATA_ARCHIVING.md) to a deleted
   * account's rows outside the users table:
   *
   *   deleted     refresh_tokens, email_tokens, password_reset_tokens,
   *               notifications - no legal reason to keep them
   *   ip cleared  audit_logs where the user was the actor - the rows stay,
   *               as the audit record of what was done, but not from where
   *   kept        wagers (financial record), game_history, game_sessions,
   *               game_rounds, room_users - linked only by id to the
   *               anonymised users row, so they no longer identify anyone
   */
  private async erasePersonalData(userId: string): Promise<void> {
    await this.userRepository.manager.transaction(async (manager) => {
      await manager.delete(RefreshToken, { userId });
      await manager.delete(EmailToken, { userId });
      await manager.delete(PasswordResetToken, { userId });
      await manager.delete(Notification, { userId });
      await manager.update(AuditLog, { actorId: userId }, { ip: null });
    });
  }
}

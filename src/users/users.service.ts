import {
  Injectable,
  BadRequestException,
  ConflictException,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
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

  async findAll(limit: number = 20, offset: number = 0) {
    return this.userRepository.find({
      order: { createdAt: 'ASC' },
      take: limit,
      skip: offset,
    });
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
    const user = await this.userRepository.findOne({
      where: { username },
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
   * Exports all personal data held for a user as a JSON-serialisable bundle.
   * Includes the profile, game history and wagers so the user can satisfy
   * data-portability requests (GDPR/NDPR).
   */
  async exportData(id: string) {
    const user = await this.findOne(id);

    const wagers = await this.wagerRepository.find({
      where: [{ playerAId: id }, { playerBId: id }],
      order: { createdAt: 'DESC' },
    });

    const gameHistory = await this.userRepository.manager
      .getRepository('GameHistory')
      .find({ where: { userId: id } })
      .catch(() => []);

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
      wagers,
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
   * Returns the leaderboard: top users sorted by a field.
   *
   * Only active, non-admin accounts are ranked. When a `period` other than
   * `all` is requested the ranking is derived from `game_history` aggregates
   * within the period window (weekly = last 7 days, monthly = last 30 days),
   * otherwise lifetime XP is used. Results are cached per query shape.
   *
   * @param limit number of users to return
   * @param offset offset for pagination
   * @param sort sort field (xp, level, username)
   * @param order sort order (ASC, DESC)
   * @param period ranking window (weekly, monthly, all)
   * @param genre optional genre filter applied to game history
   * @param currentUserId optional caller id used to compute "my rank"
   */
  async getLeaderboard(
    limit = 10,
    offset = 0,
    sort = 'xp',
    order: 'ASC' | 'DESC' = 'DESC',
    period: LeaderboardPeriod = 'all',
    genre?: string,
    currentUserId?: string,
  ) {
    // Number.isInteger also rejects NaN, which slips past `limit < 1`.
    if (
      !Number.isInteger(limit) ||
      !Number.isInteger(offset) ||
      limit < 1 ||
      limit > MAX_PAGE_SIZE ||
      offset < 0
    )
      throw new BadRequestException('Invalid limit or offset');
    const validSorts = ['xp', 'level', 'username'];
    if (!validSorts.includes(sort))
      throw new BadRequestException('Invalid sort field');
    if (!['ASC', 'DESC'].includes(order))
      throw new BadRequestException('Invalid order');
    if (!LEADERBOARD_PERIODS.includes(period))
      throw new BadRequestException('Invalid period');

    const cacheKey = `leaderboard:${sort}:${order}:${period}:${genre ?? 'all'}:${limit}:${offset}`;
    const cached = await this.cacheManager.get<any>(cacheKey);
    if (cached) {
      return currentUserId
        ? { ...cached, myRank: await this.getMyRank(currentUserId, period, genre) }
        : cached;
    }

    const qb = this.userRepository
      .createQueryBuilder('user')
      .where('user.isActive = :isActive', { isActive: true })
      .andWhere('user.isAdmin = :isAdmin', { isAdmin: false });

    if (period !== 'all') {
      const since = new Date();
      since.setDate(since.getDate() - (period === 'weekly' ? 7 : 30));

      qb.innerJoin(
        'game_history',
        'gh',
        'gh.userId = user.id AND gh.createdAt >= :since',
        { since },
      );
      if (genre) {
        qb.andWhere('gh.genre = :genre', { genre });
      }
      qb.addSelect('COALESCE(SUM(gh.xpEarned), 0)', 'periodXp')
        .groupBy('user.id')
        .orderBy('periodXp', order)
        .addOrderBy('user.id', 'ASC');
    } else {
      qb.orderBy(`user.${sort}`, order).addOrderBy('user.id', 'ASC');
    }

    const total = await qb.getCount();
    const rows = await qb
      .select([
        'user.id AS id',
        'user.username AS username',
        'user.xp AS xp',
        'user.level AS level',
      ])
      .offset(offset)
      .limit(limit)
      .getRawMany<{
        id: string;
        username: string;
        xp: number;
        level: number;
        periodXp?: string;
      }>();

    const data = rows.map((row, idx) => ({
      id: row.id,
      username: row.username,
      xp: period === 'all' ? Number(row.xp) : Number(row.periodXp ?? 0),
      level: Number(row.level),
      rank: offset + idx + 1,
    }));

    const result = {
      data: users.map((user, idx) => ({
        ...user,
        rank: offset + idx + 1,
      })),
      total,
      limit,
      offset,
    };

    await this.cacheManager.set(cacheKey, result, cacheConfig.ttl * 1000);
      data,
      meta: {
        total,
        limit,
        offset,
        sort,
        order,
        period,
        genre: genre ?? null,
      },
    };
    await this.cacheManager.set(
      cacheKey,
      result,
      cacheConfig.leaderboardTtlMs,
    );

    if (currentUserId) {
      return { ...result, myRank: await this.getMyRank(currentUserId, period, genre) };
    }
    return result;
  }

  /**
   * Computes the authenticated caller's rank for the given leaderboard window.
   * Returns null when the caller is inactive, an admin, or unranked.
   */
  private async getMyRank(
    userId: string,
    period: LeaderboardPeriod,
    genre?: string,
  ): Promise<{ rank: number; xp: number } | null> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'xp', 'isActive', 'isAdmin'],
    });
    if (!user || !user.isActive || user.isAdmin) {
      return null;
    }

    if (period === 'all') {
      const higher = await this.userRepository.count({
        where: { isActive: true, isAdmin: false, xp: Not(user.xp) },
      });
      const ahead = await this.userRepository
        .createQueryBuilder('user')
        .where('user.isActive = :isActive', { isActive: true })
        .andWhere('user.isAdmin = :isAdmin', { isAdmin: false })
        .andWhere('user.xp > :xp', { xp: user.xp })
        .getCount();
      return { rank: ahead + 1, xp: user.xp };
    }

    const since = new Date();
    since.setDate(since.getDate() - (period === 'weekly' ? 7 : 30));

    const qb = this.userRepository
      .createQueryBuilder('user')
      .innerJoin(
        'game_history',
        'gh',
        'gh.userId = user.id AND gh.createdAt >= :since',
        { since },
      )
      .where('user.isActive = :isActive', { isActive: true })
      .andWhere('user.isAdmin = :isAdmin', { isAdmin: false });
    if (genre) {
      qb.andWhere('gh.genre = :genre', { genre });
    }
    qb.select('user.id', 'id')
      .addSelect('COALESCE(SUM(gh.xpEarned), 0)', 'periodXp')
      .groupBy('user.id');

    const rows = await qb.getRawMany<{ id: string; periodXp: string }>();
    const mine = rows.find((row) => row.id === userId);
    if (!mine) {
      return null;
    }
    const myXp = Number(mine.periodXp);
    const rank = rows.filter((row) => Number(row.periodXp) > myXp).length + 1;
    return { rank, xp: myXp };
  }
}

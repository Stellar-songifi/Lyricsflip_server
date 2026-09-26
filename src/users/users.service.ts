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

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
   * @param limit number of users to return
   * @param offset offset for pagination
   * @param sort sort field (xp, level, username)
   * @param order sort order (ASC, DESC)
   */
  async getLeaderboard(
    limit = 10,
    offset = 0,
    sort = 'xp',
    order: 'ASC' | 'DESC' = 'DESC',
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

    const cacheKey = `leaderboard:${sort}:${order}:${limit}:${offset}`;
    const cached = await this.cacheManager.get<any>(cacheKey);
    if (cached) return cached;

    const [users, total] = await this.userRepository.findAndCount({
      order: { [sort]: order },
      take: limit,
      skip: offset,
      select: ['id', 'username', 'xp', 'level'],
    });
    const result = {
      data: users.map((user, idx) => ({
        ...user,
        rank: offset + idx + 1,
      })),
      meta: {
        total,
        limit,
        offset,
        sort,
        order,
      },
    };
    await this.cacheManager.set(
      cacheKey,
      result,
      cacheConfig.leaderboardTtlMs,
    );
    return result;
  }
}

import {
  Injectable,
  BadRequestException,
  ConflictException,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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

  async create(createUserDto: CreateUserDto) {
    // This method should be implemented based on your auth service requirements
    throw new BadRequestException(
      'User creation should be handled through auth service',
    );
  }

  async findAll() {
    return this.userRepository.find();
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

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.findOne(id);
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
    if (limit < 1 || offset < 0)
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
    await this.cacheManager.set(cacheKey, result, 30); // cache for 30s
    return result;
  }
}

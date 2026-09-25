import {
  Injectable,
  BadRequestException,
  ConflictException,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { AdminUpdateUserDto, UpdateProfileDto } from './dto/update-user.dto';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { User } from './entities/user.entity';
import { Cache } from 'cache-manager';
import { MAX_PAGE_SIZE } from '../common/dto/pagination-query.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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
    await this.userRepository.remove(user);
    return { message: 'User deleted successfully' };
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
    await this.cacheManager.set(cacheKey, result, 30); // cache for 30s
    return result;
  }
}

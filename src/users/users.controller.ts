import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseUUIDPipe,
  SerializeOptions,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { AdminUpdateUserDto, UpdateProfileDto } from './dto/update-user.dto';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { LeaderboardQueryDto } from './dto/leaderboard-query.dto';
import { PublicUserDto } from './dto/public-user.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { User } from './entities/user.entity';
import { UserGroup } from './user-serialization';
import { GetUser } from 'src/auth/decorators/user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from 'src/auth/guards/optional-jwt-auth.guard';
import { Public } from 'src/auth/decorators/public.decorator';
import { Roles } from 'src/auth/roles/roles.decorator';
import { Role } from 'src/auth/roles/role.enum';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

// Accounts are created through POST /auth/signup; there is no POST /users.
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(Role.Admin)
  @SerializeOptions({ groups: [UserGroup.ADMIN] })
  @ApiOperation({ summary: 'List all users (admin only)' })
  @ApiResponse({ status: 200, description: 'List of users.' })
  @ApiResponse({ status: 400, description: 'Invalid pagination values.' })
  @ApiResponse({ status: 403, description: 'Not an admin.' })
  findAll(@Query() { limit, offset }: PaginationQueryDto) {
    return this.usersService.findAll(limit, offset);
  }

  /**
   * GET /users/me - Rich self-service profile.
   * Returns the profile plus levelTitle, the linked wallet, the balance
   * summary and stats. Declared before `:id` so `me` is not treated as an ID.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({ summary: 'Get your own rich profile' })
  @ApiResponse({ status: 200, description: 'Profile with level, wallet, balance and stats.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getMe(@GetUser() user: User) {
    return this.usersService.getSelfProfile(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiOperation({ summary: 'Get user profile (alias of /users/me)' })
  @ApiResponse({ status: 200, description: 'Profile with level, wallet, balance and stats.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getProfile(@GetUser() user: User) {
    return this.usersService.getSelfProfile(user.id);
  }

  /**
   * PATCH /users/me - Update the current user's own account.
   * Declared before `:id` so `me` is not treated as an ID.
   */
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  @SerializeOptions({ groups: [UserGroup.SELF] })
  @ApiOperation({ summary: 'Update your own account' })
  @ApiResponse({ status: 200, description: 'Account updated.' })
  @ApiResponse({ status: 400, description: 'Invalid profile data.' })
  @ApiResponse({ status: 409, description: 'Username already exists.' })
  updateMe(@GetUser() user: User, @Body() updateProfileDto: UpdateProfileDto) {
    return this.usersService.update(user.id, updateProfileDto);
  }

  /** DELETE /users/me - Delete the current user's own account. */
  @UseGuards(JwtAuthGuard)
  @Delete('me')
  @ApiOperation({ summary: 'Delete your own account' })
  @ApiResponse({ status: 200, description: 'Account deleted.' })
  removeMe(@GetUser() user: User) {
    return this.usersService.remove(user.id);
  }

  /**
   * PATCH /users/preferences - Update user preferences
   * Updates the current user's music genre and decade preferences
   */
  @UseGuards(JwtAuthGuard)
  @Patch('preferences')
  @ApiOperation({ summary: 'Update user preferences' })
  @ApiResponse({ status: 200, description: 'User preferences updated successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid preference data.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async updatePreferences(
    @GetUser() user: User,
    @Body() updatePreferencesDto: UpdateUserPreferencesDto,
  ) {
    const updatedUser = await this.usersService.updatePreferences(user.id, updatePreferencesDto);
    return {
      message: 'Preferences updated successfully',
      preferences: {
        preferredGenre: updatedUser.preferredGenre,
        preferredDecade: updatedUser.preferredDecade,
      },
    };
  }

  /**
   * GET /users/preferences - Get user preferences
   * Returns the current user's music preferences
   */
  @UseGuards(JwtAuthGuard)
  @Get('preferences')
  @ApiOperation({ summary: 'Get user preferences' })
  @ApiResponse({ status: 200, description: 'User preferences retrieved successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getUserPreferences(@GetUser() user: User) {
    const preferences = await this.usersService.getUserPreferences(user.id);
    return {
      preferences,
    };
  }

  /**
   * GET /users/leaderboard - Public leaderboard ranked by xp, level or username.
   * Supports weekly/monthly/all-time periods and genre filtering, excludes
   * inactive (and optionally admin) accounts, and includes the caller's rank
   * when authenticated. Declared before `@Get(':id')` so the literal path is
   * not swallowed by the wildcard route.
   */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('leaderboard')
  @ApiOperation({ summary: 'Get the public user leaderboard' })
  @ApiResponse({ status: 200, description: 'Ranked users with pagination meta and caller rank.' })
  @ApiResponse({ status: 400, description: 'Invalid pagination, sort, order, period or genre.' })
  getLeaderboard(@Query() query: LeaderboardQueryDto, @GetUser() user?: User) {
    return this.usersService.getLeaderboard({
      limit: query.limit ?? 10,
      offset: query.offset ?? 0,
      sort: query.sort ?? 'xp',
      order: query.order ?? 'DESC',
      period: query.period ?? 'all',
      genre: query.genre,
      includeAdmins: query.includeAdmins ?? false,
      currentUserId: user?.id,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user’s public profile by ID' })
  @ApiResponse({ status: 200, description: 'Public user data.', type: PublicUserDto })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PublicUserDto> {
    return PublicUserDto.from(await this.usersService.findOne(id));
  }

  @Patch(':id')
  @Roles(Role.Admin)
  @SerializeOptions({ groups: [UserGroup.ADMIN] })
  @ApiOperation({ summary: 'Update any user by ID (admin only)' })
  @ApiResponse({ status: 200, description: 'User updated.' })
  @ApiResponse({ status: 403, description: 'Not an admin.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: AdminUpdateUserDto,
  ) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @Roles(Role.Admin)
  @ApiOperation({ summary: 'Delete any user by ID (admin only)' })
  @ApiResponse({ status: 200, description: 'User deleted.' })
  @ApiResponse({ status: 403, description: 'Not an admin.' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }
}

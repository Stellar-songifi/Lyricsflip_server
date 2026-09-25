import {
  Controller,
  Get,
  Query,
  UseGuards,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { GameHistoryService } from './game-history.service';
import { GameHistoryQueryDto } from './dto/game-history-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/user.decorator';
import { User } from '../users/entities/user.entity';
import { GuessType } from '../game/dto/guess.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/roles/role.enum';

@ApiTags('game-history')
@Controller('game-history')
@UseGuards(JwtAuthGuard)
export class GameHistoryController {
  constructor(private readonly gameHistoryService: GameHistoryService) { }

  /**
   * GET /game-history/me - Get authenticated user's game history
   */
  @Get('me')
  @ApiOperation({ summary: 'Get current user game history' })
  @ApiResponse({ status: 200, description: 'Paginated game history for the authenticated user.' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default 10, max 100)' })
  @ApiQuery({ name: 'guessType', required: false, enum: GuessType, description: 'Filter by guess type' })
  @ApiQuery({ name: 'isCorrect', required: false, type: Boolean, description: 'Filter by correct/incorrect guesses' })
  @ApiQuery({ name: 'startDate', required: false, type: String, description: 'Filter from date (ISO string)' })
  @ApiQuery({ name: 'endDate', required: false, type: String, description: 'Filter to date (ISO string)' })
  @ApiQuery({ name: 'lyricId', required: false, type: Number, description: 'Filter by specific lyric ID' })
  async getMyHistory(
    @GetUser() user: User,
    @Query() queryDto: GameHistoryQueryDto,
  ) {
    return this.gameHistoryService.findByUserId(user.id, queryDto);
  }

  /**
   * GET /game-history/me/stats - Get authenticated user's game statistics
   */
  @Get('me/stats')
  @ApiOperation({ summary: 'Get current user game statistics' })
  @ApiResponse({ status: 200, description: 'Game statistics for the authenticated user.' })
  async getMyStats(@GetUser() user: User) {
    return this.gameHistoryService.getUserStats(user.id);
  }

  /**
   * GET /game-history/:id - Get specific game history record
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get specific game history record' })
  @ApiResponse({ status: 200, description: 'Game history record details.' })
  @ApiResponse({ status: 403, description: 'The record belongs to another user.' })
  @ApiResponse({ status: 404, description: 'Game history record not found.' })
  async getGameHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() user: User,
  ) {
    return this.gameHistoryService.findOne(id, user);
  }

  /**
   * GET /users/:userId/history - Get game history for a specific user (admin functionality)
   */
  @Roles(Role.Admin)
  @Get('users/:userId')
  @ApiOperation({ summary: 'Get game history for a specific user (Admin only)' })
  @ApiResponse({ status: 200, description: 'Paginated game history for the specified user.' })
  async getUserHistory(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() queryDto: GameHistoryQueryDto,
  ) {
    return this.gameHistoryService.findByUserId(userId, queryDto);
  }
}

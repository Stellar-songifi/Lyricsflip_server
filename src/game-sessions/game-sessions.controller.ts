import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Put,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { GameSessionsService } from './game-sessions.service';
import { CreateGameSessionDto } from './dto/create-game-session.dto';
import { UpdateGameSessionDto } from './dto/update-game-session.dto';
import { ConfirmStakeDto } from './dto/confirm-stake.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/roles/role.enum';
import { GetUser } from '../auth/decorators/user.decorator';
import { User } from '../users/entities/user.entity';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';

@ApiTags('game-sessions')
@Controller('game-sessions')
@UseGuards(JwtAuthGuard)
export class GameSessionsController {
  constructor(private readonly gameSessionsService: GameSessionsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new game session' })
  @ApiResponse({ status: 201, description: 'Game session created.' })
  create(
    @Body() createGameSessionDto: CreateGameSessionDto,
    @GetUser() user: User,
  ) {
    return this.gameSessionsService.create(createGameSessionDto, user);
  }

  @Get()
  @ApiOperation({ summary: 'Get all game sessions' })
  @ApiResponse({ status: 200, description: 'List of game sessions.' })
  @ApiResponse({ status: 400, description: 'Invalid pagination values.' })
  findAll(@Query() { limit, offset }: PaginationQueryDto) {
    return this.gameSessionsService.findAll(limit, offset);
  }

  @Get('top-scores')
  @ApiOperation({ summary: 'Get top scores' })
  @ApiResponse({ status: 200, description: 'Top scores.' })
  @ApiResponse({ status: 400, description: 'Invalid pagination values.' })
  getTopScores(@Query() { limit, offset }: PaginationQueryDto) {
    return this.gameSessionsService.getTopScores(limit, offset);
  }

  @Get('my-recent')
  @ApiOperation({ summary: 'Get recent games for user' })
  @ApiResponse({ status: 200, description: 'Recent games for user.' })
  @ApiResponse({ status: 400, description: 'Invalid pagination values.' })
  getRecentGames(
    @GetUser() user: User,
    @Query() { limit, offset }: PaginationQueryDto,
  ) {
    return this.gameSessionsService.getRecentGames(user.id, limit, offset);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a game session by ID' })
  @ApiResponse({ status: 200, description: 'Game session details.' })
  findOne(@Param('id') id: string) {
    return this.gameSessionsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a game session' })
  @ApiResponse({ status: 200, description: 'Game session updated.' })
  update(
    @Param('id') id: string,
    @Body() updateGameSessionDto: UpdateGameSessionDto,
  ) {
    return this.gameSessionsService.update(id, updateGameSessionDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a game session' })
  @ApiResponse({ status: 200, description: 'Game session deleted.' })
  remove(@Param('id') id: string) {
    return this.gameSessionsService.remove(id);
  }

  @Put(':id/complete-wagered')
  @ApiOperation({
    summary: 'Complete a wagered game session and resolve wager',
  })
  @ApiParam({ name: 'id', description: 'Game session ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        playerOneScore: { type: 'number', description: 'Score for player one' },
        playerTwoScore: { type: 'number', description: 'Score for player two' },
      },
      required: ['playerOneScore', 'playerTwoScore'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Wagered game completed and wager resolved.',
  })
  async completeWageredGame(
    @Param('id') id: string,
    @Body() body: { playerOneScore: number; playerTwoScore: number },
  ): Promise<{
    gameSession: any;
    wagerResult?: any;
    message: string;
  }> {
    return await this.gameSessionsService.completeWageredGame(
      id,
      body.playerOneScore,
      body.playerTwoScore,
    );
  }

  @Post(':id/stake')
  @ApiOperation({
    summary: "Submit a stake transaction signed in the player's wallet",
    description:
      'Completes the handshake started by creating a wagered session: post ' +
      "back the signed XDR from that response's `pendingSignatures`. The " +
      'wager becomes STAKED once both players have done this.',
  })
  @ApiParam({ name: 'id', description: 'Game session ID' })
  @ApiResponse({ status: 200, description: 'Stake submitted.' })
  @ApiResponse({
    status: 400,
    description: 'Not a player in this wager, or it is not awaiting stakes.',
  })
  @HttpCode(HttpStatus.OK)
  async confirmStake(
    @Param('id') id: string,
    @GetUser() user: User,
    @Body() dto: ConfirmStakeDto,
  ) {
    return this.gameSessionsService.confirmStake(id, user.id, dto.transaction);
  }

  @Roles(Role.Admin)
  @Post(':id/wager/reconcile')
  @ApiOperation({
    summary: 'Reconcile a wager left mid-settlement against the ledger',
    description:
      'Operator tooling. A crash between submitting a payout and recording it ' +
      'leaves the wager in SETTLING; this establishes what actually happened ' +
      'on-chain instead of guessing.',
  })
  @ApiParam({ name: 'id', description: 'Game session ID' })
  @ApiResponse({ status: 200, description: 'Reconciled state.' })
  @HttpCode(HttpStatus.OK)
  async reconcileWager(@Param('id') id: string) {
    return this.gameSessionsService.reconcileWager(id);
  }

  @Get('tokens/balance')
  @ApiOperation({ summary: 'Get user token balance' })
  @ApiResponse({
    status: 200,
    description:
      'User token balance, as base units ("1000000000") and a display amount ("100.0").',
  })
  async getUserTokenBalance(
    @GetUser() user: User,
  ): Promise<{ stroops: string; display: string }> {
    return await this.gameSessionsService.getUserTokenBalance(user.id);
  }

  @Get(':id/wager')
  @ApiOperation({ summary: 'Get wager information for a session' })
  @ApiParam({ name: 'id', description: 'Game session ID' })
  @ApiResponse({ status: 200, description: 'Wager information.' })
  async getSessionWager(@Param('id') id: string): Promise<any> {
    return await this.gameSessionsService.getSessionWager(id);
  }

  @Get('wagers/my-history')
  @ApiOperation({ summary: 'Get user wager history' })
  @ApiResponse({ status: 200, description: 'User wager history.' })
  @ApiResponse({ status: 400, description: 'Invalid pagination values.' })
  async getUserWagers(
    @GetUser() user: User,
    @Query() { limit, offset }: PaginationQueryDto,
  ): Promise<any[]> {
    return await this.gameSessionsService.getUserWagers(
      user.id,
      limit,
      offset,
    );
  }
}

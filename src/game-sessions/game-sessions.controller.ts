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
import { CompleteWageredGameDto } from './dto/complete-wagered-game.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/roles/role.enum';
import { GetUser } from '../auth/decorators/user.decorator';
import { User } from '../users/entities/user.entity';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
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
  @ApiOperation({
    summary: 'Get your game sessions (every session, for admins)',
  })
  @ApiResponse({ status: 200, description: 'List of game sessions.' })
  findAll(@GetUser() user: User) {
    return this.gameSessionsService.findAll(user);
  }

  @Get('top-scores')
  @ApiOperation({ summary: 'Get top scores' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Top scores.' })
  getTopScores(@Query('limit') limit: number) {
    return this.gameSessionsService.getTopScores(limit);
  }

  @Get('my-recent')
  @ApiOperation({ summary: 'Get recent games for user' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Recent games for user.' })
  getRecentGames(@GetUser() user: User, @Query('limit') limit: number) {
    return this.gameSessionsService.getRecentGames(user.id, limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a game session by ID' })
  @ApiResponse({ status: 200, description: 'Game session details.' })
  @ApiResponse({ status: 403, description: 'Not a player in this session.' })
  findOne(@Param('id') id: string, @GetUser() user: User) {
    return this.gameSessionsService.findOne(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: "Update a game session's category" })
  @ApiResponse({ status: 200, description: 'Game session updated.' })
  @ApiResponse({ status: 403, description: 'Not a player in this session.' })
  update(
    @Param('id') id: string,
    @Body() updateGameSessionDto: UpdateGameSessionDto,
    @GetUser() user: User,
  ) {
    return this.gameSessionsService.update(id, updateGameSessionDto, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a game session' })
  @ApiResponse({ status: 200, description: 'Game session deleted.' })
  @ApiResponse({ status: 403, description: 'Not a player in this session.' })
  @ApiResponse({
    status: 409,
    description: 'The session has a wager that is not settled or refunded.',
  })
  remove(@Param('id') id: string, @GetUser() user: User) {
    return this.gameSessionsService.remove(id, user);
  }

  // Scores decide who is paid the pot, so players must not be able to post
  // them. Admin only until scores are computed server-side from gameplay.
  @Roles(Role.Admin)
  @Put(':id/complete-wagered')
  @ApiOperation({
    summary: 'Complete a wagered game session and resolve wager (Admin only)',
  })
  @ApiParam({ name: 'id', description: 'Game session ID' })
  @ApiResponse({
    status: 200,
    description: 'Wagered game completed and wager resolved.',
  })
  async completeWageredGame(
    @Param('id') id: string,
    @Body() body: CompleteWageredGameDto,
    @GetUser() user: User,
  ): Promise<{
    gameSession: any;
    wagerResult?: any;
    message: string;
  }> {
    return await this.gameSessionsService.completeWageredGame(
      id,
      body.playerOneScore,
      body.playerTwoScore,
      user,
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
  @ApiResponse({ status: 403, description: 'Not a player in this session.' })
  async getSessionWager(
    @Param('id') id: string,
    @GetUser() user: User,
  ): Promise<any> {
    return await this.gameSessionsService.getSessionWager(id, user);
  }

  @Get('wagers/my-history')
  @ApiOperation({ summary: 'Get user wager history' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Limit number of results',
  })
  @ApiResponse({ status: 200, description: 'User wager history.' })
  async getUserWagers(
    @GetUser() user: User,
    @Query('limit') limit: number,
  ): Promise<any[]> {
    return await this.gameSessionsService.getUserWagers(user.id, limit);
  }
}

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
  UseInterceptors,
} from '@nestjs/common';
import { GameSessionsService } from './game-sessions.service';
import { CreateGameSessionDto } from './dto/create-game-session.dto';
import { UpdateGameSessionDto } from './dto/update-game-session.dto';
import { ConfirmStakeDto } from './dto/confirm-stake.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { TopScoresQueryDto } from './dto/top-scores-query.dto';
import { CompleteWageredGameDto } from './dto/complete-wagered-game.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/roles/role.enum';
import { GetUser } from '../auth/decorators/user.decorator';
import { User } from '../users/entities/user.entity';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Audited } from '../audit/decorators/audited.decorator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';

@ApiTags('game-sessions')
@Controller('game-sessions')
@UseGuards(JwtAuthGuard)
@UseInterceptors(AuditInterceptor)
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
  @ApiResponse({ status: 400, description: 'Invalid pagination values.' })
  findAll(@Query() { limit, offset }: PaginationQueryDto) {
    return this.gameSessionsService.findAll(limit, offset);
  }

  @Get('top-scores')
  @ApiOperation({
    summary: 'Get top scores from either seat',
    description:
      'Returns the highest scores across both player seats, each attributed ' +
      'to the user who earned it. Supports pagination and optional mode and ' +
      'category filters.',
  })
  @ApiResponse({ status: 200, description: 'Top scores.' })
  @ApiResponse({ status: 400, description: 'Invalid pagination values.' })
  getTopScores(@Query() query: TopScoresQueryDto) {
    return this.gameSessionsService.getTopScores(query);
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
  @Audited({ action: 'settlement.wager.complete', targetType: 'game-session' })
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

  @Post(':id/accept')
  @ApiOperation({
    summary: 'Accept an invitation to a session',
    description:
      'Only the invited player two can accept. For a wager this is when their ' +
      'stake is taken, or returned in `pendingSignatures` for their wallet to sign.',
  })
  @ApiParam({ name: 'id', description: 'Game session ID' })
  @ApiResponse({ status: 200, description: 'Invitation accepted.' })
  @ApiResponse({ status: 410, description: 'Invitation expired.' })
  @HttpCode(HttpStatus.OK)
  accept(@Param('id') id: string, @GetUser() user: User) {
    return this.gameSessionsService.accept(id, user);
  }

  @Post(':id/decline')
  @ApiOperation({
    summary: "Decline an invitation to a session; refunds player one's stake",
  })
  @ApiParam({ name: 'id', description: 'Game session ID' })
  @ApiResponse({ status: 200, description: 'Invitation declined.' })
  @HttpCode(HttpStatus.OK)
  decline(@Param('id') id: string, @GetUser() user: User) {
    return this.gameSessionsService.decline(id, user);
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

  @Post(':id/stake/transaction')
  @ApiOperation({
    summary: "Rebuild the caller's stake transaction",
    description:
      'Use this when the transaction from POST /game-sessions expired before ' +
      'it was signed. Only valid while the wager is awaiting stakes and the ' +
      "caller has not already staked; the new transaction's hash replaces the " +
      'old one, so only the fresh transaction is accepted by POST :id/stake.',
  })
  @ApiParam({ name: 'id', description: 'Game session ID' })
  @ApiResponse({ status: 200, description: 'New unsigned stake transaction.' })
  @ApiResponse({
    status: 400,
    description: 'Not a player in this wager, already staked, or not awaiting stakes.',
  })
  @HttpCode(HttpStatus.OK)
  async requestFreshStakeTransaction(
    @Param('id') id: string,
    @GetUser() user: User,
  ) {
    return this.gameSessionsService.requestFreshStakeTransaction(id, user.id);
  }

  @Roles(Role.Admin)
  @Post(':id/wager/reconcile')
  @Audited({ action: 'settlement.wager.reconcile', targetType: 'game-session' })
  @ApiOperation({
    summary: 'Reconcile a wager left mid-settlement against the ledger',
    description:
      'O

/* … truncated 1805 chars — edit only what you need near the top … */

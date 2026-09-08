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
} from '@nestjs/common';
import { GameSessionsService } from './game-sessions.service';
import { CreateGameSessionDto } from './dto/create-game-session.dto';
import { UpdateGameSessionDto } from './dto/update-game-session.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/user.decorator';
import { User } from '../users/entities/user.entity';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
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
  findAll() {
    return this.gameSessionsService.findAll();
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

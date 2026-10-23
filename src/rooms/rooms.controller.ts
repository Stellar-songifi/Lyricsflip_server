import { Controller, Post, Body, Param, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiQuery,
} from '@nestjs/swagger';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { GuessLyricDto } from './dto/guess-lyric.dto';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { GetUser } from '../auth/decorators/user.decorator';

@ApiTags('rooms')
@Controller('rooms')
@ApiBearerAuth('JWT-auth')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post('create')
  @ApiOperation({ summary: 'Create a new room' })
  @ApiBody({ type: CreateRoomDto })
  @ApiResponse({ status: 201, description: 'The room was created.', type: Object })
  create(
    @Body() createRoomDto: CreateRoomDto,
    @GetUser('id') userId: string,
  ) {
    return this.roomsService.create(createRoomDto, userId);
  }

  @Post(':roomId/join')
  @ApiOperation({ summary: 'Join an existing room' })
  @ApiParam({ name: 'roomId', description: 'Room identifier' })
  @ApiResponse({ status: 200, description: 'User joined room.', type: Object })
  @ApiResponse({ status: 404, description: 'Room not found.' })
  @ApiResponse({ status: 409, description: 'User already joined this room or room is full.' })
  join(
    @Param('roomId') roomId: string,
    @GetUser('id') userId: string,
  ) {
    return this.roomsService.join(roomId, userId);
  }

  @Post('join/:code')
  @ApiOperation({ summary: 'Join a room by 6-character short code' })
  @ApiResponse({ status: 201, description: 'Joined room successfully.' })
  @ApiResponse({ status: 404, description: 'Room not found.' })
  @ApiResponse({ status: 409, description: 'User already joined this room or room is full.' })
  joinByCode(
    @Param('code') code: string,
    @GetUser('id') userId: string,
  ) {
    return this.roomsService.joinByCode(code, userId);
  }

  @Post(':roomId/start')
  @ApiOperation({ summary: 'Start a room (host only)' })
  @ApiParam({ name: 'roomId', description: 'Room identifier' })
  @ApiResponse({ status: 200, description: 'Room started; rounds issued to all members.' })
  @ApiResponse({ status: 403, description: 'Only the host can start the room.' })
  @ApiResponse({ status: 404, description: 'Room not found.' })
  @ApiResponse({ status: 409, description: 'Room is not in the lobby.' })
  start(
    @Param('roomId') roomId: string,
    @GetUser('id') userId: string,
  ) {
    return this.roomsService.start(roomId, userId);
  }

  @Get(':roomId/results')
  @ApiOperation({ summary: 'Get the final ranking for a finished room' })
  @ApiParam({ name: 'roomId', description: 'Room identifier' })
  @ApiResponse({ status: 200, description: 'Ranked results.', type: Object })
  @ApiResponse({ status: 404, description: 'Room not found.' })
  @ApiResponse({ status: 409, description: 'Room is not finished yet.' })
  getResults(@Param('roomId') roomId: string) {
    return this.roomsService.getResults(roomId);
  }

  @Get()
  @ApiOperation({ summary: 'List open (lobby) rooms' })
  @ApiResponse({ status: 200, description: 'Paginated list of open rooms.' })
  @ApiQuery({ name: 'status', required: false, enum: ['lobby'], description: 'Filter by room status' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default 20, max 100)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Number of items to skip (default 0)' })
  async findOpenRooms(@Query() query: ListRoomsQueryDto) {
    // Only support status=lobby for now
    if (query.status && query.status !== 'lobby') {
      return { items: [], total: 0 };
    }
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    return this.roomsService.findOpenRooms(limit, offset);
  }

  @Get(':roomId/status')
  @ApiOperation({ summary: 'Get room status for the current user' })
  @ApiParam({ name: 'roomId', description: 'Room identifier' })
  @ApiResponse({ status: 200, description: 'Room status.', type: Object })
  @ApiResponse({ status: 404, description: 'Room not found or user not in room.' })
  getRoomStatus(
    @Param('roomId') roomId: string,
    @GetUser('id') userId: string,
  ) {
    return this.roomsService.getRoomStatus(roomId, userId);
  }

  @Post(':roomId/guess')
  @ApiOperation({ summary: 'Submit a guess in a room' })
  @ApiParam({ name: 'roomId', description: 'Room identifier' })
  @ApiBody({ type: GuessLyricDto })
  @ApiResponse({ status: 200, description: 'Guess result.', type: Object })
  @ApiResponse({ status: 404, description: 'Room not found or user not in room.' })
  @ApiResponse({ status: 409, description: 'User already guessed.' })
  submitGuess(
    @Param('roomId') roomId: string,
    @GetUser('id') userId: string,
    @Body() guessDto: GuessLyricDto,
  ) {
    return this.roomsService.submitGuess(roomId, userId, guessDto);
  }
}

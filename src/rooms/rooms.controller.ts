import { Controller, Post, Body, Param, Get, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { GuessLyricDto } from './dto/guess-lyric.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('rooms')
@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post('create')
  @ApiOperation({ summary: 'Create a new room' })
  @ApiResponse({ status: 201, description: 'Room created successfully.' })
  create(@Body() createRoomDto: CreateRoomDto) {
    return this.roomsService.create(createRoomDto);
  }

  @Post(':roomId/join')
  @ApiOperation({ summary: 'Join a room by UUID' })
  @ApiResponse({ status: 201, description: 'Joined room successfully.' })
  @ApiResponse({ status: 404, description: 'Room not found.' })
  @ApiResponse({ status: 409, description: 'User already joined this room.' })
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
  @ApiResponse({ status: 409, description: 'User already joined this room.' })
  joinByCode(
    @Param('code') code: string,
    @GetUser('id') userId: string,
  ) {
    return this.roomsService.joinByCode(code, userId);
  }

  @Get()
  @ApiOperation({ summary: 'List open (lobby) rooms' })
  @ApiResponse({ status: 200, description: 'Paginated list of open rooms.' })
  @ApiQuery({ name: 'status', required: false, enum: ['lobby'], description: 'Filter by room status' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default 20, max 100)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Number of items to skip (default 0)' })
  async findOpenRooms(
    @Query('status') status: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    // Only support status=lobby for now
    if (status && status !== 'lobby') {
      return { items: [], total: 0 };
    }
    const limit = pagination.limit ?? 20;
    const offset = pagination.offset ?? 0;
    return this.roomsService.findOpenRooms(limit, offset);
  }

  @Get(':roomId/status')
  @ApiOperation({ summary: 'Get room status' })
  @ApiResponse({ status: 200, description: 'Room status.' })
  @ApiResponse({ status: 404, description: 'Room not found or user not in room.' })
  getRoomStatus(
    @Param('roomId') roomId: string,
    @GetUser('id') userId: string,
  ) {
    return this.roomsService.getRoomStatus(roomId, userId);
  }

  @Post(':roomId/guess')
  @ApiOperation({ summary: 'Submit a guess for the room' })
  @ApiResponse({ status: 200, description: 'Guess scored.' })
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

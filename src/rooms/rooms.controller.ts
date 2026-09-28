import { Controller, Post, Body, Param, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { GuessLyricDto } from './dto/guess-lyric.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/user.decorator';

@ApiTags('rooms')
@Controller('rooms')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post('create')
  @ApiOperation({ summary: 'Create a new room' })
  @ApiBody({ type: CreateRoomDto })
  @ApiResponse({ status: 201, description: 'The room was created.', type: Object })
  create(@Body() createRoomDto: CreateRoomDto) {
    return this.roomsService.create(createRoomDto);
  }

  @Post(':roomId/join')
  @ApiOperation({ summary: 'Join an existing room' })
  @ApiParam({ name: 'roomId', description: 'Room identifier' })
  @ApiResponse({ status: 200, description: 'User joined room.', type: Object })
  join(
    @Param('roomId') roomId: string,
    @GetUser('id') userId: string,
  ) {
    return this.roomsService.join(roomId, userId);
  }

  @Get(':roomId/status')
  @ApiOperation({ summary: 'Get room status for the current user' })
  @ApiParam({ name: 'roomId', description: 'Room identifier' })
  @ApiResponse({ status: 200, description: 'Room status.', type: Object })
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
  submitGuess(
    @Param('roomId') roomId: string,
    @GetUser('id') userId: string,
    @Body() guessDto: GuessLyricDto,
  ) {
    return this.roomsService.submitGuess(roomId, userId, guessDto);
  }
}

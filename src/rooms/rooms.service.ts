import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Room } from './entities/room.entity';
import { RoomUser } from './entities/room-user.entity';
import { Lyrics } from '../lyrics/entities/lyrics.entity';
import { CreateRoomDto } from './dto/create-room.dto';
import { GuessLyricDto } from './dto/guess-lyric.dto';
import * as stringSimilarity from 'string-similarity';

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(RoomUser)
    private roomUserRepository: Repository<RoomUser>,
    @InjectRepository(Lyrics)
    private lyricsRepository: Repository<Lyrics>,
  ) {}

  async create(createRoomDto: CreateRoomDto) {
    let lyric: Lyrics;

    if (createRoomDto.lyricId) {
      const foundLyric = await this.lyricsRepository.findOne({
        where: { id: createRoomDto.lyricId, isActive: true },
      });
      if (!foundLyric) {
        throw new NotFoundException('Lyric not found');
      }
      lyric = foundLyric;
    } else {
      // Get a random lyric
      const foundLyric = await this.lyricsRepository
        .createQueryBuilder('lyrics')
        .where('lyrics.isActive = :isActive', { isActive: true })
        .orderBy('RANDOM()')
        .getOne();
      if (!foundLyric) {
        throw new NotFoundException('No lyrics available');
      }
      lyric = foundLyric;
    }

    const room = this.roomRepository.create({
      name: createRoomDto.name,
      lyric,
      lyricId: lyric.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
    } as Room);

    return this.roomRepository.save(room);
  }

  async join(roomId: string, userId: string) {
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: ['roomUsers', 'lyric'],
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    this.assertPlayable(room);

    // Check if user already joined
    const existingRoomUser = await this.roomUserRepository.findOne({
      where: { roomId, userId },
    });

    if (existingRoomUser) {
      throw new ConflictException('User already joined this room');
    }

    const roomUser = this.roomUserRepository.create({
      roomId,
      userId,
    });

    return this.roomUserRepository.save(roomUser);
  }

  async getRoomStatus(roomId: string, userId: string) {
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: ['lyric', 'roomUsers', 'roomUsers.user'],
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    // Check if user has joined the room
    const roomUser = room.roomUsers.find((ru) => ru.userId === userId);
    if (!roomUser) {
      throw new NotFoundException('User has not joined this room');
    }

    // Don't send actual lyrics if user hasn't guessed yet, or if the lyric
    // has since been deactivated by an admin.
    const response = { ...room };
    if (!roomUser.hasGuessed || room.lyric?.isActive === false) {
      response.lyric = { ...room.lyric, content: '' };
    }
    return response;
  }

  async submitGuess(roomId: string, userId: string, guessDto: GuessLyricDto) {
    const roomUser = await this.roomUserRepository.findOne({
      where: { roomId, userId },
      relations: ['room', 'room.lyric'],
    });

    if (!roomUser) {
      throw new NotFoundException('User has not joined this room');
    }

    if (roomUser.hasGuessed) {
      throw new ConflictException('User has already submitted a guess');
    }

    this.assertPlayable(roomUser.room);

    // Calculate score based on string similarity
    const similarity = stringSimilarity.compareTwoStrings(
      guessDto.guess.toLowerCase(),
      roomUser.room.lyric.content.toLowerCase(),
    );

    roomUser.hasGuessed = true;
    roomUser.guess = guessDto.guess;
    roomUser.score = similarity;
    roomUser.guessedAt = new Date();

    return this.roomUserRepository.save(roomUser);
  }

  /**
   * Closes every open room whose expiresAt has passed, in a single UPDATE.
   * Runs every minute; join and submitGuess also check expiresAt themselves,
   * so a room is unplayable the moment it expires even between sweeps.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkAndCloseExpiredRooms(): Promise<number> {
    const result = await this.roomRepository.update(
      { isClosed: false, expiresAt: LessThanOrEqual(new Date()) },
      { isClosed: true },
    );
    const closed = result.affected ?? 0;
    if (closed > 0) {
      this.logger.log(`Closed ${closed} expired room(s)`);
    }
    return closed;
  }

  private assertPlayable(room: Room): void {
    if (room.isClosed) {
      throw new BadRequestException('Room is closed');
    }

    if (room.expiresAt && room.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Room has expired');
    }

    if (room.lyric && room.lyric.isActive === false) {
      throw new BadRequestException('Room lyric is no longer available');
    }
  }
}

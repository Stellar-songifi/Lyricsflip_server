import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Room } from './entities/room.entity';
import { RoomUser } from './entities/room-user.entity';
import { Lyrics } from '../lyrics/entities/lyrics.entity';
import { CreateRoomDto } from './dto/create-room.dto';
import { GuessLyricDto } from './dto/guess-lyric.dto';
import { PlayerSummaryDto } from '../users/dto/public-user.dto';
import * as stringSimilarity from 'string-similarity';

@Injectable()
export class RoomsService {
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
        where: { id: Number(createRoomDto.lyricId) },
      });
      if (!foundLyric) {
        throw new NotFoundException('Lyric not found');
      }
      lyric = foundLyric;
    } else {
      // Get a random lyric
      const foundLyric = await this.lyricsRepository
        .createQueryBuilder('lyrics')
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
      relations: ['roomUsers'],
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    if (room.isClosed) {
      throw new BadRequestException('Room is closed');
    }

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

    // Don't send actual lyrics if user hasn't guessed yet, and never the
    // lyric's creator (a full User) if a caller happened to load it
    const lyricFields: Partial<Lyrics> = { ...room.lyric };
    delete lyricFields.createdBy;
    const lyric = roomUser.hasGuessed
      ? lyricFields
      : { ...lyricFields, content: '' };

    return {
      ...room,
      lyric,
      // Room members are other players: expose only id and username
      roomUsers: room.roomUsers.map(({ user, ...member }) => ({
        ...member,
        user: user ? PlayerSummaryDto.from(user) : undefined,
      })),
    };
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

    if (roomUser.room.isClosed) {
      throw new BadRequestException('Room is closed');
    }

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

  async checkAndCloseExpiredRooms() {
    const expiredRooms = await this.roomRepository.find({
      where: {
        isClosed: false,
        expiresAt: new Date(),
      },
    });

    for (const room of expiredRooms) {
      room.isClosed = true;
      await this.roomRepository.save(room);
    }
  }
}

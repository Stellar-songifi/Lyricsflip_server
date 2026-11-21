import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoomsService } from './rooms.service';
import { Room } from './entities/room.entity';
import { RoomUser } from './entities/room-user.entity';
import { Lyrics } from '../lyrics/entities/lyrics.entity';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { User } from '../users/entities/user.entity';
import { GuessType } from '../game/dto/guess.dto';
import { LessThanOrEqual } from 'typeorm';

describe('RoomsService', () => {
  let service: RoomsService;
  let roomRepository: Repository<Room>;
  let roomUserRepository: Repository<RoomUser>;
  let lyricsRepository: Repository<Lyrics>;

  const mockLyric = {
    id: 1,
    content: 'Test lyric text',
    lyricSnippet: 'Test lyric',
    artist: 'Test Artist',
    songTitle: 'Test Song',
    genre: 'Pop',
    decade: '2020s',
    category: 'Pop',
  } as Lyrics;

  const mockRoom = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Test Room',
    lyric: mockLyric,
    lyricId: 1,
    isClosed: false,
    roomUsers: [],
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  } as Room;

  const mockRoomUser = {
    id: '123e4567-e89b-12d3-a456-426614174001',
    userId: '1',
    roomId: mockRoom.id,
    hasGuessed: false,
    score: 0,
    guess: '',
  } as RoomUser;

    beforeEach(async () => {
      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockLyric),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RoomsService,
          {
            provide: getRepositoryToken(Room),
            useValue: {
              create: jest.fn().mockReturnValue(mockRoom),
              save: jest.fn().mockResolvedValue(mockRoom),
              findOne: jest.fn().mockResolvedValue({ ...mockRoom, roomUsers: [mockRoomUser] }),
              findOneOrFail: jest.fn().mockResolvedValue({ ...mockRoom, roomUsers: [mockRoomUser] }),
              update: jest.fn().mockResolvedValue({ affected: 0 }),
            },
          },
          {
            provide: getRepositoryToken(RoomUser),
            useValue: {
              create: jest.fn().mockReturnValue(mockRoomUser),
              save: jest.fn().mockResolvedValue(mockRoomUser),
              findOne: jest.fn().mockResolvedValue(null),
              update: jest.fn().mockResolvedValue({ affected: 1 }),
            },
          },
          {
            provide: getRepositoryToken(Lyrics),
            useValue: {
              findOneOrFail: jest.fn().mockResolvedValue(mockLyric),
              findOne: jest.fn().mockResolvedValue(mockLyric),
              createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
            },
          },
        ],
      }).compile();

      service = module.get<RoomsService>(RoomsService);
      roomRepository = module.get<Repository<Room>>(getRepositoryToken(Room));
      roomUserRepository = module.get<Repository<RoomUser>>(getRepositoryToken(RoomUser));
      lyricsRepository = module.get<Repository<Lyrics>>(getRepositoryToken(Lyrics));
    });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new room with random lyric', async () => {
      const createRoomDto = { name: 'Test Room' };
      const result = await service.create(createRoomDto);
      
      expect(result).toEqual(mockRoom);
      expect(lyricsRepository.createQueryBuilder).toHaveBeenCalled();
      expect(roomRepository.create).toHaveBeenCalled();
      expect(roomRepository.save).toHaveBeenCalled();
    });

    it('should throw error if lyric is not found', async () => {
      jest.spyOn(lyricsRepository, 'createQueryBuilder').mockImplementation(() => {
        return {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(null),
        } as any;
      });
      const createRoomDto = { name: 'Test Room' };
      
      await expect(service.create(createRoomDto)).rejects.toThrow();
    });
  });

  describe('join', () => {
    it('should allow a user to join a room', async () => {
      const result = await service.join(mockRoom.id, '1');
      
      expect(result).toEqual(mockRoomUser);
      expect(roomRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockRoom.id },
        relations: ['roomUsers', 'lyric'],
      });
      expect(roomUserRepository.create).toHaveBeenCalled();
      expect(roomUserRepository.save).toHaveBeenCalled();
    });

    it('should throw if room does not exist', async () => {
      jest.spyOn(roomRepository, 'findOne').mockResolvedValue(null);
      
      await expect(service.join(mockRoom.id, '1')).rejects.toThrow(NotFoundException);
    });

    it('should throw if user already joined', async () => {
      jest.spyOn(roomUserRepository, 'findOne').mockResolvedValue(mockRoomUser);
      
      await expect(service.join(mockRoom.id, '1')).rejects.toThrow(ConflictException);
    });

    it('should throw if room is closed', async () => {
      jest.spyOn(roomRepository, 'findOne').mockResolvedValue({
        ...mockRoom,
        isClosed: true,
        roomUsers: [],
      });
      
      await expect(service.join(mockRoom.id, '1')).rejects.toThrow();
    });
  });

  describe('submitGuess concurrency', () => {
    it('scores exactly one of two parallel guesses and rejects the other with 409', async () => {
      const roomUser = { ...mockRoomUser, hasGuessed: false } as RoomUser;

      jest.spyOn(roomRepository, 'findOne').mockResolvedValue({
        ...mockRoom,
        roomUsers: [roomUser],
      } as Room);
      jest.spyOn(roomUserRepository, 'findOne').mockResolvedValue(roomUser);

      // Simulate the conditional claim: only the first UPDATE affects a row.
      let claims = 0;
      jest.spyOn(roomUserRepository, 'update').mockImplementation(async () => {
        claims += 1;
        return { affected: claims === 1 ? 1 : 0 } as any;
      });

      const guess = { type: GuessType.SONG_TITLE, value: mockLyric.songTitle } as any;

      const results = await Promise.allSettled([
        service.submitGuess(mockRoom.id, '1', guess),
        service.submitGuess(mockRoom.id, '1', guess),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const error = (rejected[0] as PromiseRejectedResult).reason;
      expect(error).toBeInstanceOf(ConflictException);
      expect(JSON.stringify(error.getResponse())).not.toContain(mockLyric.songTitle);
      expect(JSON.stringify(error.getResponse())).not.toContain(mockLyric.artist);
    });
  });

  describe('getRoomStatus', () => {
    it('should return room status with users', async () => {
      const result = await service.getRoomStatus(mockRoom.id, '1');
      
      expect(result).toEqual({
        id: mockRoom.id,
        name: mockRoom.name,
        createdAt: mockRoom.createdAt,
        expiresAt: mockRoom.expiresAt,
        isClosed: false,
        lyric: {
          id: mockLyric.id,
          lyricSnippet: mockLyric.lyricSnippet,
          category: mockLyric.category,
          genre: mockLyric.genre,
          decade: mockLyric.decade,
        },
        players: [{ id: '1', username: null, hasGuessed: false, score: 0 }],
      });
      expect(roomRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockRoom.id },
        relations: ['lyric', 'roomUsers', 'roomUsers.user'],
      });
    });

    it('should throw if room is not found', async () => {
      jest.spyOn(roomRepository, 'findOne').mockResolvedValue(null);
      
      await expect(service.getRoomStatus(mockRoom.id, '1')).rejects.toThrow(NotFoundException);
    });

    describe('response shaping', () => {
      const fullUser = {
        id: '1',
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$10$secret',
        role: 'user',
        xp: 10,
      } as unknown as User;

      const statusFor = (hasGuessed: boolean) => {
        jest.spyOn(roomRepository, 'findOne').mockResolvedValue({
          ...mockRoom,
          lyric: { ...mockLyric, createdBy: fullUser },
          roomUsers: [{ ...mockRoomUser, hasGuessed, user: fullUser }],
        } as Room);
        return service.getRoomStatus(mockRoom.id, '1');
      };

      it('hides the artist, title and full lyric before the user guesses', async () => {
        const { lyric } = await statusFor(false);

        expect(lyric).not.toHaveProperty('artist');
        expect(lyric).not.toHaveProperty('songTitle');
        expect(lyric).not.toHaveProperty('content');
        expect(lyric.lyricSnippet).toBe(mockLyric.lyricSnippet);
      });

      it('reveals the artist and title once the user has guessed', async () => {
        const { lyric } = await statusFor(true);

        expect(lyric.artist).toBe(mockLyric.artist);
        expect(lyric.songTitle).toBe(mockLyric.songTitle);
      });

      it('returns only id and username for each player', async () => {
        const status = await statusFor(true);

        expect(status.players).toEqual([
          { id: '1', username: 'alice', hasGuessed: true, score: 0 },
        ]);
      });
    });
  });
});

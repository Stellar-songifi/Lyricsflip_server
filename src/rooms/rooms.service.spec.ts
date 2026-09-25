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
import { LessThanOrEqual } from 'typeorm';

describe('RoomsService', () => {
  let service: RoomsService;
  let roomRepository: Repository<Room>;
  let roomUserRepository: Repository<RoomUser>;
  let lyricsRepository: Repository<Lyrics>;

  const mockLyric = {
    id: 1,
    content: 'Test lyric text',
    artist: 'Test Artist',
    songTitle: 'Test Song',
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
    });  it('should be defined', () => {
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

  describe('getRoomStatus', () => {
    it('should return room status with users', async () => {
      const result = await service.getRoomStatus(mockRoom.id, '1');
      
      expect(result).toEqual({
        ...mockRoom,
        lyric: { ...mockRoom.lyric, content: '' },
        roomUsers: [mockRoomUser],
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
  });

  describe('submitGuess', () => {
    const guessDto = { guess: 'Test guess' };

    beforeEach(() => {
      const roomUserWithRoom = { 
        ...mockRoomUser, 
        room: { ...mockRoom, lyric: mockLyric, isClosed: false }
      };
      jest.spyOn(roomUserRepository, 'findOne').mockResolvedValue(roomUserWithRoom);
      jest.spyOn(roomUserRepository, 'save').mockImplementation((roomUser) => {
        return Promise.resolve({
          ...roomUserWithRoom,
          hasGuessed: true,
          guess: 'Test guess',
          score: 0.8,
          guessedAt: expect.any(Date),
        });
      });
    });

    it('should process a guess and return score', async () => {
      const result = await service.submitGuess(mockRoom.id, '1', guessDto);
      
      expect(result.hasGuessed).toBe(true);
      expect(result.guess).toBe(guessDto.guess);
      expect(result.score).toBeDefined();
      expect(roomUserRepository.save).toHaveBeenCalled();
    });

    it('should throw if user has not joined room', async () => {
      jest.spyOn(roomUserRepository, 'findOne').mockResolvedValue(null);
      
      await expect(service.submitGuess(mockRoom.id, '1', guessDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw if user has already guessed', async () => {
      jest.spyOn(roomUserRepository, 'findOne').mockResolvedValue({
        ...mockRoomUser,
        hasGuessed: true,
      });
      
      await expect(service.submitGuess(mockRoom.id, '1', guessDto)).rejects.toThrow(ConflictException);
    });

    it('should throw if room is closed', async () => {
      jest.spyOn(roomUserRepository, 'findOne').mockResolvedValue({ 
        ...mockRoomUser, 
        room: { ...mockRoom, lyric: mockLyric, isClosed: true }
      });
      
      await expect(service.submitGuess(mockRoom.id, '1', guessDto)).rejects.toThrow();
    });
  });

  describe('create with a specific lyric', () => {
    it('looks the lyric up by its integer id and requires it to be active', async () => {
      await service.create({ lyricId: 3 });

      expect(lyricsRepository.findOne).toHaveBeenCalledWith({
        where: { id: 3, isActive: true },
      });
    });

    it('throws NotFoundException for a deactivated lyric', async () => {
      jest.spyOn(lyricsRepository, 'findOne').mockResolvedValue(null);

      await expect(service.create({ lyricId: 3 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('only picks a random lyric from active lyrics', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockLyric),
      };
      jest.spyOn(lyricsRepository, 'createQueryBuilder').mockReturnValue(qb as any);

      await service.create({});

      expect(qb.where).toHaveBeenCalledWith('lyrics.isActive = :isActive', {
        isActive: true,
      });
    });
  });

  describe('expiry', () => {
    const now = new Date('2026-01-01T12:00:00Z');

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(now);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('rejects joining a room whose expiresAt has passed', async () => {
      jest.spyOn(roomRepository, 'findOne').mockResolvedValue({
        ...mockRoom,
        expiresAt: new Date(now.getTime() - 1000),
        roomUsers: [],
      });

      await expect(service.join(mockRoom.id, '1')).rejects.toThrow(
        new BadRequestException('Room has expired'),
      );
      expect(roomUserRepository.save).not.toHaveBeenCalled();
    });

    it('allows joining right up until expiry', async () => {
      jest.spyOn(roomRepository, 'findOne').mockResolvedValue({
        ...mockRoom,
        expiresAt: new Date(now.getTime() + 60 * 1000),
        roomUsers: [],
      });
      await expect(service.join(mockRoom.id, '1')).resolves.toEqual(mockRoomUser);

      // Advance the clock past expiresAt: the same room is now unplayable.
      jest.advanceTimersByTime(61 * 1000);
      await expect(service.join(mockRoom.id, '1')).rejects.toThrow(
        'Room has expired',
      );
    });

    it('rejects a guess once the room has expired', async () => {
      jest.spyOn(roomUserRepository, 'findOne').mockResolvedValue({
        ...mockRoomUser,
        room: {
          ...mockRoom,
          lyric: mockLyric,
          expiresAt: new Date(now.getTime() - 1),
        },
      } as RoomUser);

      await expect(
        service.submitGuess(mockRoom.id, '1', { guess: 'x' }),
      ).rejects.toThrow(new BadRequestException('Room has expired'));
      expect(roomUserRepository.save).not.toHaveBeenCalled();
    });

    it('sweeper closes expired rooms with a single UPDATE', async () => {
      jest.spyOn(roomRepository, 'update').mockResolvedValue({
        affected: 2,
      } as any);

      const closed = await service.checkAndCloseExpiredRooms();

      expect(closed).toBe(2);
      expect(roomRepository.update).toHaveBeenCalledTimes(1);
      expect(roomRepository.update).toHaveBeenCalledWith(
        { isClosed: false, expiresAt: LessThanOrEqual(now) },
        { isClosed: true },
      );
    });
  });

  describe('deactivated lyrics', () => {
    const inactiveLyric = { ...mockLyric, isActive: false } as Lyrics;

    it('rejects joining a room whose lyric was deactivated', async () => {
      jest.spyOn(roomRepository, 'findOne').mockResolvedValue({
        ...mockRoom,
        lyric: inactiveLyric,
        roomUsers: [],
      });

      await expect(service.join(mockRoom.id, '1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a guess on a deactivated lyric', async () => {
      jest.spyOn(roomUserRepository, 'findOne').mockResolvedValue({
        ...mockRoomUser,
        room: { ...mockRoom, lyric: inactiveLyric },
      } as RoomUser);

      await expect(
        service.submitGuess(mockRoom.id, '1', { guess: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('never reveals the content of a deactivated lyric in room status', async () => {
      jest.spyOn(roomRepository, 'findOne').mockResolvedValue({
        ...mockRoom,
        lyric: inactiveLyric,
        roomUsers: [{ ...mockRoomUser, hasGuessed: true }],
      });

      const result = await service.getRoomStatus(mockRoom.id, '1');

      expect(result.lyric.content).toBe('');
    });
  });
});

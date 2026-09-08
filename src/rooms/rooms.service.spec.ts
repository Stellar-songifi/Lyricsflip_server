import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoomsService } from './rooms.service';
import { Room } from './entities/room.entity';
import { RoomUser } from './entities/room-user.entity';
import { Lyrics } from '../lyrics/entities/lyrics.entity';
import { ConflictException, NotFoundException } from '@nestjs/common';

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
        relations: ['roomUsers'],
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
});

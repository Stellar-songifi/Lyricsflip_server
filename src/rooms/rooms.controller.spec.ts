import { Test, TestingModule } from '@nestjs/testing';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { Room } from './entities/room.entity';
import { RoomUser } from './entities/room-user.entity';
import { Lyrics } from '../lyrics/entities/lyrics.entity';
import { Genre } from '../lyrics/entities/lyrics.entity';
import { User } from '../users/entities/user.entity';

describe('RoomsController', () => {
  let controller: RoomsController;
  let service: RoomsService;

  const mockUser = {
    id: '1',
    email: 'test@example.com',
    username: 'testuser',
    name: 'Test User',
    passwordHash: 'hash',
    xp: 0,
    level: 1,
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: new Date(),
  } as User;

  const mockLyric = {
    id: 1,
    content: 'Test lyric text',
    artist: 'Test Artist',
    songTitle: 'Test Song',
    genre: Genre.Pop,
    decade: '2020s',
    createdBy: mockUser,
    createdAt: new Date(),
  } as Lyrics;

  const mockRoom = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Test Room',
    lyric: mockLyric,
    lyricId: 1,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    isClosed: false,
    roomUsers: [],
  } as Room;

  const mockRoomUser = {
    id: '123e4567-e89b-12d3-a456-426614174001',
    user: mockUser,
    userId: '1',
    room: mockRoom,
    roomId: mockRoom.id,
    hasGuessed: false,
    score: 0,
    guess: '',
    joinedAt: new Date(),
    guessedAt: new Date(),
  } as RoomUser;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoomsController],
      providers: [
        {
          provide: RoomsService,
          useValue: {
            create: jest.fn().mockResolvedValue(mockRoom),
            join: jest.fn().mockResolvedValue(mockRoomUser),
            getRoomStatus: jest.fn().mockResolvedValue(mockRoom),
            submitGuess: jest.fn().mockResolvedValue({
              ...mockRoomUser,
              hasGuessed: true,
              score: 0.8,
              guess: 'Test guess',
              guessedAt: new Date(),
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<RoomsController>(RoomsController);
    service = module.get<RoomsService>(RoomsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should create a new room', async () => {
    const createRoomDto = { name: 'Test Room' };
    const result = await controller.create(createRoomDto);
    expect(result).toEqual(mockRoom);
    expect(service.create).toHaveBeenCalledWith(createRoomDto);
  });

  it('should allow a user to join a room', async () => {
    const result = await controller.join(mockRoom.id, '1');
    expect(result).toEqual(mockRoomUser);
    expect(service.join).toHaveBeenCalledWith(mockRoom.id, '1');
  });

  it('should return room status', async () => {
    const result = await controller.getRoomStatus(mockRoom.id, '1');
    expect(result).toEqual(mockRoom);
    expect(service.getRoomStatus).toHaveBeenCalledWith(mockRoom.id, '1');
  });

  it('should submit a guess and return updated room user', async () => {
    const guessDto = { guess: 'Test guess' };
    const result = await controller.submitGuess(mockRoom.id, '1', guessDto);
    expect(result.hasGuessed).toBe(true);
    expect(result.score).toBe(0.8);
    expect(service.submitGuess).toHaveBeenCalledWith(mockRoom.id, '1', guessDto);
  });
});

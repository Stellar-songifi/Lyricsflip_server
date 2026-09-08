import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { UsersService } from '../users/users.service';
import { LyricsService } from '../lyrics/lyrics.service';

describe('AdminService', () => {
  let service: AdminService;

  const mockUsersService = {
    findAll: jest.fn(),
    remove: jest.fn(),
  };

  const mockLyricsService = {
    findAll: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: LyricsService, useValue: mockLyricsService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should list users through the users service', async () => {
    const users = [{ id: 'user-1' }];
    mockUsersService.findAll.mockResolvedValue(users);

    await expect(service.findAllUsers()).resolves.toEqual(users);
    expect(mockUsersService.findAll).toHaveBeenCalled();
  });

  it('should report the message returned when deleting a user', async () => {
    mockUsersService.remove.mockResolvedValue({ message: 'User deleted' });

    await expect(service.deleteUser('user-1')).resolves.toBe('User deleted');
    expect(mockUsersService.remove).toHaveBeenCalledWith('user-1');
  });

  it('should fall back to a default message when deletion returns none', async () => {
    mockUsersService.remove.mockResolvedValue({});

    await expect(service.deleteUser('user-1')).resolves.toBe(
      'User deleted successfully',
    );
  });

  it('should list lyrics through the lyrics service', async () => {
    const lyrics = [{ id: 1 }];
    mockLyricsService.findAll.mockResolvedValue(lyrics);

    await expect(service.findAllLyrics()).resolves.toEqual(lyrics);
    expect(mockLyricsService.findAll).toHaveBeenCalled();
  });

  it('should delete lyrics by numeric id', async () => {
    mockLyricsService.remove.mockResolvedValue(undefined);

    await service.deleteLyric(7);

    expect(mockLyricsService.remove).toHaveBeenCalledWith(7);
  });
});

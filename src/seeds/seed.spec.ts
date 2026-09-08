import { NestFactory } from '@nestjs/core';
import { Repository } from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { Lyrics } from 'src/lyrics/entities/lyrics.entity';

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: jest.fn(),
  },
}));

describe('Seed Script', () => {
  let mockUserRepo: Partial<Repository<User>>;
  let mockLyricsRepo: Partial<Repository<Lyrics>>;
  let mockApp: any;

  beforeEach(() => {
    mockUserRepo = {
      findOne: jest.fn(),
      create: jest.fn((entity: any) => entity as User) as any,
      save: (jest.fn(async (entity: any) => ({ id: 'user-1', ...entity })) as any)
    };

    mockLyricsRepo = {
      findOne: jest.fn(),
      save: (jest.fn(async (entity: any) => ({ id: 'user-1', ...entity })) as any)
    };

    mockApp = {
      get: jest.fn((token) => {
        if (token === 'UserRepository') return mockUserRepo;
        if (token === 'LyricsRepository') return mockLyricsRepo;
      }),
      close: jest.fn(),
    };

    (NestFactory.createApplicationContext as jest.Mock).mockResolvedValue(mockApp);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should create an admin user if not exists and seed lyrics', async () => {
    // Mock that no admin exists initially
    (mockUserRepo.findOne as jest.Mock).mockResolvedValueOnce(null);

    // Mock that no lyrics exist
    (mockLyricsRepo.findOne as jest.Mock).mockResolvedValue(null);

    // Import the bootstrap function from your script
    const { bootstrap }: any = await import('./seed'); // <-- change path if needed
    await bootstrap();

    expect(mockUserRepo.findOne).toHaveBeenCalledWith({
      where: { email: 'admin@lyricflip.local' },
    });

    expect(mockUserRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'admin@lyricflip.local',
        username: 'seedadmin',
        name: 'Seed Admin',
      }),
    );

    expect(mockUserRepo.save).toHaveBeenCalled();

    expect(mockLyricsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.any(String),
        createdBy: { id: 'user-1' },
        createdAt: expect.any(Date),
        genre: expect.any(String),
      }),
    );

    expect(mockApp.close).toHaveBeenCalled();
  });

  it('should not create admin if it exists', async () => {
    (mockUserRepo.findOne as jest.Mock).mockResolvedValueOnce({
      id: 'admin-id',
      email: 'admin@lyricflip.local',
    });

    const { bootstrap }: any = await import('./seed');
    await bootstrap();

    expect(mockUserRepo.create).not.toHaveBeenCalled();
  });
});
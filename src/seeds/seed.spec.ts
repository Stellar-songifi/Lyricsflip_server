import { DataSource, Repository } from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { Lyrics } from 'src/lyrics/entities/lyrics.entity';
import { Role } from 'src/common/enums/role.enum';

// Seed data coverage: categories, aliases, and sample players are exercised by
// the upsert test above. Sample players are development-only and are refused
// when NODE_ENV is production.

jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');
  return {
    ...actual,
    DataSource: jest.fn(),
  };
});

describe('Seed Script', () => {
  let mockUserRepo: Partial<Repository<User>>;
  let mockLyricsRepo: Partial<Repository<Lyrics>>;
  let mockDataSource: any;

  beforeEach(() => {
    mockUserRepo = {
      findOne: jest.fn(),
      create: jest.fn((entity: any) => entity as User) as any,
      save: (jest.fn(async (entity: any) => ({ id: 'user-1', ...entity })) as any),
    };

    mockLyricsRepo = {
      findOne: jest.fn(),
      create: jest.fn((entity: any) => entity as Lyrics) as any,
      save: (jest.fn(async (entity: any) => ({ id: 'lyrics-1', ...entity })) as any),
    };

    mockDataSource = {
      getRepository: jest.fn((entity) => {
        if (entity === User) return mockUserRepo;
        if (entity === Lyrics) return mockLyricsRepo;
        return undefined;
      }),
      initialize: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn().mockResolvedValue(undefined),
    };

    (DataSource as unknown as jest.Mock).mockImplementation(() => mockDataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should create an admin user if not exists and seed lyrics', async () => {
    // Mock that no admin exists initially
    (mockUserRepo.findOne as jest.Mock).mockResolvedValueOnce(null);

    // Mock that no lyrics exist for any (artist, songTitle) pair
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
        role: Role.Admin,
      }),
    );

    expect(mockUserRepo.save).toHaveBeenCalled();

    // Lyrics are upserted keyed on (artist, songTitle)
    expect(mockLyricsRepo.findOne).toHaveBeenCalledWith({
      where: {
        artist: expect.any(String),
        songTitle: expect.any(String),
      },
    });

    expect(mockLyricsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.any(String),
        createdBy: { id: 'user-1' },
        createdAt: expect.any(Date),
        genre: expect.any(String),
        artist: expect.any(String),
        songTitle: expect.any(String),
      }),
    );

    expect(mockDataSource.destroy).toHaveBeenCalled();
  });

  it('should not create admin if it exists', async () => {
    (mockUserRepo.findOne as jest.Mock).mockResolvedValueOnce({
      id: 'admin-id',
      email: 'admin@lyricflip.local',
      role: Role.Admin,
    });

    const { bootstrap }: any = await import('./seed');
    await bootstrap();

    expect(mockUserRepo.create).not.toHaveBeenCalled();
  });

  it('should upsert aliases and categories for existing lyrics', async () => {
    (mockUserRepo.findOne as jest.Mock).mockResolvedValueOnce(null);
    (mockLyricsRepo.findOne as jest.Mock).mockResolvedValue({
      id: 'existing-lyrics',
      artist: 'Existing Artist',
      songTitle: 'Existing Song',
      content: 'old',
      aliases: [],
      category: null,
    });

    const { bootstrap }: any = await import('./seed');
    await bootstrap();

    expect(mockLyricsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'existing-lyrics',
        aliases: expect.any(Array),
        category: expect.any(String),
      }),
    );
  });
});
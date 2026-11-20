import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GameLogicService } from './game.service';
import { Lyrics as Lyric } from '../lyrics/entities/lyrics.entity';
import { Genre } from '../lyrics/entities/genre.enum';
import { MusicGenre } from '../users/entities/user.entity';
import { GameRound } from './entities/game-round.entity';
import { GameSession } from './entities/game-session.entity';

const createQueryBuilderMock = (lyrics: Lyric[]) => {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(lyrics),
  };
  return qb;
};

describe('GameLogicService', () => {
  let service: GameLogicService;
  let lyricRepository: { createQueryBuilder: jest.Mock };

  const lyric = { id: 1, content: 'line', genre: Genre.Pop } as Lyric;

  beforeEach(async () => {
    lyricRepository = {
      createQueryBuilder: jest.fn(() => createQueryBuilderMock([lyric])),
    };

    const roundRepository = {
      createQueryBuilder: jest.fn(() => createQueryBuilderMock([])),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
      create: jest.fn((value) => value),
      delete: jest.fn(),
    };

    const sessionRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
      create: jest.fn((value) => value),
      delete: jest.fn(),
    };

    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    };

    const eventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameLogicService,
        { provide: getRepositoryToken(Lyric), useValue: lyricRepository },
        { provide: getRepositoryToken(GameRound), useValue: roundRepository },
        {
          provide: getRepositoryToken(GameSession),
          useValue: sessionRepository,
        },
        { provide: ConfigService, useValue: configService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<GameLogicService>(GameLogicService);
  });

  it('returns a lyric when no filters are provided', async () => {
    const result = await service.getRandomLyric();
    expect(result).toEqual(lyric);
  });

  it('throws BadRequestException for an invalid explicit genre filter', async () => {
    await expect(
      service.getRandomLyric({ genre: 'NotAGenre' as Genre }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a valid explicit genre filter', async () => {
    const result = await service.getRandomLyric({ genre: Genre.Pop });
    expect(result).toEqual(lyric);
  });

  describe('preference fallback', () => {
    const musicGenres = Object.values(MusicGenre);

    it.each(musicGenres)(
      'does not fail for preferred genre %s',
      async (preferredGenre) => {
        await expect(
          service.getRandomLyric({ preferredGenre }),
        ).resolves.toBeDefined();
      },
    );

    it('ignores a preference that is not a valid lyric genre', async () => {
      const qb = createQueryBuilderMock([lyric]);
      lyricRepository.createQueryBuilder.mockReturnValueOnce(qb);

      await service.getRandomLyric({ preferredGenre: MusicGenre.Rock });

      const genreFilterApplied = qb.andWhere.mock.calls.some((call) =>
        String(call[0]).includes('genre'),
      );
      expect(genreFilterApplied).toBe(false);
    });
  });
});

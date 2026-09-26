import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SelectQueryBuilder } from 'typeorm';
import { Lyrics } from 'src/lyrics/entities/lyrics.entity';
import { GameHistory } from 'src/game-history/entities/game-history.entity';
import { DifficultyCalibratorJob } from './difficulty-calibrator.job';

describe('DifficultyCalibratorJob', () => {
  let job: DifficultyCalibratorJob;

  let lyricsRepository: {
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let ghQueryBuilder: jest.Mocked<SelectQueryBuilder<GameHistory>>;

  beforeEach(async () => {
    ghQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      having: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    } as any;

    lyricsRepository = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DifficultyCalibratorJob,
        {
          provide: getRepositoryToken(Lyrics),
          useValue: lyricsRepository,
        },
        {
          provide: getRepositoryToken(GameHistory),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(ghQueryBuilder),
          },
        },
      ],
    }).compile();

    job = module.get<DifficultyCalibratorJob>(DifficultyCalibratorJob);
  });

  it('should be defined', () => {
    expect(job).toBeDefined();
  });

  it('returns 0 when no lyrics have enough attempts', async () => {
    ghQueryBuilder.getRawMany.mockResolvedValue([]);

    const count = await job.runCalibration();

    expect(count).toBe(0);
    expect(lyricsRepository.update).not.toHaveBeenCalled();
  });

  it('skips a lyric that no longer exists in the database', async () => {
    ghQueryBuilder.getRawMany.mockResolvedValue([
      { lyricId: 99, total: '15', correct: '10' },
    ]);
    lyricsRepository.findOne.mockResolvedValue(null);

    const count = await job.runCalibration();

    expect(count).toBe(0);
    expect(lyricsRepository.update).not.toHaveBeenCalled();
  });

  it('skips a lyric whose difficulty is already correct', async () => {
    // rate = 12/15 = 0.8 → difficulty 1
    ghQueryBuilder.getRawMany.mockResolvedValue([
      { lyricId: 1, total: '15', correct: '12' },
    ]);
    lyricsRepository.findOne.mockResolvedValue({ id: 1, difficulty: 1 });

    const count = await job.runCalibration();

    expect(count).toBe(0);
    expect(lyricsRepository.update).not.toHaveBeenCalled();
  });

  it('updates a lyric when the computed difficulty differs', async () => {
    // rate = 5/15 ≈ 0.33 → between 0.20 and 0.40, so difficulty 4
    ghQueryBuilder.getRawMany.mockResolvedValue([
      { lyricId: 1, total: '15', correct: '5' },
    ]);
    lyricsRepository.findOne.mockResolvedValue({ id: 1, difficulty: 1 });

    const count = await job.runCalibration();

    expect(count).toBe(1);
    expect(lyricsRepository.update).toHaveBeenCalledWith(1, { difficulty: 4 });
  });

  describe('rateTodifficulty mapping', () => {
    const cases: [number, number, number, number][] = [
      // [correct, total, expectedDifficulty, description_idx]
      [16, 20, 1, 0],  // rate=0.80 → 1 (very easy, boundary)
      [18, 20, 1, 1],  // rate=0.90 → 1
      [12, 20, 2, 2],  // rate=0.60 → 2 (boundary)
      [14, 20, 2, 3],  // rate=0.70 → 2
      [8, 20, 3, 4],   // rate=0.40 → 3 (boundary, neutral default)
      [10, 20, 3, 5],  // rate=0.50 → 3
      [4, 20, 4, 6],   // rate=0.20 → 4 (boundary)
      [6, 20, 4, 7],   // rate=0.30 → 4
      [3, 20, 5, 8],   // rate=0.15 → 5 (very hard)
      [0, 20, 5, 9],   // rate=0.00 → 5
    ];

    test.each(cases)(
      'correct=%i total=%i → difficulty %i',
      async (correct, total, expectedDifficulty) => {
        ghQueryBuilder.getRawMany.mockResolvedValue([
          { lyricId: 1, total: String(total), correct: String(correct) },
        ]);
        // Start with a different difficulty so the update always fires
        lyricsRepository.findOne.mockResolvedValue({
          id: 1,
          difficulty: expectedDifficulty === 1 ? 5 : 1,
        });

        await job.runCalibration();

        expect(lyricsRepository.update).toHaveBeenCalledWith(1, {
          difficulty: expectedDifficulty,
        });
      },
    );
  });

  it('processes multiple lyrics in one run', async () => {
    ghQueryBuilder.getRawMany.mockResolvedValue([
      { lyricId: 1, total: '20', correct: '18' }, // rate=0.90 → 1
      { lyricId: 2, total: '20', correct: '2' },  // rate=0.10 → 5
    ]);
    lyricsRepository.findOne
      .mockResolvedValueOnce({ id: 1, difficulty: 3 })
      .mockResolvedValueOnce({ id: 2, difficulty: 3 });

    const count = await job.runCalibration();

    expect(count).toBe(2);
    expect(lyricsRepository.update).toHaveBeenCalledWith(1, { difficulty: 1 });
    expect(lyricsRepository.update).toHaveBeenCalledWith(2, { difficulty: 5 });
  });
});

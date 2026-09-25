import { Test, TestingModule } from '@nestjs/testing';
import { GameController } from './game.controller';
import { GameLogicService } from './game.service';

describe('GameController', () => {
  let controller: GameController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GameController],
      providers: [
        {
          provide: GameLogicService,
          useValue: {
            getRandomLyric: jest.fn(),
            getMultipleRandomLyrics: jest.fn(),
            validateGuess: jest.fn(),
            checkGuess: jest.fn(),
            issueRound: jest.fn(),
            guessRound: jest.fn(),
            getLyricStats: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<GameController>(GameController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('issues a round with each served lyric and hides the answer', async () => {
    const service = controller[
      'gameLogicService'
    ] as jest.Mocked<GameLogicService>;
    const expiresAt = new Date();
    service.getRandomLyric.mockResolvedValue({
      id: 7,
      lyricSnippet: 'snippet',
      songTitle: 'Secret Song',
      artist: 'Secret Artist',
    });
    service.issueRound.mockResolvedValue({ id: 'round-9', expiresAt } as any);

    const result = await controller.getRandomLyric({}, {
      id: 'player-1',
    } as any);

    expect(service.issueRound).toHaveBeenCalledWith('player-1', 7);
    expect(result).toMatchObject({ roundId: 'round-9', expiresAt, id: 7 });
    expect(result).not.toHaveProperty('artist');
    expect(result).not.toHaveProperty('songTitle');
  });

  it("scores guesses through the caller's round", async () => {
    const service = controller[
      'gameLogicService'
    ] as jest.Mocked<GameLogicService>;
    service.validateGuess.mockReturnValue({ isValid: true });
    service.guessRound.mockResolvedValue({
      isCorrect: true,
      correctAnswer: 'Secret Artist',
      points: 100,
    });

    const dto = {
      roundId: '8f0c2c0e-1b8a-4d1e-9d4f-0a1b2c3d4e5f',
      guessType: 'artist',
      guessValue: 'Secret Artist',
    } as any;

    await controller.checkGuess(dto, { id: 'player-1' } as any);

    expect(service.guessRound).toHaveBeenCalledWith('player-1', dto);
    expect(service.checkGuess).not.toHaveBeenCalled();
  });
});

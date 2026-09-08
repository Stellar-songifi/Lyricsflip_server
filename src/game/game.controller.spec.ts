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
});

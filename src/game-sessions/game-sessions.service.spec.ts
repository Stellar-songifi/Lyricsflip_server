import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GameSessionsService } from './game-sessions.service';
import {
  GameSession,
  GameSessionStatus,
  GameMode,
  GameCategory,
} from './entities/game-session.entity';
import { User } from '../users/entities/user.entity';
import { WagerService } from '../tokens/services/wager.service';
import { TOKEN_SERVICE } from '../tokens/interfaces/token.interface';
import { CreateGameSessionDto } from './dto/create-game-session.dto';
import { toStroops } from '../stellar/amount.util';

/** 10 LYRIC per player, as the wire format and as base units. */
const STAKE_DISPLAY = '10';
const STAKE_STROOPS = toStroops(STAKE_DISPLAY);

describe('GameSessionsService', () => {
  let service: GameSessionsService;

  const mockUser: User = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    email: 'test@example.com',
    username: 'testuser',
    name: 'Test User',
    passwordHash: 'hashedpassword',
    mockBalance: toStroops('100'),
    xp: 0,
    level: 1,
    levelTitle: 'Gossip Rookie' as any,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: 'user' as any,
    isActive: true,
    gameSessions: [],
  };

  const mockPlayerTwo: User = {
    id: '456e7890-e89b-12d3-a456-426614174001',
    email: 'player2@example.com',
    username: 'player2',
    name: 'Player Two',
    passwordHash: 'hashedpassword',
    mockBalance: toStroops('100'),
    xp: 0,
    level: 1,
    levelTitle: 'Gossip Rookie' as any,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: 'user' as any,
    isActive: true,
    gameSessions: [],
  };

  const mockGameSession: GameSession = {
    id: 'session-123',
    player: mockUser,
    playerTwo: mockPlayerTwo,
    playerTwoId: mockPlayerTwo.id,
    score: 0,
    playerTwoScore: 0,
    category: GameCategory.HIP_HOP,
    mode: GameMode.WAGERED,
    status: GameSessionStatus.IN_PROGRESS,
    winner: null as any,
    winnerId: null as any,
    wagerStroops: STAKE_STROOPS,
    hasWager: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null as any,
  };

  const mockGameSessionRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
  };

  const mockUserRepository = {
    findOne: jest.fn(),
  };

  const mockWagerService = {
    createWager: jest.fn(),
    resolveWagerWithWinner: jest.fn(),
    resolveWagerAsDraw: jest.fn(),
    getWagerBySessionId: jest.fn(),
    getUserWagers: jest.fn(),
  };

  const mockTokenService = {
    settlementMode: 'mock' as const,
    hasSufficientTokens: jest.fn(),
    getUserBalance: jest.fn(),
    openEscrow: jest.fn(),
    stakeTokens: jest.fn(),
    confirmStake: jest.fn(),
    releaseToWinner: jest.fn(),
    refundEscrow: jest.fn(),
    reconcile: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameSessionsService,
        {
          provide: getRepositoryToken(GameSession),
          useValue: mockGameSessionRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: WagerService,
          useValue: mockWagerService,
        },
        {
          provide: TOKEN_SERVICE,
          useValue: mockTokenService,
        },
      ],
    }).compile();

    service = module.get<GameSessionsService>(GameSessionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a single player game session', async () => {
      const createGameSessionDto: CreateGameSessionDto = {
        category: GameCategory.HIP_HOP,
        mode: GameMode.SINGLE_PLAYER,
      };

      mockGameSessionRepository.create.mockReturnValue(mockGameSession);
      mockGameSessionRepository.save.mockResolvedValue(mockGameSession);

      const result = await service.create(createGameSessionDto, mockUser);

      expect(result).toEqual(mockGameSession);
      expect(mockGameSessionRepository.create).toHaveBeenCalledWith({
        ...createGameSessionDto,
        player: mockUser,
        wagerStroops: null,
        status: GameSessionStatus.IN_PROGRESS,
      });
    });

    it('should create a wagered game session with wager', async () => {
      const createGameSessionDto: CreateGameSessionDto = {
        category: GameCategory.HIP_HOP,
        mode: GameMode.WAGERED,
        playerTwoId: mockPlayerTwo.id,
        wagerAmount: STAKE_DISPLAY,
        hasWager: true,
      };

      mockUserRepository.findOne.mockResolvedValue(mockPlayerTwo);
      mockTokenService.hasSufficientTokens
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      mockGameSessionRepository.create.mockReturnValue(mockGameSession);
      mockGameSessionRepository.save.mockResolvedValue(mockGameSession);
      mockWagerService.createWager.mockResolvedValue({
        success: true,
        wager: {},
      });

      const result = await service.create(createGameSessionDto, mockUser);

      expect(result).toEqual(mockGameSession);
      expect(mockWagerService.createWager).toHaveBeenCalledWith({
        sessionId: mockGameSession.id,
        playerAId: mockUser.id,
        playerBId: mockPlayerTwo.id,
        stake: STAKE_STROOPS,
      });
      // The stake reaches the settlement layer in base units, never as the
      // display number that arrived on the wire.
      expect(mockTokenService.hasSufficientTokens).toHaveBeenCalledWith(
        mockUser.id,
        STAKE_STROOPS,
      );
    });

    it('should fail when player two not found for multiplayer game', async () => {
      const createGameSessionDto: CreateGameSessionDto = {
        category: GameCategory.HIP_HOP,
        mode: GameMode.MULTIPLAYER,
        playerTwoId: 'non-existent-id',
      };

      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.create(createGameSessionDto, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should fail when player tries to play against themselves', async () => {
      const createGameSessionDto: CreateGameSessionDto = {
        category: GameCategory.HIP_HOP,
        mode: GameMode.MULTIPLAYER,
        playerTwoId: mockUser.id,
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);

      await expect(
        service.create(createGameSessionDto, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should fail when player has insufficient tokens for wagered game', async () => {
      const createGameSessionDto: CreateGameSessionDto = {
        category: GameCategory.HIP_HOP,
        mode: GameMode.WAGERED,
        playerTwoId: mockPlayerTwo.id,
        wagerAmount: STAKE_DISPLAY,
        hasWager: true,
      };

      mockUserRepository.findOne.mockResolvedValue(mockPlayerTwo);
      mockTokenService.hasSufficientTokens
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await expect(
        service.create(createGameSessionDto, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should fail when wager creation fails', async () => {
      const createGameSessionDto: CreateGameSessionDto = {
        category: GameCategory.HIP_HOP,
        mode: GameMode.WAGERED,
        playerTwoId: mockPlayerTwo.id,
        wagerAmount: STAKE_DISPLAY,
        hasWager: true,
      };

      mockUserRepository.findOne.mockResolvedValue(mockPlayerTwo);
      mockTokenService.hasSufficientTokens
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      mockGameSessionRepository.create.mockReturnValue(mockGameSession);
      mockGameSessionRepository.save.mockResolvedValue(mockGameSession);
      mockWagerService.createWager.mockResolvedValue({
        success: false,
        message: 'Failed to create wager',
      });
      mockGameSessionRepository.delete.mockResolvedValue({ affected: 1 });

      await expect(
        service.create(createGameSessionDto, mockUser),
      ).rejects.toThrow(BadRequestException);

      expect(mockGameSessionRepository.delete).toHaveBeenCalledWith(
        mockGameSession.id,
      );
    });
  });

  describe('completeWageredGame', () => {
    it('should complete wagered game with player one winning', async () => {
      const sessionId = 'session-123';
      const playerOneScore = 100;
      const playerTwoScore = 50;

      mockGameSessionRepository.findOne.mockResolvedValue(mockGameSession);
      mockWagerService.resolveWagerWithWinner.mockResolvedValue({
        success: true,
        message: 'You won 20 tokens!',
      });
      mockGameSessionRepository.save.mockResolvedValue({
        ...mockGameSession,
        score: playerOneScore,
        playerTwoScore,
        status: GameSessionStatus.COMPLETED,
        winnerId: mockUser.id,
        winner: mockUser,
      });

      const result = await service.completeWageredGame(
        sessionId,
        playerOneScore,
        playerTwoScore,
      );

      expect(result.gameSession.winnerId).toBe(mockUser.id);
      expect(result.message).toContain('testuser wins!');
      expect(mockWagerService.resolveWagerWithWinner).toHaveBeenCalledWith(
        sessionId,
        mockUser.id,
      );
    });

    it('should complete wagered game with player two winning', async () => {
      const sessionId = 'session-123';
      const playerOneScore = 50;
      const playerTwoScore = 100;

      mockGameSessionRepository.findOne.mockResolvedValue({
        ...mockGameSession,
        status: GameSessionStatus.IN_PROGRESS,
      });
      mockWagerService.resolveWagerWithWinner.mockResolvedValue({
        success: true,
        message: 'You won 20 tokens!',
      });
      mockGameSessionRepository.save.mockResolvedValue({
        ...mockGameSession,
        score: playerOneScore,
        playerTwoScore,
        status: GameSessionStatus.COMPLETED,
        winnerId: mockPlayerTwo.id,
        winner: mockPlayerTwo,
      });

      const result = await service.completeWageredGame(
        sessionId,
        playerOneScore,
        playerTwoScore,
      );

      expect(result.gameSession.winnerId).toBe(mockPlayerTwo.id);
      expect(result.message).toContain('player2 wins!');
      expect(mockWagerService.resolveWagerWithWinner).toHaveBeenCalledWith(
        sessionId,
        mockPlayerTwo.id,
      );
    });

    it('should complete wagered game with a draw', async () => {
      const sessionId = 'session-123';
      const playerOneScore = 50;
      const playerTwoScore = 50;

      mockGameSessionRepository.findOne.mockResolvedValue({
        ...mockGameSession,
        status: GameSessionStatus.IN_PROGRESS,
      });
      mockWagerService.resolveWagerAsDraw.mockResolvedValue({
        success: true,
        message: 'Draw! Each player received their 10 tokens back.',
      });
      mockGameSessionRepository.save.mockResolvedValue({
        ...mockGameSession,
        score: playerOneScore,
        playerTwoScore,
        status: GameSessionStatus.COMPLETED,
      });

      const result = await service.completeWageredGame(
        sessionId,
        playerOneScore,
        playerTwoScore,
      );

      expect(result.message).toContain("It's a draw!");
      expect(mockWagerService.resolveWagerAsDraw).toHaveBeenCalledWith(
        sessionId,
      );
    });

    it('should fail when game session is not found', async () => {
      const sessionId = 'non-existent-session';
      const playerOneScore = 100;
      const playerTwoScore = 50;

      mockGameSessionRepository.findOne.mockResolvedValue(null);

      await expect(
        service.completeWageredGame(sessionId, playerOneScore, playerTwoScore),
      ).rejects.toThrow(NotFoundException);
    });

    it('should fail when game session does not have a wager', async () => {
      const sessionId = 'session-123';
      const playerOneScore = 100;
      const playerTwoScore = 50;

      mockGameSessionRepository.findOne.mockResolvedValue({
        ...mockGameSession,
        hasWager: false,
      });

      await expect(
        service.completeWageredGame(sessionId, playerOneScore, playerTwoScore),
      ).rejects.toThrow(BadRequestException);
    });

    it('should fail when game session is already completed', async () => {
      const sessionId = 'session-123';
      const playerOneScore = 100;
      const playerTwoScore = 50;

      mockGameSessionRepository.findOne.mockResolvedValue({
        ...mockGameSession,
        status: GameSessionStatus.COMPLETED,
      });

      await expect(
        service.completeWageredGame(sessionId, playerOneScore, playerTwoScore),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getUserTokenBalance', () => {
    it('returns the balance as base units and a display amount', async () => {
      const userId = 'user-123';

      mockTokenService.getUserBalance.mockResolvedValue(toStroops('100'));

      const result = await service.getUserTokenBalance(userId);

      expect(result).toEqual({ stroops: '1000000000', display: '100.0' });
      expect(mockTokenService.getUserBalance).toHaveBeenCalledWith(userId);
    });

    it('does not lose precision on a fractional balance', async () => {
      mockTokenService.getUserBalance.mockResolvedValue('1000000001');

      await expect(service.getUserTokenBalance('user-123')).resolves.toEqual({
        stroops: '1000000001',
        display: '100.0000001',
      });
    });
  });

  describe('getSessionWager', () => {
    it('should return session wager', async () => {
      const sessionId = 'session-123';
      const wager = { id: 'wager-123', amount: 10 };

      mockWagerService.getWagerBySessionId.mockResolvedValue(wager);

      const result = await service.getSessionWager(sessionId);

      expect(result).toBe(wager);
      expect(mockWagerService.getWagerBySessionId).toHaveBeenCalledWith(
        sessionId,
      );
    });
  });

  describe('getUserWagers', () => {
    it('should return user wagers', async () => {
      const userId = 'user-123';
      const wagers = [{ id: 'wager-123', amount: 10 }];

      mockWagerService.getUserWagers.mockResolvedValue(wagers);

      const result = await service.getUserWagers(userId, 10);

      expect(result).toBe(wagers);
      expect(mockWagerService.getUserWagers).toHaveBeenCalledWith(userId, 10);
    });
  });
});

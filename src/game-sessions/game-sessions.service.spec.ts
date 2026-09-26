import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { GameSessionsService } from './game-sessions.service';
import {
  GameSession,
  GameSessionStatus,
  GameMode,
  GameCategory,
} from './entities/game-session.entity';
import { User } from '../users/entities/user.entity';
import { WagerService } from '../tokens/services/wager.service';
import { WagerStatus } from '../tokens/entities/wager.entity';
import { Role } from '../auth/roles/role.enum';
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

  const mockAdmin = {
    id: 'admin-1',
    username: 'admin',
    role: Role.Admin,
  } as User;

  const mockStranger = {
    id: 'stranger-1',
    username: 'stranger',
    role: Role.User,
  } as User;

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
    acceptWager: jest.fn(),
    confirmStake: jest.fn(),
    reconcileWager: jest.fn(),
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
      const wager = { id: 'wager-1', status: 'staked' };
      mockWagerService.createWager.mockResolvedValue({
        success: true,
        wager,
      });

      const result = await service.create(createGameSessionDto, mockUser);

      // The wager rides along with the session: a client that only gets the
      // session back has no handle on the pot it just opened.
      expect(result).toEqual({ ...mockGameSession, wager });
      expect(result).not.toHaveProperty('pendingSignatures');
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
      // Player two has not accepted: the session waits for them and nothing
      // is staked on their behalf.
      expect(mockGameSessionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: GameSessionStatus.WAITING_FOR_PLAYER,
        }),
      );
      expect(mockWagerService.acceptWager).not.toHaveBeenCalled();
      expect(mockTokenService.stakeTokens).not.toHaveBeenCalled();
    });

    it('hands back the transactions the players must sign', async () => {
      const createGameSessionDto: CreateGameSessionDto = {
        category: GameCategory.HIP_HOP,
        mode: GameMode.WAGERED,
        playerTwoId: mockPlayerTwo.id,
        wagerAmount: STAKE_DISPLAY,
        hasWager: true,
      };

      const pendingSignatures = [
        { userId: mockUser.id, transaction: { xdr: 'AAAA...' } },
        { userId: mockPlayerTwo.id, transaction: { xdr: 'BBBB...' } },
      ];

      mockUserRepository.findOne.mockResolvedValue(mockPlayerTwo);
      mockTokenService.hasSufficientTokens
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      mockGameSessionRepository.create.mockReturnValue(mockGameSession);
      mockGameSessionRepository.save.mockResolvedValue(mockGameSession);
      mockWagerService.createWager.mockResolvedValue({
        success: true,
        wager: { id: 'wager-1' },
        pendingSignatures,
      });

      const result = await service.create(createGameSessionDto, mockUser);

      // Without these the pot is opened on-chain and can never be funded:
      // in non-custodial mode the backend cannot sign a player's stake.
      expect(result.pendingSignatures).toEqual(pendingSignatures);
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

  describe('stake confirmation', () => {
    it('passes a signed stake to the wager service as the caller', async () => {
      const wagerResult = { success: true, message: 'Stake confirmed.' };
      mockWagerService.confirmStake.mockResolvedValue(wagerResult);

      await expect(
        service.confirmStake('session-1', 'user-1', 'signed-xdr'),
      ).resolves.toEqual(wagerResult);
      expect(mockWagerService.confirmStake).toHaveBeenCalledWith(
        'session-1',
        'user-1',
        'signed-xdr',
      );
    });

    it('reconciles a wager left mid-settlement', async () => {
      const wagerResult = { success: true, message: 'Nothing to reconcile' };
      mockWagerService.reconcileWager.mockResolvedValue(wagerResult);

      await expect(service.reconcileWager('session-1')).resolves.toEqual(
        wagerResult,
      );
      expect(mockWagerService.reconcileWager).toHaveBeenCalledWith('session-1');
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
        mockAdmin,
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
        mockAdmin,
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
        mockAdmin,
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
        service.completeWageredGame(
          sessionId,
          playerOneScore,
          playerTwoScore,
          mockAdmin,
        ),
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
        service.completeWageredGame(
          sessionId,
          playerOneScore,
          playerTwoScore,
          mockAdmin,
        ),
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
        service.completeWageredGame(
          sessionId,
          playerOneScore,
          playerTwoScore,
          mockAdmin,
        ),
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

      mockGameSessionRepository.findOne.mockResolvedValue(mockGameSession);
      mockWagerService.getWagerBySessionId.mockResolvedValue(wager);

      const result = await service.getSessionWager(sessionId, mockUser);

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

      const result = await service.getUserWagers(userId, 10, 20);

      expect(result).toBe(wagers);
      expect(mockWagerService.getUserWagers).toHaveBeenCalledWith(userId, 10, 20);
    });
  });

  describe('audit log', () => {
    it('records who settled a wager, with the scores and the transaction hash', async () => {
      const audit = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      // Fresh fields: earlier tests complete the shared fixture in place.
      mockGameSessionRepository.findOne.mockResolvedValue({
        ...mockGameSession,
        status: GameSessionStatus.IN_PROGRESS,
        hasWager: true,
        winnerId: null,
      });
      mockGameSessionRepository.save.mockImplementation((session) =>
        Promise.resolve(session),
      );
      mockWagerService.resolveWagerWithWinner.mockResolvedValue({
        success: true,
        message: 'paid',
        wager: { status: WagerStatus.WON, settlementTxHash: 'tx-abc' },
      });

      await service.completeWageredGame('session-123', 3, 1, mockAdmin);

      const entry = JSON.parse(audit.mock.calls.at(-1)?.[0] as string);
      expect(entry).toMatchObject({
        event: 'wager.settlement',
        sessionId: 'session-123',
        triggeredBy: { id: mockAdmin.id, role: Role.Admin },
        playerOneScore: 3,
        playerTwoScore: 1,
        winnerId: mockUser.id,
        success: true,
        settlementTxHash: 'tx-abc',
      });
      audit.mockRestore();
    });
  });

  describe('participant access', () => {
    beforeEach(() => {
      mockGameSessionRepository.findOne.mockResolvedValue({
        ...mockGameSession,
      });
  describe('invitations', () => {
    const invitation = (overrides: Partial<GameSession> = {}): GameSession => ({
      ...mockGameSession,
      status: GameSessionStatus.WAITING_FOR_PLAYER,
      createdAt: new Date(),
      ...overrides,
    });

    beforeEach(() => {
      mockGameSessionRepository.save.mockImplementation((session) =>
        Promise.resolve(session),
      );
    });

    it.each([
      ['player one', mockUser],
      ['player two', mockPlayerTwo],
      ['an admin', mockAdmin],
    ])('lets %s read the session', async (_, user) => {
      await expect(service.findOne('session-123', user)).resolves.toBeDefined();
    });

    it('rejects a non-participant reading the session', async () => {
      await expect(
        service.findOne('session-123', mockStranger),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects a non-participant reading the session's wager", async () => {
      await expect(
        service.getSessionWager('session-123', mockStranger),
      ).rejects.toThrow(ForbiddenException);
      expect(mockWagerService.getWagerBySessionId).not.toHaveBeenCalled();
    });

    it('rejects a non-participant updating the session', async () => {
      await expect(
        service.update(
          'session-123',
          { category: GameCategory.POP },
          mockStranger,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockGameSessionRepository.save).not.toHaveBeenCalled();
    });

    it('only copies the category when a participant updates', async () => {
      await service.update(
        'session-123',
        { category: GameCategory.POP, score: 9999, status: 'completed' } as any,
        mockUser,
      );

      expect(mockGameSessionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          category: GameCategory.POP,
          score: mockGameSession.score,
          status: mockGameSession.status,
        }),
      );
    });

    it('rejects a non-participant deleting the session', async () => {
      await expect(service.remove('session-123', mockStranger)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockGameSessionRepository.delete).not.toHaveBeenCalled();
    });

    it('refuses to delete a session whose wager still holds stakes', async () => {
      mockWagerService.getWagerBySessionId.mockResolvedValue({
        status: WagerStatus.STAKED,
      });

      await expect(service.remove('session-123', mockUser)).rejects.toThrow(
        ConflictException,
      );
      expect(mockGameSessionRepository.delete).not.toHaveBeenCalled();
    });

    it('deletes a session whose wager is settled', async () => {
      mockWagerService.getWagerBySessionId.mockResolvedValue({
        status: WagerStatus.REFUNDED,
      });
      mockGameSessionRepository.delete.mockResolvedValue({ affected: 1 });

      await service.remove('session-123', mockUser);

      expect(mockGameSessionRepository.delete).toHaveBeenCalledWith(
        'session-123',
      );
    });

    it("lists only the caller's sessions for a player", async () => {
      mockGameSessionRepository.find.mockResolvedValue([]);

      await service.findAll(mockUser);

      expect(mockGameSessionRepository.find).toHaveBeenCalledWith({
        where: [{ player: { id: mockUser.id } }, { playerTwoId: mockUser.id }],
        relations: ['player'],
      });
    });

    it('lists every session for an admin', async () => {
      mockGameSessionRepository.find.mockResolvedValue([]);

      await service.findAll(mockAdmin);

      expect(mockGameSessionRepository.find).toHaveBeenCalledWith({
        relations: ['player'],
      });
    it('stakes player two only when they accept', async () => {
      mockGameSessionRepository.findOne.mockResolvedValue(invitation());
      mockWagerService.acceptWager.mockResolvedValue({
        success: true,
        wager: { id: 'wager-123' },
      });

      const result = await service.accept('session-123', mockPlayerTwo);

      expect(mockWagerService.acceptWager).toHaveBeenCalledWith(
        'session-123',
        mockPlayerTwo.id,
      );
      expect(result.status).toBe(GameSessionStatus.IN_PROGRESS);
    });

    it('lets only the invited player accept, and moves no funds otherwise', async () => {
      mockGameSessionRepository.findOne.mockResolvedValue(invitation());

      await expect(service.accept('session-123', mockUser)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockWagerService.acceptWager).not.toHaveBeenCalled();
      expect(mockTokenService.stakeTokens).not.toHaveBeenCalled();
    });

    it('rejects accepting a session that is not waiting for a player', async () => {
      mockGameSessionRepository.findOne.mockResolvedValue(
        invitation({ status: GameSessionStatus.ABANDONED }),
      );

      await expect(
        service.accept('session-123', mockPlayerTwo),
      ).rejects.toThrow(BadRequestException);
      expect(mockWagerService.acceptWager).not.toHaveBeenCalled();
    });

    it('declining abandons the session and refunds player one', async () => {
      mockGameSessionRepository.findOne.mockResolvedValue(invitation());
      mockWagerService.resolveWagerAsDraw.mockResolvedValue({ success: true });

      const result = await service.decline('session-123', mockPlayerTwo);

      expect(result.gameSession.status).toBe(GameSessionStatus.ABANDONED);
      expect(mockWagerService.resolveWagerAsDraw).toHaveBeenCalledWith(
        'session-123',
      );
      expect(mockWagerService.acceptWager).not.toHaveBeenCalled();
    });

    it('an expired invitation cannot be accepted and refunds player one', async () => {
      mockGameSessionRepository.findOne.mockResolvedValue(
        invitation({ createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) }),
      );
      mockWagerService.resolveWagerAsDraw.mockResolvedValue({ success: true });

      await expect(
        service.accept('session-123', mockPlayerTwo),
      ).rejects.toThrow(GoneException);
      expect(mockWagerService.acceptWager).not.toHaveBeenCalled();
      expect(mockWagerService.resolveWagerAsDraw).toHaveBeenCalledWith(
        'session-123',
      );
    });

    it('expires stale invitations and refunds player one', async () => {
      mockGameSessionRepository.find.mockResolvedValue([invitation()]);
      mockWagerService.resolveWagerAsDraw.mockResolvedValue({ success: true });

      const expired = await service.expireInvitations();

      expect(expired).toBe(1);
      expect(mockGameSessionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: GameSessionStatus.ABANDONED }),
      );
      expect(mockWagerService.resolveWagerAsDraw).toHaveBeenCalledWith(
        'session-123',
      );
    });
  });
});

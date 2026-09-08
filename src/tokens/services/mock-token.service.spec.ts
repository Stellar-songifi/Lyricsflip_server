import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { MockTokenService } from './mock-token.service';
import { User } from '../../users/entities/user.entity';
import { EscrowContext, SettlementStatus } from '../interfaces/token.interface';
import { toStroops } from '../../stellar/amount.util';

const PLAYER_A = '123e4567-e89b-12d3-a456-426614174000';
const PLAYER_B = '223e4567-e89b-12d3-a456-426614174001';
const OUTSIDER = '323e4567-e89b-12d3-a456-426614174002';

/** 10 LYRIC per player, so the pot is 20. */
const STAKE = toStroops('10');

describe('MockTokenService', () => {
  let service: MockTokenService;
  let mockEntityManager: Partial<EntityManager>;
  let context: EscrowContext;

  const baseUser: User = {
    id: PLAYER_A,
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
  } as unknown as User;

  const userWithBalance = (id: string, tokens: string): User =>
    ({ ...baseUser, id, mockBalance: toStroops(tokens) }) as User;

  const mockUserRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    manager: {
      transaction: jest.fn(),
    },
  };

  /** Runs the transaction callback against the in-memory entity manager. */
  const runTransactions = () =>
    mockUserRepository.manager.transaction.mockImplementation(
      (callback: (m: EntityManager) => unknown) =>
        callback(mockEntityManager as EntityManager),
    );

  beforeEach(async () => {
    mockEntityManager = {
      findOne: jest.fn(),
      save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MockTokenService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
      ],
    }).compile();

    service = module.get<MockTokenService>(MockTokenService);

    // A fresh session per test: pots are held in-process and keyed by session,
    // so reusing an ID would leak state between cases.
    context = {
      sessionId: `session-${Math.random().toString(36).slice(2)}`,
      playerAId: PLAYER_A,
      playerBId: PLAYER_B,
      stake: STAKE,
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /** Opens the pot and funds both players from a 100 LYRIC balance. */
  const fundBothPlayers = async () => {
    runTransactions();
    (mockEntityManager.findOne as jest.Mock).mockImplementation(
      (_entity, options: { where: { id: string } }) =>
        Promise.resolve(userWithBalance(options.where.id, '100')),
    );
    await service.openEscrow(context);
    await service.stakeTokens(PLAYER_A, context);
    await service.stakeTokens(PLAYER_B, context);
  };

  it('reports itself as the mock settlement backend', () => {
    expect(service.settlementMode).toBe('mock');
  });

  describe('openEscrow', () => {
    it('opens a pot for a session', async () => {
      const result = await service.openEscrow(context);

      expect(result.success).toBe(true);
      expect(result.status).toBe(SettlementStatus.CONFIRMED);
      expect(result.txHash).toMatch(/^mock:[0-9a-f]{64}$/);
      expect(result.message).toContain('10.0 LYRIC');
    });

    it('refuses to open a second pot for the same session', async () => {
      await service.openEscrow(context);

      const result = await service.openEscrow(context);

      expect(result.success).toBe(false);
      expect(result.status).toBe(SettlementStatus.FAILED);
      expect(result.message).toContain('already exists');
    });
  });

  describe('stakeTokens', () => {
    it('debits the player and marks their side of the pot funded', async () => {
      runTransactions();
      (mockEntityManager.findOne as jest.Mock).mockResolvedValue(
        userWithBalance(PLAYER_A, '100'),
      );
      await service.openEscrow(context);

      const result = await service.stakeTokens(PLAYER_A, context);

      expect(result.success).toBe(true);
      expect(result.status).toBe(SettlementStatus.CONFIRMED);
      expect(result.newBalance).toBe(toStroops('90'));
      expect(result.message).toBe('Staked 10.0 LYRIC');
      expect(mockEntityManager.findOne).toHaveBeenCalledWith(User, {
        where: { id: PLAYER_A },
        lock: { mode: 'pessimistic_write' },
      });
      expect(mockEntityManager.save).toHaveBeenCalled();
    });

    it('fails when no pot has been opened for the session', async () => {
      const result = await service.stakeTokens(PLAYER_A, context);

      expect(result.success).toBe(false);
      expect(result.message).toContain('No pot open');
    });

    it('fails when the player cannot cover the stake, without saving', async () => {
      runTransactions();
      (mockEntityManager.findOne as jest.Mock).mockResolvedValue(
        userWithBalance(PLAYER_A, '5'),
      );
      await service.openEscrow(context);

      const result = await service.stakeTokens(PLAYER_A, context);

      expect(result.success).toBe(false);
      expect(result.status).toBe(SettlementStatus.FAILED);
      expect(result.message).toBe(
        'Insufficient balance: have 5.0 LYRIC, need 10.0 LYRIC',
      );
      expect(mockEntityManager.save).not.toHaveBeenCalled();
    });

    it('rejects a user who is not one of the two players', async () => {
      await service.openEscrow(context);

      const result = await service.stakeTokens(OUTSIDER, context);

      expect(result.success).toBe(false);
      expect(result.message).toContain('not a player in this wager');
    });

    it('rejects a second stake from the same player', async () => {
      runTransactions();
      (mockEntityManager.findOne as jest.Mock).mockResolvedValue(
        userWithBalance(PLAYER_A, '100'),
      );
      await service.openEscrow(context);
      await service.stakeTokens(PLAYER_A, context);

      const result = await service.stakeTokens(PLAYER_A, context);

      expect(result.success).toBe(false);
      expect(result.message).toContain('already staked');
    });

    it('fails when the user row is missing', async () => {
      runTransactions();
      (mockEntityManager.findOne as jest.Mock).mockResolvedValue(null);
      await service.openEscrow(context);

      const result = await service.stakeTokens(PLAYER_A, context);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to stake');
    });
  });

  describe('confirmStake', () => {
    it('rejects confirmation, since the mock backend signs its own stakes', async () => {
      const result = await service.confirmStake();

      expect(result.success).toBe(false);
      expect(result.message).toContain('nothing to confirm');
    });
  });

  describe('releaseToWinner', () => {
    it('credits the winner with the whole pot', async () => {
      await fundBothPlayers();

      const result = await service.releaseToWinner(PLAYER_A, context);

      expect(result.success).toBe(true);
      expect(result.status).toBe(SettlementStatus.CONFIRMED);
      expect(result.newBalance).toBe(toStroops('120'));
      expect(result.message).toBe('You won 20.0 LYRIC!');
    });

    it('refuses to release a pot only one player has funded', async () => {
      runTransactions();
      (mockEntityManager.findOne as jest.Mock).mockResolvedValue(
        userWithBalance(PLAYER_A, '100'),
      );
      await service.openEscrow(context);
      await service.stakeTokens(PLAYER_A, context);

      const result = await service.releaseToWinner(PLAYER_A, context);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Both players must stake');
    });

    it('refuses to pay someone who is not in the wager', async () => {
      await fundBothPlayers();

      const result = await service.releaseToWinner(OUTSIDER, context);

      expect(result.success).toBe(false);
      expect(result.message).toContain('must be one of the wagering players');
    });

    it('refuses to release the same pot twice', async () => {
      await fundBothPlayers();
      await service.releaseToWinner(PLAYER_A, context);

      const result = await service.releaseToWinner(PLAYER_A, context);

      expect(result.success).toBe(false);
      expect(result.message).toContain('already been settled');
    });

    it('fails when there is no pot for the session', async () => {
      const result = await service.releaseToWinner(PLAYER_A, context);

      expect(result.success).toBe(false);
      expect(result.message).toContain('No pot open');
    });
  });

  describe('refundEscrow', () => {
    it('returns the stake to both players', async () => {
      await fundBothPlayers();
      (mockEntityManager.save as jest.Mock).mockClear();

      const result = await service.refundEscrow(context);

      expect(result.success).toBe(true);
      expect(result.message).toContain('2 player(s)');
      expect(mockEntityManager.save).toHaveBeenCalledTimes(2);
    });

    it('only refunds the players who actually staked', async () => {
      runTransactions();
      (mockEntityManager.findOne as jest.Mock).mockResolvedValue(
        userWithBalance(PLAYER_A, '100'),
      );
      await service.openEscrow(context);
      await service.stakeTokens(PLAYER_A, context);
      (mockEntityManager.save as jest.Mock).mockClear();

      const result = await service.refundEscrow(context);

      expect(result.success).toBe(true);
      expect(result.message).toContain('1 player(s)');
      expect(mockEntityManager.save).toHaveBeenCalledTimes(1);
    });

    it('refuses to refund a pot that has already paid out', async () => {
      await fundBothPlayers();
      await service.releaseToWinner(PLAYER_A, context);

      const result = await service.refundEscrow(context);

      expect(result.success).toBe(false);
      expect(result.message).toContain('already been settled');
    });
  });

  describe('getUserBalance', () => {
    it('returns the balance in stroops', async () => {
      mockUserRepository.findOne.mockResolvedValue(
        userWithBalance(PLAYER_A, '100'),
      );

      await expect(service.getUserBalance(PLAYER_A)).resolves.toBe(
        toStroops('100'),
      );
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { id: PLAYER_A },
      });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.getUserBalance('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('hasSufficientTokens', () => {
    it.each([
      ['50', true],
      ['100', true],
      ['150', false],
    ])(
      'with a 100 LYRIC balance, %s LYRIC required -> %s',
      async (required, expected) => {
        mockUserRepository.findOne.mockResolvedValue(
          userWithBalance(PLAYER_A, '100'),
        );

        await expect(
          service.hasSufficientTokens(PLAYER_A, toStroops(required)),
        ).resolves.toBe(expected);
      },
    );

    it('returns false rather than throwing when the user is missing', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.hasSufficientTokens('non-existent-id', toStroops('50')),
      ).resolves.toBe(false);
    });
  });

  describe('reconcile', () => {
    it('reports mock settlements as final', async () => {
      const result = await service.reconcile('mock:abc');

      expect(result.success).toBe(true);
      expect(result.status).toBe(SettlementStatus.CONFIRMED);
      expect(result.txHash).toBe('mock:abc');
    });
  });
});

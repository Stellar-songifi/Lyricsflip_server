import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { WagerService, CreateWagerDto } from './wager.service';
import { Wager, WagerStatus } from '../entities/wager.entity';
import { User } from '../../users/entities/user.entity';
import {
  TOKEN_SERVICE,
  SettlementStatus,
  TokenTransactionResult,
} from '../interfaces/token.interface';
import { toStroops } from '../../stellar/amount.util';

const SESSION_ID = 'session-123';
const STAKE = toStroops('10');
const POT = toStroops('20');

const confirmed = (
  overrides: Partial<TokenTransactionResult> = {},
): TokenTransactionResult => ({
  success: true,
  status: SettlementStatus.CONFIRMED,
  txHash: 'mock:tx',
  ...overrides,
});

const failed = (message: string): TokenTransactionResult => ({
  success: false,
  status: SettlementStatus.FAILED,
  message,
});

describe('WagerService', () => {
  let service: WagerService;

  const mockPlayerA = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    email: 'playera@example.com',
    username: 'playera',
    mockBalance: toStroops('100'),
    isActive: true,
  } as unknown as User;

  const mockPlayerB = {
    id: '456e7890-e89b-12d3-a456-426614174001',
    email: 'playerb@example.com',
    username: 'playerb',
    mockBalance: toStroops('100'),
    isActive: true,
  } as unknown as User;

  /** A wager row in whatever state a test needs. */
  const wagerRow = (overrides: Partial<Wager> = {}): Wager =>
    ({
      id: 'wager-123',
      sessionId: SESSION_ID,
      playerA: mockPlayerA,
      playerAId: mockPlayerA.id,
      playerB: mockPlayerB,
      playerBId: mockPlayerB.id,
      stakeStroops: STAKE,
      totalPotStroops: POT,
      status: WagerStatus.STAKED,
      settlementMode: 'mock',
      escrowTxHash: null,
      playerAStakeTxHash: null,
      playerBStakeTxHash: null,
      settlementTxHash: null,
      settlementLedger: null,
      winner: null,
      winnerId: null,
      resultMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: null,
      ...overrides,
    }) as unknown as Wager;

  const mockWagerRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockUserRepository = {
    findOne: jest.fn(),
  };

  const mockTokenService = {
    settlementMode: 'mock' as const,
    openEscrow: jest.fn(),
    stakeTokens: jest.fn(),
    confirmStake: jest.fn(),
    releaseToWinner: jest.fn(),
    refundEscrow: jest.fn(),
    getUserBalance: jest.fn(),
    hasSufficientTokens: jest.fn(),
    reconcile: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WagerService,
        { provide: getRepositoryToken(Wager), useValue: mockWagerRepository },
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        { provide: TOKEN_SERVICE, useValue: mockTokenService },
      ],
    }).compile();

    service = module.get<WagerService>(WagerService);

    // The service reassigns `wager = await save(wager)` between steps, so the
    // mock has to hand back what it was given or later steps see a stale row.
    mockWagerRepository.create.mockImplementation((data: Partial<Wager>) =>
      wagerRow({ ...data, status: data.status ?? WagerStatus.PENDING }),
    );
    mockWagerRepository.save.mockImplementation((entity: Wager) =>
      Promise.resolve(entity),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createWager', () => {
    const createWagerDto: CreateWagerDto = {
      sessionId: SESSION_ID,
      playerAId: mockPlayerA.id,
      playerBId: mockPlayerB.id,
      stake: STAKE,
    };

    /** Both players exist, are funded, and have no wager on this session. */
    const happyPreconditions = () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce(mockPlayerA)
        .mockResolvedValueOnce(mockPlayerB);
      mockTokenService.hasSufficientTokens
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      mockWagerRepository.findOne.mockResolvedValue(null);
    };

    it('opens the escrow and stakes only player one', async () => {
      happyPreconditions();
      mockTokenService.openEscrow.mockResolvedValue(
        confirmed({ txHash: 'mock:escrow' }),
      );
      mockTokenService.stakeTokens.mockResolvedValue(
        confirmed({ txHash: 'mock:stakeA' }),
      );

      const result = await service.createWager(createWagerDto);

      expect(result.success).toBe(true);
      expect(result.wager?.status).toBe(WagerStatus.AWAITING_STAKES);
      expect(result.wager?.escrowTxHash).toBe('mock:escrow');
      expect(result.wager?.playerAStakeTxHash).toBe('mock:stakeA');
      expect(result.wager?.playerBStakeTxHash).toBeNull();
      expect(result.message).toContain('Waiting for your opponent to accept');
    });

    it('moves no funds for player two before they accept', async () => {
      happyPreconditions();
      mockTokenService.openEscrow.mockResolvedValue(confirmed());
      mockTokenService.stakeTokens.mockResolvedValue(confirmed());

      await service.createWager(createWagerDto);

      expect(mockTokenService.stakeTokens).toHaveBeenCalledTimes(1);
      expect(mockTokenService.stakeTokens).toHaveBeenCalledWith(
        mockPlayerA.id,
        expect.anything(),
      );
      expect(mockTokenService.stakeTokens).not.toHaveBeenCalledWith(
        mockPlayerB.id,
        expect.anything(),
      );
    });

    it('records the settlement mode of the backend that handled it', async () => {
      happyPreconditions();
      mockTokenService.openEscrow.mockResolvedValue(confirmed());
      mockTokenService.stakeTokens.mockResolvedValue(confirmed());

      const result = await service.createWager(createWagerDto);

      expect(result.wager?.settlementMode).toBe('mock');
    });

    it('writes the row before touching the network', async () => {
      happyPreconditions();
      const callOrder: string[] = [];
      mockWagerRepository.save.mockImplementation((entity: Wager) => {
        callOrder.push('save');
        return Promise.resolve(entity);
      });
      mockTokenService.openEscrow.mockImplementation(() => {
        callOrder.push('openEscrow');
        return Promise.resolve(confirmed());
      });
      mockTokenService.stakeTokens.mockResolvedValue(confirmed());

      await service.createWager(createWagerDto);

      expect(callOrder[0]).toBe('save');
      expect(callOrder).toContain('openEscrow');
      expect(callOrder.indexOf('save')).toBeLessThan(
        callOrder.indexOf('openEscrow'),
      );
    });

    it('rejects a stake of zero', async () => {
      const result = await service.createWager({
        ...createWagerDto,
        stake: '0',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('must be greater than zero');
      expect(mockTokenService.openEscrow).not.toHaveBeenCalled();
    });

    it('fails when player A is not found', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockPlayerB);

      const result = await service.createWager(createWagerDto);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Player A with ID');
    });

    it('fails when player B is not found', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce(mockPlayerA)
        .mockResolvedValueOnce(null);

      const result = await service.createWager(createWagerDto);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Player B with ID');
    });

    it('refuses a wager against oneself', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce(mockPlayerA)
        .mockResolvedValueOnce(mockPlayerA);

      const result = await service.createWager({
        ...createWagerDto,
        playerBId: mockPlayerA.id,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('cannot wager against themselves');
    });

    it.each([
      ['A', false, true, 'playera'],
      ['B', true, false, 'playerb'],
    ])(
      'fails when player %s has insufficient tokens',
      async (_label, aFunded, bFunded, expectedName) => {
        mockUserRepository.findOne
          .mockResolvedValueOnce(mockPlayerA)
          .mockResolvedValueOnce(mockPlayerB);
        mockWagerRepository.findOne.mockResolvedValue(null);
        mockTokenService.hasSufficientTokens
          .mockResolvedValueOnce(aFunded)
          .mockResolvedValueOnce(bFunded);

        const result = await service.createWager(createWagerDto);

        expect(result.success).toBe(false);
        expect(result.message).toContain(expectedName);
        expect(result.message).toContain('insufficient LYRIC');
        expect(mockTokenService.openEscrow).not.toHaveBeenCalled();
      },
    );

    it('fails when a wager already exists for the session', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce(mockPlayerA)
        .mockResolvedValueOnce(mockPlayerB);
      mockWagerRepository.findOne.mockResolvedValue(wagerRow());

      const result = await service.createWager(createWagerDto);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Wager already exists for this session');
    });

    it('marks the wager failed when the escrow cannot be opened', async () => {
      happyPreconditions();
      mockTokenService.openEscrow.mockResolvedValue(
        failed('contract reverted'),
      );

      const result = await service.createWager(createWagerDto);

      expect(result.success).toBe(false);
      expect(result.message).toBe('contract reverted');
      expect(mockTokenService.stakeTokens).not.toHaveBeenCalled();
      const lastSaved = mockWagerRepository.save.mock.calls.at(
        -1,
      )?.[0] as Wager;
      expect(lastSaved.status).toBe(WagerStatus.FAILED);
    });

    it("refunds the pot when player one's stake fails", async () => {
      happyPreconditions();
      mockTokenService.openEscrow.mockResolvedValue(confirmed());
      mockTokenService.stakeTokens.mockResolvedValueOnce(
        failed('player A is broke'),
      );
      mockTokenService.refundEscrow.mockResolvedValue(confirmed());

      const result = await service.createWager(createWagerDto);

      expect(result.success).toBe(false);
      expect(mockTokenService.refundEscrow).toHaveBeenCalledTimes(1);
      expect(result.message).toContain('player A is broke');
      expect(result.message).toContain('has been refunded');
      expect(result.wager?.status).toBe(WagerStatus.FAILED);
    });

    it('flags a failed refund as needing an operator', async () => {
      happyPreconditions();
      mockTokenService.openEscrow.mockResolvedValue(confirmed());
      mockTokenService.stakeTokens.mockResolvedValueOnce(
        failed('stake rejected'),
      );
      mockTokenService.refundEscrow.mockResolvedValue(failed('rpc timeout'));

      const result = await service.createWager(createWagerDto);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Needs operator attention');
    });

    it("returns only player one's unsigned transaction when the wallet must sign", async () => {
      happyPreconditions();
      const unsignedTransaction = { xdr: 'AAA', network: 'testnet' } as any;
      mockTokenService.openEscrow.mockResolvedValue(confirmed());
      mockTokenService.stakeTokens.mockResolvedValue({
        success: false,
        status: SettlementStatus.PENDING_SIGNATURE,
        txHash: 'unsigned-hash',
        unsignedTransaction,
      });

      const result = await service.createWager(createWagerDto);

      expect(result.success).toBe(true);
      expect(result.wager?.status).toBe(WagerStatus.AWAITING_STAKES);
      expect(result.pendingSignatures).toEqual([
        { userId: mockPlayerA.id, transaction: unsignedTransaction },
      ]);
      // Not recorded until the signed transaction is confirmed.
      expect(result.wager?.playerAStakeTxHash).toBeNull();
      expect(mockTokenService.stakeTokens).toHaveBeenCalledTimes(1);
    });
  });

  describe('acceptWager', () => {
    const awaiting = (overrides: Partial<Wager> = {}) =>
      wagerRow({
        status: WagerStatus.AWAITING_STAKES,
        playerAStakeTxHash: 'mock:stakeA',
        ...overrides,
      });

    it('stakes player two and marks the wager staked', async () => {
      mockWagerRepository.findOne.mockResolvedValue(awaiting());
      mockTokenService.stakeTokens.mockResolvedValue(
        confirmed({ txHash: 'mock:stakeB' }),
      );

      const result = await service.acceptWager(SESSION_ID, mockPlayerB.id);

      expect(mockTokenService.stakeTokens).toHaveBeenCalledWith(
        mockPlayerB.id,
        expect.objectContaining({ sessionId: SESSION_ID }),
      );
      expect(result.success).toBe(true);
      expect(result.wager?.playerBStakeTxHash).toBe('mock:stakeB');
      expect(result.wager?.status).toBe(WagerStatus.STAKED);
    });

    it('stays awaiting stakes while player one has not signed', async () => {
      mockWagerRepository.findOne.mockResolvedValue(
        awaiting({ playerAStakeTxHash: null }),
      );
      mockTokenService.stakeTokens.mockResolvedValue(
        confirmed({ txHash: 'mock:stakeB' }),
      );

      const result = await service.acceptWager(SESSION_ID, mockPlayerB.id);

      expect(result.wager?.status).toBe(WagerStatus.AWAITING_STAKES);
    });

    it("returns player two's unsigned transaction when their wallet must sign", async () => {
      const unsignedTransaction = { xdr: 'BBB', network: 'testnet' } as any;
      mockWagerRepository.findOne.mockResolvedValue(awaiting());
      mockTokenService.stakeTokens.mockResolvedValue({
        success: false,
        status: SettlementStatus.PENDING_SIGNATURE,
        unsignedTransaction,
      });

      const result = await service.acceptWager(SESSION_ID, mockPlayerB.id);

      expect(result.success).toBe(true);
      expect(result.pendingSignatures).toEqual([
        { userId: mockPlayerB.id, transaction: unsignedTransaction },
      ]);
      expect(result.wager?.playerBStakeTxHash).toBeNull();
    });

    it('refuses anyone but the invited player', async () => {
      mockWagerRepository.findOne.mockResolvedValue(awaiting());

      await expect(
        service.acceptWager(SESSION_ID, mockPlayerA.id),
      ).rejects.toThrow(BadRequestException);
      expect(mockTokenService.stakeTokens).not.toHaveBeenCalled();
    });

    it('refuses to stake player two twice', async () => {
      mockWagerRepository.findOne.mockResolvedValue(
        awaiting({ playerBStakeTxHash: 'mock:stakeB' }),
      );

      const result = await service.acceptWager(SESSION_ID, mockPlayerB.id);

      expect(result.success).toBe(false);
      expect(mockTokenService.stakeTokens).not.toHaveBeenCalled();
    });
  });

  describe('confirmStake', () => {
    it('keeps the wager open until the second player signs', async () => {
      mockWagerRepository.findOne.mockResolvedValue(
        wagerRow({ status: WagerStatus.AWAITING_STAKES }),
      );
      mockTokenService.confirmStake.mockResolvedValue(
        confirmed({ txHash: 'mock:stakeA' }),
      );

      const result = await service.confirmStake(
        SESSION_ID,
        mockPlayerA.id,
        'signed-xdr',
      );

      expect(result.success).toBe(true);
      expect(result.wager?.status).toBe(WagerStatus.AWAITING_STAKES);
      expect(result.message).toContain('Waiting for your opponent');
    });

    it('moves the wager to staked once both stakes are confirmed', async () => {
      mockWagerRepository.findOne.mockResolvedValue(
        wagerRow({
          status: WagerStatus.AWAITING_STAKES,
          playerAStakeTxHash: 'mock:stakeA',
        }),
      );
      mockTokenService.confirmStake.mockResolvedValue(
        confirmed({ txHash: 'mock:stakeB' }),
      );

      const result = await service.confirmStake(
        SESSION_ID,
        mockPlayerB.id,
        'signed-xdr',
      );

      expect(result.success).toBe(true);
      expect(result.wager?.status).toBe(WagerStatus.STAKED);
      expect(result.message).toContain('Wager on!');
    });

    it('refuses a confirmation for a wager that is not awaiting stakes', async () => {
      mockWagerRepository.findOne.mockResolvedValue(
        wagerRow({ status: WagerStatus.STAKED }),
      );

      const result = await service.confirmStake(
        SESSION_ID,
        mockPlayerA.id,
        'signed-xdr',
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('not awaiting stakes');
      expect(mockTokenService.confirmStake).not.toHaveBeenCalled();
    });

    it('rejects a confirmation from someone outside the wager', async () => {
      mockWagerRepository.findOne.mockResolvedValue(
        wagerRow({ status: WagerStatus.AWAITING_STAKES }),
      );

      await expect(
        service.confirmStake(SESSION_ID, 'outsider-id', 'signed-xdr'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resolveWagerWithWinner', () => {
    it('releases the pot and records the winner', async () => {
      mockWagerRepository.findOne.mockResolvedValue(wagerRow());
      mockTokenService.releaseToWinner.mockResolvedValue(
        confirmed({ message: 'You won 20.0 LYRIC!', ledger: 4242 }),
      );

      const result = await service.resolveWagerWithWinner(
        SESSION_ID,
        mockPlayerA.id,
      );

      expect(result.success).toBe(true);
      expect(result.wager?.status).toBe(WagerStatus.WON);
      expect(result.wager?.winnerId).toBe(mockPlayerA.id);
      expect(result.wager?.settlementLedger).toBe('4242');
      expect(result.wager?.resolvedAt).toBeInstanceOf(Date);
      expect(result.message).toBe('You won 20.0 LYRIC!');
    });

    it('marks the wager settling before calling the network', async () => {
      mockWagerRepository.findOne.mockResolvedValue(wagerRow());
      let statusAtCallTime: WagerStatus | undefined;
      mockTokenService.releaseToWinner.mockImplementation(() => {
        statusAtCallTime = (
          mockWagerRepository.save.mock.calls.at(-1)?.[0] as Wager
        ).status;
        return Promise.resolve(confirmed());
      });

      await service.resolveWagerWithWinner(SESSION_ID, mockPlayerA.id);

      expect(statusAtCallTime).toBe(WagerStatus.SETTLING);
    });

    it('leaves the wager settling when the outcome is unknown', async () => {
      mockWagerRepository.findOne.mockResolvedValue(wagerRow());
      mockTokenService.releaseToWinner.mockResolvedValue({
        success: false,
        status: SettlementStatus.SUBMITTED,
        txHash: 'mock:pending',
      });

      const result = await service.resolveWagerWithWinner(
        SESSION_ID,
        mockPlayerA.id,
      );

      expect(result.success).toBe(false);
      expect(result.wager?.status).toBe(WagerStatus.SETTLING);
      expect(result.wager?.settlementTxHash).toBe('mock:pending');
      expect(result.message).toContain('awaiting confirmation');
    });

    it('marks the wager failed when the payout is rejected', async () => {
      mockWagerRepository.findOne.mockResolvedValue(wagerRow());
      mockTokenService.releaseToWinner.mockResolvedValue(
        failed('insufficient contract balance'),
      );

      const result = await service.resolveWagerWithWinner(
        SESSION_ID,
        mockPlayerA.id,
      );

      expect(result.success).toBe(false);
      expect(result.wager?.status).toBe(WagerStatus.FAILED);
      expect(result.message).toBe('insufficient contract balance');
    });

    it('fails when the wager is not found', async () => {
      mockWagerRepository.findOne.mockResolvedValue(null);

      const result = await service.resolveWagerWithWinner(
        SESSION_ID,
        mockPlayerA.id,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Wager for session');
    });

    it.each([
      WagerStatus.WON,
      WagerStatus.REFUNDED,
      WagerStatus.PENDING,
      WagerStatus.SETTLING,
    ])('refuses to resolve from status %s', async (status) => {
      mockWagerRepository.findOne.mockResolvedValue(wagerRow({ status }));

      const result = await service.resolveWagerWithWinner(
        SESSION_ID,
        mockPlayerA.id,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('cannot be resolved from status');
      expect(mockTokenService.releaseToWinner).not.toHaveBeenCalled();
    });

    it('fails when the winner is not one of the players', async () => {
      mockWagerRepository.findOne.mockResolvedValue(wagerRow());

      const result = await service.resolveWagerWithWinner(
        SESSION_ID,
        'invalid-player-id',
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain(
        'Winner must be one of the wagering players',
      );
    });
  });

  describe('resolveWagerAsDraw', () => {
    it('refunds both stakes', async () => {
      mockWagerRepository.findOne.mockResolvedValue(wagerRow());
      mockTokenService.refundEscrow.mockResolvedValue(confirmed());

      const result = await service.resolveWagerAsDraw(SESSION_ID);

      expect(result.success).toBe(true);
      expect(result.wager?.status).toBe(WagerStatus.REFUNDED);
      expect(result.message).toContain('Draw!');
      expect(result.message).toContain('10.0 LYRIC');
    });

    it('refunds a match abandoned while still awaiting stakes', async () => {
      mockWagerRepository.findOne.mockResolvedValue(
        wagerRow({ status: WagerStatus.AWAITING_STAKES }),
      );
      mockTokenService.refundEscrow.mockResolvedValue(confirmed());

      const result = await service.resolveWagerAsDraw(SESSION_ID);

      expect(result.success).toBe(true);
      expect(result.wager?.status).toBe(WagerStatus.REFUNDED);
    });

    it('fails when the wager is not found', async () => {
      mockWagerRepository.findOne.mockResolvedValue(null);

      const result = await service.resolveWagerAsDraw(SESSION_ID);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Wager for session');
    });

    it('refuses to refund an already-refunded wager', async () => {
      mockWagerRepository.findOne.mockResolvedValue(
        wagerRow({ status: WagerStatus.REFUNDED }),
      );

      const result = await service.resolveWagerAsDraw(SESSION_ID);

      expect(result.success).toBe(false);
      expect(result.message).toContain('cannot be refunded from status');
    });
  });

  describe('reconcileWager', () => {
    it('finalises a confirmed payout as won', async () => {
      mockWagerRepository.findOne.mockResolvedValue(
        wagerRow({
          status: WagerStatus.SETTLING,
          settlementTxHash: 'mock:pending',
          winnerId: mockPlayerA.id,
        }),
      );
      mockTokenService.reconcile.mockResolvedValue(
        confirmed({ ledger: 99, message: 'Settlement confirmed on-chain' }),
      );

      const result = await service.reconcileWager(SESSION_ID);

      expect(result.success).toBe(true);
      expect(result.wager?.status).toBe(WagerStatus.WON);
      expect(result.wager?.settlementLedger).toBe('99');
    });

    it('finalises a confirmed settlement with no winner as refunded', async () => {
      mockWagerRepository.findOne.mockResolvedValue(
        wagerRow({
          status: WagerStatus.SETTLING,
          settlementTxHash: 'mock:pending',
          winnerId: null as any,
        }),
      );
      mockTokenService.reconcile.mockResolvedValue(confirmed());

      const result = await service.reconcileWager(SESSION_ID);

      expect(result.success).toBe(true);
      expect(result.wager?.status).toBe(WagerStatus.REFUNDED);
    });

    it('does nothing for a wager that is not settling', async () => {
      mockWagerRepository.findOne.mockResolvedValue(
        wagerRow({ status: WagerStatus.WON }),
      );

      const result = await service.reconcileWager(SESSION_ID);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Nothing to reconcile');
      expect(mockTokenService.reconcile).not.toHaveBeenCalled();
    });

    it('fails a wager left settling with no transaction hash', async () => {
      mockWagerRepository.findOne.mockResolvedValue(
        wagerRow({ status: WagerStatus.SETTLING, settlementTxHash: null }),
      );

      const result = await service.reconcileWager(SESSION_ID);

      expect(result.success).toBe(false);
      expect(result.wager?.status).toBe(WagerStatus.FAILED);
      expect(result.message).toContain('never reached the network');
      expect(mockTokenService.reconcile).not.toHaveBeenCalled();
    });

    it('leaves the wager settling while the network is still unsure', async () => {
      mockWagerRepository.findOne.mockResolvedValue(
        wagerRow({
          status: WagerStatus.SETTLING,
          settlementTxHash: 'mock:pending',
        }),
      );
      mockTokenService.reconcile.mockResolvedValue({
        success: false,
        status: SettlementStatus.SUBMITTED,
        message: 'still in flight',
      });

      const result = await service.reconcileWager(SESSION_ID);

      expect(result.success).toBe(false);
      expect(result.wager?.status).toBe(WagerStatus.SETTLING);
      expect(result.message).toBe('still in flight');
    });

    it('throws when the wager does not exist', async () => {
      mockWagerRepository.findOne.mockResolvedValue(null);

      await expect(service.reconcileWager(SESSION_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getWagerBySessionId', () => {
    it('returns the wager for a session', async () => {
      const row = wagerRow();
      mockWagerRepository.findOne.mockResolvedValue(row);

      await expect(service.getWagerBySessionId(SESSION_ID)).resolves.toEqual(
        row,
      );
      expect(mockWagerRepository.findOne).toHaveBeenCalledWith({
        where: { sessionId: SESSION_ID },
        relations: ['playerA', 'playerB', 'winner'],
      });
    });

    it('returns null when there is no wager', async () => {
      mockWagerRepository.findOne.mockResolvedValue(null);

      await expect(service.getWagerBySessionId(SESSION_ID)).resolves.toBeNull();
    });
  });

  describe('getUserWagers', () => {
    it('returns wagers the user is a player in', async () => {
      const row = wagerRow();
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([row]),
      };
      mockWagerRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.getUserWagers(mockPlayerA.id, 10);

      expect(result).toEqual([row]);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'wager.playerAId = :userId OR wager.playerBId = :userId',
        { userId: mockPlayerA.id },
      );
    });

    it('returns an empty array rather than throwing on a query error', async () => {
      mockWagerRepository.createQueryBuilder.mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(service.getUserWagers(mockPlayerA.id, 10)).resolves.toEqual(
        [],
      );
    });
  });
});

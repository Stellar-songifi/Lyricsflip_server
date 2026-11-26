import { Wager, WagerStatus } from '../entities/wager.entity';
import { SettlementStatus } from '../interfaces/token.interface';
import { RealtimeEvent } from '../../realtime/realtime.events';
import { WagerService } from './wager.service';

jest.mock('../../stellar/amount.util', () => ({
  ...jest.requireActual('../../stellar/amount.util'),
  fromStroops: (value: string) => value,
}));

describe('WagerService.confirmStake', () => {
  let wager: Wager;
  let repo: { findOne: jest.Mock; save: jest.Mock; update: jest.Mock };
  let tokenService: { confirmStake: jest.Mock };
  let events: { emit: jest.Mock };
  let service: WagerService;

  beforeEach(() => {
    wager = Object.assign(new Wager(), {
      id: 'w1',
      sessionId: 's1',
      playerAId: 'a',
      playerBId: 'b',
      stakeStroops: '100',
      totalPotStroops: '200',
      status: WagerStatus.AWAITING_STAKES,
      playerAStakeTxHash: null,
      playerBStakeTxHash: null,
      playerALatestStakeHash: 'hash-a',
      playerBLatestStakeHash: 'hash-b',
      stakeDeadline: new Date(),
    });
    repo = {
      findOne: jest.fn().mockResolvedValue(wager),
      save: jest.fn((w: Wager) => Promise.resolve(w)),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    tokenService = { confirmStake: jest.fn() };
    events = { emit: jest.fn() };
    service = new WagerService(
      repo as any,
      {} as any,
      tokenService as any,
      { get: jest.fn() } as any,
      {} as any,
      events as any,
    );
  });

  it('passes the latest offered hash to the backend', async () => {
    tokenService.confirmStake.mockResolvedValue({
      success: true,
      status: SettlementStatus.CONFIRMED,
      txHash: 'hash-a',
      message: 'ok',
    });

    await service.confirmStake('s1', 'a', 'xdr');

    expect(tokenService.confirmStake).toHaveBeenCalledWith(
      'a',
      'xdr',
      expect.objectContaining({ sessionId: 's1' }),
      'hash-a',
    );
  });

  it('does not record a failed stake as staked', async () => {
    tokenService.confirmStake.mockResolvedValue({
      success: false,
      status: SettlementStatus.FAILED,
      txHash: 'hash-a',
      message: 'reverted',
    });

    const result = await service.confirmStake('s1', 'a', 'xdr');

    expect(result.success).toBe(false);
    expect(wager.playerAStakeTxHash).toBeNull();
    expect(wager.playerAPendingStakeHash).toBe('hash-a');
    expect(wager.status).toBe(WagerStatus.AWAITING_STAKES);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('moves to STAKED once both stakes are confirmed', async () => {
    wager.playerAStakeTxHash = 'hash-a';
    repo.update.mockResolvedValue({ affected: 1 });
    tokenService.confirmStake.mockResolvedValue({
      success: true,
      status: SettlementStatus.CONFIRMED,
      txHash: 'hash-b',
      message: 'ok',
    });

    const result = await service.confirmStake('s1', 'b', 'xdr');

    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'w1',
        status: WagerStatus.AWAITING_STAKES,
      }),
      expect.objectContaining({
        status: WagerStatus.STAKED,
        stakeDeadline: null,
      }),
    );
    expect(result.wager?.status).toBe(WagerStatus.STAKED);
    expect(result.wager?.stakeDeadline).toBeNull();
    expect(events.emit).toHaveBeenCalledWith(
      RealtimeEvent.WAGER_STAKED,
      expect.objectContaining({ wagerId: 'w1' }),
    );
  });

  it('stays AWAITING_STAKES while the opponent has not staked', async () => {
    tokenService.confirmStake.mockResolvedValue({
      success: true,
      status: SettlementStatus.CONFIRMED,
      txHash: 'hash-a',
      message: 'ok',
    });

    const result = await service.confirmStake('s1', 'a', 'xdr');

    expect(result.success).toBe(true);
    expect(wager.playerAStakeTxHash).toBe('hash-a');
    expect(result.wager?.status).toBe(WagerStatus.AWAITING_STAKES);
    expect(events.emit).not.toHaveBeenCalled();
  });
});

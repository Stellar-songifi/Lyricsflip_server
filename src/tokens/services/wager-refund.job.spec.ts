import { Logger } from '@nestjs/common';
import { WagerRefundJob } from './wager-refund.job';
import { Wager, WagerStatus } from '../entities/wager.entity';
import { GameSessionStatus } from '../../game-sessions/entities/game-session.entity';
import { WagerService } from './wager.service';

describe('WagerRefundJob', () => {
  let job: WagerRefundJob;
  let wagerRepository: { find: jest.Mock };
  let gameSessionRepository: { update: jest.Mock };
  let wagerService: { resolveWagerAsDraw: jest.Mock };

  const expiredWager = (overrides: Partial<Wager> = {}): Wager =>
    ({
      id: 'wager-1',
      sessionId: 'session-1',
      playerAId: 'player-a',
      playerBId: 'player-b',
      status: WagerStatus.AWAITING_STAKES,
      stakeDeadline: new Date('2020-01-01T00:00:00Z'),
      ...overrides,
    }) as unknown as Wager;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    wagerRepository = { find: jest.fn().mockResolvedValue([]) };
    gameSessionRepository = { update: jest.fn().mockResolvedValue({}) };
    wagerService = {
      resolveWagerAsDraw: jest.fn().mockResolvedValue({ success: true }),
    };

    job = new WagerRefundJob(
      wagerRepository as any,
      gameSessionRepository as any,
      wagerService as unknown as WagerService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('does nothing when no wager has passed its deadline', async () => {
    wagerRepository.find.mockResolvedValue([]);

    await job.refundExpiredWagers();

    expect(wagerService.resolveWagerAsDraw).not.toHaveBeenCalled();
  });

  it('refunds every wager past its stake deadline and abandons the session', async () => {
    const wager = expiredWager();
    wagerRepository.find.mockResolvedValue([wager]);

    await job.refundExpiredWagers();

    expect(wagerService.resolveWagerAsDraw).toHaveBeenCalledWith('session-1');
    expect(gameSessionRepository.update).toHaveBeenCalledWith(
      { id: 'session-1' },
      { status: GameSessionStatus.ABANDONED },
    );
  });

  it('only selects wagers still AWAITING_STAKES with a passed deadline', async () => {
    await job.refundExpiredWagers();

    expect(wagerRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: WagerStatus.AWAITING_STAKES,
        }),
      }),
    );
  });

  it('is idempotent: a second pass over an already-settled wager refunds nothing again', async () => {
    // Once resolveWagerAsDraw succeeds the wager is no longer
    // AWAITING_STAKES, so the repository query used by the next pass would
    // not return it — simulated here by an empty result.
    wagerRepository.find
      .mockResolvedValueOnce([expiredWager()])
      .mockResolvedValueOnce([]);

    await job.refundExpiredWagers();
    await job.refundExpiredWagers();

    expect(wagerService.resolveWagerAsDraw).toHaveBeenCalledTimes(1);
  });

  it('does not abandon the session when the refund did not complete', async () => {
    wagerRepository.find.mockResolvedValue([expiredWager()]);
    wagerService.resolveWagerAsDraw.mockResolvedValue({
      success: false,
      message: 'still submitting',
    });

    await job.refundExpiredWagers();

    expect(gameSessionRepository.update).not.toHaveBeenCalled();
  });

  it('keeps processing the remaining wagers if one refund throws', async () => {
    const first = expiredWager({ id: 'wager-1', sessionId: 'session-1' });
    const second = expiredWager({ id: 'wager-2', sessionId: 'session-2' });
    wagerRepository.find.mockResolvedValue([first, second]);
    wagerService.resolveWagerAsDraw
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ success: true });

    await job.refundExpiredWagers();

    expect(wagerService.resolveWagerAsDraw).toHaveBeenCalledTimes(2);
    expect(gameSessionRepository.update).toHaveBeenCalledWith(
      { id: 'session-2' },
      { status: GameSessionStatus.ABANDONED },
    );
  });
});

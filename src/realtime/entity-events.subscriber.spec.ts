import { EntityEventsSubscriber } from './entity-events.subscriber';
import {
  GameSession,
  GameSessionStatus,
} from '../game-sessions/entities/game-session.entity';
import { Wager, WagerStatus } from '../tokens/entities/wager.entity';

describe('EntityEventsSubscriber', () => {
  const events = { emit: jest.fn() };
  const subscriber = new EntityEventsSubscriber(
    { subscribers: [] } as any,
    events as any,
  );

  const wager = (status: WagerStatus, extra = {}) =>
    Object.assign(new Wager(), {
      id: 'w1',
      sessionId: 's1',
      playerAId: 'a',
      playerBId: 'b',
      stakeStroops: '10',
      totalPotStroops: '20',
      status,
      ...extra,
    });

  beforeEach(() => jest.clearAllMocks());

  it('announces wager.staked and wager.settled on status transitions', () => {
    subscriber.afterUpdate({
      entity: wager(WagerStatus.STAKED),
      databaseEntity: wager(WagerStatus.AWAITING_STAKES),
    } as any);
    subscriber.afterUpdate({
      entity: wager(WagerStatus.WON, { winnerId: 'a' }),
      databaseEntity: wager(WagerStatus.SETTLING),
    } as any);

    expect(events.emit).toHaveBeenNthCalledWith(
      1,
      'wager.staked',
      expect.objectContaining({ wagerId: 'w1', sessionId: 's1' }),
    );
    expect(events.emit).toHaveBeenNthCalledWith(
      2,
      'wager.settled',
      expect.objectContaining({ outcome: 'won', winnerId: 'a' }),
    );
  });

  it('stays quiet when the wager status did not change', () => {
    subscriber.afterUpdate({
      entity: wager(WagerStatus.STAKED),
      databaseEntity: wager(WagerStatus.STAKED),
    } as any);

    expect(events.emit).not.toHaveBeenCalled();
  });

  it('announces a second player joining and a completed session', () => {
    const session = (status: GameSessionStatus, extra = {}) =>
      Object.assign(new GameSession(), {
        id: 's1',
        status,
        playerTwoId: 'b',
        player: { id: 'a' },
        ...extra,
      });

    subscriber.afterUpdate({
      entity: session(GameSessionStatus.IN_PROGRESS),
      databaseEntity: session(GameSessionStatus.WAITING_FOR_PLAYER),
    } as any);
    subscriber.afterUpdate({
      entity: session(GameSessionStatus.COMPLETED, { winnerId: 'a', score: 3 }),
      databaseEntity: session(GameSessionStatus.IN_PROGRESS),
    } as any);

    expect(events.emit).toHaveBeenCalledWith(
      'session.player_joined',
      expect.objectContaining({ sessionId: 's1', userId: 'b' }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'session.completed',
      expect.objectContaining({ winnerId: 'a', score: 3 }),
    );
  });

  it('holds events raised in a transaction until it commits', () => {
    const queryRunner = { isTransactionActive: true } as any;

    subscriber.afterUpdate({
      queryRunner,
      entity: wager(WagerStatus.STAKED),
      databaseEntity: wager(WagerStatus.AWAITING_STAKES),
    } as any);
    expect(events.emit).not.toHaveBeenCalled();

    subscriber.afterTransactionCommit({ queryRunner });
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('drops events from a transaction that rolled back', () => {
    const queryRunner = { isTransactionActive: true } as any;

    subscriber.afterUpdate({
      queryRunner,
      entity: wager(WagerStatus.WON),
      databaseEntity: wager(WagerStatus.SETTLING),
    } as any);
    subscriber.afterTransactionRollback({ queryRunner });
    subscriber.afterTransactionCommit({ queryRunner });

    expect(events.emit).not.toHaveBeenCalled();
  });
});

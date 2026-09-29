import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntitySubscriberInterface,
  InsertEvent,
  QueryRunner,
  UpdateEvent,
} from 'typeorm';
import {
  GameSession,
  GameSessionStatus,
} from '../game-sessions/entities/game-session.entity';
import { Wager, WagerStatus } from '../tokens/entities/wager.entity';
import { RoomUser } from '../rooms/entities/room-user.entity';
import {
  PlayerJoinedPayload,
  RealtimeEvent,
  SessionCompletedPayload,
  WagerSettledPayload,
  WagerStakedPayload,
} from './realtime.events';

/**
 * Turns changes to game sessions, wagers and room membership into realtime
 * events, from one place, without every code path that saves those rows having
 * to remember to announce it.
 *
 * Events raised inside a transaction are held until it commits, so a client
 * that reacts by fetching the row never reads the state from before the change.
 */
@Injectable()
export class EntityEventsSubscriber implements EntitySubscriberInterface {
  private readonly pending = new WeakMap<QueryRunner, Array<() => void>>();

  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly events: EventEmitter2,
  ) {
    dataSource.subscribers.push(this);
  }

  afterInsert(event: InsertEvent<any>): void {
    const entity = event.entity;

    if (entity instanceof GameSession) {
      const userId = entity.player?.id;
      if (userId) {
        this.raise(event.queryRunner, RealtimeEvent.PLAYER_JOINED, {
          scope: 'session',
          sessionId: entity.id,
          userId,
        } satisfies PlayerJoinedPayload);
      }
    } else if (entity instanceof RoomUser) {
      this.raise(event.queryRunner, RealtimeEvent.PLAYER_JOINED, {
        scope: 'room',
        roomId: entity.roomId,
        userId: entity.userId,
      } satisfies PlayerJoinedPayload);
    }
  }

  afterUpdate(event: UpdateEvent<any>): void {
    const entity = event.entity;
    const before = event.databaseEntity;

    if (!entity?.id) return;

    if (entity instanceof GameSession || before instanceof GameSession) {
      this.onSessionUpdate(
        event,
        entity as GameSession,
        before as GameSession | undefined,
      );
    } else if (entity instanceof Wager || before instanceof Wager) {
      this.onWagerUpdate(event, entity as Wager, before as Wager | undefined);
    }
  }

  afterTransactionCommit(event: { queryRunner: QueryRunner }): void {
    const queued = this.pending.get(event.queryRunner);
    this.pending.delete(event.queryRunner);
    queued?.forEach((emit) => emit());
  }

  afterTransactionRollback(event: { queryRunner: QueryRunner }): void {
    this.pending.delete(event.queryRunner);
  }

  private onSessionUpdate(
    event: UpdateEvent<any>,
    session: GameSession,
    before?: GameSession,
  ): void {
    const status = session.status;

    if (
      status === GameSessionStatus.IN_PROGRESS &&
      before?.status === GameSessionStatus.WAITING_FOR_PLAYER &&
      session.playerTwoId
    ) {
      this.raise(event.queryRunner, RealtimeEvent.PLAYER_JOINED, {
        scope: 'session',
        sessionId: session.id,
        userId: session.playerTwoId,
      } satisfies PlayerJoinedPayload);
    }

    if (status === GameSessionStatus.COMPLETED && before?.status !== status) {
      this.raise(event.queryRunner, RealtimeEvent.SESSION_COMPLETED, {
        sessionId: session.id,
        playerId: session.player?.id ?? before?.player?.id ?? null,
        playerTwoId: session.playerTwoId ?? null,
        winnerId: session.winnerId ?? null,
        score: session.score ?? 0,
        playerTwoScore: session.playerTwoScore ?? 0,
      } satisfies SessionCompletedPayload);
    }
  }

  private onWagerUpdate(
    event: UpdateEvent<any>,
    wager: Wager,
    before?: Wager,
  ): void {
    if (!wager.status || wager.status === before?.status) return;

    const base = {
      wagerId: wager.id,
      sessionId: wager.sessionId,
      playerAId: wager.playerAId,
      playerBId: wager.playerBId,
      totalPotStroops: wager.totalPotStroops,
    };

    if (wager.status === WagerStatus.STAKED) {
      this.raise(event.queryRunner, RealtimeEvent.WAGER_STAKED, {
        ...base,
        stakeStroops: wager.stakeStroops,
      } satisfies WagerStakedPayload);
    } else if (
      wager.status === WagerStatus.WON ||
      wager.status === WagerStatus.REFUNDED
    ) {
      this.raise(event.queryRunner, RealtimeEvent.WAGER_SETTLED, {
        ...base,
        outcome: wager.status === WagerStatus.WON ? 'won' : 'refunded',
        winnerId: wager.winnerId ?? null,
      } satisfies WagerSettledPayload);
    }
  }

  private raise(
    queryRunner: QueryRunner | undefined,
    name: RealtimeEvent,
    payload: object,
  ): void {
    const emit = () => this.events.emit(name, payload);

    if (!queryRunner?.isTransactionActive) {
      emit();
      return;
    }

    const queued = this.pending.get(queryRunner) ?? [];
    queued.push(emit);
    this.pending.set(queryRunner, queued);
  }
}

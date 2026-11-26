import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { GAME_CONSTANTS } from '../game/constants/game.constants';
import { JobLockService } from '../jobs/job-lock.service';
import { DomainEvents } from '../realtime/domain-events';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { GameSession, GameSessionStatus } from './entities/game-session.entity';

const SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Abandons sessions that have sat idle for SESSION_TIMEOUT_MINUTES.
 *
 * "Idle" is `updatedAt`, which every round played in the session refreshes.
 * Sessions with a wager are left alone: their stakes sit in escrow, and
 * releasing them is the wager refund job's business, not a status flip here.
 */
@Injectable()
export class SessionExpiryService {
  private readonly logger = new Logger(SessionExpiryService.name);

  constructor(
    @InjectRepository(GameSession)
    private readonly sessionRepository: Repository<GameSession>,
    private readonly configService: ConfigService,
    private readonly jobLockService: JobLockService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  private get timeoutMs(): number {
    const minutes =
      this.configService.get<number>('SESSION_TIMEOUT_MINUTES') ??
      GAME_CONSTANTS.LIMITS.SESSION_TIMEOUT_MINUTES;
    return minutes * 60 * 1000;
  }

  @Interval(SWEEP_INTERVAL_MS)
  async sweep(): Promise<number> {
    return this.jobLockService.runExclusive('session-expiry', async () => {
      const cutoff = new Date(Date.now() - this.timeoutMs);

      const queryRunner = this.sessionRepository.manager.connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      let expired = 0;
      try {
        const result = await queryRunner.manager.update(
          GameSession,
          {
            status: In([
              GameSessionStatus.WAITING_FOR_PLAYER,
              GameSessionStatus.IN_PROGRESS,
            ]),
            hasWager: false,
            updatedAt: LessThan(cutoff),
          },
          { status: GameSessionStatus.ABANDONED },
        );

        expired = result.affected ?? 0;

        if (expired > 0) {
          const abandoned = await queryRunner.manager.find(GameSession, {
            where: {
              status: GameSessionStatus.ABANDONED,
              hasWager: false,
              updatedAt: LessThan(cutoff),
            },
            select: ['id'],
          });
          for (const session of abandoned) {
            DomainEvents.queue(queryRunner, {
              type: 'session.completed',
              payload: {
                sessionId: session.id,
                status: GameSessionStatus.ABANDONED,
              },
            });
          }
        }

        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }

      DomainEvents.flush(queryRunner, (event) => {
        this.realtimeGateway.emitToSession(
          event.payload.sessionId as string,
          event.type,
          event.payload,
        );
      });

      if (expired > 0) {
        this.logger.log(`Abandoned ${expired} idle session(s)`);
      }

      return expired;
    });
  }
}

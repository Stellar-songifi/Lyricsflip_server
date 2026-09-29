import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { GAME_CONSTANTS } from '../game/constants/game.constants';
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
  ) {}

  private get timeoutMs(): number {
    const minutes =
      this.configService.get<number>('SESSION_TIMEOUT_MINUTES') ??
      GAME_CONSTANTS.LIMITS.SESSION_TIMEOUT_MINUTES;
    return minutes * 60 * 1000;
  }

  @Interval(SWEEP_INTERVAL_MS)
  async sweep(): Promise<number> {
    const cutoff = new Date(Date.now() - this.timeoutMs);

    const result = await this.sessionRepository.update(
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

    const expired = result.affected ?? 0;
    if (expired > 0) {
      this.logger.log(`Abandoned ${expired} idle session(s)`);
    }

    return expired;
  }
}

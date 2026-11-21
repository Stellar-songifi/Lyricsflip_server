import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Achievement } from './achievement.entity';
import { UserAchievement } from './user-achievement.entity';

/**
 * Achievement definition identifiers.
 * These mirror the rows seeded into the `achievements` table.
 */
export type AchievementCode =
  | 'first_win'
  | 'perfect_guess'
  | 'streak_5'
  | 'streak_10'
  | 'speed_demon';

export interface AchievementDefinition {
  code: AchievementCode;
  name: string;
  description: string;
}

/**
 * Canonical achievement definitions. Kept in code so the service can seed the
 * `achievements` table and resolve metadata without an extra round trip.
 */
export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    code: 'first_win',
    name: 'First Win',
    description: 'Win your first wager.',
  },
  {
    code: 'perfect_guess',
    name: 'Perfect Guess',
    description: 'Answer your first question correctly.',
  },
  {
    code: 'streak_5',
    name: 'On Fire',
    description: 'Reach a streak of 5 correct answers.',
  },
  {
    code: 'streak_10',
    name: 'Unstoppable',
    description: 'Reach a streak of 10 correct answers.',
  },
  {
    code: 'speed_demon',
    name: 'Speed Demon',
    description: 'Answer correctly in under 3 seconds.',
  },
];

/** Threshold (ms) under which a correct answer counts as a fast answer. */
export const SPEED_DEMON_THRESHOLD_MS = 3000;

/**
 * Streak milestones mapped to their dedicated achievement codes. Each
 * milestone has its own code so both can be awarded independently (issue #321).
 */
export const STREAK_MILESTONES: ReadonlyArray<{
  milestone: number;
  code: AchievementCode;
}> = [
  { milestone: 5, code: 'streak_5' },
  { milestone: 10, code: 'streak_10' },
];

/**
 * Minimal persistence contract. The concrete implementation is backed by the
 * `achievements` and `user_achievements` tables (see the accompanying
 * migration). Keeping it as an interface lets the service stay testable.
 */
export interface AchievementsRepository {
  /** Insert a definition if it does not already exist. */
  upsertDefinition(definition: AchievementDefinition): Promise<void>;
  /** Return the codes already unlocked by a user. */
  findUnlockedCodes(userId: string): Promise<AchievementCode[]>;
  /**
   * Persist an unlock. Must be idempotent: a unique constraint on
   * (user_id, achievement_code) guarantees an achievement is awarded once.
   * Returns true when a new row was inserted, false when it already existed.
   */
  insertUnlock(userId: string, code: AchievementCode): Promise<boolean>;
}

/** Payload emitted on the `user.achievement_unlocked` event (issue #168). */
export interface AchievementUnlockedEvent {
  userId: string;
  code: AchievementCode;
  name: string;
  description: string;
  unlockedAt: string;
}

/**
 * Gameplay signals that may unlock achievements. All fields are optional so
 * callers can report only what they know about a given event.
 */
export interface GameplayEvent {
  userId: string;
  /** A question was answered correctly. */
  correctAnswer?: boolean;
  /** Current consecutive-correct-answer streak after this event. */
  streak?: number;
  /** A wager was won. */
  wagerWon?: boolean;
  /** Time taken to answer, in milliseconds. */
  answerTimeMs?: number;
}

/**
 * Payload emitted on the `round.ended` gameplay event. Game code emits this
 * instead of calling the service directly, keeping the two decoupled.
 */
export interface RoundEndedEvent {
  userId: string;
  correctAnswer?: boolean;
  streak?: number;
  answerTimeMs?: number;
}

/** Payload emitted on the `wager.settled` gameplay event. */
export interface WagerSettledEvent {
  userId: string;
  won: boolean;
}

/**
 * TypeORM-backed implementation of {@link AchievementsRepository}. Registered
 * as the `AchievementsRepository` provider in `AchievementsModule` so the
 * service can be injected wherever achievements are needed.
 */
@Injectable()
export class TypeOrmAchievementsRepository implements AchievementsRepository {
  constructor(
    @InjectRepository(Achievement)
    private readonly achievements: Repository<Achievement>,
    @InjectRepository(UserAchievement)
    private readonly userAchievements: Repository<UserAchievement>,
  ) {}

  async upsertDefinition(definition: AchievementDefinition): Promise<void> {
    await this.achievements.upsert(
      {
        code: definition.code,
        name: definition.name,
        description: definition.description,
      },
      ['code'],
    );
  }

  async findUnlockedCodes(userId: string): Promise<AchievementCode[]> {
    const rows = await this.userAchievements.find({
      where: { userId },
      select: ['achievementCode'],
    });
    return rows.map((row) => row.achievementCode as AchievementCode);
  }

  async insertUnlock(userId: string, code: AchievementCode): Promise<boolean> {
    const result = await this.userAchievements
      .createQueryBuilder()
      .insert()
      .into(UserAchievement)
      .values({ userId, achievementCode: code })
      .orIgnore()
      .execute();
    return (result.identifiers?.length ?? 0) > 0;
  }
}

@Injectable()
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    private readonly repository: AchievementsRepository,
    private readonly events: EventEmitter2,
  ) {}

  /** Seed the achievement definitions into the `achievements` table. */
  async seedDefinitions(): Promise<void> {
    for (const definition of ACHIEVEMENT_DEFINITIONS) {
      await this.repository.upsertDefinition(definition);
    }
  }

  /** List the achievements unlocked by a user (for GET /users/me/achievements). */
  async listForUser(userId: string): Promise<AchievementDefinition[]> {
    const unlocked = new Set(await this.repository.findUnlockedCodes(userId));
    return ACHIEVEMENT_DEFINITIONS.filter((definition) =>
      unlocked.has(definition.code),
    );
  }

  /**
   * Subscribe to `round.ended` gameplay events. Game code emits the event
   * rather than calling the service, so achievements stay decoupled.
   */
  @OnEvent('round.ended', { async: true })
  async onRoundEnded(event: RoundEndedEvent): Promise<void> {
    await this.handleGameplayEvent({
      userId: event.userId,
      correctAnswer: event.correctAnswer,
      streak: event.streak,
      answerTimeMs: event.answerTimeMs,
    });
  }

  /** Subscribe to `wager.settled` gameplay events. */
  @OnEvent('wager.settled', { async: true })
  async onWagerSettled(event: WagerSettledEvent): Promise<void> {
    await this.handleGameplayEvent({
      userId: event.userId,
      wagerWon: event.won,
    });
  }

  /**
   * Evaluate a gameplay event and award any achievements it satisfies.
   * Each achievement is awarded at most once thanks to the idempotent
   * `insertUnlock` contract.
   */
  async handleGameplayEvent(event: GameplayEvent): Promise<AchievementCode[]> {
    const codes = this.resolveCodes(event);
    const awarded: AchievementCode[] = [];

    for (const code of codes) {
      const isNew = await this.repository.insertUnlock(event.userId, code);
      if (isNew) {
        awarded.push(code);
        this.emitUnlocked(event.userId, code);
      }
    }

    return awarded;
  }

  private resolveCodes(event: GameplayEvent): AchievementCode[] {
    const codes: AchievementCode[] = [];

    if (event.correctAnswer) {
      codes.push('perfect_guess');
    }

    if (typeof event.streak === 'number') {
      for (const { milestone, code } of STREAK_MILESTONES) {
        if (event.streak >= milestone) {
          codes.push(code);
        }
      }
    }

    if (event.wagerWon) {
      codes.push('first_win');
    }

    if (
      event.correctAnswer &&
      typeof event.answerTimeMs === 'number' &&
      event.answerTimeMs <= SPEED_DEMON_THRESHOLD_MS
    ) {
      codes.push('speed_demon');
    }

    return codes;
  }

  private emitUnlocked(userId: string, code: AchievementCode): void {
    const definition = ACHIEVEMENT_DEFINITIONS.find((d) => d.code === code);
    if (!definition) {
      return;
    }

    const payload: AchievementUnlockedEvent = {
      userId,
      code,
      name: definition.name,
      description: definition.description,
      unlockedAt: new Date().toISOString(),
    };

    this.events.emit('user.achievement_unlocked', payload);
    this.logger.log(`Achievement ${code} unlocked for user ${userId}`);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Achievement definition identifiers.
 * These mirror the rows seeded into the `achievements` table.
 */
export type AchievementCode =
  | 'first_win'
  | 'perfect_guess'
  | 'streak'
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
    code: 'streak',
    name: 'On Fire',
    description: 'Reach a streak of 5 or 10 correct answers.',
  },
  {
    code: 'speed_demon',
    name: 'Speed Demon',
    description: 'Answer correctly in under 3 seconds.',
  },
];

/** Threshold (ms) under which a correct answer counts as a fast answer. */
export const SPEED_DEMON_THRESHOLD_MS = 3000;

/** Streak milestones that unlock the `streak` achievement. */
export const STREAK_MILESTONES = [5, 10];

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

    if (
      typeof event.streak === 'number' &&
      STREAK_MILESTONES.some((milestone) => event.streak! >= milestone)
    ) {
      codes.push('streak');
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

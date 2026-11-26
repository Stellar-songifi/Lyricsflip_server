import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';

const QUALIFYING_LYRICS = 10;

export async function recordReferralRound(
  manager: EntityManager,
  round: {
    roundId: string;
    userId: string;
    lyricId: number;
    correctInTime: boolean;
    elapsedMs: number;
    snippet: string;
  },
): Promise<void> {
  const words = round.snippet.trim().split(/\s+/).length;
  const readingFloorMs = Math.max(300, words * 125);
  await manager.query(
    `INSERT INTO referral_rounds
       ("roundId", "userId", "lyricId", "correctInTime", "elapsedMs", "readingFloorMs")
     SELECT $1, id, $3, $4, $5, $6
     FROM users WHERE id = $2 AND "referredBy" IS NOT NULL
     ON CONFLICT ("roundId") DO NOTHING`,
    [
      round.roundId,
      round.userId,
      round.lyricId,
      round.correctInTime,
      round.elapsedMs,
      readingFloorMs,
    ],
  );
}

@Injectable()
export class ReferralRewardsService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Reconcile periodically so email verification and gameplay can happen in
   * either order. A reward row is the cosmetic award for both accounts.
   */
  @Cron('*/30 * * * * *', { waitForCompletion: true })
  async awardEligibleReferrals(): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO referral_rewards ("referredId", "referrerId")
       SELECT player.id, referrer.id
       FROM users player
       JOIN users referrer ON referrer.id = player."referredBy"
       JOIN LATERAL (
         SELECT count(DISTINCT "lyricId") FILTER (
           WHERE "correctInTime" AND "elapsedMs" >= "readingFloorMs"
         ) AS qualifying,
         count(*) FILTER (
           WHERE "correctInTime" AND "elapsedMs" < "readingFloorMs"
         ) AS unusually_fast
         FROM referral_rounds WHERE "userId" = player.id
       ) evidence ON true
       WHERE player."emailVerifiedAt" IS NOT NULL
         AND player."isActive" AND referrer."isActive"
         AND evidence.qualifying >= $1
         AND evidence.unusually_fast < 3
         AND NOT EXISTS (
           SELECT 1 FROM referral_rewards WHERE "referredId" = player.id
         )
       ON CONFLICT ("referredId") DO NOTHING`,
      [QUALIFYING_LYRICS],
    );
  }
}

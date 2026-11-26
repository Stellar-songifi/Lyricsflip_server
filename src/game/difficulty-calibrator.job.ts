import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lyrics } from '../lyrics/entities/lyrics.entity';
import { JobLockService } from '../jobs/job-lock.service';

/**
 * Nightly difficulty calibration job.
 *
 * Recomputes each lyric's difficulty from aggregated gameplay history in a
 * single `UPDATE ... FROM (SELECT ...)` statement instead of one findOne +
 * update per lyric (N+1).
 *
 * NOTE: This job depends on `game_history` being populated by gameplay
 * (issue 57). Until that lands the subquery yields no rows and the job is a
 * no-op, so it is gated behind `CALIBRATION_ENABLED` and disabled by default.
 */
@Injectable()
export class DifficultyCalibratorJob {
  private readonly logger = new Logger(DifficultyCalibratorJob.name);

  constructor(
    @InjectRepository(Lyrics)
    private readonly lyricsRepository: Repository<Lyrics>,
    private readonly jobLockService: JobLockService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async calibrate(): Promise<void> {
    if (process.env.CALIBRATION_ENABLED !== 'true') {
      this.logger.debug(
        'Difficulty calibration disabled (awaiting game_history writes, issue 57)',
      );
      return;
    }

    await this.jobLockService.runExclusive('difficulty-calibrator', async () => {
      // Single statement: derive a per-lyric success rate from game_history and
      // map it onto the 1–5 difficulty range, clamped to stay within bounds.
      const result: unknown = await this.lyricsRepository.query(`
        UPDATE "lyrics" AS l
        SET "difficulty" = GREATEST(
          1,
          LEAST(5, ROUND(5 - (stats.rate * 4))::int)
        )
        FROM (
          SELECT
            gh."lyricId" AS "lyricId",
            AVG(CASE WHEN gh."success" THEN 1.0 ELSE 0.0 END) AS rate
          FROM "game_history" gh
          GROUP BY gh."lyricId"
          HAVING COUNT(*) >= 30
        ) AS stats
        WHERE l."id" = stats."lyricId"
          AND l."difficulty" IS DISTINCT FROM GREATEST(
            1,
            LEAST(5, ROUND(5 - (stats.rate * 4))::int)
          )
      `);

      const changed = Array.isArray(result)
        ? result.length
        : typeof result === 'number'
          ? result
          : 0;
      this.logger.log(`Difficulty calibration updated ${changed} lyric(s)`);
    });
  }
}

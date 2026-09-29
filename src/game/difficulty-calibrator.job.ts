import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { Lyrics } from 'src/lyrics/entities/lyrics.entity';
import { GameHistory } from 'src/game-history/entities/game-history.entity';

/**
 * Minimum number of attempts a lyric must have before its difficulty is
 * recalculated.  Lyrics with fewer attempts keep their current difficulty so
 * that a single outlier guess cannot skew the value.
 */
const MIN_ATTEMPTS_FOR_CALIBRATION = 10;

/**
 * Calibrates `lyrics.difficulty` from real game-history data (issue #175).
 *
 * Difficulty is derived from the correct-guess rate over all attempts for each
 * lyric:
 *
 *   rate  ≥ 0.80  → difficulty 1  (very easy)
 *   rate  ≥ 0.60  → difficulty 2
 *   rate  ≥ 0.40  → difficulty 3  (medium, the neutral default)
 *   rate  ≥ 0.20  → difficulty 4
 *   rate  <  0.20  → difficulty 5  (very hard)
 *
 * Only lyrics with at least MIN_ATTEMPTS_FOR_CALIBRATION attempts are updated,
 * so freshly-seeded lyrics stay at the default (3) until enough data exists.
 *
 * The job runs nightly.  It is idempotent: running it twice produces the same
 * result because it always derives difficulty from the full history.
 */
@Injectable()
export class DifficultyCalibratorJob {
  private readonly logger = new Logger(DifficultyCalibratorJob.name);

  constructor(
    @InjectRepository(Lyrics)
    private readonly lyricsRepository: Repository<Lyrics>,
    @InjectRepository(GameHistory)
    private readonly gameHistoryRepository: Repository<GameHistory>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async calibrateDifficulty(): Promise<void> {
    this.logger.log('Starting nightly difficulty calibration');

    try {
      const updated = await this.runCalibration();
      this.logger.log(
        `Difficulty calibration complete – updated ${updated} lyric(s)`,
      );
    } catch (error) {
      this.logger.error(
        'Difficulty calibration failed',
        (error as Error).stack,
      );
    }
  }

  /**
   * Executes the calibration and returns the count of lyrics whose difficulty
   * was changed.  Exposed for testing without triggering the cron schedule.
   */
  async runCalibration(): Promise<number> {
    // Aggregate: total attempts and correct-guess count per lyric.
    const rows: { lyricId: number; total: string; correct: string }[] =
      await this.gameHistoryRepository
        .createQueryBuilder('gh')
        .select('gh.lyricId', 'lyricId')
        .addSelect('COUNT(*)', 'total')
        .addSelect(
          'SUM(CASE WHEN gh.isCorrect = true THEN 1 ELSE 0 END)',
          'correct',
        )
        .groupBy('gh.lyricId')
        .having('COUNT(*) >= :min', { min: MIN_ATTEMPTS_FOR_CALIBRATION })
        .getRawMany();

    if (rows.length === 0) {
      this.logger.debug('No lyrics have enough attempts yet');
      return 0;
    }

    let updatedCount = 0;

    for (const row of rows) {
      const total = Number(row.total);
      const correct = Number(row.correct);
      const rate = total > 0 ? correct / total : 0;
      const newDifficulty = this.rateTodifficulty(rate);

      // Only write if the value actually changed to avoid unnecessary I/O.
      const existing = await this.lyricsRepository.findOne({
        where: { id: row.lyricId },
        select: ['id', 'difficulty'],
      });

      if (!existing) {
        continue; // Lyric was deleted; history rows will cascade-delete later.
      }

      if (existing.difficulty !== newDifficulty) {
        await this.lyricsRepository.update(row.lyricId, {
          difficulty: newDifficulty,
        });
        this.logger.debug(
          `Lyric ${row.lyricId}: difficulty ${existing.difficulty} → ${newDifficulty} ` +
            `(rate=${(rate * 100).toFixed(1)}%, total=${total}, correct=${correct})`,
        );
        updatedCount++;
      }
    }

    return updatedCount;
  }

  /**
   * Maps a correct-guess rate (0–1) to a difficulty level (1–5).
   *
   * Higher rate → lower difficulty (the lyric is easy to guess).
   */
  private rateTodifficulty(rate: number): number {
    if (rate >= 0.8) return 1;
    if (rate >= 0.6) return 2;
    if (rate >= 0.4) return 3;
    if (rate >= 0.2) return 4;
    return 5;
  }
}

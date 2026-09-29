import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * The lyrics chosen for one UTC day, stored so the set is fixed for the day
 * even if lyrics are added or deactivated afterwards.
 */
@Entity('daily_challenges')
export class DailyChallenge {
  /** UTC day, `YYYY-MM-DD`. */
  @PrimaryColumn({ type: 'date' })
  date: string;

  @Column({ type: 'int', array: true })
  lyricIds: number[];

  @CreateDateColumn()
  createdAt: Date;
}

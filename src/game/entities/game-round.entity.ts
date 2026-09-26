import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * One lyric served to one player, and the only thing a guess can be made
 * against.
 *
 * Guesses reference a round rather than a lyric so that the server decides
 * what is being guessed: a player cannot guess a lyric they were never served,
 * and closing the round on the first guess stops the answer that guess reveals
 * from being replayed for points.
 */
@Entity('game_rounds')
export class GameRound {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'int' })
  lyricId: number;

  @CreateDateColumn()
  issuedAt: Date;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  /** Set when the round's guess is taken; a closed round accepts no more. */
  @Column({ type: 'timestamp', nullable: true })
  closedAt: Date | null;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Lyrics } from '../../lyrics/entities/lyrics.entity';
import { GameSession } from '../../game-sessions/entities/game-session.entity';
import { GuessType } from '../../game/dto/guess.dto';

@Entity('game_history')
@Index(['createdAt', 'playerId'])
export class GameHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Player who made the guess
  @ManyToOne(() => User, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerId' })
  player: User;

  @Column({ type: 'uuid' })
  @Index()
  playerId: string;

  // Reference to the lyric that was guessed
  @ManyToOne(() => Lyrics, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lyricId' })
  lyric: Lyrics;

  @Column({ type: 'int' })
  @Index()
  lyricId: number;

  // Optional reference to game session (for multiplayer/wagered games)
  @ManyToOne(() => GameSession, { eager: false, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'gameSessionId' })
  gameSession: GameSession;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  gameSessionId: string;

  // Type of guess (artist or songTitle)
  @Column({
    type: 'enum',
    enum: GuessType,
  })
  guessType: GuessType;

  // The actual guess submitted by the player
  @Column({ type: 'varchar', length: 200 })
  guessValue: string;

  // Whether the guess was correct or incorrect
  @Column({ type: 'boolean' })
  @Index()
  isCorrect: boolean;

  // Points awarded for this guess
  @Column({ type: 'int', default: 0 })
  pointsAwarded: number;

  // XP gained or lost (if applicable)
  @Column({ type: 'int', default: 0 })
  xpChange: number;

  // Wager amount for context (if this was part of a wagered game)
  @Column({ type: 'int', nullable: true })
  wagerAmount: number;

  // When the guess was made
  @CreateDateColumn({ type: 'timestamptz' })
  @Index()
  createdAt: Date;
}

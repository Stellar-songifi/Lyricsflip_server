import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Lifecycle of a wager.
 *
 * The states between `PENDING` and a final outcome exist because settlement is
 * asynchronous: a payout can be submitted to Stellar and not yet confirmed, and
 * a wager in that state must be neither retried nor reported as paid.
 */
export enum WagerStatus {
  /** Row created; the escrow pot has not been opened on-chain yet. */
  PENDING = 'pending',
  /** Pot open, waiting for one or both players to sign their stake. */
  AWAITING_STAKES = 'awaiting_stakes',
  /** Both stakes are in escrow; the match can be played. */
  STAKED = 'staked',
  /** A payout or refund has been submitted but not yet confirmed. */
  SETTLING = 'settling',
  /** Pot paid out to the winner. */
  WON = 'won',
  /** Stakes returned to the players. */
  REFUNDED = 'refunded',
  /** Settlement failed outright; needs operator attention. */
  FAILED = 'failed',
}

@Entity('wagers')
export class Wager {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  sessionId: string;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'playerAId' })
  playerA: User;

  @Column({ type: 'uuid' })
  playerAId: string;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'playerBId' })
  playerB: User;

  @Column({ type: 'uuid' })
  playerBId: string;

  /**
   * Amount each player stakes, in token base units (stroops) as a string.
   *
   * Stored as `bigint` rather than `integer` because LYRIC has 7 decimals: an
   * `integer` column overflows at ~214 tokens, and a JS `number` loses
   * precision at ~900 million.
   */
  @Column({ type: 'bigint' })
  stakeStroops: string;

  /** Total pot in stroops — twice the stake, denormalised for display. */
  @Column({ type: 'bigint' })
  totalPotStroops: string;

  @Column({
    type: 'enum',
    enum: WagerStatus,
    enumName: 'wager_status_enum',
    default: WagerStatus.PENDING,
  })
  status: WagerStatus;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'winnerId' })
  winner: User;

  @Column({ type: 'uuid', nullable: true })
  winnerId: string;

  /**
   * Which backend settled this wager — `stellar` or `mock`.
   *
   * Recorded per wager so that a database containing rows from both modes stays
   * unambiguous after a deployment switches modes.
   */
  @Column({ type: 'varchar', length: 16, default: 'mock' })
  settlementMode: string;

  /** Hash of the transaction that opened the escrow pot. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  escrowTxHash?: string | null;

  /** Hash of player A's stake transaction. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  playerAStakeTxHash?: string | null;

  /** Hash of player B's stake transaction. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  playerBStakeTxHash?: string | null;

  /**
   * Hash of the payout or refund transaction.
   *
   * Written *before* the outcome is known, so that a crash between submission
   * and confirmation leaves something for reconciliation to look up rather than
   * an untracked transaction moving real funds.
   */
  @Column({ type: 'varchar', length: 128, nullable: true })
  settlementTxHash?: string | null;

  /** Ledger sequence the settlement landed in, once confirmed. */
  @Column({ type: 'bigint', nullable: true })
  settlementLedger?: string | null;

  /** Message to display to users about the wager result. */
  @Column({ type: 'text', nullable: true })
  resultMessage: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** When the wager reached a final state (won, refunded or failed). */
  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date;
}

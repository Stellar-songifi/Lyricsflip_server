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

/**
 * The kind of settlement a wager is being settled with.
 *
 * Recorded when entering {@link WagerStatus.SETTLING}, before the network call,
 * so that reconciliation can tell an interrupted payout apart from an
 * interrupted refund even though `winnerId` is not yet set.
 */
export enum SettlementKind {
  PAYOUT = 'payout',
  REFUND = 'refund',
}

@Entity('wagers')
export class Wager {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  sessionId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'playerAId' })
  playerA: User;

  @Column({ type: 'uuid' })
  playerAId: string;

  @ManyToOne(() => User)
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
   * The settlement intent recorded when the wager entered
   * {@link WagerStatus.SETTLING}.
   *
   * `winnerId` is only set once a payout is confirmed, so reconciliation needs
   * this to know whether an interrupted settlement was a payout or a refund.
   */
  @Column({
    type: 'enum',
    enum: SettlementKind,
    enumName: 'settlement_kind_enum',
    nullable: true,
  })
  settlementKind?: SettlementKind | null;

  /**
   * The winner the settlement intended to pay, recorded before the network
   * call. Used by reconciliation to restore `winnerId` when a payout is
   * confirmed on-chain.
   */
  @Column({ type: 'uuid', nullable: true })
  intendedWinnerId?: string | null;

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
   * Hash of the most recently built (but not necessarily signed) stake
   * transaction offered to player A.
   *
   * A player's original stake transaction expires — its timeout runs out, or
   * the account's sequence number moves — long before the wager does.
   * `POST /game-sessions/:id/stake/transaction` rebuilds it and records the
   * new hash here so a stale signature can be told apart from a current one.
   */
  @Column({ type: 'varchar', length: 128, nullable: true })
  playerALatestStakeHash?: string | null;

  /** Hash of the most recently built stake transaction offered to player B. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  playerBLatestStakeHash?: string | null;

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

  /**
   * When a wager still `AWAITING_STAKES` past this point is refunded
   * automatically.
   *
   * Set once, when the pot opens, so a player who never signs cannot leave
   * the other player's stake locked indefinitely: {@link WagerRefundJob}
   * sweeps past-deadline wagers and refunds whatever staked.
   */
  @Column({ type: 'timestamp', nullable: true })
  stakeDeadline?: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** When the wager reached a final state (won, refunded or failed). */
  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date;
}

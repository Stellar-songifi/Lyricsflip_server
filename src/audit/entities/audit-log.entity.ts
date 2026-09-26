import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * An immutable record of one admin or settlement action.
 *
 * Rows are only ever inserted, never updated or deleted - there is no
 * `UpdateDateColumn`, and `AuditController` exposes a read endpoint only. For
 * an app that moves tokens, this table is the record disputes get resolved
 * against, so it must reflect what actually happened rather than the
 * current, possibly edited, state of anything else.
 */
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Who performed the action - the authenticated user's ID, or 'system'. */
  @Index()
  @Column()
  actorId: string;

  /** Short machine-readable action name, e.g. `admin.user.delete`. */
  @Index()
  @Column()
  action: string;

  /** Kind of thing the action targeted, e.g. `user`, `lyric`, `wager`. */
  @Column({ nullable: true })
  targetType: string | null;

  /** ID of the target, as a string regardless of its own primary key type. */
  @Index()
  @Column({ nullable: true })
  targetId: string | null;

  /**
   * Arbitrary JSON payload describing the action - request params and
   * (sanitized) body, and the result where useful. Never the raw request:
   * see `AuditInterceptor.sanitize`.
   */
  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ nullable: true })
  ip: string | null;

  @CreateDateColumn()
  timestamp: Date;
}

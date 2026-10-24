import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  // SHA-256 hex digest, so always 64 characters (the column's width since
  // CreateRefreshTokensTable).
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  @Index('IDX_refresh_tokens_expiresAt')
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Index('IDX_refresh_tokens_revokedAt')
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  /** User-Agent of the client that last used this session, capped at 255. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  /**
   * Network the session was last used from, truncated per the retention
   * policy (IPv4 /24, IPv6 /48; see truncateIp). Never the full address.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  /** Optional name the client gives the device, e.g. "Ada's iPhone". */
  @Column({ type: 'varchar', length: 100, nullable: true })
  deviceName: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
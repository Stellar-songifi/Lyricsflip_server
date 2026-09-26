import { Exclude, Expose } from 'class-transformer';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { GameSession } from '../../game-sessions/entities/game-session.entity';
import { Role } from 'src/auth/roles/role.enum';
import { PRIVATE_USER_GROUPS } from '../user-serialization';

export enum UserLevel {
  GOSSIP_ROOKIE = 'Gossip Rookie',
  WORD_WHISPERER = 'Word Whisperer',
  LYRIC_SNIPER = 'Lyric Sniper',
  BAR_GENIUS = 'Bar Genius',
  GOSSIP_GURU = 'Gossip Guru',
}

export enum MusicGenre {
  POP = 'Pop',
  ROCK = 'Rock',
  HIP_HOP = 'Hip Hop',
  RAP = 'Rap',
  R_AND_B = 'R&B',
  COUNTRY = 'Country',
  JAZZ = 'Jazz',
  BLUES = 'Blues',
  ELECTRONIC = 'Electronic',
  DANCE = 'Dance',
  REGGAE = 'Reggae',
  FOLK = 'Folk',
  INDIE = 'Indie',
  ALTERNATIVE = 'Alternative',
  METAL = 'Metal',
  PUNK = 'Punk',
  SOUL = 'Soul',
  FUNK = 'Funk',
  CLASSICAL = 'Classical',
  WORLD = 'World',
}

export enum MusicDecade {
  SIXTIES = '1960s',
  SEVENTIES = '1970s',
  EIGHTIES = '1980s',
  NINETIES = '1990s',
  TWO_THOUSANDS = '2000s',
  TWENTY_TENS = '2010s',
  TWENTY_TWENTIES = '2020s',
}

/**
 * Time windows supported by the public leaderboard endpoint.
 *
 * `ALL` ranks by the lifetime `xp` column; `WEEKLY` and `MONTHLY` rank by XP
 * earned inside the window, aggregated from `game_history`.
 */
export enum LeaderboardPeriod {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  ALL = 'all',
}

/**
 * Fields without @Expose are public (id, username, xp, level, levelTitle,
 * createdAt). Fields in PRIVATE_USER_GROUPS appear only for the user themself
 * or an admin; see user-serialization.ts.
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Expose({ groups: PRIVATE_USER_GROUPS })
  @Index()
  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ unique: true })
  username: string;

  @Expose({ groups: PRIVATE_USER_GROUPS })
  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string;

  // Never loaded unless a query asks for it (only the password login does),
  // and never serialized even if it is.
  @Column({ select: false })
  @Exclude()
  passwordHash: string;

  @Column({ default: 0 })
  xp: number; // total experience points

  @Column({ default: 1 })
  level: number; // numeric level (1 = Rookie, etc.)

  @Column({
    type: 'enum',
    enum: UserLevel,
    default: UserLevel.GOSSIP_ROOKIE,
  })
  levelTitle: UserLevel; // human-readable title

  @CreateDateColumn()
  createdAt: Date;

  @Expose({ groups: PRIVATE_USER_GROUPS })
  @UpdateDateColumn()
  updatedAt: Date;

  @Expose({ groups: PRIVATE_USER_GROUPS })
  @Column({ nullable: true })
  lastLoginAt?: Date;

  @Expose({ groups: PRIVATE_USER_GROUPS })
  @Column({
    type: 'varchar',
    length: 20,
    enum: Role,
    default: Role.User,
  }) // Default role for new users
  role: Role; // 'user' or 'admin'

  @Expose({ groups: PRIVATE_USER_GROUPS })
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  /**
   * Bumped whenever outstanding access/refresh tokens should stop working
   * (currently: on password change). Embedded in every access token and
   * compared on each request by JwtStrategy.
   */
  @Column({ type: 'int', default: 0 })
  tokenVersion: number;

  /**
   * The Stellar account (G...) this user stakes from and is paid out to.
   *
   * Null until the user links a wallet by signing a SEP-10 challenge; wagered
   * matches are unavailable until then.
   */
  @Expose({ groups: PRIVATE_USER_GROUPS })
  @Index()
  @Column({ type: 'varchar', length: 56, nullable: true, unique: true })
  stellarAddress?: string | null;

  /** When wallet ownership was last proved via SEP-10. */
  @Expose({ groups: PRIVATE_USER_GROUPS })
  @Column({ type: 'timestamp', nullable: true })
  stellarAddressVerifiedAt?: Date | null;

  /**
   * Balance used only by the mock settlement backend, in token base units
   * (stroops) held as a string.
   *
   * When STELLAR_SETTLEMENT_MODE=stellar this column is ignored entirely and
   * balances are read from the token contract instead. It is a bigint rather
   * than an int because a 7-decimal token passes the safe-integer range at
   * around 900 million tokens.
   */
  @Expose({ groups: PRIVATE_USER_GROUPS })
  @Column({ type: 'bigint', default: '1000000000' })
  mockBalance: string; // 100.0000000 LYRIC

  @Expose({ groups: PRIVATE_USER_GROUPS })
  @Column({
    type: 'enum',
    enum: MusicGenre,
    nullable: true,
  })
  preferredGenre?: MusicGenre;

  @Expose({ groups: PRIVATE_USER_GROUPS })
  @Column({
    type: 'enum',
    enum: MusicDecade,
    nullable: true,
  })
  preferredDecade?: MusicDecade;

  @Exclude()
  @OneToMany(() => GameSession, gameSession => gameSession.player)
  gameSessions: GameSession[];
}

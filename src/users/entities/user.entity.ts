import { Exclude } from 'class-transformer';
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

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ unique: true })
  username: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string;

  @Column()
  @Exclude() // Exclude password from serialization
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

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  lastLoginAt?: Date;

  @Column({
    type: 'varchar',
    length: 20,
    enum: Role,
    default: Role.User,
  }) // Default role for new users
  role: Role; // 'user' or 'admin'

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
  @Index()
  @Column({ type: 'varchar', length: 56, nullable: true, unique: true })
  stellarAddress?: string | null;

  /** When wallet ownership was last proved via SEP-10. */
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
  @Column({ type: 'bigint', default: '1000000000' })
  mockBalance: string; // 100.0000000 LYRIC

  @Column({
    type: 'enum',
    enum: MusicGenre,
    nullable: true,
  })
  preferredGenre?: MusicGenre;

  @Column({
    type: 'enum',
    enum: MusicDecade,
    nullable: true,
  })
  preferredDecade?: MusicDecade;

  @OneToMany(() => GameSession, gameSession => gameSession.player)

  gameSessions: GameSession[];
}

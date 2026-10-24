import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, OneToMany, JoinColumn, Index } from 'typeorm';
import { Lyrics } from '../../lyrics/entities/lyrics.entity';
import { RoomUser } from './room-user.entity';

export enum RoomStatus {
  LOBBY = 'lobby',
  IN_PROGRESS = 'in_progress',
  FINISHED = 'finished',
}

@Entity('rooms')
@Index(['code'], { unique: true })
export class Room {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  name: string;

  @Column({ length: 6, unique: true })
  code: string;

  @ManyToOne(() => Lyrics)
  @JoinColumn()
  lyric: Lyrics;

  @Column()
  lyricId: number;

  @Column({ nullable: true })
  hostId: string;

  @Column({ type: 'int', default: 8 })
  maxPlayers: number;

  @Column({ type: 'enum', enum: RoomStatus, default: RoomStatus.LOBBY })
  status: RoomStatus;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date;

  @Column({ type: 'int', default: 0 })
  roundCount: number;

  @OneToMany(() => RoomUser, roomUser => roomUser.room)
  roomUsers: RoomUser[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date;

  @Column({ default: false })
  isClosed: boolean;
}

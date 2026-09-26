import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, OneToMany, JoinColumn, Index } from 'typeorm';
import { Lyrics } from '../../lyrics/entities/lyrics.entity';
import { RoomUser } from './room-user.entity';

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

  @OneToMany(() => RoomUser, roomUser => roomUser.room)
  roomUsers: RoomUser[];

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date;

  @Column({ default: false })
  isClosed: boolean;
}

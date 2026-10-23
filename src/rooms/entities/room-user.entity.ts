import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Unique } from 'typeorm';
import { Room } from './room.entity';
import { User } from '../../users/entities/user.entity';

@Entity('room_users')
@Unique(['userId', 'roomId']) // Ensure a user can't join a room twice
export class RoomUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn()
  user: User;

  @Column()
  userId: string;

  @ManyToOne(() => Room, room => room.roomUsers)
  @JoinColumn()
  room: Room;

  @Column()
  roomId: string;

  @Column({ default: false })
  hasGuessed: boolean;

  @Column({ type: 'float', default: 0 })
  score: number;

  @Column({ type: 'text', nullable: true })
  guess: string;

  @CreateDateColumn({ type: 'timestamptz' })
  joinedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  guessedAt: Date;
}

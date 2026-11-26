import {
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Achievement } from './achievement.entity';

@Entity('user_achievements')
export class UserAchievement {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_user_achievements',
  })
  userId: string;

  @PrimaryColumn({
    type: 'varchar',
    length: 50,
    primaryKeyConstraintName: 'PK_user_achievements',
  })
  achievementCode: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_user_achievements_user',
  })
  user: User;

  @ManyToOne(() => Achievement, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'achievementCode',
    foreignKeyConstraintName: 'FK_user_achievements_code',
  })
  achievement: Achievement;

  @CreateDateColumn({ type: 'timestamptz' })
  unlockedAt: Date;
}

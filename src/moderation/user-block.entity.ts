import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from '../users/entities/user.entity';

@Entity('user_blocks')
export class UserBlock {
  @PrimaryColumn('uuid', { primaryKeyConstraintName: 'PK_user_blocks' })
  blockerId: string;

  @PrimaryColumn('uuid', { primaryKeyConstraintName: 'PK_user_blocks' })
  blockedId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'blockerId',
    foreignKeyConstraintName: 'FK_user_blocks_blocker',
  })
  blocker: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'blockedId',
    foreignKeyConstraintName: 'FK_user_blocks_blocked',
  })
  blocked: User;
}

import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('achievements')
export class Achievement {
  @PrimaryColumn({
    type: 'varchar',
    length: 50,
    primaryKeyConstraintName: 'PK_achievements',
  })
  code: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  description: string;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from "typeorm"
import { User } from "../../users/entities/user.entity"
import { Genre } from "./genre.enum"

// Genre lives in its own module but is re-exported here because the entity is
// what consumers reach for: a DTO or a fixture that types a `genre` field
// wants the column's enum from the same import as the column.
export { Genre }

@Entity()
@Unique(["artist", "songTitle"]) // Combination uniqueness
export class Lyrics {
  @PrimaryGeneratedColumn()
  id: number

  @Column("text")
  content: string

  @Column()
  artist: string

  @Column("text")
  lyricSnippet: string

  @Column({ length: 200 })
  songTitle: string

  @Column({ length: 50, nullable: true })
  @Index()
  category: string

  @Column({ type: "enum", enum: Genre, default: Genre.Other })
  @Index()
  genre: Genre

  @Column({ type: "varchar", length: 10 })
  @Index()
  decade: string

  @Column({ type: "int", default: 0 })
  difficulty: number // 1-5 scale

  @Column({ type: "boolean", default: true })
  isActive: boolean

  @Column({ type: "int", default: 0 })
  timesUsed: number

  @ManyToOne(() => User, { eager: true, nullable: false, onDelete: "CASCADE" })
  createdBy: User

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
  Check,
} from "typeorm"
import { User } from "../../users/entities/user.entity"
import { Genre } from "./genre.enum"

// Genre lives in its own module but is re-exported here because the entity is
// what consumers reach for: a DTO or a fixture that types a `genre` field
// wants the column's enum from the same import as the column.
export { Genre }

@Entity()
@Unique(["artist", "songTitle"]) // Combination uniqueness
@Check('"difficulty" BETWEEN 1 AND 5')
export class Lyrics {
  @PrimaryGeneratedColumn()
  id: number

  // Full lyric text is no longer stored (R2-89): the game only ever serves
  // lyricSnippet, and keeping whole songs is exactly what CONTENT_POLICY.md
  // rules out. The column is kept nullable so old clients that still send
  // `content` do not break; LyricsService never persists it.
  @Column("text", { nullable: true })
  content: string | null

  @Column()
  artist: string

  // Alternative spellings for the artist (e.g. "JAY Z" for "Jay-Z").
  // Guesses are matched against the canonical value and every alias.
  @Column("text", { array: true, default: () => "'{}'" })
  artistAliases: string[]

  @Column("text")
  lyricSnippet: string

  @Column({ length: 200 })
  songTitle: string

  // Alternative spellings for the title (e.g. "WizKid" for "Wizkid").
  // Guesses are matched against the canonical value and every alias.
  @Column("text", { array: true, default: () => "'{}'" })
  titleAliases: string[]

  @Column({ length: 50, nullable: true })
  @Index()
  category: string

  @Column({ type: "enum", enum: Genre, default: Genre.Other })
  @Index()
  genre: Genre

  @Column({ type: "varchar", length: 10 })
  @Index()
  decade: string

  @Column({ type: "int", default: 3 })
  difficulty: number // 1-5 scale

  @Column({ type: "boolean", default: true })
  isActive: boolean

  @Column({ type: "int", default: 0 })
  timesUsed: number

  // Where the lyric came from, so everything from one source can be found
  // and deactivated in one action if its rights holder objects. Free text,
  // stored trimmed and lower-cased so "Genius" and "genius " match.
  @Column({ type: "varchar", length: 100 })
  @Index("IDX_lyrics_source")
  source: string

  @Column({ type: "varchar", length: 500, nullable: true })
  sourceUrl: string | null

  // Licence or agreement the snippet is used under, e.g. "fair-use-quote" or
  // a contract reference.
  @Column({ type: "varchar", length: 100, nullable: true })
  licence: string | null

  // Who added the lyric: the admin's user id, or "seed". Unlike createdBy
  // this is plain text, so it survives the account being removed.
  @Column({ type: "varchar", length: 100, nullable: true })
  addedBy: string | null

  // Nullable + SET NULL so deleting or deactivating the admin who seeded a
  // lyric never deletes the lyric itself (and by extension the game history
  // and rooms that reference it). See migration
  // AddSetNullToLyricsCreatedBy for the corresponding schema change.
  // Not eager: every lyric response would otherwise embed its creator.
  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  createdBy: User | null

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('lyrics')
export class Lyric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_lyrics_artist_trgm', { synchronize: false })
  @Column({ type: 'varchar', length: 255 })
  artist: string;

  @Index('idx_lyrics_song_title_trgm', { synchronize: false })
  @Column({ type: 'varchar', length: 255 })
  songTitle: string;

  @Column({ type: 'text' })
  content: string;

  @Index('idx_lyrics_content_tsv', { synchronize: false })
  @Column({
    type: 'tsvector',
    nullable: true,
    asExpression: "to_tsvector('english', coalesce(content, ''))",
    generatedType: 'STORED',
  })
  contentTsv: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

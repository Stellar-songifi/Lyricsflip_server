import { ApiProperty } from '@nestjs/swagger';
import { Genre, Lyrics } from '../entities/lyrics.entity';

/**
 * What a player may see of a lyric: enough to play it, nothing that answers
 * it. `artist`, `songTitle` and the full `content` are left out because any of
 * them gives away the guess.
 */
export class PlayerLyricDto {
  @ApiProperty()
  id: number;
  @ApiProperty()
  lyricSnippet: string;
  @ApiProperty({ enum: Genre })
  genre: Genre;
  @ApiProperty()
  decade: string;
  @ApiProperty()
  category: string;

  static from(lyric: Lyrics): PlayerLyricDto {
    return {
      id: lyric.id,
      lyricSnippet: lyric.lyricSnippet,
      genre: lyric.genre,
      decade: lyric.decade,
      category: lyric.category,
    };
  }
}

/** A lyric as an admin manages it, answers included. */
export class AdminLyricDto extends PlayerLyricDto {
  /** Always null for lyrics added after R2-89; full text is not stored. */
  @ApiProperty({ nullable: true })
  content: string | null;
  @ApiProperty()
  source: string;
  @ApiProperty({ nullable: true })
  sourceUrl: string | null;
  @ApiProperty({ nullable: true })
  licence: string | null;
  @ApiProperty({ nullable: true })
  addedBy: string | null;
  @ApiProperty()
  artist: string;
  @ApiProperty()
  songTitle: string;
  @ApiProperty()
  difficulty: number;
  @ApiProperty()
  isActive: boolean;
  @ApiProperty()
  timesUsed: number;
  @ApiProperty()
  createdAt: Date;
  @ApiProperty()
  updatedAt: Date;

  static from(lyric: Lyrics): AdminLyricDto {
    return {
      ...PlayerLyricDto.from(lyric),
      content: lyric.content,
      source: lyric.source,
      sourceUrl: lyric.sourceUrl,
      licence: lyric.licence,
      addedBy: lyric.addedBy,
      artist: lyric.artist,
      songTitle: lyric.songTitle,
      difficulty: lyric.difficulty,
      isActive: lyric.isActive,
      timesUsed: lyric.timesUsed,
      createdAt: lyric.createdAt,
      updatedAt: lyric.updatedAt,
    };
  }
}

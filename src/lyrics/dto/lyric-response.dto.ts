import { Genre, Lyrics } from '../entities/lyrics.entity';

/**
 * What a player may see of a lyric: enough to play it, nothing that answers
 * it. `artist`, `songTitle` and the full `content` are left out because any of
 * them gives away the guess.
 */
export class PlayerLyricDto {
  id: number;
  lyricSnippet: string;
  genre: Genre;
  decade: string;
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
  content: string;
  artist: string;
  songTitle: string;
  difficulty: number;
  isActive: boolean;
  timesUsed: number;
  createdAt: Date;
  updatedAt: Date;

  static from(lyric: Lyrics): AdminLyricDto {
    return {
      ...PlayerLyricDto.from(lyric),
      content: lyric.content,
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

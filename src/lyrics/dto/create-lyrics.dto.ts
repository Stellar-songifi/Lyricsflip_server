import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsInt,
  IsOptional,
  IsArray,
  IsUrl,
  ValidateIf,
  ArrayMaxSize,
  Min,
  Max,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Genre } from '../entities/lyrics.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for creating a new Lyrics record.
 *
 * This is the single source of truth for lyric validation, used by the
 * controller, AdminService.importLyrics and the seed so that API and import
 * reject the same invalid rows.
 *
 * lyricSnippet behaviour
 * ----------------------
 * • If the client supplies lyricSnippet it is used as-is (1–150 chars).
 * • If the client omits lyricSnippet, LyricsService.create() derives one
 *   automatically by trimming `content` to its first 150 characters.
 *   This keeps every row's lyricSnippet non-empty while still letting
 *   callers override the default with a hand-picked excerpt.
 * • One of the two is required. `content` itself is never stored (R2-89).
 *
 * Every lyric must say where it came from (`source`), so all lyrics from one
 * source can be found and deactivated together.
 */
export class CreateLyricDto {
  @ApiPropertyOptional({
    description:
      'Full lyrics, used only to derive lyricSnippet when it is omitted. Never stored.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  content?: string;

  @ApiPropertyOptional({
    description:
      'Short excerpt shown to players during gameplay (1–150 chars). ' +
      'When omitted the service derives one from the first 150 chars of content.',
    minLength: 1,
    maxLength: 150,
  })
  // Required when there is no content to derive it from.
  @ValidateIf((o) => o.lyricSnippet !== undefined || !o.content)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  lyricSnippet?: string;

  @ApiProperty({
    description:
      'Where the lyric came from, e.g. "genius", "artist-submission", "licensed:acme-music". Stored lower-case.',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  source: string;

  @ApiPropertyOptional({ description: 'Link to the source', maxLength: 500 })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  sourceUrl?: string;

  @ApiPropertyOptional({
    description:
      'Licence or agreement the snippet is used under, e.g. "fair-use-quote" or a contract reference',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  licence?: string;

  @ApiProperty({ description: 'Artist name' })
  @IsString()
  @IsNotEmpty()
  artist: string;

  @ApiPropertyOptional({
    description:
      'Alternative accepted spellings for the artist (e.g. "JAY Z" for "Jay-Z").',
    type: [String],
    maxItems: 20,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : value,
  )
  artistAliases?: string[];

  @ApiProperty({ description: 'Song title' })
  @IsString()
  @IsNotEmpty()
  songTitle: string;

  @ApiPropertyOptional({
    description:
      'Alternative accepted spellings for the song title (e.g. "WizKid" for "Wizkid").',
    type: [String],
    maxItems: 20,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : value,
  )
  titleAliases?: string[];

  @ApiProperty({ enum: Genre, description: 'Genre of the song' })
  @IsEnum(Genre)
  genre: Genre;

  @ApiProperty({
    description: 'Decade of the song',
    minimum: 1900,
    maximum: new Date().getFullYear(),
    type: Number,
  })
  @IsInt()
  @Min(1900)
  @Max(new Date().getFullYear())
  decade: number;

  @ApiPropertyOptional({
    description: 'Content category (e.g. "love", "party")',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  category?: string;

  @ApiPropertyOptional({
    description: 'Difficulty level on a 1–5 scale (default: 0 = unset)',
    minimum: 0,
    maximum: 5,
    type: Number,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  difficulty?: number;
}

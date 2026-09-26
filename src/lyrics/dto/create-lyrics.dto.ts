import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsInt,
  IsOptional,
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
 * lyricSnippet behaviour
 * ----------------------
 * • If the client supplies lyricSnippet it is used as-is (1–300 chars).
 * • If the client omits lyricSnippet, LyricsService.create() derives one
 *   automatically by trimming `content` to its first 150 characters.
 *   This keeps every row's lyricSnippet non-empty while still letting
 *   callers override the default with a hand-picked excerpt.
 */
export class CreateLyricsDto {
  @ApiProperty({ description: 'Full lyrics content' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({
    description:
      'Short excerpt shown to players during gameplay (1–300 chars). ' +
      'When omitted the service derives one from the first 150 chars of content.',
    minLength: 1,
    maxLength: 300,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  lyricSnippet?: string;

  @ApiProperty({ description: 'Artist name' })
  @IsString()
  @IsNotEmpty()
  artist: string;

  @ApiProperty({ description: 'Song title' })
  @IsString()
  @IsNotEmpty()
  songTitle: string;

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

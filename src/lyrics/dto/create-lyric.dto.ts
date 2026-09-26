import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Maximum length of a lyric snippet served to players.
 * Full copyrighted lyric text must never be stored or served to players;
 * only a short snippet plus answer metadata is required by the game.
 */
export const MAX_LYRIC_SNIPPET_LENGTH = 150;

/**
 * Maximum number of lines allowed in a lyric snippet.
 */
export const MAX_LYRIC_SNIPPET_LINES = 2;

export class CreateLyricDto {
  @ApiProperty({
    description: 'Short lyric snippet (max 150 characters or 2 lines)',
    maxLength: MAX_LYRIC_SNIPPET_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_LYRIC_SNIPPET_LENGTH, {
    message: `lyricSnippet must be at most ${MAX_LYRIC_SNIPPET_LENGTH} characters long`,
  })
  lyricSnippet: string;

  @ApiProperty({ description: 'Song title' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: 'Artist name' })
  @IsString()
  @IsNotEmpty()
  artist: string;

  @ApiPropertyOptional({
    description:
      'Full lyric text. Optional and restricted to admins; never served to players.',
  })
  @IsOptional()
  @IsString()
  content?: string;
}

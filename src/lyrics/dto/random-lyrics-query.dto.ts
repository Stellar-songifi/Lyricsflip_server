import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Maximum random lyrics a player may request in one call (R3-50). */
export const MAX_RANDOM_LYRICS_COUNT = 20;

/**
 * Query parameters for `GET /lyrics/random`.
 *
 * `count` is validated here so invalid values (letters, 0, 101, 1.5) are
 * rejected with 400 before they reach the service or the database.
 */
export class RandomLyricsQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_RANDOM_LYRICS_COUNT,
    default: 1,
    description: `Number of random lyrics to return (1–${MAX_RANDOM_LYRICS_COUNT})`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_RANDOM_LYRICS_COUNT)
  count?: number;

  @ApiPropertyOptional({ description: 'Filter by genre' })
  @IsOptional()
  @IsString()
  genre?: string;

  @ApiPropertyOptional({ description: 'Filter by decade (e.g. 1990 or 1990s)' })
  @IsOptional()
  @IsString()
  decade?: string;
}

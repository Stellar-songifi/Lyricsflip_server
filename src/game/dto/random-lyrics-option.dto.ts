import {
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  IsEnum,
  IsUUID,
  IsBoolean,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { Genre, toGenre } from 'src/lyrics/entities/genre.enum';

export class RandomLyricOptionsDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  category?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  decade?: string;

  @IsOptional()
  @IsEnum(Genre, {
    message: `genre must be one of: ${Object.values(Genre).join(', ')}`,
  })
  @Transform(({ value }) => toGenre(value))
  genre?: Genre;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @Type(() => Number)
  excludeIds?: number[];

  /** Ties the round to a multiplayer session the caller is playing in. */
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  /**
   * When true, the user's preferredGenre and preferredDecade are not applied
   * as fallback filters even if no explicit genre/decade was given.
   */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  ignorePreferences?: boolean;

  /**
   * Filter by difficulty level (1–5). When omitted all difficulty levels are
   * included.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  difficulty?: number;
}

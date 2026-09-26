import {
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  IsEnum,
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
}

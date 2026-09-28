import {
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  IsEnum,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Genre, toGenre } from 'src/lyrics/entities/genre.enum';

export class RandomLyricOptionsDto {
  @ApiPropertyOptional({ description: 'Category filter' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  category?: string;

  @ApiPropertyOptional({ description: 'Decade filter' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  decade?: string;

  @ApiPropertyOptional({ enum: Genre, description: 'Genre filter' })
  @IsOptional()
  @IsEnum(Genre, {
    message: `genre must be one of: ${Object.values(Genre).join(', ')}`,
  })
  @Transform(({ value }) => toGenre(value))
  genre?: Genre;

  @ApiPropertyOptional({ description: 'Ids to exclude', type: [Number] })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @Type(() => Number)
  excludeIds?: number[];
}

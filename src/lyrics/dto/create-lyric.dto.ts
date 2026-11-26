import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Genre } from '../entities/genre.enum';

export class CreateLyricDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150, { message: 'Snippet must not exceed 150 characters' })
  snippet: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  artist: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}s$/, { message: 'Decade must be in the format YYYYs (e.g. 1990s)' })
  decade?: string;

  @IsOptional()
  @IsEnum(Genre, { message: 'Genre must be a valid genre' })
  genre?: Genre;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;
}
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { GuessType } from '../../game/dto/guess.dto';

export class DailyGuessDto {
  /** A lyric from today's set, as returned by `GET /challenges/daily`. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  lyricId: number;

  @IsEnum(GuessType)
  guessType: GuessType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  guessValue: string;
}

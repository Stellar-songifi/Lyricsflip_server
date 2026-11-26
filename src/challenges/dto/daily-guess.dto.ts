import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { GuessType } from '../../game/dto/guess.dto';

export class DailyGuessDto {
  /**
   * The round id returned for this lyric by `GET /challenges/daily`. The
   * server uses it to look up the server-issued timestamp and enforce the
   * answer window without trusting anything from the client.
   */
  @IsUUID()
  roundId: string;

  @IsEnum(GuessType)
  guessType: GuessType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  guessValue: string;
}

import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export enum GuessType {
  ARTIST = 'artist',
  SONG_TITLE = 'songTitle',
}

export class GuessDto {
  /** The round returned by `GET /game/lyric`. */
  @IsUUID()
  roundId: string;

  @IsEnum(GuessType)
  @IsNotEmpty()
  guessType: GuessType;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  guessValue: string;
}

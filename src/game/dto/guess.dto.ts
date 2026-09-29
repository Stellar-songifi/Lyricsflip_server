import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export enum GuessType {
  ARTIST = 'artist',
  SONG_TITLE = 'songTitle',
}

export class GuessDto {
  /** The round returned by `GET /game/lyric`. */
  @ApiProperty({ description: 'The active round id returned by the lyric endpoint', format: 'uuid' })
  @IsUUID()
  roundId: string;

  @ApiProperty({ enum: GuessType, description: 'Guess category' })
  @IsEnum(GuessType)
  @IsNotEmpty()
  guessType: GuessType;

  @ApiProperty({ description: 'Guess text', minLength: 1, maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  guessValue: string;
}

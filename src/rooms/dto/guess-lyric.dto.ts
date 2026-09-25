import { IsString, IsNotEmpty, IsEnum, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { GuessType } from '../../game/dto/guess.dto';

export class GuessLyricDto {
  // Rooms are scored like solo play: the guess is an artist or a song title.
  @IsEnum(GuessType)
  guessType: GuessType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  guess: string;
}

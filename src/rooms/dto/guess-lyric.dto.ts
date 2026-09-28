import { IsString, IsNotEmpty, IsEnum, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { GuessType } from '../../game/dto/guess.dto';

export class GuessLyricDto {
  // Rooms are scored like solo play: the guess is an artist or a song title.
  @ApiProperty({ enum: GuessType, description: 'Type of lyric guess to evaluate' })
  @IsEnum(GuessType)
  guessType: GuessType;

  @ApiProperty({ description: 'Guess value', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  guess: string;
}

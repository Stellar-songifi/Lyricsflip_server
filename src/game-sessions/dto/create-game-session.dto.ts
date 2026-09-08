import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Matches,
  Min,
  IsString,
  IsBoolean,
} from 'class-validator';
import {
  GameCategory,
  GameSessionStatus,
  GameMode,
} from '../entities/game-session.entity';
import { ApiProperty } from '@nestjs/swagger';

export class CreateGameSessionDto {
  @ApiProperty({ enum: GameCategory, description: 'Game category' })
  @IsNotEmpty()
  @IsEnum(GameCategory)
  category: GameCategory;

  @ApiProperty({ enum: GameMode, description: 'Game mode', required: false })
  @IsOptional()
  @IsEnum(GameMode)
  mode?: GameMode;

  @ApiProperty({
    description: 'Player Two ID for multiplayer games',
    required: false,
  })
  @IsOptional()
  @IsString()
  playerTwoId?: string;

  @ApiProperty({
    description: 'Score',
    required: false,
    minimum: 0,
    type: Number,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  score?: number;

  @ApiProperty({
    enum: GameSessionStatus,
    description: 'Session status',
    required: false,
  })
  @IsOptional()
  @IsEnum(GameSessionStatus)
  status?: GameSessionStatus;

  @ApiProperty({
    description:
      'Amount each player stakes, as a decimal LYRIC string ("10", "2.5"). ' +
      'Sent as a string rather than a number so that fractional stakes cannot ' +
      'be mangled by floating-point rounding on the way in.',
    required: false,
    example: '10',
    type: String,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,7})?$/, {
    message:
      'wagerAmount must be a non-negative decimal with at most 7 decimal places',
  })
  wagerAmount?: string;

  @ApiProperty({
    description: 'Whether this session has a wager',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  hasWager?: boolean;
}

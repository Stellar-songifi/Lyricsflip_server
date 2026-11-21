import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Matches,
  Min,
  IsString,
} from 'class-validator';
import {
  GameCategory,
  GameSessionStatus,
  GameMode,
} from '../entities/game-session.entity';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Responsible-play policy for wagers.
 *
 * - Stakes must fall within [WAGER_MIN_STAKE, WAGER_MAX_STAKE] (inclusive).
 * - A user may hold at most WAGER_MAX_OPEN_PER_USER open wagers at a time.
 * - Per-user daily stake limits and self-exclusion are enforced in the wager
 *   service; a self-excluded user cannot create or accept wagers until the
 *   exclusion end date passes.
 *
 * These values are the defaults; deployments may override them via the
 * corresponding environment settings.
 */
export const WAGER_MIN_STAKE = '1';
export const WAGER_MAX_STAKE = '10000';
export const WAGER_MAX_OPEN_PER_USER = 10;

/**
 * Parse a decimal LYRIC string into a scaled integer (7 decimal places) so
 * that range comparisons avoid floating-point rounding.
 */
export function parseStakeToScaled(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  const paddedFraction = (fraction + '0000000').slice(0, 7);
  return BigInt(whole) * 10_000_000n + BigInt(paddedFraction);
}

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
      'be mangled by floating-point rounding on the way in. Only honoured when ' +
      'mode is "wagered"; the server derives hasWager from the mode. Must be ' +
      `within the configured stake range (${WAGER_MIN_STAKE}–${WAGER_MAX_STAKE} LYRIC).`,
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
}

import { IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { GameCategory } from '../entities/game-session.entity';

/**
 * What a player may change on their own session.
 *
 * Deliberately narrow: score, status, mode, players and wager fields only
 * change through gameplay endpoints, and the global ValidationPipe rejects any
 * of them sent here.
 */
export class UpdateGameSessionDto {
  @ApiProperty({ enum: GameCategory, required: false })
  @IsOptional()
  @IsEnum(GameCategory)
  category?: GameCategory;
}

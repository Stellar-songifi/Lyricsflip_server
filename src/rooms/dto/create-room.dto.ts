import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const MAX_PLAYERS_LIMIT = 32;

export class CreateRoomDto {
  @ApiPropertyOptional({ description: 'Optional room display name' })
  @IsString()
  @IsOptional()
  name?: string;

  // Lyrics.id is a serial integer, not a UUID.
  @ApiPropertyOptional({ description: 'Lyric id to seed the room with', minimum: 1 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  lyricId?: number;

  @ApiPropertyOptional({
    description: 'Maximum number of players allowed in the room',
    minimum: 2,
    maximum: MAX_PLAYERS_LIMIT,
  })
  @IsInt()
  @Min(2)
  @Max(MAX_PLAYERS_LIMIT)
  @Type(() => Number)
  @IsOptional()
  maxPlayers?: number;
}
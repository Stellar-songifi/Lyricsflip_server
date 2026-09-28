import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

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
}

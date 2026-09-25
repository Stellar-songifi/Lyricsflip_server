import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRoomDto {
  @IsString()
  @IsOptional()
  name?: string;

  // Lyrics.id is a serial integer, not a UUID.
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  lyricId?: number;
}

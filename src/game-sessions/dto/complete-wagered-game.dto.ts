import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class CompleteWageredGameDto {
  @ApiProperty({ description: 'Score for player one', minimum: 0 })
  @IsInt()
  @Min(0)
  playerOneScore: number;

  @ApiProperty({ description: 'Score for player two', minimum: 0 })
  @IsInt()
  @Min(0)
  playerTwoScore: number;
}

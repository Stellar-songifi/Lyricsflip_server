import { IsInt, IsPositive, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GrantMockBalanceDto {
  @ApiProperty({ description: 'User id to credit', format: 'uuid' })
  @IsString()
  userId!: string;

  @ApiProperty({ description: 'Amount to credit in mock balance', minimum: 1 })
  @IsInt()
  @IsPositive()
  amount!: number;
}

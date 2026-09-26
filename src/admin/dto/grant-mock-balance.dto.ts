import { IsInt, IsPositive, IsString } from "class-validator";

export class GrantMockBalanceDto {
  @IsString()
  userId!: string;

  @IsInt()
  @IsPositive()
  amount!: number;
}

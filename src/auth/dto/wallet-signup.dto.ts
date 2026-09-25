import { IsOptional, IsString, Matches } from "class-validator";

export class WalletSignupDto {
  @Matches(/^G[A-Z2-7]{55}$/)
  walletAddress!: string;

  @IsOptional()
  @IsString()
  username?: string;
}

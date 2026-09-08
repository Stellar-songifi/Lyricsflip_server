import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

/** Request for a SEP-10 challenge transaction. */
export class StellarChallengeDto {
  @ApiProperty({
    description: 'The Stellar account (G...) that wants to prove ownership',
    example: 'GBB3MXLPWTKVFS5ROB3OGGNPXXRU5N7INABOUJ3O77JR63R36ZTGYAFT',
  })
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'account must be a Stellar public key (G... , 56 characters)',
  })
  account: string;
}

/** A challenge transaction signed by the wallet and returned for verification. */
export class StellarVerifyDto {
  @ApiProperty({
    description:
      'The challenge transaction envelope (base64 XDR) after the wallet has signed it',
  })
  @IsString()
  @MaxLength(20000)
  transaction: string;
}

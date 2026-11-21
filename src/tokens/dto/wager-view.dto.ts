import { ApiProperty } from '@nestjs/swagger';
import { WagerStatus } from '../entities/wager.entity';

class WagerAmountDto {
  @ApiProperty() stroops: string;
  @ApiProperty() display: string;
}

class WagerTransactionDto {
  @ApiProperty() hash: string;
  @ApiProperty({ type: String, nullable: true }) explorerUrl: string | null;
}

export class WagerViewDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) sessionId: string;
  @ApiProperty({ type: WagerAmountDto }) stake: WagerAmountDto;
  @ApiProperty({ type: WagerAmountDto }) totalPot: WagerAmountDto;
  @ApiProperty({ type: String, nullable: true }) opponentUsername:
    | string
    | null;
  @ApiProperty({ enum: WagerStatus }) status: WagerStatus;
  @ApiProperty({ type: WagerTransactionDto, nullable: true })
  escrow: WagerTransactionDto | null;
  @ApiProperty({ type: WagerTransactionDto, nullable: true })
  playerAStake: WagerTransactionDto | null;
  @ApiProperty({ type: WagerTransactionDto, nullable: true })
  playerBStake: WagerTransactionDto | null;
  @ApiProperty({ type: WagerTransactionDto, nullable: true })
  settlement: WagerTransactionDto | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Stellar ledger after which players can claim a refund.',
  })
  claimDeadlineLedger: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  stakeDeadline: Date | null;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/** A stake transaction returned after the player's wallet has signed it. */
export class ConfirmStakeDto {
  @ApiProperty({
    description:
      'The stake transaction envelope (base64 XDR) after the wallet has ' +
      'signed it. This is the `transaction` handed back in `pendingSignatures` ' +
      'when the session was created.',
  })
  @IsString()
  @MaxLength(20000)
  transaction: string;
}

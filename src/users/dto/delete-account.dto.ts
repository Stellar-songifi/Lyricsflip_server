import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class DeleteAccountDto {
  @ApiPropertyOptional({
    description:
      'The current password of the account, used to re-authenticate before deletion. ' +
      'Required for accounts that have a password. Accounts created through wallet login ' +
      '(passwordless) must instead provide a fresh SEP-10 signed challenge.',
    example: 'S3cureP@ssw0rd',
  })
  @ValidateIf((o: DeleteAccountDto) => !o.signedChallenge)
  @IsString()
  @MinLength(1)
  @IsOptional()
  password?: string;

  @ApiPropertyOptional({
    description:
      'A fresh SEP-10 signed challenge (base64-encoded transaction envelope XDR) used to ' +
      're-authenticate passwordless (wallet) accounts before deletion. Required when no ' +
      'password is supplied.',
    example: 'AAAAAgAAAAB...',
  })
  @ValidateIf((o: DeleteAccountDto) => !o.password)
  @IsString()
  @MinLength(1)
  @IsOptional()
  signedChallenge?: string;
}
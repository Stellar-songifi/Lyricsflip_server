import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class DeleteAccountDto {
  @ApiPropertyOptional({
    description:
      'The current password of the account, used to re-authenticate before deletion. Required for accounts that have a password.',
    example: 'S3cureP@ssw0rd',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  password?: string;

  @ApiPropertyOptional({
    description:
      'A freshly signed SEP-10 challenge (base64 XDR) from the linked wallet. Used instead of a password for accounts without one.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  transaction?: string;
}

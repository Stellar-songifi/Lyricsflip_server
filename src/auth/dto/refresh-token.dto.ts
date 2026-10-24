import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token issued at login or signup' })
  @IsString()
  refreshToken: string;

  @ApiPropertyOptional({
    description:
      'Name for this device, shown in GET /auth/sessions. Kept across refreshes when omitted.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceName?: string;
}

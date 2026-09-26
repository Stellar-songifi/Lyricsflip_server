import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * DTO for self-service profile updates via PATCH /users/me.
 *
 * Username format is enforced per issue #129: 3-30 characters, letters,
 * numbers, underscores and hyphens only. Uniqueness is enforced in the
 * users service before persisting.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'Display name', minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: 'Unique username (3-30 chars, letters, numbers, _ and -)',
    minLength: 3,
    maxLength: 30,
    pattern: '^[a-zA-Z0-9_-]+$',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'username may only contain letters, numbers, underscores and hyphens',
  })
  username?: string;

  @ApiPropertyOptional({ description: 'Avatar image URL' })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  avatarUrl?: string;
}

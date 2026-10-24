import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Role } from '../../auth/roles/role.enum';
import {
  IsUsername,
  USERNAME_RULE,
} from '../../common/validators/username.validator';

/**
 * Fields a user may change on their own account (PATCH /users/me).
 * Password changes are not handled here; they need the auth flow.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: USERNAME_RULE.description,
    minLength: USERNAME_RULE.minLength,
    maxLength: USERNAME_RULE.maxLength,
  })
  @IsOptional()
  @IsUsername()
  username?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

/** Fields an admin may change on any account (PATCH /users/:id). */
export class AdminUpdateUserDto extends UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

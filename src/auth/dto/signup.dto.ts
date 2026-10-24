import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsUsername,
  USERNAME_RULE,
} from '../../common/validators/username.validator';

export class SignupDto {
  @ApiProperty({
    description: USERNAME_RULE.description,
    minLength: USERNAME_RULE.minLength,
    maxLength: USERNAME_RULE.maxLength,
  })
  @IsUsername()
  username: string;

  @ApiProperty({ description: 'User email address' })
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @ApiProperty({
    description:
      'User password: at least 8 characters, including an uppercase letter, ' +
      'a lowercase letter and a number',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(72)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter and one number',
  })
  password: string;
}

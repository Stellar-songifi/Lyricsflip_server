import { IsEmail, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NormalizeEmail } from './email.transform';

export class LoginDto {
  @ApiProperty({ description: 'User email address' })
  @IsEmail()
  @NormalizeEmail()
  email: string;

  @ApiProperty({ description: 'User password' })
  @IsString()
  password: string;
}
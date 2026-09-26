import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  ValidationPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { authThrottle, stellarThrottle } from '../common/throttler/throttle.config';
import { AuthService } from './auth.service';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Audited } from '../audit/decorators/audited.decorator';
import { StellarAuthService } from './services/stellar-auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { StellarChallengeDto, StellarVerifyDto } from './dto/stellar-auth.dto';
import { Public } from './decorators/public.decorator';
import { GetUser } from './decorators/user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('auth')
@Controller('auth')
@UseInterceptors(AuditInterceptor)
export class AuthController {
  constructor(
    private authService: AuthService,
    private stellarAuthService: StellarAuthService,
  ) {}

  @Public()
  @Throttle(authThrottle)
  @Post('signup')
  @ApiOperation({ summary: 'Sign up a new user' })
  @ApiResponse({ status: 201, description: 'User signed up successfully.' })
  async signup(@Body(ValidationPipe) signupDto: SignupDto) {
    return this.authService.signup(signupDto);
  }

  @Public()
  @Throttle(authThrottle)
  @Post('login')
  @ApiOperation({ summary: 'Login a user' })
  @ApiResponse({ status: 200, description: 'User logged in successfully.' })
  @HttpCode(HttpStatus.OK)
  async login(@Body(ValidationPipe) loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  @ApiResponse({ status: 200, description: 'New access and refresh tokens.' })
  @ApiResponse({ status: 401, description: 'Refresh token invalid or expired.' })
  @HttpCode(HttpStatus.OK)
  async refresh(@Body(ValidationPipe) dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiResponse({ status: 200, description: 'Refresh token revoked.' })
  @HttpCode(HttpStatus.OK)
  async logout(@Body(ValidationPipe) dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
    return { message: 'Logged out' };
  }

  @Public()
  @Throttle(authThrottle)
  @Post('verify-email')
  @ApiOperation({
    summary: 'Verify an email address with a single-use token',
    description:
      'Consumes the token emailed at signup and marks the account as verified.',
  })
  @ApiResponse({ status: 200, description: 'Email verified.' })
  @ApiResponse({ status: 400, description: 'Token invalid, expired, or already used.' })
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body(ValidationPipe) dto: VerifyEmailDto) {
    await this.authService.verifyEmail(dto.token);
    return { message: 'Email verified' };
  }

  @Public()
  @Throttle(authThrottle)
  @Post('resend-verification')
  @ApiOperation({
    summary: 'Resend the email verification link',
    description:
      'Always responds with success so the endpoint cannot be used to probe ' +
      'which addresses are registered.',
  })
  @ApiResponse({ status: 200, description: 'Verification email sent if needed.' })
  @HttpCode(HttpStatus.OK)
  async resendVerification(@Body(ValidationPipe) dto: ResendVerificationDto) {
    await this.authService.resendVerification(dto.email);
    return { message: 'If the account exists, a verification email has been sent.' };
  }

  @Public()
  @Throttle(authThrottle)
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Request a password reset link',
    description:
      'Always responds with success so the endpoint cannot be used to probe ' +
      'which addresses are registered.',
  })
  @ApiResponse({ status: 200, description: 'Reset email sent if the account exists.' })
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body(ValidationPipe) dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return { message: 'If the account exists, a password reset email has been sent.' };
  }

  @Public()
  @Throttle(authThrottle)
  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset a password with a single-use token',
    description:
      'Consumes the token emailed by forgot-password, updates the password, and ' +
      'revokes every outstanding session for the account.',
  })
  @ApiResponse({ status: 200, description: 'Password reset.' })
  @ApiResponse({ status: 400, description: 'Token invalid, expired, or already used.' })
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body(ValidationPipe) dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.password);
    return { message: 'Password reset. Please log in again.' };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle(authThrottle)
  @Post('change-password')
  @Audited({ action: 'auth.password.change', targetType: 'user' })
  @ApiOperation({
    summary: 'Change the signed-in user’s password',
    description:
      'Requires the current password, enforces the password strength policy, ' +
      'and invalidates every other outstanding session for the account.',
  })
  @ApiResponse({ status: 200, description: 'Password changed.' })
  @ApiResponse({ status: 401, description: 'Current password is incorrect.' })
  @ApiResponse({ status: 400, description: 'New password does not meet the strength policy.' })
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @GetUser() user: User,
    @Body(ValidationPipe) dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(user.id, dto);
    return { message: 'Password changed. Please log in again.' };
  }

  @Public()
  @Throttle(stellarThrottle)
  @Post('stellar/challenge')
  @ApiOperation({
    summary: 'Request a SEP-10 challenge transaction for a Stellar account',
    description:
      'Returns a transaction for the wallet to sign. It has sequence number 0 and ' +
      'can never be submitted to the network — signing it only proves key ownership.',
  })
  @ApiResponse({ status: 200, description: 'Challenge transaction.' })
  @HttpCode(HttpStatus.OK)
  challenge(@Body(ValidationPipe) dto: StellarChallengeDto) {
    return {
      ...this.stellarAuthService.buildChallenge(dto.account),
      server_account_id: this.stellarAuthService.serverAccountId,
    };
  }

  @Public()
  @Throttle(stellarThrottle)
  @Post('stellar/login')
  @ApiOperation({
    summary: 'Authenticate with a signed SEP-10 challenge',
    description:
      'Exchanges a signed challenge for the same JWT the password flow issues. ' +
      'The wallet must already be linked to a LyricsFlip account.',
  })
  @ApiResponse({ status: 200, description: 'Authenticated with wallet.' })
  @HttpCode(HttpStatus.OK)
  async stellarLogin(@Body(ValidationPipe) dto: StellarVerifyDto) {
    return this.stellarAuthService.loginWithWallet(dto.transaction);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle(stellarThrottle)
  @Post('stellar/link')
  @Audited({ action: 'auth.wallet.link', targetType: 'user' })
  @ApiOperation({
    summary: 'Link a Stellar wallet to the signed-in account',
    description:
      'Required before joining a wagered match: stakes are pulled from this ' +
      'address and payouts are sent to it.',
  })
  @ApiResponse({ status: 200, description: 'Wallet linked.' })
  @ApiResponse({
    status: 409,
    description: 'Address already linked to another account.',
  })
  @HttpCode(HttpStatus.OK)
  async linkWallet(
    @GetUser() user: User

/* … truncated 1110 chars — edit only what you need near the top … */

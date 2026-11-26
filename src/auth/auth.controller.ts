import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  Body,
  ValidationPipe,
  HttpCode,
  HttpStatus,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { authThrottle, stellarThrottle } from '../common/throttler/throttle.config';
import { Request } from 'express';
import { AuthService, ClientContext } from './auth.service';
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
  @ApiResponse({
    status: 200,
    description: 'User logged in successfully.',
    schema: {
      type: 'object',
      required: ['accessToken', 'refreshToken', 'user'],
      properties: {
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
        user: {
          type: 'object',
          required: [
            'id',
            'username',
            'xp',
            'level',
            'levelTitle',
            'createdAt',
          ],
          properties: {
            id: { type: 'string', format: 'uuid' },
            username: { type: 'string' },
            xp: { type: 'integer' },
            level: { type: 'integer' },
            levelTitle: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
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
  async refresh(
    @Body(ValidationPipe) dto: RefreshTokenDto,
    @Req() request: Request,
  ) {
    return this.authService.refresh(
      dto.refreshToken,
      this.clientContext(request, dto.deviceName),
    );
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

  @ApiBearerAuth()
  @Get('sessions')
  @ApiOperation({
    summary: 'List the devices you are signed in on',
    description:
      'One entry per active refresh token. IP addresses are truncated to the network.',
  })
  @ApiResponse({ status: 200, description: 'Active sessions.' })
  async listSessions(@GetUser() user: User) {
    return this.authService.listSessions(user.id);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  @Audited({ action: 'auth.session.revoke', targetType: 'refresh_token' })
  @ApiOperation({ summary: 'Sign one device out' })
  @ApiResponse({ status: 200, description: 'Session revoked.' })
  @ApiResponse({ status: 404, description: 'No such active session.' })
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @GetUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.authService.revokeSession(user.id, id);
    return { message: 'Session revoked' };
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @Audited({ action: 'auth.logout-all', targetType: 'user' })
  @ApiOperation({
    summary: 'Sign out everywhere',
    description:
      'Revokes every refresh token and invalidates every access token, including the one used for this request.',
  })
  @ApiResponse({ status: 200, description: 'Signed out on every device.' })
  @HttpCode(HttpStatus.OK)
  async logoutAll(@GetUser() user: User) {
    await this.authService.logoutAll(user.id);
    return { message: 'Signed out on every device' };
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
  @Post('stellar/signup')
  @ApiOperation({
    summary: 'Sign up with a Stellar wallet alone',
    description:
      'Verifies a SEP-10 challenge and creates a wallet-only account with a ' +
      'verified stellarAddress and no password. An email and password can be ' +
      'added later via POST /auth/stellar/add-credentials.',
  })
  @ApiResponse({ status: 201, description: 'Wallet-only account created.' })
  @ApiResponse({ status: 400, description: 'Challenge invalid or username taken.' })
  @ApiResponse({ status: 409, description: 'Wallet already linked to an account.' })
  async stellarSignup(
    @Body(ValidationPipe) dto: StellarSignupDto,
    @Req() request: Request,
  ) {
    return this.stellarAuthService.signup(
      dto.transaction,
      dto.username,
      this.clientContext(request),
    );
  }

  @ApiBearerAuth()
  @Throttle(stellarThrottle)
  @Post('stellar/add-credentials')
  @Audited({ action: 'auth.stellar.add-credentials', targetType: 'user' })
  @ApiOperation({
    summary: 'Add an email and password to a wallet-only account',
    description:
      'Requires a fresh SEP-10 signature proving control of the linked wallet. ' +
      'Only available to accounts that do not yet have a password.',
  })
  @ApiResponse({ status: 200, description: 'Email and password added.' })
  @ApiResponse({ status: 400, description: 'Challenge invalid or password too weak.' })
  @ApiResponse({ status: 409, description: 'Account already has a password or email in use.' })
  @HttpCode(HttpStatus.OK)
  async stellarAddCredentials(
    @GetUser() user: User,
    @Body(ValidationPipe) dto: StellarAddCredentialsDto,
  ) {
    await this.stellarAuthService.addCredentials(user.id, dto);
    return { message: 'Email and password added. Please log in again.' };
  }

  @Public()
  @Throttle(stellarThrottle)
  @Post('stellar/challenge')
  @ApiOperation({ summary: 'Request a SEP-10 challenge transaction' })
  @ApiResponse({ status: 200, description: 'Challenge transaction.' })
  @HttpCode(HttpStatus.OK)
  async stellarChallenge(@Body(ValidationPipe) dto: StellarChallengeDto) {
    return this.stellarAuthService.createChallenge(dto.publicKey);
  }

  @Public()
  @Throttle(stellarThrottle)
  @Post('stellar/login')
  @ApiOperation({ summary: 'Log in with a Stellar wallet' })
  @ApiResponse({ status: 200, description: 'Logged in successfully.' })
  @ApiResponse({ status: 401, description: 'Challenge invalid or wallet not linked.' })
  @HttpCode(HttpStatus.OK)
  async stellarLogin(
    @Body(ValidationPipe) dto: StellarVerifyDto,
    @Req() request: Request,
  ) {
    return this.stellarAuthService.login(
      dto.transaction,
      this.clientContext(request),
    );
  }

  private clientContext(request: Request, deviceName?: string): ClientContext {
    return {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      deviceName,
    };
  }
}

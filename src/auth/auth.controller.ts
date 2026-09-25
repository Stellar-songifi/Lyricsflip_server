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
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { StellarAuthService } from './services/stellar-auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
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
export class AuthController {
  constructor(
    private authService: AuthService,
    private stellarAuthService: StellarAuthService,
  ) {}

  @Public()
  @Post('signup')
  @ApiOperation({ summary: 'Sign up a new user' })
  @ApiResponse({ status: 201, description: 'User signed up successfully.' })
  async signup(@Body(ValidationPipe) signupDto: SignupDto) {
    return this.authService.signup(signupDto);
  }

  @Public()
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

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('change-password')
  @ApiOperation({
    summary: 'Change the signed-in user’s password',
    description:
      'Invalidates every outstanding access token and refresh token for the account.',
  })
  @ApiResponse({ status: 200, description: 'Password changed.' })
  @ApiResponse({ status: 401, description: 'Current password is incorrect.' })
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @GetUser() user: User,
    @Body(ValidationPipe) dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(user.id, dto);
    return { message: 'Password changed. Please log in again.' };
  }

  @Public()
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
  @Post('stellar/link')
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
    @GetUser() user: User,
    @Body(ValidationPipe) dto: StellarVerifyDto,
  ) {
    return this.stellarAuthService.linkWallet(user.id, dto.transaction);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('stellar/wallet')
  @ApiOperation({
    summary: 'The Stellar wallet linked to the signed-in account',
  })
  @ApiResponse({ status: 200, description: 'Linked wallet, or null.' })
  getWallet(@GetUser() user: User) {
    return {
      stellarAddress: user.stellarAddress ?? null,
      verifiedAt: user.stellarAddressVerifiedAt ?? null,
    };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Delete('stellar/wallet')
  @ApiOperation({
    summary: 'Unlink the Stellar wallet from the signed-in account',
  })
  @ApiResponse({ status: 200, description: 'Wallet unlinked.' })
  @HttpCode(HttpStatus.OK)
  async unlinkWallet(@GetUser() user: User) {
    await this.stellarAuthService.unlinkWallet(user.id);
    return { message: 'Stellar wallet unlinked' };
  }
}

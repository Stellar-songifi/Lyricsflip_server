/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { Role } from './roles/role.enum';
import { AuthResult, AuthTokenService } from './services/auth-token.service';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordResetService } from './services/password-reset.service';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { truncateIp } from '../common/utils/ip.util';

// 30 days: long enough that a client does not need to re-login often, short
// enough to bound how long a leaked-but-unused refresh token stays valid.
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Where a refresh token is being used from; recorded on the session. */
export interface ClientContext {
  userAgent?: string | null;
  ip?: string | null;
  deviceName?: string | null;
}

/** One signed-in device, as shown by GET /auth/sessions. */
export interface SessionView {
  id: string;
  deviceName: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private refreshTokenRepository: Repository<RefreshToken>,
    private jwtService: JwtService,
    private authTokenService: AuthTokenService,
    private emailVerificationService: EmailVerificationService,
    private passwordResetService: PasswordResetService,
  ) {}

  async signup(signupDto: SignupDto): Promise<AuthResult> {
    const { username, email, password } = signupDto;

    // Check if user already exists
    const existingUser = await this.userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .orWhere('LOWER(user.username) = LOWER(:username)', { username })
      .getOne();

    if (existingUser) {
      if (existingUser.email.toLowerCase() === email) {
        throw new ConflictException('Email already exists');
      }
      if (existingUser.username.toLowerCase() === username.toLowerCase()) {
        throw new ConflictException('Username already exists');
      }
    }

    // Hash password using helper
    let passwordHash: string;
    try {
      passwordHash = await this.hashPassword(password);
    } catch (err) {
      throw new BadRequestException('Failed to hash password');
    }

    // Create user
    const user = this.userRepository.create({
      username,
      email,
      passwordHash,
    });

    try {
      await this.userRepository.save(user);
    } catch (error) {
      throw new BadRequestException('Failed to create user');
    }

    return this.authTokenService.issueToken(user);
  }

  async login(loginDto: LoginDto): Promise<AuthResult> {
    const { email, password } = loginDto;

    // passwordHash is select: false, so it must be requested explicitly
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password using helper
    let isPasswordValid: boolean;
    try {
      isPasswordValid = await this.validatePassword(
        password,
        user.passwordHash,
      );
    } catch (err) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Checked after the password so account status is not revealed to
    // someone who does not know it. Same message as the wallet flow.
    this.authTokenService.assertActive(user);

    // Update last login timestamp
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    return this.authTokenService.issueToken(user);
  }

  /**
   * Exchanges a valid, unexpired refresh token for a new access/refresh
   * pair. The presented token is revoked as part of the rotation, so it
   * cannot be replayed even if it leaks after use.
   */
  async refresh(
    refreshToken: string,
    context: ClientContext = {},
  ): Promise<TokenPair> {
    const tokenHash = this.hashRefreshToken(refreshToken);

    const existing = await this.refreshTokenRepository.findOne({
      where: { tokenHash },
    });

    if (
      !existing ||
      existing.revokedAt ||
      existing.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    const user = await this.userRepository.findOne({
      where: { id: existing.userId },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    existing.revokedAt = new Date();
    await this.refreshTokenRepository.save(existing);

    // The rotated token is the same device, so it keeps its name unless the
    // client sends a new one.
    return this.issueTokenPair(user, {
      ...context,
      deviceName: context.deviceName ?? existing.deviceName,
    });
  }

  /** The user's signed-in devices: unrevoked, unexpired refresh tokens. */
  async listSessions(userId: string): Promise<SessionView[]> {
    const tokens = await this.refreshTokenRepository.find({
      where: {
        userId,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { lastUsedAt: { direction: 'DESC', nulls: 'LAST' }, createdAt: 'DESC' },
    });

    return tokens.map((token) => ({
      id: token.id,
      deviceName: token.deviceName,
      userAgent: token.userAgent,
      ip: token.ip,
      createdAt: token.createdAt,
      lastUsedAt: token.lastUsedAt,
      expiresAt: token.expiresAt,
    }));
  }

  /**
   * Signs one device out by revoking its refresh token. Its current access
   * token stays valid until it expires (JWT_EXPIRES_IN, 15 minutes by
   * default); use logoutAll to cut every access token off immediately.
   */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const result = await this.refreshTokenRepository.update(
      { id: sessionId, userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    if (!result.affected) {
      throw new NotFoundException('Session not found');
    }
  }

  /**
   * Signs out everywhere without a password change: bumps tokenVersion, so
   * every outstanding access token is rejected by JwtStrategy, and revokes
   * every refresh token.
   */
  async logoutAll(userId: string): Promise<void> {
    await this.userRepository.increment({ id: userId }, 'tokenVersion', 1);
    await this.refreshTokenRepository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /** Revokes a single refresh token, e.g. on explicit logout. */
  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    await this.refreshTokenRepository.update(
      { tokenHash, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /**
   * Changes the user's password, bumping tokenVersion (invalidating every
   * outstanding access token immediately) and revoking all of the user's
   * refresh tokens so other sessions are signed out.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :userId', { userId })
      .getOne();
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isCurrentValid = await this.validatePassword(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!isCurrentValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    user.passwordHash = await this.hashPassword(dto.newPassword);
    user.tokenVersion += 1;
    await this.userRepository.save(user);

    await this.refreshTokenRepository.update(
      { userId: user.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /**
   * Consumes a single-use email verification token and marks the account
   * verified. Throws 400 if the token is unknown, already used or expired.
   */
  async verifyEmail(token: string): Promise<void> {
    await this.emailVerificationService.consume(token);
  }

  /**
   * Re-sends a verification email if the account exists and is not yet
   * verified. Always resolves, so callers cannot probe for registered
   * addresses.
   */
  async resendVerification(email: string): Promise<void> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();

    if (!user || user.emailVerifiedAt) {
      return;
    }

    await this.emailVerificationService.issue(user);
  }

  /**
   * Sends a password reset email if the account exists. Always resolves,
   * so the response is identical whether or not the email is registered.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();

    if (!user) {
      return;
    }

    await this.passwordResetService.issue(user);
  }

  /**
   * Consumes a single-use password reset token, sets the new password,
   * bumps tokenVersion (invalidating every outstanding access token) and
   * revokes all of the user's refresh tokens, as changePassword does.
   */
  async resetPassword(token: string, password: string): Promise<void> {
    const userId = await this.passwordResetService.consume(token);

    const user = await this.userRepository.findOne({
      where: { id: userId },
    });
    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    user.passwordHash = await this.hashPassword(password);
    user.tokenVersion += 1;
    await this.userRepository.save(user);

    await this.refreshTokenRepository.update(
      { userId: user.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /** Signs a short-lived access token and issues a new stored refresh token. */
  private async issueTokenPair(
    user: User,
    context: ClientContext = {},
  ): Promise<TokenPair> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role as Role,
      tokenVersion: user.tokenVersion,
    };
    const accessToken = this.jwtService.sign(payload);

    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = this.hashRefreshToken(rawRefreshToken);

    await this.refreshTokenRepository.save(
      this.refreshTokenRepository.create({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        revokedAt: null,
        userAgent: context.userAgent?.slice(0, 255) ?? null,
        ip: truncateIp(context.ip),
        lastUsedAt: new Date(),
        deviceName: context.deviceName ?? null,
      }),
    );

    return { accessToken, refreshToken: rawRefreshToken };
  }

  private hashRefreshToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  private async validatePassword(
    password: string,
    passwordHash: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, passwordHash);
  }
}

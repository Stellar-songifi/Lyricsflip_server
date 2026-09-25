/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { Role } from './roles/role.enum';
import { User } from 'src/users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';

// 30 days: long enough that a client does not need to re-login often, short
// enough to bound how long a leaked-but-unused refresh token stays valid.
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private refreshTokenRepository: Repository<RefreshToken>,
    private jwtService: JwtService,
  ) {}

  async signup(
    signupDto: SignupDto,
  ): Promise<TokenPair & { user: Partial<User> }> {
    // Normalize again here (not just in the DTO) so any caller that bypasses
    // the DTO's @Transform still gets consistent, case-insensitive identity.
    const email = signupDto.email.trim().toLowerCase();
    const username = signupDto.username.trim();
    const { password } = signupDto;

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

    const tokens = await this.issueTokenPair(user);

    // Return user without password
    const { passwordHash: _, ...userWithoutPassword } = user;

    return {
      ...tokens,
      user: userWithoutPassword,
    };
  }

  async login(loginDto: LoginDto): Promise<TokenPair & { user: Partial<User> }> {
    const email = loginDto.email.trim().toLowerCase();
    const { password } = loginDto;

    // Find user by email (case-insensitive)
    const user = await this.userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
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

    // Update last login timestamp
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    const tokens = await this.issueTokenPair(user);

    // Return user without password
    const { passwordHash: _, ...userWithoutPassword } = user;

    return {
      ...tokens,
      user: userWithoutPassword,
    };
  }

  /**
   * Exchanges a valid, unexpired refresh token for a new access/refresh
   * pair. The presented token is revoked as part of the rotation, so it
   * cannot be replayed even if it leaks after use.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
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

    return this.issueTokenPair(user);
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
   * Changes the user's password, bumps tokenVersion (invalidating every
   * outstanding access token immediately) and revokes all of the user's
   * refresh tokens.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
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

  /** Signs a short-lived access token and issues a new stored refresh token. */
  private async issueTokenPair(user: User): Promise<TokenPair> {
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
      }),
    );

    return { accessToken, refreshToken: rawRefreshToken };
  }

  /**
   * Refresh tokens are high-entropy random values (not passwords), so a fast
   * deterministic hash is used instead of bcrypt: it needs to be looked up
   * by equality, and the token cannot be brute-forced from its hash any more
   * easily than the raw 320-bit value could be guessed.
   */
  private hashRefreshToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // Hash a plaintext password using bcrypt

  private async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    try {
      return await bcrypt.hash(password, saltRounds);
    } catch (err) {
      throw new Error('Hashing failed');
    }
  }

  // Validate a plaintext password against a hash

  private async validatePassword(
    plain: string,
    hashed: string,
  ): Promise<boolean> {
    try {
      return await bcrypt.compare(plain, hashed);
    } catch (err) {
      return false;
    }
  }

  async validateUser(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }
}

import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';

import { User } from '../../users/entities/user.entity';
import { PasswordResetToken } from '../entities/password-reset-token.entity';
import { MailerService } from './mailer.service';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokenRepository: Repository<PasswordResetToken>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly mailerService: MailerService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Issue a single-use password reset token for the given user.
   * Only the SHA-256 hash of the token is persisted; the raw token is
   * delivered to the user via email.
   */
  async issue(user: User): Promise<void> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    const token = this.passwordResetTokenRepository.create({
      tokenHash,
      userId: user.id,
      expiresAt,
      usedAt: null,
    });

    await this.passwordResetTokenRepository.save(token);

    try {
      await this.mailerService.sendPasswordResetEmail(user.email, rawToken);
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${user.email}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Consume a password reset token. Returns the associated user if the token
   * is valid, unused and unexpired. The token is marked as used so it can
   * only be redeemed once.
   *
   * The token is consumed with a single conditional UPDATE so that
   * concurrent requests cannot both redeem the same token.
   */
  async consume(rawToken: string): Promise<User> {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const tokenHash = this.hashToken(rawToken);

    const token = await this.passwordResetTokenRepository.findOne({
      where: { tokenHash },
    });

    if (!token) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const result = await this.passwordResetTokenRepository
      .createQueryBuilder()
      .update(PasswordResetToken)
      .set({ usedAt: new Date() })
      .where('tokenHash = :tokenHash', { tokenHash })
      .andWhere('usedAt IS NULL')
      .andWhere('expiresAt > :now', { now: new Date() })
      .execute();

    if (!result.affected) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const user = await this.userRepository.findOne({
      where: { id: token.userId },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    return user;
  }
}